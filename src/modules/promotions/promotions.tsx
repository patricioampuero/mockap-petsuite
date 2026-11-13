import { useCallback, useEffect, useState } from 'react'
import { BadgePercent, CirclePlus, Gift, Megaphone, Ticket, X } from 'lucide-react'
import { api, errorText, fechaLarga, getSession, hoy, type CuponPublico } from '../../shared/api'
import type { MiPyme } from '../business/business'
import { ONG_CUPOS, cupoTexto, type Plan } from '../plans/plans'
import { EmptyState, ErrorState, LoadingState } from '../../shared/feedback'
import { useModalFocus } from '../../shared/accessibility'

// ---------- Banners públicos ----------
type BannerPublico = { id: string; titulo: string; texto: string; tono: 'acento' | 'calido' | 'info'; destino: 'perfil' | 'adopciones' | 'convenio'; autor_tipo: 'pyme' | 'ong'; autor_id: string; autor: string }

// Cinta de publicidad aprobada por el asesor. Sin imágenes: título, texto y tono de color.
export function BannerStrip({ ubicacion, onPyme }: { ubicacion: 'inicio' | 'directorio' | 'muro'; onPyme?: (id: string) => void }) {
  const [rows, setRows] = useState<BannerPublico[]>([])
  useEffect(() => { const comuna = getSession()?.comunaId; api<BannerPublico[]>(`/banners?ubicacion=${ubicacion}${comuna ? `&comuna=${comuna}` : ''}`).then(setRows).catch(() => setRows([])) }, [ubicacion])
  if (!rows.length) return null
  const abrir = (b: BannerPublico) => {
    api(`/banners/${b.id}/clic`, { method: 'POST' }).catch(() => undefined)
    if (b.autor_tipo === 'ong') window.location.hash = b.destino === 'adopciones' ? '#adopciones' : `#ong/${b.autor_id}`
    else onPyme?.(b.autor_id)
  }
  return <section className="promo-strip" aria-label="Publicidad de negocios y organizaciones">{rows.map(b => <button key={b.id} className={`promo-card tone-${b.tono}`} onClick={() => abrir(b)}><span className="promo-tag">{b.autor_tipo === 'ong' ? 'ONG' : 'Publicidad'} · {b.autor}</span><strong>{b.titulo}</strong><span>{b.texto}</span></button>)}</section>
}

// ---------- Gestión de banners (Pyme u ONG) ----------
type MiBanner = BannerPublico & { ubicacion: string; desde: string; hasta: string; estado: 'pendiente' | 'aprobado' | 'rechazado' | 'retirado'; motivo: string | null; impresiones: number; clics: number; comuna_id: number | null }
const estadoBanner = { pendiente: 'En revisión del asesor', aprobado: 'Aprobado', rechazado: 'Rechazado', retirado: 'Retirado' }

