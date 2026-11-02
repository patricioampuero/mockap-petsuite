// API HTTP de PetSuite. Con DATABASE_URL usa PostgreSQL (backend/api); sin ella, el mock con el estado
// en un archivo del servidor. Ambos exponen el mismo contrato en /api/v1.
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerHooks } from 'node:module'
import { crearAtencion } from './http.mjs'

registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier) && !context.parentURL?.includes('/node_modules/')) {
    return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
  }
  return nextResolve(specifier, context)
} })

// Acepta la versión vigente de la base demo (src/mock/db.ts STORAGE_KEY); las versiones antiguas se ignoran.
const KEY = /^petsuite-mock-db-v\d+$/

function fileStorage(file) {
  let current = null
  return {
    getItem(key) {
      if (!KEY.test(key)) return null
      if (current && key !== current) return null
      current = key
      try { return readFileSync(file, 'utf8') } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    },
    setItem(key, value) {
      if (!KEY.test(key)) return
      current = key
      mkdirSync(dirname(file), { recursive: true })
      const temp = `${file}.${process.pid}.tmp`
      writeFileSync(temp, value, { mode: 0o600 })
      renameSync(temp, file)
    },
  }
}

// Con base de datos, las rutas de backend/api sobre un pool de PostgreSQL; sin ella, el mock persistido en un archivo.
// Las pruebas pueden entregar una base ya creada (PGlite); su cierre queda a cargo de la prueba.
async function crearHandle(databaseUrl, file, database) {
  if (database || databaseUrl) {
    const [{ createApi }, { pgDatabase }] = await Promise.all([import('./api/index.ts'), import('./api/db.ts')])
    const propia = database ? null : pgDatabase(databaseUrl)
    return { handle: createApi(database ?? propia), close: async () => { await propia?.close() } }
  }
  globalThis.localStorage = fileStorage(resolve(file))
  const { handle } = await import('../src/mock/server.ts')
  return { handle, close: async () => undefined }
}

export async function createApiServer({
  file = process.env.PETSUITE_DATA_FILE || resolve('data/petsuite.json'),
  origins = process.env.PETSUITE_CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173',
  databaseUrl = process.env.DATABASE_URL,
  database,
} = {}) {
  const [{ handle, close }, { ApiError }] = await Promise.all([crearHandle(databaseUrl, file, database), import('../src/shared/errors.ts')])
  const server = createServer(crearAtencion({ handle, ApiError, origins }))
  // Al cerrar el servidor se liberan las conexiones a la base.
  server.on('close', () => { close().catch(() => undefined) })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = process.env.HOST || '127.0.0.1'
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && process.env.PETSUITE_ALLOW_DEMO_API !== '1') {
    console.error('Este API incluye cuentas demo. Define PETSUITE_ALLOW_DEMO_API=1 para permitir acceso desde la red.')
    process.exitCode = 1
  } else {
    const server = await createApiServer()
    const datos = process.env.DATABASE_URL ? 'PostgreSQL (DATABASE_URL)' : 'archivo local del mock'
    server.listen(Number(process.env.PORT || 3000), host, () => console.log(`PetSuite API: http://${host}:${server.address().port}/api/v1 · datos: ${datos}`))
  }
}
