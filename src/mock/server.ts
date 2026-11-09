// API simulado de PetSuite: mismas rutas, validaciones y reglas que el servidor real (server/src/routes),
// resueltas en el navegador sobre mock/db.ts. Los mensajes de error se mantienen en español.
import { z } from 'zod'
import type { FichaDatos, Session } from '../shared/api'
import { ApiError } from '../shared/errors'
import { db, ficha, now, refresh, save, uid, dayOffset, consentimientosBase, type Animal, type Item, type MascotaRow, type Miembro, type Publicacion, type Pyme, type Usuario } from './db'
import type { Oferta } from '../shared/api'
import { businessContactSchema, businessProfileSchema, businessReplySchema, userSuspensionSchema } from '../shared/validators'
import { DIAS_GRACIA, DIAS_PERIODO, PLANES, PLAN_GRATIS, dentroDelLimite, etiquetasLimite, limiteTexto, planPorId, type Limites, type Plan } from '../modules/plans/plans'
import { PERMISOS_ADMIN, PERMISOS_ASESOR, PERMISOS_DUENO, type ModuloPyme } from '../shared/permissions'
import { crearCobro } from './orcob'
import { avisarAsesores, baseApp, emitirToken, enviarCorreo, registerSuiteRoutes, segundosDesdeEnvio, usarToken } from './suite'
import { avisoSolicitud, correoSolicitudPlan } from '../shared/pagos'
import { CORREO_SIN_CONFIRMAR, SEGUNDOS_ENTRE_ENVIOS, correoRestablecer, correoVerificacion } from '../shared/cuentas'
import { correoAvisoQr } from '../shared/avisos'
import { CONSULTAS_NO_DISPONIBLES, FICHA_PUBLICA_SIN_DUENO } from '../shared/fichas'
import { limitesDe, mensajeDemasiados, STATUS_DEMASIADOS, sumaEvento, type Limite } from '../shared/limites'

z.config(z.locales.es())

type Req = { params: Record<string, string>; query: URLSearchParams; body: unknown; session: Session | null }
type Handler = (req: Req) => unknown

const fail = (status: number, message: string): never => { throw new ApiError(message, status) }

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {})
  if (!r.success) {
    const issue = r.error.issues[0]
    const campo = issue?.path.length ? `${issue.path.join('.')}: ` : ''
    fail(400, issue ? `${campo}${issue.message}` : 'Datos inválidos')
  }
  return (r as { data: z.infer<T> }).data
}

// RBAC: sin token válido 401; cuenta suspendida o rol distinto 403.
function auth(req: Req, ...roles: Usuario['rol'][]): Usuario {
  if (!req.session) return fail(401, 'Sesión requerida')
  const id = db.sesiones[req.session.token]
  const user = id ? db.usuarios.find(u => u.id === id) : undefined
  if (!user) return fail(401, 'Sesión inválida')
  refreshSuspension(user)
  if (user.estado !== 'activo') return fail(403, 'Tu cuenta está suspendida')
  if (roles.length && !roles.includes(user.rol)) return fail(403, 'Sin permiso')
  return user
}

function refreshSuspension(user: Usuario) {
  if (user.estado === 'suspendido' && user.suspension?.tipo === 'temporal' && user.suspension.hasta && user.suspension.hasta <= now()) {
    user.estado = 'activo'
    user.suspension = null
    save()
  }
}

const vigente = (a: { revocado_en: string | null; vigente_hasta: string }) => !a.revocado_en && a.vigente_hasta > now()
// Un negocio verificado siempre aparece en el directorio: sin plan pagado vigente rige el plan Gratis.
const suscripcionActiva = (pymeId: string) => db.pymes.some(p => p.id === pymeId && p.estado_verificacion === 'aprobada')
// Suscripción que rige hoy: la activa ya iniciada; una renovación pendiente o futura no reemplaza a la actual.
const ultimaSuscripcion = (pymeId: string) => {
  const subs = db.suscripciones.filter(s => s.pyme_id === pymeId).sort((a, b) => b.inicio.localeCompare(a.inicio))
  return subs.find(s => s.estado === 'activa' && s.inicio <= dayOffset(0)) ?? subs.find(s => s.estado === 'activa') ?? subs.find(s => s.estado !== 'pendiente' && s.estado !== 'cancelada') ?? subs[0]
}
const pagoPendiente = (pymeId: string) => {
  const ids = new Set(db.suscripciones.filter(s => s.pyme_id === pymeId).map(s => s.id))
  return db.pagos.find(p => ids.has(p.suscripcion_id) && p.estado === 'pendiente')
}
const diasEntre = (desde: string, hasta: string) => Math.round((new Date(`${hasta}T12:00:00Z`).getTime() - new Date(`${desde}T12:00:00Z`).getTime()) / 86_400_000)

// RN-SUS: el plan pagado rige hasta su fin y durante los días de gracia; después la Pyme baja a Gratis
// (no se borra nada: lo que excede el plan Gratis deja de publicarse hasta que renueve).
export function estadoPlan(pymeId: string): { plan: Plan; en_gracia: boolean; dias_mora: number; fin: string | null } {
  const s = ultimaSuscripcion(pymeId)
  if (!s || s.estado !== 'activa' || s.inicio > dayOffset(0)) return { plan: PLAN_GRATIS, en_gracia: false, dias_mora: 0, fin: null }
  const mora = Math.max(0, diasEntre(s.fin, dayOffset(0)))
  if (mora === 0) return { plan: planPorId(s.plan_id), en_gracia: false, dias_mora: 0, fin: s.fin }
  return mora <= DIAS_GRACIA ? { plan: planPorId(s.plan_id), en_gracia: true, dias_mora: mora, fin: s.fin } : { plan: PLAN_GRATIS, en_gracia: false, dias_mora: mora, fin: s.fin }
}
const planDe = (pymeId: string) => estadoPlan(pymeId).plan

export function usoPyme(pymeId: string): Record<keyof Limites, number> {
  return {
    items: db.catalogo.filter(i => i.pyme_id === pymeId).length,
    sucursales: 1 + db.sucursales.filter(s => s.pyme_id === pymeId).length,
    usuarios: db.miembros.filter(m => m.pyme_id === pymeId).length,
    ofertas: db.catalogo.filter(i => i.pyme_id === pymeId && ofertaVigente(i.oferta)).length,
    banners: db.banners.filter(b => b.autor_tipo === 'pyme' && b.autor_id === pymeId && (b.estado === 'pendiente' || b.estado === 'aprobado') && b.hasta >= dayOffset(0)).length,
    convenios: db.convenios.filter(c => c.pyme_id === pymeId && c.estado !== 'rechazado' && c.estado !== 'finalizado').length,
  }
}

// Falla con 422 y una invitación a mejorar el plan cuando crear algo más superaría el límite.
export function exigirCupo(pymeId: string, clave: keyof Limites, extra = 1) {
  const plan = planDe(pymeId), usados = usoPyme(pymeId)[clave] + extra - 1
  if (!dentroDelLimite(usados, plan.limites[clave])) {
    const sig = PLANES.find(p => p.precio_mensual_clp > plan.precio_mensual_clp && dentroDelLimite(usados, p.limites[clave]))
    fail(422, `Tu plan ${plan.nombre} ${plan.limites[clave] === 0 ? 'no incluye' : `permite ${limiteTexto(plan.limites[clave])}`} ${etiquetasLimite[clave].toLowerCase()}.${sig ? ` Con el plan ${sig.nombre} puedes tener más.` : ''}`)
  }
}

// Multitenant: el dueño gestiona todos los módulos de su Pyme; el equipo, solo los que el dueño le asignó.
const membresiasDe = (u: Usuario) => db.miembros.filter(m => m.usuario_id === u.id)
export function permisosEnPyme(u: Usuario, p: Pyme): { permisos: ModuloPyme[]; miembro: Miembro | null } | null {
  if (p.propietario_id === u.id && u.rol === 'pyme') return { permisos: PERMISOS_DUENO, miembro: null }
  const m = db.miembros.find(x => x.pyme_id === p.id && x.usuario_id === u.id)
  return m ? { permisos: m.permisos, miembro: m } : null
}
export function permisosDe(u: Usuario): string[] {
  if (u.rol === 'admin') return PERMISOS_ADMIN
  if (u.rol === 'asesor') return PERMISOS_ASESOR
  if (u.rol === 'pyme') return PERMISOS_DUENO
  if (u.rol === 'jefe_local' || u.rol === 'clinico') return [...new Set(membresiasDe(u).flatMap(m => m.permisos))]
  return []
}
// Veterinarias donde el usuario es personal clínico con el módulo Pacientes.
const clinicasDe = (u: Usuario) => db.pymes.filter(p => permisosEnPyme(u, p)?.permisos.includes('pacientes'))
const comunaNombre = (id: number) => db.comunas.find(c => c.id === id)?.nombre ?? ''
const nombreUsuario = (id: string) => db.usuarios.find(u => u.id === id)?.nombre_visible ?? 'Usuario'
const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString()

function ofertaVigente(o: Oferta | null | undefined) { return !!o && o.desde <= dayOffset(0) && o.hasta >= dayOffset(0) }
// Se publican los primeros ítems hasta el límite del plan (los más antiguos), y solo tantas ofertas como permita.
function itemsPublicos(pymeId: string) {
  const { limites } = planDe(pymeId)
  const items = db.catalogo.filter(i => i.pyme_id === pymeId && i.disponible).sort((a, b) => a.creado_en.localeCompare(b.creado_en)).slice(0, limites.items ?? undefined)
  let ofertas = 0
  return items.map(i => ofertaVigente(i.oferta) && (limites.ofertas === null || ofertas++ < limites.ofertas) ? i : { ...i, oferta: null })
}
// Sucursales visibles según el plan. Sin «perfil por sucursal», cada sucursal muestra la descripción y servicios de la empresa.
function sucursalesPublicas(p: Pyme) {
  const plan = planDe(p.id)
  return db.sucursales.filter(s => s.pyme_id === p.id).sort((a, b) => a.creado_en.localeCompare(b.creado_en)).slice(0, Math.max(0, (plan.limites.sucursales ?? Infinity) - 1)).map(s => ({
    id: s.id, nombre: s.nombre, comuna: comunaNombre(s.comuna_id), direccion: s.direccion, latitud: s.latitud, longitud: s.longitud, telefono: s.telefono, whatsapp: s.whatsapp, horario: s.horario,
    descripcion: plan.beneficios.perfil_sucursal ? s.descripcion : null, servicios: plan.beneficios.perfil_sucursal && s.servicios.length ? s.servicios : p.servicios ?? [],
  }))
}
const cuponesDe = (filtro: (c: { pyme_id: string; ong_id: string }) => boolean) => db.convenios.filter(c => c.estado === 'activo' && c.desde <= dayOffset(0) && c.hasta >= dayOffset(0) && filtro(c)).map(c => ({
  codigo: c.codigo, titulo: c.titulo, descuento_pct: c.descuento_pct, condiciones: c.condiciones, hasta: c.hasta, ong: db.ongs.find(o => o.id === c.ong_id)?.nombre ?? 'ONG', ong_id: c.ong_id,
  negocio: db.pymes.find(p => p.id === c.pyme_id)?.nombre_comercial ?? 'Negocio', pyme_id: c.pyme_id,
}))

const pymeResumen = (p: Pyme) => {
  const plan = planDe(p.id)
  return {
    id: p.id, nombre_comercial: p.nombre_comercial, rubro: p.rubro, descripcion: p.descripcion, comuna_id: p.comuna_id, comuna: comunaNombre(p.comuna_id),
    direccion: p.direccion, latitud: p.latitud, longitud: p.longitud, telefono: p.telefono, whatsapp: p.whatsapp, horario: p.horario,
    foto_portada: plan.beneficios.portada ? p.foto_portada ?? null : null,
    servicios: p.servicios ?? [], ofertas: itemsPublicos(p.id).filter(i => ofertaVigente(i.oferta)).length, destacado: plan.beneficios.destacado,
    sucursales: sucursalesPublicas(p), cupones: cuponesDe(c => c.pyme_id === p.id), sin_reclamar: p.origen === 'publica',
  }
}
// En Explorar: negocios validados y fichas con información pública (sin dueño, en gris y sin sello).
const enVitrina = (p: Pyme) => p.estado_verificacion === 'aprobada' || p.origen === 'publica'

