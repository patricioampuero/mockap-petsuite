import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { Clock3, List, Map as MapIcon, Scissors, Search, ShieldCheck, ShoppingBag, Stethoscope, Syringe, Tag } from 'lucide-react'
import { api, errorText, type Comuna, type PymeResumen } from '../../shared/api'
import { Photo, fotoNegocio } from '../../shared/media'
import { EmptyState, ErrorState, LoadingState } from '../../shared/feedback'
import { FICHA_PUBLICA } from '../../shared/fichas'
import { PublicFooter, PublicHeader } from '../landing/public-layout'
import { isOpenNow, statusForBusiness, statusForSchedule } from './directory-hours'
import { CATEGORIAS, SELLO, buscar, filtrosDesdeHash, hashExplorar, nivelPin, normalizar, patrocinados, rubroLabel, type Categoria, type Filtros } from './explore-search'

export const categoriaIcono: Record<string, typeof Search> = { veterinaria: Stethoscope, peluqueria: Scissors, tienda: ShoppingBag, vacunas: Syringe, ofertas: Tag }

// Última búsqueda de Explorar, para que el perfil del local pueda volver a ella con sus filtros.
const ULTIMA = 'petsuite-explorar'
export const ultimaBusqueda = () => { try { return sessionStorage.getItem(ULTIMA) || '#explorar' } catch { return '#explorar' } }

type Lugar = { pyme: PymeResumen; nombre: string; etiqueta: string; lat: number; lng: number; estado: string; direccion: string | null }
const lugares = (p: PymeResumen, now: Date): Lugar[] => [
  { pyme: p, nombre: p.nombre_comercial, etiqueta: p.nombre_comercial, lat: Number(p.latitud), lng: Number(p.longitud), estado: statusForBusiness(p, now).text, direccion: p.direccion },
  ...(p.sucursales ?? []).map(s => ({ pyme: p, nombre: `${p.nombre_comercial} · ${s.nombre}`, etiqueta: s.nombre, lat: Number(s.latitud), lng: Number(s.longitud), estado: statusForSchedule(s.horario, now).text, direccion: s.direccion })),
].filter(l => Number.isFinite(l.lat) && Number.isFinite(l.lng) && (l.lat !== 0 || l.lng !== 0))

// Los textos vienen de los negocios: se insertan como texto, nunca como HTML.
function elemento(tag: string, className: string, texto?: string) { const el = document.createElement(tag); el.className = className; if (texto) el.textContent = texto; return el }
function tarjetaPin(l: Lugar) {
  const box = elemento('div', 'explore-tip')
  box.append(elemento('strong', '', l.nombre), elemento('span', '', `${rubroLabel[l.pyme.rubro] ?? l.pyme.rubro} · ${l.estado}`))
  if (l.direccion) box.append(elemento('small', '', l.direccion))
  return box
}

