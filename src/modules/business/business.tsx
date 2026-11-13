import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, BadgeCheck, Crown, Eye, FileUp, MousePointerClick, Package, Pencil, ShoppingBag, Tag, Ticket, X } from 'lucide-react'
import { BusinessDocuments } from './business-documents'
import { api, clp, errorText, fechaCorta, fechaLarga, hoy, modoDemo, ofertaVigente, type Comuna, type ItemCatalogo } from '../../shared/api'
import { instruccionesTransferencia } from '../../shared/pagos'
import { BusinessProfile } from './business-profile'
import { BusinessContacts } from './business-contacts'
import { Branches, Team } from './team'
import { AdsManager, PymeAgreements } from '../promotions/promotions'
import { PlanBadge, PlanGrid, UsageMeters } from '../plans/plans-ui'
import { DIAS_GRACIA, PLANES, planPorId, type Limites, type Plan } from '../plans/plans'
import { moduloLabel, type ModuloPyme } from '../../shared/permissions'
import { registerPymeSchema } from '../../shared/validators'
import { EmptyState, ErrorState, LoadingState, PermissionState } from '../../shared/feedback'
import { useModalFocus } from '../../shared/accessibility'
import { rubroFoto } from '../../shared/media'
import { Metric } from '../../shared/metric'
import { ProfileCover } from '../../shared/profile-cover'

export type MiPyme = {
  id: string; nombre_comercial: string; rubro: string; estado_verificacion: 'pendiente' | 'aprobada' | 'rechazada' | 'suspendida'; comuna_id: number; solicitud_pendiente?: boolean
  /** Documentos de validación obligatorios que faltan o que el asesor pidió corregir. */
  documentos_faltan?: string[]
  rol_interno: 'dueno' | 'jefe_local' | 'clinico'; sucursal: { id: string; nombre: string } | null; permisos: ModuloPyme[]
  plan: Plan; en_gracia: boolean; dias_mora: number; uso: Record<keyof Limites, number>
  suscripcion: { estado: string; fin: string; plan: string; plan_id: number; precio: number; max_items: number | null } | null
}
type Totales = Record<'visita_perfil' | 'vista_item' | 'clic_contacto' | 'clic_whatsapp', number>
type Metricas = { nivel: Plan['beneficios']['metricas']; totales: Totales; anteriores: Totales; ofertas_vigentes: number; por_dia: { dia: string; eventos: number }[]; items_mas_vistos: { nombre: string; vistas: number }[]; canjes_30d: number; por_sucursal: { nombre: string; canjes: number }[] }

const estadoTexto: Record<MiPyme['estado_verificacion'], string> = { pendiente: 'En verificación', aprobada: 'Verificada', rechazada: 'Rechazada', suspendida: 'Suspendida' }
// Vista del menú → módulo que exige. Las vistas sin módulo (Inicio) las ve todo el equipo.
const vistaModulo: Record<string, ModuloPyme> = { 'business-profile': 'perfil', documents: 'perfil', branches: 'sucursales', catalog: 'catalogo', contacts: 'contactos', team: 'equipo', ads: 'publicidad', agreements: 'convenios', metrics: 'metricas', subscription: 'suscripcion' }

const rubroTexto: Record<string, string> = { veterinaria: 'Veterinaria', tienda: 'Tienda', peluqueria: 'Peluquería', otro: 'Servicio Pet-Care' }

// Diferencia contra los 30 días anteriores, en palabras.
const comparar = (actual: number, previo: number) => {
  if (!actual && !previo) return 'Sin actividad en ambos periodos'
  const d = actual - previo
  return d === 0 ? 'Igual que los 30 días anteriores' : `${d > 0 ? '+' : ''}${d} frente a los 30 días anteriores`
}

// ---------- Mercado Pago ----------
// Con MP_ACCESS_TOKEN en el API, los planes se pagan en Mercado Pago y se activan solos al confirmarse el pago.
type Medios = { transferencia: boolean; mercadopago: boolean }
const RETORNO_MP = 'petsuite-retorno-mp'
const canalTexto: Record<string, string> = { transferencia: 'transferencia', orcob: 'Orcob', mercadopago: 'Mercado Pago' }

/** Si la dirección trae ?pago=mercadopago (Mercado Pago devuelve ahí a la Pyme), lo recuerda y lo quita de la barra. */
export function marcarRetornoMercadoPago() {
  try {
    if (new URLSearchParams(window.location.search).get('pago') !== 'mercadopago') return sessionStorage.getItem(RETORNO_MP) === '1'
    sessionStorage.setItem(RETORNO_MP, '1')
    window.history.replaceState(null, '', window.location.pathname + window.location.hash)
    return true
  } catch { return false }
}
const leerRetornoMp = () => { try { return sessionStorage.getItem(RETORNO_MP) === '1' } catch { return false } }
const olvidarRetornoMp = () => { try { sessionStorage.removeItem(RETORNO_MP) } catch { /* sin almacenamiento */ } }

function useMedios() {
  const [medios, setMedios] = useState<Medios>({ transferencia: true, mercadopago: false })
  useEffect(() => { api<Medios>('/pagos/medios').then(setMedios).catch(() => undefined) }, [])
  return medios
}

function PagoMercadoPago({ monto, alta }: { monto: number; alta?: boolean }) {
  return <div className="payment-instructions"><strong>Pago con Mercado Pago</strong><ul><li>Monto: {clp(monto)} por 30 días.</li><li>Al enviar, te llevamos a Mercado Pago para pagar con tarjeta de crédito, débito o tu saldo.</li><li>{alta ? 'Tu plan comienza cuando un asesor verifica tu negocio.' : 'El plan se activa solo apenas Mercado Pago confirma el pago.'}</li></ul></div>
}

// Carga la Pyme del usuario. Si no tiene, ofrece el alta (UC-12).
export function usePyme() {
  const [pymes, setPymes] = useState<MiPyme[] | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(async () => { try { setPymes(await api<MiPyme[]>('/pymes/mias')); setError('') } catch (e) { setError(errorText(e)) } }, [])
  useEffect(() => { void reload() }, [reload])
  return { pyme: pymes?.[0] || null, loading: pymes === null, error, reload }
}