// ---------- Esquemas ----------
// Autoría de los registros clínicos: se conserva al guardar la ficha completa.
const meta = { registrado_por: z.string().optional(), clinica: z.string().max(100).optional(), anulado: z.object({ motivo: z.string().max(200), en: z.string() }).optional() }
const fichaSchema = z.object({
  condiciones: z.array(z.string().max(80)).max(8).default([]),
  medicamentos: z.array(z.string().max(80)).max(8).default([]),
  notaEmergencia: z.string().max(160).default(''),
  vacunas: z.array(z.object({ id: z.string().optional(), nombre: z.string().max(80), fecha: z.string().max(10), proxima: z.string().max(10).optional(), notas: z.string().max(500).optional(), ...meta })).max(100).default([]),
  alergias: z.array(z.object({ agente: z.string().max(80), reaccion: z.string().max(120).optional(), gravedad: z.enum(['leve', 'moderada', 'grave']).optional() })).max(50).default([]),
  tratamientos: z.array(z.object({ id: z.string().optional(), descripcion: z.string().max(200), inicio: z.string().max(10).optional(), fin: z.string().max(10).optional(), notas: z.string().max(500).optional(), ...meta })).max(100).default([]),
  atenciones: z.array(z.object({ id: z.string().optional(), fecha: z.string().max(10), motivo: z.string().max(200), notas: z.string().max(500).optional(), ...meta })).max(200).default([]),
  alertasCriticas: z.array(z.string().max(200)).max(20).default([]),
})

const mascotaSchema = z.object({
  nombre: z.string().trim().min(1, 'Ingresa el nombre').max(60),
  especie: z.string().trim().min(1).max(20),
  raza: z.string().trim().max(60).optional(),
  sexo: z.enum(['macho', 'hembra', 'desconocido']).optional(),
  fecha_nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida').optional(),
})

const sinEnlaces = (t: string) => !/https?|www\./i.test(t)
const QR_TOKEN = /^[A-Za-z0-9_-]{16,32}$/

// ---------- Rutas ----------
const routes: [string, string, Handler][] = []
const on = (method: string, path: string, h: Handler) => routes.push([method, path, h])

// Autenticación y catálogos
const sesionNueva = (u: Usuario) => {
  const token = uid()
  db.sesiones[token] = u.id
  return { token, usuario: { id: u.id, rol: u.rol, nombre_visible: u.nombre_visible, comuna_id: u.comuna_id, permisos: permisosDe(u) } }
}

on('POST', '/auth/login', req => {
  const d = parse(z.object({ correo: z.string().trim().email('Correo inválido'), clave: z.string().min(1, 'Ingresa tu contraseña') }), req.body)
  const u = db.usuarios.find(x => x.correo === d.correo.toLowerCase())
  if (!u || u.clave !== d.clave) return fail(401, 'Credenciales incorrectas')
  // Solo con la clave correcta se informa que falta confirmar el correo.
  if (!u.correo_verificado_en) return fail(403, CORREO_SIN_CONFIRMAR)
  refreshSuspension(u)
  if (u.estado !== 'activo') return fail(403, 'Tu cuenta está suspendida')
  return sesionNueva(u)
})

// Ley 21.719: el consentimiento para tratar datos es explícito y separado de los términos; las comunicaciones comerciales son opcionales.
on('POST', '/auth/registro', req => {
  const d = parse(z.object({
    correo: z.string().trim().email('Correo inválido').max(254),
    clave: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(72),
    nombre_visible: z.string().trim().min(2, 'Ingresa tu nombre').max(80),
    comuna_id: z.number().int().positive(),
    rol: z.enum(['tutor', 'pyme', 'ong']).default('tutor'),
    acepta_terminos: z.literal(true, { message: 'Debes aceptar los términos de uso' }),
    acepta_privacidad: z.literal(true, { message: 'Debes autorizar el tratamiento de tus datos según el aviso de privacidad' }),
    acepta_comunicaciones: z.boolean().default(false),
  }), req.body)
  const correo = d.correo.toLowerCase()
  if (db.usuarios.some(u => u.correo === correo)) return fail(409, 'Ese correo ya está registrado')
  if (!db.comunas.some(c => c.id === d.comuna_id)) return fail(400, 'Comuna no válida')
  const u: Usuario = { id: uid(), correo, clave: d.clave, rol: d.rol, nombre_visible: d.nombre_visible, comuna_id: d.comuna_id, estado: 'activo', consentimientos: consentimientosBase(d.acepta_comunicaciones), creado_en: now(), correo_verificado_en: null }
  db.usuarios.push(u)
  // La cuenta queda pendiente: no hay sesión hasta que la persona abre el enlace enviado a su correo.
  const enlace = emitirToken(u.id, 'verificacion')
  const c = correoVerificacion(u.nombre_visible, u.rol, enlace)
  enviarCorreo(correo, c.asunto, c.cuerpo, 'verificacion', enlace)
  return { verificacion_pendiente: true, correo }
})

const correoSchema = z.object({ correo: z.string().trim().email('Correo inválido').max(254) })
const tokenSchema = z.string().max(200)

// Confirma el correo con el enlace y deja la sesión iniciada.
on('POST', '/auth/verificar', req => {
  const d = parse(z.object({ token: tokenSchema }), req.body)
  const u = usarToken(d.token, ['verificacion'], fail)
  u.correo_verificado_en ??= now()
  refreshSuspension(u)
  if (u.estado !== 'activo') return fail(403, 'Tu cuenta está suspendida')
  return sesionNueva(u)
})

// Reenvío y recuperación responden lo mismo exista o no la cuenta, para no revelar qué correos están registrados.
on('POST', '/auth/reenviar-verificacion', req => {
  const d = parse(correoSchema, req.body)
  const u = db.usuarios.find(x => x.correo === d.correo.toLowerCase())
  if (u && !u.correo_verificado_en && u.estado === 'activo' && segundosDesdeEnvio(u.id, 'verificacion') >= SEGUNDOS_ENTRE_ENVIOS) {
    const enlace = emitirToken(u.id, 'verificacion')
    const c = correoVerificacion(u.nombre_visible, u.rol, enlace)
    enviarCorreo(u.correo, c.asunto, c.cuerpo, 'verificacion', enlace)
  }
  return { ok: true }
})

on('POST', '/auth/recuperar', req => {
  const d = parse(correoSchema, req.body)
  const u = db.usuarios.find(x => x.correo === d.correo.toLowerCase())
  if (u && u.estado !== 'eliminado' && segundosDesdeEnvio(u.id, 'restablecer') >= SEGUNDOS_ENTRE_ENVIOS) {
    const enlace = emitirToken(u.id, 'restablecer')
    const c = correoRestablecer(u.nombre_visible, enlace)
    enviarCorreo(u.correo, c.asunto, c.cuerpo, 'restablecer', enlace)
  }
  return { ok: true }
})

// Contraseña nueva con un enlace de recuperación o de invitación: confirma el correo y cierra las sesiones abiertas.
on('POST', '/auth/restablecer', req => {
  const d = parse(z.object({ token: tokenSchema, clave: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(72) }), req.body)
  const u = usarToken(d.token, ['restablecer', 'invitacion'], fail)
  u.clave = d.clave
  u.correo_verificado_en ??= now()
  for (const [token, id] of Object.entries(db.sesiones)) if (id === u.id) delete db.sesiones[token]
  return { ok: true }
})

on('GET', '/auth/yo', req => { const u = auth(req); return { id: u.id, rol: u.rol, nombre_visible: u.nombre_visible, correo: u.correo, comuna_id: u.comuna_id, permisos: permisosDe(u) } })
on('GET', '/comunas', () => [...db.comunas].sort((a, b) => a.nombre.localeCompare(b.nombre)))
on('GET', '/planes', () => PLANES)

// Tutor: mascotas y Ficha Única
const tokenActivo = (mascotaId: string) => db.medallas.find(m => m.mascota_id === mascotaId && m.estado === 'activa')?.token ?? null

function propia(req: Req): [Usuario, MascotaRow] {
  const u = auth(req, 'tutor')
  const m = db.mascotas.find(x => x.id === req.params.id)
  if (!m) return fail(404, 'Mascota no encontrada')
  if (m.tutor_id !== u.id) return fail(403, 'Sin permiso')
  return [u, m]
}

on('GET', '/mascotas', req => {
  const u = auth(req, 'tutor')
  return db.mascotas.filter(m => m.tutor_id === u.id).map(m => ({ ...m, token_activo: tokenActivo(m.id) }))
})

on('GET', '/mascotas/accesibles', req => {
  const u = auth(req, 'clinico')
  const mias = new Set(clinicasDe(u).map(p => p.id))
  return db.accesos.filter(a => mias.has(a.pyme_id) && vigente(a)).flatMap(a => {
    const m = db.mascotas.find(x => x.id === a.mascota_id)
    return m ? [{ id: m.id, nombre: m.nombre, especie: m.especie, raza: m.raza, foto_url: m.foto_url, tutor: nombreUsuario(m.tutor_id), permiso: a.permiso, vigente_hasta: a.vigente_hasta, alertas: m.datos_clinicos.alertasCriticas }] : []
  }).sort((a, b) => a.nombre.localeCompare(b.nombre))
})

on('POST', '/mascotas', req => {
  const u = auth(req, 'tutor')
  const d = parse(mascotaSchema, req.body)
  const m: MascotaRow = { id: uid(), tutor_id: u.id, nombre: d.nombre, especie: d.especie, raza: d.raza || null, sexo: d.sexo ?? null, fecha_nacimiento: d.fecha_nacimiento ?? null, foto_url: null, datos_clinicos: ficha(), ficha_version: 1, creado_en: now() }
  db.mascotas.push(m)
  return { id: m.id }
})

on('PATCH', '/mascotas/:id', req => {
  const [, m] = propia(req)
  const d = parse(mascotaSchema.partial(), req.body)
  Object.assign(m, { nombre: d.nombre ?? m.nombre, especie: d.especie ?? m.especie, raza: d.raza ?? m.raza, sexo: d.sexo ?? m.sexo, fecha_nacimiento: d.fecha_nacimiento ?? m.fecha_nacimiento })
  return { id: m.id }
})

// Tutor dueño, o clínica con acceso vigente.
function accesoFicha(req: Req): [Usuario, MascotaRow, 'lectura' | 'escritura'] {
  const u = auth(req, 'tutor', 'clinico')
  const m = db.mascotas.find(x => x.id === req.params.id)
  if (!m) return fail(404, 'Mascota no encontrada')
  if (u.rol === 'tutor' && m.tutor_id === u.id) return [u, m, 'escritura']
  if (u.rol === 'clinico') {
    const mias = new Set(clinicasDe(u).map(p => p.id))
    const a = db.accesos.filter(x => x.mascota_id === m.id && mias.has(x.pyme_id) && vigente(x)).sort((x, y) => y.vigente_hasta.localeCompare(x.vigente_hasta))
    if (a.some(x => x.permiso === 'escritura')) return [u, m, 'escritura']
    if (a[0]) return [u, m, 'lectura']
  }
  return fail(403, 'Sin acceso a esta ficha')
}

on('GET', '/mascotas/:id/ficha', req => { const [, m] = accesoFicha(req); return { id: m.id, datos_clinicos: m.datos_clinicos, version: m.ficha_version } })

// Control de concurrencia por versión: si otra persona guardó antes, 409.
on('PUT', '/mascotas/:id/ficha', req => {
  const [, m, permiso] = accesoFicha(req)
  if (permiso !== 'escritura') return fail(403, 'Acceso de solo lectura')
  const d = parse(z.object({ version: z.number().int().positive(), datos_clinicos: fichaSchema }), req.body)
  if (d.version !== m.ficha_version) return fail(409, 'La ficha fue modificada por otra persona. Recarga e inténtalo de nuevo')
  protegerRegistrosClinicos(m.datos_clinicos, d.datos_clinicos)
  m.datos_clinicos = d.datos_clinicos
  m.ficha_version += 1
  return { id: m.id, datos_clinicos: m.datos_clinicos, version: m.ficha_version }
})

