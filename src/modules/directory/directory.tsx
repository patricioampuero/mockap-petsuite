import { useCallback, useEffect, useRef, useState } from 'react'
import { Building2, ChevronRight, Clock3, Crown, MapPin, MessageCircle, Navigation, Phone, Search, Tag } from 'lucide-react'
import { BannerStrip, CouponList } from '../promotions/promotions'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Photo, rubroFoto } from '../../shared/media'
import { api, clp, errorText, fechaCorta, type ItemCatalogo, type PymePerfil, type PymeResumen, type Comuna, type SucursalPublica } from '../../shared/api'
import { businessContactSchema } from '../../shared/validators'
import { EmptyState, ErrorState, LoadingState } from '../../shared/feedback'
import { useModalFocus } from '../../shared/accessibility'
import { directionsUrl, isOpenNow, statusForBusiness, statusForSchedule } from './directory-hours'
import { SELLO, puntaje, rubroLabel } from './explore-search'

const rubros = [['', 'Todas'], ['veterinaria', 'Veterinarias'], ['tienda', 'Tiendas'], ['peluqueria', 'Peluquerías']] as const
export const diaLabel: Record<string, string> = { 'lun-vie': 'Lunes a viernes', sab: 'Sábado', dom: 'Domingo' }

// Visitas, clics y vistas de ítems para las métricas del negocio. No requiere sesión.
export const trackEvento = (id: string, tipo: 'vista_item' | 'clic_contacto' | 'clic_whatsapp', item_id?: string) => { api(`/pymes/${id}/eventos`, { method: 'POST', body: { tipo, ...(item_id ? { item_id } : {}) } }).catch(() => undefined) }
type SentContact = { id: string; negocio: string; mensaje: string; respuesta: string | null; estado: 'nuevo' | 'leido' | 'respondido'; creado_en: string }

