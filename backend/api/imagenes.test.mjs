// Fotos sobre el servidor HTTP con PostgreSQL (PGlite): la foto subida se entrega como archivo con caché larga y sin
// sesión (la ficha QR la muestra), se guarda en la base y se borra al quitarla o al suprimir la cuenta.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createApiServer } from '../server.mjs'

const values = new Map()
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }

const { pgliteDatabase } = await import('./pglite.ts')
const { migrate } = await import('../db/migrate.mjs')
const { seedDemo } = await import('../db/seed.mjs')
const { MAX_BYTES_IMAGEN } = await import('../../src/shared/imagenes.ts')

const JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='

test('la foto de la mascota se sube, se entrega como archivo en la ficha QR y se borra al quitarla', async () => {
  const { database, client } = await pgliteDatabase()
  await migrate(client, () => {})
  await seedDemo(client, { log: () => {} })
  const server = await createApiServer({ database, origins: 'http://localhost:5173' })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (path, { method = 'GET', token, body } = {}) => {
    const r = await fetch(`${base}/api/v1${path}`, { method, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body && { 'Content-Type': 'application/json' }) }, ...(body && { body: JSON.stringify(body) }) })
    return { status: r.status, data: await r.json().catch(() => null) }
  }
  try {
    const { data: sesion } = await call('/auth/login', { method: 'POST', body: { correo: 'tutor@petsuite.cl', clave: 'petsuite123' } })
    const [luna] = (await call('/mascotas', { token: sesion.token })).data

    // Una foto demasiado pesada se rechaza antes de guardarse.
    const pesada = Buffer.concat([Buffer.from(JPEG, 'base64'), Buffer.alloc(MAX_BYTES_IMAGEN)]).toString('base64')
    assert.equal((await call('/imagenes', { method: 'POST', token: sesion.token, body: { datos: pesada, tipo: 'image/jpeg' } })).status, 413)

    const { data: foto } = await call('/imagenes', { method: 'POST', token: sesion.token, body: { datos: JPEG, tipo: 'image/jpeg' } })
    assert.match(foto.url, /^\/api\/v1\/imagenes\/[0-9a-f-]{36}$/)
    assert.deepEqual((await call(`/mascotas/${luna.id}/foto`, { method: 'PUT', token: sesion.token, body: { imagen_id: foto.id } })).data, { foto_url: foto.url })

    // Sin sesión, como la pide la ficha QR: el archivo, con su tipo y caché larga.
    const archivo = await fetch(`${base}${foto.url}`)
    assert.equal(archivo.status, 200)
    assert.equal(archivo.headers.get('content-type'), 'image/jpeg')
    assert.match(archivo.headers.get('cache-control'), /immutable/)
    assert.deepEqual(Buffer.from(await archivo.arrayBuffer()), Buffer.from(JPEG, 'base64'))
    assert.equal((await call(`/qr/${luna.token_activo}`)).data.foto_url, foto.url)

    // Al quitarla, la foto subida se borra de la base.
    await call(`/mascotas/${luna.id}/foto`, { method: 'PUT', token: sesion.token, body: { imagen_id: null } })
    assert.equal((await fetch(`${base}${foto.url}`)).status, 404)
    assert.equal((await client.query('select count(*)::int as n from imagenes')).rows[0].n, 0)
  } finally {
    await new Promise(resolve => server.close(resolve))
    await database.close()
  }
})
