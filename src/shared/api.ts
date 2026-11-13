// Cliente del API PetSuite. Sin VITE_API_URL usa el mock local; con una URL configurada
// consulta el mismo contrato por HTTP, incluido el QR público sin sesión.
import { handle } from '../mock/server'
import { db as mockDb } from '../mock/db'
import { ApiError } from './errors'
import type { Rol } from './permissions'

export type ApiRole = Rol
// permisos: módulos habilitados para la cuenta (ver src/permissions.ts); los menús se arman con ellos.
export type Session = { token: string; id: string; rol: ApiRole; nombre: string; comunaId: number | null; permisos?: string[] }

const KEY = 'petsuite-session'

export const getSession = (): Session | null => {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') } catch { return null }
}
export const setSession = (s: Session | null) => {
  try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY) } catch { /* almacenamiento no disponible */ }
}

export { ApiError }

const apiUrl = import.meta.env?.VITE_API_URL?.replace(/\/+$/, '')

/** Dirección de un recurso del API (por ejemplo, una foto en /api/v1/imagenes/<id>), aunque el API esté en otro origen. */
export const recursoApi = (ruta: string) => apiUrl && /^https?:\/\//.test(apiUrl) ? `${new URL(apiUrl).origin}${ruta}` : ruta

async function remote<T>(path: string, method: string, body: unknown, session: Session | null): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null
  if (!response.ok) throw new ApiError(payload?.message || payload?.error || `No se pudo completar la solicitud (${response.status})`, response.status)
  return payload as T
}

export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const session = getSession()
  try {
    return apiUrl ? await remote<T>(path, options.method || 'GET', options.body, session) : await handle(options.method || 'GET', path, options.body, session) as T
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401 && session) { setSession(null); window.location.reload() }
      throw e
    }
    throw new ApiError('No se pudo conectar al servicio', 503)
  }
}

export const errorText = (e: unknown) => e instanceof Error ? e.message : 'Ocurrió un error inesperado'

// Respuesta de ingreso y de confirmación de correo.
export type AuthResponse = { token: string; usuario: { id: string; rol: ApiRole; nombre_visible: string; comuna_id: number | null; permisos: string[] } }
export const sessionFrom = (data: AuthResponse): Session => ({ token: data.token, id: data.usuario.id, rol: data.usuario.rol, nombre: data.usuario.nombre_visible, comunaId: data.usuario.comuna_id, permisos: data.usuario.permisos })

/** Sin VITE_API_URL la app es la demostración: datos en este navegador y cuentas de prueba. */
export const modoDemo = !apiUrl
/** Solo en la demostración, que no envía correos: el enlace del último correo simulado de ese tipo para la dirección. */
export function enlaceDemo(correo: string, ruta: 'verificar' | 'restablecer') {
  if (!modoDemo) return null
  const para = correo.trim().toLowerCase()
  const ultimo = mockDb.correos.filter(c => c.para === para && c.cuerpo.includes(`#${ruta}/`)).sort((a, b) => b.enviado_en.localeCompare(a.enviado_en))[0]
  return ultimo ? new RegExp(`\\S+#${ruta}/[0-9a-f]{32}`).exec(ultimo.cuerpo)?.[0] ?? null : null
}

// --- Tipos del API ---
export type Comuna = { id: number; nombre: string }

// Autoría de un registro del historial: la clínica que lo hizo y, si corresponde, su anulación (nunca se borra).
export type RegistroMeta = { registrado_por?: string; clinica?: string; anulado?: { motivo: string; en: string } }

export type FichaDatos = {
  condiciones: string[]; medicamentos: string[]; notaEmergencia: string
  vacunas: ({ id?: string; nombre: string; fecha: string; proxima?: string; notas?: string } & RegistroMeta)[]
  alergias: { agente: string; reaccion?: string; gravedad?: 'leve' | 'moderada' | 'grave' }[]
  tratamientos: ({ id?: string; descripcion: string; inicio?: string; fin?: string; notas?: string } & RegistroMeta)[]
  atenciones: ({ id?: string; fecha: string; motivo: string; notas?: string } & RegistroMeta)[]
  alertasCriticas: string[]
}

export const emptyFicha = (): FichaDatos => ({ condiciones: [], medicamentos: [], notaEmergencia: '', vacunas: [], alergias: [], tratamientos: [], atenciones: [], alertasCriticas: [] })

export type Mascota = {
  id: string; nombre: string; especie: string; raza: string | null; sexo: string | null; fecha_nacimiento: string | null; foto_url?: string | null
  token_activo: string | null; datos_clinicos: FichaDatos; ficha_version: number
}

export type PublicaEmergencia = { nombre: string; especie: string; raza: string | null; foto_url: string | null; alergias: { agente: string; gravedad?: string }[]; alertasCriticas: string[]; condiciones: string[]; notaEmergencia: string }

export type PymeResumen = { id: string; nombre_comercial: string; rubro: string; descripcion: string | null; comuna: string; direccion: string | null; latitud: string | null; longitud: string | null; telefono: string | null; whatsapp: string | null; horario: Record<string, string>; foto_portada?: string | null; servicios?: string[]; ofertas?: number
  // Planes Plata y Oro: prioridad en el buscador (2 = primero con insignia). Las sucursales y cupones alimentan la búsqueda.
  destacado?: 0 | 1 | 2; sucursales?: SucursalPublica[]; cupones?: CuponPublico[]
  // Ficha con información pública (src/shared/fichas.ts): sin dueño ni sello, y no recibe consultas.
  sin_reclamar?: boolean }
export type SucursalPublica = { id: string; nombre: string; comuna: string; direccion: string | null; latitud: string | null; longitud: string | null; telefono: string | null; whatsapp: string | null; horario: Record<string, string>; descripcion: string | null; servicios: string[] }
export type CuponPublico = { codigo: string; titulo: string; descuento_pct: number; condiciones: string; hasta: string; ong: string; ong_id: string; negocio?: string; pyme_id?: string }
// Oferta referencial por un rango de fechas (AAAA-MM-DD). No hay cobros dentro de la app.
export type Oferta = { precio_clp: number; desde: string; hasta: string }
export type ItemCatalogo = { id: string; tipo: 'producto' | 'servicio'; nombre: string; descripcion: string | null; precio_referencial_clp: number | null; disponible?: boolean; categoria?: string | null; sin_stock?: boolean; oferta?: Oferta | null }

export const hoy = () => new Date().toISOString().slice(0, 10)
export const ofertaVigente = (o?: Oferta | null) => !!o && o.desde <= hoy() && o.hasta >= hoy()
export const fechaLarga = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-CL')
export const fechaCorta = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })
export type PymePerfil = PymeResumen & { catalogo: ItemCatalogo[] }

export const clp = (n: number | null | undefined) => n == null ? 'Consultar precio' : `$${n.toLocaleString('es-CL')}`

export const edadDesde = (fecha: string | null) => {
  if (!fecha) return null
  const d = new Date(fecha), now = new Date()
  let years = now.getFullYear() - d.getFullYear()
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) years--
  return Math.max(0, years)
}

export const iniciales = (nombre: string) => nombre.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase() || '??'
