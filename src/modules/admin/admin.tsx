import { useCallback, useEffect, useState } from 'react'
import { BriefcaseBusiness, Check, HeartHandshake, QrCode, Search, ShieldAlert, ShieldCheck, Store, TrendingUp, Wallet } from 'lucide-react'
import { Metric } from '../../shared/metric'
import { ProfileCover } from '../../shared/profile-cover'
import { api, clp, errorText, iniciales } from '../../shared/api'
import { SuspensionReview, type AccountSummary } from './admin-suspension'
import { PymeDocumentsReview } from './admin-documents'
import { Approvals, Collections, NewAccounts, PrivacyAdmin, SentEmails } from '../advisor/advisor'
import { PlanBadge } from '../plans/plans-ui'
import { PLANES, type PlanCodigo } from '../plans/plans'
import { rolLabel as rolLargo } from '../../shared/permissions'
import { EmptyState, ErrorState, LoadingState, PermissionState } from '../../shared/feedback'

type OngPendiente = { id: string; nombre: string; tipo: string; descripcion: string | null; contacto: string | null; comuna: string; estado_verificacion: string; animales: number }
type Resumen = {
  ong_pendientes?: number; animales_disponibles?: number; usuarios: number; suspendidos: number; pymes_activas: number; pymes_pendientes: number; reportes_abiertos: number; escaneos: number; ingresos_30d: number
  por_plan: { codigo: PlanCodigo; nombre: string; pymes: number }[]; mrr: number; en_gracia: number; banners_pendientes: number; convenios_pendientes: number; perfiles_pendientes: number; privacidad_pendientes: number
}
type Usuario = AccountSummary & { correo: string; rol: string; estado: 'activo' | 'suspendido' | 'eliminado' }
type Reporte = { id: string; objeto_tipo: string; objeto_id: string; motivo: string; creado_en: string; reportante: string; contenido: string | null; autor: string | null; autor_id: string | null }
type PymePendiente = { id: string; nombre_comercial: string; rut_empresa: string; rubro: string; comuna: string; estado_verificacion: string; solicitud?: 'alta' | 'renovacion'; plan?: string | null; plan_vigente: string; canal: 'transferencia' | 'orcob' | 'mercadopago' | null; referencia: string | null; monto_clp: number; sucursales: number; equipo: number; documentos_subidos?: number; documentos_faltan?: string[] }

const rolLabel: Record<string, string> = { tutor: 'Tutor', pyme: 'Pyme', jefe_local: 'Jefe de local', clinico: 'Clínico', asesor: 'Asesor', admin: 'Administrador', ong: 'ONG' }


// El asesor comparte este espacio con el administrador, pero el servidor solo le responde lo de su rol.
export function AdminArea({ active, rol }: { active: string; rol: 'admin' | 'asesor' }) {
  if (rol === 'asesor' && ['users', 'moderation', 'privacy-admin'].includes(active)) return <section className="page admin-page"><PermissionState description="Solo la administración de la plataforma puede acceder a esta sección." /></section>
  if (active === 'users' && rol === 'admin') return <Users />
  if (active === 'moderation' && rol === 'admin') return <Moderation />
  if (active === 'privacy-admin' && rol === 'admin') return <PrivacyAdmin />
  if (active === 'subscriptions') return <Pymes />
  if (active === 'ongs') return <Ongs />
  if (active === 'approvals') return <Approvals />
  if (active === 'collections') return <Collections />
  if (active === 'accounts') return <NewAccounts />
  if (active === 'emails') return <SentEmails />
  return <Overview rol={rol} />
}

