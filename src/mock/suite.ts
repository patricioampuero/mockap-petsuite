// Rutas del modelo de negocio: multitenant (sucursales y equipo), publicidad y convenios con aprobación del asesor,
// CMS de ONG, correos transaccionales, cobranza con Orcob y derechos de la Ley 21.719.
// server.ts las registra con sus utilidades (auth, parse, planes) para mantener un único enrutador.
import { z } from 'zod'
import type { Session } from '../shared/api'
import { db, now, uid, dayOffset, VERSION_PRIVACIDAD, type Animal, type Banner, type Convenio, type Correo, type Miembro, type OngPerfil, type Pyme, type SolicitudPrivacidad, type Usuario } from './db'
import { DIAS_DERIVAR_COBRANZA, ONG_CUPOS, planPorId, type Limites, type Plan } from '../modules/plans/plans'
import { ROLES_EQUIPO, type ModuloPyme, type Rol } from '../shared/permissions'
import { derivarCobranza } from './orcob'
import { ENLACE_INVALIDO, VIGENCIA_HORAS, correoCuentaCreada, correoEquipo, enlaceCuenta, type TipoToken } from '../shared/cuentas'

type Req = { params: Record<string, string>; query: URLSearchParams; body: unknown; session: Session | null }
type Cupon = { codigo: string; titulo: string; descuento_pct: number; condiciones: string; hasta: string; ong: string; ong_id: string; negocio: string; pyme_id: string }
type Ctx = {
  on: (method: string, path: string, h: (req: Req) => unknown) => void
  auth: (req: Req, ...roles: Rol[]) => Usuario
  parse: <T extends z.ZodType>(schema: T, body: unknown) => z.infer<T>
  fail: (status: number, message: string) => never
  miPyme: (req: Req, modulo: ModuloPyme) => Pyme
  planDe: (pymeId: string) => Plan
  estadoPlan: (pymeId: string) => { plan: Plan; en_gracia: boolean; dias_mora: number; fin: string | null }
  exigirCupo: (pymeId: string, clave: keyof Limites, extra?: number) => void
  permisosEnPyme: (u: Usuario, p: Pyme) => { permisos: ModuloPyme[]; miembro: Miembro | null } | null
  comunaNombre: (id: number) => string
  nombreUsuario: (id: string) => string
  cuponesDe: (filtro: (c: { pyme_id: string; ong_id: string }) => boolean) => Cupon[]
  visible: (a: Animal) => boolean
  sinEnlaces: (t: string) => boolean
  fecha: z.ZodString
}

// ---------- Correos (simulados) ----------
// En la demo la bandeja simulada es el único canal, así que guarda el correo completo, enlaces incluidos.
// El API real, con proveedor de correo, guarda una copia sin el enlace (_privado).
export function enviarCorreo(para: string, asunto: string, cuerpo: string, tipo: Correo['tipo'], _privado?: string) {
  if (para) db.correos.push({ id: uid(), para, asunto, cuerpo, tipo, enviado_en: now() })
}
const correoDe = (usuarioId: string) => db.usuarios.find(u => u.id === usuarioId)?.correo ?? ''
const avisarAsesores = (asunto: string, cuerpo: string) => db.usuarios.filter(u => u.rol === 'asesor' && u.estado === 'activo').forEach(a => enviarCorreo(a.correo, asunto, cuerpo, 'aprobacion'))

// ---------- Enlaces de cuenta ----------
// Base de los enlaces: la app de este navegador; en Node (servidor con archivo o pruebas), APP_URL o el Vite local.
export const baseApp = () => typeof location !== 'undefined'
  ? `${location.origin}${import.meta.env?.BASE_URL ?? '/'}`
  : (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.APP_URL ?? 'http://localhost:5173/'

/** Segundos desde el último enlace de ese tipo para la cuenta (Infinity si nunca se envió). */
export function segundosDesdeEnvio(usuarioId: string, tipo: TipoToken) {
  const ultimo = db.tokens_cuenta.filter(t => t.usuario_id === usuarioId && t.tipo === tipo).map(t => t.creado_en).sort().pop()
  return ultimo ? (Date.now() - new Date(ultimo).getTime()) / 1000 : Infinity
}

/** Emite un enlace de un solo uso y anula los anteriores del mismo tipo que sigan sin usar. */
export function emitirToken(usuarioId: string, tipo: TipoToken) {
  const anulado = now()
  for (const t of db.tokens_cuenta) if (t.usuario_id === usuarioId && t.tipo === tipo && !t.usado_en) t.usado_en = anulado
  const token = uid().replace(/-/g, '')
  db.tokens_cuenta.push({ token, usuario_id: usuarioId, tipo, creado_en: now(), expira_en: new Date(Date.now() + VIGENCIA_HORAS[tipo] * 3_600_000).toISOString(), usado_en: null })
  return enlaceCuenta(baseApp(), tipo, token)
}

/** Consume un enlace vigente de alguno de los tipos indicados; si no existe, ya se usó o venció, responde 400. */
export function usarToken(token: string, tipos: TipoToken[], fail: (status: number, message: string) => never) {
  const t = db.tokens_cuenta.find(x => x.token === token && tipos.includes(x.tipo) && !x.usado_en && x.expira_en > now())
  const u = t && db.usuarios.find(x => x.id === t.usuario_id)
  if (!t || !u) return fail(400, ENLACE_INVALIDO)
  const usado = now()
  for (const x of db.tokens_cuenta) if (x.usuario_id === u.id && tipos.includes(x.tipo) && !x.usado_en) x.usado_en = usado
  return u
}

const mesActual = () => dayOffset(0).slice(0, 7)
const sumarDias = (iso: string, dias: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10) }

