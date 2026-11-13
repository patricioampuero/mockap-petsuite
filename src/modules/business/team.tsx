import { useCallback, useEffect, useState } from 'react'
import { CirclePlus, MapPin, Pencil, Trash2, UserPlus, X } from 'lucide-react'
import { api, errorText, fechaLarga, type Comuna } from '../../shared/api'
import { Loading } from '../../shared/media'
import type { MiPyme } from './business'
import { ROLES_EQUIPO, moduloLabel, type ModuloPyme, type RolEquipo } from '../../shared/permissions'
import { cupoTexto } from '../plans/plans'
import { EmptyState, ErrorState, LoadingState, PermissionState } from '../../shared/feedback'
import { useModalFocus } from '../../shared/accessibility'

type Sucursal = { id: string; nombre: string; comuna_id: number; comuna: string; direccion: string | null; telefono: string | null; whatsapp: string | null; horario: Record<string, string>; latitud: string | null; longitud: string | null; descripcion: string | null; servicios: string[]; equipo: string[] }
type Integrante = { id: string; rol: RolEquipo; permisos: ModuloPyme[]; sucursal_id: string | null; sucursal: string; nombre: string; correo: string; estado: string; creado_en: string }

const diaLabel: Record<string, string> = { 'lun-vie': 'Lun a vie', sab: 'Sábado', dom: 'Domingo' }

// ---------- Sucursales ----------
export function Branches({ pyme }: { pyme: MiPyme }) {
  const [rows, setRows] = useState<Sucursal[] | null>(null)
  const [editing, setEditing] = useState<Sucursal | 'new' | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api<Sucursal[]>(`/pymes/${pyme.id}/sucursales`).then(setRows).catch(e => setError(errorText(e))), [pyme.id])
  useEffect(() => { void load() }, [load])
  const dueno = pyme.permisos.includes('sucursales')
  const remove = async (s: Sucursal) => { if (!window.confirm(`¿Eliminar la sucursal «${s.nombre}»? Su equipo quedará asignado a la casa matriz.`)) return; try { await api(`/pymes/${pyme.id}/sucursales/${s.id}`, { method: 'DELETE' }); await load() } catch (e) { setError(errorText(e)) } }
  const max = pyme.plan.limites.sucursales
  return <section className="page role-page"><div className="page-title"><div><p className="eyebrow">MULTISUCURSAL</p><h1>{dueno ? 'Sucursales' : 'Perfil de mi local'}</h1><p className="muted">{dueno ? `Cada sucursal aparece en el mapa y en el buscador del directorio. Tu plan ${pyme.plan.nombre} ${cupoTexto(max, 'local', 'locales')} contando la casa matriz (usas ${pyme.uso.sucursales}).${pyme.plan.beneficios.perfil_sucursal ? ' Cada sucursal puede tener su propia descripción y servicios.' : ' Desde Plata, cada sucursal puede tener su propia descripción y servicios.'}` : 'Mantén al día la dirección, el horario y el contacto del local que tienes a cargo.'}</p></div>{dueno && <button className="primary" disabled={max !== null && pyme.uso.sucursales >= max} title={max !== null && pyme.uso.sucursales >= max ? 'Tu plan no permite más sucursales: mejóralo en Suscripción' : undefined} onClick={() => setEditing('new')}><CirclePlus size={17} /> Nueva sucursal</button>}</div>
    {error && !rows && <ErrorState message={error} onRetry={() => void load()} />}{error && rows && <p className="form-error" role="alert">{error}</p>}
    {!rows && !error && <LoadingState label="Cargando sucursales" />}
    <div className="branch-grid">{dueno && <article className="branch-card is-main"><p className="eyebrow">CASA MATRIZ</p><h2>{pyme.nombre_comercial}</h2><p className="muted">Se edita en «Perfil del negocio». Sus datos son los de la empresa.</p></article>}
      {rows?.map(s => <article className="branch-card" key={s.id}><p className="eyebrow">{s.comuna.toUpperCase()}</p><h2>{s.nombre}</h2><p><MapPin size={14} /> {s.direccion || 'Sin dirección'}</p><p className="muted">{Object.entries(s.horario).map(([d, h]) => `${diaLabel[d] || d}: ${h}`).join(' · ') || 'Sin horario publicado'}</p>
        {s.descripcion && <p>{s.descripcion}</p>}{!!s.servicios.length && <div className="chip-row">{s.servicios.map(x => <span key={x} className="chip chip-info">{x}</span>)}</div>}
        <small className="muted">Equipo: {s.equipo.length ? s.equipo.join(', ') : 'sin integrantes asignados'}</small>
        <div className="qr-actions"><button className="secondary" onClick={() => setEditing(s)}><Pencil size={15} /> Editar</button>{dueno && <button className="text-button danger-text" onClick={() => remove(s)}><Trash2 size={15} /> Eliminar</button>}</div></article>)}
      {rows && rows.length === 0 && !dueno && <PermissionState description="No tienes una sucursal asignada. Solicita al dueño que actualice tu equipo." />}{rows && rows.length === 0 && dueno && <EmptyState title="Solo tienes la casa matriz" description="Agrega otra sucursal cuando tu plan lo permita." action={max !== null && pyme.uso.sucursales >= max ? 'Actualizar' : 'Nueva sucursal'} onAction={() => max !== null && pyme.uso.sucursales >= max ? void load() : setEditing('new')} />}</div>
    {editing && <BranchModal pyme={pyme} branch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load() }} />}
  </section>
}

