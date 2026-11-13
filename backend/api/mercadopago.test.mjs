// Pago de planes con Mercado Pago contra un Mercado Pago simulado (servidor HTTP local en MP_API_URL) y PostgreSQL
// (PGlite). Comprueba la preferencia que se crea, que el webhook solo activa un pago aprobado por el monto exacto,
// la verificación al volver, el reintento, el reemplazo de un pago sin completar y que el asesor no lo confirma a mano.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { registerHooks } from 'node:module'

registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier) && !context.parentURL?.includes('/node_modules/')) {
    return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
  }
  return nextResolve(specifier, context)
} })

const values = new Map()
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }

const { createApi } = await import('./index.ts')
const { pgliteDatabase } = await import('./pglite.ts')
const { migrate } = await import('../db/migrate.mjs')
const { seedDemo } = await import('../db/seed.mjs')
const { PLANES } = await import('../../src/modules/plans/plans.ts')
const { MERCADO_PAGO_NO_DISPONIBLE, PAGO_ANTERIOR_RECIBIDO, PAGO_LO_CONFIRMA_MP, SIN_PAGO_MP } = await import('../../src/shared/pagos.ts')

// ---------- Mercado Pago simulado ----------
const preferencias = [], pagosMp = new Map()
const falso = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://mp')
  let body = ''
  for await (const c of req) body += c
  const enviar = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)) }
  if (req.headers.authorization !== 'Bearer TEST-123') return enviar(401, { message: 'invalid access token' })
  if (req.method === 'POST' && url.pathname === '/checkout/preferences') {
    preferencias.push(JSON.parse(body))
    const id = `pref-${preferencias.length}`
    return enviar(201, { id, init_point: `https://www.mercadopago.cl/checkout/v1/redirect?pref_id=${id}`, sandbox_init_point: `https://sandbox.mercadopago.cl/checkout/v1/redirect?pref_id=${id}` })
  }
  if (url.pathname === '/v1/payments/search') return enviar(200, { results: [...pagosMp.values()].filter(p => p.external_reference === url.searchParams.get('external_reference')) })
  const pago = /^\/v1\/payments\/(\d+)$/.exec(url.pathname)
  if (pago) return pagosMp.has(pago[1]) ? enviar(200, pagosMp.get(pago[1])) : enviar(404, { message: 'Payment not found' })
  enviar(404, { message: 'not found' })
})

