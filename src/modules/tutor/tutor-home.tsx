import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, CalendarDays, Check, Clock3, MapPin, PawPrint, Tag, TriangleAlert, type LucideIcon } from 'lucide-react'
import { api, errorText, fechaLarga, getSession, hoy, type Comuna, type PymeResumen } from '../../shared/api'
import { Photo, rubroFoto } from '../../shared/media'
import { EmptyState, ErrorState, LoadingState } from '../../shared/feedback'
import { buscar, rubroLabel, type Filtros } from '../directory/explore-search'
import { isOpenNow, statusForBusiness } from '../directory/directory-hours'

// Bloques del Inicio del tutor. Solo leen rutas que ya existen (negocios, adopciones y muro de su comuna):
// todas las cifras salen de esos datos y el orden de los negocios es el mismo de Explorar, sin pesar el plan.

export type AnimalResumen = { id: string; nombre: string; especie: string; raza: string | null; edad_estimada: string | null; foto_url: string | null; ong: string; comuna: string }
export type PostResumen = { id: string; tipo: string; texto: string; autor: string; sector: string | null; fecha_evento: string | null; resuelto: boolean; urgente: boolean; es_mio: boolean; reaccione: boolean; mascota: string | null }

function useLista<T>(path: string) {
  const [data, setData] = useState<T[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => { setError(''); api<T[]>(path).then(setData).catch(e => setError(errorText(e))) }, [path])
  useEffect(() => { load() }, [load])
  return { data, error, load }
}

/** Negocios, adopciones y muro de la comuna del tutor, cada uno con su propia carga y error. */
export function useTutorHome() {
  const comunaId = getSession()?.comunaId ?? null
  const [comuna, setComuna] = useState('')
  useEffect(() => { if (comunaId) api<Comuna[]>('/comunas').then(c => setComuna(c.find(x => x.id === comunaId)?.nombre ?? '')).catch(() => undefined) }, [comunaId])
  return {
    comuna,
    pymes: useLista<PymeResumen>('/pymes'),
    animales: useLista<AnimalResumen>('/adopciones'),
    muro: useLista<PostResumen>(comunaId ? `/muro?comuna=${comunaId}` : '/muro'),
  }
}

const todos: Filtros = { q: '', comuna: '', rubro: '', ofertas: false }
/** Negocios de la comuna (casa matriz o sucursal) en el orden normal de Explorar. */
export const enComuna = (pymes: PymeResumen[], comuna: string, rubro = '') => buscar(pymes, { ...todos, comuna, rubro })

export type Tono = 'accent' | 'warm' | 'info' | 'success' | 'danger'
export type Ruta = { id: string; label: string; detail: string; icon: LucideIcon; tone: Tono; onClick: () => void }

export function QuickRoutes({ rutas }: { rutas: Ruta[] }) {
  return <section className="tutor-routes" aria-labelledby="tutor-routes-title">
    <div className="section-heading"><div><p className="eyebrow">ATAJOS</p><h2 id="tutor-routes-title">¿Qué necesitas hoy?</h2></div></div>
    <div className="tutor-routes-grid">{rutas.map(r => { const Icon = r.icon; return <button key={r.id} type="button" className={`tutor-route tone-${r.tone}`} onClick={r.onClick}>
      <span className="tutor-route-icon" aria-hidden="true"><Icon size={22} strokeWidth={1.9} /></span>
      <strong>{r.label}</strong><small>{r.detail}</small>
    </button> })}</div>
  </section>
}

export type Paso = { id: string; label: string; detail: string; done: boolean; action: string; onClick: () => void }

