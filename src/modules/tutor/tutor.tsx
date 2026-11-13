import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, ArrowRight, CalendarDays, Check, ChevronRight, CirclePlus, Compass, Copy, Download, HeartHandshake, Megaphone, MessageCircle, MessagesSquare, PawPrint, Pencil, Printer, QrCode, Scissors, ShieldCheck, ShoppingBag, Stethoscope, Tag, TriangleAlert, X } from 'lucide-react'
import QRCode from 'qrcode'
import { LogoMark, Photo } from '../../shared/media'
import { FotoEditable } from '../../shared/foto-editable'
import { EmptyState, ErrorState, LoadingState } from '../../shared/feedback'
import { ApiError, api, edadDesde, emptyFicha, errorText, fechaLarga, iniciales, type FichaDatos, type Mascota, type PublicaEmergencia, type PymeResumen, type RegistroMeta } from '../../shared/api'
import { emergencyContactSchema, medicalEntrySchema, petDetailsSchema, petHealthSchema } from '../../shared/validators'
import { AdoptionCatalog } from '../ong/adoption'
import { CommunityView, type Tipo } from '../community/community'
import { DirectoryView, type DirectorioInicial } from '../directory/directory'
import { AdoptionShowcase, CommunityPulse, NearbyServices, QuickRoutes, TutorJourney, enComuna, useTutorHome, type Paso, type Ruta } from './tutor-home'
import { BannerStrip } from '../promotions/promotions'
import { useModalFocus } from '../../shared/accessibility'
import { ProfileCover } from '../../shared/profile-cover'

// meta conserva lo que el formulario del tutor no edita (próxima dosis, autoría de la clínica, anulación).
type Entry = { id: string; type: 'Vacuna' | 'Atención' | 'Tratamiento'; date: string; title: string; notes: string; meta?: RegistroMeta & { proxima?: string; fin?: string } }

const splitList = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean)
const ficha = (pet: Mascota): FichaDatos => ({ ...emptyFicha(), ...pet.datos_clinicos })
const qrUrl = (token: string) => `${window.location.origin}${import.meta.env.BASE_URL}#qr/${token}`

// Indicador de campos registrados, no diagnóstico: el API aún no distingue «ninguna» de «sin revisar».
const completionOf = (pet: Mascota) => {
  const f = ficha(pet)
  const checks = [!!pet.nombre && !!pet.especie, f.alergias.length > 0, f.condiciones.length > 0, !!pet.token_activo]
  return { percent: checks.filter(Boolean).length * 25, next: !checks[1] ? 'allergies' : !checks[2] ? 'conditions' : !checks[3] ? 'qr' : null } as const
}

const entriesOf = (pet: Mascota): Entry[] => {
  const f = ficha(pet)
  return [
    ...f.vacunas.map(({ id, nombre, fecha, notas, ...meta }, i): Entry => ({ id: id || `v${i}`, type: 'Vacuna', date: fecha, title: nombre, notes: notas || '', meta })),
    ...f.atenciones.map(({ id, motivo, fecha, notas, ...meta }, i): Entry => ({ id: id || `a${i}`, type: 'Atención', date: fecha, title: motivo, notes: notas || '', meta })),
    ...f.tratamientos.map(({ id, descripcion, inicio, notas, ...meta }, i): Entry => ({ id: id || `t${i}`, type: 'Tratamiento', date: inicio || '', title: descripcion, notes: notas || '', meta })),
  ].sort((a, b) => b.date.localeCompare(a.date))
}

// Reconstruye los tres arreglos JSONB de la ficha a partir de la lista unificada del historial.
const withEntries = (f: FichaDatos, entries: Entry[]): FichaDatos => ({
  ...f,
  vacunas: entries.filter(e => e.type === 'Vacuna').map(e => ({ ...e.meta, id: e.id, nombre: e.title, fecha: e.date, ...(e.notes ? { notas: e.notes } : {}) })),
  atenciones: entries.filter(e => e.type === 'Atención').map(e => ({ ...e.meta, id: e.id, fecha: e.date, motivo: e.title, ...(e.notes ? { notas: e.notes } : {}) })),
  tratamientos: entries.filter(e => e.type === 'Tratamiento').map(e => ({ ...e.meta, id: e.id, descripcion: e.title, ...(e.date ? { inicio: e.date } : {}), ...(e.notes ? { notas: e.notes } : {}) })),
})

// La ficha se guarda con control de versión: si otra persona la cambió, el API responde 409 (CP-05).
const saveFicha = (pet: Mascota, next: FichaDatos) => api(`/mascotas/${pet.id}/ficha`, { method: 'PUT', body: { version: pet.ficha_version, datos_clinicos: next } })

// Se recarga al cambiar de vista para reflejar lo que registró una clínica o una adopción desde otra cuenta.
function usePets(view: string) {
  const [pets, setPets] = useState<Mascota[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => { try { setPets(await api<Mascota[]>('/mascotas')); setError('') } catch (e) { setError(errorText(e)) } }, [])
  useEffect(() => { void load() }, [load, view])
  return { pets, error, load }
}

// Un atajo del Inicio lleva a otra vista con algo ya elegido: filtros del directorio, un animal o el tipo de publicación.
type Destino = { vista: 'directory'; dir: DirectorioInicial } | { vista: 'adoption'; animal: string } | { vista: 'community'; tipo: Tipo }
type Ir = (vista: string, destino?: Destino) => void