export function RegisterPyme({ onDone }: { onDone: () => void }) {
  const [comunas, setComunas] = useState<Comuna[]>([])
  const [form, setForm] = useState({ nombre_comercial: '', rut_empresa: '', rubro: 'tienda', comuna_id: 1, direccion: '', telefono: '', whatsapp: '', descripcion: '', plan_id: PLANES[0].id, canal_pago: 'transferencia', referencia_pago: '', latitud: '', longitud: '' })
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState('')
  const [busy, setBusy] = useState(false)
  const [codigo, setCodigo] = useState('')
  const medios = useMedios()
  useEffect(() => { api<Comuna[]>('/comunas').then(setComunas).catch(() => undefined) }, [])
  // Con Mercado Pago disponible, es el medio sugerido (se activa solo, sin esperar a un asesor).
  useEffect(() => { if (medios.mercadopago) setForm(f => f.canal_pago === 'transferencia' ? { ...f, canal_pago: 'mercadopago' } : f) }, [medios.mercadopago])
  const set = (key: string, value: string | number) => { setForm({ ...form, [key]: value }); if (errorField === key) { setError(''); setErrorField('') } }
  const fieldProps = (key: string) => ({ id: `register-${key}`, 'aria-invalid': errorField === key, 'aria-describedby': errorField === key ? 'register-field-error' : undefined })
  const plan = planPorId(form.plan_id)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = registerPymeSchema.safeParse({ ...form, latitud: form.latitud.trim() ? Number(form.latitud) : null, longitud: form.longitud.trim() ? Number(form.longitud) : null })
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = String(issue?.path[0] || '')
      setError(issue?.message || 'Revisa los datos del negocio'); setErrorField(field)
      requestAnimationFrame(() => document.getElementById(`register-${field}`)?.focus())
      return
    }
    const d = parsed.data
    setBusy(true); setError('')
    try {
      const r = await api<{ codigo_orcob: string | null; pago_url?: string | null }>('/pymes', { method: 'POST', body: { nombre_comercial: d.nombre_comercial, rut_empresa: d.rut_empresa, rubro: d.rubro, comuna_id: d.comuna_id, plan_id: d.plan_id, canal_pago: plan.precio_mensual_clp > 0 ? form.canal_pago : 'transferencia', ...(d.direccion && { direccion: d.direccion }), ...(d.telefono && { telefono: d.telefono }), ...(d.whatsapp && { whatsapp: d.whatsapp }), ...(d.descripcion && { descripcion: d.descripcion }), ...(d.referencia_pago && { referencia_pago: d.referencia_pago }), ...(d.latitud !== null && { latitud: d.latitud }), ...(d.longitud !== null && { longitud: d.longitud }) } })
      if (r.pago_url) { window.location.assign(r.pago_url); return }
      if (r.codigo_orcob) { setCodigo(r.codigo_orcob); setBusy(false) } else onDone()
    } catch (e) { setError(errorText(e)); setErrorField(''); setBusy(false) }
  }
  if (codigo) return <section className="page role-page"><div className="alert-card"><div className="alert-icon"><ShoppingBag size={22} /></div><div><strong>Negocio enviado a verificación. Tu código de pago Orcob es {codigo}</strong><p>Paga {clp(plan.precio_mensual_clp)} con ese código en los canales de recaudación de Orcob. Cuando Orcob confirme el pago y el asesor verifique tu negocio, se activará el plan {plan.nombre}.</p><button className="primary" onClick={onDone}>Ir a mi panel</button></div></div></section>
  return <section className="page role-page"><div className="page-title"><div><p className="eyebrow">ALTA DE NEGOCIO</p><h1>Registra tu negocio</h1><p className="muted">Veterinarias, tiendas y peluquerías se publican en el directorio cuando un asesor PetSuite verifica el negocio. Empieza gratis y sube de plan cuando quieras. Sin comisiones por venta.</p><p className="muted">Después del alta te pediremos la patente comercial, la resolución sanitaria y, si el negocio es una empresa, la constitución de la sociedad.</p></div></div>
    <div className="settings-card"><div className="settings-card-heading"><div><p className="eyebrow">PASO 1</p><h2>Elige tu plan</h2><p className="muted">Plan elegido: <strong>{plan.nombre}</strong>{plan.precio_mensual_clp ? ` · ${clp(plan.precio_mensual_clp)} al mes` : ' · sin costo'}.</p></div></div><PlanGrid actual={form.plan_id} onChoose={p => set('plan_id', p.id)} chooseLabel="Quiero" /></div>
    <form className="settings-card" onSubmit={submit} noValidate><div className="settings-card-heading"><div><p className="eyebrow">PASO 2</p><h2>Datos del negocio</h2></div></div><div className="settings-form-grid">
      <label>Nombre comercial<input {...fieldProps('nombre_comercial')} value={form.nombre_comercial} onChange={e => set('nombre_comercial', e.target.value)} /></label>
      <label>RUT de la empresa<input {...fieldProps('rut_empresa')} value={form.rut_empresa} onChange={e => set('rut_empresa', e.target.value)} placeholder="76123456-7" /></label>
      <label>Rubro<select {...fieldProps('rubro')} value={form.rubro} onChange={e => set('rubro', e.target.value)}><option value="veterinaria">Veterinaria</option><option value="tienda">Tienda</option><option value="peluqueria">Peluquería</option><option value="otro">Otro servicio Pet-Care</option></select></label>
      <label>Comuna<select {...fieldProps('comuna_id')} value={form.comuna_id} onChange={e => set('comuna_id', Number(e.target.value))}>{comunas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
      <label>Dirección<input {...fieldProps('direccion')} value={form.direccion} onChange={e => set('direccion', e.target.value)} /></label>
      <label>Teléfono<input {...fieldProps('telefono')} value={form.telefono} onChange={e => set('telefono', e.target.value)} /></label>
      <label>WhatsApp<input {...fieldProps('whatsapp')} value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} placeholder="56912345678" /></label>
      <label>Latitud (mapa, opcional)<input {...fieldProps('latitud')} value={form.latitud} onChange={e => set('latitud', e.target.value)} placeholder="-40.5735" /></label>
      <label>Longitud (mapa, opcional)<input {...fieldProps('longitud')} value={form.longitud} onChange={e => set('longitud', e.target.value)} placeholder="-73.1335" /></label>
      {plan.precio_mensual_clp > 0 && <>{(modoDemo || medios.mercadopago) && <label>Forma de pago<select value={form.canal_pago} onChange={e => set('canal_pago', e.target.value)}>{medios.mercadopago && <option value="mercadopago">Mercado Pago: tarjeta o saldo (se confirma solo)</option>}<option value="transferencia">Transferencia (la verifica un asesor)</option>{modoDemo && <option value="orcob">Código de recaudación Orcob (demo)</option>}</select></label>}
        {form.canal_pago === 'transferencia' && <label>Referencia de la transferencia (opcional)<input {...fieldProps('referencia_pago')} value={form.referencia_pago} onChange={e => set('referencia_pago', e.target.value)} placeholder="Si ya transferiste: N.º o glosa" /></label>}</>}
    </div>
      {plan.precio_mensual_clp > 0 && form.canal_pago === 'transferencia' && <PagoTransferencia monto={plan.precio_mensual_clp} negocio={form.nombre_comercial.trim() || 'tu negocio'} />}
      {plan.precio_mensual_clp > 0 && form.canal_pago === 'mercadopago' && <PagoMercadoPago monto={plan.precio_mensual_clp} alta />}
      <label className="composer-label">Descripción<textarea {...fieldProps('descripcion')} rows={3} maxLength={1000} value={form.descripcion} onChange={e => set('descripcion', e.target.value)} /></label>
      {error && <div className="form-error" id={errorField ? 'register-field-error' : undefined} role={errorField ? undefined : 'alert'}>{error}</div>}<div className="settings-actions"><span className="muted">Plan {plan.nombre}{plan.precio_mensual_clp ? ` · ${clp(plan.precio_mensual_clp)}/mes` : ''}</span><button className="primary" disabled={busy}>{busy ? 'Enviando...' : plan.precio_mensual_clp > 0 && form.canal_pago === 'mercadopago' ? 'Enviar e ir a pagar' : 'Enviar para verificación'}</button></div></form></section>
}