export function registerSuiteRoutes(ctx: Ctx) {
  const { on, auth, parse, fail, miPyme, planDe, estadoPlan, exigirCupo, permisosEnPyme, comunaNombre, nombreUsuario, cuponesDe, visible, sinEnlaces, fecha } = ctx
  const texto = (min: number, max: number, msg: string) => z.string().trim().min(min, msg).max(max).refine(sinEnlaces, 'No se permiten enlaces externos')
  const horario = z.object({ 'lun-vie': z.string().trim().max(80), sab: z.string().trim().max(80), dom: z.string().trim().max(80) })
  const conModulo = (req: Req, ...modulos: ModuloPyme[]): Pyme => {
    let error: unknown
    for (const m of modulos) { try { return miPyme(req, m) } catch (e) { error = e } }
    throw error
  }
  const miOng = (req: Req) => {
    const u = auth(req, 'ong')
    const o = db.ongs.find(x => x.propietario_id === u.id)
    if (!o) return fail(409, 'Primero registra tu organización')
    return o
  }
  const nuevaCuenta = (correo: string, nombre: string, rol: Rol, comuna_id: number | null) => {
    const c = correo.trim().toLowerCase()
    if (db.usuarios.some(u => u.correo === c)) fail(409, 'Ese correo ya tiene una cuenta en PetSuite')
    // Sin clave conocida: la persona crea la suya con el enlace de invitación, que además confirma su correo.
    const u: Usuario = { id: uid(), correo: c, clave: uid(), rol, nombre_visible: nombre.trim(), comuna_id, estado: 'activo', creado_en: now(), correo_verificado_en: null }
    db.usuarios.push(u)
    return { u, enlace: emitirToken(u.id, 'invitacion') }
  }

  // ---------- Sucursales (multitenant) ----------
  const sucursalSchema = z.object({
    nombre: z.string().trim().min(2, 'Ingresa el nombre de la sucursal').max(80),
    comuna_id: z.number().int().positive(),
    direccion: z.string().trim().max(200),
    telefono: z.string().trim().max(20).regex(/^[\d+\s()-]*$/, 'Teléfono inválido'),
    whatsapp: z.string().trim().max(20).regex(/^[\d+\s]*$/, 'WhatsApp inválido: usa solo números'),
    horario,
    latitud: z.number().min(-90).max(90).nullable(),
    longitud: z.number().min(-180).max(180).nullable(),
    descripcion: z.string().trim().max(600).refine(sinEnlaces, 'No se permiten enlaces externos').default(''),
    servicios: z.array(z.string().trim().min(2).max(40)).max(12, 'Puedes destacar hasta 12 servicios').default([]),
  })
  const vistaSucursal = (s: (typeof db.sucursales)[number]) => ({ ...s, comuna: comunaNombre(s.comuna_id), equipo: db.miembros.filter(m => m.sucursal_id === s.id).map(m => nombreUsuario(m.usuario_id)) })
  const aplicarSucursal = (p: Pyme, d: z.infer<typeof sucursalSchema>) => {
    if (!db.comunas.some(c => c.id === d.comuna_id)) fail(400, 'Comuna no válida')
    if (!planDe(p.id).beneficios.perfil_sucursal && (d.descripcion || d.servicios.length)) fail(422, 'La descripción y los servicios propios por sucursal están disponibles desde el plan Plata')
    return {
      nombre: d.nombre, comuna_id: d.comuna_id, direccion: d.direccion || null, telefono: d.telefono || null, whatsapp: d.whatsapp.replace(/\D/g, '') || null,
      horario: Object.fromEntries(Object.entries(d.horario).filter(([, h]) => h)), latitud: d.latitud === null ? null : String(d.latitud), longitud: d.longitud === null ? null : String(d.longitud),
      descripcion: d.descripcion || null, servicios: [...new Set(d.servicios)],
    }
  }

  on('GET', '/pymes/:id/sucursales', req => {
    const p = conModulo(req, 'sucursales', 'perfil')
    const acceso = permisosEnPyme(auth(req), p)
    const propia = acceso?.miembro ? acceso.miembro.sucursal_id : undefined
    return db.sucursales.filter(s => s.pyme_id === p.id && (propia === undefined || s.id === propia)).sort((a, b) => a.creado_en.localeCompare(b.creado_en)).map(vistaSucursal)
  })

  on('POST', '/pymes/:id/sucursales', req => {
    const p = miPyme(req, 'sucursales')
    const d = parse(sucursalSchema, req.body)
    exigirCupo(p.id, 'sucursales')
    const s = { id: uid(), pyme_id: p.id, ...aplicarSucursal(p, d), creado_en: now() }
    db.sucursales.push(s)
    return vistaSucursal(s)
  })

  // El dueño edita cualquier sucursal; un jefe de local con «Perfil», solo la suya.
  on('PUT', '/pymes/:id/sucursales/:sid', req => {
    const p = conModulo(req, 'sucursales', 'perfil')
    const acceso = permisosEnPyme(auth(req), p)
    const s = db.sucursales.find(x => x.id === req.params.sid && x.pyme_id === p.id)
    if (!s) return fail(404, 'Sucursal no encontrada')
    if (acceso?.miembro && acceso.miembro.sucursal_id !== s.id) return fail(403, 'Solo puedes editar la sucursal que tienes a cargo')
    Object.assign(s, aplicarSucursal(p, parse(sucursalSchema, req.body)))
    return vistaSucursal(s)
  })

  on('DELETE', '/pymes/:id/sucursales/:sid', req => {
    const p = miPyme(req, 'sucursales')
    const i = db.sucursales.findIndex(x => x.id === req.params.sid && x.pyme_id === p.id)
    if (i < 0) return fail(404, 'Sucursal no encontrada')
    for (const m of db.miembros) if (m.sucursal_id === req.params.sid) m.sucursal_id = null
    db.sucursales.splice(i, 1)
    return undefined
  })

  // ---------- Equipo y permisos por módulo ----------
  const vistaMiembro = (m: Miembro) => {
    const u = db.usuarios.find(x => x.id === m.usuario_id)
    return { id: m.id, rol: m.rol, permisos: m.permisos, sucursal_id: m.sucursal_id, sucursal: m.sucursal_id ? db.sucursales.find(s => s.id === m.sucursal_id)?.nombre ?? 'Sucursal' : 'Casa matriz', nombre: u?.nombre_visible ?? 'Usuario', correo: u?.correo ?? '', estado: u?.estado ?? 'activo', creado_en: m.creado_en }
  }
  const permisosValidos = (p: Pyme, rol: keyof typeof ROLES_EQUIPO, permisos: string[] | undefined, sucursal_id: string | null) => {
    if (rol === 'clinico' && p.rubro !== 'veterinaria') fail(422, 'El personal clínico solo se agrega en veterinarias')
    if (sucursal_id && !db.sucursales.some(s => s.id === sucursal_id && s.pyme_id === p.id)) fail(400, 'La sucursal no pertenece a tu negocio')
    const permitidos: readonly string[] = ROLES_EQUIPO[rol].permitidos
    const elegidos = permisos?.length ? permisos : [...ROLES_EQUIPO[rol].porDefecto]
    const fuera = elegidos.filter(x => !permitidos.includes(x))
    if (fuera.length) fail(422, `Un ${rol === 'clinico' ? 'clínico' : 'jefe de local'} no puede tener: ${fuera.join(', ')}`)
    return [...new Set(elegidos)] as ModuloPyme[]
  }
  const miembroSchema = z.object({
    nombre_visible: z.string().trim().min(2, 'Ingresa el nombre').max(80),
    correo: z.string().trim().email('Correo inválido').max(254),
    rol: z.enum(['jefe_local', 'clinico']),
    sucursal_id: z.string().nullable().default(null),
    permisos: z.array(z.string()).optional(),
  })

  on('GET', '/pymes/:id/equipo', req => { const p = miPyme(req, 'equipo'); return db.miembros.filter(m => m.pyme_id === p.id).map(vistaMiembro) })

  // Crea la cuenta del integrante y le envía por correo el enlace para crear su contraseña.
  on('POST', '/pymes/:id/equipo', req => {
    const p = miPyme(req, 'equipo')
    const d = parse(miembroSchema, req.body)
    exigirCupo(p.id, 'usuarios')
    const permisos = permisosValidos(p, d.rol, d.permisos, d.sucursal_id)
    const { u, enlace } = nuevaCuenta(d.correo, d.nombre_visible, d.rol, p.comuna_id)
    const m: Miembro = { id: uid(), pyme_id: p.id, usuario_id: u.id, rol: d.rol, sucursal_id: d.sucursal_id, permisos, creado_en: now() }
    db.miembros.push(m)
    const lugar = (d.sucursal_id ? db.sucursales.find(s => s.id === d.sucursal_id)?.nombre : null) ?? 'la casa matriz'
    const correo = correoEquipo({ nombre: u.nombre_visible, negocio: p.nombre_comercial, rol: d.rol, lugar, permisos, enlace })
    enviarCorreo(u.correo, correo.asunto, correo.cuerpo, 'cuenta_equipo', enlace)
    return vistaMiembro(m)
  })

  on('PATCH', '/pymes/:id/equipo/:mid', req => {
    const p = miPyme(req, 'equipo')
    const m = db.miembros.find(x => x.id === req.params.mid && x.pyme_id === p.id)
    if (!m) return fail(404, 'Integrante no encontrado')
    const d = parse(z.object({ permisos: z.array(z.string()), sucursal_id: z.string().nullable() }), req.body)
    if (!d.permisos.length) return fail(422, 'Asigna al menos un módulo o retira el acceso')
    Object.assign(m, { permisos: permisosValidos(p, m.rol, d.permisos, d.sucursal_id), sucursal_id: d.sucursal_id })
    return vistaMiembro(m)
  })

  // Retirar el acceso cierra sus sesiones y desactiva la cuenta; sus registros clínicos firmados se conservan.
  on('DELETE', '/pymes/:id/equipo/:mid', req => {
    const p = miPyme(req, 'equipo')
    const i = db.miembros.findIndex(x => x.id === req.params.mid && x.pyme_id === p.id)
    if (i < 0) return fail(404, 'Integrante no encontrado')
    const [m] = db.miembros.splice(i, 1)
    const u = db.usuarios.find(x => x.id === m.usuario_id)
    if (u && !db.miembros.some(x => x.usuario_id === u.id)) {
      Object.assign(u, { estado: 'suspendido', suspension: { tipo: 'permanente', dias: null, hasta: null, motivo: 'otro', mensaje: `${p.nombre_comercial} retiró tu acceso de equipo.`, aplicada_en: now() } })
      for (const [token, id] of Object.entries(db.sesiones)) if (id === u.id) delete db.sesiones[token]
      enviarCorreo(u.correo, `Acceso retirado: ${p.nombre_comercial}`, `Hola, ${u.nombre_visible}:\n\n${p.nombre_comercial} retiró tu acceso de equipo en PetSuite.\n\nEquipo PetSuite`, 'cuenta_equipo')
    }
    return undefined
  })

  // ---------- Publicidad (banners sin imágenes, aprobados por el asesor) ----------
  const bannerSchema = z.object({
    titulo: texto(5, 60, 'El título debe tener entre 5 y 60 caracteres'),
    texto: texto(10, 140, 'El texto debe tener entre 10 y 140 caracteres'),
    destino: z.enum(['perfil', 'adopciones', 'convenio']),
    ubicacion: z.enum(['inicio', 'directorio', 'muro']),
    comuna_id: z.number().int().positive().nullable().default(null),
    tono: z.enum(['acento', 'calido', 'info']).default('acento'),
    desde: fecha, hasta: fecha,
  }).refine(b => b.hasta >= b.desde, { message: 'La fecha de término debe ser posterior al inicio', path: ['hasta'] })
    .refine(b => b.desde >= dayOffset(0), { message: 'El banner no puede empezar en el pasado', path: ['desde'] })
    .refine(b => b.hasta <= sumarDias(b.desde, 30), { message: 'Un banner dura como máximo 30 días; luego puedes renovarlo', path: ['hasta'] })
  const parseBanner = (body: unknown) => {
    const d = parse(bannerSchema, body)
    if (d.comuna_id !== null && !db.comunas.some(c => c.id === d.comuna_id)) fail(400, 'Comuna no válida')
    return d
  }
  const activoONuevo = (b: Banner) => (b.estado === 'pendiente' || b.estado === 'aprobado') && b.hasta >= dayOffset(0)
  const nuevoBanner = (autor_tipo: Banner['autor_tipo'], autor_id: string, d: z.infer<typeof bannerSchema>): Banner =>
    ({ id: uid(), autor_tipo, autor_id, ...d, estado: 'pendiente', motivo: null, revisado_por: null, impresiones: 0, clics: 0, creado_en: now() })
  const autorBanner = (b: Banner) => b.autor_tipo === 'pyme' ? db.pymes.find(p => p.id === b.autor_id)?.nombre_comercial ?? 'Negocio' : db.ongs.find(o => o.id === b.autor_id)?.nombre ?? 'ONG'

  on('GET', '/pymes/:id/banners', req => { const p = miPyme(req, 'publicidad'); return db.banners.filter(b => b.autor_tipo === 'pyme' && b.autor_id === p.id).sort((a, b) => b.creado_en.localeCompare(a.creado_en)) })
  on('POST', '/pymes/:id/banners', req => {
    const p = miPyme(req, 'publicidad')
    const d = parseBanner(req.body)
    if (p.estado_verificacion !== 'aprobada') return fail(422, 'Tu negocio debe estar verificado para publicar banners')
    if (d.destino === 'adopciones') return fail(400, 'Los banners de adopción son exclusivos de las ONG')
    exigirCupo(p.id, 'banners')
    const b = nuevoBanner('pyme', p.id, d)
    db.banners.push(b)
    avisarAsesores(`Banner por revisar: ${p.nombre_comercial}`, `«${b.titulo}» espera tu aprobación en Aprobaciones.`)
    return b
  })
  on('DELETE', '/pymes/:id/banners/:bid', req => {
    const p = miPyme(req, 'publicidad')
    const b = db.banners.find(x => x.id === req.params.bid && x.autor_tipo === 'pyme' && x.autor_id === p.id)
    if (!b) return fail(404, 'Banner no encontrado')
    b.estado = 'retirado'
    return undefined
  })
  on('GET', '/ong/banners', req => { const o = miOng(req); return db.banners.filter(b => b.autor_tipo === 'ong' && b.autor_id === o.id).sort((a, b) => b.creado_en.localeCompare(a.creado_en)) })
  on('POST', '/ong/banners', req => {
    const o = miOng(req)
    const d = parseBanner(req.body)
    if (o.estado_verificacion !== 'aprobada') return fail(422, 'Tu organización debe estar verificada para publicar banners')
    if (ONG_CUPOS.banners !== null && db.banners.filter(b => b.autor_tipo === 'ong' && b.autor_id === o.id && activoONuevo(b)).length >= ONG_CUPOS.banners) return fail(422, `Las ONG pueden tener ${ONG_CUPOS.banners} banner activo a la vez, sin costo`)
    const b = nuevoBanner('ong', o.id, d)
    db.banners.push(b)
    avisarAsesores(`Banner por revisar: ${o.nombre}`, `«${b.titulo}» espera tu aprobación en Aprobaciones.`)
    return b
  })
  on('DELETE', '/ong/banners/:bid', req => {
    const o = miOng(req)
    const b = db.banners.find(x => x.id === req.params.bid && x.autor_tipo === 'ong' && x.autor_id === o.id)
    if (!b) return fail(404, 'Banner no encontrado')
    b.estado = 'retirado'
    return undefined
  })

  // Público: banners aprobados y vigentes para una ubicación. Los de planes con más visibilidad van primero.
  on('GET', '/banners', req => {
    const ubicacion = req.query.get('ubicacion') || 'inicio', comuna = Number(req.query.get('comuna') || 0)
    const hoy = dayOffset(0)
    const prioridad = (b: Banner) => b.autor_tipo === 'pyme' ? planDe(b.autor_id).beneficios.destacado : 1
    const vigentes = db.banners.filter(b => b.estado === 'aprobado' && b.ubicacion === ubicacion && b.desde <= hoy && b.hasta >= hoy && (!b.comuna_id || !comuna || b.comuna_id === comuna)
      && (b.autor_tipo === 'ong' || db.pymes.some(p => p.id === b.autor_id && p.estado_verificacion === 'aprobada')))
      .sort((a, b) => prioridad(b) - prioridad(a) || a.creado_en.localeCompare(b.creado_en)).slice(0, 3)
    for (const b of vigentes) b.impresiones++
    return vigentes.map(b => ({ id: b.id, titulo: b.titulo, texto: b.texto, tono: b.tono, destino: b.destino, autor_tipo: b.autor_tipo, autor_id: b.autor_id, autor: autorBanner(b) }))
  })
  on('POST', '/banners/:id/clic', req => { const b = db.banners.find(x => x.id === req.params.id && x.estado === 'aprobado'); if (b) b.clics++; return { ok: true } })

  // ---------- Convenios Pyme–ONG y cupones ----------
  const convenioSchema = z.object({
    ong_id: z.string().min(1, 'Elige la ONG aliada'),
    titulo: texto(5, 80, 'Describe el beneficio en 5 a 80 caracteres'),
    descuento_pct: z.number().int().min(5, 'El descuento mínimo es 5 %').max(50, 'El descuento máximo es 50 %'),
    condiciones: texto(10, 300, 'Indica las condiciones (mínimo 10 caracteres)'),
    desde: fecha, hasta: fecha,
    meta_mensual: z.number().int().min(10).max(1000).default(100),
    premio: texto(5, 120, 'Describe el premio').default('Premio de alimentos PetSuite: 2 sacos de 15 kg'),
  }).refine(c => c.hasta > c.desde, { message: 'La fecha de término debe ser posterior al inicio', path: ['hasta'] })
    .refine(c => c.hasta <= sumarDias(c.desde, 366), { message: 'Un convenio dura como máximo un año', path: ['hasta'] })
  const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8)
  const codigoUnico = (base: string) => { let c = base, n = 2; while (db.convenios.some(x => x.codigo === c)) c = `${base}${n++}`; return c }
  const canjesDe = (c: Convenio) => db.canjes.filter(x => x.convenio_id === c.id)
  const vistaConvenio = (c: Convenio) => {
    const todos = canjesDe(c), mes = todos.filter(x => x.ocurrido_en.slice(0, 7) === mesActual())
    return { ...c, ong: db.ongs.find(o => o.id === c.ong_id)?.nombre ?? 'ONG', negocio: db.pymes.find(p => p.id === c.pyme_id)?.nombre_comercial ?? 'Negocio', canjes_mes: mes.length, canjes_total: todos.length, meta_cumplida: c.premios.some(p => p.mes === mesActual()) }
  }

  on('GET', '/ongs', () => db.ongs.filter(o => o.estado_verificacion === 'aprobada').sort((a, b) => a.nombre.localeCompare(b.nombre)).map(o => ({
    id: o.id, nombre: o.nombre, tipo: o.tipo, comuna: comunaNombre(o.comuna_id), mision: o.perfil_publicado?.mision ?? o.descripcion, emblema: o.perfil_publicado?.emblema ?? 'heart', color: o.perfil_publicado?.color ?? 'acento',
    animales: db.animales.filter(a => a.ong_id === o.id && visible(a)).length, cupones: cuponesDe(c => c.ong_id === o.id).length,
  })))

  // Perfil público de la ONG: solo la versión aprobada por el asesor, sus animales disponibles, cupones e impacto.
  on('GET', '/ongs/:id', req => {
    const o = db.ongs.find(x => x.id === req.params.id && x.estado_verificacion === 'aprobada')
    if (!o) return fail(404, 'Organización no encontrada')
    const convenios = db.convenios.filter(c => c.ong_id === o.id && (c.estado === 'activo' || c.estado === 'finalizado'))
    const canjes = convenios.flatMap(canjesDe)
    return {
      id: o.id, nombre: o.nombre, tipo: o.tipo, comuna: comunaNombre(o.comuna_id), descripcion: o.descripcion, contacto: o.contacto, redes_sociales: o.redes_sociales, perfil: o.perfil_publicado,
      animales: db.animales.filter(a => a.ong_id === o.id && visible(a)).map(a => ({ id: a.id, nombre: a.nombre, especie: a.especie, foto_url: a.foto_url, edad_estimada: a.edad_estimada })),
      cupones: cuponesDe(c => c.ong_id === o.id),
      impacto: { canjes_mes: canjes.filter(x => x.ocurrido_en.slice(0, 7) === mesActual()).length, canjes_total: canjes.length, aliados: new Set(convenios.map(c => c.pyme_id)).size },
    }
  })

  on('GET', '/pymes/:id/convenios', req => { const p = miPyme(req, 'convenios'); return db.convenios.filter(c => c.pyme_id === p.id).sort((a, b) => b.creado_en.localeCompare(a.creado_en)).map(vistaConvenio) })
  on('POST', '/pymes/:id/convenios', req => {
    const p = miPyme(req, 'convenios')
    const d = parse(convenioSchema, req.body)
    if (p.estado_verificacion !== 'aprobada') return fail(422, 'Tu negocio debe estar verificado para proponer convenios')
    const o = db.ongs.find(x => x.id === d.ong_id && x.estado_verificacion === 'aprobada')
    if (!o) return fail(400, 'Elige una ONG verificada')
    exigirCupo(p.id, 'convenios')
    const c: Convenio = { id: uid(), pyme_id: p.id, ...d, codigo: codigoUnico(`${slug(o.nombre)}-${slug(p.nombre_comercial)}${d.descuento_pct}`), estado: 'pendiente_ong', motivo: null, premios: [], creado_en: now() }
    db.convenios.push(c)
    enviarCorreo(correoDe(o.propietario_id), `${p.nombre_comercial} propone un convenio`, `Hola:\n\n${p.nombre_comercial} propone «${c.titulo}» (${c.descuento_pct} %) para tu comunidad, con el código ${c.codigo}.\nRevísalo en Convenios para aceptarlo o rechazarlo.\n\nEquipo PetSuite`, 'convenio')
    return vistaConvenio(c)
  })
  on('POST', '/pymes/:id/convenios/:cid/finalizar', req => {
    const p = miPyme(req, 'convenios')
    const c = db.convenios.find(x => x.id === req.params.cid && x.pyme_id === p.id && x.estado !== 'rechazado' && x.estado !== 'finalizado')
    if (!c) return fail(404, 'Convenio no disponible')
    c.estado = 'finalizado'
    return vistaConvenio(c)
  })

  // Registra una venta hecha con el código de la ONG. Al llegar a la meta del mes se otorga el premio.
  on('POST', '/pymes/:id/canjes', req => {
    const p = miPyme(req, 'convenios')
    const u = auth(req)
    const d = parse(z.object({ codigo: z.string().trim().min(3, 'Ingresa el código del cupón').max(40), sucursal_id: z.string().nullable().optional(), monto_clp: z.number().int().min(0).max(100_000_000).nullable().optional() }), req.body)
    const hoy = dayOffset(0)
    const c = db.convenios.find(x => x.pyme_id === p.id && x.codigo === d.codigo.toUpperCase())
    if (!c) return fail(404, 'El código no corresponde a un convenio de tu negocio')
    if (c.estado !== 'activo' || c.desde > hoy || c.hasta < hoy) return fail(422, 'Este convenio no está vigente')
    const miembro = permisosEnPyme(u, p)?.miembro
    const sucursal = miembro ? miembro.sucursal_id : d.sucursal_id ?? null
    if (sucursal && !db.sucursales.some(s => s.id === sucursal && s.pyme_id === p.id)) return fail(400, 'Sucursal no válida')
    db.canjes.push({ id: uid(), convenio_id: c.id, sucursal_id: sucursal, monto_clp: d.monto_clp ?? null, registrado_por: u.id, ocurrido_en: now() })
    const delMes = canjesDe(c).filter(x => x.ocurrido_en.slice(0, 7) === mesActual()).length
    let premio = false
    if (delMes >= c.meta_mensual && !c.premios.some(x => x.mes === mesActual())) {
      c.premios.push({ mes: mesActual(), otorgado_en: now() })
      premio = true
      const o = db.ongs.find(x => x.id === c.ong_id)
      const aviso = `El convenio «${c.titulo}» entre ${p.nombre_comercial} y ${o?.nombre ?? 'la ONG'} llegó a ${c.meta_mensual} canjes este mes.\nPremio: ${c.premio}.`
      enviarCorreo(correoDe(p.propietario_id), '¡Meta del convenio cumplida!', `${aviso}\nTu asesor coordinará la entrega.\n\nEquipo PetSuite`, 'premio')
      if (o) enviarCorreo(correoDe(o.propietario_id), '¡Tu comunidad cumplió la meta del convenio!', `${aviso}\n\nEquipo PetSuite`, 'premio')
      avisarAsesores(`Premio por entregar: ${p.nombre_comercial}`, aviso)
    }
    return { ok: true, canjes_mes: delMes, meta: c.meta_mensual, premio }
  })

  on('GET', '/ong/convenios', req => { const o = miOng(req); return db.convenios.filter(c => c.ong_id === o.id).sort((a, b) => b.creado_en.localeCompare(a.creado_en)).map(vistaConvenio) })
  on('PATCH', '/ong/convenios/:cid', req => {
    const o = miOng(req)
    const d = parse(z.object({ decision: z.enum(['aceptar', 'rechazar']), motivo: z.string().trim().max(300).optional() }), req.body)
    const c = db.convenios.find(x => x.id === req.params.cid && x.ong_id === o.id && x.estado === 'pendiente_ong')
    if (!c) return fail(404, 'Convenio no disponible')
    const p = db.pymes.find(x => x.id === c.pyme_id)
    if (d.decision === 'aceptar') {
      c.estado = 'pendiente_asesor'
      avisarAsesores(`Convenio por aprobar: ${p?.nombre_comercial} × ${o.nombre}`, `«${c.titulo}» fue aceptado por la ONG y espera tu aprobación.`)
    } else Object.assign(c, { estado: 'rechazado', motivo: d.motivo || 'Rechazado por la ONG' })
    enviarCorreo(correoDe(p?.propietario_id ?? ''), `Convenio ${d.decision === 'aceptar' ? 'aceptado' : 'rechazado'} por ${o.nombre}`, `«${c.titulo}» fue ${d.decision === 'aceptar' ? 'aceptado por la ONG y pasa a revisión del asesor PetSuite' : `rechazado por la ONG${d.motivo ? `: ${d.motivo}` : ''}`}.\n\nEquipo PetSuite`, 'convenio')
    return vistaConvenio(c)
  })

  // ---------- CMS de la ONG ----------
  const ongPerfilSchema = z.object({
    mision: texto(20, 600, 'Cuenta tu misión en al menos 20 caracteres'),
    como_ayudar: z.string().trim().max(600).refine(sinEnlaces, 'No se permiten enlaces externos').default(''),
    necesidades: z.array(z.string().trim().min(2).max(60)).max(10, 'Indica hasta 10 necesidades').default([]),
    voluntariado: z.string().trim().max(400).refine(sinEnlaces, 'No se permiten enlaces externos').default(''),
    horario_visitas: z.string().trim().max(80).default(''),
    donaciones: z.object({
      banco: z.string().trim().min(2, 'Indica el banco').max(60), tipo_cuenta: z.string().trim().min(2, 'Indica el tipo de cuenta').max(40),
      numero: z.string().trim().regex(/^[\d-]{4,30}$/, 'Número de cuenta inválido'), titular: z.string().trim().min(2, 'Indica el titular').max(100),
      rut: z.string().trim().regex(/^\d{7,8}-[\dkK]$/, 'RUT inválido (ej. 65123456-7)'), correo: z.string().trim().email('Correo de donaciones inválido'),
    }).nullable().default(null),
    emblema: z.enum(['heart', 'paw', 'home', 'shield']).default('heart'),
    color: z.enum(['acento', 'calido', 'info', 'vino']).default('acento'),
  })
  on('GET', '/ong/perfil', req => {
    const o = miOng(req)
    return { nombre: o.nombre, estado_verificacion: o.estado_verificacion, publicado: o.perfil_publicado, borrador: o.perfil_borrador, estado: o.perfil_estado, motivo: o.perfil_motivo }
  })
  // Guardar deja un borrador; enviar lo pasa a revisión. Lo público no cambia hasta que el asesor aprueba (evita datos bancarios fraudulentos).
  on('PUT', '/ong/perfil', req => {
    const o = miOng(req)
    const d = parse(z.object({ perfil: ongPerfilSchema, enviar: z.boolean().default(false) }), req.body)
    o.perfil_borrador = d.perfil as OngPerfil
    o.perfil_estado = d.enviar ? 'en_revision' : 'sin_enviar'
    o.perfil_motivo = null
    if (d.enviar) avisarAsesores(`Perfil de ONG por revisar: ${o.nombre}`, `${o.nombre} envió cambios a su perfil público${d.perfil.donaciones ? ', incluidos datos para donaciones' : ''}.`)
    return { estado: o.perfil_estado }
  })

  // ---------- Aprobaciones del asesor ----------
  on('GET', '/asesor/aprobaciones', req => {
    auth(req, 'asesor', 'admin')
    return {
      banners: db.banners.filter(b => b.estado === 'pendiente').map(b => ({ ...b, autor: autorBanner(b), comuna: b.comuna_id ? comunaNombre(b.comuna_id) : 'Todas', plan: b.autor_tipo === 'pyme' ? planDe(b.autor_id).nombre : 'ONG (sin costo)' })),
      perfiles: db.ongs.filter(o => o.perfil_estado === 'en_revision').map(o => ({ id: o.id, nombre: o.nombre, verificada: o.estado_verificacion === 'aprobada', borrador: o.perfil_borrador, publicado: o.perfil_publicado })),
      convenios: db.convenios.filter(c => c.estado === 'pendiente_asesor').map(vistaConvenio),
    }
  })
  const decisionSchema = z.object({ decision: z.enum(['aprobar', 'rechazar']), motivo: z.string().trim().max(300).optional() })
    .refine(d => d.decision === 'aprobar' || (d.motivo ?? '').length >= 10, { message: 'Explica el motivo del rechazo (mínimo 10 caracteres)', path: ['motivo'] })
  on('PATCH', '/asesor/banners/:id', req => {
    const u = auth(req, 'asesor', 'admin')
    const d = parse(decisionSchema, req.body)
    const b = db.banners.find(x => x.id === req.params.id && x.estado === 'pendiente')
    if (!b) return fail(404, 'Banner no disponible')
    Object.assign(b, { estado: d.decision === 'aprobar' ? 'aprobado' : 'rechazado', motivo: d.motivo || null, revisado_por: u.id })
    const dueno = b.autor_tipo === 'pyme' ? db.pymes.find(p => p.id === b.autor_id)?.propietario_id : db.ongs.find(o => o.id === b.autor_id)?.propietario_id
    enviarCorreo(correoDe(dueno ?? ''), `Banner ${d.decision === 'aprobar' ? 'aprobado' : 'rechazado'}: ${b.titulo}`, d.decision === 'aprobar' ? `Tu banner se mostrará del ${b.desde} al ${b.hasta}.\n\nEquipo PetSuite` : `Tu banner no fue aprobado: ${d.motivo}\nPuedes corregirlo y enviarlo de nuevo.\n\nEquipo PetSuite`, 'aprobacion')
    return { ok: true }
  })
  on('PATCH', '/asesor/ong-perfil/:id', req => {
    auth(req, 'asesor', 'admin')
    const d = parse(decisionSchema, req.body)
    const o = db.ongs.find(x => x.id === req.params.id && x.perfil_estado === 'en_revision')
    if (!o) return fail(404, 'No hay cambios de perfil en revisión')
    if (d.decision === 'aprobar' && o.estado_verificacion !== 'aprobada') return fail(422, 'Primero verifica la organización')
    if (d.decision === 'aprobar') Object.assign(o, { perfil_publicado: o.perfil_borrador, perfil_estado: 'publicado', perfil_motivo: null })
    else Object.assign(o, { perfil_estado: 'rechazado', perfil_motivo: d.motivo })
    enviarCorreo(correoDe(o.propietario_id), `Perfil público ${d.decision === 'aprobar' ? 'publicado' : 'con observaciones'}`, d.decision === 'aprobar' ? 'Tus cambios ya se ven en tu perfil público de PetSuite.\n\nEquipo PetSuite' : `Tu asesor dejó observaciones: ${d.motivo}\n\nEquipo PetSuite`, 'aprobacion')
    return { ok: true }
  })
  on('PATCH', '/asesor/convenios/:id', req => {
    auth(req, 'asesor', 'admin')
    const d = parse(decisionSchema, req.body)
    const c = db.convenios.find(x => x.id === req.params.id && x.estado === 'pendiente_asesor')
    if (!c) return fail(404, 'Convenio no disponible')
    Object.assign(c, { estado: d.decision === 'aprobar' ? 'activo' : 'rechazado', motivo: d.motivo || null })
    const p = db.pymes.find(x => x.id === c.pyme_id), o = db.ongs.find(x => x.id === c.ong_id)
    const cuerpo = d.decision === 'aprobar' ? `El convenio «${c.titulo}» está activo. Código para difundir: ${c.codigo}.\nMeta mensual: ${c.meta_mensual} canjes. Premio: ${c.premio}.\n\nEquipo PetSuite` : `El convenio «${c.titulo}» no fue aprobado: ${d.motivo}\n\nEquipo PetSuite`
    for (const id of [p?.propietario_id, o?.propietario_id]) enviarCorreo(correoDe(id ?? ''), `Convenio ${d.decision === 'aprobar' ? 'activo' : 'rechazado'}: ${c.codigo}`, cuerpo, 'convenio')
    return { ok: true }
  })

  // El asesor crea cuentas para Pymes u ONG que acompaña; la cuenta recibe por correo el enlace para crear su contraseña.
  on('POST', '/asesor/cuentas', req => {
    const asesor = auth(req, 'asesor', 'admin')
    const d = parse(z.object({ tipo: z.enum(['pyme', 'ong']), correo: z.string().trim().email('Correo inválido'), nombre_visible: z.string().trim().min(2, 'Ingresa el nombre del contacto').max(80), comuna_id: z.number().int().positive() }), req.body)
    if (!db.comunas.some(c => c.id === d.comuna_id)) return fail(400, 'Comuna no válida')
    const { u, enlace } = nuevaCuenta(d.correo, d.nombre_visible, d.tipo, d.comuna_id)
    const correo = correoCuentaCreada({ nombre: u.nombre_visible, asesor: asesor.nombre_visible, tipo: d.tipo, enlace })
    enviarCorreo(u.correo, correo.asunto, correo.cuerpo, 'cuenta_creada', enlace)
    return { id: u.id, correo: u.correo }
  })

  // ---------- Correos ----------
  on('GET', '/correos/mios', req => { const u = auth(req); return db.correos.filter(c => c.para === u.correo).sort((a, b) => b.enviado_en.localeCompare(a.enviado_en)) })
  on('GET', '/admin/correos', req => { auth(req, 'admin', 'asesor'); return [...db.correos].sort((a, b) => b.enviado_en.localeCompare(a.enviado_en)).slice(0, 100) })

  // ---------- Cobranza (Orcob) ----------
  const cobranza = (p: Pyme) => {
    const pagadas = db.suscripciones.filter(s => s.pyme_id === p.id && s.estado === 'activa').sort((a, b) => b.fin.localeCompare(a.fin))
    const ultima = pagadas[0]
    if (!ultima) return null
    const e = estadoPlan(p.id), plan = planPorId(ultima.plan_id)
    const caso = db.casos_cobranza.find(c => c.pyme_id === p.id && c.estado === 'en_gestion') ?? null
    const pendiente = db.pagos.some(pg => pg.estado === 'pendiente' && db.suscripciones.some(s => s.id === pg.suscripcion_id && s.pyme_id === p.id))
    const estado = caso ? 'derivada' : e.dias_mora === 0 ? 'al_dia' : e.en_gracia ? 'en_gracia' : 'degradada'
    return {
      pyme_id: p.id, nombre_comercial: p.nombre_comercial, rut_empresa: p.rut_empresa, plan: plan.nombre, plan_vigente: e.plan.nombre, fin: ultima.fin, dias_mora: e.dias_mora,
      monto_clp: e.dias_mora ? plan.precio_mensual_clp : 0, estado, pago_pendiente: pendiente, caso,
      derivable: !caso && !pendiente && e.dias_mora > DIAS_DERIVAR_COBRANZA,
    }
  }
  on('GET', '/asesor/cobranza', req => {
    auth(req, 'asesor', 'admin')
    return db.pymes.filter(p => p.estado_verificacion === 'aprobada').flatMap(p => { const c = cobranza(p); return c ? [c] : [] }).sort((a, b) => b.dias_mora - a.dias_mora)
  })
  // Solo se envían a Orcob los datos mínimos del deudor comercial; la Pyme recibe aviso de la derivación.
  on('POST', '/asesor/cobranza/:pymeId/derivar', req => {
    const u = auth(req, 'asesor', 'admin')
    const p = db.pymes.find(x => x.id === req.params.pymeId)
    const c = p && cobranza(p)
    if (!p || !c) return fail(404, 'Pyme sin suscripciones pagadas')
    if (!c.derivable) return fail(422, `Solo se derivan deudas con más de ${DIAS_DERIVAR_COBRANZA} días de mora, sin pagos en revisión ni casos abiertos`)
    const datos = { rut_empresa: p.rut_empresa, razon_social: p.nombre_comercial, correo_contacto: correoDe(p.propietario_id), monto_clp: c.monto_clp, periodo: `plan ${c.plan} vencido el ${c.fin}`, dias_mora: c.dias_mora }
    const r = derivarCobranza(datos)
    const caso = { id: uid(), pyme_id: p.id, id_caso: r.id_caso, monto_clp: c.monto_clp, dias_mora: c.dias_mora, datos_enviados: datos, estado: 'en_gestion' as const, derivado_por: u.id, derivado_en: now(), cerrado_en: null }
    db.casos_cobranza.push(caso)
    enviarCorreo(datos.correo_contacto, 'Aviso de derivación a cobranza', `Hola:\n\nTu suscripción PetSuite (${datos.periodo}) registra ${c.dias_mora} días de mora por ${c.monto_clp.toLocaleString('es-CL')} CLP.\nLa deuda fue derivada a Orcob (Organización de Cobranzas Orcob Ltda.), caso ${r.id_caso}, que podrá contactarte.\nOrcob solo recibió: RUT y nombre de la empresa, correo de contacto, monto, periodo y días de mora.\n\nPuedes regularizar renovando tu plan desde Suscripción.\n\nEquipo PetSuite`, 'cobranza')
    return caso
  })
  on('PATCH', '/asesor/cobranza/casos/:id', req => {
    auth(req, 'asesor', 'admin')
    const d = parse(z.object({ estado: z.enum(['pagado', 'cerrado']) }), req.body)
    const caso = db.casos_cobranza.find(c => c.id === req.params.id && c.estado === 'en_gestion')
    if (!caso) return fail(404, 'Caso no disponible')
    Object.assign(caso, { estado: d.estado, cerrado_en: now() })
    return caso
  })

  // ---------- Privacidad: derechos del titular (Ley 21.719) ----------
  const privacidadDe = (u: Usuario) => ({
    consentimientos: u.consentimientos ?? [], bloqueo_tratamiento: !!u.bloqueo_tratamiento,
    solicitudes: db.solicitudes_privacidad.filter(s => s.usuario_id === u.id).sort((a, b) => b.creado_en.localeCompare(a.creado_en)),
  })
  on('GET', '/privacidad', req => privacidadDe(auth(req)))

  // Acceso y portabilidad: copia estructurada (JSON) de los datos personales de la cuenta, sin claves ni datos de terceros.
  on('GET', '/privacidad/mis-datos', req => {
    const u = auth(req)
    const { clave: _clave, ...cuenta } = u
    const mascotas = db.mascotas.filter(m => m.tutor_id === u.id)
    return {
      generado_en: now(), responsable: 'PetSuite', version_aviso: VERSION_PRIVACIDAD, cuenta,
      mascotas: mascotas.map(m => ({ ...m, medallas: db.medallas.filter(md => md.mascota_id === m.id).map(md => ({ estado: md.estado, emitida_en: md.emitida_en })) })),
      accesos_otorgados: db.accesos.filter(a => a.otorgado_por === u.id).map(a => ({ clinica: db.pymes.find(p => p.id === a.pyme_id)?.nombre_comercial, permiso: a.permiso, vigente_hasta: a.vigente_hasta, revocado_en: a.revocado_en })),
      publicaciones: db.publicaciones.filter(p => p.autor_id === u.id).map(p => ({ tipo: p.tipo, texto: p.texto, creado_en: p.creado_en, estado: p.estado })),
      comentarios: db.comentarios.filter(c => c.autor_id === u.id).map(c => ({ texto: c.texto, creado_en: c.creado_en, estado: c.estado })),
      consultas_a_negocios: db.contactos_pymes.filter(c => c.remitente_id === u.id).map(c => ({ negocio: db.pymes.find(p => p.id === c.pyme_id)?.nombre_comercial, mensaje: c.mensaje, respuesta: c.respuesta, creado_en: c.creado_en })),
      correos_recibidos: db.correos.filter(c => c.para === u.correo).map(c => ({ asunto: c.asunto, enviado_en: c.enviado_en })),
      solicitudes_privacidad: privacidadDe(u).solicitudes,
    }
  })

  // Oposición y retiro del consentimiento: efecto inmediato, sin necesidad de solicitud.
  on('PATCH', '/privacidad/consentimientos', req => {
    const u = auth(req)
    const d = parse(z.object({ comunicaciones: z.boolean().optional(), metricas: z.boolean().optional() }), req.body)
    const lista = u.consentimientos ?? []
    for (const tipo of ['comunicaciones', 'metricas'] as const) {
      if (d[tipo] === undefined) continue
      const actual = lista.find(c => c.tipo === tipo)
      if (actual) Object.assign(actual, { otorgado: d[tipo], version: VERSION_PRIVACIDAD, fecha: now() })
      else lista.push({ tipo, otorgado: d[tipo]!, version: VERSION_PRIVACIDAD, fecha: now() })
    }
    u.consentimientos = lista
    return privacidadDe(u)
  })

  on('POST', '/privacidad/solicitudes', req => {
    const u = auth(req)
    const d = parse(z.object({ derecho: z.enum(['acceso', 'rectificacion', 'supresion', 'oposicion', 'portabilidad', 'bloqueo']), detalle: z.string().trim().min(10, 'Describe tu solicitud en al menos 10 caracteres').max(500) }), req.body)
    if (db.solicitudes_privacidad.some(s => s.usuario_id === u.id && s.derecho === d.derecho && (s.estado === 'recibida' || s.estado === 'en_proceso'))) return fail(409, 'Ya tienes una solicitud abierta de este tipo')
    // Plazo legal de respuesta: 30 días corridos desde la recepción.
    const s: SolicitudPrivacidad = { id: uid(), usuario_id: u.id, derecho: d.derecho, detalle: d.detalle, estado: 'recibida', respuesta: null, creado_en: now(), vence_en: dayOffset(30), respondido_en: null }
    db.solicitudes_privacidad.push(s)
    enviarCorreo(u.correo, 'Recibimos tu solicitud de privacidad', `Hola, ${u.nombre_visible}:\n\nRegistramos tu solicitud de ${d.derecho} (folio ${s.id.slice(0, 8)}). Te responderemos a más tardar el ${s.vence_en}.\n\nEquipo PetSuite`, 'privacidad')
    return s
  })

  on('GET', '/admin/privacidad', req => {
    auth(req, 'admin')
    return [...db.solicitudes_privacidad].sort((a, b) => a.vence_en.localeCompare(b.vence_en)).map(s => {
      const u = db.usuarios.find(x => x.id === s.usuario_id)
      return { ...s, usuario: u?.nombre_visible ?? 'Usuario', correo: u?.correo ?? '', rol: u?.rol ?? 'tutor' }
    })
  })

  // Supresión: anonimiza la cuenta y borra mascotas y medallas; se conservan los pagos por obligación tributaria.
  const anonimizar = (u: Usuario) => {
    const mascotas = new Set(db.mascotas.filter(m => m.tutor_id === u.id).map(m => m.id))
    const medallas = new Set(db.medallas.filter(md => mascotas.has(md.mascota_id)).map(md => md.id))
    db.mensajes = db.mensajes.filter(m => !medallas.has(m.medalla_id))
    db.medallas = db.medallas.filter(md => !mascotas.has(md.mascota_id))
    db.accesos = db.accesos.filter(a => !mascotas.has(a.mascota_id))
    db.mascotas = db.mascotas.filter(m => !mascotas.has(m.id))
    for (const p of db.publicaciones) if (p.autor_id === u.id) p.estado = 'eliminada'
    for (const c of db.comentarios) if (c.autor_id === u.id) c.estado = 'eliminado'
    for (const c of db.contactos_pymes) if (c.remitente_id === u.id) Object.assign(c, { remitente_nombre: 'Usuario eliminado', remitente_contacto: null })
    for (const [token, id] of Object.entries(db.sesiones)) if (id === u.id) delete db.sesiones[token]
    Object.assign(u, { nombre_visible: 'Usuario eliminado', correo: `eliminado-${u.id.slice(0, 8)}@petsuite.invalid`, clave: uid(), estado: 'eliminado', consentimientos: [], suspension: null })
  }
  on('PATCH', '/admin/privacidad/:id', req => {
    auth(req, 'admin')
    const d = parse(z.object({ estado: z.enum(['en_proceso', 'respondida', 'rechazada']), respuesta: z.string().trim().max(1000).optional() })
      .refine(x => x.estado === 'en_proceso' || (x.respuesta ?? '').length >= 10, { message: 'Escribe la respuesta al titular (mínimo 10 caracteres)', path: ['respuesta'] }), req.body)
    const s = db.solicitudes_privacidad.find(x => x.id === req.params.id && (x.estado === 'recibida' || x.estado === 'en_proceso'))
    if (!s) return fail(404, 'Solicitud no disponible')
    const u = db.usuarios.find(x => x.id === s.usuario_id)
    const correo = u?.correo ?? ''
    Object.assign(s, { estado: d.estado, respuesta: d.respuesta ?? null, respondido_en: d.estado === 'en_proceso' ? null : now() })
    if (u && d.estado === 'respondida') {
      if (s.derecho === 'bloqueo') u.bloqueo_tratamiento = true
      if (s.derecho === 'oposicion') for (const c of u.consentimientos ?? []) if (c.tipo === 'comunicaciones' || c.tipo === 'metricas') Object.assign(c, { otorgado: false, fecha: now() })
      if (s.derecho === 'supresion') anonimizar(u)
    }
    if (d.estado !== 'en_proceso') enviarCorreo(correo, `Respuesta a tu solicitud de ${s.derecho}`, `Hola:\n\n${d.respuesta}\n\nSi no estás conforme, puedes reclamar ante la Agencia de Protección de Datos Personales.\n\nEquipo PetSuite`, 'privacidad')
    return s
  })
}
