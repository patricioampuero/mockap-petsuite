// Búsqueda de Explorar. Corre en el navegador sobre los negocios que entrega GET /pymes: no busca en el
// catálogo de cada negocio (eso necesita la búsqueda pública del API, FE-15). Sin tildes, sin mayúsculas y
// con sinónimos frecuentes. El orden normal es igual para todos: el plan solo decide el bloque «Patrocinado».
import type { PymeResumen } from '../../shared/api'

export const rubroLabel: Record<string, string> = { veterinaria: 'Veterinaria', tienda: 'Tienda', peluqueria: 'Peluquería', otro: 'Servicio Pet-Care' }

// Accesos directos de la landing y de Explorar. Cada uno filtra por rubro, por palabra clave o por ofertas.
export type Categoria = { id: string; label: string; rubro?: string; q?: string; ofertas?: boolean }
export const CATEGORIAS: Categoria[] = [
  { id: 'veterinaria', label: 'Veterinarias', rubro: 'veterinaria' },
  { id: 'peluqueria', label: 'Peluquería y baño', rubro: 'peluqueria' },
  { id: 'tienda', label: 'Alimento y accesorios', rubro: 'tienda' },
  { id: 'vacunas', label: 'Vacunación', q: 'vacuna' },
  { id: 'ofertas', label: 'Ofertas y cupones', ofertas: true },
]

// Sello de confianza: dice exactamente qué revisó PetSuite y qué no garantiza.
export const SELLO = {
  nombre: 'Validado por PetSuite',
  detalle: 'Un asesor de PetSuite revisó los datos de registro del negocio (nombre, RUT y rubro), su patente comercial, su resolución sanitaria y, si es una empresa, su constitución, antes de publicarlo. El sello no evalúa la calidad de sus servicios.',
}

export const normalizar = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es').replace(/[^a-z0-9]+/g, ' ').trim()

// Grupos de palabras equivalentes, ya normalizadas.
const SINONIMOS = [
  ['bano', 'lavado', 'aseo'],
  ['peluqueria', 'peluquero', 'grooming', 'estetica', 'corte'],
  ['veterinaria', 'veterinario', 'vet', 'clinica', 'medico'],
  ['vacuna', 'vacunacion', 'antirrabica'],
  ['alimento', 'comida', 'croqueta', 'pellet'],
  ['tienda', 'accesorio', 'petshop'],
  ['urgencia', 'emergencia'],
  ['perro', 'canino', 'cachorro'],
  ['gato', 'felino'],
]
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'en', 'y', 'para', 'mi', 'con', 'un', 'una', 'por', 'a'])

/** Palabras de la consulta con sus equivalentes. Una palabra corta cuenta como inicio de otra («vacu» encuentra «vacuna»). */
export function terminos(consulta: string): string[][] {
  return normalizar(consulta).split(' ').filter(p => p && !VACIAS.has(p)).map(p => {
    const raiz = p.length > 4 && p.endsWith('s') ? p.slice(0, -1) : p
    const grupo = SINONIMOS.find(g => g.some(s => s === raiz || (raiz.length >= 3 && s.startsWith(raiz)) || (s.length >= 3 && raiz.startsWith(s))))
    return [...new Set([raiz, ...(grupo ?? [])])]
  })
}

const campos = (p: PymeResumen) => ({
  nombre: normalizar(p.nombre_comercial),
  servicios: normalizar([rubroLabel[p.rubro] ?? p.rubro, ...(p.servicios ?? []), ...(p.sucursales ?? []).flatMap(s => s.servicios)].join(' ')),
  resto: normalizar([p.descripcion, p.comuna, p.direccion, ...(p.sucursales ?? []).flatMap(s => [s.nombre, s.comuna, s.descripcion]), ...(p.cupones ?? []).flatMap(c => [c.titulo, c.ong])].filter(Boolean).join(' ')),
})

/** 0 si no coincide; si coincide, más puntos cuando la palabra está en el nombre o en los servicios. */
export function puntaje(p: PymeResumen, consulta: string): number {
  const t = terminos(consulta)
  if (!t.length) return 1
  const c = campos(p)
  let total = 0
  for (const grupo of t) {
    const en = (texto: string) => grupo.some(s => texto.includes(s))
    const puntos = en(c.nombre) ? 3 : en(c.servicios) ? 2 : en(c.resto) ? 1 : 0
    if (!puntos) return 0
    total += puntos
  }
  return total
}

export type Filtros = { q: string; comuna: string; rubro: string; ofertas: boolean }

/**
 * Resultados en orden normal: coincidencia, luego los validados antes que las fichas con información pública,
 * y luego nombre. El plan no cambia este orden.
 */
export function buscar(pymes: PymeResumen[], f: Filtros): PymeResumen[] {
  return pymes
    .filter(p => (!f.rubro || p.rubro === f.rubro) && (!f.comuna || p.comuna === f.comuna || !!p.sucursales?.some(s => s.comuna === f.comuna)) && (!f.ofertas || !!p.ofertas || !!p.cupones?.length))
    .map(p => ({ p, n: puntaje(p, f.q) }))
    .filter(r => r.n > 0)
    .sort((a, b) => b.n - a.n || Number(!!a.p.sin_reclamar) - Number(!!b.p.sin_reclamar) || a.p.nombre_comercial.localeCompare(b.p.nombre_comercial, 'es'))
    .map(r => r.p)
}

/** Hasta `max` resultados de planes con visibilidad pagada (Plata y Oro), que se muestran aparte con la etiqueta «Patrocinado». */
export const patrocinados = (resultados: PymeResumen[], max = 2) => resultados.filter(p => (p.destacado ?? 0) > 0).sort((a, b) => (b.destacado ?? 0) - (a.destacado ?? 0)).slice(0, max)

/** Nivel del pin en el mapa según el plan. */
export const nivelPin = (p: Pick<PymeResumen, 'destacado'>) => p.destacado === 2 ? 'oro' : p.destacado === 1 ? 'plata' : 'base'

export function filtrosDesdeHash(hash: string): Filtros {
  const qs = new URLSearchParams(hash.split('?')[1] ?? '')
  return { q: qs.get('q') ?? '', comuna: qs.get('comuna') ?? '', rubro: qs.get('rubro') ?? '', ofertas: qs.get('ofertas') === '1' }
}

export function hashExplorar(f: Partial<Filtros>): string {
  const qs = new URLSearchParams()
  if (f.q?.trim()) qs.set('q', f.q.trim())
  if (f.comuna) qs.set('comuna', f.comuna)
  if (f.rubro) qs.set('rubro', f.rubro)
  if (f.ofertas) qs.set('ofertas', '1')
  const s = qs.toString()
  return `#explorar${s ? `?${s}` : ''}`
}

export const hashCategoria = (c: Categoria, comuna = '') => hashExplorar({ q: c.q, rubro: c.rubro, ofertas: c.ofertas, comuna })