export function TutorArea({ active, setActive, name }: { active: string; setActive: (id: string) => void; name: string }) {
  const { pets, error, load } = usePets(active)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Mascota | null>(null)
  const [qrPet, setQrPet] = useState<Mascota | null>(null)
  const [nextField, setNextField] = useState<{ id: string; field: 'allergies' | 'conditions' | 'qr' } | null>(null)
  const [openPyme, setOpenPyme] = useState<string | null>(null)
  const [destino, setDestino] = useState<Destino | null>(null)
  const consumed = useCallback(() => setOpenPyme(null), [])
  // Al salir de la vista de destino se olvida lo elegido: volver por el menú la abre sin filtros.
  useEffect(() => { if (destino && destino.vista !== active) setDestino(null) }, [active, destino])

  const ir: Ir = (vista, d) => { setDestino(d ?? null); setActive(vista) }
  const openBusiness = (id: string) => { setOpenPyme(id); ir('directory') }
  const para = destino?.vista === active ? destino : null
  if (active === 'adoption') return <AdoptionCatalog initialAnimal={para?.vista === 'adoption' ? para.animal : null} />
  if (active === 'directory') return <DirectoryView initialPyme={openPyme} onOpened={consumed} initialFilters={para?.vista === 'directory' ? para.dir : null} />
  if (active === 'community') return <CommunityView initialType={para?.vista === 'community' ? para.tipo : null} onAdoption={() => setActive('adoption')} onPyme={openBusiness} />
  if (!pets) return <section className="page">{error ? <ErrorState message={error} onRetry={() => void load()} /> : <LoadingState label="Cargando mascotas" />}</section>
  const selected = pets.find(p => p.id === selectedId) || pets[0] || null
  const pick = (pet: Mascota) => { setSelectedId(pet.id); setActive('pets') }
  const openMissing = (pet: Mascota) => { const field = completionOf(pet).next; if (!field) return; setSelectedId(pet.id); setNextField({ id: pet.id, field }); setActive('pets') }
  const openHealth = (pet: Mascota) => { setSelectedId(pet.id); setNextField({ id: pet.id, field: 'allergies' }); setActive('pets') }

  return <>
    {active === 'home' && <Dashboard pets={pets} name={name} banner={<BannerStrip ubicacion="inicio" onPyme={openBusiness} />} onSelect={pick} onMissing={openMissing} onHealth={openHealth} onQr={setQrPet} onPets={() => setActive('pets')} onPyme={openBusiness} onAdd={() => setShowAdd(true)} ir={ir} />}
    {active === 'pets' && <PetsView pets={pets} selected={selected} onSelect={pet => setSelectedId(pet.id)} onMissing={openMissing} target={nextField} onTargetHandled={() => setNextField(null)} onAdd={() => setShowAdd(true)} onQr={setQrPet} onEdit={setEditing} onChanged={load} />}
    {showAdd && <PetFormModal onClose={() => setShowAdd(false)} onSaved={async id => { await load(); setSelectedId(id); setShowAdd(false); setActive('pets') }} />}
    {editing && <PetFormModal pet={editing} onClose={() => setEditing(null)} onSaved={async () => { await load(); setEditing(null) }} />}
    {qrPet && <QrModal pet={pets.find(p => p.id === qrPet.id) || qrPet} onClose={() => setQrPet(null)} onChanged={load} />}
  </>
}