function BranchModal({ pyme, branch, onClose, onSaved }: { pyme: MiPyme; branch: Sucursal | null; onClose: () => void; onSaved: () => Promise<void> }) {
  useModalFocus(onClose, 'input')
  const [comunas, setComunas] = useState<Comuna[]>([])
  const [form, setForm] = useState({ nombre: branch?.nombre || '', comuna_id: branch?.comuna_id || pyme.comuna_id, direccion: branch?.direccion || '', telefono: branch?.telefono || '', whatsapp: branch?.whatsapp || '', lunVie: branch?.horario['lun-vie'] || '', sab: branch?.horario.sab || '', dom: branch?.horario.dom || '', latitud: branch?.latitud || '', longitud: branch?.longitud || '', descripcion: branch?.descripcion || '', servicios: (branch?.servicios || []).join(', ') })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<Comuna[]>('/comunas').then(setComunas).catch(() => undefined) }, [])
  const set = (k: keyof typeof form, v: string | number) => setForm({ ...form, [k]: v })
  const propio = pyme.plan.beneficios.perfil_sucursal
  const coord = (v: string) => v.trim() ? Number(v.replace(',', '.')) : null
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const lat = coord(form.latitud), lng = coord(form.longitud)
    if ((lat === null) !== (lng === null) || Number.isNaN(lat) || Number.isNaN(lng)) { setError('Indica latitud y longitud juntas, como números'); return }
    setBusy(true); setError('')
    const body = { nombre: form.nombre, comuna_id: Number(form.comuna_id), direccion: form.direccion, telefono: form.telefono, whatsapp: form.whatsapp, horario: { 'lun-vie': form.lunVie, sab: form.sab, dom: form.dom }, latitud: lat, longitud: lng, descripcion: propio ? form.descripcion : '', servicios: propio ? form.servicios.split(',').map(s => s.trim()).filter(Boolean) : [] }
    try { await api(`/pymes/${pyme.id}/sucursales${branch ? `/${branch.id}` : ''}`, { method: branch ? 'PUT' : 'POST', body }); await onSaved() } catch (e) { setError(errorText(e)); setBusy(false) }
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit} noValidate><button type="button" className="close" aria-label="Cerrar" onClick={onClose}><X size={20} /></button><p className="eyebrow">{branch ? 'EDITAR SUCURSAL' : 'NUEVA SUCURSAL'}</p><h2>{branch?.nombre || 'Agrega un local'}</h2>
    <div className="form-grid"><label>Nombre<input value={form.nombre} onChange={e => set('nombre', e.target.value)} placeholder={`${pyme.nombre_comercial} Centro`} /></label><label>Comuna<select value={form.comuna_id} onChange={e => set('comuna_id', Number(e.target.value))}>{comunas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label><label>Dirección<input value={form.direccion} onChange={e => set('direccion', e.target.value)} /></label><label>Teléfono<input value={form.telefono} onChange={e => set('telefono', e.target.value)} /></label><label>WhatsApp<input value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} placeholder="56912345678" /></label><label>Lunes a viernes<input value={form.lunVie} onChange={e => set('lunVie', e.target.value)} placeholder="09:00-18:00" /></label><label>Sábado<input value={form.sab} onChange={e => set('sab', e.target.value)} placeholder="Vacío si cierra" /></label><label>Domingo<input value={form.dom} onChange={e => set('dom', e.target.value)} placeholder="Vacío si cierra" /></label><label>Latitud<input value={form.latitud} onChange={e => set('latitud', e.target.value)} placeholder="-40.5735" /></label><label>Longitud<input value={form.longitud} onChange={e => set('longitud', e.target.value)} placeholder="-73.1335" /></label></div>
    {propio ? <><label className="composer-label">Descripción propia del local<textarea rows={3} maxLength={600} value={form.descripcion} onChange={e => set('descripcion', e.target.value)} /></label><label className="composer-label">Servicios de este local (separados por comas; alimentan el buscador)<input value={form.servicios} onChange={e => set('servicios', e.target.value)} placeholder="Vacunación, Peluquería clínica" /></label></>
      : <p className="form-note">Con tu plan, la sucursal muestra la descripción y los servicios de la empresa. Desde Plata puedes personalizarlos por local.</p>}
    {error && <div className="form-error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Guardando...' : 'Guardar sucursal'}</button></div></form></div>
}