export function AdsManager({ base, plan, autor }: { base: string; plan?: Plan; autor: 'pyme' | 'ong' }) {
  const [rows, setRows] = useState<MiBanner[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => api<MiBanner[]>(`${base}/banners`).then(setRows).catch(e => setError(errorText(e))), [base])
  useEffect(() => { void load() }, [load])
  const cupo = autor === 'ong' ? ONG_CUPOS.banners : plan?.limites.banners ?? 0
  const activos = (rows || []).filter(b => (b.estado === 'pendiente' || b.estado === 'aprobado') && b.hasta >= hoy()).length
  const retirar = async (b: MiBanner) => { try { await api(`${base}/banners/${b.id}`, { method: 'DELETE' }); await load() } catch (e) { setError(errorText(e)) } }
  return <section className="page role-page"><div className="page-title"><div><p className="eyebrow">PUBLICIDAD EN PETSUITE</p><h1>Banners</h1><p className="muted">Mensajes breves, sin imágenes, en el inicio de los tutores, el directorio o el muro. Un asesor PetSuite revisa cada banner antes de publicarlo. {autor === 'ong' ? `Las ONG tienen ${cupo} banner activo sin costo.` : `Tu plan ${plan?.nombre} ${cupoTexto(cupo, 'banner activo', 'banners activos')}.`} Usas {activos}.</p></div><button className="primary" disabled={cupo !== null && activos >= cupo} onClick={() => setCreating(true)}><CirclePlus size={17} /> Nuevo banner</button></div>
    {autor === 'pyme' && cupo === 0 && <div className="alert-card"><div className="alert-icon"><Megaphone size={22} /></div><div><strong>Tu plan no incluye banners</strong><p>Desde Plata puedes publicar un banner y en Oro hasta tres, con prioridad sobre los demás.</p></div></div>}
    {error && !rows && <ErrorState message={error} onRetry={() => void load()} />}{error && rows && <p className="form-error" role="alert">{error}</p>}
    {!rows && !error && <LoadingState label="Cargando banners" />}
    <div className="catalog-list">{rows?.map(b => <div className="catalog-item" key={b.id}><div className={`promo-card tone-${b.tono} promo-preview`}><strong>{b.titulo}</strong><span>{b.texto}</span></div><div className="catalog-item-main"><p>{b.ubicacion === 'inicio' ? 'Inicio del tutor' : b.ubicacion === 'directorio' ? 'Directorio' : 'Muro comunal'} · {fechaLarga(b.desde)} al {fechaLarga(b.hasta)}</p><small>{b.impresiones} impresiones · {b.clics} clics{b.motivo ? ` · Motivo: ${b.motivo}` : ''}</small></div>
      <div className="catalog-item-actions"><span className={`user-status ${b.estado === 'aprobado' ? 'activo' : 'suspendido'}`}>{estadoBanner[b.estado]}</span>{(b.estado === 'pendiente' || b.estado === 'aprobado') && <button className="text-button" onClick={() => retirar(b)}>Retirar</button>}</div></div>)}
      {rows && rows.length === 0 && <EmptyState title="Aún no hay banners" description="Crea un mensaje breve para enviarlo a revisión." action={cupo !== null && activos >= cupo ? 'Actualizar' : 'Nuevo banner'} onAction={() => cupo !== null && activos >= cupo ? void load() : setCreating(true)} />}</div>
    {creating && <BannerModal base={base} autor={autor} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await load() }} />}
  </section>
}

function BannerModal({ base, autor, onClose, onSaved }: { base: string; autor: 'pyme' | 'ong'; onClose: () => void; onSaved: () => Promise<void> }) {
  useModalFocus(onClose, 'input')
  const fin = new Date(); fin.setDate(fin.getDate() + 14)
  const [form, setForm] = useState({ titulo: '', texto: '', destino: autor === 'ong' ? 'adopciones' : 'perfil', ubicacion: 'inicio', tono: 'acento', desde: hoy(), hasta: fin.toISOString().slice(0, 10) })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v })
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try { await api(`${base}/banners`, { method: 'POST', body: form }); await onSaved() } catch (e) { setError(errorText(e)); setBusy(false) }
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit} noValidate><button type="button" className="close" aria-label="Cerrar" onClick={onClose}><X size={20} /></button><p className="eyebrow">NUEVO BANNER</p><h2>Crea tu mensaje</h2><p className="muted">Sin enlaces externos ni imágenes. Dura hasta 30 días y empieza a mostrarse cuando el asesor lo aprueba.</p>
    <div className={`promo-card tone-${form.tono} promo-preview`}><strong>{form.titulo || 'Título del banner'}</strong><span>{form.texto || 'Texto breve que verá la comunidad.'}</span></div>
    <label className="composer-label">Título ({form.titulo.length}/60)<input maxLength={60} value={form.titulo} onChange={e => set('titulo', e.target.value)} /></label>
    <label className="composer-label">Texto ({form.texto.length}/140)<textarea rows={2} maxLength={140} value={form.texto} onChange={e => set('texto', e.target.value)} /></label>
    <div className="form-grid"><label>Al hacer clic<select value={form.destino} onChange={e => set('destino', e.target.value)}><option value="perfil">Abrir mi perfil</option>{autor === 'ong' ? <option value="adopciones">Ver adopciones</option> : <option value="convenio">Ver mis cupones con ONG</option>}</select></label><label>Dónde<select value={form.ubicacion} onChange={e => set('ubicacion', e.target.value)}><option value="inicio">Inicio del tutor</option><option value="directorio">Directorio</option><option value="muro">Muro comunal</option></select></label><label>Color<select value={form.tono} onChange={e => set('tono', e.target.value)}><option value="acento">Principal</option><option value="calido">Cálido</option><option value="info">Informativo</option></select></label><label>Desde<input type="date" min={hoy()} value={form.desde} onChange={e => set('desde', e.target.value)} /></label><label>Hasta<input type="date" min={form.desde} value={form.hasta} onChange={e => set('hasta', e.target.value)} /></label></div>
    {error && <div className="form-error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Enviando...' : 'Enviar a revisión'}</button></div></form></div>
}

