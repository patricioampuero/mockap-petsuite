// Directorio, alta y gestión de Pymes: perfil, consultas de clientes, catálogo, métricas y suscripción.
import { z } from 'zod'
import type { Oferta } from '../../src/shared/api'
import { DIAS_PERIODO, PLANES, PLAN_GRATIS, planPorId, type Plan } from '../../src/modules/plans/plans'
import { businessContactSchema, businessProfileSchema, businessReplySchema } from '../../src/shared/validators'
import { crearCobro } from '../../src/mock/orcob'
import { auth, avisarAsesores, correoDe, enviarCorreo, orcobDisponible } from './auth'
import { comunasDe, dayOffset, fail, fecha, hace, idDe, now, on, parse, uid, una } from './core'
import type { Sql } from './db'
import { CONSULTAS_NO_DISPONIBLES } from '../../src/shared/fichas'
import { documentosDe } from './documentos'
import { DIAS_EVENTOS_CAMPANAS, kpisNegocio, type EventoKpi } from '../../src/shared/kpis'
import { avisoSolicitud, correoSolicitudPlan, MERCADO_PAGO_NO_DISPONIBLE, ORCOB_NO_DISPONIBLE, PAGO_ANTERIOR_RECIBIDO, SOLO_ORCOB_CONFIRMA, type CanalPago } from '../../src/shared/pagos'
import { crearPreferencia, mercadoPagoDisponible, verificarPagoMp } from './mercadopago'
import {
  cargarVitrina, EN_VITRINA, estadoPlanDe, exigirCupo, ITEM, itemDe, itemsPublicosDe, miPyme, ofertaVigente, permisosEnPyme, planDe, PYME, pymeResumen, pymeResumenDe,
  suscripcionesDe, ultimaDe, usoPyme, type Item, type Pyme, type Suscripcion,
} from './negocio'

export type Pago = { id: string; suscripcion_id: string; monto_clp: number; canal: CanalPago; referencia: string | null; codigo_orcob: string | null; estado: 'pendiente' | 'confirmado' | 'rechazado'; pagado_en: string }

export const pagoPendiente = (sql: Sql, pymeId: string) => una<Pago>(sql, `select pg.* from pagos pg join suscripciones s on s.id = pg.suscripcion_id
  where s.pyme_id = $1 and pg.estado = 'pendiente' order by pg.pagado_en limit 1`, [pymeId])

// Directorio: la comuna coincide con la casa matriz o con cualquier sucursal visible. Oro primero, luego Plata, luego el resto.
on('GET', '/pymes', async req => {
  const comuna = req.query.get('comuna'), rubro = req.query.get('rubro')
  const pymes = await req.sql<Pyme>(`select ${PYME} from pymes p where ${EN_VITRINA}${rubro ? ' and p.rubro = $1' : ''} order by p.creado_en`, rubro ? [rubro] : [])
  const v = await cargarVitrina(req.sql, pymes)
  return pymes.map(p => pymeResumenDe(p, v))
    .filter(r => !comuna || r.comuna === comuna || r.sucursales.some(s => s.comuna === comuna))
    .sort((a, b) => b.destacado - a.destacado || a.nombre_comercial.localeCompare(b.nombre_comercial))
})