function Overview({ rol }: { rol: 'admin' | 'asesor' }) {
  const [r, setR] = useState<Resumen | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api<Resumen>('/admin/resumen').then(value => { setR(value); setError('') }).catch(e => setError(errorText(e))), [])
  useEffect(() => { void load() }, [load])
  const total = r ? Math.max(1, r.por_plan.reduce((n, p) => n + p.pymes, 0)) : 1
  const pendientes = r ? r.banners_pendientes + r.perfiles_pendientes + r.convenios_pendientes + r.pymes_pendientes + (r.ong_pendientes ?? 0) + (rol === 'admin' ? r.reportes_abiertos + r.privacidad_pendientes : 0) : null
  return <section className="page admin-page">
    <ProfileCover eyebrow={rol === 'asesor' ? 'ASESORÍA COMERCIAL' : 'CENTRO DE CONTROL'} title={rol === 'asesor' ? 'Tu cartera de Pymes y ONG' : 'Resumen de PetSuite'} avatar={rol === 'asesor' ? <BriefcaseBusiness size={34} /> : <ShieldCheck size={34} />}
      subtitle={rol === 'asesor' ? `${rolLargo.asesor}: gestionas cuentas, planes, aprobaciones y cobranza.` : 'Datos en vivo de la base de datos de la plataforma.'}
      badges={<span className="chip chip-info">{rolLargo[rol]}</span>}
      stats={r ? [{ label: 'Usuarios', value: r.usuarios }, { label: 'Pymes verificadas', value: r.pymes_activas }, { label: 'Animales en adopción', value: r.animales_disponibles ?? 0 }, { label: 'Pendientes de revisión', value: pendientes ?? 0 }] : undefined} />
    {!r && !error && <LoadingState label="Cargando resumen" />}
    {error && <ErrorState message={error} onRetry={() => void load()} />}
    {r && <><div className="admin-metrics"><Metric icon={TrendingUp} label="Ingreso mensual recurrente" value={clp(r.mrr)} trend="Suma de planes vigentes" /><Metric icon={Store} tone="info" label="Pymes verificadas" value={String(r.pymes_activas)} trend={`${r.pymes_pendientes} por verificar · ${r.en_gracia} en gracia`} /><Metric icon={Wallet} tone="success" label="Ingresos (30 días)" value={clp(r.ingresos_30d)} trend="Pagos confirmados" />{rol === 'admin' ? <Metric icon={QrCode} tone="warm" label="Escaneos de QR" value={String(r.escaneos)} trend={`${r.usuarios} usuarios · ${r.suspendidos} suspendidos`} /> : <Metric icon={HeartHandshake} tone="warm" label="ONG en verificación" value={String(r.ong_pendientes ?? 0)} trend={`${r.animales_disponibles ?? 0} animales en adopción`} />}</div>
      <div className="admin-bottom-grid"><article className="admin-table-card"><div className="chart-heading"><div><p className="eyebrow">MODELO DE NEGOCIO</p><h2>Pymes por plan</h2></div></div><div className="channel-list">{r.por_plan.map(p => <div key={p.codigo}><div className="channel-head"><PlanBadge plan={p} /><small>{p.pymes} {p.pymes === 1 ? 'Pyme' : 'Pymes'} · {clp((PLANES.find(x => x.codigo === p.codigo)?.precio_mensual_clp ?? 0) * p.pymes)}/mes</small></div><div className="channel-bar" aria-hidden="true"><span style={{ width: `${(p.pymes / total) * 100}%` }} /></div></div>)}</div></article>
        <article className="admin-table-card"><div className="chart-heading"><div><p className="eyebrow">PENDIENTES</p><h2>Requiere tu atención</h2></div></div>
          {rol === 'admin' && <div className="health-stat warning"><span className="status-dot" /><div><strong>{r.reportes_abiertos} reportes abiertos</strong><small>Meta de resolución: 24 horas</small></div></div>}
          {rol === 'admin' && <div className="health-stat warning"><span className="status-dot" /><div><strong>{r.privacidad_pendientes} solicitudes de privacidad</strong><small>Plazo legal: 30 días corridos (Ley 21.719)</small></div></div>}
          <div className="health-stat warning"><span className="status-dot" /><div><strong>{r.banners_pendientes + r.perfiles_pendientes + r.convenios_pendientes} aprobaciones</strong><small>{r.banners_pendientes} banners · {r.perfiles_pendientes} perfiles de ONG · {r.convenios_pendientes} convenios</small></div></div>
          <div className="health-stat warning"><span className="status-dot" /><div><strong>{r.pymes_pendientes} Pymes en verificación</strong><small>Revisa el negocio y su pago</small></div></div>
          <div className="health-stat warning"><span className="status-dot" /><div><strong>{r.ong_pendientes ?? 0} ONG en verificación</strong><small>{r.animales_disponibles ?? 0} animales disponibles en el catálogo</small></div></div></article></div></>}
  </section>
}

