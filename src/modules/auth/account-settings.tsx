// Configuración → Perfil: datos de la cuenta que sí se guardan en el servidor (nombre visible y comuna) y cambio de
// contraseña con la actual. El correo identifica la cuenta y está confirmado: para corregirlo se pide una rectificación.
import { useEffect, useState } from 'react'
import { KeyRound, UserRound } from 'lucide-react'
import { api, errorText, iniciales, type Comuna } from '../../shared/api'
import { LoadingState } from '../../shared/feedback'

type Yo = { correo: string; nombre_visible: string; comuna_id: number | null }

export function AccountSettings({ onUpdated, onLogout }: { onUpdated: (nombre: string, comunaId: number | null) => void; onLogout: () => void }) {
  const [yo, setYo] = useState<Yo | null>(null)
  const [comunas, setComunas] = useState<Comuna[]>([])
  const [form, setForm] = useState({ nombre: '', comuna: '' })
  const [estado, setEstado] = useState({ error: '', aviso: '', ocupado: false })
  const [clave, setClave] = useState({ actual: '', nueva: '', repetir: '' })
  const [estadoClave, setEstadoClave] = useState({ error: '', aviso: '', ocupado: false })

  useEffect(() => {
    api<Yo>('/auth/yo').then(y => { setYo(y); setForm({ nombre: y.nombre_visible, comuna: y.comuna_id ? String(y.comuna_id) : '' }) }).catch(e => setEstado(s => ({ ...s, error: errorText(e) })))
    api<Comuna[]>('/comunas').then(setComunas).catch(() => undefined)
  }, [])

  const guardar = async (event: React.FormEvent) => {
    event.preventDefault()
    if (form.nombre.trim().length < 2) { setEstado({ error: 'Ingresa tu nombre (al menos 2 caracteres)', aviso: '', ocupado: false }); return }
    setEstado({ error: '', aviso: '', ocupado: true })
    try {
      const y = await api<Yo>('/auth/yo', { method: 'PATCH', body: { nombre_visible: form.nombre.trim(), ...(form.comuna && { comuna_id: Number(form.comuna) }) } })
      setYo(y); onUpdated(y.nombre_visible, y.comuna_id)
      setEstado({ error: '', aviso: 'Cambios guardados', ocupado: false })
    } catch (e) { setEstado({ error: errorText(e), aviso: '', ocupado: false }) }
  }

  const cambiarClave = async (event: React.FormEvent) => {
    event.preventDefault()
    if (clave.nueva !== clave.repetir) { setEstadoClave({ error: 'La contraseña nueva y su repetición no coinciden', aviso: '', ocupado: false }); return }
    setEstadoClave({ error: '', aviso: '', ocupado: true })
    try {
      await api('/auth/cambiar-clave', { method: 'POST', body: { actual: clave.actual, nueva: clave.nueva } })
      setClave({ actual: '', nueva: '', repetir: '' })
      setEstadoClave({ error: '', aviso: 'Contraseña cambiada. Por seguridad cerramos tus sesiones: vuelve a ingresar con la nueva.', ocupado: true })
      window.setTimeout(onLogout, 2500)
    } catch (e) { setEstadoClave({ error: errorText(e), aviso: '', ocupado: false }) }
  }

  if (!yo) return estado.error ? <p className="form-error" role="alert">{estado.error}</p> : <LoadingState label="Cargando tu perfil" />
  const cambiado = form.nombre.trim() !== yo.nombre_visible || form.comuna !== (yo.comuna_id ? String(yo.comuna_id) : '')
  return <>
    <form className="settings-card" onSubmit={guardar} noValidate>
      <div className="settings-card-heading"><div><p className="eyebrow">INFORMACIÓN PERSONAL</p><h2>Perfil</h2><p className="muted">Tu nombre aparece en el muro comunal y en las consultas que envías. La comuna define lo que ves primero.</p></div><div className="profile-avatar">{iniciales(form.nombre || yo.nombre_visible) || <UserRound size={20} />}</div></div>
      <div className="settings-form-grid">
        <label>Nombre visible<input value={form.nombre} maxLength={80} onChange={e => { setForm({ ...form, nombre: e.target.value }); setEstado({ error: '', aviso: '', ocupado: false }) }} autoComplete="name" /></label>
        <label>Comuna<select value={form.comuna} onChange={e => { setForm({ ...form, comuna: e.target.value }); setEstado({ error: '', aviso: '', ocupado: false }) }}><option value="">Sin comuna</option>{comunas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
        <label>Correo electrónico<input value={yo.correo} readOnly aria-describedby="correo-ayuda" /></label>
      </div>
      <p className="muted" id="correo-ayuda">El correo identifica tu cuenta. Para corregirlo, envía una solicitud de rectificación en Privacidad y datos.</p>
      {estado.error && <p className="form-error" role="alert">{estado.error}</p>}
      <div className="settings-actions"><span className="save-message" role="status">{estado.aviso}</span><button className="primary" disabled={estado.ocupado || !cambiado}>{estado.ocupado ? 'Guardando…' : 'Guardar cambios'}</button></div>
    </form>
    <form className="settings-card" onSubmit={cambiarClave} noValidate>
      <div className="settings-card-heading"><div><p className="eyebrow">SEGURIDAD</p><h2>Cambiar contraseña</h2><p className="muted">Al cambiarla se cierran todas tus sesiones, también en otros dispositivos.</p></div><div className="profile-avatar"><KeyRound size={20} aria-hidden="true" /></div></div>
      <div className="settings-form-grid">
        <label>Contraseña actual<input type="password" value={clave.actual} onChange={e => setClave({ ...clave, actual: e.target.value })} autoComplete="current-password" /></label>
        <label>Contraseña nueva<input type="password" value={clave.nueva} onChange={e => setClave({ ...clave, nueva: e.target.value })} autoComplete="new-password" /></label>
        <label>Repite la contraseña nueva<input type="password" value={clave.repetir} onChange={e => setClave({ ...clave, repetir: e.target.value })} autoComplete="new-password" /></label>
      </div>
      {estadoClave.error && <p className="form-error" role="alert">{estadoClave.error}</p>}
      <div className="settings-actions"><span className="save-message" role="status">{estadoClave.aviso}</span><button className="primary" disabled={estadoClave.ocupado || !clave.actual || clave.nueva.length < 8}>{estadoClave.ocupado && !estadoClave.aviso ? 'Cambiando…' : 'Cambiar contraseña'}</button></div>
    </form>
  </>
}