// ---------- Equipo y permisos por módulo ----------
export function Team({ pyme, onChange }: { pyme: MiPyme; onChange: () => Promise<void> }) {
  const [rows, setRows] = useState<Integrante[] | null>(null)
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [editing, setEditing] = useState<Integrante | 'new' | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(() => Promise.all([api<Integrante[]>(`/pymes/${pyme.id}/equipo`), api<Sucursal[]>(`/pymes/${pyme.id}/sucursales`)]).then(([e, s]) => { setRows(e); setSucursales(s) }).catch(e => setError(errorText(e))), [pyme.id])
  useEffect(() => { void load() }, [load])
  const remove = async (m: Integrante) => { if (!window.confirm(`¿Retirar el acceso de ${m.nombre}? Su cuenta quedará desactivada.`)) return; try { await api(`/pymes/${pyme.id}/equipo/${m.id}`, { method: 'DELETE' }); await load(); await onChange() } catch (e) { setError(errorText(e)) } }
  const max = pyme.plan.limites.usuarios
  return <section className="page role-page"><div className="page-title"><div><p className="eyebrow">ROLES INTERNOS DE LA EMPRESA</p><h1>Equipo y permisos</h1><p className="muted">Crea cuentas para jefes de local{pyme.rubro === 'veterinaria' ? ' y personal clínico' : ''} y decide qué módulos usa cada uno. Cada persona recibe por correo un enlace para crear su contraseña. Tu plan {pyme.plan.nombre} {cupoTexto(max, 'cuenta de equipo', 'cuentas de equipo')} (usas {pyme.uso.usuarios}).</p></div><button className="primary" disabled={max === 0} onClick={() => { setNotice(''); setEditing('new') }}><UserPlus size={17} /> Agregar integrante</button></div>
    {max === 0 && <div className="alert-card"><div><strong>El plan Gratis no incluye cuentas de equipo</strong><p>Desde Bronce puedes sumar un jefe de local; en Plata, hasta 5 integrantes.</p></div></div>}
     {notice && <p className="save-message" role="status">{notice}</p>}{error && !rows && <ErrorState message={error} onRetry={() => void load()} />}{error && rows && <p className="form-error" role="alert">{error}</p>}{!rows && !error && <LoadingState label="Cargando equipo" />}
    <div className="admin-table-card user-table polished-user-table suite-table"><div className="user-table-head"><span>INTEGRANTE</span><span>ROL</span><span>LOCAL</span><span>ACCIÓN</span></div>
      <div className="user-row"><div className="avatar">TÚ</div><div className="user-identity"><strong>Dueño o administrador</strong><small>Todos los módulos salvo Pacientes, que es del personal clínico.</small></div><span className="user-role">Dueño</span><span className="user-role">Toda la empresa</span><span /></div>
      {rows?.map(m => <div className="user-row" key={m.id}><div className="avatar">{m.nombre.slice(0, 2).toUpperCase()}</div><div className="user-identity"><strong>{m.nombre}</strong><small>{m.correo} · desde {fechaLarga(m.creado_en)}</small><div className="chip-row">{m.permisos.map(p => <span key={p} className="chip">{moduloLabel[p]}</span>)}</div></div><span className="user-role">{m.rol === 'clinico' ? 'Clínico' : 'Jefe de local'}</span><span className="user-role">{m.sucursal}</span><div><button className="secondary" onClick={() => { setNotice(''); setEditing(m) }}>Permisos</button><button className="text-button danger-text" onClick={() => remove(m)}>Retirar</button></div></div>)}
       {rows && rows.length === 0 && <EmptyState title="Aún no hay integrantes" description="Puedes invitar a un jefe de local o personal clínico según tu plan." action={max === 0 ? 'Actualizar' : 'Agregar integrante'} onAction={() => max === 0 ? void load() : setEditing('new')} />}</div>
    {editing && <MemberModal pyme={pyme} member={editing === 'new' ? null : editing} sucursales={sucursales} onClose={() => setEditing(null)} onSaved={async msg => { setEditing(null); setNotice(msg); await load(); await onChange() }} />}
  </section>
}

