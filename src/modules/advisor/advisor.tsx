import { useCallback, useEffect, useState } from 'react'
import { Check, Mail, Send, ShieldCheck, X } from 'lucide-react'
import { api, clp, errorText, fechaLarga, modoDemo, type Comuna } from '../../shared/api'
import { DIAS_DERIVAR_COBRANZA, DIAS_GRACIA } from '../plans/plans'
import type { OngPerfil } from '../ong/ong-profile'
import { EmptyState, ErrorState, LoadingState } from '../../shared/feedback'

// ---------- Aprobaciones: banners, perfiles de ONG y convenios ----------
type BannerRev = { id: string; titulo: string; texto: string; tono: string; autor: string; autor_tipo: 'pyme' | 'ong'; ubicacion: string; comuna: string; desde: string; hasta: string; plan: string }
type PerfilRev = { id: string; nombre: string; verificada: boolean; borrador: OngPerfil | null; publicado: OngPerfil | null }
type ConvenioRev = { id: string; titulo: string; codigo: string; descuento_pct: number; condiciones: string; negocio: string; ong: string; desde: string; hasta: string; meta_mensual: number; premio: string }
type Cola = { banners: BannerRev[]; perfiles: PerfilRev[]; convenios: ConvenioRev[] }

export function Approvals() {
  const [cola, setCola] = useState<Cola | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(() => api<Cola>('/asesor/aprobaciones').then(value => { setCola(value); setError('') }).catch(e => setError(errorText(e))), [])
  useEffect(() => { void load() }, [load])
  const decidir = async (ruta: string, decision: 'aprobar' | 'rechazar', nombre: string) => {
    const motivo = decision === 'rechazar' ? window.prompt(`Motivo del rechazo de «${nombre}» (se envía por correo):`) : undefined
    if (decision === 'rechazar' && !motivo) return
    setError(''); setNotice('')
    try { await api(ruta, { method: 'PATCH', body: { decision, ...(motivo && { motivo }) } }); setNotice(`«${nombre}» ${decision === 'aprobar' ? 'aprobado' : 'rechazado'}. Avisamos por correo.`); await load() } catch (e) { setError(errorText(e)) }
  }
  const botones = (ruta: string, nombre: string, disabled = false) => <div className="moderation-actions"><button className="secondary" onClick={() => decidir(ruta, 'rechazar', nombre)}><X size={16} /> Rechazar</button><button className="primary" disabled={disabled} onClick={() => decidir(ruta, 'aprobar', nombre)}><Check size={16} /> Aprobar</button></div>
  const total = cola ? cola.banners.length + cola.perfiles.length + cola.convenios.length : 0
  return <section className="page admin-page"><div className="page-title"><div><p className="eyebrow">ASESORÍA PETSUITE</p><h1>Aprobaciones</h1><p className="muted">Nada se publica sin tu revisión: banners de Pymes y ONG, cambios del perfil público de ONG (incluidos datos para donar) y convenios con cupones.</p></div><span className="moderation-title-count">{total} pendientes</span></div>
    {error && !cola && <ErrorState message={error} onRetry={() => void load()} />}{error && cola && <p className="form-error" role="alert">{error}</p>}{notice && <p className="save-message" role="status">{notice}</p>}
    {!cola && !error && <LoadingState label="Cargando aprobaciones" />}
    {cola && <>
      <section className="moderation-panel"><div className="moderation-panel-header"><div><p className="eyebrow">PUBLICIDAD</p><h2>Banners ({cola.banners.length})</h2></div></div>
        <div className="moderation-list">{cola.banners.map(b => <article className="moderation-row" key={b.id}><div className="moderation-identity"><div className={`promo-card tone-${b.tono} promo-preview`}><strong>{b.titulo}</strong><span>{b.texto}</span></div><div><h3>{b.autor}</h3><p><small>{b.autor_tipo === 'pyme' ? `Pyme · plan ${b.plan}` : 'ONG · sin costo'} · {b.ubicacion} · comuna {b.comuna} · {fechaLarga(b.desde)} al {fechaLarga(b.hasta)}</small></p></div></div>{botones(`/asesor/banners/${b.id}`, b.titulo)}</article>)}</div>
        {!cola.banners.length && <EmptyState title="Sin banners por revisar" description="Los próximos banners aparecerán aquí." action="Actualizar" onAction={() => void load()} />}</section>
      <section className="moderation-panel"><div className="moderation-panel-header"><div><p className="eyebrow">CMS DE ONG</p><h2>Perfiles públicos ({cola.perfiles.length})</h2></div></div>
        <div className="moderation-list">{cola.perfiles.map(p => <article className="moderation-row" key={p.id}><div className="moderation-identity"><div><h3>{p.nombre}{!p.verificada && ' · sin verificar'}</h3><p>{p.borrador?.mision}</p>{p.borrador?.donaciones && <p><small><strong>Donaciones:</strong> {p.borrador.donaciones.banco} · {p.borrador.donaciones.tipo_cuenta} {p.borrador.donaciones.numero} · {p.borrador.donaciones.titular} · RUT {p.borrador.donaciones.rut}{p.publicado?.donaciones && p.publicado.donaciones.numero !== p.borrador.donaciones.numero ? ' · CAMBIÓ LA CUENTA: verifica con la ONG antes de aprobar' : ''}</small></p>}<p><small>Necesidades: {p.borrador?.necesidades.join(', ') || '—'}</small></p></div></div>{botones(`/asesor/ong-perfil/${p.id}`, p.nombre, !p.verificada)}</article>)}</div>
        {!cola.perfiles.length && <EmptyState title="Sin perfiles por revisar" description="Las ONG enviarán aquí sus cambios para aprobación." action="Actualizar" onAction={() => void load()} />}</section>
      <section className="moderation-panel"><div className="moderation-panel-header"><div><p className="eyebrow">ALIANZAS</p><h2>Convenios ({cola.convenios.length})</h2></div></div>
        <div className="moderation-list">{cola.convenios.map(c => <article className="moderation-row" key={c.id}><div className="moderation-identity"><div><h3>{c.negocio} × {c.ong}</h3><p>{c.titulo} · <code>{c.codigo}</code> · {c.descuento_pct} %</p><p><small>{c.condiciones} · {fechaLarga(c.desde)} al {fechaLarga(c.hasta)} · meta {c.meta_mensual} canjes/mes · premio: {c.premio}</small></p></div></div>{botones(`/asesor/convenios/${c.id}`, c.codigo)}</article>)}</div>
        {!cola.convenios.length && <EmptyState title="Sin convenios por revisar" description="Las propuestas aceptadas aparecerán aquí." action="Actualizar" onAction={() => void load()} />}</section>
    </>}
  </section>
}