// Mascota destacada del inicio: foto, estado del QR, alergias y próxima vacuna.
function PetHero({ pet, onOpen }: { pet: Mascota; onOpen: () => void }) {
  const edad = edadDesde(pet.fecha_nacimiento)
  const proxima = (pet.datos_clinicos.vacunas || []).map(v => v.proxima).filter((d): d is string => !!d).sort()[0]
  const alergias = (pet.datos_clinicos.alergias || []).map(a => a.agente)
  return <article className="pet-hero">
    <Photo src={pet.foto_url} nombre={pet.nombre} className="pet-hero-photo" />
    <div className="pet-hero-body">
      <p className="eyebrow">TU COMPAÑERO</p>
      <h2>{pet.nombre}</h2>
      <p className="muted">{pet.raza || pet.especie}{edad != null ? ` · ${edad} ${edad === 1 ? 'año' : 'años'}` : ''}</p>
      <div className="pet-hero-chips">
        <span className={pet.token_activo ? 'chip chip-ok' : 'chip chip-warn'}><QrCode size={14} /> {pet.token_activo ? 'QR activo' : 'Sin QR activo'}</span>
        {alergias.slice(0, 2).map(a => <span key={a} className="chip chip-alert">Alergia: {a}</span>)}
        {proxima && <span className="chip chip-info">Próxima vacuna: {new Date(proxima + 'T00:00:00').toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
      </div>
      <button className="primary" onClick={onOpen}>Abrir ficha <ArrowRight size={16} /></button>
    </div>
  </article>
}

function Dashboard({ pets, name, banner, onSelect, onMissing, onHealth, onQr, onPets, onPyme, onAdd, ir }: { pets: Mascota[]; name: string; banner?: React.ReactNode; onSelect: (pet: Mascota) => void; onMissing: (pet: Mascota) => void; onHealth: (pet: Mascota) => void; onQr: (pet: Mascota) => void; onPets: () => void; onPyme: (id: string) => void; onAdd: () => void; ir: Ir }) {
  const home = useTutorHome()
  const { comuna } = home
  const sinQr = pets.filter(p => !p.token_activo).length
  const vaccines = upcomingVaccines(pets)
  const conQr = pets.find(p => p.token_activo)
  const primera = pets[0]

  // Cada atajo muestra cuántos hay en la comuna del tutor; si no hay ninguno, el directorio se abre sin comuna.
  const pymes = home.pymes.data
  const directorio = (id: string, label: string, icon: Ruta['icon'], tone: Ruta['tone'], rubro: string, ofertas = false): Ruta => {
    const n = pymes ? enComuna(pymes, comuna, rubro).filter(p => !ofertas || !!p.ofertas || !!p.cupones?.length).length : null
    const lugar = comuna ? `en ${comuna}` : 'en PetSuite'
    return { id, label, icon, tone, detail: n === null ? 'Ver en el directorio' : ofertas ? `${n} ${n === 1 ? 'negocio' : 'negocios'} ${lugar}` : `${n} ${lugar}`, onClick: () => ir('directory', { vista: 'directory', dir: { rubro, ofertas, comuna: n ? comuna : '' } }) }
  }
  const animales = home.animales.data?.length
  const avisos = home.muro.data?.filter(p => p.urgente && !p.resuelto).length ?? 0
  const rutas: Ruta[] = [
    directorio('vet', 'Veterinarias', Stethoscope, 'accent', 'veterinaria'),
    directorio('pelu', 'Peluquería y baño', Scissors, 'info', 'peluqueria'),
    directorio('tienda', 'Alimento y accesorios', ShoppingBag, 'success', 'tienda'),
    directorio('ofertas', 'Ofertas y cupones', Tag, 'warm', '', true),
    { id: 'adoptar', label: 'Adoptar', icon: HeartHandshake, tone: 'danger', detail: animales == null ? 'Animales en adopción' : `${animales} buscan hogar`, onClick: () => ir('adoption') },
    { id: 'extravio', label: 'Reportar extravío', icon: Megaphone, tone: 'warm', detail: 'Avisa a tu comuna', onClick: () => ir('community', { vista: 'community', tipo: 'extravio' }) },
    { id: 'qr', label: 'Medalla QR', icon: QrCode, tone: 'accent', detail: conQr ? `Mostrar la de ${conQr.nombre}` : primera ? `Actívala para ${primera.nombre}` : 'Registra tu mascota', onClick: () => conQr ? onQr(conQr) : primera ? onQr(primera) : onAdd() },
    { id: 'muro', label: 'Muro comunal', icon: MessagesSquare, tone: 'info', detail: avisos ? `${avisos} ${avisos === 1 ? 'aviso activo' : 'avisos activos'}` : 'Lo nuevo de tu comuna', onClick: () => ir('community') },
  ]

  // El recorrido se marca con lo que el tutor ya registró: fichas, medallas, vacunas y su participación en el muro.
  const conSalud = pets.some(p => { const f = ficha(p); return f.alergias.length > 0 || f.condiciones.length > 0 || !!f.notaEmergencia })
  const pasos: Paso[] = [
    { id: 'mascota', label: 'Registra a tu mascota', detail: 'Su nombre y especie bastan para empezar.', done: pets.length > 0, action: 'Registrar', onClick: onAdd },
    { id: 'salud', label: 'Completa sus datos de salud', detail: 'Alergias, condiciones y una nota para quien la encuentre.', done: conSalud, action: 'Completar', onClick: () => primera ? onHealth(primera) : onAdd() },
    { id: 'qr', label: 'Activa su medalla QR', detail: 'Quien la encuentre podrá avisarte sin ver tus datos.', done: !!conQr, action: 'Activar', onClick: () => primera ? onQr(primera) : onAdd() },
    { id: 'vacunas', label: 'Registra sus vacunas', detail: 'Aquí verás cuándo se acerca la próxima dosis.', done: pets.some(p => ficha(p).vacunas.length > 0), action: 'Registrar', onClick: () => primera ? onSelect(primera) : onAdd() },
    { id: 'comunidad', label: 'Súmate a tu comuna', detail: 'Publica o apoya un aviso en el muro comunal.', done: !!home.muro.data?.some(p => p.es_mio || p.reaccione), action: 'Ir al muro', onClick: () => ir('community') },
  ]

  return <section className="page home-page tutor-home">
    <ProfileCover eyebrow="TU ESPACIO PETSUITE" title={`Hola, ${name.split(' ')[0]}`} subtitle="Todo lo importante para tus mascotas, en un solo lugar." avatar={iniciales(name)}
      actions={<><button className="primary" onClick={onAdd}><CirclePlus size={17} /> Agregar mascota</button><button className="secondary" onClick={() => ir('directory')}><Compass size={17} /> Explorar servicios</button></>}
      stats={[{ label: 'Mascotas', value: pets.length }, { label: 'Medallas QR activas', value: pets.length - sinQr }, { label: 'Vacunas próximas', value: vaccines.length }]} />
    <QuickRoutes rutas={rutas} />
    {(home.muro.data || home.muro.error) && <TutorJourney pasos={pasos} />}
    {primera && <PetHero pet={primera} onOpen={() => onSelect(primera)} />}
    {sinQr > 0 && <div className="alert-card warn"><div className="alert-icon"><QrCode size={22} /></div><div><strong>{`${sinQr} ${sinQr === 1 ? 'mascota sin' : 'mascotas sin'} medalla QR activa`}</strong><p>Activa su QR para que quien la encuentre pueda avisarte sin ver tus datos personales.</p></div><button className="text-button" onClick={onPets}>Ver fichas <ArrowRight size={16} /></button></div>}
    <div className="tutor-home-grid">
    <section className="content-panel upcoming-vaccines" aria-labelledby="upcoming-vaccines-title"><div className="section-heading"><div><p className="eyebrow">SALUD Y PREVENCIÓN</p><h2 id="upcoming-vaccines-title">Próximas vacunas</h2></div>{vaccines.length > 0 && <span className="pet-count">{vaccines.length}</span>}</div>{vaccines.length > 0 ? <div className="vaccination-list">{vaccines.map(vaccine => <button type="button" className={vaccine.days < 0 ? 'vaccination-row overdue' : 'vaccination-row'} key={`${vaccine.pet.id}-${vaccine.name}-${vaccine.date}`} onClick={() => onSelect(vaccine.pet)}><span className="vaccination-icon"><CalendarDays size={18} /></span><span className="vaccination-main"><strong>{vaccine.name}</strong><small>{vaccine.pet.nombre} · {fechaLarga(vaccine.date)}</small></span><span className="vaccination-status">{vaccine.days < 0 ? `Vencida hace ${Math.abs(vaccine.days)} días` : vaccine.days === 0 ? 'Vence hoy' : `Faltan ${vaccine.days} días`}<ChevronRight size={17} aria-hidden="true" /></span></button>)}</div> : <div className="vaccination-empty"><CalendarDays size={22} aria-hidden="true" /><div><strong>No hay vacunas próximas</strong><p>Cuando una vacuna tenga próxima dosis dentro de 30 días, aparecerá aquí.</p></div></div>}</section>
    <CommunityPulse muro={home.muro} comuna={comuna} onOpen={() => ir('community')} />
    </div>
    {banner}
    <NearbyServices pymes={home.pymes} comuna={comuna} onPyme={onPyme} onAll={() => ir('directory', { vista: 'directory', dir: { comuna: pymes && comuna && enComuna(pymes, comuna).length ? comuna : '' } })} />
    <AdoptionShowcase animales={home.animales} comuna={comuna} onAnimal={id => ir('adoption', { vista: 'adoption', animal: id })} onAll={() => ir('adoption')} />
    {pets.length > 0 && <section className="content-panel"><div className="section-heading"><div><p className="eyebrow">MIS MASCOTAS</p><h2>Sus fichas</h2></div><button className="text-button" onClick={onPets}>Ver todas <ArrowRight size={16} /></button></div>
      <div className="pet-grid">{pets.map(pet => <PetCardWithNext key={pet.id} pet={pet} onClick={() => onSelect(pet)} onMissing={() => onMissing(pet)} />)}<button className="add-card" onClick={onAdd}><CirclePlus size={25} /><strong>Agregar mascota</strong><small>Registra a un nuevo compañero</small></button></div>
    </section>}
  </section>
}

function PetCard({ pet, onClick, compact, selected }: { pet: Mascota; onClick: () => void; compact?: boolean; selected?: boolean }) {
  const edad = edadDesde(pet.fecha_nacimiento)
  const { percent } = completionOf(pet)
  return <button className={`pet-card ${compact ? 'compact' : ''} ${selected ? 'selected' : ''}`} onClick={onClick}><Photo src={pet.foto_url} nombre={pet.nombre} /><div className="pet-info"><strong>{pet.nombre}</strong><span>{pet.raza || pet.especie}{edad != null ? ` · ${edad} ${edad === 1 ? 'año' : 'años'}` : ''}</span><em className="pet-completion">Ficha {percent} % completa</em>{!compact && <small><b className={pet.token_activo ? 'status-dot' : 'status-dot inactive'} /> {pet.token_activo ? 'Medalla QR activa' : 'Sin medalla QR'}</small>}</div>{compact && <ChevronRight className="chevron" size={18} />}</button>
}

function PetCardWithNext({ pet, onClick, onMissing, compact, selected }: { pet: Mascota; onClick: () => void; onMissing: () => void; compact?: boolean; selected?: boolean }) {
  const next = completionOf(pet).next
  const label = next === 'allergies' ? 'Completar alergias' : next === 'conditions' ? 'Completar condiciones' : 'Generar medalla QR'
  return <div className={`pet-card-wrapper ${compact ? 'compact' : ''}`}><PetCard pet={pet} onClick={onClick} compact={compact} selected={selected} />{next && <button type="button" className="text-button pet-next" onClick={onMissing}>{label} de {pet.nombre} <ArrowRight size={16} /></button>}</div>
}

function PetsView({ pets, selected, onSelect, onMissing, target, onTargetHandled, onAdd, onQr, onEdit, onChanged }: { pets: Mascota[]; selected: Mascota | null; onSelect: (pet: Mascota) => void; onMissing: (pet: Mascota) => void; target: { id: string; field: 'allergies' | 'conditions' | 'qr' } | null; onTargetHandled: () => void; onAdd: () => void; onQr: (pet: Mascota) => void; onEdit: (pet: Mascota) => void; onChanged: () => Promise<void> }) {
  const [healthOpen, setHealthOpen] = useState(false)
  const [healthField, setHealthField] = useState<'allergies' | 'conditions' | null>(null)
  const [entryOpen, setEntryOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null)
  useEffect(() => {
    if (!target || target.id !== selected?.id) return
    if (target.field === 'qr') onQr(selected)
    else { setHealthField(target.field); setHealthOpen(true) }
    onTargetHandled()
  }, [target, selected, onQr, onTargetHandled])
  const persist = async (pet: Mascota, next: FichaDatos) => { await saveFicha(pet, next); await onChanged() }
  return <section className="page pets-page"><div className="page-title"><div><p className="eyebrow">TU ESPACIO</p><h1>Mis mascotas</h1><p className="muted">Ficha de salud, historial y QR de emergencia en un solo lugar.</p></div><button className="primary" onClick={onAdd}><CirclePlus size={17} /> Agregar mascota</button></div>
    <div className="pets-layout"><section className="pet-list content-panel"><div className="section-heading"><div><p className="eyebrow">TUS COMPAÑEROS</p><h2>Selecciona una ficha</h2></div><span className="pet-count">{pets.length}</span></div>{pets.map(pet => <PetCardWithNext key={pet.id} pet={pet} onClick={() => onSelect(pet)} onMissing={() => onMissing(pet)} compact selected={selected?.id === pet.id} />)}</section>
      {selected ? <PetDetail key={selected.id} pet={selected} onQr={() => onQr(selected)} onEdit={() => onEdit(selected)} onHealth={field => { setHealthField(field || null); setHealthOpen(true) }} onAddEntry={() => { setEditingEntry(null); setEntryOpen(true) }} onEditEntry={entry => { setEditingEntry(entry); setEntryOpen(true) }} onChanged={onChanged} /> : <EmptyState title="Comienza su Ficha Única" description="Agrega una mascota para registrar sus datos de salud y generar su QR." action="Agregar mascota" onAction={onAdd} />}</div>
    {selected && healthOpen && <HealthModal key={selected.id} pet={selected} initialField={healthField} onClose={() => { setHealthOpen(false); setHealthField(null) }} onSave={async next => { await persist(selected, next); setHealthOpen(false); setHealthField(null) }} />}
    {selected && entryOpen && <EntryModal key={`${selected.id}-${editingEntry?.id || 'new'}`} entry={editingEntry} onClose={() => setEntryOpen(false)} onSave={async entry => {
      const others = entriesOf(selected).filter(e => e.id !== editingEntry?.id)
      await persist(selected, withEntries(ficha(selected), [...others, { ...entry, meta: editingEntry?.meta }])); setEntryOpen(false)
    }} />}
  </section>
}

/** Foto de la mascota con botón para subirla, cambiarla o quitarla. Se ve en su ficha, en el QR y en el cartel. */
function PetPhoto({ pet, onChanged }: { pet: Mascota; onChanged: () => Promise<void> | void }) {
  return <FotoEditable src={pet.foto_url} nombre={pet.nombre} asignar={async imagenId => { await api(`/mascotas/${pet.id}/foto`, { method: 'PUT', body: { imagen_id: imagenId } }); await onChanged() }} />
}

function PetDetail({ pet, onQr, onEdit, onHealth, onAddEntry, onEditEntry, onChanged }: { pet: Mascota; onQr: () => void; onEdit: () => void; onHealth: (field?: 'allergies' | 'conditions') => void; onAddEntry: () => void; onEditEntry: (entry: Entry) => void; onChanged: () => Promise<void> | void }) {
  const f = ficha(pet)
  const completion = completionOf(pet)
  const history = entriesOf(pet)
  const edad = edadDesde(pet.fecha_nacimiento)
  return <article className="detail-card health-detail"><div className="detail-head"><PetPhoto pet={pet} onChanged={onChanged} /><div><p className="eyebrow">FICHA ÚNICA DE SALUD</p><h2>{pet.nombre}</h2><p className="muted">{pet.especie}{pet.raza ? ` · ${pet.raza}` : ''}</p></div><button type="button" className="secondary pet-edit-button" onClick={onEdit}><Pencil size={16} /> Editar datos</button></div>
    <div className="pet-completion-panel"><div><strong>Ficha {completion.percent} % completa</strong><p>{completion.next ? 'Agrega datos para que su ficha de emergencia sea más útil.' : 'Datos principales registrados y medalla QR activa.'}</p></div>{completion.next && <button type="button" className="text-button" onClick={() => completion.next === 'qr' ? onQr() : onHealth(completion.next!)}>{completion.next === 'allergies' ? 'Completar alergias' : completion.next === 'conditions' ? 'Completar condiciones' : 'Generar medalla QR'} <ArrowRight size={16} /></button>}</div>
    <div className="detail-stats"><div><small>Edad</small><strong>{edad == null ? 'Sin dato' : `${edad} ${edad === 1 ? 'año' : 'años'}`}</strong></div><div><small>Sexo</small><strong>{pet.sexo ? pet.sexo[0].toUpperCase() + pet.sexo.slice(1) : 'Sin dato'}</strong></div><div><small>Versión de ficha</small><strong>{pet.ficha_version}</strong></div></div>
    <section className="pet-health-section"><div className="pet-section-head"><div><p className="eyebrow">INFORMACIÓN CRÍTICA</p><h3>Datos de salud</h3></div><button className="secondary" onClick={() => onHealth()}><Pencil size={15} /> Editar salud</button></div><div className="health-facts"><div><span>Alergias</span><strong>{f.alergias.length ? f.alergias.map(a => a.agente).join(', ') : 'No registradas'}</strong></div><div><span>Condiciones médicas</span><strong>{f.condiciones.length ? f.condiciones.join(', ') : 'No registradas'}</strong></div><div><span>Medicamentos · solo tutor</span><strong>{f.medicamentos.length ? f.medicamentos.join(', ') : 'No registrados'}</strong></div></div>{f.notaEmergencia && <p className="health-note"><AlertCircle size={17} /> {f.notaEmergencia}</p>}</section>
    <section className="pet-health-section"><div className="pet-section-head"><div><p className="eyebrow">REGISTRO PRIVADO</p><h3>Historial médico</h3></div><button className="secondary" onClick={onAddEntry}><CirclePlus size={16} /> Agregar registro</button></div>{history.length ? <div className="medical-timeline">{history.map(entry => <div className={entry.meta?.anulado ? 'medical-event is-void' : 'medical-event'} key={`${entry.type}-${entry.id}`}><div className="medical-event-icon"><CalendarDays size={17} /></div><div><span>{entry.type}{entry.date ? ` · ${new Date(`${entry.date}T12:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}</span><strong>{entry.title}</strong>{entry.notes && <p>{entry.notes}</p>}{entry.meta?.proxima && <p>Próxima dosis: {new Date(`${entry.meta.proxima}T12:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}</p>}{entry.meta?.clinica && <small className="event-author">Registrado por {entry.meta.clinica}{entry.meta.anulado ? ` · Anulado por la clínica: ${entry.meta.anulado.motivo}` : ''}</small>}</div>{entry.meta?.registrado_por ? <span className="event-lock">Registro clínico</span> : <button className="text-button" onClick={() => onEditEntry(entry)} aria-label={`Editar ${entry.title}`}>Editar</button>}</div>)}</div> : <p className="muted">Todavía no hay vacunas ni atenciones registradas.</p>}</section>
    <section className="pet-qr-section"><div className="pet-section-head"><div><p className="eyebrow">ACCESO DE EMERGENCIA</p><h3>Medalla QR</h3></div><span className={pet.token_activo ? 'pet-qr-badge active' : 'pet-qr-badge'}>{pet.token_activo ? 'Activa' : 'Sin medalla'}</span></div><p className="muted">El QR contiene solo un código opaco. La ficha pública muestra nombre, especie, raza, alergias, condiciones y la nota de emergencia; tus datos personales, medicamentos e historial nunca se exponen.</p><p className="pet-qr-warning">Si pierdes la medalla, genera una nueva o desactívala: el código anterior deja de funcionar de inmediato.</p><button className="primary" onClick={onQr}><QrCode size={17} /> {pet.token_activo ? 'Ver y compartir QR' : 'Generar medalla QR'}</button></section>
    <ClinicAccess pet={pet} />
    <PetMessages pet={pet} />
  </article>
}

type Acceso = { id: number; permiso: string; vigente_hasta: string; clinica: string }

function ClinicAccess({ pet }: { pet: Mascota }) {
  const [access, setAccess] = useState<Acceso[]>([])
  const [vets, setVets] = useState<PymeResumen[]>([])
  const [form, setForm] = useState({ pyme_id: '', permiso: 'lectura', dias: '7' })
  const [error, setError] = useState('')
  const reload = useCallback(() => api<Acceso[]>(`/mascotas/${pet.id}/accesos`).then(setAccess).catch(e => setError(errorText(e))), [pet.id])
  useEffect(() => { void reload(); api<PymeResumen[]>('/pymes?rubro=veterinaria').then(v => { setVets(v); setForm(prev => ({ ...prev, pyme_id: v[0]?.id || '' })) }).catch(() => undefined) }, [reload])
  const grant = async (event: React.FormEvent) => {
    event.preventDefault(); setError('')
    try { await api(`/mascotas/${pet.id}/accesos`, { method: 'POST', body: { pyme_id: form.pyme_id, permiso: form.permiso, dias: Number(form.dias) } }); await reload() } catch (e) { setError(errorText(e)) }
  }
  const revoke = async (id: number) => { try { await api(`/mascotas/${pet.id}/accesos/${id}`, { method: 'DELETE' }); await reload() } catch (e) { setError(errorText(e)) } }
  return <section className="pet-health-section"><div className="pet-section-head"><div><p className="eyebrow">COMPARTIR CON UNA VETERINARIA</p><h3>Acceso temporal a la ficha</h3></div></div>
    <p className="muted">Solo tú decides quién puede ver o completar esta ficha, por un tiempo limitado. Cada acceso queda auditado.</p>
    {access.length > 0 && <div className="demo-contact-list">{access.map(a => <div key={a.id}><small>{a.permiso === 'escritura' ? 'Lectura y registro' : 'Solo lectura'} · hasta {new Date(a.vigente_hasta).toLocaleDateString('es-CL')}</small><p>{a.clinica} <button className="text-button" onClick={() => revoke(a.id)}>Revocar</button></p></div>)}</div>}
    {vets.length ? <form className="settings-form-grid" onSubmit={grant}><label>Veterinaria<select value={form.pyme_id} onChange={e => setForm({ ...form, pyme_id: e.target.value })}>{vets.map(v => <option key={v.id} value={v.id}>{v.nombre_comercial} · {v.comuna}</option>)}</select></label><label>Permiso<select value={form.permiso} onChange={e => setForm({ ...form, permiso: e.target.value })}><option value="lectura">Solo lectura</option><option value="escritura">Lectura y registro de atenciones</option></select></label><label>Días (máx. 30)<input type="number" min="1" max="30" value={form.dias} onChange={e => setForm({ ...form, dias: e.target.value })} /></label><button className="secondary">Otorgar acceso</button></form> : <p className="muted">Aún no hay veterinarias verificadas en el directorio.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}

type Mensaje = { id: string; remitente_nombre: string | null; remitente_contacto: string | null; mensaje: string; estado: string; enviado_en: string; latitud: string | null; longitud: string | null }

function PetMessages({ pet }: { pet: Mascota }) {
  const [messages, setMessages] = useState<Mensaje[]>([])
  const reload = useCallback(() => api<Mensaje[]>(`/mascotas/${pet.id}/mensajes`).then(setMessages).catch(() => undefined), [pet.id])
  useEffect(() => { void reload() }, [reload])
  const mark = async (id: string, estado: 'leido' | 'respondido') => { await api(`/mascotas/mensajes/${id}`, { method: 'PATCH', body: { estado } }); await reload() }
  if (!messages.length) return null
  return <section className="pet-health-section"><div className="pet-section-head"><div><p className="eyebrow">CONTACTO SEGURO</p><h3>Mensajes de quien encontró a {pet.nombre}</h3></div></div>
    <div className="demo-contact-list">{messages.map(m => <div key={m.id}><small>{new Date(m.enviado_en).toLocaleString('es-CL')} · {m.estado === 'nuevo' ? 'Nuevo' : m.estado === 'leido' ? 'Leído' : 'Respondido'}</small><p>{m.mensaje}</p>{(m.remitente_nombre || m.remitente_contacto) && <p><b>{m.remitente_nombre}</b> {m.remitente_contacto && `· ${m.remitente_contacto}`}</p>}{m.latitud && m.longitud && <a className="text-button" target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/?mlat=${m.latitud}&mlon=${m.longitud}#map=17/${m.latitud}/${m.longitud}`}>Ver ubicación aproximada <ArrowRight size={14} /></a>}{m.estado !== 'respondido' && <button className="text-button" onClick={() => mark(m.id, m.estado === 'nuevo' ? 'leido' : 'respondido')}>{m.estado === 'nuevo' ? 'Marcar como leído' : 'Marcar como respondido'}</button>}</div>)}</div></section>
}

function HealthModal({ pet, initialField, onClose, onSave }: { pet: Mascota; initialField?: 'allergies' | 'conditions' | null; onClose: () => void; onSave: (next: FichaDatos) => Promise<void> }) {
  useModalFocus(onClose, initialField ? `#health-${initialField}` : '#health-allergies')
  const f = ficha(pet)
  const [form, setForm] = useState({ allergies: f.alergias.map(a => a.agente).join(', '), conditions: f.condiciones.join(', '), medications: f.medicamentos.join(', '), emergencyNotes: f.notaEmergencia })
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = petHealthSchema.safeParse(form)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = String(issue?.path[0] || '')
      setError(issue?.message || 'Revisa los datos de salud'); setErrorField(field)
      requestAnimationFrame(() => document.getElementById(`health-${field}`)?.focus())
      return
    }
    const lists = [parsed.data.allergies, parsed.data.conditions, parsed.data.medications].map(splitList)
    setBusy(true)
    try {
      const known = new Map(f.alergias.map(a => [a.agente.toLowerCase(), a]))
      await onSave({ ...f, alergias: lists[0].map(agente => known.get(agente.toLowerCase()) || { agente }), condiciones: lists[1], medicamentos: lists[2], notaEmergencia: parsed.data.emergencyNotes.trim() })
    } catch (e) { setError(errorText(e)); setErrorField('') } finally { setBusy(false) }
  }
  const update = (key: keyof typeof form, value: string) => { setForm({ ...form, [key]: value }); if (errorField === key) { setError(''); setErrorField('') } }
  const fieldProps = (key: keyof typeof form) => ({ id: `health-${key}`, 'aria-invalid': errorField === key, 'aria-describedby': errorField === key ? 'health-field-error' : undefined })
  return <div className="modal-backdrop"><form className="modal health-form-modal" onSubmit={submit} noValidate><button type="button" className="close" aria-label="Cerrar" onClick={onClose}><X size={20} /></button><p className="eyebrow">FICHA DE {pet.nombre.toUpperCase()}</p><h2>Editar datos de salud</h2><p className="muted">Separa varios elementos con comas. Alergias, condiciones y nota de emergencia aparecerán en el QR.</p><div className="health-form-fields"><label>Alergias<input {...fieldProps('allergies')} value={form.allergies} onChange={e => update('allergies', e.target.value)} placeholder="Ej.: pollo, penicilina" /></label><label>Condiciones médicas<input {...fieldProps('conditions')} value={form.conditions} onChange={e => update('conditions', e.target.value)} placeholder="Ej.: diabetes" /></label><label>Medicamentos (privado)<input {...fieldProps('medications')} value={form.medications} onChange={e => update('medications', e.target.value)} placeholder="Ej.: tratamiento indicado por veterinaria" /></label><label>Nota pública de emergencia<textarea {...fieldProps('emergencyNotes')} rows={3} maxLength={160} value={form.emergencyNotes} onChange={e => update('emergencyNotes', e.target.value)} placeholder="Indicación importante para quien encuentre a tu mascota" /></label></div>{error && <p className="form-error" id={errorField ? 'health-field-error' : undefined} role={errorField ? undefined : 'alert'}>{error}</p>}<div className="modal-actions"><button className="secondary" type="button" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Guardando...' : 'Guardar salud'}</button></div></form></div>
}

type UpcomingVaccine = { pet: Mascota; name: string; date: string; days: number }

const localDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
const daysUntil = (iso: string) => Math.round((localDay(new Date(`${iso}T12:00:00`)) - localDay(new Date())) / 86400000)
const upcomingVaccines = (pets: Mascota[]): UpcomingVaccine[] => pets.flatMap(pet => ficha(pet).vacunas.flatMap(vaccine => {
  if (!vaccine.proxima || Number.isNaN(new Date(`${vaccine.proxima}T12:00:00`).getTime())) return []
  const days = daysUntil(vaccine.proxima)
  return days <= 30 ? [{ pet, name: vaccine.nombre, date: vaccine.proxima, days }] : []
})).sort((a, b) => a.days - b.days || a.date.localeCompare(b.date) || a.pet.nombre.localeCompare(b.pet.nombre))

function EntryModal({ entry, onClose, onSave }: { entry: Entry | null; onClose: () => void; onSave: (entry: Entry) => Promise<void> }) {
  useModalFocus(onClose, 'input[type="date"]')
  const [form, setForm] = useState({ date: entry?.date || new Date().toISOString().slice(0, 10), type: entry?.type || 'Atención' as Entry['type'], title: entry?.title || '', notes: entry?.notes || '' })
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = medicalEntrySchema.safeParse(form)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = String(issue?.path[0] || '')
      setError(issue?.message || 'Revisa el registro'); setErrorField(field)
      requestAnimationFrame(() => document.getElementById(`entry-${field}`)?.focus())
      return
    }
    setBusy(true)
    try { await onSave({ id: entry?.id.match(/^[vat]\d+$/) ? crypto.randomUUID() : entry?.id || crypto.randomUUID(), ...parsed.data }) } catch (e) { setError(errorText(e)); setErrorField('') } finally { setBusy(false) }
  }
  const update = (key: keyof typeof form, value: string) => { setForm({ ...form, [key]: value }); if (errorField === key) { setError(''); setErrorField('') } }
  const fieldProps = (key: keyof typeof form) => ({ id: `entry-${key}`, 'aria-invalid': errorField === key, 'aria-describedby': errorField === key ? 'entry-field-error' : undefined })
  return <div className="modal-backdrop"><form className="modal health-form-modal" onSubmit={submit} noValidate><button type="button" className="close" aria-label="Cerrar" onClick={onClose}><X size={20} /></button><p className="eyebrow">HISTORIAL PRIVADO</p><h2>{entry ? 'Editar registro' : 'Agregar atención o vacuna'}</h2><div className="health-form-fields"><label>Fecha<input {...fieldProps('date')} type="date" value={form.date} onChange={e => update('date', e.target.value)} /></label><label>Tipo<select {...fieldProps('type')} value={form.type} onChange={e => update('type', e.target.value as Entry['type'])}><option>Atención</option><option>Vacuna</option><option>Tratamiento</option></select></label><label>Nombre del registro<input {...fieldProps('title')} value={form.title} onChange={e => update('title', e.target.value)} placeholder="Ej.: vacuna antirrábica" /></label><label>Detalles<textarea {...fieldProps('notes')} rows={4} maxLength={500} value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="Indicaciones, resultados o próxima visita" /></label></div>{error && <p className="form-error" id={errorField ? 'entry-field-error' : undefined} role={errorField ? undefined : 'alert'}>{error}</p>}<div className="modal-actions"><button className="secondary" type="button" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Guardando...' : 'Guardar registro'}</button></div></form></div>
}

