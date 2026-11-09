// Pymes, planes y vitrina pública. Las reglas (RN-SUS, cupos por plan, visibilidad) son las de src/mock/server.ts;
// aquí se calculan sobre filas leídas en pocas consultas para no repetir una consulta por cada negocio.
import type { Oferta } from '../../src/shared/api'
import { DIAS_GRACIA, PLANES, PLAN_GRATIS, dentroDelLimite, etiquetasLimite, limiteTexto, planPorId, type Limites, type Plan } from '../../src/modules/plans/plans'
import { PERMISOS_DUENO, type ModuloPyme } from '../../src/shared/permissions'
import { auth, type Usuario } from './auth'
import { comunasDe, dayOffset, diasEntre, fail, idDe, una, type Req } from './core'
import type { Row, Sql } from './db'

export type Pyme = {
  id: string; propietario_id: string; nombre_comercial: string; rut_empresa: string; rubro: 'veterinaria' | 'tienda' | 'peluqueria' | 'otro'; descripcion: string | null
  comuna_id: number; direccion: string | null; latitud: string | null; longitud: string | null; telefono: string | null; whatsapp: string | null
  horario: Record<string, string>; servicios: string[]; foto_portada: string | null; estado_verificacion: 'pendiente' | 'aprobada' | 'rechazada' | 'suspendida'; creado_en: string
  // 'publica': ficha con datos públicos, sin dueño ni RUT (propietario_id y rut_empresa son null en la base).
  origen: 'registro' | 'publica'
}
export const PYME = 'p.id, p.propietario_id, p.nombre_comercial, p.rut_empresa, p.rubro, p.descripcion, p.comuna_id, p.direccion, p.latitud, p.longitud, p.telefono, p.whatsapp, p.horario, p.servicios, p.foto_portada, p.estado_verificacion, p.creado_en, p.origen'
/** En Explorar: negocios validados y fichas con información pública (sin dueño, en gris y sin sello). */
export const EN_VITRINA = "(p.estado_verificacion = 'aprobada' or p.origen = 'publica')"
export type Suscripcion = { id: string; pyme_id: string; plan_id: number; inicio: string; fin: string; estado: 'pendiente' | 'activa' | 'vencida' | 'cancelada' }
export type Sucursal = {
  id: string; pyme_id: string; nombre: string; comuna_id: number; direccion: string | null; latitud: string | null; longitud: string | null; telefono: string | null; whatsapp: string | null
  horario: Record<string, string>; descripcion: string | null; servicios: string[]; creado_en: string
}
export type Miembro = { id: string; pyme_id: string; usuario_id: string; rol: 'jefe_local' | 'clinico'; sucursal_id: string | null; permisos: ModuloPyme[]; creado_en: string }
export type Item = {
  id: string; pyme_id: string; tipo: 'producto' | 'servicio'; nombre: string; descripcion: string | null; precio_referencial_clp: number | null
  disponible: boolean; categoria: string | null; sin_stock: boolean; oferta: Oferta | null; creado_en: string
}
export type Cupon = { codigo: string; titulo: string; descuento_pct: number; condiciones: string; hasta: string; ong: string; ong_id: string; negocio: string; pyme_id: string }

export const ITEM = 'i.id, i.pyme_id, i.tipo, i.nombre, i.descripcion, i.precio_referencial_clp, i.disponible, i.categoria, i.sin_stock, i.oferta_precio_clp, i.oferta_desde, i.oferta_hasta, i.creado_en'
// En la base la oferta son tres columnas; el API la entrega como el objeto del mock.
export function itemDe({ oferta_precio_clp, oferta_desde, oferta_hasta, ...i }: Row): Item {
  return { ...i, oferta: oferta_precio_clp == null ? null : { precio_clp: oferta_precio_clp, desde: oferta_desde, hasta: oferta_hasta } } as Item
}

export const ofertaVigente = (o: Oferta | null | undefined) => !!o && o.desde <= dayOffset(0) && o.hasta >= dayOffset(0)

// ---------- Plan vigente (RN-SUS) ----------
// Suscripción que rige hoy: la activa ya iniciada; una renovación pendiente o futura no reemplaza a la actual.
export function ultimaDe(subs: Suscripcion[]) {
  const s = [...subs].sort((a, b) => b.inicio.localeCompare(a.inicio)), hoy = dayOffset(0)
  return s.find(x => x.estado === 'activa' && x.inicio <= hoy) ?? s.find(x => x.estado === 'activa') ?? s.find(x => x.estado !== 'pendiente' && x.estado !== 'cancelada') ?? s[0]
}