test('Mercado Pago: preferencia, webhook, verificación, reintento y reemplazo', async () => {
  await new Promise(resolve => falso.listen(0, '127.0.0.1', resolve))
  Object.assign(process.env, { MP_ACCESS_TOKEN: 'TEST-123', MP_API_URL: `http://127.0.0.1:${falso.address().port}`, APP_URL: 'https://petsuite.test/' })
  const { database, client } = await pgliteDatabase()
  try {
    await migrate(client, () => {})
    await seedDemo(client, { log: () => {} })
    const handle = createApi(database)
    const sesion = async correo => { const r = await handle('POST', '/auth/login', { correo, clave: 'petsuite123' }, null); return { token: r.token, id: r.usuario.id, rol: r.usuario.rol, nombre: '', comunaId: null } }
    const estado = async (status, promesa) => { const e = await promesa.then(() => null, x => x); assert.equal(e?.status, status, e?.message); return e }
    const fila = async (sql, params) => (await client.query(sql, params)).rows[0]
    const pelu = await sesion('peluqueria@petsuite.cl'), asesor = await sesion('asesor@petsuite.cl')
    const [pyme] = await handle('GET', '/pymes/mias', undefined, pelu)
    const plata = PLANES.find(p => p.codigo === 'plata')

    assert.deepEqual(await handle('GET', '/pagos/medios', undefined, null), { transferencia: true, mercadopago: true })

    // 1. La preferencia: monto del plan en pesos, referencia al pago de PetSuite, regreso a la app y aviso por https.
    const avisosAntes = (await fila("select count(*)::int as n from correos where asunto like 'Pago por confirmar%'")).n
    const r = await handle('POST', `/pymes/${pyme.id}/suscripcion`, { plan_id: plata.id, canal: 'mercadopago' }, pelu)
    assert.equal(r.pago_url, 'https://sandbox.mercadopago.cl/checkout/v1/redirect?pref_id=pref-1', 'con credenciales de prueba se usa el checkout de prueba')
    const [pref] = preferencias
    assert.equal(pref.external_reference, r.pago_id)
    assert.deepEqual(pref.items.map(i => [i.unit_price, i.currency_id, i.quantity]), [[plata.precio_mensual_clp, 'CLP', 1]])
    assert.equal(pref.back_urls.success, 'https://petsuite.test/?pago=mercadopago')
    assert.equal(pref.notification_url, 'https://petsuite.test/api/v1/pagos/mercadopago/webhook')
    assert.equal(pref.expires, true)
    assert.deepEqual(await fila('select canal, estado, referencia from pagos where id = $1', [r.pago_id]), { canal: 'mercadopago', estado: 'pendiente', referencia: 'pref-1' })
    assert.equal((await fila("select count(*)::int as n from correos where asunto like 'Pago por confirmar%'")).n, avisosAntes, 'Mercado Pago se confirma solo: no se avisa al equipo')

    // 2. El webhook no activa nada que no esté aprobado, por el monto exacto y en pesos.
    const aviso = id => handle('POST', `/pagos/mercadopago/webhook?data.id=${id}&type=payment`, { type: 'payment', action: 'payment.updated', data: { id: String(id) } }, null)
    await estado(502, aviso(999))
    pagosMp.set('1001', { id: 1001, status: 'pending', external_reference: r.pago_id, transaction_amount: plata.precio_mensual_clp, currency_id: 'CLP' })
    pagosMp.set('1002', { id: 1002, status: 'approved', external_reference: r.pago_id, transaction_amount: plata.precio_mensual_clp - 1, currency_id: 'CLP' })
    pagosMp.set('1003', { id: 1003, status: 'approved', external_reference: r.pago_id, transaction_amount: plata.precio_mensual_clp, currency_id: 'USD' })
    for (const id of [1001, 1002, 1003]) assert.deepEqual(await aviso(id), { ok: true })
    assert.deepEqual(await handle('POST', '/pagos/mercadopago/webhook', { type: 'merchant_order', data: { id: '5' } }, null), { ok: true })
    assert.equal((await fila('select estado from pagos where id = $1', [r.pago_id])).estado, 'pendiente')

    // 3. El aprobado correcto activa el plan y avisa a la Pyme. Un aviso repetido no hace nada más.
    pagosMp.set('1004', { id: 1004, status: 'approved', external_reference: r.pago_id, transaction_amount: plata.precio_mensual_clp, currency_id: 'CLP' })
    await aviso(1004)
    assert.deepEqual(await fila('select pg.estado, pg.referencia, s.estado as periodo from pagos pg join suscripciones s on s.id = pg.suscripcion_id where pg.id = $1', [r.pago_id]), { estado: 'confirmado', referencia: 'MP-1004', periodo: 'activa' })
    const correos = (await fila("select count(*)::int as n from correos where asunto = 'Pago recibido: plan Plata'")).n
    assert.equal(correos, 1)
    await aviso(1004)
    assert.equal((await fila("select count(*)::int as n from correos where asunto = 'Pago recibido: plan Plata'")).n, 1)
    assert.equal((await estado(404, handle('POST', `/pymes/${pyme.id}/pagos/${r.pago_id}/mercadopago`, undefined, pelu))).message, SIN_PAGO_MP, 'un pago confirmado no se vuelve a abrir')

    // 4. El asesor no confirma a mano un pago de Mercado Pago; un pago sin completar se reemplaza al pedir otro.
    const r2 = await handle('POST', `/pymes/${pyme.id}/suscripcion`, { plan_id: plata.id, canal: 'mercadopago' }, pelu)
    const e = await estado(409, handle('PATCH', `/admin/pymes/${pyme.id}/verificacion`, { decision: 'aprobar' }, asesor))
    assert.equal(e.message, PAGO_LO_CONFIRMA_MP)
    const r3 = await handle('POST', `/pymes/${pyme.id}/suscripcion`, { plan_id: plata.id, canal: 'transferencia' }, pelu)
    assert.equal(r3.pago_url, null)
    assert.equal((await fila('select estado from pagos where id = $1', [r2.pago_id])).estado, 'rechazado')
    await handle('PATCH', `/admin/pymes/${pyme.id}/verificacion`, { decision: 'rechazar' }, asesor)

    // 5. Al volver de Mercado Pago, si el aviso no llegó, la verificación consulta el pago directamente.
    const r4 = await handle('POST', `/pymes/${pyme.id}/suscripcion`, { plan_id: plata.id, canal: 'mercadopago' }, pelu)
    assert.equal((await handle('POST', `/pymes/${pyme.id}/pagos/${r4.pago_id}/mercadopago/verificar`, undefined, pelu)).estado, 'pendiente')
    const reintento = await handle('POST', `/pymes/${pyme.id}/pagos/${r4.pago_id}/mercadopago`, undefined, pelu)
    assert.match(reintento.url, /pref_id=pref-\d+$/)
    assert.equal((await fila('select referencia from pagos where id = $1', [r4.pago_id])).referencia, reintento.url.split('=').pop())
    pagosMp.set('1005', { id: 1005, status: 'approved', external_reference: r4.pago_id, transaction_amount: plata.precio_mensual_clp, currency_id: 'CLP' })
    const v = await handle('POST', `/pymes/${pyme.id}/pagos/${r4.pago_id}/mercadopago/verificar`, undefined, pelu)
    assert.equal(v.estado, 'confirmado')
    await estado(404, handle('POST', `/pymes/${pyme.id}/pagos/00000000-0000-0000-0000-000000000000/mercadopago/verificar`, undefined, pelu))

    // 6. Si el pago anterior ya se había pagado, pedir otro plan lo confirma en vez de reemplazarlo.
    const r5 = await handle('POST', `/pymes/${pyme.id}/suscripcion`, { plan_id: plata.id, canal: 'mercadopago' }, pelu)
    pagosMp.set('1006', { id: 1006, status: 'approved', external_reference: r5.pago_id, transaction_amount: plata.precio_mensual_clp, currency_id: 'CLP' })
    const r6 = await handle('POST', `/pymes/${pyme.id}/suscripcion`, { plan_id: plata.id, canal: 'transferencia' }, pelu)
    assert.equal(r6.aviso, PAGO_ANTERIOR_RECIBIDO)
    assert.equal((await fila('select estado from pagos where id = $1', [r5.pago_id])).estado, 'confirmado')

    // 7. Sin MP_ACCESS_TOKEN, Mercado Pago no se ofrece.
    delete process.env.MP_ACCESS_TOKEN
    assert.deepEqual(await handle('GET', '/pagos/medios', undefined, null), { transferencia: true, mercadopago: false })
    assert.equal((await estado(422, handle('POST', `/pymes/${pyme.id}/suscripcion`, { plan_id: plata.id, canal: 'mercadopago' }, pelu))).message, MERCADO_PAGO_NO_DISPONIBLE)
  } finally {
    delete process.env.MP_ACCESS_TOKEN; delete process.env.MP_API_URL; delete process.env.APP_URL
    await database.close()
    await new Promise(resolve => falso.close(resolve))
  }
})