function PetFormModal({ pet, onClose, onSaved }: { pet?: Mascota; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  useModalFocus(onClose, 'input')
  const [form, setForm] = useState({ nombre: pet?.nombre || '', especie: pet?.especie || 'Perro', raza: pet?.raza || '', sexo: pet?.sexo || 'desconocido', fecha_nacimiento: pet?.fecha_nacimiento?.slice(0, 10) || '' })
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = petDetailsSchema.safeParse(form)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = String(issue?.path[0] || '')
      setError(issue?.message || 'Revisa los datos de tu mascota'); setErrorField(field)
      requestAnimationFrame(() => document.getElementById(`pet-${field}`)?.focus())
      return
    }
    const d = parsed.data
    const body = { nombre: d.nombre, especie: d.especie, sexo: d.sexo, ...(d.raza ? { raza: d.raza } : {}), ...(d.fecha_nacimiento ? { fecha_nacimiento: d.fecha_nacimiento } : {}) }
    setBusy(true)
    try {
      const saved = pet ? await api<{ id: string }>(`/mascotas/${pet.id}`, { method: 'PATCH', body }) : await api<{ id: string }>('/mascotas', { method: 'POST', body })
      await onSaved(saved.id)
    } catch (e) { setError(errorText(e)); setErrorField(''); setBusy(false) }
  }
  const set = (key: string, value: string) => { setForm({ ...form, [key]: value }); if (errorField === key) { setError(''); setErrorField('') } }
  const fieldProps = (key: string) => ({ id: `pet-${key}`, 'aria-invalid': errorField === key, 'aria-describedby': errorField === key ? 'pet-field-error' : undefined })
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit} noValidate><button type="button" className="close" aria-label="Cerrar" onClick={onClose}><X size={20} /></button><p className="eyebrow">{pet ? 'EDITAR FICHA' : 'NUEVA FICHA'}</p><h2>{pet ? `Datos de ${pet.nombre}` : 'Agrega un compañero'}</h2><p className="muted">{pet ? 'Actualiza su información básica.' : 'Se creará su Ficha Única de Salud.'}</p><div className="form-grid"><label>Nombre<input {...fieldProps('nombre')} value={form.nombre} onChange={e => set('nombre', e.target.value)} /></label><label>Especie<select {...fieldProps('especie')} value={form.especie} onChange={e => set('especie', e.target.value)}><option>Perro</option><option>Gato</option><option>Otro</option></select></label><label>Raza<input {...fieldProps('raza')} value={form.raza} onChange={e => set('raza', e.target.value)} /></label><label>Sexo<select {...fieldProps('sexo')} value={form.sexo} onChange={e => set('sexo', e.target.value)}><option value="desconocido">Desconocido</option><option value="macho">Macho</option><option value="hembra">Hembra</option></select></label><label>Fecha de nacimiento (aprox.)<input {...fieldProps('fecha_nacimiento')} type="date" max={new Date().toISOString().slice(0, 10)} value={form.fecha_nacimiento} onChange={e => set('fecha_nacimiento', e.target.value)} /></label></div>{error && <div className="form-error" id={errorField ? 'pet-field-error' : undefined} role={errorField ? undefined : 'alert'}>{error}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Guardando...' : 'Guardar ficha'}</button></div></form></div>
}