// ---------- Registros clínicos con autoría ----------
type Registro = { id?: string; fecha?: string; inicio?: string; nombre?: string; motivo?: string; descripcion?: string; notas?: string; proxima?: string; registrado_por?: string; clinica?: string; anulado?: { motivo: string; en: string } }
const registrosDe = (f: FichaDatos): Registro[] => [...f.vacunas, ...f.atenciones, ...f.tratamientos]

// Los registros de una clínica solo los cambia esa clínica: el tutor no puede editarlos, borrarlos ni firmar como clínica.
// Comparación sin depender del orden de las claves ni de campos vacíos.
const canonico = (r: Registro | undefined) => r ? JSON.stringify(Object.entries(r).filter(([, v]) => v !== undefined && v !== '').sort(([a], [b]) => a.localeCompare(b))) : ''

function protegerRegistrosClinicos(prev: FichaDatos, next: FichaDatos) {
  const antes = new Map(registrosDe(prev).filter(r => r.registrado_por && r.id).map(r => [r.id!, canonico(r)]))
  const despues = new Map(registrosDe(next).filter(r => r.id).map(r => [r.id!, r]))
  for (const [id, json] of antes) if (canonico(despues.get(id)) !== json) fail(403, 'Los registros hechos por una clínica no se pueden modificar desde la cuenta del tutor')
  for (const r of registrosDe(next)) if (r.registrado_por && !antes.has(r.id ?? '')) { delete r.registrado_por; delete r.clinica; delete r.anulado }
}

function clinicaConEscritura(req: Req): [MascotaRow, Pyme] {
  const [u, m, permiso] = accesoFicha(req)
  if (u.rol !== 'clinico' || permiso !== 'escritura') return fail(403, 'Necesitas acceso de registro a esta ficha')
  const mias = clinicasDe(u)
  const acceso = db.accesos.find(a => a.mascota_id === m.id && a.permiso === 'escritura' && vigente(a) && mias.some(p => p.id === a.pyme_id))
  return [m, mias.find(p => p.id === acceso?.pyme_id)!]
}

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida')
const registroSchema = z.object({
  version: z.number().int().positive(),
  tipo: z.enum(['atencion', 'vacuna', 'tratamiento']),
  fecha,
  titulo: z.string().trim().min(3, 'Describe el registro').max(200),
  notas: z.string().trim().max(500).optional(),
  proxima: fecha.optional(),
})

function versionOk(m: MascotaRow, version: number) {
  if (version !== m.ficha_version) fail(409, 'La ficha fue modificada por otra persona. Recarga e inténtalo de nuevo')
}

on('POST', '/mascotas/:id/registros', req => {
  const [m, clinica] = clinicaConEscritura(req)
  const d = parse(registroSchema, req.body)
  versionOk(m, d.version)
  const firma = { id: uid(), registrado_por: clinica.id, clinica: clinica.nombre_comercial, ...(d.notas ? { notas: d.notas } : {}) }
  const f = m.datos_clinicos
  if (d.tipo === 'vacuna') f.vacunas.push({ ...firma, nombre: d.titulo, fecha: d.fecha, ...(d.proxima ? { proxima: d.proxima } : {}) })
  else if (d.tipo === 'tratamiento') f.tratamientos.push({ ...firma, descripcion: d.titulo, inicio: d.fecha })
  else f.atenciones.push({ ...firma, motivo: d.titulo, fecha: d.fecha })
  m.ficha_version += 1
  return { id: m.id, datos_clinicos: m.datos_clinicos, version: m.ficha_version }
})

function registroPropio(m: MascotaRow, clinica: Pyme, rid: string) {
  const r = registrosDe(m.datos_clinicos).find(x => x.id === rid)
  if (!r) return fail(404, 'Registro no encontrado')
  if (r.registrado_por !== clinica.id) return fail(403, 'Solo puedes cambiar los registros de tu clínica')
  if (r.anulado) return fail(422, 'El registro está anulado')
  return r
}

on('PATCH', '/mascotas/:id/registros/:rid', req => {
  const [m, clinica] = clinicaConEscritura(req)
  const d = parse(registroSchema.omit({ tipo: true }), req.body)
  versionOk(m, d.version)
  const r = registroPropio(m, clinica, req.params.rid)
  if ('nombre' in r) { r.nombre = d.titulo; r.fecha = d.fecha; if (d.proxima) r.proxima = d.proxima; else delete r.proxima }
  else if ('descripcion' in r) { r.descripcion = d.titulo; r.inicio = d.fecha }
  else { r.motivo = d.titulo; r.fecha = d.fecha }
  if (d.notas) r.notas = d.notas; else delete r.notas
  m.ficha_version += 1
  return { id: m.id, datos_clinicos: m.datos_clinicos, version: m.ficha_version }
})

// Anular no borra: el registro queda tachado con el motivo, para que el historial sea trazable.
on('POST', '/mascotas/:id/registros/:rid/anular', req => {
  const [m, clinica] = clinicaConEscritura(req)
  const d = parse(z.object({ version: z.number().int().positive(), motivo: z.string().trim().min(5, 'Indica el motivo de la anulación (mínimo 5 caracteres)').max(200) }), req.body)
  versionOk(m, d.version)
  const r = registroPropio(m, clinica, req.params.rid)
  r.anulado = { motivo: d.motivo, en: now() }
  m.ficha_version += 1
  return { id: m.id, datos_clinicos: m.datos_clinicos, version: m.ficha_version }
})

on('POST', '/mascotas/:id/medallas', req => {
  const [, m] = propia(req)
  let reemplazo = false
  for (const md of db.medallas) if (md.mascota_id === m.id && md.estado === 'activa') { md.estado = 'reemplazada'; reemplazo = true }
  const nueva = { id: uid(), mascota_id: m.id, token: uid().replace(/-/g, ''), estado: 'activa' as const, emitida_en: now() }
  db.medallas.push(nueva)
  return { id: nueva.id, token_publico: nueva.token, estado: nueva.estado, emitida_en: nueva.emitida_en, reemplazo }
})

on('DELETE', '/mascotas/:id/medallas/activa', req => {
  const [, m] = propia(req)
  let desactivadas = 0
  for (const md of db.medallas) if (md.mascota_id === m.id && md.estado === 'activa') { md.estado = 'inactiva'; desactivadas++ }
  return { desactivadas }
})

on('GET', '/mascotas/:id/accesos', req => {
  const [, m] = propia(req)
  return db.accesos.filter(a => a.mascota_id === m.id && vigente(a)).sort((a, b) => a.vigente_hasta.localeCompare(b.vigente_hasta))
    .map(a => ({ id: a.id, permiso: a.permiso, vigente_hasta: a.vigente_hasta, clinica: db.pymes.find(p => p.id === a.pyme_id)?.nombre_comercial ?? 'Clínica' }))
})

on('POST', '/mascotas/:id/accesos', req => {
  const [u, m] = propia(req)
  const d = parse(z.object({ pyme_id: z.string().min(1, 'Elige una veterinaria'), permiso: z.enum(['lectura', 'escritura']), dias: z.number().int().min(1).max(30, 'El acceso dura como máximo 30 días') }), req.body)
  const p = db.pymes.find(x => x.id === d.pyme_id && x.rubro === 'veterinaria' && x.estado_verificacion === 'aprobada')
  if (!p) return fail(400, 'Solo se puede compartir con una veterinaria verificada')
  const a = { id: uid(), mascota_id: m.id, pyme_id: p.id, otorgado_por: u.id, permiso: d.permiso, vigente_hasta: new Date(Date.now() + d.dias * 86_400_000).toISOString(), revocado_en: null }
  db.accesos.push(a)
  return { id: a.id, permiso: a.permiso, vigente_hasta: a.vigente_hasta }
})

on('DELETE', '/mascotas/:id/accesos/:accesoId', req => {
  const [, m] = propia(req)
  const a = db.accesos.find(x => x.id === req.params.accesoId && x.mascota_id === m.id && !x.revocado_en)
  if (a) a.revocado_en = now()
  return { revocados: a ? 1 : 0 }
})

on('GET', '/mascotas/:id/mensajes', req => {
  const [, m] = propia(req)
  const medallas = new Set(db.medallas.filter(md => md.mascota_id === m.id).map(md => md.id))
  return db.mensajes.filter(x => medallas.has(x.medalla_id)).sort((a, b) => b.enviado_en.localeCompare(a.enviado_en))
    .map(({ medalla_id: _, ...x }) => x)
})

on('PATCH', '/mascotas/mensajes/:id', req => {
  const u = auth(req, 'tutor')
  const d = parse(z.object({ estado: z.enum(['leido', 'respondido']) }), req.body)
  const msg = db.mensajes.find(x => x.id === req.params.id)
  const md = msg && db.medallas.find(x => x.id === msg.medalla_id)
  const m = md && db.mascotas.find(x => x.id === md.mascota_id)
  if (!msg || !m || m.tutor_id !== u.id) return fail(403, 'Sin permiso')
  msg.estado = d.estado
  return { ok: true }
})

// QR público (sin sesión). LISTA BLANCA: nunca medicamentos, historial, datos del tutor ni ids internos.
function medallaActiva(token: string) {
  if (!QR_TOKEN.test(token)) return fail(404, 'Medalla no válida')
  const md = db.medallas.find(x => x.token === token)
  const m = md && db.mascotas.find(x => x.id === md.mascota_id)
  if (!md || !m) return fail(404, 'Medalla no válida')
  // Reemplazada o desactivada por el tutor: 410 para que quien la escanea sepa qué pasó, sin datos de la mascota.
  if (md.estado !== 'activa') return fail(410, 'Medalla desactivada')
  return { md, m }
}

on('GET', '/qr/:token', req => {
  const { md, m } = medallaActiva(req.params.token)
  db.escaneos.push({ id: uid(), medalla_id: md.id, ocurrido_en: now() })
  const c = m.datos_clinicos
  return {
    nombre: m.nombre, especie: m.especie, raza: m.raza, foto_url: m.foto_url,
    alergias: c.alergias.map(a => ({ agente: a.agente, gravedad: a.gravedad })),
    alertasCriticas: c.alertasCriticas, condiciones: c.condiciones, notaEmergencia: c.notaEmergencia,
  }
})

on('POST', '/qr/:token/mensajes', req => {
  const { md, m } = medallaActiva(req.params.token)
  const d = parse(z.object({
    mensaje: z.string().trim().min(10, 'El mensaje debe tener al menos 10 caracteres').max(500, 'El mensaje admite hasta 500 caracteres'),
    nombre: z.string().trim().max(80).optional(),
    contacto: z.string().trim().max(120).optional(),
    latitud: z.number().min(-90).max(90).optional(),
    longitud: z.number().min(-180).max(180).optional(),
  }), req.body)
  db.mensajes.push({ id: uid(), medalla_id: md.id, remitente_nombre: d.nombre || null, remitente_contacto: d.contacto || null, mensaje: d.mensaje, latitud: d.latitud != null ? String(d.latitud) : null, longitud: d.longitud != null ? String(d.longitud) : null, estado: 'nuevo', enviado_en: now() })
  // Aviso al tutor por correo (en la demo, a la bandeja simulada).
  const tutor = db.usuarios.find(u => u.id === m.tutor_id && u.estado === 'activo')
  if (tutor) {
    const c = correoAvisoQr(tutor.nombre_visible, m.nombre, d, baseApp())
    enviarCorreo(tutor.correo, c.asunto, c.cuerpo, 'aviso_qr', c.detalles)
  }
  return { ok: true }
})

// Directorio y Pymes
// La comuna coincide con la casa matriz o con cualquier sucursal visible. Oro primero, luego Plata, luego el resto.
on('GET', '/pymes', req => {
  const comuna = req.query.get('comuna'), rubro = req.query.get('rubro')
  return db.pymes.filter(p => enVitrina(p) && (!rubro || p.rubro === rubro)).map(pymeResumen)
    .filter(r => !comuna || r.comuna === comuna || r.sucursales.some(s => s.comuna === comuna))
    .sort((a, b) => b.destacado - a.destacado || a.nombre_comercial.localeCompare(b.nombre_comercial))
})