/** Cómo pagar un plan por transferencia: datos de la cuenta de PetSuite o, si aún no están, el aviso de que llegarán por correo. */
function PagoTransferencia({ monto, negocio }: { monto: number; negocio: string }) {
  return <div className="payment-instructions"><strong>Cómo pagar</strong><ul>{instruccionesTransferencia(monto, negocio).map(l => <li key={l}>{l}</li>)}</ul><p className="muted">Te enviamos esto también por correo. El plan se activa cuando un asesor confirma el pago.</p></div>
}

function StatusBanner({ pyme, onDocuments }: { pyme: MiPyme; onDocuments?: () => void }) {
  if (pyme.estado_verificacion === 'aprobada') return null
  const faltan = pyme.estado_verificacion === 'pendiente' ? pyme.documentos_faltan ?? [] : []
  if (faltan.length) return <div className="alert-card warn"><div className="alert-icon"><FileUp size={22} /></div><div><strong>Sube tus documentos para publicar tu negocio</strong><p>Falta: {faltan.join(', ')}. Un asesor los revisa antes de aprobar el alta; mientras tanto puedes preparar tu catálogo.</p>{onDocuments && pyme.permisos.includes('perfil') && <button type="button" className="primary" onClick={onDocuments}>Subir documentos</button>}</div></div>
  return <div className="alert-card"><div className="alert-icon"><ShoppingBag size={22} /></div><div><strong>Tu negocio está: {estadoTexto[pyme.estado_verificacion]}</strong><p>{pyme.estado_verificacion === 'pendiente' ? 'Revisaremos tus datos, tus documentos y tu pago. Mientras tanto puedes preparar tu catálogo; se publicará al aprobarse.' : 'Contacta al equipo PetSuite para revisar tu solicitud.'}</p></div></div>
}

// Aviso de gracia o de baja a Gratis: el negocio sigue visible, pero sus beneficios dependen de renovar.
function PlanAlert({ pyme }: { pyme: MiPyme }) {
  if (pyme.en_gracia) return <div className="alert-card warn"><div className="alert-icon"><AlertCircle size={22} /></div><div><strong>Tu plan venció hace {pyme.dias_mora} {pyme.dias_mora === 1 ? 'día' : 'días'}: estás en el periodo de gracia</strong><p>Conservas los beneficios de {pyme.plan.nombre} hasta {DIAS_GRACIA} días después del vencimiento. Renueva en Suscripción para no bajar a Gratis.</p></div></div>
  if (pyme.dias_mora > 0 && pyme.plan.codigo === 'gratis') return <div className="alert-card warn"><div className="alert-icon"><AlertCircle size={22} /></div><div><strong>Tu plan pagado venció hace {pyme.dias_mora} días y tu negocio pasó a Gratis</strong><p>No se borró nada: lo que excede el plan Gratis dejó de publicarse. Renueva para recuperarlo.{pyme.dias_mora > 30 ? ' Con más de 30 días de mora, la deuda puede derivarse a cobranza con Orcob.' : ''}</p></div></div>
  return null
}

export function BusinessArea({ active, setActive }: { active: string; setActive?: (vista: string) => void }) {
  const { pyme, loading, error, reload } = usePyme()
  if (loading) return <section className="page">{error ? <ErrorState message={error} onRetry={() => void reload()} /> : <LoadingState label="Cargando negocio" />}</section>
  if (!pyme) return <RegisterPyme onDone={reload} />
  // Sin el módulo de la vista, el integrante ve el Inicio (el menú ya oculta lo que no tiene).
  const modulo = vistaModulo[active]
  if (modulo && !pyme.permisos.includes(modulo)) return <section className="page role-page"><PermissionState description="Tu rol en la Pyme no tiene acceso a este módulo. Pide permisos al dueño del negocio." /></section>
  if (active === 'business-profile') return pyme.sucursal ? <Branches pyme={pyme} /> : <BusinessProfile pyme={pyme} onSaved={reload} />
  if (active === 'documents') return <BusinessDocuments pyme={pyme} onChange={reload} />
  if (active === 'branches') return <Branches pyme={pyme} />
  if (active === 'catalog') return <Catalog pyme={pyme} />
  if (active === 'contacts') return <BusinessContacts pyme={pyme} />
  if (active === 'team') return <Team pyme={pyme} onChange={reload} />
  if (active === 'ads') return <AdsManager base={`/pymes/${pyme.id}`} plan={pyme.plan} autor="pyme" />
  if (active === 'agreements') return <PymeAgreements pyme={pyme} />
  if (active === 'metrics') return <MetricsView pyme={pyme} />
  if (active === 'subscription') return <Subscription pyme={pyme} onChange={reload} />
  return <Overview pyme={pyme} onDocuments={setActive ? () => setActive('documents') : undefined} />
}