// UC-04 · Generar, reemplazar o desactivar la medalla. El QR lleva un token opaco, no datos.
function QrModal({ pet, onClose, onChanged }: { pet: Mascota; onClose: () => void; onChanged: () => Promise<void> }) {
  useModalFocus(onClose)
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const token = pet.token_activo
  const url = token ? qrUrl(token) : ''
  useEffect(() => {
    if (!url) { setSrc(''); return }
    QRCode.toDataURL(url, { width: 1200, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#171717', light: '#ffffff' } }).then(setSrc).catch(() => setError('No se pudo generar el QR.'))
  }, [url])
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await onChanged() } catch (e) { setError(errorText(e)) } finally { setBusy(false) } }
  const issue = () => act(() => api(`/mascotas/${pet.id}/medallas`, { method: 'POST' }))
  const disable = () => act(() => api(`/mascotas/${pet.id}/medallas/activa`, { method: 'DELETE' }))
  const download = () => {
    if (!src) return
    const name = pet.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mascota'
    const link = document.createElement('a')
    link.href = src
    link.download = `petsuite-${name}-qr.png`
    link.click()
  }
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true) } catch { setError('No se pudo copiar el enlace. Ábrelo en otra pestaña para compartirlo.') } }
  return <><div className="modal-backdrop"><div className="modal qr-modal public-qr-modal" role="dialog" aria-modal="true" aria-labelledby="qr-title"><button type="button" className="close" aria-label="Cerrar QR" onClick={onClose}><X size={20} /></button><p className="eyebrow">MEDALLA DE EMERGENCIA</p><h2 id="qr-title">QR de {pet.nombre}</h2>
    {token ? <>
      <p className="muted">Funciona sin iniciar sesión ni instalar nada, desde cualquier teléfono.</p>
      <div className="qr-display">{src ? <img src={src} alt={`Código QR de emergencia de ${pet.nombre}`} /> : <span>{error || 'Generando QR...'}</span>}</div>
      <div className="qr-actions"><button className="primary" disabled={!src} onClick={download}><Download size={16} /> Descargar PNG</button><button className="secondary" disabled={!src} onClick={() => window.print()}><Printer size={16} /> Imprimir</button></div>
      <div className="qr-link-actions"><button className="secondary" onClick={copy}><Copy size={16} /> {copied ? 'Enlace copiado' : 'Copiar enlace'}</button><a className="text-button" href={url} target="_blank" rel="noopener noreferrer">Ver ficha pública <ArrowRight size={16} /></a></div><span className="sr-only" role="status" aria-live="polite">{copied ? 'Enlace del QR copiado' : ''}</span>
      <div className="qr-actions"><button className="secondary" disabled={busy} onClick={issue}>Reemplazar medalla</button><button className="secondary danger-button" disabled={busy} onClick={disable}>Desactivar</button></div>
      <p className="qr-disclaimer">Reemplazar o desactivar invalida el QR anterior al instante, aunque ya esté impreso.</p>
    </> : <>
      <p className="muted">Aún no hay una medalla activa. Al generarla se crea un código opaco que no contiene datos personales.</p>
      <button className="primary full" disabled={busy} onClick={issue}><QrCode size={17} /> {busy ? 'Generando...' : 'Generar medalla QR'}</button>
    </>}
    {error && token && <p className="form-error" role="alert">{error}</p>}
    {error && !token && <p className="form-error" role="alert">{error}</p>}
  </div></div>{src && token && createPortal(<div className="qr-print-page" aria-hidden="true"><div className="qr-print-medal"><strong>{pet.nombre}</strong><img src={src} alt="" /><span>Escanéame si me encuentras</span></div></div>, document.body)}</>
}

