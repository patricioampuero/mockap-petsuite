// Descarga de archivos privados del API (por ejemplo, los documentos de validación de un negocio).
// Necesitan la sesión, así que no sirven como enlace directo: se piden con el token y se guardan desde el navegador.
import { ApiError, api, getSession, modoDemo } from './api'

type Binario = { __binario: true; tipo: string; base64: string; nombre?: string }

function guardar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export async function descargarArchivo(ruta: string, nombre: string) {
  if (modoDemo) {
    const r = await api<Binario>(ruta)
    const bin = atob(r.base64), bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    guardar(new Blob([bytes], { type: r.tipo }), r.nombre || nombre)
    return
  }
  const base = String(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')
  const session = getSession()
  const response = await fetch(`${base}${ruta}`, { headers: session ? { Authorization: `Bearer ${session.token}` } : {} })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null
    throw new ApiError(payload?.message || `No se pudo descargar el archivo (${response.status})`, response.status)
  }
  guardar(await response.blob(), nombre)
}