function Users() {
  const [users, setUsers] = useState<Usuario[] | null>(null)
  const [selected, setSelected] = useState<{ user: Usuario; view: 'reports' | 'suspend' } | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'Todos' | 'Activos' | 'Suspendidos'>('Todos')
  const [error, setError] = useState('')
  const load = useCallback(() => api<Usuario[]>(`/admin/usuarios${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`).then(u => { setUsers(u); setError('') }).catch(e => setError(errorText(e))), [query])
  useEffect(() => { const t = setTimeout(() => { void load() }, 250); return () => clearTimeout(t) }, [load])
  const reactivate = async (u: Usuario) => { try { await api(`/admin/usuarios/${u.id}`, { method: 'PATCH', body: { estado: 'activo' } }); await load() } catch (e) { setError(errorText(e)) } }
  const shown = (users || []).filter(u => filter === 'Todos' || (filter === 'Activos' ? u.estado === 'activo' : u.estado === 'suspendido'))
  return <section className="page admin-page"><div className="page-title"><div><p className="eyebrow">ADMINISTRACIÓN</p><h1>Gestión de usuarios</h1><p className="muted">Busca, filtra y administra las cuentas de PetSuite.</p></div><span className="admin-total">{users?.length ?? 0} cuentas</span></div>
    <div className="user-toolbar"><div className="search-field"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre o correo" /></div></div>
    <div className="user-filters">{(['Todos', 'Activos', 'Suspendidos'] as const).map(v => <button key={v} className={filter === v ? 'category-tab active' : 'category-tab'} onClick={() => setFilter(v)}>{v}</button>)}</div>
    {!users && !error && <LoadingState label="Cargando usuarios" />}
    {error && !users && <ErrorState message={error} onRetry={() => void load()} />}
    {error && users && <p className="form-error" role="alert">{error}</p>}
    <div className="admin-table-card user-table polished-user-table"><div className="user-table-head"><span>USUARIO</span><span>ROL</span><span>ESTADO</span><span>ACCIÓN</span></div>
      {shown.map(u => <div className="user-row" key={u.id}><div className="avatar">{iniciales(u.nombre_visible || u.correo)}</div><div className="user-identity"><strong>{u.nombre_visible}</strong><small>{u.correo}</small><button type="button" className="text-button user-reports-link" onClick={() => setSelected({ user: u, view: 'reports' })}>Ver denuncias</button>{u.suspension && <small>{u.suspension.tipo === 'temporal' ? `Hasta ${new Date(u.suspension.hasta!).toLocaleDateString('es-CL')}` : 'Suspensión permanente'} · {u.suspension.motivo.replaceAll('_', ' ')}</small>}</div><span className="user-role">{rolLabel[u.rol] || u.rol}</span><span className={`user-status ${u.estado}`}>{u.estado === 'activo' ? 'Activo' : 'Suspendido'}</span>{u.rol === 'admin' ? <span /> : <button className={u.estado === 'activo' ? 'secondary' : 'primary'} onClick={() => u.estado === 'activo' ? setSelected({ user: u, view: 'suspend' }) : void reactivate(u)}>{u.estado === 'activo' ? 'Suspender' : 'Reactivar'}</button>}</div>)}
      {users && shown.length === 0 && <EmptyState title="Sin usuarios para este filtro" description="Prueba otra búsqueda o cambia el estado." action="Ver todos" onAction={() => { setQuery(''); setFilter('Todos') }} />}</div>{selected && <SuspensionReview key={`${selected.user.id}-${selected.view}`} user={selected.user} initialView={selected.view} onClose={() => setSelected(null)} onConfirmed={load} />}</section>
}

