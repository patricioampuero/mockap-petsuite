// Límites de solicitudes, aviso al tutor desde el QR y /healthz sobre PostgreSQL (PGlite) con los datos demo.
// La paridad con el mock está en paridad.test.mjs; aquí se prueba lo que solo existe en el API real:
// clientes distintos, huellas en vez de datos, el envío con Resend y la consulta de salud.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier) && !context.parentURL?.includes('/node_modules/')) {
    return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
  }
  return nextResolve(specifier, context)
} })

const values = new Map()
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }

const mockDb = await import('../../src/mock/db.ts')
const { createApi } = await import('./index.ts')
const { pgliteDatabase } = await import('./pglite.ts')
const { migrate } = await import('../db/migrate.mjs')
const { cargarDemo } = await import('../db/seed.mjs')
const { clienteDe } = await import('../http.mjs')

async function conDemo(fn) {
  mockDb.resetDemo()
  const { database, client } = await pgliteDatabase()
  try {
    await migrate(client, () => {})
    await cargarDemo(client, structuredClone(mockDb.db), { log: () => {} })
    await fn(createApi(database), client, database)
  } finally {
    await database.close()
  }
}
const status = promesa => promesa.then(() => 200, e => e.status)

test('los intentos fallidos se cuentan por cuenta y cliente, y la base guarda solo huellas', async () => {
  await conDemo(async (handle, client) => {
    const login = (clave, cliente, correo = 'tutor@petsuite.cl') => status(handle('POST', '/auth/login', { correo, clave }, null, cliente))
    for (let i = 0; i < 5; i++) assert.equal(await login('incorrecta', 'cliente-a'), 401)
    assert.equal(await login('petsuite123', 'cliente-a'), 429, 'bloqueada desde ese cliente, aunque la clave sea correcta')
    assert.equal(await login('petsuite123', 'cliente-b'), 200, 'otro cliente no queda bloqueado: nadie puede dejar fuera al dueño')

    const { rows } = await client.query("select encode(clave_hash, 'hex') as huella from limites_solicitudes")
    assert.equal(rows.length, 10, 'cinco intentos, cada uno en la regla de la cuenta y en la del cliente')
    assert.ok(rows.every(r => /^[0-9a-f]{64}$/.test(r.huella)), 'solo huellas SHA-256: ni el correo ni el cliente')

    // Un mismo cliente que prueba muchas cuentas distintas también se detiene (30 cada 15 minutos).
    for (let i = 0; i < 30; i++) assert.equal(await login('incorrecta', 'cliente-c', `nadie${i}@petsuite.cl`), 401)
    assert.equal(await login('petsuite123', 'cliente-c'), 429)
  })
})