function MemberModal({ pyme, member, sucursales, onClose, onSaved }: { pyme: MiPyme; member: Integrante | null; sucursales: Sucursal[]; onClose: () => void; onSaved: (msg: string) => Promise<void> }) {
  useModalFocus(onClose, member ? 'select' : 'input')
  const [form, setForm] = useState({ nombre: member?.nombre || '', correo: member?.correo || '', rol: member?.rol || 'jefe_local' as RolEquipo, sucursal_id: member?.sucursal_id ?? '' })
  const [permisos, setPermisos] = useState<ModuloPyme[]>(member?.permisos || [...ROLES_EQUIPO.jefe_local.porDefecto])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const permitidos: readonly ModuloPyme[] = ROLES_EQUIPO[form.rol].permitidos
  const setRol = (rol: RolEquipo) => { setForm({ ...form, rol }); setPermisos([...ROLES_EQUIPO[rol].porDefecto]) }
  const toggle = (m: ModuloPyme) => setPermisos(permisos.includes(m) ? permisos.filter(x => x !== m) : [...permisos, m])
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!permisos.length) { setError('Asigna al menos un módulo'); return }
    setBusy(true); setError('')
    try {
      if (member) { await api(`/pymes/${pyme.id}/equipo/${member.id}`, { method: 'PATCH', body: { permisos, sucursal_id: form.sucursal_id || null } }); await onSaved(`Permisos de ${member.nombre} actualizados.`) }
      else { await api(`/pymes/${pyme.id}/equipo`, { method: 'POST', body: { nombre_visible: form.nombre, correo: form.correo, rol: form.rol, sucursal_id: form.sucursal_id || null, permisos } }); await onSaved(`Cuenta creada. Enviamos a ${form.correo} un enlace para crear su contraseña; vence en 7 días.`) }
    } catch (e) { setError(errorText(e)); setBusy(false) }
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit} noValidate><button type="button" className="close" aria-label="Cerrar" onClick={onClose}><X size={20} /></button><p className="eyebrow">{member ? 'PERMISOS POR MÓDULO' : 'NUEVO INTEGRANTE'}</p><h2>{member?.nombre || 'Agrega a tu equipo'}</h2>
    {!member && <div className="form-grid"><label>Nombre<input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} /></label><label>Correo<input type="email" value={form.correo} onChange={e => setForm({ ...form, correo: e.target.value })} /></label><label>Rol<select value={form.rol} onChange={e => setRol(e.target.value as RolEquipo)}><option value="jefe_local">Jefe de local</option>{pyme.rubro === 'veterinaria' && <option value="clinico">Personal clínico</option>}</select></label></div>}
    <label className="composer-label">Local a cargo<select value={form.sucursal_id} onChange={e => setForm({ ...form, sucursal_id: e.target.value })}><option value="">Casa matriz</option>{sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>
    <fieldset className="module-picker"><legend>Módulos que puede usar</legend>{permitidos.map(m => <label key={m} className="check-row"><input type="checkbox" checked={permisos.includes(m)} onChange={() => toggle(m)} /> {moduloLabel[m]}</label>)}<p className="muted">Suscripción, equipo y sucursales quedan siempre reservados al dueño.</p></fieldset>
    {error && <div className="form-error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Guardando...' : member ? 'Guardar permisos' : 'Crear y enviar correo'}</button></div></form></div>
}
