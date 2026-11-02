// Cuentas reales sobre PostgreSQL (PGlite):
// - envío con Resend (simulado con un fetch falso): el enlace viaja solo en el correo, la bandeja guarda una copia
//   sin él, y si el envío falla el registro se deshace;
// - primer administrador de una base sin cuentas demo, creado con npm run db:crear-admin;
// - asesores de esa misma base, creados con npm run db:crear-asesor.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier) && !context.parentURL?.includes('/node_modules/')) {
    return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
  }
  return nextResolve(specifier, context)
} })

const { createApi } = await import('./index.ts')
const { pgliteDatabase } = await import('./pglite.ts')
const { migrate } = await import('../db/migrate.mjs')
const { crearAdmin, leerArgumentos } = await import('../db/crear-admin.mjs')
const { PERMISOS_ASESOR } = await import('../../src/shared/permissions.ts')

test('el primer administrador de una base vacía entra con su invitación, no con una clave conocida', async () => {
  const { database, client } = await pgliteDatabase()
  try {
    await migrate(client, () => {})
    const enlace = await crearAdmin(client, ' Admin@PetSuite.test ', 'Administración', 'https://petsuite.test/app')
    const token = /^https:\/\/petsuite\.test\/app\/#restablecer\/([0-9a-f]{32})$/.exec(enlace)[1]
    await assert.rejects(() => crearAdmin(client, 'admin@petsuite.test', 'Otra'), /ya tiene una cuenta/)
    const handle = createApi(database)
    await assert.rejects(() => handle('POST', '/auth/login', { correo: 'admin@petsuite.test', clave: 'petsuite123' }, null), e => e.status === 401)
    assert.deepEqual(await handle('POST', '/auth/restablecer', { token, clave: 'una-clave-larga' }, null), { ok: true })
    const sesion = await handle('POST', '/auth/login', { correo: 'admin@petsuite.test', clave: 'una-clave-larga' }, null)
    assert.equal(sesion.usuario.rol, 'admin')
    await assert.rejects(() => handle('POST', '/auth/restablecer', { token, clave: 'otra-clave-larga' }, null), e => e.status === 400)
  } finally {
    await database.close()
  }
})

test('un asesor de la base real entra con su invitación y solo tiene los permisos de asesor', async () => {
  const { database, client } = await pgliteDatabase()
  try {
    await migrate(client, () => {})
    const enlace = await crearAdmin(client, 'asesora@petsuite.test', 'Asesora Real', 'https://petsuite.test/', 'asesor')
    const invitacion = /#restablecer\/([0-9a-f]{32})$/.exec(enlace)[1]
    const handle = createApi(database)
    await assert.rejects(() => handle('POST', '/auth/login', { correo: 'asesora@petsuite.test', clave: 'petsuite123' }, null), e => e.status === 401)
    await handle('POST', '/auth/restablecer', { token: invitacion, clave: 'una-clave-larga' }, null)
    const { token, usuario } = await handle('POST', '/auth/login', { correo: 'asesora@petsuite.test', clave: 'una-clave-larga' }, null)
    assert.equal(usuario.rol, 'asesor')
    assert.deepEqual(usuario.permisos, PERMISOS_ASESOR)

    const sesion = { token, id: '', rol: 'asesor', nombre: '', comunaId: null }
    const cuenta = await handle('POST', '/asesor/cuentas', { tipo: 'pyme', correo: 'negocio@petsuite.test', nombre_visible: 'Negocio Real', comuna_id: 1 }, sesion)
    assert.equal(cuenta.correo, 'negocio@petsuite.test')
    await assert.rejects(() => handle('GET', '/admin/usuarios', undefined, sesion), e => e.status === 403)
  } finally {
    await database.close()
  }
})

test('los comandos distinguen administrador y asesor', () => {
  assert.deepEqual(leerArgumentos(['admin@petsuite.test', 'Equipo', 'PetSuite']), { rol: 'admin', correo: 'admin@petsuite.test', nombre: 'Equipo PetSuite' })
  assert.deepEqual(leerArgumentos(['--asesor', 'asesora@petsuite.test', 'Asesora', 'Real']), { rol: 'asesor', correo: 'asesora@petsuite.test', nombre: 'Asesora Real' })
  assert.deepEqual(leerArgumentos(['--asesor']), { rol: 'asesor', correo: undefined, nombre: '' })
})