function Overview({ pyme, onDocuments }: { pyme: MiPyme; onDocuments?: () => void }) {
  const [m, setM] = useState<Metricas | null>(null)
  const veMetricas = pyme.permisos.includes('metricas')
  useEffect(() => { if (veMetricas) api<Metricas>(`/pymes/${pyme.id}/metricas`).then(setM).catch(() => setM(null)) }, [pyme.id, veMetricas])
  const t = m?.totales, a = m?.anteriores
  const dueno = pyme.rol_interno === 'dueno'
  const siguiente = PLANES.find(p => p.precio_mensual_clp > pyme.plan.precio_mensual_clp)
  const verificada = pyme.estado_verificacion === 'aprobada'
  return <section className="page business-page">
    <ProfileCover eyebrow={dueno ? 'TU NEGOCIO EN PETSUITE' : `${pyme.rol_interno === 'jefe_local' ? 'JEFE DE LOCAL' : 'EQUIPO'} · ${pyme.sucursal?.nombre.toUpperCase() ?? 'CASA MATRIZ'}`} title={pyme.nombre_comercial}
      subtitle={dueno ? 'Tu vitrina en el directorio: plan, sucursales, equipo, catálogo, publicidad y convenios con ONG.' : `Puedes usar: ${pyme.permisos.map(p => moduloLabel[p]).join(', ')}.`}
      image={rubroFoto[pyme.rubro] || rubroFoto.otro}
      badges={<><PlanBadge plan={pyme.plan} /><span className={verificada ? 'chip chip-ok' : 'chip chip-warn'}>{verificada && <BadgeCheck size={13} />} {estadoTexto[pyme.estado_verificacion]}</span><span className="chip">{rubroTexto[pyme.rubro] || pyme.rubro}</span></>}
      stats={[{ label: 'Ítems en catálogo', value: pyme.uso.items }, { label: pyme.uso.sucursales === 1 ? 'Local' : 'Locales', value: pyme.uso.sucursales }, { label: 'Cuentas de equipo', value: pyme.uso.usuarios }, { label: 'Ofertas vigentes', value: pyme.uso.ofertas }]} />
    <StatusBanner pyme={pyme} onDocuments={onDocuments} />
    <PlanAlert pyme={pyme} />
    {veMetricas && <div className="business-stats"><Metric icon={Eye} label="Visitas al perfil" value={String(t?.visita_perfil ?? 0)} trend={t && a ? comparar(t.visita_perfil, a.visita_perfil) : 'Últimos 30 días'} /><Metric icon={Package} tone="info" label="Vistas de productos" value={String(t?.vista_item ?? 0)} trend={t && a ? comparar(t.vista_item, a.vista_item) : 'Últimos 30 días'} /><Metric icon={MousePointerClick} tone="warm" label="Clics de contacto" value={String((t?.clic_contacto ?? 0) + (t?.clic_whatsapp ?? 0))} trend={t && a ? comparar(t.clic_contacto + t.clic_whatsapp, a.clic_contacto + a.clic_whatsapp) : 'Últimos 30 días'} /></div>}
    <div className="business-activity plan-overview"><div className="plan-overview-head"><div><p className="eyebrow">TU PLAN</p><h2><PlanBadge plan={pyme.plan} /> {pyme.plan.precio_mensual_clp ? `${clp(pyme.plan.precio_mensual_clp)} al mes` : 'Sin costo'}</h2><p>{pyme.suscripcion && pyme.dias_mora === 0 ? `Vigente hasta el ${fechaLarga(pyme.suscripcion.fin)}. Tarifa plana, sin comisiones por venta.` : pyme.plan.codigo === 'gratis' ? 'Apareces en el directorio con lo esencial. Sube de plan para sumar sucursales, equipo, ofertas, publicidad y convenios.' : ''}{pyme.solicitud_pendiente ? ' Tienes un pago en revisión.' : ''}</p></div>{dueno && siguiente && <div className="plan-upsell"><Crown size={18} aria-hidden="true" /><span>Con <strong>{siguiente.nombre}</strong> ({clp(siguiente.precio_mensual_clp)}/mes) tendrías {siguiente.limites.items} ítems, {siguiente.limites.sucursales} {siguiente.limites.sucursales === 1 ? 'sucursal' : 'sucursales'} y {siguiente.limites.usuarios} cuentas de equipo.</span></div>}</div>
      <UsageMeters plan={pyme.plan} uso={pyme.uso} />
      {m && m.ofertas_vigentes > 0 && <p><span className="chip chip-warn"><Tag size={13} /> {m.ofertas_vigentes} {m.ofertas_vigentes === 1 ? 'oferta vigente' : 'ofertas vigentes'}</span></p>}</div></section>
}

// ---------- Catálogo ----------
const estadoOferta = (item: ItemCatalogo) => {
  const o = item.oferta
  if (!o) return null
  if (ofertaVigente(o)) return <span className="chip chip-warn"><Tag size={13} /> Oferta {clp(o.precio_clp)} hasta el {fechaCorta(o.hasta)}</span>
  if (o.desde > hoy()) return <span className="chip chip-info">Oferta programada desde el {fechaCorta(o.desde)}</span>
  return <span className="chip">Oferta terminada</span>
}