// ---------- Cobranza con Orcob ----------
type Cobranza = { pyme_id: string; nombre_comercial: string; rut_empresa: string; plan: string; plan_vigente: string; fin: string; dias_mora: number; monto_clp: number; estado: 'al_dia' | 'en_gracia' | 'degradada' | 'derivada'; pago_pendiente: boolean; derivable: boolean; caso: { id: string; id_caso: string; derivado_en: string } | null }
const estadoCobro = { al_dia: 'Al día', en_gracia: 'En gracia', degradada: 'Bajó a Gratis', derivada: 'En cobranza Orcob' }

export function Collections() {
  const [rows, setRows] = useState<Cobranza[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(() => api<Cobranza[]>('/asesor/cobranza').then(value => { setRows(value); setError('') }).catch(e => setError(errorText(e))), [])
  useEffect(() => { void load() }, [load])
  const derivar = async (c: Cobranza) => {
    if (!window.confirm(`¿Derivar a Orcob la deuda de ${c.nombre_comercial} (${clp(c.monto_clp)}, ${c.dias_mora} días)? Se enviarán solo RUT, nombre, correo de contacto, monto, periodo y días de mora.`)) return
    try { const caso = await api<{ id_caso: string }>(`/asesor/cobranza/${c.pyme_id}/derivar`, { method: 'POST' }); setNotice(`Caso ${caso.id_caso} creado en Orcob. Avisamos a la Pyme por correo.`); await load() } catch (e) { setError(errorText(e)) }
  }
  const cerrar = async (c: Cobranza, estado: 'pagado' | 'cerrado') => { if (!c.caso) return; try { await api(`/asesor/cobranza/casos/${c.caso.id}`, { method: 'PATCH', body: { estado } }); await load() } catch (e) { setError(errorText(e)) } }
  return <section className="page admin-page"><div className="page-title"><div><p className="eyebrow">RECAUDACIÓN Y COBRANZA</p><h1>Cobranza (Orcob)</h1><p className="muted">Regla: tras el vencimiento hay {DIAS_GRACIA} días de gracia; luego la Pyme baja a Gratis. Con más de {DIAS_DERIVAR_COBRANZA} días de mora puedes derivar la deuda a Orcob, que actúa como encargado de tratamiento y solo recibe datos de la empresa.</p></div></div>
    {error && !rows && <ErrorState message={error} onRetry={() => void load()} />}{error && rows && <p className="form-error" role="alert">{error}</p>}{notice && <p className="save-message" role="status">{notice}</p>}
    {!rows && !error && <LoadingState label="Cargando cobranza" />}
    <div className="admin-table-card user-table polished-user-table suite-table"><div className="user-table-head"><span>PYME</span><span>MORA</span><span>ESTADO</span><span>ACCIÓN</span></div>
      {rows?.map(c => <div className="user-row" key={c.pyme_id}><div className="avatar">{c.nombre_comercial.slice(0, 2).toUpperCase()}</div><div className="user-identity"><strong>{c.nombre_comercial}</strong><small>{c.rut_empresa} · plan {c.plan} {c.dias_mora ? 'venció' : 'vence'} el {fechaLarga(c.fin)} · rige {c.plan_vigente}</small>{c.caso && <small>Caso {c.caso.id_caso} desde {fechaLarga(c.caso.derivado_en)}</small>}</div><span className="user-role">{c.dias_mora ? `${c.dias_mora} días · ${clp(c.monto_clp)}` : '—'}</span><span className={`user-status ${c.estado === 'al_dia' ? 'activo' : 'suspendido'}`}>{estadoCobro[c.estado]}{c.pago_pendiente ? ' · pago en revisión' : ''}</span>
        <div>{c.derivable && <button className="primary" onClick={() => derivar(c)}><Send size={15} /> Derivar a Orcob</button>}{c.caso && <><button className="secondary" onClick={() => cerrar(c, 'pagado')}>Marcar pagado</button><button className="text-button" onClick={() => cerrar(c, 'cerrado')}>Cerrar caso</button></>}</div></div>)}
      {rows && rows.length === 0 && <EmptyState title="Sin planes pagados" description="No hay Pymes con planes pagados en este momento." action="Actualizar" onAction={() => void load()} />}</div>
  </section>
}

// ---------- Cuentas creadas por el asesor ----------
export function NewAccounts() {
  const [comunas, setComunas] = useState<Comuna[]>([])
  const [form, setForm] = useState({ tipo: 'pyme', nombre_visible: '', correo: '', comuna_id: 1 })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<Comuna[]>('/comunas').then(setComunas).catch(() => undefined) }, [])
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try { await api('/asesor/cuentas', { method: 'POST', body: form }); setNotice(`Cuenta creada. Enviamos a ${form.correo} un enlace para crear su contraseña; vence en 7 días.`); setForm({ ...form, nombre_visible: '', correo: '' }) } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <section className="page admin-page"><div className="page-title"><div><p className="eyebrow">ASESORÍA PETSUITE</p><h1>Crear cuenta para una Pyme u ONG</h1><p className="muted">Acompaña el alta de un negocio o una organización: creas el acceso y le llega un correo con un enlace para crear su contraseña. Al ingresar registra su negocio (y elige plan) o su organización.</p></div></div>
    <form className="settings-card" onSubmit={submit} noValidate><div className="settings-form-grid"><label>Tipo de cuenta<select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}><option value="pyme">Pyme (veterinaria, tienda, peluquería)</option><option value="ong">ONG de rescate y adopción</option></select></label><label>Nombre del contacto<input value={form.nombre_visible} onChange={e => setForm({ ...form, nombre_visible: e.target.value })} /></label><label>Correo<input type="email" value={form.correo} onChange={e => setForm({ ...form, correo: e.target.value })} /></label><label>Comuna<select value={form.comuna_id} onChange={e => setForm({ ...form, comuna_id: Number(e.target.value) })}>{comunas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label></div>
      {error && <div className="form-error" role="alert">{error}</div>}{notice && <p className="save-message" role="status">{notice}</p>}
      <div className="settings-actions"><span /><button className="primary" disabled={busy}><Mail size={16} /> {busy ? 'Creando...' : 'Crear y enviar correo'}</button></div></form>
  </section>
}