// UC-10 / UC-11 · Vista pública: sin cuenta. El servidor solo entrega campos autorizados.
export function EmergencyView({ token }: { token: string | null }) {
  const [pet, setPet] = useState<PublicaEmergencia | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'invalid' | 'disabled' | 'network'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [form, setForm] = useState({ message: '', name: '', contact: '' })
  const [place, setPlace] = useState<{ latitud: number; longitud: number } | null>(null)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [messageError, setMessageError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPet(null)
    if (!token) { setState('invalid'); return }
    setState('loading')
    setSent(false)
    api<PublicaEmergencia>(`/qr/${token}`).then(p => {
      if (!cancelled) { setPet(p); setState('ok') }
    }).catch(e => {
      if (!cancelled) setState(e instanceof ApiError && e.status === 410 ? 'disabled' : e instanceof ApiError && e.status === 404 ? 'invalid' : 'network')
    })
    return () => { cancelled = true }
  }, [token, attempt])

  const retry = () => { setState('loading'); setAttempt(value => value + 1) }
  if (state === 'loading' && !token) return <div className="emergency-page"><main className="emergency-card emergency-invalid"><QrCode size={35} aria-hidden="true" /><h1>Medalla no válida</h1><p>El enlace no incluye un código de medalla. Si encontraste una mascota, pide ayuda a una veterinaria cercana.</p><a className="secondary" href={import.meta.env.BASE_URL}>Ir a PetSuite</a></main></div>
  if (state === 'loading') return <div className="emergency-page"><main className="emergency-card emergency-invalid" role="status"><PawPrint size={35} aria-hidden="true" /><h1>Cargando ficha</h1><p>Estamos buscando la información de emergencia.</p></main></div>
  if (state !== 'ok' || !pet) {
    const disabled = state === 'disabled'
    const network = state === 'network'
    return <div className="emergency-page"><main className="emergency-card emergency-invalid"><QrCode size={35} aria-hidden="true" /><h1>{network ? 'No pudimos cargar la ficha' : disabled ? 'Medalla desactivada' : 'Medalla no válida'}</h1><p>{network ? 'Revisa tu conexión e inténtalo de nuevo. Si es urgente, pide ayuda a una veterinaria cercana.' : disabled ? 'Su tutor reemplazó o desactivó esta medalla, por eso ya no muestra la ficha. Si encontraste a esta mascota, llévala a una veterinaria cercana para revisar si tiene microchip o avisa en el muro comunal de PetSuite.' : 'Este código no existe. Revisa que el enlace esté completo. Si encontraste una mascota, pide ayuda a una veterinaria cercana.'}</p>{network ? <button type="button" className="primary" onClick={retry}>Reintentar</button> : <a className="secondary" href={import.meta.env.BASE_URL}>Ir a PetSuite</a>}</main></div>
  }
  if (sent) return <div className="emergency-page"><main className="emergency-card emergency-invalid" role="status"><div className="success-mark"><Check size={26} aria-hidden="true" /></div><h1>Aviso enviado</h1><p>Enviamos tu mensaje al tutor de {pet.nombre}. Gracias por ayudar. No se muestran datos personales del tutor.</p></main></div>

  const locate = () => navigator.geolocation?.getCurrentPosition(
    pos => setPlace({ latitud: Number(pos.coords.latitude.toFixed(3)), longitud: Number(pos.coords.longitude.toFixed(3)) }),
    () => setError('No pudimos obtener tu ubicación. Puedes describir el lugar en el mensaje.'), { timeout: 8000 })
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const result = emergencyContactSchema.safeParse({ message: form.message })
    if (!result.success) { setMessageError(result.error.issues[0]?.message || 'Revisa tu mensaje'); requestAnimationFrame(() => document.getElementById('emergency-message')?.focus()); return }
    setBusy(true); setError(''); setMessageError('')
    try {
      await api(`/qr/${token}/mensajes`, { method: 'POST', body: { mensaje: result.data.message, ...(form.name.trim() ? { nombre: form.name.trim() } : {}), ...(form.contact.trim() ? { contacto: form.contact.trim() } : {}), ...(place || {}) } })
      setSent(true)
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 410)) setState(e.status === 410 ? 'disabled' : 'invalid')
      else setError(errorText(e))
    } finally { setBusy(false) }
  }
  return <div className="emergency-page"><main className="emergency-card public-emergency-card"><div className="public-emergency-brand"><span className="brand-mark"><LogoMark /></span> PetSuite <span>FICHA PÚBLICA</span></div><div className="emergency-hero"><Photo src={pet.foto_url} nombre={pet.nombre} className="emergency-pet-photo" /><div className="emergency-hero-text"><p className="eyebrow">INFORMACIÓN DE EMERGENCIA</p><h1>{pet.nombre}</h1><p className="emergency-subtitle">{pet.especie}{pet.raza ? ` · ${pet.raza}` : ''}</p></div></div>
    {pet.alertasCriticas.length > 0 && <div className="emergency-alert"><TriangleAlert size={22} aria-hidden="true" /><div><strong>Atención</strong><p>{pet.alertasCriticas.join(' · ')}</p></div></div>}
    <div className="public-emergency-facts"><div><strong>Alergias</strong><p>{pet.alergias.length ? pet.alergias.map(a => a.agente).join(', ') : 'No registradas'}</p></div><div><strong>Condiciones médicas</strong><p>{pet.condiciones.length ? pet.condiciones.join(', ') : 'No registradas'}</p></div>{pet.notaEmergencia && <div><strong>Indicación importante</strong><p>{pet.notaEmergencia}</p></div>}</div>
    <p className="privacy-note"><ShieldCheck size={18} aria-hidden="true" /> Esta ficha no muestra RUT, teléfono, dirección ni correo del tutor.</p>
    <section className="public-contact-demo"><h2>¿Encontraste a {pet.nombre}?</h2><p>Envía un aviso seguro: el tutor lo recibe sin que se revelen sus datos. Tus datos son opcionales y solo se usarán para coordinar la entrega.</p>
      <form onSubmit={submit} noValidate><label htmlFor="emergency-message">Mensaje<textarea id="emergency-message" rows={4} maxLength={500} value={form.message} aria-invalid={!!messageError} aria-describedby={messageError ? 'emergency-message-error' : undefined} onChange={e => { setForm({ ...form, message: e.target.value }); setMessageError(''); setError('') }} placeholder="Cuéntale dónde y cómo la encontraste..." /></label>{messageError && <p className="form-error" id="emergency-message-error">{messageError}</p>}<label>Tu nombre (opcional)<input maxLength={80} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label><label>Cómo contactarte (opcional)<input maxLength={120} value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} placeholder="Teléfono o correo" /></label><button type="button" className="secondary full" onClick={locate}><MessageCircle size={16} aria-hidden="true" /> {place ? 'Ubicación aproximada incluida' : 'Incluir mi ubicación aproximada'}</button>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary full" disabled={busy}>{busy ? 'Enviando...' : 'Avisar al tutor'}</button></form></section></main></div>
}