on('GET', '/pymes/mias', req => {
  const u = auth(req, 'pyme', 'jefe_local', 'clinico')
  return db.pymes.flatMap(p => {
    const acceso = permisosEnPyme(u, p)
    if (!acceso) return []
    const s = ultimaSuscripcion(p.id), estado = estadoPlan(p.id), pagado = s && s.estado !== 'pendiente' && s.estado !== 'cancelada' ? planPorId(s.plan_id) : null
    const sucursal = acceso.miembro?.sucursal_id ? db.sucursales.find(x => x.id === acceso.miembro!.sucursal_id) : null
    return [{
      id: p.id, nombre_comercial: p.nombre_comercial, rubro: p.rubro, estado_verificacion: p.estado_verificacion, comuna_id: p.comuna_id, solicitud_pendiente: !!pagoPendiente(p.id),
      rol_interno: acceso.miembro?.rol ?? 'dueno', sucursal: sucursal ? { id: sucursal.id, nombre: sucursal.nombre } : null, permisos: acceso.permisos,
      plan: estado.plan, en_gracia: estado.en_gracia, dias_mora: estado.dias_mora, uso: usoPyme(p.id),
      suscripcion: s && pagado ? { estado: s.estado, fin: s.fin, plan: pagado.nombre, plan_id: pagado.id, precio: pagado.precio_mensual_clp, max_items: estado.plan.limites.items } : null,
    }]
  })
})

on('POST', '/pymes', req => {
  const u = auth(req, 'pyme')
  const d = parse(z.object({
    nombre_comercial: z.string().trim().min(2, 'Ingresa el nombre comercial').max(100),
    rut_empresa: z.string().trim().regex(/^\d{7,8}-[\dkK]$/, 'RUT de empresa inválido (ej. 76123456-7)'),
    rubro: z.enum(['veterinaria', 'tienda', 'peluqueria', 'otro']),
    descripcion: z.string().max(1000).optional(),
    comuna_id: z.number().int().positive(),
    direccion: z.string().max(200).optional(),
    latitud: z.number().min(-90).max(90).optional(),
    longitud: z.number().min(-180).max(180).optional(),
    telefono: z.string().max(20).optional(),
    whatsapp: z.string().max(20).optional(),
    plan_id: z.number().int().positive().default(PLAN_GRATIS.id),
    canal_pago: z.enum(['transferencia', 'orcob']).default('transferencia'),
    referencia_pago: z.string().max(60).optional(),
  }), req.body)
  if (db.pymes.some(p => p.rut_empresa.toLowerCase() === d.rut_empresa.toLowerCase())) return fail(409, 'Ese RUT de empresa ya está registrado')
  const plan = PLANES.find(p => p.id === d.plan_id)
  if (!plan) return fail(400, 'Plan no disponible')
  if (!db.comunas.some(c => c.id === d.comuna_id)) return fail(400, 'Comuna no válida')
  const p: Pyme = {
    id: uid(), propietario_id: u.id, nombre_comercial: d.nombre_comercial, rut_empresa: d.rut_empresa, rubro: d.rubro, descripcion: d.descripcion ?? null, comuna_id: d.comuna_id,
    direccion: d.direccion ?? null, latitud: d.latitud != null ? String(d.latitud) : null, longitud: d.longitud != null ? String(d.longitud) : null,
    telefono: d.telefono ?? null, whatsapp: d.whatsapp ?? null, horario: {}, servicios: [], estado_verificacion: 'pendiente', origen: 'registro', fuente: null, creado_en: now(),
  }
  db.pymes.push(p)
  // Gratis no genera cobro: la Pyme queda en plan Gratis al aprobarse. Un plan pagado espera la verificación del pago.
  // En la demo Orcob está simulado; el API real lo rechaza (src/shared/pagos.ts).
  const cobro = plan.precio_mensual_clp > 0 ? registrarPago(p, plan, dayOffset(0), d.canal_pago, d.referencia_pago || null) : null
  // El equipo revisa la solicitud; la Pyme recibe cómo pagar si eligió un plan por transferencia.
  const aviso = avisoSolicitud('alta', p.nombre_comercial, p.rut_empresa, comunaNombre(p.comuna_id), plan.nombre, plan.precio_mensual_clp, d.canal_pago, cobro?.canal === 'transferencia' ? cobro.referencia : null)
  avisarAsesores(aviso.asunto, aviso.cuerpo)
  if (cobro?.canal === 'transferencia') {
    const c = correoSolicitudPlan(p.nombre_comercial, plan.nombre, plan.precio_mensual_clp, !!cobro.referencia)
    enviarCorreo(u.correo, c.asunto, c.cuerpo, 'cobranza')
  }
  return { id: p.id, estado_verificacion: p.estado_verificacion, codigo_orcob: cobro?.codigo_orcob ?? null }
})

// Crea el periodo pendiente y su pago. Por Orcob se emite un código de recaudación; por transferencia se registra la referencia.
function registrarPago(p: Pyme, plan: Plan, inicio: string, canal: 'transferencia' | 'orcob', referencia: string | null) {
  const fin = new Date(`${inicio}T12:00:00Z`); fin.setUTCDate(fin.getUTCDate() + DIAS_PERIODO)
  const s = { id: uid(), pyme_id: p.id, plan_id: plan.id, inicio, fin: fin.toISOString().slice(0, 10), estado: 'pendiente' as const }
  db.suscripciones.push(s)
  const orcob = canal === 'orcob' ? crearCobro({ rut_empresa: p.rut_empresa, monto_clp: plan.precio_mensual_clp, glosa: `PetSuite plan ${plan.nombre} ${s.inicio}` }) : null
  const pago = { id: uid(), suscripcion_id: s.id, monto_clp: plan.precio_mensual_clp, canal, referencia: orcob ? orcob.id_cobro : referencia, codigo_orcob: orcob?.codigo_pago ?? null, estado: 'pendiente' as const, pagado_en: now() }
  db.pagos.push(pago)
  return { suscripcion: s, ...pago }
}

on('GET', '/pymes/:id', req => {
  const p = db.pymes.find(x => x.id === req.params.id && enVitrina(x))
  if (!p) return fail(404, 'No encontrada')
  db.eventos.push({ id: uid(), pyme_id: p.id, item_id: null, tipo: 'visita_perfil', ocurrido_en: now() })
  // Las ofertas se muestran solo mientras están vigentes (y dentro del cupo del plan), y primero.
  const catalogo = itemsPublicos(p.id)
    .map(i => ({ id: i.id, tipo: i.tipo, nombre: i.nombre, descripcion: i.descripcion, precio_referencial_clp: i.precio_referencial_clp, categoria: i.categoria, sin_stock: i.sin_stock, oferta: ofertaVigente(i.oferta) ? i.oferta : null }))
    .sort((a, b) => Number(!!b.oferta) - Number(!!a.oferta) || (a.categoria ?? '').localeCompare(b.categoria ?? '') || a.nombre.localeCompare(b.nombre))
  return { ...pymeResumen(p), catalogo }
})

on('POST', '/pymes/:id/eventos', req => {
  const d = parse(z.object({ tipo: z.enum(['vista_item', 'clic_contacto', 'clic_whatsapp']), item_id: z.string().optional() }), req.body)
  if (db.pymes.some(p => p.id === req.params.id && enVitrina(p))) db.eventos.push({ id: uid(), pyme_id: req.params.id, item_id: d.item_id ?? null, tipo: d.tipo, ocurrido_en: now() })
  return { ok: true }
})

// RBAC por módulo dentro del tenant: 403 si la cuenta no pertenece a la Pyme o no tiene ese módulo.
function miPyme(req: Req, modulo: ModuloPyme): Pyme {
  const u = auth(req, 'pyme', 'jefe_local', 'clinico')
  const p = db.pymes.find(x => x.id === req.params.id)
  if (!p) return fail(404, 'Pyme no encontrada')
  if (!permisosEnPyme(u, p)?.permisos.includes(modulo)) return fail(403, 'Sin permiso')
  return p
}

on('GET', '/pymes/:id/perfil', req => {
  const p = miPyme(req, 'perfil')
  return { ...pymeResumen(p), foto_portada: p.foto_portada ?? null, rut_empresa: p.rut_empresa, estado_verificacion: p.estado_verificacion }
})

on('PATCH', '/pymes/:id/perfil', req => {
  const p = miPyme(req, 'perfil')
  const d = parse(businessProfileSchema, req.body)
  if (!db.comunas.some(c => c.id === d.comuna_id)) return fail(400, 'Comuna no válida')
  if (d.foto_portada && d.foto_portada !== p.foto_portada && !planDe(p.id).beneficios.portada) return fail(422, 'La portada propia está disponible desde el plan Bronce')
  Object.assign(p, {
    nombre_comercial: d.nombre_comercial, descripcion: d.descripcion || null, comuna_id: d.comuna_id,
    direccion: d.direccion || null, telefono: d.telefono || null, whatsapp: d.whatsapp || null,
    latitud: d.latitud === null ? null : String(d.latitud), longitud: d.longitud === null ? null : String(d.longitud),
    // Los días vacíos se omiten: el directorio los muestra como cerrados.
    horario: Object.fromEntries(Object.entries(d.horario).filter(([, h]) => h)), servicios: [...new Set(d.servicios)], foto_portada: d.foto_portada,
  })
  return { ...pymeResumen(p), foto_portada: p.foto_portada ?? null, rut_empresa: p.rut_empresa, estado_verificacion: p.estado_verificacion }
})

on('POST', '/pymes/:id/contactos', req => {
  const u = auth(req, 'tutor')
  // Una ficha pública no tiene a nadie del local que lea la consulta.
  if (db.pymes.some(x => x.id === req.params.id && x.origen === 'publica')) return fail(422, CONSULTAS_NO_DISPONIBLES)
  const p = db.pymes.find(x => x.id === req.params.id && x.estado_verificacion === 'aprobada' && suscripcionActiva(x.id))
  if (!p) return fail(404, 'Negocio no disponible')
  const d = parse(businessContactSchema, req.body)
  const contact = { id: uid(), pyme_id: p.id, remitente_id: u.id, remitente_nombre: u.nombre_visible, remitente_contacto: d.contacto || null, mensaje: d.mensaje, estado: 'nuevo' as const, respuesta: null, creado_en: now(), respondido_en: null }
  db.contactos_pymes.push(contact)
  return { id: contact.id }
})

on('GET', '/pymes/:id/contactos', req => {
  const p = miPyme(req, 'contactos')
  return db.contactos_pymes.filter(c => c.pyme_id === p.id).sort((a, b) => b.creado_en.localeCompare(a.creado_en))
})

on('PATCH', '/pymes/:id/contactos/:contactId', req => {
  const p = miPyme(req, 'contactos')
  const contact = db.contactos_pymes.find(c => c.id === req.params.contactId && c.pyme_id === p.id)
  if (!contact) return fail(404, 'Contacto no encontrado')
  const d = parse(z.discriminatedUnion('estado', [
    z.object({ estado: z.literal('leido') }),
    z.object({ estado: z.literal('respondido'), respuesta: businessReplySchema.shape.respuesta }),
  ]), req.body)
  if (d.estado === 'leido') {
    if (contact.estado !== 'nuevo') return fail(409, 'Este mensaje ya fue revisado')
    contact.estado = 'leido'
  } else {
    contact.estado = 'respondido'
    contact.respuesta = d.respuesta
    contact.respondido_en = now()
  }
  return { ...contact }
})

on('GET', '/mis-contactos-pyme', req => {
  const u = auth(req, 'tutor')
  return db.contactos_pymes.filter(c => c.remitente_id === u.id).sort((a, b) => b.creado_en.localeCompare(a.creado_en))
    .map(c => ({ id: c.id, negocio: db.pymes.find(p => p.id === c.pyme_id)?.nombre_comercial || 'Negocio', mensaje: c.mensaje, respuesta: c.respuesta, estado: c.estado, creado_en: c.creado_en }))
})

const ofertaSchema = z.object({ precio_clp: z.number().int().min(0).max(100_000_000), desde: fecha, hasta: fecha })
  .refine(o => o.hasta >= o.desde, 'La oferta debe terminar después de comenzar')