// ---------- Correos ----------
export type Correo = { id: string; para: string; asunto: string; cuerpo: string; tipo: string; enviado_en: string }

export function MailList({ rows, showTo, onRefresh }: { rows: Correo[]; showTo?: boolean; onRefresh?: () => void }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!rows.length) return <EmptyState title="Sin correos" description="Los mensajes aparecerán aquí cuando se envíen." action={onRefresh ? 'Actualizar' : undefined} onAction={onRefresh} />
  return <div className="mail-list">{rows.map(c => <article key={c.id} className="mail-item"><button className="mail-head" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}><Mail size={16} aria-hidden="true" /><span><strong>{c.asunto}</strong><small>{showTo ? `Para ${c.para} · ` : ''}{new Date(c.enviado_en).toLocaleString('es-CL')} · {c.tipo.replaceAll('_', ' ')}</small></span></button>{open === c.id && <pre className="mail-body">{c.cuerpo}</pre>}</article>)}</div>
}

export function SentEmails() {
  const [rows, setRows] = useState<Correo[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api<Correo[]>('/admin/correos').then(value => { setRows(value); setError('') }).catch(e => setError(errorText(e))), [])
  useEffect(() => { void load() }, [load])
  return <section className="page admin-page"><div className="page-title"><div><p className="eyebrow">COMUNICACIONES</p><h1>Correos enviados</h1><p className="muted">Registro de los correos transaccionales: creación de cuentas, aprobaciones, convenios, cobranza y privacidad. {modoDemo ? 'En esta demo no salen a internet.' : 'Los enlaces de acceso no se guardan aquí: solo llegan a cada destinatario.'}</p></div></div>
    {error && !rows && <ErrorState message={error} onRetry={() => void load()} />}{error && rows && <p className="form-error" role="alert">{error}</p>}{rows ? <MailList rows={rows} showTo onRefresh={() => void load()} /> : !error && <LoadingState label="Cargando correos" />}</section>
}

