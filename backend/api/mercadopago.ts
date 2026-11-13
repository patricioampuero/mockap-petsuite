// Pago de los planes con Mercado Pago (Checkout Pro). Se activa con MP_ACCESS_TOKEN: con credenciales de prueba
// (TEST-…) cobra con las tarjetas de prueba de Mercado Pago; con las de producción, de verdad.
//
// Flujo: el API crea una preferencia con el monto del plan y external_reference = id del pago en PetSuite; la Pyme
// paga en Mercado Pago y vuelve a la app. Mercado Pago avisa al webhook y, por si ese aviso tarda, la app pide
// verificar al volver. En ambos casos el API vuelve a consultar el pago a Mercado Pago con su token y solo activa
// el plan si está aprobado, por el monto exacto y en pesos: un aviso falso no puede activar nada.
import { planPorId, type Plan } from '../../src/modules/plans/plans'
import { ApiError } from '../../src/shared/errors'
import { correoPagoMercadoPago, MERCADO_PAGO_CAIDO, MERCADO_PAGO_NO_DISPONIBLE, retornoMercadoPago, SIN_PAGO_MP } from '../../src/shared/pagos'
import { baseApp, correoDe, enviarCorreo } from './auth'
import { fail, idDe, now, on, una } from './core'
import type { Sql } from './db'
import { miPyme, PYME, type Pyme, type Suscripcion } from './negocio'
import { activarPeriodo } from './pymes'

export const mercadoPagoDisponible = () => !!process.env.MP_ACCESS_TOKEN
const apiMp = () => (process.env.MP_API_URL || 'https://api.mercadopago.com').replace(/\/+$/, '')
const esPrueba = () => (process.env.MP_ACCESS_TOKEN ?? '').startsWith('TEST-')

/** Pago de Mercado Pago, con los campos que usa PetSuite. */
export type PagoMp = { id: number | string; status: string; external_reference: string | null; transaction_amount: number; currency_id: string }