/** Recorrido del tutor: cada paso se marca con lo que ya registró, no con clics. */
export function TutorJourney({ pasos }: { pasos: Paso[] }) {
  const hechos = pasos.filter(p => p.done).length
  const siguiente = pasos.find(p => !p.done)
  if (!siguiente) return null
  return <section className="content-panel tutor-journey" aria-labelledby="tutor-journey-title">
    <div className="tutor-journey-head">
      <div className="tutor-journey-ring" style={{ '--pct': `${Math.round(hechos / pasos.length * 100)}%` } as React.CSSProperties} role="img" aria-label={`${hechos} de ${pasos.length} pasos completados`}><strong>{hechos}<small>/{pasos.length}</small></strong></div>
      <div><p className="eyebrow">TU RECORRIDO</p><h2 id="tutor-journey-title">Saca el máximo a PetSuite</h2><p className="muted">Siguiente paso: {siguiente.label.toLocaleLowerCase('es')}.</p></div>
    </div>
    <ol className="tutor-journey-steps">{pasos.map((p, i) => <li key={p.id} className={p.done ? 'is-done' : p === siguiente ? 'is-next' : undefined}>
      <span className="tutor-step-mark" aria-hidden="true">{p.done ? <Check size={15} strokeWidth={3} /> : i + 1}</span>
      <div className="tutor-step-text"><strong>{p.label}</strong><small>{p.done ? 'Listo' : p.detail}</small></div>
      {!p.done && <button type="button" className={p === siguiente ? 'primary' : 'text-button'} onClick={p.onClick}>{p.action} <ArrowRight size={15} aria-hidden="true" /></button>}
    </li>)}</ol>
  </section>
}

type Lista<T> = { data: T[] | null; error: string; load: () => void }

export function NearbyServices({ pymes, comuna, onPyme, onAll }: { pymes: Lista<PymeResumen>; comuna: string; onPyme: (id: string) => void; onAll: () => void }) {
  const [now] = useState(() => new Date())
  const locales = pymes.data ? enComuna(pymes.data, comuna) : []
  const propios = !!comuna && locales.length > 0
  const lista = propios ? locales : pymes.data ? buscar(pymes.data, todos) : []
  const abiertos = lista.filter(p => isOpenNow(p, now)).length
  return <section className="content-panel tutor-rail-panel" aria-labelledby="tutor-nearby-title">
    <div className="section-heading"><div><p className="eyebrow">CERCA DE TI</p><h2 id="tutor-nearby-title">{propios ? `Servicios en ${comuna}` : 'Servicios en PetSuite'}</h2></div>
      <div className="tutor-rail-actions">{pymes.data && lista.length > 0 && <span className="tutor-live"><span aria-hidden="true" /> {abiertos} {abiertos === 1 ? 'abierto' : 'abiertos'} ahora</span>}<button type="button" className="text-button" onClick={onAll}>Ver todos <ArrowRight size={16} aria-hidden="true" /></button></div></div>
    {pymes.error && !pymes.data ? <ErrorState message={pymes.error} onRetry={pymes.load} />
      : !pymes.data ? <LoadingState label="Cargando negocios" rows={2} />
      : !lista.length ? <EmptyState title="Aún no hay negocios" description="Cuando se validen negocios Pet-Care, aparecerán aquí." />
      : <ul className="tutor-rail">{lista.slice(0, 8).map(p => { const status = statusForBusiness(p, now); return <li key={p.id}><button type="button" className="tutor-place" onClick={() => onPyme(p.id)}>
        <span className="tutor-place-media"><Photo src={p.foto_portada || rubroFoto[p.rubro] || rubroFoto.otro} nombre={p.nombre_comercial} className="tutor-place-photo" /><span className="tutor-place-kind">{rubroLabel[p.rubro] || p.rubro}</span></span>
        <strong>{p.nombre_comercial}</strong>
        <small className={status.open ? 'is-open' : status.known ? 'is-closed' : undefined}><Clock3 size={13} aria-hidden="true" /> {status.text}</small>
        {(!!p.ofertas || !!p.cupones?.length) && <span className="chip chip-warn"><Tag size={12} aria-hidden="true" /> {p.ofertas ? `${p.ofertas} ${p.ofertas === 1 ? 'oferta' : 'ofertas'}` : 'Cupón ONG'}</span>}
      </button></li> })}</ul>}
  </section>
}