const itemSchema = z.object({
  tipo: z.enum(['producto', 'servicio']),
  nombre: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(120),
  descripcion: z.string().trim().max(1000).nullable().optional(),
  precio_referencial_clp: z.number().int().min(0).max(100_000_000).nullable().optional(),
  categoria: z.string().trim().max(40).nullable().optional(),
  sin_stock: z.boolean().optional(),
  oferta: ofertaSchema.nullable().optional(),
  disponible: z.boolean().optional(),
})

// Una oferta tiene sentido solo si baja el precio referencial.
function validarOferta(precio: number | null, oferta: Oferta | null | undefined) {
  if (!oferta) return
  if (precio == null) fail(400, 'Para publicar una oferta, el ítem necesita un precio referencial')
  if (precio != null && oferta.precio_clp >= precio) fail(400, 'El precio de oferta debe ser menor que el precio referencial')
}

on('GET', '/pymes/:id/catalogo', req => { const p = miPyme(req, 'catalogo'); return db.catalogo.filter(i => i.pyme_id === p.id).sort((a, b) => b.creado_en.localeCompare(a.creado_en)) })

on('POST', '/pymes/:id/catalogo', req => {
  const p = miPyme(req, 'catalogo')
  const d = parse(itemSchema, req.body)
  exigirCupo(p.id, 'items')
  validarOferta(d.precio_referencial_clp ?? null, d.oferta)
  if (ofertaVigente(d.oferta)) exigirCupo(p.id, 'ofertas')
  // Si la Pyme aún no está verificada el ítem se guarda, pero no se publica.
  const item: Item = {
    id: uid(), pyme_id: p.id, tipo: d.tipo, nombre: d.nombre, descripcion: d.descripcion || null, precio_referencial_clp: d.precio_referencial_clp ?? null,
    disponible: (d.disponible ?? true) && suscripcionActiva(p.id), categoria: d.categoria || null, sin_stock: d.sin_stock ?? false, oferta: d.oferta ?? null, creado_en: now(),
  }
  db.catalogo.push(item)
  return item
})

// Los campos omitidos se conservan; null los borra (por ejemplo, oferta: null quita la oferta).
on('PUT', '/pymes/:id/catalogo/:itemId', req => {
  const p = miPyme(req, 'catalogo')
  const d = parse(itemSchema, req.body)
  const item = db.catalogo.find(i => i.id === req.params.itemId && i.pyme_id === p.id)
  if (!item) return fail(404, 'Ítem no encontrado')
  if (d.oferta && ofertaVigente(d.oferta) && !ofertaVigente(item.oferta)) exigirCupo(p.id, 'ofertas')
  const next = {
    tipo: d.tipo, nombre: d.nombre,
    descripcion: d.descripcion === undefined ? item.descripcion : d.descripcion || null,
    precio_referencial_clp: d.precio_referencial_clp === undefined ? item.precio_referencial_clp : d.precio_referencial_clp,
    categoria: d.categoria === undefined ? item.categoria : d.categoria || null,
    sin_stock: d.sin_stock ?? item.sin_stock,
    oferta: d.oferta === undefined ? item.oferta : d.oferta,
    disponible: d.disponible ?? item.disponible,
  }
  validarOferta(next.precio_referencial_clp, next.oferta)
  Object.assign(item, next)
  return item
})

on('DELETE', '/pymes/:id/catalogo/:itemId', req => {
  const p = miPyme(req, 'catalogo')
  const i = db.catalogo.findIndex(x => x.id === req.params.itemId && x.pyme_id === p.id)
  if (i < 0) return fail(404, 'Ítem no encontrado')
  db.catalogo.splice(i, 1)
  return undefined
})

// El nivel de detalle depende del plan: Gratis y Bronce ven totales; Plata suma canales e ítems; Oro, también sucursales y convenios.
on('GET', '/pymes/:id/metricas', req => {
  const p = miPyme(req, 'metricas')
  const nivel = planDe(p.id).beneficios.metricas
  const desde = hace(30), previo = hace(60)
  const eventos = db.eventos.filter(e => e.pyme_id === p.id && e.ocurrido_en > desde)
  // Mismo conteo para los 30 días anteriores, para comparar.
  const anteriores = { visita_perfil: 0, vista_item: 0, clic_contacto: 0, clic_whatsapp: 0 }
  for (const e of db.eventos) if (e.pyme_id === p.id && e.ocurrido_en > previo && e.ocurrido_en <= desde) anteriores[e.tipo]++
  const totales = { visita_perfil: 0, vista_item: 0, clic_contacto: 0, clic_whatsapp: 0 }
  const dias = new Map<string, number>(), vistas = new Map<string, number>()
  for (const e of eventos) {
    totales[e.tipo]++
    const dia = e.ocurrido_en.slice(0, 10)
    dias.set(dia, (dias.get(dia) ?? 0) + 1)
    const item = e.tipo === 'vista_item' && db.catalogo.find(i => i.id === e.item_id)
    if (item) vistas.set(item.nombre, (vistas.get(item.nombre) ?? 0) + 1)
  }
  const conveniosIds = new Set(db.convenios.filter(c => c.pyme_id === p.id).map(c => c.id))
  const canjes30 = db.canjes.filter(c => conveniosIds.has(c.convenio_id) && c.ocurrido_en > desde)
  return {
    nivel,
    totales,
    anteriores,
    ofertas_vigentes: itemsPublicos(p.id).filter(i => ofertaVigente(i.oferta)).length,
    por_dia: [...dias].sort(([a], [b]) => a.localeCompare(b)).map(([dia, n]) => ({ dia, eventos: n })),
    items_mas_vistos: nivel === 'basicas' ? [] : [...vistas].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nombre, n]) => ({ nombre, vistas: n })),
    canjes_30d: canjes30.length,
    por_sucursal: nivel !== 'avanzadas' ? [] : [{ id: null, nombre: 'Casa matriz' }, ...db.sucursales.filter(s => s.pyme_id === p.id)].map(s => ({ nombre: s.nombre, canjes: canjes30.filter(c => c.sucursal_id === s.id).length })),
  }
})

on('GET', '/pymes/:id/suscripcion', req => {
  const p = miPyme(req, 'suscripcion')
  return db.suscripciones.filter(s => s.pyme_id === p.id).sort((a, b) => b.inicio.localeCompare(a.inicio)).map(s => {
    const plan = planPorId(s.plan_id)
    return {
      id: s.id, estado: s.estado, inicio: s.inicio, fin: s.fin, plan: plan.nombre, plan_codigo: plan.codigo, precio_mensual_clp: plan.precio_mensual_clp, max_items_catalogo: plan.limites.items,
      pagos: db.pagos.filter(pg => pg.suscripcion_id === s.id).map(pg => ({ id: pg.id, monto_clp: pg.monto_clp, estado: pg.estado, canal: pg.canal, referencia: pg.referencia, codigo_orcob: pg.codigo_orcob ?? null })),
    }
  })
})

// Contratar, renovar o cambiar de plan. Transferencia: la confirma un asesor. Orcob: se confirma al recibir el aviso de pago.
// El nuevo periodo empieza cuando termina el vigente, así no se pierden días ya pagados.
on('POST', '/pymes/:id/suscripcion', req => {
  const p = miPyme(req, 'suscripcion')
  const d = parse(z.object({
    plan_id: z.number().int().positive(),
    canal: z.enum(['transferencia', 'orcob']).default('transferencia'),
    // Opcional: la Pyme puede pedir el plan y transferir después de recibir los datos; el asesor confirma el pago.
    referencia_pago: z.string().trim().max(60).optional(),
  }), req.body)
  if (p.estado_verificacion !== 'aprobada') return fail(422, 'Tu negocio debe estar verificado para renovar o cambiar de plan')
  if (pagoPendiente(p.id)) return fail(409, 'Ya tienes una solicitud de pago en revisión')
  const plan = PLANES.find(x => x.id === d.plan_id)
  if (!plan) return fail(400, 'Plan no disponible')
  if (plan.precio_mensual_clp === 0) return fail(422, 'El plan Gratis no requiere pago: rige automáticamente cuando termina tu periodo pagado')
  const actual = db.suscripciones.filter(s => s.pyme_id === p.id && s.estado === 'activa').sort((a, b) => b.fin.localeCompare(a.fin))[0]
  const inicio = actual && actual.fin > dayOffset(0) ? actual.fin : dayOffset(0)
  const r = registrarPago(p, plan, inicio, d.canal, d.referencia_pago || null)
  const aviso = avisoSolicitud('plan', p.nombre_comercial, p.rut_empresa, '', plan.nombre, plan.precio_mensual_clp, d.canal, d.canal === 'transferencia' ? r.referencia : null)
  avisarAsesores(aviso.asunto, aviso.cuerpo)
  if (d.canal === 'transferencia') {
    const c = correoSolicitudPlan(p.nombre_comercial, plan.nombre, plan.precio_mensual_clp, !!r.referencia)
    enviarCorreo(db.usuarios.find(x => x.id === p.propietario_id)?.correo ?? '', c.asunto, c.cuerpo, 'cobranza')
  }
  return { id: r.suscripcion.id, inicio: r.suscripcion.inicio, fin: r.suscripcion.fin, pago_id: r.id, codigo_orcob: r.codigo_orcob }
})

// Demostración del aviso (webhook) de Orcob: confirma el pago y activa el periodo sin intervención del asesor.
on('POST', '/pymes/:id/pagos/:pagoId/orcob-confirmado', req => {
  const p = miPyme(req, 'suscripcion')
  const pago = db.pagos.find(x => x.id === req.params.pagoId && x.canal === 'orcob' && x.estado === 'pendiente')
  const s = pago && db.suscripciones.find(x => x.id === pago.suscripcion_id && x.pyme_id === p.id)
  if (!pago || !s) return fail(404, 'No hay un cobro Orcob pendiente con ese identificador')
  activarPeriodo(p, s)
  Object.assign(pago, { estado: 'confirmado', pagado_en: now() })
  enviarCorreo(db.usuarios.find(u => u.id === p.propietario_id)?.correo ?? '', `Pago recibido: plan ${planPorId(s.plan_id).nombre}`, `Orcob informó el pago de ${pago.monto_clp.toLocaleString('es-CL')} CLP (cobro ${pago.referencia}).\nTu plan rige del ${s.inicio} al ${s.fin}.\n\nEquipo PetSuite`, 'aprobacion')
  return { ok: true, inicio: s.inicio, fin: s.fin }
})

// Una renovación respeta el periodo pedido; un alta o reactivación vencida parte hoy.
function activarPeriodo(p: Pyme, s: { inicio: string; fin: string; estado: string }) {
  if (s.inicio < dayOffset(0) || p.estado_verificacion !== 'aprobada') Object.assign(s, { inicio: dayOffset(0), fin: dayOffset(DIAS_PERIODO) })
  s.estado = 'activa'
}

// Muro comunal
const textoMuro = (min: number) => z.string().trim().min(min, `Escribe al menos ${min} caracteres`).max(1000).refine(sinEnlaces, 'No se permiten enlaces externos')

// Urgente: extravíos sin resolver y alertas de salud de la última semana. Se muestran primero.
const urgente = (p: Publicacion) => (p.tipo === 'extravio' && !p.resuelto_en) || (p.tipo === 'alerta' && p.creado_en > hace(7))