async function mp<T>(ruta: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let r: Response
  try {
    r = await fetch(`${apiMp()}${ruta}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    console.error('Mercado Pago no respondió:', error)
    throw new ApiError(MERCADO_PAGO_CAIDO, 502)
  }
  if (!r.ok) {
    console.error(`Mercado Pago respondió ${r.status} en ${ruta}:`, await r.text().catch(() => ''))
    throw new ApiError(MERCADO_PAGO_CAIDO, 502)
  }
  return r.json() as Promise<T>
}

/**
 * Crea la preferencia de Checkout Pro y devuelve la dirección donde la Pyme paga. Vence en 3 días: una solicitud
 * olvidada no se puede pagar semanas después. El aviso (notification_url) solo se pide con una dirección https.
 */
export async function crearPreferencia(pagoId: string, plan: Plan, monto: number, negocio: string, correo: string) {
  const app = baseApp().replace(/\/?$/, '/')
  const vence = new Date(Date.now() + 3 * 86_400_000).toISOString()
  const pref = await mp<{ id: string; init_point: string; sandbox_init_point?: string }>('/checkout/preferences', {
    method: 'POST',
    body: {
      items: [{ id: `plan-${plan.codigo}`, title: `PetSuite · plan ${plan.nombre} (30 días)`, description: `Suscripción mensual de ${negocio}`, quantity: 1, unit_price: monto, currency_id: 'CLP' }],
      external_reference: pagoId,
      ...(correo && { payer: { email: correo } }),
      back_urls: { success: retornoMercadoPago(app), pending: retornoMercadoPago(app), failure: retornoMercadoPago(app) },
      auto_return: 'approved',
      ...(app.startsWith('https://') && { notification_url: `${app}api/v1/pagos/mercadopago/webhook` }),
      statement_descriptor: 'PETSUITE',
      expires: true,
      expiration_date_to: vence,
    },
  })
  return { preferencia: pref.id, url: esPrueba() && pref.sandbox_init_point ? pref.sandbox_init_point : pref.init_point }
}

export const consultarPagoMp = (id: string) => mp<PagoMp>(`/v1/payments/${encodeURIComponent(id)}`)
const pagosMpDe = async (pagoId: string) => (await mp<{ results: PagoMp[] }>(`/v1/payments/search?external_reference=${encodeURIComponent(pagoId)}&sort=date_created&criteria=desc`)).results ?? []

type Pago = { id: string; suscripcion_id: string; monto_clp: number; canal: string; estado: string; referencia: string | null }
const PAGO_MP = "select pg.* from pagos pg where pg.id = $1 and pg.canal = 'mercadopago' and pg.estado = 'pendiente' for update"

/**
 * Confirma un pago de PetSuite con el pago que informó Mercado Pago, solo si está aprobado, corresponde a ese pago y
 * es por el monto exacto en pesos. Devuelve true si lo confirmó. Un pago ya confirmado no se vuelve a procesar.
 */
export async function aplicarPagoMp(sql: Sql, pagoMp: PagoMp): Promise<boolean> {
  if (pagoMp.status !== 'approved' || !idDe(pagoMp.external_reference ?? '')) return false
  const pago = await una<Pago>(sql, PAGO_MP, [pagoMp.external_reference])
  if (!pago || Number(pagoMp.transaction_amount) !== pago.monto_clp || pagoMp.currency_id !== 'CLP') return false
  const s = await una<Suscripcion>(sql, 'select * from suscripciones where id = $1', [pago.suscripcion_id])
  const p = s && await una<Pyme>(sql, `select ${PYME} from pymes p where p.id = $1`, [s.pyme_id])
  if (!s || !p) return false
  // Igual que Orcob: una renovación respeta el periodo pedido; un alta o una reactivación vencida parte hoy.
  await activarPeriodo(sql, p, s)
  await sql("update pagos set estado = 'confirmado', referencia = $2, pagado_en = $3 where id = $1", [pago.id, `MP-${pagoMp.id}`, now()])
  const plan = planPorId(s.plan_id)
  const c = correoPagoMercadoPago(plan.nombre, pago.monto_clp, s.inicio, s.fin, p.estado_verificacion !== 'aprobada')
  await enviarCorreo(sql, await correoDe(sql, p.propietario_id), c.asunto, c.cuerpo, 'aprobacion')
  return true
}

/** Busca en Mercado Pago un pago aprobado para ese pago de PetSuite (al volver del pago, o antes de reemplazarlo). */
export async function verificarPagoMp(sql: Sql, pagoId: string) {
  for (const pagoMp of await pagosMpDe(pagoId)) if (await aplicarPagoMp(sql, pagoMp)) return true
  return false
}

on('GET', '/pagos/medios', () => ({ transferencia: true, mercadopago: mercadoPagoDisponible() }))

// Aviso de Mercado Pago (webhook o IPN). Siempre responde 200 salvo que Mercado Pago no conteste, para que reintente.
on('POST', '/pagos/mercadopago/webhook', async req => {
  if (!mercadoPagoDisponible()) return { ok: true }
  const body = (req.body ?? {}) as { type?: string; topic?: string; data?: { id?: unknown } }
  const tipo = body.type ?? body.topic ?? req.query.get('type') ?? req.query.get('topic')
  const id = String(body.data?.id ?? req.query.get('data.id') ?? req.query.get('id') ?? '')
  if (tipo !== 'payment' || !/^\d{1,20}$/.test(id)) return { ok: true }
  await aplicarPagoMp(req.sql, await consultarPagoMp(id))
  return { ok: true }
})

// Al volver de Mercado Pago: si el aviso todavía no llegó, se consulta el pago directamente.
on('POST', '/pymes/:id/pagos/:pagoId/mercadopago/verificar', async req => {
  const p = await miPyme(req, 'suscripcion')
  if (!mercadoPagoDisponible()) return fail(422, MERCADO_PAGO_NO_DISPONIBLE)
  const pago = await una<Pago>(req.sql, `select pg.* from pagos pg join suscripciones s on s.id = pg.suscripcion_id where pg.id = $1 and pg.canal = 'mercadopago' and s.pyme_id = $2`, [idDe(req.params.pagoId), p.id])
  if (!pago) return fail(404, SIN_PAGO_MP)
  if (pago.estado === 'pendiente') await verificarPagoMp(req.sql, pago.id)
  const r = await una<{ estado: string; inicio: string; fin: string }>(req.sql, 'select pg.estado, s.inicio, s.fin from pagos pg join suscripciones s on s.id = pg.suscripcion_id where pg.id = $1', [pago.id])
  return r!
})

// Volver a abrir el pago (la Pyme cerró la ventana o venció la preferencia): una preferencia nueva para el mismo pago.
on('POST', '/pymes/:id/pagos/:pagoId/mercadopago', async req => {
  const p = await miPyme(req, 'suscripcion')
  if (!mercadoPagoDisponible()) return fail(422, MERCADO_PAGO_NO_DISPONIBLE)
  const pago = await una<Pago & { plan_id: number }>(req.sql, `select pg.*, s.plan_id from pagos pg join suscripciones s on s.id = pg.suscripcion_id
    where pg.id = $1 and pg.canal = 'mercadopago' and pg.estado = 'pendiente' and s.pyme_id = $2`, [idDe(req.params.pagoId), p.id])
  if (!pago) return fail(404, SIN_PAGO_MP)
  const pref = await crearPreferencia(pago.id, planPorId(pago.plan_id), pago.monto_clp, p.nombre_comercial, await correoDe(req.sql, p.propietario_id))
  await req.sql('update pagos set referencia = $2 where id = $1', [pago.id, pref.preferencia])
  return { url: pref.url }
})
