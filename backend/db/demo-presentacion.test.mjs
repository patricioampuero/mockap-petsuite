// Datos de demostración en la versión real (backend/db/demo-presentacion.mjs) sobre PGlite: se cargan junto a datos
// «reales», las cuentas entran con la clave indicada y no reciben correos reales, no hay administrador ni asesor de
// demostración, y --quitar borra exactamente lo cargado (y lo que esas cuentas crearon), sin tocar lo real.
import assert from 'node:assert/strict'
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

const { pgliteDatabase } = await import('../api/pglite.ts')
const { createApi } = await import('../api/index.ts')
const { migrate } = await import('./migrate.mjs')
const { cargarDemoReal, quitarDemoReal } = await import('./demo-presentacion.mjs')

test('la demo se carga junto a los datos reales y se quita sin tocarlos', async () => {
  const { database, client } = await pgliteDatabase()
  const silencio = { log: () => {} }
  try {
    await migrate(client, () => {})
    // Datos «reales»: el administrador y una ficha con información pública.
    await client.query("insert into usuarios (id, correo, clave_hash, rol, nombre_visible, comuna_id, estado, creado_en, correo_verificado_en) values (gen_random_uuid(), 'dueno@petsuite.space', 'x', 'admin', 'Administrador real', 1, 'activo', now(), now())")
    await client.query("insert into pymes (id, nombre_comercial, rubro, comuna_id, estado_verificacion, origen, fuente, creado_en) values (gen_random_uuid(), 'Veterinaria Real', 'veterinaria', 1, 'pendiente', 'publica', 'https://ejemplo.test', now())")
    const contar = async t => (await client.query(`select count(*)::int as n from ${t}`)).rows[0].n

    await assert.rejects(() => cargarDemoReal(client, 'corta', silencio), /10 o más caracteres/)
    // Simulación: no escribe nada.
    await cargarDemoReal(client, 'clave-de-demo-2026', silencio)
    assert.equal(await contar('usuarios'), 1)

    const r = await cargarDemoReal(client, 'clave-de-demo-2026', { aplicar: true, log: () => {} })
    assert.ok(r.cuentas.every(c => c.correo.endsWith('@demo.petsuite.space')))
    assert.ok(!r.cuentas.some(c => c.rol === 'admin' || c.rol === 'asesor'), 'sin cuentas con acceso a los datos reales')
    assert.ok(r.cuentas.some(c => c.correo === 'nuevo@demo.petsuite.space'), 'un negocio en verificación para mostrar los documentos')
    const { rows: pymes } = await client.query("select nombre_comercial from pymes where origen = 'registro' order by nombre_comercial")
    assert.ok(pymes.length >= 4 && pymes.every(p => p.nombre_comercial.endsWith(' (demo)')))
    await assert.rejects(() => cargarDemoReal(client, 'clave-de-demo-2026', silencio), /Ya hay cuentas/)

    // Las cuentas entran con la clave indicada y la demo aparece en Explorar.
    const api = createApi(database)
    const sesion = await api('POST', '/auth/login', { correo: 'tutor@demo.petsuite.space', clave: 'clave-de-demo-2026' }, null)
    assert.equal(sesion.usuario.rol, 'tutor')
    const s = { token: sesion.token, id: sesion.usuario.id, rol: 'tutor', nombre: '', comunaId: 1 }
    assert.equal((await api('GET', '/mascotas', undefined, s))[0].nombre, 'Luna')
    assert.ok((await api('GET', '/pymes', undefined, null)).some(p => p.nombre_comercial === 'Clínica Veterinaria Sur (demo)'))

    // Lo que una cuenta de demostración hace durante la presentación también se quita (aquí, una publicación).
    await api('POST', '/muro', { tipo: 'recomendacion', texto: 'Recuerden vacunar a sus mascotas este mes.', comuna_id: 1 }, s)
    // Con Resend configurado, el correo a una cuenta de demostración no se envía: queda en la bandeja.
    process.env.RESEND_API_KEY = 're_prueba'; process.env.MAIL_FROM = 'PetSuite <hola@petsuite.space>'
    const fetchReal = globalThis.fetch
    let enviados = 0
    globalThis.fetch = async (url, init) => { if (String(url).includes('resend')) { enviados++; return new Response('{}') } return fetchReal(url, init) }
    try { await api('POST', '/auth/recuperar', { correo: 'tutor@demo.petsuite.space' }, null) } finally { globalThis.fetch = fetchReal; delete process.env.RESEND_API_KEY; delete process.env.MAIL_FROM }
    assert.equal(enviados, 0)

    await quitarDemoReal(client, silencio)
    assert.ok(await contar('mascotas') > 0, 'la simulación no borra')
    await quitarDemoReal(client, { aplicar: true, log: () => {} })
    for (const t of ['mascotas', 'medallas', 'ongs', 'animales', 'publicaciones', 'convenios', 'canjes', 'suscripciones', 'pagos', 'sucursales', 'items_catalogo']) assert.equal(await contar(t), 0, `${t} quedó con datos`)
    assert.equal(await contar('usuarios'), 1, 'el administrador real sigue')
    assert.deepEqual((await client.query('select nombre_comercial from pymes')).rows.map(p => p.nombre_comercial), ['Veterinaria Real'])
    assert.equal((await client.query("select count(*)::int as n from correos where para like '%@demo.petsuite.space'")).rows[0].n, 0)
    // Quitar otra vez no hace nada.
    await quitarDemoReal(client, { aplicar: true, log: () => {} })
  } finally {
    await database.close()
  }
})