function Catalog({ pyme }: { pyme: MiPyme }) {
  const [items, setItems] = useState<ItemCatalogo[] | null>(null)
  const [draft, setDraft] = useState({ tipo: 'producto' as 'producto' | 'servicio', nombre: '', categoria: '', precio: '' })
  const [categoria, setCategoria] = useState('Todas')
  const [editing, setEditing] = useState<ItemCatalogo | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api<ItemCatalogo[]>(`/pymes/${pyme.id}/catalogo`).then(setItems).catch(e => setError(errorText(e))), [pyme.id])
  useEffect(() => { void load() }, [load])
  const categorias = [...new Set((items || []).map(i => i.categoria).filter((c): c is string => !!c))].sort()
  const add = async (event: React.FormEvent) => {
    event.preventDefault(); setError('')
    if (draft.nombre.trim().length < 2) { setError('Ingresa el nombre del ítem'); return }
    const precio = draft.precio.trim() ? Number(draft.precio.replace(/\D/g, '')) : undefined
    try { await api(`/pymes/${pyme.id}/catalogo`, { method: 'POST', body: { tipo: draft.tipo, nombre: draft.nombre.trim(), ...(draft.categoria.trim() && { categoria: draft.categoria.trim() }), ...(precio !== undefined && { precio_referencial_clp: precio }) } }); setDraft({ ...draft, nombre: '', precio: '' }); await load() } catch (e) { setError(errorText(e)) }
  }
  // PUT conserva los campos omitidos: basta con enviar lo que cambia.
  const update = async (item: ItemCatalogo, changes: Partial<ItemCatalogo>) => { try { await api(`/pymes/${pyme.id}/catalogo/${item.id}`, { method: 'PUT', body: { tipo: item.tipo, nombre: item.nombre, ...changes } }); await load() } catch (e) { setError(errorText(e)) } }
  const remove = async (item: ItemCatalogo) => { if (!window.confirm(`¿Eliminar «${item.nombre}» del catálogo?`)) return; try { await api(`/pymes/${pyme.id}/catalogo/${item.id}`, { method: 'DELETE' }); await load() } catch (e) { setError(errorText(e)) } }
  const shown = (items || []).filter(i => categoria === 'Todas' || (categoria === 'Sin categoría' ? !i.categoria : i.categoria === categoria))
  return <section className="page role-page"><div className="page-title"><div><p className="eyebrow">GESTIÓN B2B</p><h1>Catálogo</h1><p className="muted">Productos y servicios con precio referencial, visibles en tu perfil del directorio.{` Tu plan ${pyme.plan.nombre} publica hasta ${pyme.plan.limites.items ?? 'ilimitados'} ítems y ${pyme.plan.limites.ofertas === null ? 'ofertas sin límite' : pyme.plan.limites.ofertas === 0 ? 'no incluye ofertas' : `${pyme.plan.limites.ofertas} ofertas vigentes`} (usas ${items?.length ?? 0} ítems).`}</p></div></div>
    <StatusBanner pyme={pyme} />
    <form className="catalog-form" onSubmit={add} noValidate><select aria-label="Tipo" value={draft.tipo} onChange={e => setDraft({ ...draft, tipo: e.target.value as 'producto' | 'servicio' })}><option value="producto">Producto</option><option value="servicio">Servicio</option></select><input aria-label="Nombre" value={draft.nombre} onChange={e => setDraft({ ...draft, nombre: e.target.value })} placeholder="Nombre del producto o servicio" /><input aria-label="Categoría" list="catalog-categories" value={draft.categoria} onChange={e => setDraft({ ...draft, categoria: e.target.value })} placeholder="Categoría (ej. Alimentos)" /><input aria-label="Precio referencial" inputMode="numeric" value={draft.precio} onChange={e => setDraft({ ...draft, precio: e.target.value })} placeholder="Precio referencial" /><button className="primary">Agregar</button></form>
    <datalist id="catalog-categories">{categorias.map(c => <option key={c} value={c} />)}</datalist>
    {error && !items && <ErrorState message={error} onRetry={() => void load()} />}
    {error && items && <p className="form-error" role="alert">{error}</p>}
    {categorias.length > 0 && <div className="category-tabs">{['Todas', ...categorias, ...((items || []).some(i => !i.categoria) ? ['Sin categoría'] : [])].map(c => <button key={c} className={categoria === c ? 'category-tab active' : 'category-tab'} onClick={() => setCategoria(c)}>{c}</button>)}</div>}
    {!items && !error && <LoadingState label="Cargando catálogo" />}
    <div className="catalog-list">{shown.map(item => <div className="catalog-item" key={item.id}><div className="catalog-item-main"><strong>{item.nombre}</strong><p>{item.tipo === 'servicio' ? 'Servicio' : 'Producto'}{item.categoria ? ` · ${item.categoria}` : ''}{item.descripcion ? ` · ${item.descripcion}` : ''}</p><b>{clp(item.precio_referencial_clp)}</b><div className="chip-row">{!item.disponible && <span className="chip">Oculto</span>}{item.sin_stock && <span className="chip chip-alert">Sin stock</span>}{estadoOferta(item)}</div></div>
      <div className="catalog-item-actions"><button className={item.disponible ? 'toggle on' : 'toggle'} aria-label={`Mostrar u ocultar ${item.nombre}`} title={item.disponible ? 'Visible en el directorio' : 'Oculto'} onClick={() => update(item, { disponible: !item.disponible })} /><button className="secondary" onClick={() => setEditing(item)}><Pencil size={15} /> Editar</button><button className="text-button" onClick={() => remove(item)}>Eliminar</button></div></div>)}
      {items && shown.length === 0 && <EmptyState title={items.length ? 'Sin ítems en esta categoría' : 'Tu catálogo está vacío'} description={items.length ? 'Prueba otra categoría.' : 'Agrega tu primer producto o servicio para mostrarlo en el directorio.'} action={items.length ? 'Ver todos' : 'Agregar un ítem'} onAction={() => { if (items.length) setCategoria('Todas'); else document.querySelector<HTMLInputElement>('.catalog-form input[aria-label="Nombre"]')?.focus() }} />}</div>
    {editing && <ItemModal item={editing} categorias={categorias} onClose={() => setEditing(null)} onSave={async changes => { await api(`/pymes/${pyme.id}/catalogo/${editing.id}`, { method: 'PUT', body: changes }); setEditing(null); await load() }} />}
  </section>
}