// ---------- Privacidad: solicitudes de titulares (Ley 21.719) ----------
type SolicitudAdmin = { id: string; usuario: string; correo: string; rol: string; derecho: string; detalle: string; estado: 'recibida' | 'en_proceso' | 'respondida' | 'rechazada'; respuesta: string | null; creado_en: string; vence_en: string }
const derechoLabel: Record<string, string> = { acceso: 'Acceso', rectificacion: 'Rectificación', supresion: 'Supresión', oposicion: 'Oposición', portabilidad: 'Portabilidad', bloqueo: 'Bloqueo' }
const efecto: Record<string, string> = { supresion: 'Al responder se anonimiza la cuenta y se borran sus mascotas y medallas.', bloqueo: 'Al responder se marca la cuenta con bloqueo de tratamiento.', oposicion: 'Al responder se retiran los consentimientos de comunicaciones y métricas.' }

export function PrivacyAdmin() {
  const [rows, setRows] = useState<SolicitudAdmin[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api<SolicitudAdmin[]>('/admin/privacidad').then(value => { setRows(value); setError('') }).catch(e => setError(errorText(e))), [])
  useEffect(() => { void load() }, [load])
  const actuar = async (s: SolicitudAdmin, estado: 'en_proceso' | 'respondida' | 'rechazada') => {
    const respuesta = estado === 'en_proceso' ? undefined : window.prompt(`Respuesta al titular (${derechoLabel[s.derecho]}):${efecto[s.derecho] && estado === 'respondida' ? `\n${efecto[s.derecho]}` : ''}`)
    if (estado !== 'en_proceso' && !respuesta) return
    try { await api(`/admin/privacidad/${s.id}`, { method: 'PATCH', body: { estado, ...(respuesta && { respuesta }) } }); await load() } catch (e) { setError(errorText(e)) }
  }
  const dias = (vence: string) => Math.ceil((new Date(`${vence}T23:59:59`).getTime() - Date.now()) / 86_400_000)
  return <section className="page admin-page"><div className="page-title"><div><p className="eyebrow">LEY 21.719 · PROTECCIÓN DE DATOS</p><h1>Solicitudes de titulares</h1><p className="muted">Derechos de acceso, rectificación, supresión, oposición, portabilidad y bloqueo. Plazo de respuesta: 30 días corridos desde la recepción. Las respuestas se notifican por correo.</p></div><ShieldCheck size={34} strokeWidth={1.5} /></div>
    {error && !rows && <ErrorState message={error} onRetry={() => void load()} />}{error && rows && <p className="form-error" role="alert">{error}</p>}
    {!rows && !error && <LoadingState label="Cargando solicitudes de privacidad" />}
    <div className="admin-table-card user-table polished-user-table suite-table"><div className="user-table-head"><span>TITULAR</span><span>DERECHO</span><span>PLAZO</span><span>ACCIÓN</span></div>
      {rows?.map(s => { const abierta = s.estado === 'recibida' || s.estado === 'en_proceso', d = dias(s.vence_en)
        return <div className="user-row" key={s.id}><div className="avatar">{s.usuario.slice(0, 2).toUpperCase()}</div><div className="user-identity"><strong>{s.usuario}</strong><small>{s.correo} · {s.rol} · {new Date(s.creado_en).toLocaleDateString('es-CL')}</small><small>«{s.detalle}»</small>{s.respuesta && <small>Respuesta: {s.respuesta}</small>}</div><span className="user-role">{derechoLabel[s.derecho]}</span><span className={`user-status ${abierta && d <= 5 ? 'suspendido' : 'activo'}`}>{abierta ? (d >= 0 ? `Vence en ${d} días` : `Vencida hace ${-d} días`) : s.estado}</span>
          <div>{s.estado === 'recibida' && <button className="secondary" onClick={() => actuar(s, 'en_proceso')}>Tomar</button>}{abierta && <><button className="primary" onClick={() => actuar(s, 'respondida')}>Responder</button><button className="text-button" onClick={() => actuar(s, 'rechazada')}>Rechazar</button></>}</div></div> })}
      {rows && rows.length === 0 && <EmptyState title="Sin solicitudes pendientes" description="Las solicitudes de titulares aparecerán aquí." action="Actualizar" onAction={() => void load()} />}</div>
  </section>
}