// ---------- Convenios y cupones ----------
type ConvenioVista = { id: string; titulo: string; descuento_pct: number; condiciones: string; codigo: string; desde: string; hasta: string; meta_mensual: number; premio: string; estado: 'pendiente_ong' | 'pendiente_asesor' | 'activo' | 'rechazado' | 'finalizado'; motivo: string | null; ong: string; negocio: string; canjes_mes: number; canjes_total: number; meta_cumplida: boolean; premios: { mes: string }[] }
const estadoConvenio = { pendiente_ong: 'Esperando a la ONG', pendiente_asesor: 'En revisión del asesor', activo: 'Activo', rechazado: 'Rechazado', finalizado: 'Finalizado' }

function GoalBar({ c }: { c: ConvenioVista }) {
  const pct = Math.min(100, (c.canjes_mes / c.meta_mensual) * 100)
  return <div className="goal"><div className="channel-head"><strong>{c.canjes_mes} de {c.meta_mensual} canjes este mes</strong><small>{c.meta_cumplida ? '¡Meta cumplida!' : `Faltan ${Math.max(0, c.meta_mensual - c.canjes_mes)}`}</small></div><div className="channel-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div><small className="muted"><Gift size={13} /> Premio al cumplir la meta: {c.premio}{c.premios.length ? ` · ganado ${c.premios.length} ${c.premios.length === 1 ? 'vez' : 'veces'}` : ''}</small></div>
}

function ConvenioCard({ c, actions }: { c: ConvenioVista; actions?: React.ReactNode }) {
  return <article className="agreement-card"><div className="agreement-head"><div><p className="eyebrow">{c.negocio} × {c.ong}</p><h3>{c.titulo}</h3></div><span className={`user-status ${c.estado === 'activo' ? 'activo' : 'suspendido'}`}>{estadoConvenio[c.estado]}</span></div>
    <div className="coupon-code"><Ticket size={16} aria-hidden="true" /><code>{c.codigo}</code><span>{c.descuento_pct} %</span></div>
    <p className="muted">{c.condiciones} Vigente del {fechaLarga(c.desde)} al {fechaLarga(c.hasta)}.{c.motivo ? ` Motivo: ${c.motivo}` : ''}</p>
    {(c.estado === 'activo' || c.estado === 'finalizado') && <GoalBar c={c} />}{actions}</article>
}