function ItemModal({ item, categorias, onClose, onSave }: { item: ItemCatalogo; categorias: string[]; onClose: () => void; onSave: (changes: Record<string, unknown>) => Promise<void> }) {
  useModalFocus(onClose, 'input')
  const [form, setForm] = useState({
    tipo: item.tipo, nombre: item.nombre, descripcion: item.descripcion || '', categoria: item.categoria || '', precio: item.precio_referencial_clp != null ? String(item.precio_referencial_clp) : '',
    sin_stock: !!item.sin_stock, en_oferta: !!item.oferta, oferta_precio: item.oferta ? String(item.oferta.precio_clp) : '', desde: item.oferta?.desde || hoy(), hasta: item.oferta?.hasta || '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const num = (v: string) => v.trim() ? Number(v.replace(/\D/g, '')) : null
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (form.nombre.trim().length < 2) { setError('El nombre debe tener al menos 2 caracteres'); return }
    const precio = num(form.precio), ofertaPrecio = num(form.oferta_precio)
    if (form.en_oferta && (ofertaPrecio == null || !form.hasta)) { setError('Completa el precio y la fecha de término de la oferta'); return }
    setBusy(true); setError('')
    try {
      await onSave({ tipo: form.tipo, nombre: form.nombre.trim(), descripcion: form.descripcion.trim() || null, categoria: form.categoria.trim() || null, precio_referencial_clp: precio, sin_stock: form.sin_stock, oferta: form.en_oferta ? { precio_clp: ofertaPrecio, desde: form.desde, hasta: form.hasta } : null })
    } catch (e) { setError(errorText(e)); setBusy(false) }
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit} noValidate><button type="button" className="close" aria-label="Cerrar" onClick={onClose}><X size={20} /></button><p className="eyebrow">CATÁLOGO</p><h2>Editar ítem</h2><p className="muted">Los precios son referenciales: la compra se coordina directamente con tu negocio.</p>
    <div className="form-grid"><label>Tipo<select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value as 'producto' | 'servicio' })}><option value="producto">Producto</option><option value="servicio">Servicio</option></select></label><label>Nombre<input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} /></label><label>Categoría<input list="item-categories" value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} /></label><label>Precio referencial<input inputMode="numeric" value={form.precio} onChange={e => setForm({ ...form, precio: e.target.value })} /></label></div>
    <datalist id="item-categories">{categorias.map(c => <option key={c} value={c} />)}</datalist>
    <label className="composer-label">Descripción<textarea rows={3} maxLength={1000} value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} /></label>
    <label className="check-row"><input type="checkbox" checked={form.sin_stock} onChange={e => setForm({ ...form, sin_stock: e.target.checked })} /> Sin stock por ahora (se muestra en el directorio, marcado)</label>
    <label className="check-row"><input type="checkbox" checked={form.en_oferta} onChange={e => setForm({ ...form, en_oferta: e.target.checked })} /> Publicar como oferta destacada</label>
    {form.en_oferta && <div className="form-grid"><label>Precio de oferta<input inputMode="numeric" value={form.oferta_precio} onChange={e => setForm({ ...form, oferta_precio: e.target.value })} /></label><label>Desde<input type="date" value={form.desde} onChange={e => setForm({ ...form, desde: e.target.value })} /></label><label>Hasta<input type="date" min={form.desde} value={form.hasta} onChange={e => setForm({ ...form, hasta: e.target.value })} /></label></div>}
    {error && <div className="form-error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Guardando...' : 'Guardar cambios'}</button></div></form></div>
}

// ---------- Métricas ----------
function MetricsView({ pyme }: { pyme: MiPyme }) {
  const [m, setM] = useState<Metricas | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api<Metricas>(`/pymes/${pyme.id}/metricas`).then(setM).catch(e => setError(errorText(e))), [pyme.id])
  useEffect(() => { void load() }, [load])
  if (!m) return <section className="page role-page">{error ? <ErrorState message={error} onRetry={() => void load()} /> : <LoadingState label="Cargando métricas" />}</section>
  const t = m.totales, a = m.anteriores, max = Math.max(1, ...m.por_dia.map(d => d.eventos))
  const contactos = t.clic_contacto + t.clic_whatsapp
  const canales = [['Llamadas', t.clic_contacto, a.clic_contacto], ['WhatsApp', t.clic_whatsapp, a.clic_whatsapp]] as const
  const mejora = (desde: string) => <div className="role-panel locked-panel"><p className="eyebrow">DISPONIBLE DESDE {desde.toUpperCase()}</p><p className="muted">Mejora tu plan en Suscripción para ver este detalle.</p></div>
  return <section className="page role-page"><div className="page-title"><div><p className="eyebrow">GESTIÓN B2B · MÉTRICAS {m.nivel.toUpperCase()}</p><h1>Panel de métricas</h1><p className="muted">Cómo te encuentra la comunidad. Últimos 30 días comparados con los 30 anteriores.</p></div><PlanBadge plan={pyme.plan} /></div>
    <div className="metric-grid"><Metric icon={Eye} label="Visitas al perfil" value={String(t.visita_perfil)} trend={comparar(t.visita_perfil, a.visita_perfil)} /><Metric icon={Package} tone="info" label="Vistas de ítems" value={String(t.vista_item)} trend={comparar(t.vista_item, a.vista_item)} /><Metric icon={MousePointerClick} tone="warm" label="Clics de contacto" value={String(contactos)} trend={comparar(contactos, a.clic_contacto + a.clic_whatsapp)} /><Metric icon={Ticket} tone="success" label="Cupones canjeados" value={String(m.canjes_30d)} trend="Ventas atribuidas a ONG aliadas" /></div>
    <article className="admin-chart-card"><div className="chart-heading"><div><p className="eyebrow">ACTIVIDAD</p><h2>Eventos por día</h2></div></div>{m.por_dia.length ? <div className="bar-chart" aria-label="Eventos por día">{m.por_dia.map(d => <div className="bar-column" key={d.dia}><span style={{ height: `${Math.max(6, (d.eventos / max) * 100)}%` }} /><small>{new Date(d.dia).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}</small></div>)}</div> : <p className="muted">Aún no hay actividad registrada.</p>}</article>
    <div className="metrics-split">
      {m.nivel === 'basicas' ? mejora('Plata') : <div className="role-panel"><p className="eyebrow">CONTACTO POR CANAL</p><h2>Cómo te escriben</h2><div className="channel-list">{canales.map(([label, n, prev]) => <div key={label}><div className="channel-head"><strong>{label}</strong><small>{n} · {comparar(n, prev)}</small></div><div className="channel-bar" aria-hidden="true"><span style={{ width: `${contactos ? (n / contactos) * 100 : 0}%` }} /></div></div>)}</div>{!contactos && <p className="muted">Publica tu teléfono y WhatsApp en el perfil para recibir contactos.</p>}</div>}
      {m.nivel === 'basicas' ? mejora('Plata') : <div className="role-panel"><p className="eyebrow">MÁS VISTOS</p><h2>Ítems con más interés</h2><div className="role-list">{m.items_mas_vistos.length ? m.items_mas_vistos.map(i => <div key={i.nombre}><span className="list-dot" /><strong>{i.nombre}</strong><small>{i.vistas} {i.vistas === 1 ? 'vista' : 'vistas'}</small></div>) : <div><span className="list-dot soft" /><strong>Sin vistas de ítems todavía</strong></div>}</div>{m.ofertas_vigentes > 0 && <p className="muted">Tienes {m.ofertas_vigentes} {m.ofertas_vigentes === 1 ? 'oferta vigente' : 'ofertas vigentes'} destacadas en el directorio.</p>}</div>}
      {m.nivel === 'avanzadas' ? <div className="role-panel"><p className="eyebrow">POR SUCURSAL</p><h2>Canjes de cupones</h2><div className="role-list">{m.por_sucursal.map(s => <div key={s.nombre}><span className="list-dot" /><strong>{s.nombre}</strong><small>{s.canjes} {s.canjes === 1 ? 'canje' : 'canjes'}</small></div>)}</div></div> : mejora('Oro')}
    </div></section>
}