// UC-20 · Cola de reportes, más antiguos primero. Ocultar o mantener; reincidencia → suspender al autor (UC-21).
function Moderation() {
  const [reports, setReports] = useState<Reporte[] | null>(null)
  const [selected, setSelected] = useState<Reporte | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(() => api<Reporte[]>('/admin/reportes').then(setReports).catch(e => setError(errorText(e))), [])
  useEffect(() => { void load() }, [load])
  const decide = async (r: Reporte, decision: 'ocultar' | 'mantener') => { try { await api(`/admin/reportes/${r.id}`, { method: 'PATCH', body: { decision } }); await load() } catch (e) { setError(errorText(e)) } }
  const shown = (reports || []).filter(r => `${r.autor} ${r.contenido} ${r.motivo}`.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es')))
  const n = reports?.length ?? 0
  return <section className="page admin-page moderation-page"><div className="page-title"><div><p className="eyebrow">MODERACIÓN DEL MURO</p><h1>Reportes de contenido</h1><p className="muted">Revisa cada reporte contra las normas de la comunidad y decide.</p></div><span className="moderation-title-count">{n} {n === 1 ? 'pendiente' : 'pendientes'}</span></div>
    <section className="moderation-panel" aria-label="Cola de reportes"><div className="moderation-panel-header"><div><p className="eyebrow">CASOS ABIERTOS</p><h2>Cola de revisión</h2><p className="muted">{n ? 'Ordenados del más antiguo al más reciente.' : 'Todos los reportes han sido revisados.'}</p></div><label className="moderation-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Buscar reporte</span><input type="search" placeholder="Buscar autor o contenido" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
      {!reports && !error && <LoadingState label="Cargando reportes" />}
      {error && !reports && <ErrorState message={error} onRetry={() => void load()} />}
      {error && reports && <p className="form-error" role="alert">{error}</p>}
      {reports && (shown.length ? <div className="moderation-list">{shown.map(r => <article className="moderation-row" key={r.id}><div className="moderation-identity"><div className="avatar moderation-avatar">{iniciales(r.autor || '??')}</div><div><h3>{r.autor || 'Autor desconocido'}</h3><p>“{r.contenido || 'Contenido no disponible'}”</p><p><small>{r.objeto_tipo === 'comentario' ? 'Comentario · ' : ''}Motivo: {r.motivo} · Reportó {r.reportante} · {new Date(r.creado_en).toLocaleString('es-CL')}</small></p></div></div><div className="moderation-actions"><button type="button" className="secondary" onClick={() => decide(r, 'mantener')}><Check size={16} /> Mantener</button><button type="button" className="secondary" onClick={() => decide(r, 'ocultar')}><ShieldAlert size={16} /> Ocultar</button><button type="button" className="primary" disabled={!r.autor_id} onClick={() => setSelected(r)}><ShieldAlert size={16} /> Ocultar y suspender</button></div></article>)}</div> : <EmptyState title={query ? 'Sin resultados' : 'Todo al día'} description={query ? 'Prueba con otra búsqueda.' : 'No hay reportes por revisar.'} action={query ? 'Quitar búsqueda' : undefined} onAction={() => setQuery('')} />)}
    </section>{selected?.autor_id && <SuspensionReview key={selected.id} user={{ id: selected.autor_id, nombre_visible: selected.autor || 'Autor desconocido' }} relatedReportId={selected.id} onClose={() => setSelected(null)} onConfirmed={load} />}</section>
}

// UC-19 · Verificación de Pymes y pago por transferencia (SP3.2).
function Pymes() {
  const [state, setState] = useState<'pendiente' | 'aprobada' | 'rechazada' | 'suspendida'>('pendiente')
  const [rows, setRows] = useState<PymePendiente[] | null>(null)
  const [error, setError] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)
  const load = useCallback(() => api<PymePendiente[]>(`/admin/pymes?estado=${state}`).then(r => { setRows(r); setError('') }).catch(e => setError(errorText(e))), [state])
  useEffect(() => { void load() }, [load])
  const decide = async (p: PymePendiente, decision: 'aprobar' | 'rechazar' | 'suspender') => { setError(''); try { await api(`/admin/pymes/${p.id}/verificacion`, { method: 'PATCH', body: { decision } }); await load() } catch (e) { setError(errorText(e)) } }
  return <section className="page admin-page"><div className="page-title"><div><p className="eyebrow">ADMINISTRACIÓN</p><h1>Pymes y suscripciones</h1><p className="muted">Revisa los documentos del negocio (patente comercial, resolución sanitaria y, si es empresa, su constitución) antes de publicarlo, y confirma los pagos por transferencia. Los pagos con Mercado Pago se confirman solos cuando Mercado Pago informa el pago.</p></div></div>
    <div className="user-filters">{(['pendiente', 'aprobada', 'rechazada', 'suspendida'] as const).map(v => <button key={v} className={state === v ? 'category-tab active' : 'category-tab'} onClick={() => setState(v)}>{v[0].toUpperCase() + v.slice(1)}s</button>)}</div>
    {!rows && !error && <LoadingState label="Cargando Pymes" />}
    {error && !rows && <ErrorState message={error} onRetry={() => void load()} />}
    {error && rows && <p className="form-error" role="alert">{error}</p>}
    <div className="admin-table-card user-table">{rows?.map(p => <div className="user-row" key={p.id}><div className="avatar">{iniciales(p.nombre_comercial)}</div><div className="user-identity"><strong>{p.nombre_comercial}</strong><small>{p.rut_empresa} · {p.rubro} · {p.comuna}</small><small>{p.solicitud === 'renovacion' ? 'Renovación o cambio de plan' : 'Alta'}{p.plan ? ` · plan ${p.plan}` : ''}: {p.monto_clp ? clp(p.monto_clp) : 'sin costo'}{p.canal ? ` · ${p.canal === 'orcob' ? 'Orcob' : p.canal === 'mercadopago' ? 'Mercado Pago' : 'transferencia'}` : ''}{p.referencia ? ` · ref. ${p.referencia}` : ''}</small><small>Rige hoy: {p.plan_vigente} · {p.sucursales} {p.sucursales === 1 ? 'local' : 'locales'} · {p.equipo} en equipo</small><small>Documentos: {p.documentos_faltan?.length ? `falta ${p.documentos_faltan.join(', ')}` : 'obligatorios completos'} · <button type="button" className="text-button inline-link" aria-expanded={abierta === p.id} onClick={() => setAbierta(abierta === p.id ? null : p.id)}>{abierta === p.id ? 'Ocultar documentos' : `Revisar documentos (${p.documentos_subidos ?? 0})`}</button></small>{abierta === p.id && <PymeDocumentsReview pymeId={p.id} onChange={load} />}</div><span className={`user-status ${p.estado_verificacion === 'aprobada' ? 'activo' : 'suspendido'}`}>{p.solicitud === 'renovacion' && state === 'pendiente' ? 'pago en revisión' : p.estado_verificacion}</span>
      {p.solicitud === 'renovacion' && state === 'pendiente' && p.canal === 'mercadopago'
        ? <div><small className="muted">Se confirma solo cuando Mercado Pago informa el pago.</small><button className="secondary" onClick={() => decide(p, 'rechazar')}>Cancelar solicitud</button></div>
        : p.solicitud === 'renovacion' && state === 'pendiente'
        ? <div><button className="primary" onClick={() => decide(p, 'aprobar')}>Confirmar pago</button><button className="secondary" onClick={() => decide(p, 'rechazar')}>Rechazar pago</button></div>
        : <div>{p.estado_verificacion !== 'aprobada' && <button className="primary" onClick={() => decide(p, 'aprobar')}>Aprobar y activar</button>}{p.estado_verificacion === 'pendiente' && <button className="secondary" onClick={() => decide(p, 'rechazar')}>Rechazar</button>}{p.estado_verificacion === 'aprobada' && <button className="secondary" onClick={() => decide(p, 'suspender')}>Suspender</button>}</div>}</div>)}
      {rows && rows.length === 0 && <EmptyState title="Sin Pymes en este estado" description="Selecciona otro estado o vuelve más tarde." action="Actualizar" onAction={() => void load()} />}</div></section>
}