// Mapa Leaflet + OpenStreetMap (informe 2.1, decisión 6). Si las teselas no cargan, la lista sigue funcionando.
function PlacesMap({ places, onSelect }: { places: PymeResumen[]; onSelect: (p: PymeResumen) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
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
    const points: L.LatLngTuple[] = []
    // Un pin por casa matriz y otro por cada sucursal visible, con el mismo número del negocio.
    places.forEach((p, i) => [{ nombre: p.nombre_comercial, latitud: p.latitud, longitud: p.longitud }, ...(p.sucursales || []).map(s => ({ nombre: `${p.nombre_comercial} · ${s.nombre}`, latitud: s.latitud, longitud: s.longitud }))].forEach(lugar => {
      if (lugar.latitud == null || lugar.longitud == null) return
      const at: L.LatLngTuple = [Number(lugar.latitud), Number(lugar.longitud)]
      points.push(at)
      L.marker(at, { title: lugar.nombre, icon: L.divIcon({ className: 'leaflet-num-pin', html: `<span>${i + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }) })
        .on('click', () => select.current(p)).addTo(layer.current!)
    }))
    if (points.length) map.current.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 })
  }, [places])

  return <div ref={box} className="leaflet-box" role="region" aria-label="Mapa de negocios Pet-Care" />
}

/** Filtros con que se abre el directorio desde un atajo, por ejemplo «Veterinarias» en el Inicio del tutor. */
export type DirectorioInicial = { rubro?: string; comuna?: string; ofertas?: boolean }

export function DirectoryView({ initialPyme, onOpened, initialFilters }: { initialPyme?: string | null; onOpened?: () => void; initialFilters?: DirectorioInicial | null } = {}) {
  const [places, setPlaces] = useState<PymeResumen[] | null>(null)
  const [comunas, setComunas] = useState<Comuna[]>([])
  const [comuna, setComuna] = useState(initialFilters?.comuna ?? '')
  const [rubro, setRubro] = useState(initialFilters?.rubro ?? '')
  const [query, setQuery] = useState('')
  const [soloOfertas, setSoloOfertas] = useState(!!initialFilters?.ofertas)
  const [soloAbiertos, setSoloAbiertos] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [selected, setSelected] = useState<PymeResumen | null>(null)
  const [error, setError] = useState('')
  const [showContacts, setShowContacts] = useState(false)
  const [sentContacts, setSentContacts] = useState<SentContact[] | null>(null)
  const [contactError, setContactError] = useState('')
  const loadContacts = () => api<SentContact[]>('/mis-contactos-pyme').then(rows => { setSentContacts(rows); setContactError('') }).catch(e => setContactError(errorText(e)))

  useEffect(() => { api<Comuna[]>('/comunas').then(setComunas).catch(() => undefined) }, [])
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer) }, [])
  const load = useCallback(() => {
    const qs = new URLSearchParams({ ...(comuna ? { comuna } : {}), ...(rubro ? { rubro } : {}) }).toString()
    setPlaces(null); setError('')
    void api<PymeResumen[]>(`/pymes${qs ? `?${qs}` : ''}`).then(p => { setPlaces(p); setError('') }).catch(e => setError(errorText(e)))
  }, [comuna, rubro])
  useEffect(() => { load() }, [load])

  const [abrir, setAbrir] = useState<string | null>(initialPyme ?? null)
  useEffect(() => { if (initialPyme) { setAbrir(initialPyme); onOpened?.() } }, [initialPyme, onOpened])
  // La búsqueda cubre nombre, descripción, comunas, servicios de la empresa y de cada sucursal, y cupones con ONG.
  const shown = (places || []).filter(p => puntaje(p, query) > 0 &&(!soloOfertas || !!p.ofertas || !!p.cupones?.length) && (!soloAbiertos || isOpenNow(p, now)))
  return <section className="page directory-page"><div className="directory-hero"><div><p className="eyebrow">DIRECTORIO PET-CARE</p><h1>Encuentra servicios para tu mascota</h1><p>Veterinarias, tiendas y peluquerías de tu comuna y todas sus sucursales, con catálogo, cupones de ONG y contacto directo.</p></div></div>
    <BannerStrip ubicacion="directorio" onPyme={setAbrir} />
    <div className="directory-contact-bar"><span>¿Ya escribiste a un negocio? Consulta aquí sus respuestas.</span><button className="secondary" onClick={() => { setShowContacts(!showContacts); if (!showContacts) void loadContacts() }}><MessageCircle size={16} /> {showContacts ? 'Ocultar consultas' : 'Mis consultas'}</button></div>
    {showContacts && <section className="directory-my-contacts"><div className="pet-section-head"><div><p className="eyebrow">CONVERSACIONES</p><h2>Mis consultas</h2></div><button className="text-button" onClick={() => void loadContacts()}>Actualizar</button></div>{contactError && <p className="form-error" role="alert">{contactError}</p>}{sentContacts?.map(row => <article key={row.id} className="directory-contact-item"><div><strong>{row.negocio}</strong><small>{new Date(row.creado_en).toLocaleString('es-CL')} · {row.estado === 'respondido' ? 'Respondida' : row.estado === 'leido' ? 'Leída' : 'Enviada'}</small></div><p>{row.mensaje}</p>{row.respuesta && <div className="business-contact-answer"><strong>Respuesta del negocio</strong><p>{row.respuesta}</p></div>}</article>)}{sentContacts?.length === 0 && <div className="empty-results">Todavía no tienes consultas a negocios.</div>}</section>}
    <div className="directory-toolbar"><label className="search-field"><Search size={17} aria-hidden="true" /><span className="sr-only">Buscar negocio</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Busca por nombre, servicio, sucursal o cupón" /></label><select aria-label="Comuna" value={comuna} onChange={e => setComuna(e.target.value)}><option value="">Todas las comunas</option>{comunas.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}</select></div>
    <div className="category-tabs">{rubros.map(([value, label]) => <button key={label} className={rubro === value ? 'category-tab active' : 'category-tab'} onClick={() => setRubro(value)}>{label}</button>)}<button className={soloOfertas ? 'category-tab active' : 'category-tab'} aria-pressed={soloOfertas} onClick={() => setSoloOfertas(!soloOfertas)}><Tag size={14} /> Con ofertas o cupones</button><button className={soloAbiertos ? 'category-tab active' : 'category-tab'} aria-pressed={soloAbiertos} onClick={() => setSoloAbiertos(!soloAbiertos)}><Clock3 size={14} /> Abierto ahora</button></div>
    {error && !places && <ErrorState message={error} onRetry={load} />}
    <div className="directory-layout"><div className="business-results"><div className="results-count"><strong>{places ? `${shown.length} ${shown.length === 1 ? 'lugar' : 'lugares'}` : 'Cargando...'}</strong><span title={SELLO.detalle}>Negocios validados por PetSuite</span></div>
      {!places && !error && <LoadingState label="Cargando negocios" rows={2} />}
      {shown.map(p => { const status = statusForBusiness(p, now); return <button key={p.id} className="business-card store-card" onClick={() => setSelected(p)}><Photo src={p.foto_portada || rubroFoto[p.rubro] || rubroFoto.otro} nombre={p.nombre_comercial} className="business-logo business-thumb" /><div className="business-info"><div className="business-card-top"><strong>{p.nombre_comercial}</strong>{p.destacado === 2 && <span className="chip chip-featured"><Crown size={12} /> Destacado</span>}{!!p.ofertas && <span className="chip chip-warn"><Tag size={12} /> {p.ofertas === 1 ? '1 oferta' : `${p.ofertas} ofertas`}</span>}{!!p.cupones?.length && <span className="chip chip-info">Cupón ONG</span>}</div><span>{rubroLabel[p.rubro] || p.rubro} · {p.comuna}{p.sucursales?.length ? ` · +${p.sucursales.length} ${p.sucursales.length === 1 ? 'sucursal' : 'sucursales'}` : ''}</span><small>{p.descripcion}</small><div className="business-meta">{p.direccion}</div><span className={`business-open-status${status.open ? ' is-open' : status.known ? ' is-closed' : ''}`}><Clock3 size={14} /> {status.text}</span></div><ChevronRight className="chevron" size={18} /></button> })}
      {places && shown.length === 0 && <EmptyState title={places.length ? 'Sin resultados' : 'Aún no hay negocios'} description={places.length ? 'Prueba otra búsqueda o quita los filtros.' : 'Vuelve más tarde para explorar negocios verificados.'} action={places.length ? 'Quitar filtros' : 'Actualizar'} onAction={() => { if (places.length) { setQuery(''); setComuna(''); setRubro(''); setSoloOfertas(false); setSoloAbiertos(false) } else load() }} />}</div>
      <div className="map-card"><div className="map-header"><strong>Mapa</strong><span>{shown.length} en el mapa</span></div><PlacesMap places={shown} onSelect={setSelected} /></div></div>
     {(selected || abrir) && <PymeModal id={selected?.id ?? abrir!} now={now} onClose={() => { setSelected(null); setAbrir(null) }} onContactSent={() => { if (showContacts) void loadContacts() }} />}
  </section>
}

/** Catálogo con precios referenciales; al abrir un ítem se registra su vista. */
export function BusinessCatalog({ items, onView }: { items: ItemCatalogo[]; onView: (itemId: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const toggle = (itemId: string) => { setOpen(open === itemId ? null : itemId); onView(itemId) }
  return <div className="product-list">{items.length ? items.map(item => <div className={item.oferta ? 'product-row has-offer' : 'product-row'} key={item.id} onClick={() => toggle(item.id)} role="button" tabIndex={0} aria-expanded={open === item.id} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(item.id) } }}><div><strong>{item.nombre}</strong><small>{item.tipo === 'servicio' ? 'Servicio' : 'Producto'}{item.categoria ? ` · ${item.categoria}` : ''}{open === item.id && item.descripcion ? ` · ${item.descripcion}` : ''}</small>{(item.oferta || item.sin_stock) && <div className="chip-row">{item.oferta && <span className="chip chip-warn"><Tag size={12} /> Oferta hasta el {fechaCorta(item.oferta.hasta)}</span>}{item.sin_stock && <span className="chip chip-alert">Sin stock por ahora</span>}</div>}</div>{item.oferta ? <span className="price-offer"><s>{clp(item.precio_referencial_clp)}</s><b>{clp(item.oferta.precio_clp)}</b></span> : <b>{clp(item.precio_referencial_clp)}</b>}</div>) : <p className="muted">Este negocio aún no publica su catálogo.</p>}</div>
}

export function BranchList({ sucursales, now }: { sucursales: SucursalPublica[]; now: Date }) {
  return <div className="branch-list">{sucursales.map(s => { const branchStatus = statusForSchedule(s.horario, now); const branchDirections = directionsUrl(s.latitud, s.longitud); const branchHours = Object.entries(s.horario || {}).filter(([, hours]) => hours?.trim()).map(([d, h]) => `${diaLabel[d] || d} ${h}`).join(', '); return <div key={s.id} className="branch-row"><Building2 size={18} aria-hidden="true" /><div><strong>{s.nombre}</strong><small>{s.direccion ? `${s.direccion} · ` : ''}{s.comuna}{branchHours ? ` · ${branchHours}` : ''}</small><small className={`branch-open-status${branchStatus.open ? ' is-open' : branchStatus.known ? ' is-closed' : ''}`}><Clock3 size={14} /> {branchStatus.text}</small>{s.descripcion && <small>{s.descripcion}</small>}{!!s.servicios.length && <div className="chip-row">{s.servicios.map(x => <span key={x} className="chip">{x}</span>)}</div>}<div className="branch-actions">{branchDirections && <a className="secondary text-button" href={branchDirections} target="_blank" rel="noopener noreferrer"><Navigation size={15} /> Cómo llegar</a>}{s.telefono && <a className="text-button" href={`tel:${s.telefono}`}>Llamar</a>}</div></div></div> })}</div>
}

/** Consulta a un negocio desde PetSuite (requiere sesión). La respuesta se lee en «Mis consultas». */
export function BusinessContactForm({ id, nombre, onSent }: { id: string; nombre: string; onSent?: () => void }) {
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [contactError, setContactError] = useState('')
  const [contactErrorField, setContactErrorField] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const submitContact = async (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = businessContactSchema.safeParse({ mensaje: message, contacto: contact })
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = String(issue?.path[0] || '')
      setContactError(issue?.message || 'Revisa tu consulta'); setContactErrorField(field)
      requestAnimationFrame(() => document.getElementById(`directory-contact-${field}`)?.focus())
      return
    }
    setBusy(true); setContactError(''); setContactErrorField('')
    try { await api(`/pymes/${id}/contactos`, { method: 'POST', body: parsed.data }); setSent(true); setMessage(''); onSent?.() } catch (e) { setContactError(errorText(e)) } finally { setBusy(false) }
  }
  return <section className="directory-contact-form"><p className="eyebrow">CONTACTO EN PETSUITE</p><h3>Escribe a {nombre}</h3><p className="muted">Tu consulta llegará a su bandeja. Podrás leer su respuesta en «Mis consultas».</p><p className="sr-only" role="status" aria-live="polite">{sent ? 'Consulta enviada. Revisa Mis consultas para ver la respuesta.' : ''}</p>{sent && <p className="business-saved"><MessageCircle size={17} /> Consulta enviada. Revisa «Mis consultas» para ver la respuesta.</p>}<form onSubmit={submitContact} noValidate><label>Mensaje<textarea id="directory-contact-mensaje" maxLength={500} rows={4} value={message} aria-invalid={contactErrorField === 'mensaje'} aria-describedby={contactErrorField === 'mensaje' ? 'directory-contact-error' : undefined} onChange={e => { setMessage(e.target.value); setContactError(''); setContactErrorField(''); setSent(false) }} placeholder="Cuéntale qué necesitas..." /></label><label>Dato de contacto (opcional)<input id="directory-contact-contacto" maxLength={120} value={contact} aria-invalid={contactErrorField === 'contacto'} aria-describedby={contactErrorField === 'contacto' ? 'directory-contact-error' : undefined} onChange={e => { setContact(e.target.value); if (contactErrorField === 'contacto') { setContactError(''); setContactErrorField('') } }} placeholder="Correo o teléfono si quieres compartirlo" /></label>{contactError && <p className="form-error" id={contactErrorField ? 'directory-contact-error' : undefined} role={contactErrorField ? undefined : 'alert'}>{contactError}</p>}<button className="primary" disabled={busy}>{busy ? 'Enviando...' : 'Enviar consulta'}</button></form></section>
}

function PymeModal({ id, now, onClose, onContactSent }: { id: string; now: Date; onClose: () => void; onContactSent: () => void }) {
  useModalFocus(onClose, ':scope')
  const [pyme, setPyme] = useState<PymePerfil | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<PymePerfil>(`/pymes/${id}`).then(setPyme).catch(e => setError(errorText(e))) }, [id])
  const track = (tipo: 'vista_item' | 'clic_contacto' | 'clic_whatsapp', item_id?: string) => trackEvento(id, tipo, item_id)
   if (!pyme) return <div className="modal-backdrop directory-profile-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}><article className="modal store-modal directory-profile-modal" role="dialog" aria-modal="true" aria-label="Perfil del negocio"><div className="directory-profile-scroll"><p className="muted">{error || 'Cargando perfil...'}</p><button type="button" className="secondary" onClick={onClose}>Volver al directorio</button></div></article></div>
  const wa = pyme.whatsapp?.replace(/\D/g, '')
  const openStatus = statusForBusiness(pyme, now)
  const mainDirections = directionsUrl(pyme.latitud, pyme.longitud)
   return <div className="modal-backdrop directory-profile-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}><article className="modal store-modal directory-profile-modal" role="dialog" aria-modal="true" aria-labelledby="directory-business-title"><div className="directory-profile-scroll"><Photo src={pyme.foto_portada || rubroFoto[pyme.rubro] || rubroFoto.otro} nombre={pyme.nombre_comercial} className="business-hero modal-photo" /><p className="eyebrow">{(rubroLabel[pyme.rubro] || pyme.rubro).toUpperCase()} · {pyme.comuna?.toUpperCase()}</p><h2 id="directory-business-title">{pyme.nombre_comercial}</h2><p className="muted">{pyme.descripcion}</p>
     <div className="store-info">{pyme.direccion && <span><MapPin size={16} /> {pyme.direccion}</span>}{Object.entries(pyme.horario || {}).filter(([, hours]) => hours?.trim()).map(([dia, h]) => <span key={dia}><Clock3 size={16} /> {diaLabel[dia] || dia}: {h}</span>)}<span className={`store-open-status${openStatus.open ? ' is-open' : openStatus.known ? ' is-closed' : ''}`}><Clock3 size={16} /> {openStatus.text}</span>{mainDirections && <a className="secondary store-directions" href={mainDirections} target="_blank" rel="noopener noreferrer"><Navigation size={16} /> Cómo llegar</a>}</div>
    {!!pyme.servicios?.length && <div className="chip-row service-chips" aria-label="Servicios destacados">{pyme.servicios.map(s => <span className="chip chip-info" key={s}>{s}</span>)}</div>}
    {!!pyme.cupones?.length && <><div className="section-heading"><h3>Cupones con ONG aliadas</h3></div><p className="muted">Presenta el código al pagar: tu compra apoya a la organización.</p><CouponList cupones={pyme.cupones} por="ong" /></>}
     {!!pyme.sucursales?.length && <><div className="section-heading"><h3>Sucursales</h3></div><BranchList sucursales={pyme.sucursales} now={now} /></>}
    <div className="section-heading"><h3>Catálogo</h3></div>
    <p className="muted">Precios referenciales. La compra y el pago se coordinan directamente con el negocio.</p>
    <BusinessCatalog items={pyme.catalogo} onView={itemId => track('vista_item', itemId)} />
    <div className="qr-actions">{pyme.telefono && <a className="secondary" href={`tel:${pyme.telefono}`} onClick={() => track('clic_contacto')}><Phone size={16} /> Llamar</a>}{wa && <a className="primary" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" onClick={() => track('clic_whatsapp')}><MessageCircle size={16} /> WhatsApp</a>}</div>
    {!pyme.telefono && !wa && <p className="muted">Este negocio no publicó un medio de contacto.</p>}
    <BusinessContactForm id={id} nombre={pyme.nombre_comercial} onSent={onContactSent} />
     <button className="secondary full" onClick={onClose}>Seguir explorando</button></div></article></div>
}