function vistaPublicacion(p: Publicacion, u: Usuario) {
  const a = p.animal_id ? db.animales.find(x => x.id === p.animal_id) : undefined
  const o = a && ongDe(a)
  const mascota = p.mascota_id ? db.mascotas.find(m => m.id === p.mascota_id) : undefined
  return {
    id: p.id, tipo: p.tipo, texto: p.texto, creado_en: p.creado_en, editado: !!p.editado_en, autor: nombreUsuario(p.autor_id), es_mio: p.autor_id === u.id,
    comuna_id: p.comuna_id, sector: p.sector, foto_url: p.foto_url, fecha_evento: p.fecha_evento, resuelto: !!p.resuelto_en, urgente: urgente(p),
    mascota: mascota?.nombre ?? null,
    // Solo el autor, y mientras la mascota siga siendo suya, recibe el id para armar el cartel con su medalla.
    mascota_id: mascota && p.autor_id === u.id && mascota.tutor_id === u.id ? mascota.id : null,
    // La adopción solo se enlaza mientras el animal siga publicado.
    animal: a && o && visible(a) ? { id: a.id, nombre: a.nombre, ong: o.nombre } : null,
    reacciones: db.reacciones.filter(r => r.publicacion_id === p.id).length,
    reaccione: db.reacciones.some(r => r.publicacion_id === p.id && r.usuario_id === u.id),
    guardado: db.guardados.some(g => g.publicacion_id === p.id && g.usuario_id === u.id),
    comentarios: db.comentarios.filter(c => c.publicacion_id === p.id && c.estado === 'visible').sort((x, y) => x.creado_en.localeCompare(y.creado_en))
      .map(c => ({ id: c.id, autor: nombreUsuario(c.autor_id), texto: c.texto, es_mio: c.autor_id === u.id, editado: !!c.editado_en })),
  }
}

// ?comuna=<id> muestra el muro de esa comuna; ?guardadas=1, lo que el usuario guardó en cualquier comuna.
on('GET', '/muro', req => {
  const u = auth(req)
  const guardadas = req.query.get('guardadas') === '1'
  const comuna = Number(req.query.get('comuna') || u.comuna_id)
  const mias = new Set(db.guardados.filter(g => g.usuario_id === u.id).map(g => g.publicacion_id))
  return db.publicaciones.filter(p => p.estado === 'publicada' && (guardadas ? mias.has(p.id) : p.comuna_id === comuna))
    .sort((a, b) => b.creado_en.localeCompare(a.creado_en)).slice(0, 100).map(p => vistaPublicacion(p, u))
})

const publicacionSchema = z.object({
  tipo: z.enum(['extravio', 'encuentro', 'recomendacion', 'alerta', 'evento', 'adopcion']),
  texto: textoMuro(15),
  mascota_id: z.string().optional(),
  animal_id: z.string().optional(),
  sector: z.string().trim().max(80, 'El sector admite hasta 80 caracteres').refine(sinEnlaces, 'No se permiten enlaces externos').optional(),
  fecha_evento: fecha.optional(),
})

on('POST', '/muro', req => {
  const u = auth(req, 'tutor', 'ong')
  const d = parse(publicacionSchema, req.body)
  const base = { id: uid(), autor_id: u.id, mascota_id: null, animal_id: null, tipo: d.tipo, texto: d.texto, sector: d.sector || null, foto_url: null, fecha_evento: null, resuelto_en: null, editado_en: null, estado: 'publicada' as const, creado_en: now() }
  let p: Publicacion
  if (u.rol === 'ong' || d.tipo === 'adopcion') {
    // Solo una ONG verificada difunde a sus propios animales publicados, en el muro de la comuna de la ONG.
    const o = db.ongs.find(x => x.propietario_id === u.id)
    if (u.rol !== 'ong' || d.tipo !== 'adopcion') return fail(403, 'Las adopciones las publican las ONG verificadas')
    if (!o || o.estado_verificacion !== 'aprobada') return fail(403, 'Tu organización debe estar verificada para difundir en el muro')
    const a = db.animales.find(x => x.id === d.animal_id && x.ong_id === o.id)
    if (!a || !visible(a)) return fail(422, 'Solo puedes difundir animales disponibles y publicados')
    if (db.publicaciones.some(x => x.animal_id === a.id && x.estado === 'publicada')) return fail(409, `${a.nombre} ya está difundido en el muro`)
    p = { ...base, comuna_id: o.comuna_id, animal_id: a.id, foto_url: a.foto_url }
  } else {
    if (!u.comuna_id) return fail(400, 'Define tu comuna en el perfil')
    const m = d.mascota_id ? db.mascotas.find(x => x.id === d.mascota_id) : undefined
    if (d.mascota_id && m?.tutor_id !== u.id) return fail(403, 'La mascota no es tuya')
    if (d.tipo === 'evento' && !d.fecha_evento) return fail(400, 'Indica la fecha del evento')
    if (d.tipo === 'evento' && d.fecha_evento! < dayOffset(0)) return fail(400, 'La fecha del evento ya pasó')
    p = { ...base, comuna_id: u.comuna_id, mascota_id: d.tipo === 'extravio' ? m?.id ?? null : null, foto_url: d.tipo === 'extravio' ? m?.foto_url ?? null : null, fecha_evento: d.tipo === 'evento' ? d.fecha_evento! : null }
  }
  db.publicaciones.push(p)
  return { id: p.id, tipo: p.tipo, texto: p.texto, creado_en: p.creado_en }
})

function publicacionPropia(req: Req): [Usuario, Publicacion] {
  const u = auth(req)
  const p = db.publicaciones.find(x => x.id === req.params.id && x.estado !== 'eliminada')
  if (!p) return fail(404, 'Publicación no encontrada')
  if (p.autor_id !== u.id) return fail(403, 'Solo puedes cambiar tus propias publicaciones')
  return [u, p]
}

on('PATCH', '/muro/:id', req => {
  const [, p] = publicacionPropia(req)
  const d = parse(publicacionSchema.pick({ texto: true, sector: true, fecha_evento: true }), req.body)
  if (p.estado === 'oculta') return fail(422, 'La publicación fue ocultada por moderación y no se puede editar')
  if (p.tipo === 'evento' && d.fecha_evento && d.fecha_evento < dayOffset(0)) return fail(400, 'La fecha del evento ya pasó')
  Object.assign(p, { texto: d.texto, sector: d.sector || null, fecha_evento: p.tipo === 'evento' ? d.fecha_evento ?? p.fecha_evento : null, editado_en: now() })
  return { ok: true }
})

on('DELETE', '/muro/:id', req => {
  const [, p] = publicacionPropia(req)
  p.estado = 'eliminada'
  // Los reportes pendientes sobre lo eliminado ya no requieren revisión.
  for (const r of db.reportes) if (r.objeto_id === p.id && r.estado === 'abierto') r.estado = 'resuelto_mantenido'
  return undefined
})

// Cerrar un extravío o encuentro cuando la mascota volvió a casa (se puede reabrir).
on('PATCH', '/muro/:id/resuelto', req => {
  const [, p] = publicacionPropia(req)
  const d = parse(z.object({ resuelto: z.boolean() }), req.body)
  if (p.tipo !== 'extravio' && p.tipo !== 'encuentro') return fail(422, 'Solo los extravíos y encuentros se marcan como resueltos')
  p.resuelto_en = d.resuelto ? now() : null
  return { ok: true }
})

on('POST', '/muro/:id/reacciones', req => {
  const u = auth(req)
  if (!db.publicaciones.some(p => p.id === req.params.id && p.estado === 'publicada')) return fail(404, 'Publicación no encontrada')
  const i = db.reacciones.findIndex(r => r.publicacion_id === req.params.id && r.usuario_id === u.id)
  if (i >= 0) db.reacciones.splice(i, 1)
  else db.reacciones.push({ publicacion_id: req.params.id, usuario_id: u.id })
  return { reaccione: i < 0 }
})

on('POST', '/muro/:id/guardar', req => {
  const u = auth(req)
  if (!db.publicaciones.some(p => p.id === req.params.id && p.estado === 'publicada')) return fail(404, 'Publicación no encontrada')
  const i = db.guardados.findIndex(g => g.publicacion_id === req.params.id && g.usuario_id === u.id)
  if (i >= 0) db.guardados.splice(i, 1)
  else db.guardados.push({ publicacion_id: req.params.id, usuario_id: u.id })
  return { guardado: i < 0 }
})

on('POST', '/muro/:id/comentarios', req => {
  const u = auth(req)
  const d = parse(z.object({ texto: textoMuro(3) }), req.body)
  if (!db.publicaciones.some(p => p.id === req.params.id && p.estado === 'publicada')) return fail(404, 'Publicación no disponible')
  const c = { id: uid(), autor_id: u.id, publicacion_id: req.params.id, texto: d.texto, estado: 'visible' as const, editado_en: null, creado_en: now() }
  db.comentarios.push(c)
  return { id: c.id, texto: c.texto, creado_en: c.creado_en }
})

function comentarioPropio(req: Req) {
  const u = auth(req)
  const c = db.comentarios.find(x => x.id === req.params.cid && x.estado === 'visible')
  if (!c) return fail(404, 'Comentario no encontrado')
  if (c.autor_id !== u.id) return fail(403, 'Solo puedes cambiar tus propios comentarios')
  return c
}

on('PATCH', '/muro/comentarios/:cid', req => {
  const c = comentarioPropio(req)
  const d = parse(z.object({ texto: textoMuro(3) }), req.body)
  Object.assign(c, { texto: d.texto, editado_en: now() })
  return { ok: true }
})

on('DELETE', '/muro/comentarios/:cid', req => {
  const c = comentarioPropio(req)
  c.estado = 'eliminado'
  for (const r of db.reportes) if (r.objeto_id === c.id && r.estado === 'abierto') r.estado = 'resuelto_mantenido'
  return undefined
})

on('POST', '/reportes', req => {
  const u = auth(req)
  const d = parse(z.object({ objeto_tipo: z.enum(['publicacion', 'comentario']), objeto_id: z.string().min(1), motivo: z.string().trim().min(10, 'Describe el motivo con al menos 10 caracteres').max(200) }), req.body)
  const objeto = d.objeto_tipo === 'publicacion' ? db.publicaciones.find(p => p.id === d.objeto_id && p.estado === 'publicada') : db.comentarios.find(c => c.id === d.objeto_id && c.estado === 'visible')
  if (!objeto) return fail(404, 'Contenido no encontrado')
  if (objeto.autor_id === u.id) return fail(422, 'No puedes reportar tu propio contenido')
  if (db.reportes.some(r => r.objeto_id === d.objeto_id && r.reportante_id === u.id && r.estado === 'abierto')) return fail(409, 'Ya reportaste este contenido; el equipo lo está revisando')
  const r = { id: uid(), reportante_id: u.id, objeto_tipo: d.objeto_tipo, objeto_id: d.objeto_id, motivo: d.motivo, estado: 'abierto' as const, creado_en: now() }
  db.reportes.push(r)
  return { id: r.id }
})

// Adopción: solo animales disponibles de ONG verificadas son públicos.
const ongDe = (a: Animal) => db.ongs.find(o => o.id === a.ong_id)
const visible = (a: Animal) => a.estado === 'disponible' && ongDe(a)?.estado_verificacion === 'aprobada'

on('GET', '/adopciones', req => {
  const comuna = req.query.get('comuna'), especie = req.query.get('especie')
  return db.animales.filter(a => visible(a) && (!comuna || comunaNombre(ongDe(a)!.comuna_id) === comuna) && (!especie || a.especie.toLowerCase() === especie.toLowerCase()))
    .sort((a, b) => b.publicado_en.localeCompare(a.publicado_en)).map(a => {
      const o = ongDe(a)!
      return { id: a.id, nombre: a.nombre, especie: a.especie, raza: a.raza, edad_estimada: a.edad_estimada, estado_salud: a.estado_salud, foto_url: a.foto_url, publicado_en: a.publicado_en, ong: o.nombre, comuna: comunaNombre(o.comuna_id) }
    })
})

on('GET', '/adopciones/:id', req => {
  const a = db.animales.find(x => x.id === req.params.id)
  const o = a && ongDe(a)
  if (!a || !o || a.estado === 'adoptado' || o.estado_verificacion !== 'aprobada') return fail(404, 'No encontrado')
  db.eventos_adopcion.push({ id: uid(), animal_id: a.id, ocurrido_en: now() })
  return {
    id: a.id, nombre: a.nombre, especie: a.especie, raza: a.raza, edad_estimada: a.edad_estimada, estado_salud: a.estado_salud, historia: a.historia, foto_url: a.foto_url, publicado_en: a.publicado_en,
    vacunas: a.historial_salud.vacunas, ong_id: o.id, ong: o.nombre, ong_tipo: o.tipo, ong_descripcion: o.descripcion, ong_contacto: o.contacto, ong_redes: o.redes_sociales, comuna: comunaNombre(o.comuna_id),
  }
})

