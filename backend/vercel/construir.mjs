// Genera .vercel/output para publicar en Vercel (Build Output API): el frontend como archivos y el API como una función.
// Uso: npm run build:vercel. El API se empaqueta porque backend/api importa sin extensión, y eso solo resuelve un empaquetador.
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { RUTAS } from './rutas.mjs'

const SALIDA = '.vercel/output'
const FUNCION = `${SALIDA}/functions/api/index.func`
// São Paulo, la región de la base: cada solicitud hace varias consultas y otra región las haría viajar a cada una.
const CONFIG_FUNCION = { runtime: 'nodejs22.x', handler: 'index.js', launcherType: 'Nodejs', maxDuration: 10, regions: ['gru1'] }

export async function empaquetar(destino) {
  await build({
    entryPoints: ['backend/vercel/funcion.mjs'],
    outfile: `${destino}/index.js`,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    // pg intenta cargar su versión nativa opcional, que no se usa.
    external: ['pg-native'],
    logLevel: 'warning',
    // src/shared/api.ts usa import.meta.env, que aquí no existe.
    define: { 'import.meta.env': '{}' },
    footer: { js: 'module.exports = module.exports.default;' },
  })
  // El package.json del proyecto dice "type": "module"; este paquete es CommonJS.
  writeFileSync(`${destino}/package.json`, JSON.stringify({ type: 'commonjs' }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  rmSync(SALIDA, { recursive: true, force: true })
  // VITE_API_URL relativa: el frontend y el API comparten sitio. Con ella, la app deja de ser la demo.
  execSync('npm run build', { stdio: 'inherit', env: { ...process.env, VITE_API_URL: '/api/v1' } })
  cpSync('dist', `${SALIDA}/static`, { recursive: true })
  mkdirSync(FUNCION, { recursive: true })
  await empaquetar(FUNCION)
  writeFileSync(`${FUNCION}/.vc-config.json`, JSON.stringify(CONFIG_FUNCION, null, 2))
  writeFileSync(`${SALIDA}/config.json`, JSON.stringify({ version: 3, routes: RUTAS }, null, 2))
  console.log(`Listo: ${SALIDA}`)
}