// ---------- Suscripción ----------
type Pago = { id: string; monto_clp: number; estado: string; canal: 'transferencia' | 'orcob' | 'mercadopago'; referencia: string | null; codigo_orcob: string | null }
type Periodo = { id: string; estado: string; inicio: string; fin: string; plan: string; plan_codigo: Plan['codigo']; precio_mensual_clp: number; pagos: Pago[] }
const periodoTexto: Record<string, string> = { activa: 'Activa', pendiente: 'En revisión', vencida: 'Vencida', cancelada: 'Cancelada' }

function Subscription({ pyme, onChange }: { pyme: MiPyme; onChange: () => Promise<void> }) {
  const [rows, setRows] = useState<Periodo[] | null>(null)
  const [elegido, setElegido] = useState<Plan | null>(null)
  const [form, setForm] = useState({ canal: 'transferencia' as 'transferencia' | 'orcob' | 'mercadopago', referencia: '' })
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [yendo, setYendo] = useState(false)
  const medios = useMedios()
  const [retorno] = useState(leerRetornoMp)
  const revisado = useRef(false)
  useEffect(() => { if (medios.mercadopago) setForm(f => f.canal === 'transferencia' ? { ...f, canal: 'mercadopago' } : f) }, [medios.mercadopago])
  const load = useCallback(() => api<Periodo[]>(`/pymes/${pyme.id}/suscripcion`).then(setRows).catch(() => setRows([])), [pyme.id])
  useEffect(() => { void load() }, [load])
  const pendiente = rows?.flatMap(r => r.estado === 'pendiente' ? r.pagos.filter(p => p.estado === 'pendiente') : [])[0]
  // Un pago con Mercado Pago sin completar no bloquea: elegir otro plan o medio lo reemplaza.
  const bloquea = !!pendiente && pendiente.canal !== 'mercadopago'
  const reload = async () => { await load(); await onChange() }
  const verificarMp = useCallback(async (pago: Pago, silencioso = false) => {
    setError('')
    try {
      const r = await api<{ estado: string; inicio: string; fin: string }>(`/pymes/${pyme.id}/pagos/${pago.id}/mercadopago/verificar`, { method: 'POST' })
      if (r.estado === 'confirmado') setDone(pyme.estado_verificacion === 'aprobada' ? `Mercado Pago confirmó tu pago: tu plan rige del ${fechaLarga(r.inicio)} al ${fechaLarga(r.fin)}.` : 'Mercado Pago confirmó tu pago. Tu plan comenzará cuando un asesor verifique tu negocio.')
      else if (!silencioso) setDone('Mercado Pago todavía no informa el pago. Si pagaste hace poco, espera unos minutos y vuelve a revisar.')
      await reload()
    } catch (e) { setError(errorText(e)) }
  }, [pyme.id, pyme.estado_verificacion]) // reload cambia en cada render; basta con la Pyme
  // Al volver de Mercado Pago se revisa el pago una vez, por si el aviso de Mercado Pago aún no llega.
  useEffect(() => {
    if (!retorno || !rows || revisado.current) return
    revisado.current = true
    olvidarRetornoMp()
    // Los periodos vienen del más reciente al más antiguo: el primer pago con Mercado Pago es el último que se pidió.
    const ultimoMp = rows.flatMap(r => r.pagos).find(p => p.canal === 'mercadopago')
    if (ultimoMp?.estado === 'pendiente') void verificarMp(ultimoMp, true)
    else if (ultimoMp?.estado === 'confirmado') setDone('Mercado Pago confirmó tu pago.')
  }, [retorno, rows, verificarMp])
  const reabrirMp = async (pago: Pago) => {
    setError(''); setYendo(true)
    try { window.location.assign((await api<{ url: string }>(`/pymes/${pyme.id}/pagos/${pago.id}/mercadopago`, { method: 'POST' })).url) } catch (e) { setError(errorText(e)); setYendo(false) }
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setDone('')
    if (!elegido) return
    try {
      setYendo(form.canal === 'mercadopago')
      const r = await api<{ inicio: string; fin: string; codigo_orcob: string | null; pago_url?: string | null; aviso?: string }>(`/pymes/${pyme.id}/suscripcion`, { method: 'POST', body: { plan_id: elegido.id, canal: form.canal, ...(form.canal === 'transferencia' && form.referencia.trim() && { referencia_pago: form.referencia.trim() }) } })
      if (r.pago_url) { window.location.assign(r.pago_url); return }
      setYendo(false)
      setDone(r.aviso ?? (r.codigo_orcob ? `Paga ${clp(elegido.precio_mensual_clp)} con el código Orcob ${r.codigo_orcob}. El plan ${elegido.nombre} se activa apenas Orcob confirme el pago (del ${fechaLarga(r.inicio)} al ${fechaLarga(r.fin)}).` : `Solicitud enviada. Te enviamos por correo cómo pagar. Cuando un asesor confirme la transferencia, el plan ${elegido.nombre} irá del ${fechaLarga(r.inicio)} al ${fechaLarga(r.fin)}.`))
      setForm({ ...form, referencia: '' }); setElegido(null); await reload()
    } catch (e) { setError(errorText(e)); setYendo(false) }
  }
  const simularOrcob = async (pago: Pago) => { setError(''); try { await api(`/pymes/${pyme.id}/pagos/${pago.id}/orcob-confirmado`, { method: 'POST' }); setDone('Orcob confirmó el pago: tu plan quedó activo.'); await reload() } catch (e) { setError(errorText(e)) } }
  return <section className="page role-page"><div className="page-title"><div><p className="eyebrow">MODELO DE SUSCRIPCIÓN</p><h1>Suscripción</h1><p className="muted">Tarifa plana mensual en cuatro capas, sin comisiones por venta. {medios.mercadopago ? 'Paga con Mercado Pago y tu plan se activa al instante, o por transferencia, que confirma un asesor.' : 'Paga por transferencia: un asesor la confirma y activa tu plan.'}{modoDemo && ' En la demo también puedes probar el código de recaudación de Orcob.'}</p></div><PlanBadge plan={pyme.plan} /></div>
    <StatusBanner pyme={pyme} />
    <PlanAlert pyme={pyme} />
    {error && <div className="form-error" role="alert">{error}</div>}{done && <p className="save-message" role="status">{done}</p>}
    {pendiente?.canal === 'mercadopago' && <div className="alert-card warn"><div className="alert-icon"><AlertCircle size={22} /></div><div><strong>Pago pendiente en Mercado Pago · {clp(pendiente.monto_clp)}</strong><p>Si ya pagaste, revisa el estado. Si cerraste la ventana, vuelve a abrir el pago. También puedes elegir otro plan o pagar por transferencia: esta solicitud sin pagar se reemplaza.</p><div className="settings-actions"><button type="button" className="secondary" onClick={() => verificarMp(pendiente)}>Ya pagué: revisar</button><button type="button" className="primary" disabled={yendo} onClick={() => reabrirMp(pendiente)}>{yendo ? 'Abriendo Mercado Pago…' : 'Pagar con Mercado Pago'}</button></div></div></div>}
    {pendiente && pendiente.canal !== 'mercadopago' && <div className="alert-card"><div className="alert-icon"><AlertCircle size={22} /></div><div><strong>Pago en revisión · {clp(pendiente.monto_clp)} por {canalTexto[pendiente.canal]}</strong><p>{pendiente.canal === 'orcob' ? `Código de pago Orcob: ${pendiente.codigo_orcob}. En producción, Orcob avisa el pago a PetSuite y el plan se activa automáticamente.` : 'Un asesor PetSuite confirmará la transferencia. Podrás enviar otra solicitud cuando la confirme o la rechace.'}</p>{pendiente.canal === 'transferencia' && <PagoTransferencia monto={pendiente.monto_clp} negocio={pyme.nombre_comercial} />}{pendiente.canal === 'orcob' && modoDemo && <button className="secondary" onClick={() => simularOrcob(pendiente)}>Simular aviso de pago de Orcob (demo)</button>}</div></div>}
    <div className="settings-card"><div className="settings-card-heading"><div><p className="eyebrow">COMPARA LAS CUATRO CAPAS</p><h2>Gratis, Bronce, Plata y Oro</h2><p className="muted">Al renovar o subir de plan, el nuevo periodo empieza cuando termina el que ya pagaste. Si no renuevas, tienes {DIAS_GRACIA} días de gracia y luego pasas a Gratis sin perder datos.</p></div></div>
      <PlanGrid actual={pyme.plan.id} onChoose={pyme.estado_verificacion === 'aprobada' && !bloquea ? p => { setElegido(p); setDone(''); setError('') } : undefined} chooseLabel="Cambiar a" />
      {pyme.estado_verificacion === 'aprobada' && !bloquea && pyme.plan.precio_mensual_clp > 0 && <div className="settings-actions"><span className="muted">¿Quieres mantener tu plan?</span><button className="secondary" onClick={() => setElegido(pyme.plan)}>Renovar {pyme.plan.nombre}</button></div>}</div>
    {elegido && (elegido.precio_mensual_clp === 0 ? <div className="alert-card"><div><strong>El plan Gratis no requiere pago</strong><p>Se aplica automáticamente cuando termina tu periodo pagado y sus días de gracia. Solo deja de renovar.</p><button className="secondary" onClick={() => setElegido(null)}>Entendido</button></div></div>
      : <form className="settings-card" onSubmit={submit} noValidate><div className="settings-card-heading"><div><p className="eyebrow">{elegido.id === pyme.plan.id ? 'RENOVAR' : 'CAMBIAR DE PLAN'}</p><h2>Plan {elegido.nombre} · {clp(elegido.precio_mensual_clp)} al mes</h2></div></div>
        <div className="settings-form-grid">{(modoDemo || medios.mercadopago) && <label>Forma de pago<select value={form.canal} onChange={e => setForm({ ...form, canal: e.target.value as 'transferencia' | 'orcob' | 'mercadopago' })}>{medios.mercadopago && <option value="mercadopago">Mercado Pago: tarjeta o saldo (se activa al pagar)</option>}<option value="transferencia">Transferencia bancaria</option>{modoDemo && <option value="orcob">Código de recaudación Orcob (demo)</option>}</select></label>}{form.canal === 'transferencia' && <label>Referencia de la transferencia (opcional)<input value={form.referencia} onChange={e => setForm({ ...form, referencia: e.target.value })} placeholder="Si ya transferiste: N.º o glosa" /></label>}</div>
        {form.canal === 'transferencia' && <PagoTransferencia monto={elegido.precio_mensual_clp} negocio={pyme.nombre_comercial} />}
        {form.canal === 'mercadopago' && <PagoMercadoPago monto={elegido.precio_mensual_clp} />}
        <div className="settings-actions"><button type="button" className="text-button" onClick={() => setElegido(null)}>Cancelar</button><button className="primary" disabled={yendo}>{form.canal === 'orcob' ? 'Generar código de pago' : form.canal === 'mercadopago' ? (yendo ? 'Abriendo Mercado Pago…' : 'Ir a pagar') : 'Enviar solicitud'}</button></div></form>)}
    <div className="section-heading"><h3>Historial de periodos y pagos</h3></div>
    <div className="catalog-list">{rows?.map(s => <div className="catalog-item" key={s.id}><div><strong><PlanBadge plan={{ codigo: s.plan_codigo, nombre: s.plan }} /> {clp(s.precio_mensual_clp)} al mes</strong><p>{fechaLarga(s.inicio)} al {fechaLarga(s.fin)}</p>{s.pagos.map(p => <small key={p.id}>Pago {clp(p.monto_clp)} · {p.canal === 'orcob' ? `Orcob${p.codigo_orcob ? ` (código ${p.codigo_orcob})` : ''}` : canalTexto[p.canal]} · {p.estado}{p.referencia && p.canal !== 'mercadopago' ? ` · ${p.referencia}` : p.referencia?.startsWith('MP-') ? ` · operación ${p.referencia.slice(3)}` : ''}</small>)}</div><span className={`user-status ${s.estado === 'activa' ? 'activo' : 'suspendido'}`}>{periodoTexto[s.estado] || s.estado}</span></div>)}{rows && rows.length === 0 && <div className="empty-results">Aún no has contratado un plan pagado: estás en Gratis.</div>}</div></section>
}