const registro = correo => ({ correo, clave: 'secreta123', nombre_visible: 'Persona Real', comuna_id: 1, acepta_terminos: true, acepta_privacidad: true })

test('la base trae las 30 comunas de la Región de Los Lagos y se puede registrar en cualquiera', async () => {
  const { database, client } = await pgliteDatabase()
  try {
    await migrate(client, () => {})
    const handle = createApi(database)
    const comunas = await handle('GET', '/comunas', undefined, null)
    assert.equal(comunas.length, 30)
    assert.deepEqual(comunas.slice(0, 3).map(c => c.nombre), ['Ancud', 'Calbuco', 'Castro'])
    assert.equal(comunas.find(c => c.nombre === 'Osorno').id, 1, 'las comunas existentes conservan su id')
    const quellon = comunas.find(c => c.nombre === 'Quellón')
    assert.deepEqual(await handle('POST', '/auth/registro', { ...registro('chiloe@petsuite.test'), comuna_id: quellon.id }, null), { verificacion_pendiente: true, correo: 'chiloe@petsuite.test' })
    await assert.rejects(() => handle('POST', '/auth/registro', { ...registro('fuera@petsuite.test'), comuna_id: 31 }, null), e => e.status === 400)
  } finally {
    await database.close()
  }
})

test('con Resend, el enlace viaja solo en el correo y un envío fallido deshace el registro', async () => {
  const { database, client } = await pgliteDatabase()
  const fetchOriginal = globalThis.fetch, errorOriginal = console.error
  const enviados = []
  let estado = 200
  Object.assign(process.env, { RESEND_API_KEY: 're_prueba', MAIL_FROM: 'PetSuite <hola@petsuite.test>', APP_URL: 'https://petsuite.test/app/' })
  globalThis.fetch = async (url, init) => { enviados.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return new Response('{}', { status: estado }) }
  console.error = () => {}
  try {
    await migrate(client, () => {})
    const handle = createApi(database)

    assert.deepEqual(await handle('POST', '/auth/registro', registro('real@petsuite.test'), null), { verificacion_pendiente: true, correo: 'real@petsuite.test' })
    assert.equal(enviados.length, 1)
    assert.equal(enviados[0].url, 'https://api.resend.com/emails')
    assert.equal(enviados[0].headers.Authorization, 'Bearer re_prueba')
    assert.deepEqual(enviados[0].body.to, ['real@petsuite.test'])
    const token = /https:\/\/petsuite\.test\/app\/#verificar\/([0-9a-f]{32})/.exec(enviados[0].body.text)[1]

    const { rows: [copia] } = await client.query("select cuerpo from correos where para = 'real@petsuite.test'")
    assert.ok(!copia.cuerpo.includes(token), 'la bandeja no guarda el enlace')
    assert.ok(copia.cuerpo.includes('[enlace enviado solo al destinatario]'))
    const { rows: [fila] } = await client.query("select encode(token_hash, 'hex') as huella from tokens_cuenta")
    assert.notEqual(fila.huella, token, 'la base guarda la huella, no el token')

    await assert.rejects(() => handle('POST', '/auth/login', { correo: 'real@petsuite.test', clave: 'secreta123' }, null), e => e.status === 403)
    assert.equal((await handle('POST', '/auth/verificar', { token }, null)).usuario.rol, 'tutor')
    assert.ok((await handle('POST', '/auth/login', { correo: 'real@petsuite.test', clave: 'secreta123' }, null)).token)

    estado = 500
    await assert.rejects(() => handle('POST', '/auth/registro', registro('falla@petsuite.test'), null), e => e.status === 502)
    const { rows } = await client.query("select 1 from usuarios where correo = 'falla@petsuite.test'")
    assert.equal(rows.length, 0, 'sin correo enviado no queda una cuenta a medias')
  } finally {
    globalThis.fetch = fetchOriginal
    console.error = errorOriginal
    for (const k of ['RESEND_API_KEY', 'MAIL_FROM', 'APP_URL']) delete process.env[k]
    await database.close()
  }
})