/** Mapa de Explorar y del perfil del local: un pin por casa matriz y sucursal, con el borde del plan y resumen al pasar el cursor. */
export function ExploreMap({ places, now, activeId = null, onSelect, numbered = true, visible = true, label = 'Mapa de resultados' }: { places: PymeResumen[]; now: Date; activeId?: string | null; onSelect?: (p: PymeResumen) => void; numbered?: boolean; visible?: boolean; label?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const markers = useRef<{ id: string; marker: L.Marker }[]>([])
  const bounds = useRef<L.LatLngBounds | null>(null)
  const select = useRef(onSelect)
  useEffect(() => { select.current = onSelect }, [onSelect])

  useEffect(() => {
    if (!box.current || map.current) return
    map.current = L.map(box.current, { scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([-40.5735, -73.1335], 12)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; Colaboradores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    return () => { map.current?.remove(); map.current = null }
  }, [])

  useEffect(() => {
    if (!map.current || !layer.current) return
    layer.current.clearLayers()
    markers.current = []
    const points: L.LatLngTuple[] = []
    places.forEach((p, i) => lugares(p, now).forEach(l => {
      const pin = elemento('span', `explore-pin tier-${nivelPin(p)}${p.sin_reclamar ? ' is-unclaimed' : ''}`, numbered ? String(i + 1) : l.etiqueta)
      const marker = L.marker([l.lat, l.lng], { title: l.nombre, riseOnHover: true, icon: L.divIcon({ className: 'explore-pin-icon', html: pin, iconSize: undefined, iconAnchor: [0, 0] }) })
        .bindTooltip(tarjetaPin(l), { direction: 'top', offset: [0, -20], className: 'explore-tooltip', opacity: 1 })
        .on('click', () => select.current?.(p))
        .addTo(layer.current!)
      markers.current.push({ id: p.id, marker })
      points.push([l.lat, l.lng])
    }))
    bounds.current = points.length ? L.latLngBounds(points) : null
    if (bounds.current) map.current.fitBounds(bounds.current, { padding: [48, 48], maxZoom: 15 })
  }, [places, now, numbered])

  useEffect(() => {
    for (const { id, marker } of markers.current) {
      marker.getElement()?.classList.toggle('is-active', id === activeId)
      marker.setZIndexOffset(id === activeId ? 1000 : 0)
    }
  }, [activeId, places, now])

  // En el teléfono el mapa empieza oculto: al mostrarlo, Leaflet necesita recalcular su tamaño.
  useEffect(() => {
    if (!visible || !map.current) return
    map.current.invalidateSize()
    if (bounds.current) map.current.fitBounds(bounds.current, { padding: [48, 48], maxZoom: 15 })
  }, [visible])

  return <div ref={box} className="leaflet-box explore-map-box" role="region" aria-label={label} />
}

function ExploreCard({ p, n, now, patrocinado = false, onHover }: { p: PymeResumen; n?: number; now: Date; patrocinado?: boolean; onHover: (id: string | null) => void }) {
  const status = statusForBusiness(p, now)
  const sucursales = p.sucursales?.length ?? 0
  return <a className={`explore-card tier-${nivelPin(p)}${p.sin_reclamar ? ' is-unclaimed' : ''}`} href={`#local/${p.id}`} onMouseEnter={() => onHover(p.id)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(p.id)} onBlur={() => onHover(null)}>
    <div className="explore-card-media">
      <Photo src={fotoNegocio(p)} nombre={p.nombre_comercial} className="explore-card-photo" />
      {patrocinado ? <span className="explore-flag is-sponsored">Patrocinado</span> : n ? <span className={`explore-flag explore-num tier-${nivelPin(p)}`} aria-hidden="true">{n}</span> : null}
    </div>
    <div className="explore-card-body">
      <div className="explore-card-title"><strong>{p.nombre_comercial}</strong>{p.sin_reclamar
        ? <span className="chip explore-unclaimed" title={FICHA_PUBLICA.detalle}>{FICHA_PUBLICA.etiqueta}</span>
        : <span className="explore-valid" title={SELLO.nombre}><ShieldCheck size={16} aria-hidden="true" /><span className="sr-only">{SELLO.nombre}</span></span>}</div>
      <span className="explore-card-meta">{rubroLabel[p.rubro] || p.rubro} · {p.comuna}{sucursales ? ` · +${sucursales} ${sucursales === 1 ? 'sucursal' : 'sucursales'}` : ''}</span>
      {!!p.servicios?.length && <span className="explore-card-services">{p.servicios.slice(0, 3).join(' · ')}</span>}
      <span className={`explore-card-status${status.open ? ' is-open' : status.known ? ' is-closed' : ''}`}><Clock3 size={14} aria-hidden="true" /> {status.text}</span>
      {(!!p.ofertas || !!p.cupones?.length) && <span className="explore-card-tags">{!!p.ofertas && <span className="chip chip-warn"><Tag size={12} aria-hidden="true" /> {p.ofertas === 1 ? '1 oferta' : `${p.ofertas} ofertas`}</span>}{!!p.cupones?.length && <span className="chip chip-info">Cupón ONG</span>}</span>}
    </div>
  </a>
}

/** Fila de categorías con ícono, como accesos directos. Comparte definición con la landing. */
export function CategoryBar({ activa, onToggle }: { activa: (c: Categoria) => boolean; onToggle: (c: Categoria) => void }) {
  return <div className="explore-categories" role="group" aria-label="Categorías">{CATEGORIAS.map(c => { const Icon = categoriaIcono[c.id] ?? Search; const on = activa(c); return <button key={c.id} type="button" className={on ? 'explore-category active' : 'explore-category'} aria-pressed={on} onClick={() => onToggle(c)}><Icon size={22} strokeWidth={1.7} aria-hidden="true" /><span>{c.label}</span></button> })}</div>
}

const sinFiltros: Filtros = { q: '', comuna: '', rubro: '', ofertas: false }

/** #explorar?q=&comuna=&rubro=&ofertas=1 — búsqueda pública con lista y mapa, sin cuenta. */
export function ExplorePage({ hash }: { hash: string }) {
  const inicial = useMemo(() => filtrosDesdeHash(hash), [hash])
  const [f, setF] = useState<Filtros>(inicial)
  const [texto, setTexto] = useState(inicial.q)
  const [pymes, setPymes] = useState<PymeResumen[] | null>(null)
  const [error, setError] = useState('')
  const [comunas, setComunas] = useState<Comuna[]>([])
  const [abierto, setAbierto] = useState(false)
  const [vista, setVista] = useState<'lista' | 'mapa'>('lista')
  const [activo, setActivo] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => { setF(inicial); setTexto(inicial.q) }, [inicial])
  const load = () => { setPymes(null); setError(''); api<PymeResumen[]>('/pymes').then(setPymes).catch(e => setError(errorText(e))) }
  useEffect(() => { load(); api<Comuna[]>('/comunas').then(setComunas).catch(() => undefined) }, [])
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer) }, [])
  // La dirección refleja la búsqueda para poder compartirla, sin agregar entradas al historial.
  useEffect(() => {
    const h = hashExplorar(f)
    window.history.replaceState(null, '', h)
    try { sessionStorage.setItem(ULTIMA, h) } catch { /* almacenamiento no disponible */ }
  }, [f])

  const resultados = useMemo(() => pymes ? buscar(pymes, f).filter(p => !abierto || isOpenNow(p, now)) : [], [pymes, f, abierto, now])
  const destacados = useMemo(() => patrocinados(resultados), [resultados])
  const activa = (c: Categoria) => c.rubro ? f.rubro === c.rubro : c.q ? normalizar(f.q) === normalizar(c.q) : !!c.ofertas && f.ofertas
  const alternar = (c: Categoria) => {
    if (c.q) setTexto(activa(c) ? '' : c.q)
    setF(prev => c.rubro ? { ...prev, rubro: prev.rubro === c.rubro ? '' : c.rubro } : c.q ? { ...prev, q: activa(c) ? '' : c.q } : { ...prev, ofertas: !prev.ofertas })
  }
  const limpiar = () => { setF(sinFiltros); setTexto(''); setAbierto(false) }
  const resumen = `${resultados.length} ${resultados.length === 1 ? 'negocio' : 'negocios'}${f.q ? ` para «${f.q}»` : ''}${f.comuna ? ` en ${f.comuna}` : ''}`

  return <div className="public-site explore-site">
    <PublicHeader current="explorar" />
    <main className="explore-main" id="contenido">
      <h1 className="sr-only">Explorar servicios Pet-Care</h1>
      <form className="search-pill explore-search" role="search" onSubmit={e => { e.preventDefault(); setF(prev => ({ ...prev, q: texto })); (document.activeElement as HTMLElement | null)?.blur() }}>
        <label className="search-pill-field search-pill-what"><span>Qué buscas</span><input value={texto} onChange={e => { setTexto(e.target.value); setF(prev => ({ ...prev, q: e.target.value })) }} placeholder="Baño, vacunación, veterinaria o un negocio" /></label>
        <label className="search-pill-field search-pill-where"><span>Comuna</span><select value={f.comuna} onChange={e => setF(prev => ({ ...prev, comuna: e.target.value }))}><option value="">Todas las comunas</option>{comunas.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}</select></label>
        <button className="primary search-pill-button" aria-label="Buscar"><Search size={20} aria-hidden="true" /><span>Buscar</span></button>
      </form>
      <div className="explore-filters">
        <CategoryBar activa={activa} onToggle={alternar} />
        <button type="button" className={abierto ? 'explore-toggle active' : 'explore-toggle'} aria-pressed={abierto} onClick={() => setAbierto(!abierto)}><Clock3 size={16} aria-hidden="true" /> Abierto ahora</button>
      </div>
      {error && !pymes ? <ErrorState message={error} onRetry={load} /> : <div className="explore-layout" data-view={vista}>
        <section className="explore-results" aria-label="Resultados">
          <div className="explore-summary"><strong role="status">{pymes ? resumen : 'Buscando negocios...'}</strong><span>Ordenados por coincidencia con tu búsqueda. El plan del negocio no cambia este orden; los patrocinados se muestran aparte.</span></div>
          {!pymes && <LoadingState label="Cargando negocios" rows={3} />}
          {!!destacados.length && <div className="explore-sponsored"><p className="explore-sponsored-label">Patrocinado</p><div className="explore-grid">{destacados.map(p => <ExploreCard key={p.id} p={p} now={now} patrocinado onHover={setActivo} />)}</div></div>}
          {pymes && resultados.length > 0 && <div className="explore-grid">{resultados.map((p, i) => <ExploreCard key={p.id} p={p} n={i + 1} now={now} onHover={setActivo} />)}</div>}
          {pymes && !resultados.length && <EmptyState title="Sin resultados" description="Prueba con otra palabra, otra comuna o quita los filtros." action="Quitar filtros" onAction={limpiar} />}
        </section>
        <aside className="explore-map" aria-label="Mapa">
          <ExploreMap places={resultados} now={now} activeId={activo} visible={vista === 'mapa'} onSelect={p => { window.location.hash = `#local/${p.id}` }} />
          <p className="explore-legend"><span><i className="tier-oro" />Plan Oro</span><span><i className="tier-plata" />Plan Plata</span><span><i className="tier-base" />Otros negocios validados</span><span title={FICHA_PUBLICA.detalle}><i className="is-unclaimed" />{FICHA_PUBLICA.etiqueta}</span></p>
        </aside>
        <button type="button" className="explore-view-toggle" onClick={() => setVista(vista === 'lista' ? 'mapa' : 'lista')}>{vista === 'lista' ? <><MapIcon size={18} aria-hidden="true" /> Mapa</> : <><List size={18} aria-hidden="true" /> Lista</>}</button>
      </div>}
    </main>
    <PublicFooter />
  </div>
}