on('GET', '/pymes/mias', async req => {
  const u = await auth(req, 'pyme', 'jefe_local', 'clinico')
  const pymes = await req.sql<Pyme>(`select ${PYME} from pymes p
    where (p.propietario_id = $1 and $2 = 'pyme') or exists (select 1 from miembros m where m.pyme_id = p.id and m.usuario_id = $1) order by p.creado_en`, [u.id, u.rol])
  const subs = await suscripcionesDe(req.sql, pymes.map(p => p.id))
  const resultado = []
  for (const p of pymes) {
    const acceso = await permisosEnPyme(req.sql, u, p)
    if (!acceso) continue
    const lista = subs.get(p.id) ?? [], s = ultimaDe(lista), estado = estadoPlanDe(lista)
    const pagado = s && s.estado !== 'pendiente' && s.estado !== 'cancelada' ? planPorId(s.plan_id) : null
    const sucursal = acceso.miembro?.sucursal_id ? await una<{ id: string; nombre: string }>(req.sql, 'select id, nombre from sucursales where id = $1', [acceso.miembro.sucursal_id]) : null
    resultado.push({
      id: p.id, nombre_comercial: p.nombre_comercial, rubro: p.rubro, estado_verificacion: p.estado_verificacion, comuna_id: p.comuna_id, solicitud_pendiente: !!(await pagoPendiente(req.sql, p.id)),
      documentos_faltan: (await documentosDe(req.sql, p)).faltan,
      rol_interno: acceso.miembro?.rol ?? 'dueno', sucursal: sucursal ? { id: sucursal.id, nombre: sucursal.nombre } : null, permisos: acceso.permisos,
      plan: estado.plan, en_gracia: estado.en_gracia, dias_mora: estado.dias_mora, uso: await usoPyme(req.sql, p.id),
      suscripcion: s && pagado ? { estado: s.estado, fin: s.fin, plan: pagado.nombre, plan_id: pagado.id, precio: pagado.precio_mensual_clp, max_items: estado.plan.limites.items } : null,
    })
  }
  return resultado
})