on('POST', '/adopciones/:id/solicitudes', req => {
  const d = parse(z.object({
    mensaje: z.string().trim().min(10, 'Cuéntale a la organización por qué quieres adoptar (mínimo 10 caracteres)').max(1000),
    nombre: z.string().trim().max(80).optional(),
    contacto: z.string().trim().max(120).optional(),
  }), req.body)
  const a = db.animales.find(x => x.id === req.params.id)
  if (!a || !visible(a)) return fail(404, 'Este animal ya no está disponible')
  db.solicitudes.push({ id: uid(), animal_id: a.id, solicitante_nombre: d.nombre || null, solicitante_contacto: d.contacto || null, mensaje: d.mensaje, estado: 'nueva', creado_en: now() })
  return { ok: true }
})

function miOng(req: Req) {
  const u = auth(req, 'ong')
  const o = db.ongs.find(x => x.propietario_id === u.id)
  if (!o) return fail(409, 'Primero registra tu organización')
  return o
}

on('GET', '/ong/mia', req => {
  const u = auth(req, 'ong')
  const o = db.ongs.find(x => x.propietario_id === u.id)
  return o ? { ...o, comuna: comunaNombre(o.comuna_id) } : null
})

on('POST', '/ong', req => {
  const u = auth(req, 'ong')
  const d = parse(z.object({
    nombre: z.string().trim().min(2, 'Ingresa el nombre de la organización').max(100),
    tipo: z.enum(['refugio', 'rescatista_independiente', 'agrupacion']),
    descripcion: z.string().trim().max(1000).optional(),
    comuna_id: z.number().int().positive(),
    contacto: z.string().trim().max(120).optional(),
    redes_sociales: z.string().trim().max(200).optional(),
  }), req.body)
  if (db.ongs.some(o => o.propietario_id === u.id)) return fail(409, 'Tu cuenta ya tiene una organización registrada')
  if (!db.comunas.some(c => c.id === d.comuna_id)) return fail(400, 'Comuna no válida')
  const o = { id: uid(), propietario_id: u.id, nombre: d.nombre, tipo: d.tipo, descripcion: d.descripcion ?? null, comuna_id: d.comuna_id, contacto: d.contacto ?? null, redes_sociales: d.redes_sociales ?? null, estado_verificacion: 'pendiente' as const, perfil_publicado: null, perfil_borrador: null, perfil_estado: 'sin_enviar' as const, perfil_motivo: null, creado_en: now() }
  db.ongs.push(o)
  return { id: o.id, estado_verificacion: o.estado_verificacion }
})

const animalSchema = z.object({
  nombre: z.string().trim().min(1, 'Ingresa el nombre del animal').max(60),
  especie: z.string().trim().min(1).max(20),
  raza: z.string().trim().max(60).optional(),
  edad_estimada: z.string().trim().max(30).optional(),
  estado_salud: z.string().trim().max(1000).optional(),
  historia: z.string().trim().max(2000).optional(),
  historial_salud: fichaSchema.optional(),
  estado: z.enum(['disponible', 'en_proceso', 'adoptado']).optional(),
})

on('GET', '/ong/animales', req => {
  const o = miOng(req)
  const desde = hace(7)
  return db.animales.filter(a => a.ong_id === o.id).sort((a, b) => b.publicado_en.localeCompare(a.publicado_en)).map(a => ({
    ...a,
    publicado: a.estado !== 'adoptado' && o.estado_verificacion === 'aprobada',
    solicitudes_abiertas: db.solicitudes.filter(s => s.animal_id === a.id && (s.estado === 'nueva' || s.estado === 'en_conversacion')).length,
    visitas_7d: db.eventos_adopcion.filter(e => e.animal_id === a.id && e.ocurrido_en > desde).length,
  }))
})

on('POST', '/ong/animales', req => {
  const o = miOng(req)
  const d = parse(animalSchema, req.body)
  const a: Animal = {
    id: uid(), ong_id: o.id, nombre: d.nombre, especie: d.especie, raza: d.raza ?? null, edad_estimada: d.edad_estimada ?? null, estado_salud: d.estado_salud ?? null, historia: d.historia ?? null,
    historial_salud: d.historial_salud ?? ficha(), foto_url: null, estado: 'disponible', mascota_id: null, publicado_en: now(),
  }
  db.animales.push(a)
  return { ...a, publicado: o.estado_verificacion === 'aprobada' }
})

// Los campos omitidos se conservan (por ejemplo, la foto y la raza al alternar la disponibilidad).
on('PUT', '/ong/animales/:id', req => {
  const o = miOng(req)
  const d = parse(animalSchema, req.body)
  const a = db.animales.find(x => x.id === req.params.id && x.ong_id === o.id)
  if (!a) return fail(404, 'No encontrado')
  Object.assign(a, {
    nombre: d.nombre, especie: d.especie, raza: d.raza ?? a.raza, edad_estimada: d.edad_estimada ?? a.edad_estimada, estado_salud: d.estado_salud ?? a.estado_salud,
    historia: d.historia ?? a.historia, historial_salud: d.historial_salud ?? a.historial_salud, estado: a.estado === 'adoptado' ? a.estado : d.estado ?? a.estado,
  })
  return a
})

on('GET', '/ong/animales/:id/solicitudes', req => {
  const o = miOng(req)
  if (!db.animales.some(a => a.id === req.params.id && a.ong_id === o.id)) return fail(404, 'No encontrado')
  return db.solicitudes.filter(s => s.animal_id === req.params.id).sort((a, b) => b.creado_en.localeCompare(a.creado_en)).map(({ animal_id: _, ...s }) => s)
})

// En conversación marca el animal en proceso; cerrar la solicitud lo libera si no hay otras en curso.
on('PATCH', '/ong/solicitudes/:id', req => {
  const o = miOng(req)
  const d = parse(z.object({ estado: z.enum(['en_conversacion', 'cerrada']) }), req.body)
  const s = db.solicitudes.find(x => x.id === req.params.id && (x.estado === 'nueva' || x.estado === 'en_conversacion'))
  const a = s && db.animales.find(x => x.id === s.animal_id && x.ong_id === o.id)
  if (!s || !a) return fail(404, 'Solicitud no disponible')
  s.estado = d.estado
  if (a.estado !== 'adoptado') a.estado = db.solicitudes.some(x => x.animal_id === a.id && x.estado === 'en_conversacion') ? 'en_proceso' : 'disponible'
  return { ok: true }
})

// Crea la Ficha Única del adoptante con el mismo historial de salud del animal.
function traspasar(a: Animal, tutorId: string) {
  const m: MascotaRow = { id: uid(), tutor_id: tutorId, nombre: a.nombre, especie: a.especie, raza: a.raza, sexo: null, fecha_nacimiento: null, foto_url: a.foto_url, datos_clinicos: structuredClone(a.historial_salud), ficha_version: 1, creado_en: now() }
  db.mascotas.push(m)
  return m.id
}
const tutorPorCorreo = (correo?: string | null) => correo ? db.usuarios.find(u => u.correo === correo.trim().toLowerCase() && u.rol === 'tutor' && u.estado === 'activo') : undefined

on('POST', '/ong/animales/:id/adopcion', req => {
  const o = miOng(req)
  const d = parse(z.object({ solicitud_id: z.string().optional(), correo: z.string().trim().email('Correo inválido').optional() }), req.body)
  const a = db.animales.find(x => x.id === req.params.id && x.ong_id === o.id && x.estado !== 'adoptado')
  if (!a) return fail(404, 'El animal no existe o ya fue adoptado')
  const sol = d.solicitud_id ? db.solicitudes.find(s => s.id === d.solicitud_id && s.animal_id === a.id) : undefined
  if (d.solicitud_id && !sol) return fail(404, 'Solicitud no encontrada')
  const tutor = tutorPorCorreo(d.correo || sol?.solicitante_contacto)
  a.mascota_id = tutor ? traspasar(a, tutor.id) : null
  a.estado = 'adoptado'
  if (sol) sol.estado = 'concretada'
  for (const s of db.solicitudes) if (s.animal_id === a.id && (s.estado === 'nueva' || s.estado === 'en_conversacion')) s.estado = 'cerrada'
  return { ok: true, vinculada: !!tutor, mascota_id: a.mascota_id, invitar: !tutor }
})

on('POST', '/ong/animales/:id/vincular', req => {
  const o = miOng(req)
  const d = parse(z.object({ correo: z.string().trim().email('Correo inválido') }), req.body)
  const a = db.animales.find(x => x.id === req.params.id && x.ong_id === o.id && x.estado === 'adoptado' && !x.mascota_id)
  if (!a) return fail(404, 'No hay una adopción pendiente de vincular')
  const tutor = tutorPorCorreo(d.correo)
  if (!tutor) return fail(404, 'No existe un tutor con ese correo. Invítalo a crear su cuenta en PetSuite.')
  a.mascota_id = traspasar(a, tutor.id)
  return { ok: true, mascota_id: a.mascota_id }
})

// Administración
on('GET', '/admin/resumen', req => {
  auth(req, 'admin', 'asesor')
  db.usuarios.forEach(refreshSuspension)
  const desde = hace(30)
  // Ingreso mensual recurrente: suma de la tarifa del plan que rige hoy en cada Pyme verificada.
  const planes = db.pymes.filter(p => p.estado_verificacion === 'aprobada').map(p => estadoPlan(p.id))
  return {
    por_plan: PLANES.map(pl => ({ codigo: pl.codigo, nombre: pl.nombre, pymes: planes.filter(e => e.plan.id === pl.id).length })),
    mrr: planes.reduce((n, e) => n + e.plan.precio_mensual_clp, 0),
    en_gracia: planes.filter(e => e.en_gracia).length,
    banners_pendientes: db.banners.filter(b => b.estado === 'pendiente').length,
    convenios_pendientes: db.convenios.filter(c => c.estado === 'pendiente_asesor').length,
    perfiles_pendientes: db.ongs.filter(o => o.perfil_estado === 'en_revision').length,
    privacidad_pendientes: db.solicitudes_privacidad.filter(s => s.estado === 'recibida' || s.estado === 'en_proceso').length,
    usuarios: db.usuarios.length,
    suspendidos: db.usuarios.filter(u => u.estado === 'suspendido').length,
    pymes_activas: db.pymes.filter(p => p.estado_verificacion === 'aprobada').length,
    pymes_pendientes: db.pymes.filter(p => p.estado_verificacion === 'pendiente').length,
    reportes_abiertos: db.reportes.filter(r => r.estado === 'abierto').length,
    escaneos: db.escaneos.length,
    ingresos_30d: db.pagos.filter(p => p.estado === 'confirmado' && p.pagado_en > desde).reduce((n, p) => n + p.monto_clp, 0),
    ong_pendientes: db.ongs.filter(o => o.estado_verificacion === 'pendiente').length,
    animales_disponibles: db.animales.filter(visible).length,
  }
})

on('GET', '/admin/usuarios', req => {
  auth(req, 'admin')
  db.usuarios.forEach(refreshSuspension)
  const q = (req.query.get('q') || '').toLowerCase()
  return db.usuarios.filter(u => !q || u.nombre_visible.toLowerCase().includes(q) || u.correo.includes(q)).sort((a, b) => b.creado_en.localeCompare(a.creado_en)).slice(0, 100)
    .map(u => ({ id: u.id, correo: u.correo, rol: u.rol, nombre_visible: u.nombre_visible, estado: u.estado, suspension: u.suspension ?? null, creado_en: u.creado_en }))
})

on('GET', '/admin/usuarios/:id/denuncias', req => {
  auth(req, 'admin')
  const user = db.usuarios.find(u => u.id === req.params.id)
  if (!user) return fail(404, 'Usuario no encontrado')
  return db.reportes.filter(r => db.publicaciones.some(p => p.id === r.objeto_id && p.autor_id === user.id))
    .sort((a, b) => b.creado_en.localeCompare(a.creado_en))
    .map(r => ({ id: r.id, motivo: r.motivo, estado: r.estado, creado_en: r.creado_en,
      reportante: nombreUsuario(r.reportante_id), contenido: db.publicaciones.find(p => p.id === r.objeto_id)?.texto ?? null }))
})