// El plan pagado rige hasta su fin y durante los días de gracia; después la Pyme baja a Gratis sin borrar nada.
export type EstadoPlan = { plan: Plan; en_gracia: boolean; dias_mora: number; fin: string | null }
export function estadoPlanDe(subs: Suscripcion[]): EstadoPlan {
  const s = ultimaDe(subs)
  if (!s || s.estado !== 'activa' || s.inicio > dayOffset(0)) return { plan: PLAN_GRATIS, en_gracia: false, dias_mora: 0, fin: null }
  const mora = Math.max(0, diasEntre(s.fin, dayOffset(0)))
  if (mora === 0) return { plan: planPorId(s.plan_id), en_gracia: false, dias_mora: 0, fin: s.fin }
  return mora <= DIAS_GRACIA ? { plan: planPorId(s.plan_id), en_gracia: true, dias_mora: mora, fin: s.fin } : { plan: PLAN_GRATIS, en_gracia: false, dias_mora: mora, fin: s.fin }
}

export async function suscripcionesDe(sql: Sql, pymeIds: string[]) {
  const mapa = new Map<string, Suscripcion[]>(pymeIds.map(id => [id, []]))
  if (!pymeIds.length) return mapa
  for (const s of await sql<Suscripcion>('select id, pyme_id, plan_id, inicio, fin, estado from suscripciones where pyme_id = any($1::uuid[]) order by inicio', [pymeIds])) mapa.get(s.pyme_id)?.push(s)
  return mapa
}
export const estadoPlan = async (sql: Sql, pymeId: string) => estadoPlanDe((await suscripcionesDe(sql, [pymeId])).get(pymeId) ?? [])
export const planDe = async (sql: Sql, pymeId: string) => (await estadoPlan(sql, pymeId)).plan

export async function usoPyme(sql: Sql, pymeId: string): Promise<Record<keyof Limites, number>> {
  const r = await una(sql, `select
      (select count(*)::int from items_catalogo where pyme_id = $1) as items,
      (select count(*)::int + 1 from sucursales where pyme_id = $1) as sucursales,
      (select count(*)::int from miembros where pyme_id = $1) as usuarios,
      (select count(*)::int from items_catalogo where pyme_id = $1 and oferta_desde <= $2 and oferta_hasta >= $2) as ofertas,
      (select count(*)::int from banners where pyme_id = $1 and estado in ('pendiente', 'aprobado') and hasta >= $2) as banners,
      (select count(*)::int from convenios where pyme_id = $1 and estado not in ('rechazado', 'finalizado')) as convenios`, [pymeId, dayOffset(0)])
  return r as Record<keyof Limites, number>
}

// Falla con 422 y una invitación a mejorar el plan cuando crear algo más superaría el límite.
export async function exigirCupo(sql: Sql, pymeId: string, clave: keyof Limites, extra = 1) {
  const plan = await planDe(sql, pymeId), usados = (await usoPyme(sql, pymeId))[clave] + extra - 1
  if (!dentroDelLimite(usados, plan.limites[clave])) {
    const sig = PLANES.find(p => p.precio_mensual_clp > plan.precio_mensual_clp && dentroDelLimite(usados, p.limites[clave]))
    fail(422, `Tu plan ${plan.nombre} ${plan.limites[clave] === 0 ? 'no incluye' : `permite ${limiteTexto(plan.limites[clave])}`} ${etiquetasLimite[clave].toLowerCase()}.${sig ? ` Con el plan ${sig.nombre} puedes tener más.` : ''}`)
  }
}

// ---------- Multitenant: acceso de una cuenta a una Pyme ----------
export async function pymePorId(sql: Sql, id: unknown) {
  return una<Pyme>(sql, `select ${PYME} from pymes p where p.id = $1`, [idDe(id)])
}

// El dueño gestiona todos los módulos de su Pyme; el equipo, solo los que el dueño le asignó.
export async function permisosEnPyme(sql: Sql, u: Usuario, p: Pyme): Promise<{ permisos: ModuloPyme[]; miembro: Miembro | null } | null> {
  if (p.propietario_id === u.id && u.rol === 'pyme') return { permisos: PERMISOS_DUENO, miembro: null }
  const m = await una<Miembro>(sql, 'select * from miembros where pyme_id = $1 and usuario_id = $2', [p.id, u.id])
  return m ? { permisos: m.permisos, miembro: m } : null
}

// RBAC por módulo dentro del tenant: 403 si la cuenta no pertenece a la Pyme o no tiene ese módulo.
export async function miPyme(req: Req, modulo: ModuloPyme): Promise<Pyme> {
  const u = await auth(req, 'pyme', 'jefe_local', 'clinico')
  const p = await pymePorId(req.sql, req.params.id)
  if (!p) return fail(404, 'Pyme no encontrada')
  if (!(await permisosEnPyme(req.sql, u, p))?.permisos.includes(modulo)) return fail(403, 'Sin permiso')
  return p
}

