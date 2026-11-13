import { useCallback, useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { api, errorText, fechaLarga, modoDemo } from '../../shared/api'
import { MailList, type Correo } from '../advisor/advisor'
import { ErrorState, LoadingState } from '../../shared/feedback'

type Consentimiento = { tipo: 'terminos' | 'privacidad' | 'comunicaciones' | 'metricas'; otorgado: boolean; version: string; fecha: string }
type Solicitud = { id: string; derecho: string; detalle: string; estado: string; respuesta: string | null; creado_en: string; vence_en: string }
type Estado = { consentimientos: Consentimiento[]; bloqueo_tratamiento: boolean; solicitudes: Solicitud[] }

const derechos = [
  ['acceso', 'Acceso', 'Saber qué datos tuyos tratamos, para qué y con quién se comparten.'],
  ['rectificacion', 'Rectificación', 'Corregir datos inexactos o incompletos.'],
  ['supresion', 'Supresión', 'Eliminar tu cuenta y tus datos, salvo lo que la ley obliga a conservar.'],
  ['oposicion', 'Oposición', 'Oponerte a usos como comunicaciones comerciales o métricas.'],
  ['portabilidad', 'Portabilidad', 'Recibir tus datos en un formato estructurado para llevarlos a otro servicio.'],
  ['bloqueo', 'Bloqueo', 'Suspender temporalmente el tratamiento mientras se resuelve otra solicitud.'],
] as const
const consentLabel = { terminos: 'Términos de uso', privacidad: 'Tratamiento de datos para prestar el servicio', comunicaciones: 'Comunicaciones comerciales y novedades', metricas: 'Uso de mi actividad en métricas agregadas para negocios' }

// Centro de privacidad del titular (Ley 21.719): consentimientos revocables, copia de datos y solicitudes con plazo.
export function PrivacyCenter() {
  const [data, setData] = useState<Estado | null>(null)
  const [derecho, setDerecho] = useState<string>('acceso')
  const [detalle, setDetalle] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(() => api<Estado>('/privacidad').then(setData).catch(e => setError(errorText(e))), [])
  useEffect(() => { void load() }, [load])
  const toggle = async (tipo: 'comunicaciones' | 'metricas', valor: boolean) => { try { setData(await api<Estado>('/privacidad/consentimientos', { method: 'PATCH', body: { [tipo]: valor } })); setNotice(valor ? 'Consentimiento otorgado.' : 'Consentimiento retirado. El cambio rige desde ahora.') } catch (e) { setError(errorText(e)) } }
  const descargar = async () => {
    try {
      const datos = await api('/privacidad/mis-datos')
      const url = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a'); a.href = url; a.download = `petsuite-mis-datos-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url)
      setNotice('Descargaste una copia de tus datos (acceso y portabilidad).')
    } catch (e) { setError(errorText(e)) }
  }
  const solicitar = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setNotice('')
    try { const s = await api<Solicitud>('/privacidad/solicitudes', { method: 'POST', body: { derecho, detalle } }); setNotice(`Solicitud registrada. Responderemos a más tardar el ${fechaLarga(s.vence_en)}.`); setDetalle(''); await load() } catch (e) { setError(errorText(e)) }
  }
   if (!data) return <div className="settings-card">{error ? <ErrorState message={error} onRetry={() => void load()} /> : <LoadingState label="Cargando privacidad" />}</div>
  const valor = (t: Consentimiento['tipo']) => data.consentimientos.find(c => c.tipo === t)
  return <>
    <div className="settings-card"><div className="settings-card-heading"><div><p className="eyebrow">LEY 21.719 · TUS DATOS PERSONALES</p><h2>Consentimientos</h2><p className="muted">Puedes retirar en cualquier momento los consentimientos opcionales. Los obligatorios son necesarios para prestar el servicio; para dejarlos, solicita la supresión de tu cuenta.</p></div></div>
      {(['terminos', 'privacidad'] as const).map(t => <div className="setting-row" key={t}><div><strong>{consentLabel[t]}</strong><p>{valor(t) ? `Aceptado el ${new Date(valor(t)!.fecha).toLocaleDateString('es-CL')} · versión ${valor(t)!.version}` : 'Pendiente: se registrará en tu próximo ingreso.'}</p></div><span className="chip chip-ok">Obligatorio</span></div>)}
      {(['comunicaciones', 'metricas'] as const).map(t => <div className="setting-row" key={t}><div><strong>{consentLabel[t]}</strong><p>{valor(t)?.otorgado ? 'Otorgado' : 'No otorgado'}{valor(t) ? ` · ${new Date(valor(t)!.fecha).toLocaleDateString('es-CL')}` : ''}</p></div><button type="button" aria-label={`Cambiar ${consentLabel[t]}`} className={valor(t)?.otorgado ? 'toggle on' : 'toggle'} onClick={() => toggle(t, !valor(t)?.otorgado)} /></div>)}
      {data.bloqueo_tratamiento && <p className="form-note">Tu cuenta tiene el tratamiento bloqueado a petición tuya.</p>}
    </div>
    <div className="settings-card"><div className="settings-card-heading"><div><p className="eyebrow">ACCESO Y PORTABILIDAD</p><h2>Copia de tus datos</h2><p className="muted">Descarga al instante un archivo JSON con tu cuenta, mascotas, publicaciones, consultas y consentimientos. No incluye tu contraseña ni datos de otras personas.</p></div></div><button type="button" className="secondary" onClick={descargar}><Download size={16} /> Descargar mis datos</button></div>
    <form className="settings-card" onSubmit={solicitar} noValidate><div className="settings-card-heading"><div><p className="eyebrow">EJERCE TUS DERECHOS</p><h2>Solicitud al responsable</h2><p className="muted">Respondemos en un máximo de 30 días corridos. Si no estás conforme, puedes reclamar ante la Agencia de Protección de Datos Personales.</p></div></div>
      <div className="rights-grid">{derechos.map(([id, label, texto]) => <label key={id} className={derecho === id ? 'right-option active' : 'right-option'}><input type="radio" name="derecho" checked={derecho === id} onChange={() => setDerecho(id)} /><span><strong>{label}</strong><small>{texto}</small></span></label>)}</div>
      <label className="composer-label">Detalle de tu solicitud<textarea rows={3} maxLength={500} value={detalle} onChange={e => setDetalle(e.target.value)} /></label>
      {error && <div className="form-error" role="alert">{error}</div>}{notice && <p className="save-message" role="status">{notice}</p>}
      <div className="settings-actions"><span /><button className="primary">Enviar solicitud</button></div>
      {!!data.solicitudes.length && <div className="catalog-list">{data.solicitudes.map(s => <div className="catalog-item" key={s.id}><div><strong>{derechos.find(d => d[0] === s.derecho)?.[1]} · folio {s.id.slice(0, 8)}</strong><p>{s.detalle}</p><small>{s.estado === 'recibida' || s.estado === 'en_proceso' ? `Respuesta a más tardar el ${fechaLarga(s.vence_en)}` : `Respuesta: ${s.respuesta}`}</small></div><span className={`user-status ${s.estado === 'respondida' ? 'activo' : 'suspendido'}`}>{s.estado.replace('_', ' ')}</span></div>)}</div>}
    </form>
  </>
}

// Bandeja simulada: muestra los correos que PetSuite «envió» a la cuenta (bienvenida, credenciales, aprobaciones).
export function MyInbox() {
  const [rows, setRows] = useState<Correo[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api<Correo[]>('/correos/mios').then(value => { setRows(value); setError('') }).catch(e => setError(errorText(e))), [])
  useEffect(() => { void load() }, [load])
  return <div className="settings-card"><div className="settings-card-heading"><div><p className="eyebrow">{modoDemo ? 'MODO DEMOSTRACIÓN' : 'TU BANDEJA'}</p><h2>{modoDemo ? 'Correos recibidos' : 'Correos que te enviamos'}</h2><p className="muted">{modoDemo ? 'Sin servidor de correo, los mensajes que PetSuite te enviaría se guardan aquí.' : 'Copia de los correos que PetSuite te envió. Los enlaces de acceso no se guardan aquí: solo llegan a tu correo.'}</p></div></div>{error && !rows && <ErrorState message={error} onRetry={() => void load()} />}{error && rows && <p className="form-error" role="alert">{error}</p>}{rows ? <MailList rows={rows} onRefresh={() => void load()} /> : !error && <LoadingState label="Cargando correos recibidos" />}</div>
}
