// Publicación en Vercel: rutas, orígenes y la función ya empaquetada, sin base de datos.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { empaquetar } from './construir.mjs'
import { direccionApp, origenes, rutaOriginal } from './rutas.mjs'

test('recupera la ruta del API llegue como llegue req.url', () => {
  assert.equal(rutaOriginal('/api/index?ruta=pymes/abc&comuna=Osorno'), '/api/v1/pymes/abc?comuna=Osorno')
  assert.equal(rutaOriginal('/api/v1/pymes/abc?comuna=Osorno&ruta=pymes/abc'), '/api/v1/pymes/abc?comuna=Osorno')
  assert.equal(rutaOriginal('/api/index?ruta=comunas'), '/api/v1/comunas')
  assert.equal(rutaOriginal('/api/index'), '/healthz')
})

test('la dirección de la app sale de Vercel, salvo que se fije APP_URL', () => {
  assert.equal(direccionApp({ VERCEL_PROJECT_PRODUCTION_URL: 'petsuite.vercel.app' }), 'https://petsuite.vercel.app/')
  assert.equal(direccionApp({ APP_URL: 'https://petsuite.cl/', VERCEL_PROJECT_PRODUCTION_URL: 'petsuite.vercel.app' }), 'https://petsuite.cl/')
  assert.equal(direccionApp({}), undefined)
})

test('solo se permiten los orígenes del propio sitio', () => {
  assert.equal(origenes({ VERCEL_PROJECT_PRODUCTION_URL: 'petsuite.vercel.app', VERCEL_URL: 'petsuite-abc.vercel.app' }), 'https://petsuite.vercel.app,https://petsuite-abc.vercel.app')
  assert.equal(origenes({ APP_URL: 'https://petsuite.cl/app/' }), 'https://petsuite.cl')
  assert.equal(origenes({}), '')
})

test('la función empaquetada funciona sin el cargador de TypeScript', async () => {
  // Dentro del repositorio: su package.json dice "type": "module", y la función debe funcionar igual.
  mkdirSync('.vercel', { recursive: true })
  const dir = mkdtempSync(join(resolve('.vercel'), 'prueba-'))
  const variables = { ...process.env }
  Object.assign(process.env, { VERCEL_PROJECT_PRODUCTION_URL: 'petsuite.test' })
  delete process.env.APP_URL
  delete process.env.DATABASE_URL
  let server
  try {
    await empaquetar(dir)
    const funcion = createRequire(import.meta.url)(join(dir, 'index.js'))
    assert.equal(typeof funcion, 'function')
    assert.equal(process.env.APP_URL, 'https://petsuite.test/', 'los enlaces de los correos apuntan al sitio publicado')
    server = createServer(funcion)
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`

    assert.deepEqual(await (await fetch(`${base}/api/index`)).json(), { ok: true })
    const sinRuta = await fetch(`${base}/api/index?ruta=no-existe`)
    assert.equal(sinRuta.status, 404)
    assert.equal((await sinRuta.json()).message, 'No encontrado')
    const ajeno = await fetch(`${base}/api/index?ruta=comunas`, { headers: { Origin: 'https://ajeno.test' } })
    assert.equal(ajeno.status, 403)
    const propio = await fetch(`${base}/api/index?ruta=no-existe`, { headers: { Origin: 'https://petsuite.test' } })
    assert.equal(propio.status, 404, 'el origen del sitio pasa')
  } finally {
    await new Promise(resolve => server ? server.close(resolve) : resolve())
    process.env = variables
    rmSync(dir, { recursive: true, force: true })
  }
})