on('PATCH', '/admin/usuarios/:id', req => {
  const admin = auth(req, 'admin')
  const d = parse(z.discriminatedUnion('estado', [
    z.object({ estado: z.literal('activo') }),
    z.object({ estado: z.literal('suspendido'), suspension: userSuspensionSchema, reporte_id: z.string().optional() }),
  ]), req.body)
  if (req.params.id === admin.id) return fail(400, 'No puedes suspender tu propia cuenta')
  const u = db.usuarios.find(x => x.id === req.params.id)
  if (!u) return fail(404, 'Usuario no encontrado')
  if (u.rol === 'admin') return fail(403, 'No se puede suspender a un administrador')
  const report = d.estado === 'suspendido' && d.reporte_id ? db.reportes.find(r => r.id === d.reporte_id && r.estado === 'abierto') : null
  const post = report && db.publicaciones.find(p => p.id === report.objeto_id && p.autor_id === u.id)
  if (d.estado === 'suspendido' && d.reporte_id && !post) return fail(400, 'La denuncia no pertenece a este usuario')
  u.estado = d.estado
  if (d.estado === 'suspendido') {
    u.suspension = { ...d.suspension, hasta: d.suspension.tipo === 'temporal' ? new Date(Date.now() + d.suspension.dias! * 86_400_000).toISOString() : null, aplicada_en: now() }
    for (const [token, id] of Object.entries(db.sesiones)) if (id === u.id) delete db.sesiones[token]
    if (post) {
      post.estado = 'oculta'
      for (const r of db.reportes) if (r.objeto_id === post.id && r.estado === 'abierto') r.estado = 'resuelto_ocultado'
    }
  } else u.suspension = null
  return { ok: true }
})

on('GET', '/admin/reportes', req => {
  auth(req, 'admin')
  return db.reportes.filter(r => r.estado === 'abierto').sort((a, b) => a.creado_en.localeCompare(b.creado_en)).map(r => {
    const o = r.objeto_tipo === 'comentario' ? db.comentarios.find(x => x.id === r.objeto_id) : db.publicaciones.find(x => x.id === r.objeto_id)
    return { id: r.id, objeto_tipo: r.objeto_tipo, objeto_id: r.objeto_id, motivo: r.motivo, estado: r.estado, creado_en: r.creado_en, reportante: nombreUsuario(r.reportante_id), contenido: o?.texto ?? null, autor: o ? nombreUsuario(o.autor_id) : null, autor_id: o?.autor_id ?? null }
  })
})

on('PATCH', '/admin/reportes/:id', req => {
  auth(req, 'admin')
  const d = parse(z.object({ decision: z.enum(['ocultar', 'mantener']) }), req.body)
  const r = db.reportes.find(x => x.id === req.params.id && x.estado === 'abierto')
  if (!r) return fail(404, 'Reporte no disponible')
  if (d.decision === 'ocultar') {
    if (r.objeto_tipo === 'comentario') { const c = db.comentarios.find(x => x.id === r.objeto_id); if (c) c.estado = 'oculto' }
    else { const p = db.publicaciones.find(x => x.id === r.objeto_id); if (p) p.estado = 'oculta' }
    // Ocultar el contenido cierra también los demás reportes sobre él.
    for (const x of db.reportes) if (x.objeto_id === r.objeto_id && x.estado === 'abierto') x.estado = 'resuelto_ocultado'
  }
  r.estado = d.decision === 'ocultar' ? 'resuelto_ocultado' : 'resuelto_mantenido'
  return { ok: true }
})

on('GET', '/admin/pymes', req => {
  auth(req, 'admin', 'asesor')
  const estado = req.query.get('estado') || 'pendiente'
  // Pendientes incluye las renovaciones o cambios de plan de Pymes ya verificadas que esperan confirmar su pago.
  // Las fichas públicas no se revisan aquí: se validan cuando su dueño las reclama.
  return db.pymes.filter(p => p.origen !== 'publica' && (p.estado_verificacion === estado || (estado === 'pendiente' && p.estado_verificacion === 'aprobada' && pagoPendiente(p.id))))
    .sort((a, b) => a.creado_en.localeCompare(b.creado_en)).map(p => {
      const pend = pagoPendiente(p.id), s = ultimaSuscripcion(p.id)
      const pago = pend ?? (s && db.pagos.find(pg => pg.suscripcion_id === s.id))
      const sub = pago && db.suscripciones.find(x => x.id === pago.suscripcion_id)
      return {
        id: p.id, nombre_comercial: p.nombre_comercial, rut_empresa: p.rut_empresa, rubro: p.rubro, comuna: comunaNombre(p.comuna_id), estado_verificacion: p.estado_verificacion,
        solicitud: p.estado_verificacion === 'aprobada' && pend ? 'renovacion' : 'alta', plan: sub ? planPorId(sub.plan_id).nombre : PLAN_GRATIS.nombre,
        plan_vigente: estadoPlan(p.id).plan.nombre, canal: pago?.canal ?? null, referencia: pago?.referencia ?? null, monto_clp: pago?.monto_clp ?? 0,
        sucursales: usoPyme(p.id).sucursales, equipo: usoPyme(p.id).usuarios,
      }
    })
})

on('PATCH', '/admin/pymes/:id/verificacion', req => {
  auth(req, 'admin', 'asesor')
  const d = parse(z.object({ decision: z.enum(['aprobar', 'rechazar', 'suspender']) }), req.body)
  const p = db.pymes.find(x => x.id === req.params.id)
  if (!p) return fail(404, 'Pyme no encontrada')
  if (p.origen === 'publica') return fail(422, FICHA_PUBLICA_SIN_DUENO)
  const subs = db.suscripciones.filter(s => s.pyme_id === p.id), ids = new Set(subs.map(s => s.id))
  const pendientes = subs.filter(s => s.estado === 'pendiente')
  const renovacion = p.estado_verificacion === 'aprobada' && pendientes.length > 0 && d.decision !== 'suspender'
  const pagos = db.pagos.filter(pg => ids.has(pg.suscripcion_id) && pg.estado === 'pendiente')

  if (d.decision === 'aprobar') {
    // Renovación: el periodo pedido se respeta. Alta o reactivación: parte hoy.
    const activar = pendientes.length ? pendientes : subs.slice(-1)
    for (const s of activar) {
      if (!renovacion || s.inicio < dayOffset(0)) Object.assign(s, { inicio: dayOffset(0), fin: dayOffset(DIAS_PERIODO) })
      s.estado = 'activa'
    }
    for (const pg of pagos) Object.assign(pg, { estado: 'confirmado', pagado_en: now() })
    p.estado_verificacion = 'aprobada'
  } else {
    for (const s of renovacion ? pendientes : subs) s.estado = 'cancelada'
    for (const pg of pagos) pg.estado = 'rechazado'
    // Rechazar una renovación solo rechaza ese pago; el negocio sigue verificado.
    if (!renovacion) p.estado_verificacion = d.decision === 'rechazar' ? 'rechazada' : 'suspendida'
  }
  const texto = { aprobar: renovacion ? 'confirmamos tu pago y tu nuevo periodo quedó activo' : 'tu negocio fue verificado y ya aparece en el directorio', rechazar: renovacion ? 'no pudimos confirmar tu pago; revisa la referencia e inténtalo de nuevo' : 'no pudimos verificar tu negocio; tu asesor te contactará', suspender: 'tu negocio fue suspendido del directorio; contacta a tu asesor' }[d.decision]
  enviarCorreo(db.usuarios.find(u => u.id === p.propietario_id)?.correo ?? '', `${p.nombre_comercial}: ${d.decision === 'aprobar' ? 'solicitud aprobada' : 'revisión de tu cuenta'}`, `Hola:\n\nTe informamos que ${texto}.\n\nEquipo PetSuite`, 'aprobacion')
  return { ok: true }
})

on('GET', '/admin/ong', req => {
  auth(req, 'admin', 'asesor')
  const estado = req.query.get('estado') || 'pendiente'
  return db.ongs.filter(o => o.estado_verificacion === estado).sort((a, b) => a.creado_en.localeCompare(b.creado_en)).map(o => ({
    id: o.id, nombre: o.nombre, tipo: o.tipo, descripcion: o.descripcion, contacto: o.contacto, redes_sociales: o.redes_sociales, estado_verificacion: o.estado_verificacion,
    comuna: comunaNombre(o.comuna_id), creado_en: o.creado_en, animales: db.animales.filter(a => a.ong_id === o.id).length,
  }))
})

on('PATCH', '/admin/ong/:id/verificacion', req => {
  auth(req, 'admin', 'asesor')
  const d = parse(z.object({ decision: z.enum(['aprobar', 'rechazar']) }), req.body)
  const o = db.ongs.find(x => x.id === req.params.id)
  if (!o) return fail(404, 'ONG no encontrada')
  o.estado_verificacion = d.decision === 'aprobar' ? 'aprobada' : 'rechazada'
  enviarCorreo(db.usuarios.find(u => u.id === o.propietario_id)?.correo ?? '', `${o.nombre}: ${d.decision === 'aprobar' ? 'organización verificada' : 'revisión de tu organización'}`, d.decision === 'aprobar' ? 'Hola:\n\nTu organización fue verificada. Tus animales ya aparecen en el catálogo público y puedes publicar tu perfil, banners y convenios.\n\nEquipo PetSuite' : 'Hola:\n\nNo pudimos verificar tu organización. Tu asesor te contactará para revisar los antecedentes.\n\nEquipo PetSuite', 'aprobacion')
  return { ok: true }
})

registerSuiteRoutes({ on, auth, parse, fail, miPyme, planDe, estadoPlan, exigirCupo, permisosEnPyme, comunaNombre, nombreUsuario, cuponesDe, visible, sinEnlaces, fecha })

// ---------- Enrutador ----------
function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/'), b = path.split('/')
  if (a.length !== b.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i])
    else if (a[i] !== b[i]) return null
  }
  return params
}

const wait = () => new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 200))

// ---------- Límites de solicitudes (mismas reglas que el API: src/shared/limites.ts) ----------
const desde = (segundos: number) => new Date(Date.now() - segundos * 1000).toISOString()
function verificarLimites(limite: Limite) {
  for (const r of limite.reglas) {
    if (db.limites.filter(e => e.clave === r.clave && e.ocurrido_en > desde(r.segundos)).length >= r.max) fail(STATUS_DEMASIADOS, mensajeDemasiados(r.segundos))
  }
}
function registrarEvento(limite: Limite) {
  const ocurrido_en = now(), vigentes = desde(2 * 86_400)
  db.limites = db.limites.filter(e => e.ocurrido_en >= vigentes)
  for (const r of limite.reglas) db.limites.push({ clave: r.clave, ocurrido_en })
}

/** cliente: en el navegador siempre es el mismo ('local'); el API usa la huella de la IP. */
export async function handle(method: string, fullPath: string, body: unknown, session: Session | null, cliente = 'local'): Promise<unknown> {
  await wait()
  refresh()
  const [path, qs = ''] = fullPath.split('?')
  method = method.toUpperCase()
  for (const [m, pattern, h] of routes) {
    if (m !== method) continue
    const params = match(pattern, path)
    if (!params) continue
    const limite = limitesDe(method, path, body, cliente)
    if (limite) verificarLimites(limite)
    let result: unknown
    try {
      // Se trabaja sobre una copia para que la respuesta nunca comparta referencias con el estado interno.
      result = h({ params, query: new URLSearchParams(qs), body: body === undefined ? undefined : structuredClone(body), session })
    } catch (error) {
      // Un intento fallido se guarda aunque la ruta no haya cambiado nada más.
      if (limite && error instanceof ApiError && sumaEvento(limite, error.status)) { refresh(); registrarEvento(limite); save() }
      throw error
    }
    if (limite && sumaEvento(limite, 200)) registrarEvento(limite)
    if (limite?.limpiarAlExito) db.limites = db.limites.filter(e => e.clave !== limite.limpiarAlExito)
    if (method !== 'GET' || /^\/(qr|pymes|adopciones)\/[^/]+$/.test(path) || path === '/banners') save()
    return result === undefined ? undefined : structuredClone(result)
  }
  return fail(404, 'No encontrado')
}