test('el aviso del QR llega al tutor por Resend, la bandeja no guarda los datos de quien escribió y un envío fallido no pierde el mensaje', async () => {
  const fetchOriginal = globalThis.fetch, errorOriginal = console.error
  const enviados = []
  let estado = 200
  Object.assign(process.env, { RESEND_API_KEY: 're_prueba', MAIL_FROM: 'PetSuite <hola@petsuite.test>', APP_URL: 'https://petsuite.test/' })
  globalThis.fetch = async (_url, init) => { enviados.push(JSON.parse(init.body)); return new Response('{}', { status: estado }) }
  console.error = () => {}
  try {
    await conDemo(async (handle, client) => {
      const { rows: [luna] } = await client.query("select md.token, u.correo from medallas md join mascotas m on m.id = md.mascota_id join usuarios u on u.id = m.tutor_id where m.nombre = 'Luna' and md.estado = 'activa'")
      const mensaje = { mensaje: 'Encontré a Luna cerca de la plaza.', nombre: 'Vecina', contacto: '+56911112222', latitud: -40.5741, longitud: -73.1349 }
      assert.deepEqual(await handle('POST', `/qr/${luna.token}/mensajes`, mensaje, null), { ok: true })

      assert.equal(enviados.length, 1)
      assert.deepEqual(enviados[0].to, [luna.correo])
      assert.match(enviados[0].subject, /Luna/)
      for (const dato of ['Encontré a Luna cerca de la plaza.', 'Vecina', '+56911112222', 'mlat=-40.5741', 'https://petsuite.test/']) assert.ok(enviados[0].text.includes(dato), `el correo incluye ${dato}`)

      const { rows: [copia] } = await client.query("select cuerpo from correos where tipo = 'aviso_qr'")
      assert.ok(!copia.cuerpo.includes('+56911112222') && !copia.cuerpo.includes('cerca de la plaza'), 'la bandeja no guarda el mensaje ni el contacto')
      assert.ok(copia.cuerpo.includes('[mensaje enviado solo al tutor]'))

      estado = 500
      assert.deepEqual(await handle('POST', `/qr/${luna.token}/mensajes`, { mensaje: 'Sigue en la plaza, junto a la pileta.' }, null), { ok: true })
      const { rows: [{ n }] } = await client.query('select count(*)::int as n from mensajes_qr')
      assert.ok(n >= 2, 'si el correo falla, el mensaje igual queda para el tutor')
    })
  } finally {
    globalThis.fetch = fetchOriginal
    console.error = errorOriginal
    for (const k of ['RESEND_API_KEY', 'MAIL_FROM', 'APP_URL']) delete process.env[k]
  }
})

test('si se publica antes de aplicar la migración 006, el ingreso y los mensajes del QR siguen funcionando', async () => {
  const errorOriginal = console.error
  console.error = () => {}
  try {
    await conDemo(async (handle, client) => {
      // Estado de una base que aún no tiene la migración 006.
      await client.query('drop table limites_solicitudes')
      await client.query("alter table correos drop constraint correos_tipo_check; alter table correos add constraint correos_tipo_check check (tipo in ('bienvenida', 'verificacion', 'restablecer', 'cuenta_creada', 'cuenta_equipo', 'aprobacion', 'convenio', 'cobranza', 'privacidad', 'premio'))")
      assert.equal(await status(handle('POST', '/auth/login', { correo: 'tutor@petsuite.cl', clave: 'incorrecta' }, null)), 401)
      assert.ok((await handle('POST', '/auth/login', { correo: 'tutor@petsuite.cl', clave: 'petsuite123' }, null)).token)
      const { rows: [luna] } = await client.query("select md.token from medallas md join mascotas m on m.id = md.mascota_id where m.nombre = 'Luna' and md.estado = 'activa'")
      assert.deepEqual(await handle('POST', `/qr/${luna.token}/mensajes`, { mensaje: 'La encontré en la plaza de armas.' }, null), { ok: true })
      const { rows } = await client.query("select 1 from mensajes_qr where mensaje = 'La encontré en la plaza de armas.'")
      assert.equal(rows.length, 1, 'el mensaje queda guardado aunque el aviso no se pueda registrar')
    })
  } finally {
    console.error = errorOriginal
  }
})

test('/healthz consulta la base y el cliente se identifica por la huella de su IP', async () => {
  await conDemo(async handle => { await handle.salud() })
  const caida = createApi({ tx: async () => { throw new Error('sin conexión') }, close: async () => {} })
  await assert.rejects(() => caida.salud(), /sin conexión/, 'con la base caída, la consulta de salud falla')

  const a = clienteDe({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }, socket: {} })
  assert.match(a, /^[0-9a-f]{32}$/)
  assert.ok(!a.includes('203'), 'no se guarda la IP')
  assert.equal(clienteDe({ headers: { 'x-real-ip': '203.0.113.7' }, socket: {} }), a, 'misma IP, mismo cliente')
  assert.notEqual(clienteDe({ headers: {}, socket: { remoteAddress: '198.51.100.2' } }), a)
})