// Veterinarias donde el usuario es personal clínico con el módulo Pacientes.
export async function clinicasDe(sql: Sql, u: Usuario) {
  return sql<Pyme>(`select ${PYME} from pymes p join miembros m on m.pyme_id = p.id where m.usuario_id = $1 and 'pacientes' = any(m.permisos) order by p.creado_en`, [u.id])
}

// ---------- Vitrina pública ----------
export type Vitrina = { subs: Map<string, Suscripcion[]>; items: Map<string, Item[]>; sucursales: Map<string, Sucursal[]>; cupones: Cupon[]; comunas: Map<number, string> }

const agrupar = <T extends { pyme_id: string }>(ids: string[], filas: T[]) => {
  const mapa = new Map<string, T[]>(ids.map(id => [id, []]))
  for (const f of filas) mapa.get(f.pyme_id)?.push(f)
  return mapa
}

// Cupones de convenios activos y vigentes, en el orden en que se crearon.
export async function cuponesVigentes(sql: Sql): Promise<Cupon[]> {
  const hoy = dayOffset(0)
  return sql<Cupon>(`select c.codigo, c.titulo, c.descuento_pct, c.condiciones, c.hasta, o.nombre as ong, c.ong_id, p.nombre_comercial as negocio, c.pyme_id
    from convenios c join ongs o on o.id = c.ong_id join pymes p on p.id = c.pyme_id
    where c.estado = 'activo' and c.desde <= $1 and c.hasta >= $1 order by c.creado_en`, [hoy])
}

export async function cargarVitrina(sql: Sql, pymes: Pyme[]): Promise<Vitrina> {
  const ids = pymes.map(p => p.id)
  const subs = await suscripcionesDe(sql, ids)
  const items = agrupar(ids, (await sql(`select ${ITEM} from items_catalogo i where i.pyme_id = any($1::uuid[]) and i.disponible order by i.creado_en`, [ids])).map(itemDe))
  const sucursales = agrupar(ids, await sql<Sucursal>('select * from sucursales where pyme_id = any($1::uuid[]) order by creado_en', [ids]))
  return { subs, items, sucursales, cupones: await cuponesVigentes(sql), comunas: await comunasDe(sql) }
}

// Se publican los primeros ítems hasta el límite del plan (los más antiguos), y solo tantas ofertas como permita.
export function itemsPublicosDe(items: Item[], plan: Plan) {
  const { limites } = plan
  let ofertas = 0
  return items.slice(0, limites.items ?? undefined).map(i => ofertaVigente(i.oferta) && (limites.ofertas === null || ofertas++ < limites.ofertas) ? i : { ...i, oferta: null })
}

// Sucursales visibles según el plan. Sin «perfil por sucursal», cada sucursal muestra la descripción y servicios de la empresa.
function sucursalesPublicasDe(p: Pyme, sucursales: Sucursal[], plan: Plan, comunas: Map<number, string>) {
  return sucursales.slice(0, Math.max(0, (plan.limites.sucursales ?? Infinity) - 1)).map(s => ({
    id: s.id, nombre: s.nombre, comuna: comunas.get(s.comuna_id) ?? '', direccion: s.direccion, latitud: s.latitud, longitud: s.longitud, telefono: s.telefono, whatsapp: s.whatsapp, horario: s.horario,
    descripcion: plan.beneficios.perfil_sucursal ? s.descripcion : null, servicios: plan.beneficios.perfil_sucursal && s.servicios.length ? s.servicios : p.servicios ?? [],
  }))
}

export function pymeResumenDe(p: Pyme, v: Vitrina) {
  const plan = estadoPlanDe(v.subs.get(p.id) ?? []).plan
  return {
    id: p.id, nombre_comercial: p.nombre_comercial, rubro: p.rubro, descripcion: p.descripcion, comuna_id: p.comuna_id, comuna: v.comunas.get(p.comuna_id) ?? '',
    direccion: p.direccion, latitud: p.latitud, longitud: p.longitud, telefono: p.telefono, whatsapp: p.whatsapp, horario: p.horario,
    foto_portada: plan.beneficios.portada ? p.foto_portada ?? null : null,
    servicios: p.servicios ?? [], ofertas: itemsPublicosDe(v.items.get(p.id) ?? [], plan).filter(i => ofertaVigente(i.oferta)).length, destacado: plan.beneficios.destacado,
    sucursales: sucursalesPublicasDe(p, v.sucursales.get(p.id) ?? [], plan, v.comunas), cupones: v.cupones.filter(c => c.pyme_id === p.id), sin_reclamar: p.origen === 'publica',
  }
}

export async function pymeResumen(sql: Sql, p: Pyme) {
  return pymeResumenDe(p, await cargarVitrina(sql, [p]))
}