export function PymeAgreements({ pyme }: { pyme: MiPyme }) {
  const [rows, setRows] = useState<ConvenioVista[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(() => api<ConvenioVista[]>(`/pymes/${pyme.id}/convenios`).then(setRows).catch(e => setError(errorText(e))), [pyme.id])
  useEffect(() => { void load() }, [load])
  const canjear = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setNotice('')
    try {
      const r = await api<{ canjes_mes: number; meta: number; premio: boolean }>(`/pymes/${pyme.id}/canjes`, { method: 'POST', body: { codigo } })
      setNotice(r.premio ? `¡Canje registrado y meta cumplida! (${r.canjes_mes}/${r.meta}). Tu asesor coordinará el premio.` : `Canje registrado: ${r.canjes_mes} de ${r.meta} este mes.`)
      setCodigo(''); await load()
    } catch (e) { setError(errorText(e)) }
  }
  const finalizar = async (c: ConvenioVista) => { if (!window.confirm(`¿Finalizar el convenio ${c.codigo}? El código dejará de aceptarse.`)) return; try { await api(`/pymes/${pyme.id}/convenios/${c.id}/finalizar`, { method: 'POST' }); await load() } catch (e) { setError(errorText(e)) } }
  const cupo = pyme.plan.limites.convenios, dueno = pyme.rol_interno === 'dueno'
  return <section className="page role-page"><div className="page-title"><div><p className="eyebrow">ALIANZAS CON ONG</p><h1>Convenios y cupones</h1><p className="muted">Ofrece un descuento que la ONG difunde en su comunidad. Cada venta con el código se registra como canje: así medimos la visibilidad que te entrega la ONG. Al llegar a la meta mensual (por ejemplo, 100 ventas) ganas el premio de alimentos. Tu plan {pyme.plan.nombre} {cupoTexto(cupo, 'convenio', 'convenios')}.</p></div>{dueno && <button className="primary" disabled={cupo !== null && pyme.uso.convenios >= cupo} onClick={() => setCreating(true)}><CirclePlus size={17} /> Proponer convenio</button>}</div>
    <form className="settings-card redeem-form" onSubmit={canjear} noValidate><div><p className="eyebrow">CAJA</p><h2>Registrar un canje</h2><p className="muted">Ingresa el código que presenta el cliente.{pyme.sucursal ? ` Se registra en ${pyme.sucursal.nombre}.` : ''}</p></div><div className="redeem-row"><input aria-label="Código del cupón" value={codigo} onChange={e => setCodigo(e.target.value.toUpperCase())} placeholder="PATITAS-SUR10" /><button className="primary"><BadgePercent size={16} /> Registrar canje</button></div></form>
    {notice && <p className="save-message" role="status">{notice}</p>}{error && !rows && <ErrorState message={error} onRetry={() => void load()} />}{error && rows && <p className="form-error" role="alert">{error}</p>}
    {!rows && !error && <LoadingState label="Cargando convenios" />}
    <div className="agreement-grid">{rows?.map(c => <ConvenioCard key={c.id} c={c} actions={dueno && (c.estado === 'activo' || c.estado.startsWith('pendiente')) ? <button className="text-button" onClick={() => finalizar(c)}>Finalizar convenio</button> : null} />)}</div>
    {rows && rows.length === 0 && <EmptyState title="Aún no hay convenios" description="Propón un cupón a una ONG verificada." action={dueno && (cupo === null || pyme.uso.convenios < cupo) ? 'Proponer convenio' : 'Actualizar'} onAction={() => dueno && (cupo === null || pyme.uso.convenios < cupo) ? setCreating(true) : void load()} />}
    {creating && <AgreementModal pyme={pyme} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); setNotice('Propuesta enviada a la ONG. Cuando la acepte, un asesor la revisará.'); await load() }} />}
  </section>
}

function AgreementModal({ pyme, onClose, onSaved }: { pyme: MiPyme; onClose: () => void; onSaved: () => Promise<void> }) {
  useModalFocus(onClose, 'select')
  const [ongs, setOngs] = useState<{ id: string; nombre: string; comuna: string }[]>([])
  const fin = new Date(); fin.setMonth(fin.getMonth() + 3)
  const [form, setForm] = useState({ ong_id: '', titulo: '', descuento_pct: 10, condiciones: 'Presenta el código al pagar. No acumulable con otras ofertas.', desde: hoy(), hasta: fin.toISOString().slice(0, 10), meta_mensual: 100, premio: 'Premio de alimentos PetSuite: 2 sacos de 15 kg' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<{ id: string; nombre: string; comuna: string }[]>('/ongs').then(o => { setOngs(o); setForm(f => ({ ...f, ong_id: f.ong_id || o[0]?.id || '' })) }).catch(() => undefined) }, [])
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try { await api(`/pymes/${pyme.id}/convenios`, { method: 'POST', body: form }); await onSaved() } catch (e) { setError(errorText(e)); setBusy(false) }
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit} noValidate><button type="button" className="close" aria-label="Cerrar" onClick={onClose}><X size={20} /></button><p className="eyebrow">NUEVO CONVENIO</p><h2>Propón un cupón a una ONG</h2><p className="muted">El código se genera automáticamente. El convenio se activa cuando la ONG lo acepta y un asesor lo aprueba.</p>
    <div className="form-grid"><label>ONG aliada<select value={form.ong_id} onChange={e => setForm({ ...form, ong_id: e.target.value })}>{ongs.map(o => <option key={o.id} value={o.id}>{o.nombre} · {o.comuna}</option>)}</select></label><label>Descuento (%)<input type="number" min={5} max={50} value={form.descuento_pct} onChange={e => setForm({ ...form, descuento_pct: Number(e.target.value) })} /></label><label>Desde<input type="date" value={form.desde} onChange={e => setForm({ ...form, desde: e.target.value })} /></label><label>Hasta<input type="date" value={form.hasta} onChange={e => setForm({ ...form, hasta: e.target.value })} /></label><label>Meta de canjes al mes<input type="number" min={10} max={1000} value={form.meta_mensual} onChange={e => setForm({ ...form, meta_mensual: Number(e.target.value) })} /></label></div>
    <label className="composer-label">Beneficio<input maxLength={80} value={form.titulo} onChange={e => setForm({ ...form, titulo: e.target.value })} placeholder="Consulta general con 10 % de descuento" /></label>
    <label className="composer-label">Condiciones<textarea rows={2} maxLength={300} value={form.condiciones} onChange={e => setForm({ ...form, condiciones: e.target.value })} /></label>
    <label className="composer-label">Premio al cumplir la meta<input maxLength={120} value={form.premio} onChange={e => setForm({ ...form, premio: e.target.value })} /></label>
    {error && <div className="form-error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy || !form.ong_id}>{busy ? 'Enviando...' : 'Enviar propuesta'}</button></div></form></div>
}

