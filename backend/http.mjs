// Atención HTTP del API: origen permitido, /healthz, cuerpo JSON y errores.
// La comparten el servidor (backend/server.mjs) y la función de Vercel (backend/vercel/funcion.mjs).
import { createHash } from 'node:crypto'

const MAX_BODY = 1_048_576
// Los documentos de validación de un negocio (hasta 2 MB, en base64) necesitan un cuerpo más grande.
const MAX_BODY_DOCUMENTO = 3_000_000
const RUTA_DOCUMENTO = /^\/api\/v1\/pymes\/[^/]+\/documentos\/[a-z_]+$/

/**
 * Quién llama, para los límites de solicitudes: la huella de su IP, nunca la IP. En Vercel la IP real llega en
 * x-real-ip (o primera en x-forwarded-for), que la plataforma reescribe; en el servidor local, la del socket.
 */
export function clienteDe(req) {
  const reenviada = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  const ip = String(req.headers['x-real-ip'] || '').trim() || reenviada || req.socket?.remoteAddress || 'desconocida'
  return createHash('sha256').update(`petsuite:${ip}`).digest('hex').slice(0, 32)
}

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
    if (url.pathname === '/healthz') {
      // Con base de datos, una consulta mínima: el monitoreo detecta si la base no responde y la mantiene activa.
      if (!handle.salud) { respond(res, 200, { ok: true }); return }
      try { await handle.salud(); respond(res, 200, { ok: true, base: 'ok' }) }
      catch (error) { console.error(error); respond(res, 503, { ok: false, message: 'La base de datos no responde' }) }
      return
    }
    if (!url.pathname.startsWith('/api/v1/')) { respond(res, 404, { message: 'No encontrado' }); return }
    try {
      let body
      if (req.method !== 'GET') {
        let bytes = 0
        const chunks = [], max = RUTA_DOCUMENTO.test(url.pathname) ? MAX_BODY_DOCUMENTO : MAX_BODY
        for await (const chunk of req) {
          bytes += chunk.length
          if (bytes > max) { respond(res, 413, { message: 'Solicitud demasiado grande' }); return }
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
      const result = await handle(req.method || 'GET', path, body, session, clienteDe(req))
      if (result === undefined) { res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end() }
      else if (result?.__binario) {
        const datos = Buffer.from(result.base64, 'base64')
        // Documentos privados: sin caché y siempre como descarga. Fotos: caché larga (una foto nueva tiene otro id).
        const cabeceras = result.privado
          ? { 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.nombre || 'documento')}` }
          : { 'Cache-Control': 'public, max-age=31536000, immutable' }
        res.writeHead(200, { 'Content-Type': result.tipo, 'Content-Length': datos.length, 'X-Content-Type-Options': 'nosniff', ...cabeceras })
        res.end(datos)
      }
      else respond(res, 200, result)
    } catch (error) {
      if (error instanceof ApiError) respond(res, error.status, { message: error.message })
      else { console.error(error); respond(res, 500, { message: 'Error interno del servidor' }) }
    }
  }
}