on('POST', '/pymes', async req => {
  const u = await auth(req, 'pyme')
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
    canal_pago: z.enum(['transferencia', 'orcob', 'mercadopago']).default('transferencia'),
    referencia_pago: z.string().max(60).optional(),
  }), req.body)
  if (await una(req.sql, 'select 1 from pymes where lower(rut_empresa) = lower($1)', [d.rut_empresa])) return fail(409, 'Ese RUT de empresa ya está registrado')
  const plan = PLANES.find(p => p.id === d.plan_id)
  if (!plan) return fail(400, 'Plan no disponible')
  const comunas = await comunasDe(req.sql)
  if (!comunas.has(d.comuna_id)) return fail(400, 'Comuna no válida')
  if (plan.precio_mensual_clp > 0 && d.canal_pago === 'orcob' && !orcobDisponible()) return fail(422, ORCOB_NO_DISPONIBLE)
  if (plan.precio_mensual_clp > 0 && d.canal_pago === 'mercadopago' && !mercadoPagoDisponible()) return fail(422, MERCADO_PAGO_NO_DISPONIBLE)
  const p: Pyme = {
    id: uid(), propietario_id: u.id, nombre_comercial: d.nombre_comercial, rut_empresa: d.rut_empresa, rubro: d.rubro, descripcion: d.descripcion ?? null, comuna_id: d.comuna_id,
    direccion: d.direccion ?? null, latitud: d.latitud != null ? String(d.latitud) : null, longitud: d.longitud != null ? String(d.longitud) : null,
    telefono: d.telefono ?? null, whatsapp: d.whatsapp ?? null, horario: {}, servicios: [], foto_portada: null, estado_verificacion: 'pendiente', creado_en: now(), origen: 'registro',
  }
  await req.sql(`insert into pymes (id, propietario_id, nombre_comercial, rut_empresa, rubro, descripcion, comuna_id, direccion, latitud, longitud, telefono, whatsapp, estado_verificacion, creado_en)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
  [p.id, p.propietario_id, p.nombre_comercial, p.rut_empresa, p.rubro, p.descripcion, p.comuna_id, p.direccion, p.latitud, p.longitud, p.telefono, p.whatsapp, p.estado_verificacion, p.creado_en])
  // Gratis no genera cobro: la Pyme queda en plan Gratis al aprobarse. Un plan pagado espera la verificación del pago.
  const cobro = plan.precio_mensual_clp > 0 ? await registrarPago(req.sql, p, plan, dayOffset(0), d.canal_pago, d.canal_pago === 'transferencia' ? d.referencia_pago || null : null) : null
  // El equipo revisa la solicitud; la Pyme recibe cómo pagar si eligió un plan por transferencia.
  const aviso = avisoSolicitud('alta', p.nombre_comercial, p.rut_empresa, comunas.get(p.comuna_id) ?? '', plan.nombre, plan.precio_mensual_clp, d.canal_pago, cobro?.canal === 'transferencia' ? cobro.referencia : null)
  await avisarAsesores(req.sql, aviso.asunto, aviso.cuerpo)
  if (cobro?.canal === 'transferencia') {
    const c = correoSolicitudPlan(p.nombre_comercial, plan.nombre, plan.precio_mensual_clp, !!cobro.referencia)
    await enviarCorreo(req.sql, u.correo, c.asunto, c.cuerpo, 'cobranza')
  }
  // Mercado Pago: la Pyme paga en su página y vuelve a la app. Si la preferencia falla, el alta entera se deshace.
  const pago_url = cobro?.canal === 'mercadopago' ? await abrirPagoMp(req.sql, cobro.id, p, plan, u.correo) : null
  return { id: p.id, estado_verificacion: p.estado_verificacion, codigo_orcob: cobro?.codigo_orcob ?? null, pago_url }
})

async function abrirPagoMp(sql: Sql, pagoId: string, p: Pyme, plan: Plan, correo: string) {
  const pref = await crearPreferencia(pagoId, plan, plan.precio_mensual_clp, p.nombre_comercial, correo)
  await sql('update pagos set referencia = $2 where id = $1', [pagoId, pref.preferencia])
  return pref.url
}

// Crea el periodo pendiente y su pago. Por Orcob se emite un código de recaudación; por transferencia se registra la referencia.
async function registrarPago(sql: Sql, p: Pyme, plan: Plan, inicio: string, canal: CanalPago, referencia: string | null) {
  const fin = new Date(`${inicio}T12:00:00Z`); fin.setUTCDate(fin.getUTCDate() + DIAS_PERIODO)
  const s: Suscripcion = { id: uid(), pyme_id: p.id, plan_id: plan.id, inicio, fin: fin.toISOString().slice(0, 10), estado: 'pendiente' }
  await sql('insert into suscripciones (id, pyme_id, plan_id, inicio, fin, estado) values ($1, $2, $3, $4, $5, $6)', [s.id, s.pyme_id, s.plan_id, s.inicio, s.fin, s.estado])
  const orcob = canal === 'orcob' ? crearCobro({ rut_empresa: p.rut_empresa, monto_clp: plan.precio_mensual_clp, glosa: `PetSuite plan ${plan.nombre} ${s.inicio}` }) : null
  const pago: Pago = { id: uid(), suscripcion_id: s.id, monto_clp: plan.precio_mensual_clp, canal, referencia: orcob ? orcob.id_cobro : referencia, codigo_orcob: orcob?.codigo_pago ?? null, estado: 'pendiente', pagado_en: now() }
  await sql('insert into pagos (id, suscripcion_id, monto_clp, canal, referencia, codigo_orcob, estado, pagado_en) values ($1, $2, $3, $4, $5, $6, $7, $8)',
    [pago.id, pago.suscripcion_id, pago.monto_clp, pago.canal, pago.referencia, pago.codigo_orcob, pago.estado, pago.pagado_en])
  return { suscripcion: s, ...pago }
}

on('GET', '/pymes/:id', async req => {
  const p = await una<Pyme>(req.sql, `select ${PYME} from pymes p where p.id = $1 and ${EN_VITRINA}`, [idDe(req.params.id)])
  if (!p) return fail(404, 'No encontrada')
  await req.sql("insert into eventos_pyme (pyme_id, tipo, ocurrido_en) values ($1, 'visita_perfil', $2)", [p.id, now()])
  const v = await cargarVitrina(req.sql, [p])
  // Las ofertas se muestran solo mientras están vigentes (y dentro del cupo del plan), y primero.
  const catalogo = itemsPublicosDe(v.items.get(p.id) ?? [], estadoPlanDe(v.subs.get(p.id) ?? []).plan)
    .map(i => ({ id: i.id, tipo: i.tipo, nombre: i.nombre, descripcion: i.descripcion, precio_referencial_clp: i.precio_referencial_clp, categoria: i.categoria, sin_stock: i.sin_stock, oferta: ofertaVigente(i.oferta) ? i.oferta : null }))
    .sort((a, b) => Number(!!b.oferta) - Number(!!a.oferta) || (a.categoria ?? '').localeCompare(b.categoria ?? '') || a.nombre.localeCompare(b.nombre))
  return { ...pymeResumenDe(p, v), catalogo }
})

on('POST', '/pymes/:id/eventos', async req => {
  const d = parse(z.object({ tipo: z.enum(['vista_item', 'clic_contacto', 'clic_whatsapp']), item_id: z.string().optional() }), req.body)
  // Un ítem que no es de este negocio se registra sin ítem (las métricas solo cuentan ítems existentes).
  await req.sql(`insert into eventos_pyme (pyme_id, item_id, tipo, ocurrido_en)
    select p.id, (select i.id from items_catalogo i where i.id = $2 and i.pyme_id = p.id), $3, $4 from pymes p where p.id = $1 and ${EN_VITRINA}`,
  [idDe(req.params.id), idDe(d.item_id), d.tipo, now()])
  return { ok: true }
})

const perfilCompleto = async (sql: Sql, p: Pyme) => ({ ...(await pymeResumen(sql, p)), foto_portada: p.foto_portada ?? null, rut_empresa: p.rut_empresa, estado_verificacion: p.estado_verificacion })

on('GET', '/pymes/:id/perfil', async req => perfilCompleto(req.sql, await miPyme(req, 'perfil')))

on('PATCH', '/pymes/:id/perfil', async req => {
  const p = await miPyme(req, 'perfil')
  const d = parse(businessProfileSchema, req.body)
  if (!(await comunasDe(req.sql)).has(d.comuna_id)) return fail(400, 'Comuna no válida')
  if (d.foto_portada && d.foto_portada !== p.foto_portada && !(await planDe(req.sql, p.id)).beneficios.portada) return fail(422, 'La portada propia está disponible desde el plan Bronce')
  Object.assign(p, {
    nombre_comercial: d.nombre_comercial, descripcion: d.descripcion || null, comuna_id: d.comuna_id,
    direccion: d.direccion || null, telefono: d.telefono || null, whatsapp: d.whatsapp || null,
    latitud: d.latitud === null ? null : String(d.latitud), longitud: d.longitud === null ? null : String(d.longitud),
    // Los días vacíos se omiten: el directorio los muestra como cerrados.
    horario: Object.fromEntries(Object.entries(d.horario).filter(([, h]) => h)), servicios: [...new Set(d.servicios)], foto_portada: d.foto_portada,
  })
  await req.sql(`update pymes set nombre_comercial = $2, descripcion = $3, comuna_id = $4, direccion = $5, telefono = $6, whatsapp = $7, latitud = $8, longitud = $9,
    horario = $10::jsonb, servicios = $11::text[], foto_portada = $12 where id = $1`,
  [p.id, p.nombre_comercial, p.descripcion, p.comuna_id, p.direccion, p.telefono, p.whatsapp, p.latitud, p.longitud, JSON.stringify(p.horario), p.servicios, p.foto_portada])
  return perfilCompleto(req.sql, p)
})

// ---------- Consultas de clientes ----------
on('POST', '/pymes/:id/contactos', async req => {
  const u = await auth(req, 'tutor')
  // Una ficha pública no tiene a nadie del local que lea la consulta.
  if (await una(req.sql, "select 1 from pymes where id = $1 and origen = 'publica'", [idDe(req.params.id)])) return fail(422, CONSULTAS_NO_DISPONIBLES)
  const p = await una<{ id: string }>(req.sql, "select id from pymes where id = $1 and estado_verificacion = 'aprobada'", [idDe(req.params.id)])
  if (!p) return fail(404, 'Negocio no disponible')
  const d = parse(businessContactSchema, req.body)
  const id = uid()
  await req.sql("insert into contactos_pymes (id, pyme_id, remitente_id, remitente_nombre, remitente_contacto, mensaje, estado, creado_en) values ($1, $2, $3, $4, $5, $6, 'nuevo', $7)",
    [id, p.id, u.id, u.nombre_visible, d.contacto || null, d.mensaje, now()])
  return { id }
})

on('GET', '/pymes/:id/contactos', async req => {
  const p = await miPyme(req, 'contactos')
  return req.sql('select * from contactos_pymes where pyme_id = $1 order by creado_en desc', [p.id])
})

on('PATCH', '/pymes/:id/contactos/:contactId', async req => {
  const p = await miPyme(req, 'contactos')
  const contacto = await una(req.sql, 'select * from contactos_pymes where id = $1 and pyme_id = $2 for update', [idDe(req.params.contactId), p.id])
  if (!contacto) return fail(404, 'Contacto no encontrado')
  const d = parse(z.discriminatedUnion('estado', [
    z.object({ estado: z.literal('leido') }),
    z.object({ estado: z.literal('respondido'), respuesta: businessReplySchema.shape.respuesta }),
  ]), req.body)
  if (d.estado === 'leido') {
    if (contacto.estado !== 'nuevo') return fail(409, 'Este mensaje ya fue revisado')
    return una(req.sql, "update contactos_pymes set estado = 'leido' where id = $1 returning *", [contacto.id])
  }
  return una(req.sql, "update contactos_pymes set estado = 'respondido', respuesta = $2, respondido_en = $3 where id = $1 returning *", [contacto.id, d.respuesta, now()])
})

on('GET', '/mis-contactos-pyme', async req => {
  const u = await auth(req, 'tutor')
  return req.sql(`select c.id, coalesce(nullif(p.nombre_comercial, ''), 'Negocio') as negocio, c.mensaje, c.respuesta, c.estado, c.creado_en
    from contactos_pymes c join pymes p on p.id = c.pyme_id where c.remitente_id = $1 order by c.creado_en desc`, [u.id])
})

// ---------- Catálogo referencial ----------
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

const guardarItem = (sql: Sql, i: Item) => sql(`insert into items_catalogo (id, pyme_id, tipo, nombre, descripcion, precio_referencial_clp, disponible, categoria, sin_stock, oferta_precio_clp, oferta_desde, oferta_hasta, creado_en)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  on conflict (id) do update set tipo = excluded.tipo, nombre = excluded.nombre, descripcion = excluded.descripcion, precio_referencial_clp = excluded.precio_referencial_clp,
    disponible = excluded.disponible, categoria = excluded.categoria, sin_stock = excluded.sin_stock, oferta_precio_clp = excluded.oferta_precio_clp,
    oferta_desde = excluded.oferta_desde, oferta_hasta = excluded.oferta_hasta`,
[i.id, i.pyme_id, i.tipo, i.nombre, i.descripcion, i.precio_referencial_clp, i.disponible, i.categoria, i.sin_stock, i.oferta?.precio_clp ?? null, i.oferta?.desde ?? null, i.oferta?.hasta ?? null, i.creado_en])

on('GET', '/pymes/:id/catalogo', async req => {
  const p = await miPyme(req, 'catalogo')
  return (await req.sql(`select ${ITEM} from items_catalogo i where i.pyme_id = $1 order by i.creado_en desc`, [p.id])).map(itemDe)
})

on('POST', '/pymes/:id/catalogo', async req => {
  const p = await miPyme(req, 'catalogo')
  const d = parse(itemSchema, req.body)
  await exigirCupo(req.sql, p.id, 'items')
  validarOferta(d.precio_referencial_clp ?? null, d.oferta)
  if (ofertaVigente(d.oferta)) await exigirCupo(req.sql, p.id, 'ofertas')
  // Si la Pyme aún no está verificada el ítem se guarda, pero no se publica.
  const item: Item = {
    id: uid(), pyme_id: p.id, tipo: d.tipo, nombre: d.nombre, descripcion: d.descripcion || null, precio_referencial_clp: d.precio_referencial_clp ?? null,
    disponible: (d.disponible ?? true) && p.estado_verificacion === 'aprobada', categoria: d.categoria || null, sin_stock: d.sin_stock ?? false, oferta: d.oferta ?? null, creado_en: now(),
  }
  await guardarItem(req.sql, item)
  return item
})

// Los campos omitidos se conservan; null los borra (por ejemplo, oferta: null quita la oferta).
on('PUT', '/pymes/:id/catalogo/:itemId', async req => {
  const p = await miPyme(req, 'catalogo')
  const d = parse(itemSchema, req.body)
  const fila = await una(req.sql, `select ${ITEM} from items_catalogo i where i.id = $1 and i.pyme_id = $2 for update`, [idDe(req.params.itemId), p.id])
  if (!fila) return fail(404, 'Ítem no encontrado')
  const item = itemDe(fila)
  if (d.oferta && ofertaVigente(d.oferta) && !ofertaVigente(item.oferta)) await exigirCupo(req.sql, p.id, 'ofertas')
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
  await guardarItem(req.sql, item)
  return item
})

on('DELETE', '/pymes/:id/catalogo/:itemId', async req => {
  const p = await miPyme(req, 'catalogo')
  const filas = await req.sql('delete from items_catalogo where id = $1 and pyme_id = $2 returning id', [idDe(req.params.itemId), p.id])
  if (!filas.length) return fail(404, 'Ítem no encontrado')
  return undefined
})

// ---------- Métricas ----------
// El nivel de detalle depende del plan: Gratis y Bronce ven totales; Plata suma canales e ítems; Oro, también sucursales y convenios.
type TipoEvento = 'visita_perfil' | 'vista_item' | 'clic_contacto' | 'clic_whatsapp'
on('GET', '/pymes/:id/metricas', async req => {
  const p = await miPyme(req, 'metricas')
  const plan = await planDe(req.sql, p.id), nivel = plan.beneficios.metricas
  const desde = hace(30), previo = hace(60)
  const eventos = await req.sql<{ tipo: TipoEvento; ocurrido_en: string; item: string | null }>(`select e.tipo, e.ocurrido_en, i.nombre as item from eventos_pyme e
    left join items_catalogo i on i.id = e.item_id where e.pyme_id = $1 and e.ocurrido_en > $2 order by e.ocurrido_en, e.id`, [p.id, previo])
  // Mismo conteo para los 30 días anteriores, para comparar.
  const anteriores = { visita_perfil: 0, vista_item: 0, clic_contacto: 0, clic_whatsapp: 0 }
  const totales = { visita_perfil: 0, vista_item: 0, clic_contacto: 0, clic_whatsapp: 0 }
  const dias = new Map<string, number>(), vistas = new Map<string, number>()
  for (const e of eventos) {
    if (e.ocurrido_en <= desde) { anteriores[e.tipo]++; continue }
    totales[e.tipo]++
    const dia = e.ocurrido_en.slice(0, 10)
    dias.set(dia, (dias.get(dia) ?? 0) + 1)
    if (e.tipo === 'vista_item' && e.item) vistas.set(e.item, (vistas.get(e.item) ?? 0) + 1)
  }
  const canjes30 = await req.sql<{ sucursal_id: string | null }>('select k.sucursal_id from canjes k join convenios c on c.id = k.convenio_id where c.pyme_id = $1 and k.ocurrido_en > $2', [p.id, desde])
  const items = (await req.sql(`select ${ITEM} from items_catalogo i where i.pyme_id = $1 and i.disponible order by i.creado_en`, [p.id])).map(itemDe)
  const sucursales = nivel === 'avanzadas' ? await req.sql<{ id: string; nombre: string }>('select id, nombre from sucursales where pyme_id = $1 order by creado_en', [p.id]) : []
  // KPI de negocio (src/shared/kpis.ts): franja horaria, cupones más usados e impacto de las campañas con ONG.
  const ultimos30 = eventos.filter(e => e.ocurrido_en > desde)
  const visitasLargas = await req.sql<EventoKpi>("select tipo, ocurrido_en from eventos_pyme where pyme_id = $1 and tipo = 'visita_perfil' and ocurrido_en > $2 order by ocurrido_en, id", [p.id, hace(DIAS_EVENTOS_CAMPANAS)])
  const convenios = await req.sql<{ id: string; codigo: string; titulo: string; estado: string; desde: string; ong: string }>(`select c.id, c.codigo, c.titulo, c.estado, c.desde, o.nombre as ong
    from convenios c join ongs o on o.id = c.ong_id where c.pyme_id = $1 and c.estado <> 'rechazado' order by c.creado_en, c.id`, [p.id])
  const canjes = await req.sql<{ convenio_id: string; ocurrido_en: string }>('select k.convenio_id, k.ocurrido_en from canjes k join convenios c on c.id = k.convenio_id where c.pyme_id = $1', [p.id])
  const kpis = kpisNegocio(nivel, totales, ultimos30, visitasLargas, convenios, canjes, desde)
  return {
    ...kpis,
    nivel,
    totales,
    anteriores,
    ofertas_vigentes: itemsPublicosDe(items, plan).filter(i => ofertaVigente(i.oferta)).length,
    por_dia: [...dias].sort(([a], [b]) => a.localeCompare(b)).map(([dia, n]) => ({ dia, eventos: n })),
    items_mas_vistos: nivel === 'basicas' ? [] : [...vistas].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nombre, n]) => ({ nombre, vistas: n })),
    canjes_30d: canjes30.length,
    por_sucursal: nivel !== 'avanzadas' ? [] : [{ id: null, nombre: 'Casa matriz' }, ...sucursales].map(s => ({ nombre: s.nombre, canjes: canjes30.filter(c => c.sucursal_id === s.id).length })),
  }
})

// ---------- Suscripción ----------
on('GET', '/pymes/:id/suscripcion', async req => {
  const p = await miPyme(req, 'suscripcion')
  const subs = [...(await suscripcionesDe(req.sql, [p.id])).get(p.id)!].sort((a, b) => b.inicio.localeCompare(a.inicio))
  const pagos = await req.sql<Pago>('select pg.* from pagos pg join suscripciones s on s.id = pg.suscripcion_id where s.pyme_id = $1 order by pg.pagado_en', [p.id])
  return subs.map(s => {
    const plan = planPorId(s.plan_id)
    return {
      id: s.id, estado: s.estado, inicio: s.inicio, fin: s.fin, plan: plan.nombre, plan_codigo: plan.codigo, precio_mensual_clp: plan.precio_mensual_clp, max_items_catalogo: plan.limites.items,
      pagos: pagos.filter(pg => pg.suscripcion_id === s.id).map(pg => ({ id: pg.id, monto_clp: pg.monto_clp, estado: pg.estado, canal: pg.canal, referencia: pg.referencia, codigo_orcob: pg.codigo_orcob ?? null })),
    }
  })
})

// Contratar, renovar o cambiar de plan. Transferencia: la confirma un asesor. Orcob: se confirma al recibir el aviso de pago.
// El nuevo periodo empieza cuando termina el vigente, así no se pierden días ya pagados.
on('POST', '/pymes/:id/suscripcion', async req => {
  const p = await miPyme(req, 'suscripcion')
  const d = parse(z.object({
    plan_id: z.number().int().positive(),
    canal: z.enum(['transferencia', 'orcob', 'mercadopago']).default('transferencia'),
    // Opcional: la Pyme puede pedir el plan y transferir después de recibir los datos; el asesor confirma el pago.
    referencia_pago: z.string().trim().max(60).optional(),
  }), req.body)
  if (d.canal === 'orcob' && !orcobDisponible()) return fail(422, ORCOB_NO_DISPONIBLE)
  if (d.canal === 'mercadopago' && !mercadoPagoDisponible()) return fail(422, MERCADO_PAGO_NO_DISPONIBLE)
  if (p.estado_verificacion !== 'aprobada') return fail(422, 'Tu negocio debe estar verificado para renovar o cambiar de plan')
  const anterior = await pagoPendiente(req.sql, p.id)
  // Un pago con Mercado Pago que no se completó se reemplaza por la nueva solicitud, salvo que ya se haya pagado.
  if (anterior?.canal === 'mercadopago' && mercadoPagoDisponible()) {
    // Si ya estaba pagado se confirma y se responde con éxito: un error desharía la confirmación (la ruta es una transacción).
    if (await verificarPagoMp(req.sql, anterior.id)) {
      const s = (await una<Suscripcion>(req.sql, 'select * from suscripciones where id = $1', [anterior.suscripcion_id]))!
      return { id: s.id, inicio: s.inicio, fin: s.fin, pago_id: anterior.id, codigo_orcob: null, pago_url: null, aviso: PAGO_ANTERIOR_RECIBIDO }
    }
    await req.sql("update pagos set estado = 'rechazado' where id = $1", [anterior.id])
    await req.sql("update suscripciones set estado = 'cancelada' where id = $1 and estado = 'pendiente'", [anterior.suscripcion_id])
  } else if (anterior) return fail(409, 'Ya tienes una solicitud de pago en revisión')
  const plan = PLANES.find(x => x.id === d.plan_id)
  if (!plan) return fail(400, 'Plan no disponible')
  if (plan.precio_mensual_clp === 0) return fail(422, 'El plan Gratis no requiere pago: rige automáticamente cuando termina tu periodo pagado')
  const actual = await una<Suscripcion>(req.sql, "select * from suscripciones where pyme_id = $1 and estado = 'activa' order by fin desc limit 1", [p.id])
  const inicio = actual && actual.fin > dayOffset(0) ? actual.fin : dayOffset(0)
  const r = await registrarPago(req.sql, p, plan, inicio, d.canal, d.canal === 'transferencia' ? d.referencia_pago || null : null)
  // Mercado Pago se confirma solo: el equipo no tiene nada que revisar.
  if (d.canal !== 'mercadopago') {
    const aviso = avisoSolicitud('plan', p.nombre_comercial, p.rut_empresa, '', plan.nombre, plan.precio_mensual_clp, d.canal, d.canal === 'transferencia' ? r.referencia : null)
    await avisarAsesores(req.sql, aviso.asunto, aviso.cuerpo)
  }
  if (d.canal === 'transferencia') {
    const c = correoSolicitudPlan(p.nombre_comercial, plan.nombre, plan.precio_mensual_clp, !!r.referencia)
    await enviarCorreo(req.sql, await correoDe(req.sql, p.propietario_id), c.asunto, c.cuerpo, 'cobranza')
  }
  const pago_url = d.canal === 'mercadopago' ? await abrirPagoMp(req.sql, r.id, p, plan, await correoDe(req.sql, p.propietario_id)) : null
  return { id: r.suscripcion.id, inicio: r.suscripcion.inicio, fin: r.suscripcion.fin, pago_id: r.id, codigo_orcob: r.codigo_orcob, pago_url }
})

// Demostración del aviso (webhook) de Orcob: confirma el pago y activa el periodo sin intervención del asesor.
// Solo existe con Orcob simulado: en la versión real nadie puede activar un plan con esta ruta.
on('POST', '/pymes/:id/pagos/:pagoId/orcob-confirmado', async req => {
  const p = await miPyme(req, 'suscripcion')
  if (!orcobDisponible()) return fail(403, SOLO_ORCOB_CONFIRMA)
  const pago = await una<Pago>(req.sql, "select pg.* from pagos pg join suscripciones s on s.id = pg.suscripcion_id where pg.id = $1 and pg.canal = 'orcob' and pg.estado = 'pendiente' and s.pyme_id = $2 for update", [idDe(req.params.pagoId), p.id])
  const s = pago && await una<Suscripcion>(req.sql, 'select * from suscripciones where id = $1', [pago.suscripcion_id])
  if (!pago || !s) return fail(404, 'No hay un cobro Orcob pendiente con ese identificador')
  await activarPeriodo(req.sql, p, s)
  await req.sql("update pagos set estado = 'confirmado', pagado_en = $2 where id = $1", [pago.id, now()])
  await enviarCorreo(req.sql, await correoDe(req.sql, p.propietario_id), `Pago recibido: plan ${planPorId(s.plan_id).nombre}`, `Orcob informó el pago de ${pago.monto_clp.toLocaleString('es-CL')} CLP (cobro ${pago.referencia}).\nTu plan rige del ${s.inicio} al ${s.fin}.\n\nEquipo PetSuite`, 'aprobacion')
  return { ok: true, inicio: s.inicio, fin: s.fin }
})

// Una renovación respeta el periodo pedido; un alta o reactivación vencida parte hoy.
export async function activarPeriodo(sql: Sql, p: Pyme, s: Suscripcion) {
  if (s.inicio < dayOffset(0) || p.estado_verificacion !== 'aprobada') Object.assign(s, { inicio: dayOffset(0), fin: dayOffset(DIAS_PERIODO) })
  s.estado = 'activa'
  await sql('update suscripciones set inicio = $2, fin = $3, estado = $4 where id = $1', [s.id, s.inicio, s.fin, s.estado])
}
