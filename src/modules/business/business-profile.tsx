import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { Camera, Check, MapPin } from 'lucide-react'
import { subirFoto } from '../../shared/fotos'
import { api, errorText, type Comuna, type PymeResumen } from '../../shared/api'
import type { MiPyme } from './business'
import { Photo, rubroFoto } from '../../shared/media'
import { businessProfileSchema } from '../../shared/validators'
import { ErrorState, LoadingState } from '../../shared/feedback'

type EditableProfile = PymeResumen & { rut_empresa: string; comuna_id: number; estado_verificacion: string }
type Draft = {
  nombre_comercial: string; descripcion: string; comuna_id: number; direccion: string; telefono: string; whatsapp: string;
  latitud: string; longitud: string; horario: { 'lun-vie': string; sab: string; dom: string }; servicios: string; foto_portada: string | null
}

const photos = ['/img/vet-2.jpg', '/img/collares.jpg', '/img/groomer-2.jpg', '/img/accesorios.jpg'] as const

function LocationPicker({ lat, lng, onChange }: { lat: string; lng: string; onChange: (lat: string, lng: string) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const pin = useRef<L.Marker | null>(null)

  useEffect(() => {
    if (!box.current) return
    const initial: L.LatLngTuple = lat && lng ? [Number(lat), Number(lng)] : [-40.5735, -73.1335]
    const instance = L.map(box.current, { scrollWheelZoom: false }).setView(initial, 13)
    map.current = instance
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; Colaboradores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(instance)
    instance.on('click', event => onChange(event.latlng.lat.toFixed(5), event.latlng.lng.toFixed(5)))
    return () => { instance.remove(); map.current = null; pin.current = null }
  }, [onChange])

  useEffect(() => {
    if (!map.current) return
    const latitude = Number(lat), longitude = Number(lng)
    if (!lat || !lng || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      pin.current?.remove(); pin.current = null; return
    }
    const location: L.LatLngTuple = [latitude, longitude]
    if (pin.current) pin.current.setLatLng(location)
    else pin.current = L.marker(location).addTo(map.current)
    map.current.setView(location, map.current.getZoom())
  }, [lat, lng])

  return <div ref={box} className="business-location-map" role="region" aria-label="Ubicación de tu negocio. Haz clic para colocar el marcador." />
}

// También lo usa la clínica veterinaria para su perfil del directorio.
export function BusinessProfile({ pyme, onSaved }: { pyme: MiPyme; onSaved?: () => Promise<void> }) {
  const [profile, setProfile] = useState<EditableProfile | null>(null)
  const [comunas, setComunas] = useState<Comuna[]>([])
  const [form, setForm] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState('')
  const [saved, setSaved] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    Promise.all([api<EditableProfile>(`/pymes/${pyme.id}/perfil`), api<Comuna[]>('/comunas')])
      .then(([p, options]) => {
        if (!alive) return
        setProfile(p); setComunas(options)
        setForm({ nombre_comercial: p.nombre_comercial, descripcion: p.descripcion || '', comuna_id: p.comuna_id, direccion: p.direccion || '', telefono: p.telefono || '', whatsapp: p.whatsapp || '', latitud: p.latitud || '', longitud: p.longitud || '', horario: { 'lun-vie': p.horario?.['lun-vie'] || '', sab: p.horario?.sab || '', dom: p.horario?.dom || '' }, servicios: (p.servicios || []).join(', '), foto_portada: p.foto_portada || null })
        setLoading(false)
      })
      .catch(e => { if (alive) { setError(errorText(e)); setLoading(false) } })
    return () => { alive = false }
  }, [pyme.id, attempt])

  const movePin = useCallback((latitude: string, longitude: string) => setForm(previous => previous && { ...previous, latitud: latitude, longitud: longitude }), [])
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setForm(previous => previous && { ...previous, [key]: value })
    if (errorField === key || key === 'horario' && errorField.startsWith('horario-')) { setError(''); setErrorField('') }
  }
  // Portada propia (desde Bronce): la foto se sube y queda elegida; se publica al guardar el perfil.
  const [subiendo, setSubiendo] = useState(false)
  const [errorPortada, setErrorPortada] = useState('')
  const subirPortada = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0]
    event.target.value = ''
    if (!archivo) return
    setSubiendo(true); setErrorPortada('')
    try { set('foto_portada', (await subirFoto(archivo)).url) } catch (e) { setErrorPortada(errorText(e)) } finally { setSubiendo(false) }
  }
  const fieldProps = (field: string) => ({ id: `business-profile-${field}`, 'aria-invalid': errorField === field, 'aria-describedby': errorField === field ? 'business-profile-error' : undefined })

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form) return
    setError(''); setSaved(false)
    const result = businessProfileSchema.safeParse({
      ...form,
      servicios: form.servicios.split(',').map(s => s.trim()).filter(Boolean),
      latitud: form.latitud.trim() === '' ? null : Number(form.latitud),
      longitud: form.longitud.trim() === '' ? null : Number(form.longitud),
    })
    if (!result.success) {
      const issue = result.error.issues[0]
      const field = issue?.path.map(String).join('-') || ''
      setError(issue?.message || 'Revisa el perfil'); setErrorField(field)
      requestAnimationFrame(() => document.getElementById(`business-profile-${field}`)?.focus())
      return
    }
    setBusy(true)
    try {
      const updated = await api<EditableProfile>(`/pymes/${pyme.id}/perfil`, { method: 'PATCH', body: result.data })
      setProfile(updated); await onSaved?.(); setSaved(true)
    } catch (e) { setError(errorText(e)); setErrorField('') } finally { setBusy(false) }
  }

  return <section className="page business-profile-page"><div className="page-title"><div><p className="eyebrow">TU VITRINA PET-CARE</p><h1>{pyme.rubro === 'veterinaria' ? 'Perfil de la clínica' : 'Perfil del negocio'}</h1><p className="muted">Mantén actualizada la información que aparece en el directorio.</p></div></div>
    {loading ? <LoadingState label="Cargando perfil del negocio" rows={2} /> : !form || !profile ? <ErrorState message={error || 'No se pudo cargar el perfil.'} onRetry={() => { setError(''); setLoading(true); setAttempt(value => value + 1) }} /> : <form className="business-profile-layout" onSubmit={submit} noValidate>
      <div className="business-profile-main">
        <section className="settings-card"><div className="settings-card-heading"><div><p className="eyebrow">DATOS DEL NEGOCIO</p><h2>Información pública</h2></div></div><div className="settings-form-grid"><label>Nombre comercial<input {...fieldProps('nombre_comercial')} maxLength={100} value={form.nombre_comercial} onChange={e => set('nombre_comercial', e.target.value)} /></label><label>Comuna<select {...fieldProps('comuna_id')} value={form.comuna_id} onChange={e => set('comuna_id', Number(e.target.value))}>{comunas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label><label>Dirección<input {...fieldProps('direccion')} maxLength={200} value={form.direccion} onChange={e => set('direccion', e.target.value)} placeholder="Calle y número" /></label><label>Teléfono<input {...fieldProps('telefono')} maxLength={20} value={form.telefono} onChange={e => set('telefono', e.target.value)} placeholder="Ej.: +56 64 234 5678" /></label><label>WhatsApp<input {...fieldProps('whatsapp')} maxLength={20} value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} placeholder="Ej.: 56912345678" /></label></div><label className="business-profile-description">Descripción<textarea {...fieldProps('descripcion')} maxLength={1000} rows={4} value={form.descripcion} onChange={e => set('descripcion', e.target.value)} placeholder="Cuéntale a la comunidad qué ofrece tu negocio" /></label><label className="business-profile-description">Servicios destacados (separados por comas, máximo 12)<input {...fieldProps('servicios')} value={form.servicios} onChange={e => set('servicios', e.target.value)} placeholder={pyme.rubro === 'veterinaria' ? 'Consulta general, Vacunación, Urgencias' : 'Despacho a domicilio, Asesoría'} /></label></section>
        <section className="settings-card"><div className="settings-card-heading"><div><p className="eyebrow">VISITAS Y UBICACIÓN</p><h2>Horario y mapa</h2></div></div><div className="settings-form-grid"><label>Lunes a viernes<input {...fieldProps('horario-lun-vie')} maxLength={80} value={form.horario['lun-vie']} onChange={e => set('horario', { ...form.horario, 'lun-vie': e.target.value })} placeholder="09:00-18:00" /></label><label>Sábado<input {...fieldProps('horario-sab')} maxLength={80} value={form.horario.sab} onChange={e => set('horario', { ...form.horario, sab: e.target.value })} placeholder="Cerrado" /></label><label>Domingo<input {...fieldProps('horario-dom')} maxLength={80} value={form.horario.dom} onChange={e => set('horario', { ...form.horario, dom: e.target.value })} placeholder="Cerrado" /></label></div><p className="muted business-location-hint"><MapPin size={16} /> Marca tu ubicación en el mapa o ingresa ambas coordenadas.</p><LocationPicker lat={form.latitud} lng={form.longitud} onChange={movePin} /><div className="settings-form-grid business-coordinates"><label>Latitud<input {...fieldProps('latitud')} inputMode="decimal" value={form.latitud} onChange={e => set('latitud', e.target.value)} placeholder="-40.5735" /></label><label>Longitud<input {...fieldProps('longitud')} inputMode="decimal" value={form.longitud} onChange={e => set('longitud', e.target.value)} placeholder="-73.1335" /></label></div></section>
      </div>
      <div className="business-profile-side"><section className="settings-card"><div className="settings-card-heading"><div><p className="eyebrow">IDENTIDAD VISUAL</p><h2>Portada</h2></div></div><Photo src={form.foto_portada || rubroFoto[profile.rubro] || rubroFoto.otro} nombre={form.nombre_comercial} className="business-profile-cover" /><p className="muted">{pyme.plan.beneficios.portada ? 'Sube una foto de tu local o elige una de muestra. Se guarda al presionar «Guardar cambios».' : 'Elige una foto de muestra. La portada propia está disponible desde el plan Bronce.'}</p>{pyme.plan.beneficios.portada && <label className={`secondary business-cover-upload${subiendo ? ' is-busy' : ''}`}><Camera size={15} aria-hidden="true" /> {subiendo ? 'Subiendo…' : 'Subir foto del local'}<input className="sr-only" type="file" accept="image/*" disabled={subiendo} onChange={subirPortada} /></label>}{errorPortada && <p className="form-error" role="alert">{errorPortada}</p>}<div className="business-cover-options">{photos.map(src => <button type="button" key={src} className={form.foto_portada === src ? 'business-cover-option active' : 'business-cover-option'} onClick={() => set('foto_portada', src)} aria-label={`Elegir portada ${src.split('/').pop()?.replace('.jpg', '')}`} aria-pressed={form.foto_portada === src}><Photo src={src} nombre="Portada" className="business-cover-thumb" /></button>)}</div></section>
        <section className="settings-card business-profile-verification"><p className="eyebrow">DATOS VERIFICADOS</p><h2>{profile.estado_verificacion === 'aprobada' ? 'Negocio verificado' : 'Estado: ' + profile.estado_verificacion}</h2><p className="muted">{profile.rubro} · RUT {profile.rut_empresa}</p><p className="muted">Para cambiar el RUT o rubro debes contactar a PetSuite.</p></section>
        <div className="business-profile-submit">{error && <p className="form-error" id={errorField ? 'business-profile-error' : undefined} role={errorField ? undefined : 'alert'}>{error}</p>}{saved && <p className="business-saved" role="status"><Check size={17} /> Cambios guardados en el directorio.</p>}<button className="primary full" disabled={busy}>{busy ? 'Guardando...' : 'Guardar perfil'}</button></div>
      </div>
    </form>}
  </section>
}