export function OngAgreements() {
  const [rows, setRows] = useState<ConvenioVista[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api<ConvenioVista[]>('/ong/convenios').then(setRows).catch(e => setError(errorText(e))), [])
  useEffect(() => { void load() }, [load])
  const decidir = async (c: ConvenioVista, decision: 'aceptar' | 'rechazar') => {
    const motivo = decision === 'rechazar' ? window.prompt('¿Por qué rechazas el convenio? (opcional)') ?? undefined : undefined
    try { await api(`/ong/convenios/${c.id}`, { method: 'PATCH', body: { decision, ...(motivo && { motivo }) } }); await load() } catch (e) { setError(errorText(e)) }
  }
  const activos = (rows || []).filter(c => c.estado === 'activo')
  return <section className="page role-page"><div className="page-title"><div><p className="eyebrow">IMPACTO DE TU COMUNIDAD</p><h1>Convenios con negocios</h1><p className="muted">Los negocios aliados ofrecen descuentos a tu comunidad. Comparte los códigos activos: cada canje muestra cuánta visibilidad les entregas y suma para el premio de alimentos.</p></div></div>
    <div className="business-stats"><div className="metric-card"><small>Convenios activos</small><strong>{activos.length}</strong><span>Códigos para difundir</span></div><div className="metric-card"><small>Canjes este mes</small><strong>{activos.reduce((n, c) => n + c.canjes_mes, 0)}</strong><span>Ventas gracias a tu comunidad</span></div><div className="metric-card"><small>Canjes históricos</small><strong>{(rows || []).reduce((n, c) => n + c.canjes_total, 0)}</strong><span>Impacto acumulado</span></div></div>
    {error && !rows && <ErrorState message={error} onRetry={() => void load()} />}{error && rows && <p className="form-error" role="alert">{error}</p>}
    {!rows && !error && <LoadingState label="Cargando convenios de la ONG" />}
    <div className="agreement-grid">{rows?.map(c => <ConvenioCard key={c.id} c={c} actions={c.estado === 'pendiente_ong' ? <div className="qr-actions"><button className="primary" onClick={() => decidir(c, 'aceptar')}>Aceptar convenio</button><button className="text-button" onClick={() => decidir(c, 'rechazar')}>Rechazar</button></div> : null} />)}</div>
    {rows && rows.length === 0 && <EmptyState title="Sin propuestas de convenio" description="Los negocios aliados podrán enviarte propuestas aquí." action="Actualizar" onAction={() => void load()} />}
  </section>
}

// Cupones visibles para tutores (perfil del negocio o de la ONG).
export function CouponList({ cupones, por }: { cupones: CuponPublico[]; por: 'ong' | 'negocio' }) {
  if (!cupones.length) return null
  return <div className="coupon-list">{cupones.map(c => <div key={c.codigo} className="coupon-public"><Ticket size={18} aria-hidden="true" /><div><strong>{c.titulo}</strong><small>{por === 'ong' ? `Cupón de ${c.ong}` : `En ${c.negocio}`} · hasta el {fechaLarga(c.hasta)}</small></div><code>{c.codigo}</code></div>)}</div>
}