// UC-28 · Verificar ONG. Hasta entonces sus animales quedan como borrador y no salen en el catálogo público.
function Ongs() {
  const [state, setState] = useState<'pendiente' | 'aprobada' | 'rechazada'>('pendiente')
  const [rows, setRows] = useState<OngPendiente[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api<OngPendiente[]>(`/admin/ong?estado=${state}`).then(setRows).catch(e => setError(errorText(e))), [state])
  useEffect(() => { void load() }, [load])
  const decide = async (o: OngPendiente, decision: 'aprobar' | 'rechazar') => { try { await api(`/admin/ong/${o.id}/verificacion`, { method: 'PATCH', body: { decision } }); await load() } catch (e) { setError(errorText(e)) } }
  return <section className="page admin-page"><div className="page-title"><div><p className="eyebrow">ADMINISTRACIÓN</p><h1>Verificación de ONG</h1><p className="muted">Revisa las organizaciones de rescate y adopción antes de publicar sus animales en el catálogo.</p></div></div>
    <div className="user-filters">{(['pendiente', 'aprobada', 'rechazada'] as const).map(v => <button key={v} className={state === v ? 'category-tab active' : 'category-tab'} onClick={() => setState(v)}>{v[0].toUpperCase() + v.slice(1)}s</button>)}</div>
    {!rows && !error && <LoadingState label="Cargando organizaciones" />}
    {error && !rows && <ErrorState message={error} onRetry={() => void load()} />}
    {error && rows && <p className="form-error" role="alert">{error}</p>}
    <div className="admin-table-card user-table">{rows?.map(o => <div className="user-row" key={o.id}><div className="avatar">{iniciales(o.nombre)}</div><div className="user-identity"><strong>{o.nombre}</strong><small>{o.tipo.replace('_', ' ')} · {o.comuna}{o.contacto ? ` · ${o.contacto}` : ''}</small><small>{o.animales} {o.animales === 1 ? 'animal cargado' : 'animales cargados'}</small></div><span className={`user-status ${o.estado_verificacion === 'aprobada' ? 'activo' : 'suspendido'}`}>{o.estado_verificacion}</span>
      <div>{o.estado_verificacion !== 'aprobada' && <button className="primary" onClick={() => decide(o, 'aprobar')}>Aprobar</button>}{o.estado_verificacion === 'pendiente' && <button className="secondary" onClick={() => decide(o, 'rechazar')}>Rechazar</button>}</div></div>)}
      {rows && rows.length === 0 && <EmptyState title="Sin organizaciones en este estado" description="Selecciona otro estado o vuelve más tarde." action="Actualizar" onAction={() => void load()} />}</div></section>
}