export function AdoptionShowcase({ animales, comuna, onAnimal, onAll }: { animales: Lista<AnimalResumen>; comuna: string; onAnimal: (id: string) => void; onAll: () => void }) {
  // Primero los de su comuna; dentro de cada grupo se respeta el orden que entrega el API.
  const lista = [...(animales.data ?? [])].sort((a, b) => Number(b.comuna === comuna) - Number(a.comuna === comuna)).slice(0, 8)
  if (animales.data && !lista.length) return null
  return <section className="content-panel tutor-rail-panel tutor-adopt" aria-labelledby="tutor-adopt-title">
    <div className="section-heading"><div><p className="eyebrow">ADOPCIÓN RESPONSABLE</p><h2 id="tutor-adopt-title">Buscan un hogar</h2></div>
      <div className="tutor-rail-actions">{animales.data && <span className="pet-count">{animales.data.length}</span>}<button type="button" className="text-button" onClick={onAll}>Ver adopciones <ArrowRight size={16} aria-hidden="true" /></button></div></div>
    {animales.error && !animales.data ? <ErrorState message={animales.error} onRetry={animales.load} />
      : !animales.data ? <LoadingState label="Cargando animales en adopción" rows={2} />
      : <ul className="tutor-rail">{lista.map(a => <li key={a.id}><button type="button" className="tutor-animal" onClick={() => onAnimal(a.id)}>
        <Photo src={a.foto_url} nombre={a.nombre} className="tutor-animal-photo" />
        <span className="tutor-animal-body"><strong>{a.nombre}</strong><small>{a.especie[0].toUpperCase() + a.especie.slice(1)}{a.edad_estimada ? ` · ${a.edad_estimada}` : ''}</small><small><MapPin size={12} aria-hidden="true" /> {a.comuna} · {a.ong}</small></span>
      </button></li>)}</ul>}
  </section>
}

const mesCorto = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-CL', { month: 'short' }).replace('.', '')
const iconoAviso: Record<string, LucideIcon> = { extravio: PawPrint, alerta: TriangleAlert, encuentro: PawPrint }
const tipoAviso: Record<string, string> = { extravio: 'Extravío', alerta: 'Alerta de salud', encuentro: 'Encuentro' }

export function CommunityPulse({ muro, comuna, onOpen }: { muro: Lista<PostResumen>; comuna: string; onOpen: () => void }) {
  const posts = muro.data ?? []
  const urgentes = posts.filter(p => p.urgente && !p.resuelto).slice(0, 3)
  const eventos = posts.filter(p => p.tipo === 'evento' && !!p.fecha_evento && p.fecha_evento >= hoy()).sort((a, b) => (a.fecha_evento || '').localeCompare(b.fecha_evento || '')).slice(0, 3)
  return <section className="content-panel tutor-pulse" aria-labelledby="tutor-pulse-title">
    <div className="section-heading"><div><p className="eyebrow">COMUNIDAD</p><h2 id="tutor-pulse-title">Esta semana en {comuna || 'tu comuna'}</h2></div><button type="button" className="text-button" onClick={onOpen}>Ir al muro <ArrowRight size={16} aria-hidden="true" /></button></div>
    {muro.error && !muro.data ? <ErrorState message={muro.error} onRetry={muro.load} />
      : !muro.data ? <LoadingState label="Cargando el muro" rows={2} />
      : !urgentes.length && !eventos.length ? <div className="tutor-pulse-calm"><Check size={20} aria-hidden="true" /><div><strong>Sin avisos urgentes</strong><p>No hay extravíos activos, alertas ni eventos próximos en tu comuna.</p></div></div>
      : <div className="tutor-pulse-list">
        {urgentes.map(p => { const Icon = iconoAviso[p.tipo] ?? TriangleAlert; return <button key={p.id} type="button" className={`tutor-pulse-item is-${p.tipo}`} onClick={onOpen}>
          <span className="tutor-pulse-icon" aria-hidden="true"><Icon size={18} /></span>
          <span className="tutor-pulse-text"><b>{tipoAviso[p.tipo] ?? 'Aviso'}{p.mascota ? ` · ${p.mascota}` : ''}{p.sector ? ` · ${p.sector}` : ''}</b><span>{p.texto}</span></span>
        </button> })}
        {eventos.map(p => <button key={p.id} type="button" className="tutor-pulse-item is-evento" onClick={onOpen}>
          <span className="tutor-pulse-date" aria-hidden="true"><b>{Number(p.fecha_evento!.slice(8))}</b>{mesCorto(p.fecha_evento!)}</span>
          <span className="tutor-pulse-text"><b><CalendarDays size={13} aria-hidden="true" /> Evento<span className="sr-only">, {fechaLarga(p.fecha_evento!)}</span>{p.sector ? ` · ${p.sector}` : ''}</b><span>{p.texto}</span></span>
        </button>)}
      </div>}
  </section>
}
