// Atención HTTP del API: origen permitido, /healthz, cuerpo JSON y errores.
// La comparten el servidor (backend/server.mjs) y la función de Vercel (backend/vercel/funcion.mjs).
const MAX_BODY = 1_048_576

export function crearAtencion({ handle, ApiError, origins }) {
  const allowed = new Set(origins.split(',').map(value => value.trim()).filter(Boolean))
  const respond = (res, status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(payload))
  }

  return async (req, res) => {
    const origin = req.headers.origin
    if (origin && !allowed.has(origin)) { respond(res, 403, { message: 'Origen no autorizado' }); return }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname === '/healthz') { respond(res, 200, { ok: true }); return }
    if (!url.pathname.startsWith('/api/v1/')) { respond(res, 404, { message: 'No encontrado' }); return }
    try {
      let body
      if (req.method !== 'GET') {
        let bytes = 0
        const chunks = []
        for await (const chunk of req) {
          bytes += chunk.length
          if (bytes > MAX_BODY) { respond(res, 413, { message: 'Solicitud demasiado grande' }); return }
          chunks.push(chunk)
        }
        if (bytes) {
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
          catch { respond(res, 400, { message: 'JSON inválido' }); return }
        }
      }
      const bearer = /^Bearer (\S+)$/i.exec(req.headers.authorization || '')
      // handle() consulta la sesión persistida y comprueba el rol en cada ruta protegida.
      const session = bearer ? { token: bearer[1], id: '', rol: 'tutor', nombre: '', comunaId: null } : null
      const path = url.pathname.slice('/api/v1'.length) + url.search
      const result = await handle(req.method || 'GET', path, body, session)
      if (result === undefined) { res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end() }
      else respond(res, 200, result)
    } catch (error) {
      if (error instanceof ApiError) respond(res, error.status, { message: error.message })
      else { console.error(error); respond(res, 500, { message: 'Error interno del servidor' }) }
    }
  }
}
