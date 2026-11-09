// Reglas de la versión real en Vercel: frontend y API se publican en el mismo sitio.

// config.json lleva todo el API a una sola función y le pasa la ruta en ?ruta=, para no depender de cómo llegue req.url.
export const RUTAS = [
  { src: '^/healthz$', dest: '/api/index' },
  { src: '^/api/v1/(.*)$', dest: '/api/index?ruta=$1' },
  { handle: 'filesystem' },
]

/** Vuelve a la dirección que atiende backend/http.mjs. Sin ?ruta=, la solicitud era /healthz. */
export function rutaOriginal(url) {
  const u = new URL(url, 'http://vercel')
  const ruta = u.searchParams.get('ruta')
  u.searchParams.delete('ruta')
  return ruta === null ? '/healthz' : `/api/v1/${ruta}${u.search}`
}

/** Dirección de la app para los enlaces de los correos. Con un dominio propio en Vercel, cambia sola. */
export const direccionApp = env => env.APP_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}/` : undefined)

/**
 * Orígenes permitidos: el navegador envía Origin también en el mismo sitio, al hacer un POST.
 * Incluye el dominio de producción de Vercel aunque APP_URL apunte a otro (por ejemplo, con y sin www).
 */
export function origenes(env) {
  const app = direccionApp(env)
  return [...new Set([
    app && new URL(app).origin,
    env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`,
    env.VERCEL_URL && `https://${env.VERCEL_URL}`,
    env.VERCEL_BRANCH_URL && `https://${env.VERCEL_BRANCH_URL}`,
    env.PETSUITE_CORS_ORIGINS,
  ].filter(Boolean))].join(',')
}
