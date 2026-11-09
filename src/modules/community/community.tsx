import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { Bookmark, BookmarkCheck, CalendarDays, Check, CirclePlus, Heart, MapPin, MessageCircle, PawPrint, Pencil, Printer, Search, ThumbsUp, Trash2, TriangleAlert, Users, X } from 'lucide-react'
import { api, errorText, fechaCorta, getSession, hoy, iniciales, type Comuna, type Mascota } from '../../shared/api'
import { Photo } from '../../shared/media'
import { moderationMessageSchema } from '../../shared/validators'
import { BannerStrip } from '../promotions/promotions'
import { EmptyState, ErrorState, LoadingState } from '../../shared/feedback'
import { useModalFocus } from '../../shared/accessibility'
import { ShareButton } from '../../shared/share'

export type Tipo = 'extravio' | 'encuentro' | 'recomendacion' | 'alerta' | 'evento' | 'adopcion'
type Comentario = { id: string; autor: string; texto: string; es_mio: boolean; editado: boolean }
type Post = {
  id: string; tipo: Tipo; texto: string; creado_en: string; editado: boolean; autor: string; es_mio: boolean; comuna_id: number
  sector: string | null; foto_url: string | null; fecha_evento: string | null; resuelto: boolean; urgente: boolean; mascota: string | null; mascota_id: string | null
  animal: { id: string; nombre: string; ong: string } | null
  reacciones: number; reaccione: boolean; guardado: boolean; comentarios: Comentario[]
}
type LostPosterPet = Pick<Mascota, 'id' | 'nombre' | 'foto_url' | 'token_activo'>
type Reportable = { tipo: 'publicacion' | 'comentario'; id: string; autor: string }
type Filtro = 'Todos' | Tipo | 'Guardadas'

const tipoLabel: Record<Tipo, string> = { extravio: 'Extravío', encuentro: 'Encuentro', recomendacion: 'Recomendación', alerta: 'Alerta de salud', evento: 'Evento o campaña', adopcion: 'Adopción' }
const tipoClass: Record<Tipo, string> = { extravio: 'lost', encuentro: 'found', recomendacion: 'recommendation', alerta: 'alert', evento: 'event', adopcion: 'adoption' }
const tiposTutor: Tipo[] = ['recomendacion', 'extravio', 'encuentro', 'alerta', 'evento']
const ayuda: Partial<Record<Tipo, string>> = {
  extravio: 'Indica un sector o una referencia, nunca tu dirección exacta. Si eliges tu mascota, se agrega su foto.',
  encuentro: 'Describe al animal y dónde lo viste. No publiques datos de contacto: los vecinos te escriben por comentarios.',
  alerta: 'Describe el riesgo (cebos, animales agresivos, brotes) y el sector para que otros tutores tomen precauciones.',
  evento: 'Operativos de vacunación, esterilización o ferias de adopción. Indica la fecha y el lugar.',
}

const ago = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'Ahora'
  if (min < 60) return `Hace ${min} min`
  if (min < 1440) return `Hace ${Math.round(min / 60)} h`
  return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })
}

// RF-07 / RF-08 · Muro segmentado por comuna, con reacciones, comentarios, reportes y publicaciones guardadas.
// initialType abre el editor con ese tipo, por ejemplo desde el atajo «Reportar extravío» del Inicio.
export function CommunityView({ onAdoption, onPyme, initialType }: { onAdoption?: () => void; onPyme?: (id: string) => void; initialType?: Tipo | null }) {
  const session = getSession()
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [comunas, setComunas] = useState<Comuna[]>([])
  const [comuna, setComuna] = useState<number>(session?.comunaId || 1)
  const [filter, setFilter] = useState<Filtro>('Todos')
  const [query, setQuery] = useState('')
  const [orden, setOrden] = useState<'recientes' | 'apoyadas'>('recientes')
  const [composer, setComposer] = useState<Post | 'new' | null>(initialType ? 'new' : null)
  const [newType, setNewType] = useState<Tipo>(initialType ?? 'recomendacion')
  const [reporting, setReporting] = useState<Reportable | null>(null)
  const [poster, setPoster] = useState<{ post: Post; petId?: string } | null>(null)
  const [commenting, setCommenting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const guardadas = filter === 'Guardadas'
  const load = useCallback(async () => {
    try { setPosts(await api<Post[]>(guardadas ? '/muro?guardadas=1' : `/muro?comuna=${comuna}`)); setError('') } catch (e) { setError(errorText(e)) }
  }, [comuna, guardadas])
  useEffect(() => { void load() }, [load])
  useEffect(() => { api<Comuna[]>('/comunas').then(setComunas).catch(() => undefined) }, [])

  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await load() } catch (e) { setError(errorText(e)) } }
  const q = query.trim().toLocaleLowerCase('es')
  // Lo urgente (extravíos activos y alertas recientes) va primero al ordenar por fecha.
  const visible = (posts || [])
    .filter(p => (filter === 'Todos' || guardadas || p.tipo === filter) && (!q || `${p.texto} ${p.autor} ${p.sector || ''} ${p.mascota || ''} ${p.animal?.nombre || ''}`.toLocaleLowerCase('es').includes(q)))
    .sort((a, b) => orden === 'apoyadas' ? b.reacciones - a.reacciones || b.creado_en.localeCompare(a.creado_en) : Number(b.urgente) - Number(a.urgente) || b.creado_en.localeCompare(a.creado_en))
  const own = comuna === session?.comunaId
  const comunaName = comunas.find(c => c.id === comuna)?.nombre || ''
  const remove = (p: Post) => { if (window.confirm('¿Eliminar esta publicación? No se puede deshacer.')) void act(() => api(`/muro/${p.id}`, { method: 'DELETE' })) }
  const openComposer = (tipo: Tipo = 'recomendacion') => { setNewType(tipo); setComposer('new') }
  // La columna lateral resume lo que ya se cargó del muro: no consulta datos adicionales.
  const all = posts || []
  const alertas = all.filter(p => p.urgente && !p.resuelto).slice(0, 4)
  const eventos = all.filter(p => p.tipo === 'evento' && !!p.fecha_evento && p.fecha_evento >= hoy()).sort((a, b) => (a.fecha_evento || '').localeCompare(b.fecha_evento || '')).slice(0, 3)
  const focusPost = (id: string) => { setFilter('Todos'); setQuery(''); window.setTimeout(() => document.getElementById(`post-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60) }

  return <section className="page community-page"><div className="page-title"><div><p className="eyebrow">COMUNIDAD PETSUITE · {guardadas ? 'GUARDADAS' : comunaName.toUpperCase()}</p><h1>Muro comunal</h1><p className="muted">Comparte, encuentra y ayuda a otros tutores de tu comuna.</p></div><button className="primary" onClick={() => openComposer()}><CirclePlus size={17} /> Publicar</button></div>
    <p className="sr-only" role="status" aria-live="polite">{notice}</p>{notice && <p className="save-message">{notice}</p>}
    <BannerStrip ubicacion="muro" onPyme={onPyme} />
    <div className="feed-layout"><div className="feed-main">
    <div className="feed-composer">
      <div className="feed-composer-row"><div className="post-avatar">{iniciales(session?.nombre || 'Tú')}</div><button type="button" className="feed-composer-input" onClick={() => openComposer()}>¿Qué está pasando con tu mascota{session?.nombre ? `, ${session.nombre.split(' ')[0]}` : ''}?</button></div>
      <div className="feed-composer-types">{([['extravio', PawPrint], ['alerta', TriangleAlert], ['evento', CalendarDays], ['recomendacion', ThumbsUp]] as const).map(([tipo, Icon]) => <button key={tipo} type="button" className={`feed-type ${tipoClass[tipo]}`} onClick={() => openComposer(tipo)}><Icon size={16} aria-hidden="true" /> {tipoLabel[tipo]}</button>)}</div>
    </div>
    <div className="list-toolbar feed-toolbar"><label className="search-field"><Search size={17} aria-hidden="true" /><span className="sr-only">Buscar en el muro</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Busca por texto, sector, autor o mascota" /></label>{comunas.length > 0 && <select aria-label="Ver muro de otra comuna" value={comuna} disabled={guardadas} onChange={e => setComuna(Number(e.target.value))}>{comunas.map(c => <option key={c.id} value={c.id}>{c.nombre}{c.id === session?.comunaId ? ' (tu comuna)' : ''}</option>)}</select>}<select aria-label="Ordenar publicaciones" value={orden} onChange={e => setOrden(e.target.value as 'recientes' | 'apoyadas')}><option value="recientes">Más recientes (urgentes primero)</option><option value="apoyadas">Más apoyadas</option></select></div>
    <div className="community-filters">{(['Todos', 'extravio', 'encuentro', 'alerta', 'evento', 'adopcion', 'recomendacion', 'Guardadas'] as const).map(v => <button key={v} className={filter === v ? 'category-tab active' : 'category-tab'} onClick={() => setFilter(v)}>{v === 'Todos' || v === 'Guardadas' ? v : tipoLabel[v]}</button>)}</div>
    {error && !posts && <ErrorState message={error} onRetry={() => void load()} />}
    {error && posts && <p className="form-error" role="alert">{error}</p>}
    <div className="community-feed">{!posts && !error && <LoadingState label="Cargando publicaciones" />}
      {visible.map(post => <PostCard key={post.id} post={post} onGeneratePoster={setPoster} showComment={commenting === post.id} comunaAjena={guardadas && post.comuna_id !== session?.comunaId ? comunas.find(c => c.id === post.comuna_id)?.nombre : undefined}
        onReact={() => act(() => api(`/muro/${post.id}/reacciones`, { method: 'POST' }))}
        onSave={() => act(() => api(`/muro/${post.id}/guardar`, { method: 'POST' }))}
        onComment={() => setCommenting(commenting === post.id ? null : post.id)}
        onReport={target => setReporting(target)}
        onEdit={() => setComposer(post)} onDelete={() => remove(post)}
        onResolve={() => act(() => api(`/muro/${post.id}/resuelto`, { method: 'PATCH', body: { resuelto: !post.resuelto } }))}
        onAdoption={onAdoption}
        onAddComment={text => act(() => api(`/muro/${post.id}/comentarios`, { method: 'POST', body: { texto: text } }))}
        onEditComment={(c, text) => act(() => api(`/muro/comentarios/${c.id}`, { method: 'PATCH', body: { texto: text } }))}
        onDeleteComment={c => { if (window.confirm('¿Eliminar tu comentario?')) void act(() => api(`/muro/comentarios/${c.id}`, { method: 'DELETE' })) }} />)}
      {posts && visible.length === 0 && <EmptyState title={guardadas ? 'Sin publicaciones guardadas' : 'Sin publicaciones'} description={guardadas ? 'Guarda publicaciones del muro para volver a ellas después.' : q ? 'Ninguna publicación coincide con tu búsqueda.' : `Todavía no hay publicaciones de este tipo en ${comunaName || 'esta comuna'}.`} action={guardadas || q || filter !== 'Todos' ? 'Ver todas' : 'Publicar en el muro'} onAction={() => { if (guardadas || q || filter !== 'Todos') { setFilter('Todos'); setQuery('') } else openComposer() }} />}</div>
    </div>
    <aside className="feed-rail" aria-label="Resumen del muro">
      <section className="rail-card rail-intro"><div className="intro-icon"><Users size={20} /></div><div><strong>Una comunidad que se cuida</strong><p>Las publicaciones aparecen solo en el muro de la comuna de su autor. No se permiten enlaces externos.</p></div></section>
      <section className="rail-card"><h3><TriangleAlert size={17} aria-hidden="true" /> Alertas activas</h3>{alertas.length ? <ul className="rail-list">{alertas.map(p => <li key={p.id}><button type="button" onClick={() => focusPost(p.id)}><span className={`rail-dot ${tipoClass[p.tipo]}`} aria-hidden="true" /><span><strong>{tipoLabel[p.tipo]}{p.mascota ? ` · ${p.mascota}` : ''}</strong><small>{p.texto}</small><em>{p.sector ? `${p.sector} · ` : ''}{ago(p.creado_en)}</em></span></button></li>)}</ul> : <p className="muted">{posts ? 'No hay alertas activas en este muro.' : 'Cargando…'}</p>}</section>
      <section className="rail-card"><h3><CalendarDays size={17} aria-hidden="true" /> Próximos eventos</h3>{eventos.length ? <ul className="rail-list">{eventos.map(p => { const d = new Date(`${p.fecha_evento}T12:00:00`); return <li key={p.id}><button type="button" onClick={() => focusPost(p.id)}><span className="rail-date" aria-hidden="true"><b>{d.getDate()}</b><small>{d.toLocaleDateString('es-CL', { month: 'short' }).replace('.', '')}</small></span><span><strong>{p.texto}</strong><em>{p.sector || p.autor} · {fechaCorta(p.fecha_evento || '')}</em></span></button></li> })}</ul> : <p className="muted">{posts ? 'No hay eventos próximos en este muro.' : 'Cargando…'}</p>}</section>
      <section className="rail-card"><h3><Heart size={17} aria-hidden="true" /> Tu actividad en este muro</h3><dl className="rail-stats"><div><dt>Publicaciones</dt><dd>{all.filter(p => p.es_mio).length}</dd></div><div><dt>Guardadas</dt><dd>{all.filter(p => p.guardado).length}</dd></div><div><dt>Apoyos</dt><dd>{all.filter(p => p.reaccione).length}</dd></div></dl></section>
    </aside></div>
    {composer && <Composer post={composer === 'new' ? null : composer} initialType={newType} onClose={() => setComposer(null)} onSaved={async () => { const nuevo = composer === 'new'; setComposer(null); setNotice(nuevo ? 'Publicación creada en el muro comunal.' : 'Publicación actualizada.'); if (nuevo && guardadas) setFilter('Todos'); if (nuevo && !own && session?.comunaId) setComuna(session.comunaId); else await load() }} />}
    {reporting && <ReportModal target={reporting} onClose={() => setReporting(null)} onSaved={() => setReporting(null)} />}
    {poster && <LostPosterModal post={poster.post} petId={poster.petId} onClose={() => setPoster(null)} />}
  </section>
}

type CardProps = {
  post: Post; showComment: boolean; comunaAjena?: string
  onGeneratePoster: (poster: { post: Post; petId?: string }) => void
  onReact: () => void; onSave: () => void; onComment: () => void; onReport: (t: Reportable) => void; onEdit: () => void; onDelete: () => void; onResolve: () => void; onAdoption?: () => void
  onAddComment: (text: string) => Promise<void> | void; onEditComment: (c: Comentario, text: string) => Promise<void> | void; onDeleteComment: (c: Comentario) => void
}

function PostCard({ post, showComment, comunaAjena, onGeneratePoster, onReact, onSave, onComment, onReport, onEdit, onDelete, onResolve, onAdoption, onAddComment, onEditComment, onDeleteComment }: CardProps) {
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (text.trim().length < 3) return; await onAddComment(text.trim()); setText('') }
  const saveComment = async (event: React.FormEvent, c: Comentario) => { event.preventDefault(); if (!editing || editing.text.trim().length < 3) return; await onEditComment(c, editing.text.trim()); setEditing(null) }
  const cerrable = post.tipo === 'extravio' || post.tipo === 'encuentro'
  const nombreFoto = post.mascota || post.animal?.nombre || tipoLabel[post.tipo]
  return <article id={`post-${post.id}`} className={`community-post${post.urgente && !post.resuelto ? ' is-urgent' : ''}${post.resuelto ? ' is-resolved' : ''}`}><header className="post-top"><div className="post-avatar">{iniciales(post.autor)}</div><div className="post-author"><strong>{post.autor}</strong><small>{ago(post.creado_en)}{post.editado ? ' · editado' : ''}{comunaAjena ? ` · ${comunaAjena}` : ''}</small></div><span className={`post-type ${tipoClass[post.tipo]}`}>{tipoLabel[post.tipo]}</span></header>
    {((post.urgente && !post.resuelto) || post.resuelto) && <div className="chip-row">{post.urgente && !post.resuelto && <span className="chip chip-alert"><TriangleAlert size={13} /> Urgente</span>}{post.resuelto && <span className="chip chip-ok"><Check size={13} /> {post.tipo === 'extravio' ? 'Mascota encontrada' : 'Resuelto'}</span>}</div>}
    <p className="post-text">{post.texto}</p>
    {(post.sector || post.fecha_evento || post.mascota) && <div className="post-meta">{post.mascota && <span>Mascota: {post.mascota}</span>}{post.sector && <span><MapPin size={14} /> {post.sector}</span>}{post.fecha_evento && <span className={post.fecha_evento < hoy() ? 'is-past' : ''}><CalendarDays size={14} /> {post.fecha_evento < hoy() ? 'Fue el' : 'Fecha:'} {fechaCorta(post.fecha_evento)}</span>}</div>}
    {post.foto_url && <Photo src={post.foto_url} nombre={nombreFoto} className="post-photo" />}
    {post.tipo === 'adopcion' && <div className="post-adoption">{post.animal ? <><span>Conoce a <strong>{post.animal.nombre}</strong> · {post.animal.ong}</span>{onAdoption && <button className="secondary" onClick={onAdoption}>Ver en Adopciones</button>}</> : <span>Este animal ya encontró un hogar o no está disponible.</span>}</div>}
    <div className="post-actions"><button className={post.reaccione ? 'reacted' : ''} onClick={onReact} aria-pressed={post.reaccione}><Heart size={16} fill={post.reaccione ? 'currentColor' : 'none'} /> Apoyar{post.reacciones ? ` · ${post.reacciones}` : ''}</button><button onClick={onComment} aria-expanded={showComment}><MessageCircle size={16} /> Comentar{post.comentarios.length ? ` · ${post.comentarios.length}` : ''}</button><button onClick={onSave} aria-pressed={post.guardado}>{post.guardado ? <BookmarkCheck size={16} /> : <Bookmark size={16} />} {post.guardado ? 'Guardada' : 'Guardar'}</button>{!post.es_mio && <button onClick={() => onReport({ tipo: 'publicacion', id: post.id, autor: post.autor })}>Reportar</button>}</div>
    {post.es_mio && <div className="post-owner-actions">{post.tipo === 'extravio' && <button className="text-button" onClick={() => onGeneratePoster({ post, petId: post.mascota_id ?? undefined })}><Printer size={15} /> Generar cartel</button>}{cerrable && <button className="text-button" onClick={onResolve}><Check size={15} /> {post.resuelto ? 'Reabrir' : post.tipo === 'extravio' ? 'Marcar como encontrada' : 'Marcar como resuelto'}</button>}<button className="text-button" onClick={onEdit}><Pencil size={15} /> Editar</button><button className="text-button danger-text" onClick={onDelete}><Trash2 size={15} /> Eliminar</button></div>}
    {post.comentarios.length > 0 && <div className="comments">{post.comentarios.map(c => <div className="comment" key={c.id}><strong>{c.autor}</strong>
      {editing?.id === c.id ? <form className="comment-form" onSubmit={e => saveComment(e, c)}><input aria-label="Editar comentario" maxLength={1000} value={editing.text} onChange={e => setEditing({ id: c.id, text: e.target.value })} /><button className="primary">Guardar comentario</button><button type="button" className="secondary" onClick={() => setEditing(null)}>Cancelar</button></form> : <span>{c.texto}{c.editado ? ' (editado)' : ''}</span>}
      {editing?.id !== c.id && <span className="comment-actions">{c.es_mio ? <><button className="text-button" onClick={() => setEditing({ id: c.id, text: c.texto })}>Editar</button><button className="text-button danger-text" onClick={() => onDeleteComment(c)}>Eliminar</button></> : <button className="text-button" onClick={() => onReport({ tipo: 'comentario', id: c.id, autor: c.autor })}>Reportar</button>}</span>}</div>)}</div>}
    {showComment && <form className="comment-form" onSubmit={submit}><input aria-label="Comentario" maxLength={1000} value={text} onChange={e => setText(e.target.value)} placeholder="Escribe un comentario..." /><button className="primary">Enviar</button></form>}
  </article>
}

function Composer({ post, initialType = 'recomendacion', onClose, onSaved }: { post: Post | null; initialType?: Tipo; onClose: () => void; onSaved: () => Promise<void> }) {
  useModalFocus(onClose, post ? 'textarea' : 'select')
  const [form, setForm] = useState({ tipo: post?.tipo || initialType, texto: post?.texto || '', mascota_id: '', sector: post?.sector || '', fecha_evento: post?.fecha_evento || '' })
  const [pets, setPets] = useState<Mascota[]>([])
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!post) api<Mascota[]>('/mascotas').then(setPets).catch(() => undefined) }, [post])
  const conSector = form.tipo !== 'recomendacion' && form.tipo !== 'adopcion'
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (form.texto.trim().length < 15) { setError('Cuéntanos un poco más para ayudar a la comunidad (mínimo 15 caracteres)'); setErrorField('texto'); requestAnimationFrame(() => document.getElementById('wall-text')?.focus()); return }
    if (form.tipo === 'evento' && !form.fecha_evento) { setError('Indica la fecha del evento'); setErrorField('fecha'); requestAnimationFrame(() => document.getElementById('wall-date')?.focus()); return }
    setBusy(true)
    const campos = { texto: form.texto.trim(), ...(conSector && form.sector.trim() && { sector: form.sector.trim() }), ...(form.tipo === 'evento' && { fecha_evento: form.fecha_evento }) }
    try {
      if (post) await api(`/muro/${post.id}`, { method: 'PATCH', body: campos })
      else await api('/muro', { method: 'POST', body: { tipo: form.tipo, ...campos, ...(form.mascota_id && form.tipo === 'extravio' ? { mascota_id: form.mascota_id } : {}) } })
      await onSaved()
    } catch (e) { setError(errorText(e)); setErrorField(''); setBusy(false) }
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit} noValidate><button type="button" className="close" aria-label="Cerrar" onClick={onClose}><X size={20} /></button><p className="eyebrow">{post ? 'EDITAR PUBLICACIÓN' : 'NUEVA PUBLICACIÓN'}</p><h2>{post ? 'Corrige tu publicación' : 'Comparte con tu comunidad'}</h2><p className="muted">{ayuda[form.tipo] || 'Se publicará en el muro de tu comuna. No se permiten enlaces externos.'}</p>
    <div className="form-grid"><label>Tipo<select value={form.tipo} disabled={!!post} onChange={e => setForm({ ...form, tipo: e.target.value as Tipo })}>{(post ? [post.tipo] : tiposTutor).map(t => <option key={t} value={t}>{tipoLabel[t]}</option>)}</select></label>
      {!post && form.tipo === 'extravio' && pets.length > 0 && <label>Mascota extraviada<select value={form.mascota_id} onChange={e => setForm({ ...form, mascota_id: e.target.value })}><option value="">Ninguna en particular</option>{pets.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>}
      {conSector && <label>Sector o referencia<input maxLength={80} value={form.sector} onChange={e => setForm({ ...form, sector: e.target.value })} placeholder="Ej. Plaza de Armas, sin dirección exacta" /></label>}
      {form.tipo === 'evento' && <label>Fecha del evento<input id="wall-date" type="date" min={hoy()} value={form.fecha_evento} aria-invalid={errorField === 'fecha'} aria-describedby={errorField === 'fecha' ? 'wall-field-error' : undefined} onChange={e => { setForm({ ...form, fecha_evento: e.target.value }); if (errorField === 'fecha') { setError(''); setErrorField('') } }} /></label>}</div>
    <label className="composer-label">Descripción<textarea id="wall-text" rows={5} maxLength={1000} value={form.texto} aria-invalid={errorField === 'texto'} aria-describedby={errorField === 'texto' ? 'wall-field-error' : undefined} onChange={e => { setForm({ ...form, texto: e.target.value }); setError(''); setErrorField('') }} /></label>
    {error && <div className="form-error" id={errorField ? 'wall-field-error' : undefined} role={errorField ? undefined : 'alert'}>{error}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Guardando...' : post ? 'Guardar cambios' : 'Publicar'}</button></div></form></div>
}

const posterPhotoUrl = (src?: string | null) => src?.startsWith('/') ? `${import.meta.env.BASE_URL}${src.slice(1)}` : src || ''
const posterQrUrl = (token: string) => `${window.location.origin}${import.meta.env.BASE_URL}#qr/${token}`

function LostPosterModal({ post, petId, onClose }: { post: Post; petId?: string; onClose: () => void }) {
  useModalFocus(onClose)
  const [pets, setPets] = useState<LostPosterPet[]>([])
  const [selectedPetId, setSelectedPetId] = useState(petId || '')
  const [qr, setQr] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    api<Mascota[]>('/mascotas').then(rows => {
      if (!active) return
      const available = rows.map(({ id, nombre, foto_url, token_activo }) => ({ id, nombre, foto_url, token_activo }))
      setPets(available)
      if (petId && available.some(pet => pet.id === petId)) setSelectedPetId(petId)
    }).catch(e => { if (active) setError(errorText(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [petId])
  const pet = pets.find(row => row.id === selectedPetId) || null
  useEffect(() => {
    let active = true
    if (!pet?.token_activo) { setQr(''); return () => { active = false } }
    QRCode.toDataURL(posterQrUrl(pet.token_activo), { width: 1200, margin: 4, errorCorrectionLevel: 'H', color: { dark: '#111111', light: '#ffffff' } })
      .then(source => { if (active) { setQr(source); setError('') } })
      .catch(() => { if (active) setError('No se pudo generar el QR de la medalla.') })
    return () => { active = false }
  }, [pet?.token_activo])
  const issued = new Date(post.creado_en).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })
  const name = pet?.nombre || post.mascota || 'Mascota extraviada'
  const content = <PosterContent post={post} pet={pet} qr={qr} issued={issued} name={name} />
  return <div className="modal-backdrop lost-poster-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}><article className="modal lost-poster-modal" role="dialog" aria-modal="true" aria-labelledby="lost-poster-title"><button type="button" className="close" aria-label="Cerrar cartel" onClick={onClose}><X size={20} /></button><p className="eyebrow">CARTEL PARA IMPRIMIR</p><h2 id="lost-poster-title">Cartel de mascota perdida</h2><p className="muted">Formato A4 vertical. No muestra teléfono, correo ni dirección del tutor.</p>
    {!loading && !pet && pets.length > 0 && <label className="lost-poster-pet-picker">Mascota del cartel<select value={selectedPetId} onChange={event => setSelectedPetId(event.target.value)}><option value="">Selecciona una mascota</option>{pets.map(row => <option key={row.id} value={row.id}>{row.nombre}</option>)}</select></label>}
    {loading && <p className="muted" role="status">Cargando ficha y medalla…</p>}{error && <p className="form-error" role="alert">{error}</p>}
    {!loading && !error && !pets.length && <p className="form-error" role="alert">No se encontraron mascotas en tu cuenta. Para generar el cartel con foto y QR, publica el extravío asociado a una mascota.</p>}
    {!loading && pet && !pet.token_activo && <p className="lost-poster-warning" role="status">Activa la medalla para incluir el QR</p>}
    {!loading && pet && pet.token_activo && !qr && !error && <p className="muted" role="status">Generando QR de la medalla…</p>}
    <div className="lost-poster-preview">{content}</div><div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cerrar</button>{pet?.token_activo && <ShareButton hash={`#qr/${pet.token_activo}`} title={`Se busca: ${name}`} text={`Se busca a ${name}${post.sector ? ` (sector ${post.sector})` : ''}. Si sabes dónde está, avisa a su tutor desde su ficha PetSuite.`} label="Compartir búsqueda" />}<button type="button" className="primary" onClick={() => window.print()} disabled={loading || !pet || (!!pet.token_activo && !qr)}><Printer size={16} /> Imprimir cartel</button></div>
    </article>{createPortal(<div className="lost-poster-print-page" aria-hidden="true">{content}</div>, document.body)}</div>
}

function PosterContent({ post, pet, qr, issued, name }: { post: Post; pet: LostPosterPet | null; qr: string; issued: string; name: string }) {
  const photo = posterPhotoUrl(pet?.foto_url || post.foto_url)
  const qrMessage = pet ? 'Activa la medalla para incluir el QR' : 'Selecciona la mascota para incluir su QR'
  return <section className="lost-poster-sheet"><p className="lost-poster-heading">SE BUSCA</p><div className="lost-poster-photo">{photo ? <img src={photo} alt={`Foto de ${name}`} /> : <span>Foto no disponible</span>}</div><h1>{name}</h1><div className="lost-poster-details">{post.sector && <p><strong>SECTOR</strong><span>{post.sector}</span></p>}<p><strong>FECHA</strong><span>{issued}</span></p></div><div className="lost-poster-description"><strong>SEÑAS</strong><p>{post.texto}</p></div><div className="lost-poster-qr">{pet?.token_activo && qr ? <><img src={qr} alt={`QR de la ficha pública de ${name}`} /><span>Escanea para ver su ficha y contactar al tutor</span></> : <strong>{qrMessage}</strong>}</div></section>
}

function ReportModal({ target, onClose, onSaved }: { target: Reportable; onClose: () => void; onSaved: () => void }) {
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState(false)
  const [done, setDone] = useState(false)
  useModalFocus(onClose, done ? undefined : '#report-post-reason', done ? 'sent' : 'editing')
  const que = target.tipo === 'comentario' ? 'el comentario' : 'la publicación'
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const result = moderationMessageSchema.safeParse(message)
    if (!result.success) { setError(result.error.issues[0]?.message || 'Explica el reporte'); setFieldError(true); requestAnimationFrame(() => document.getElementById('report-post-reason')?.focus()); return }
    try { await api('/reportes', { method: 'POST', body: { objeto_tipo: target.tipo, objeto_id: target.id, motivo: result.data.slice(0, 200) } }); setDone(true) } catch (e) { setError(errorText(e)); setFieldError(false) }
  }
  if (done) return <div className="modal-backdrop"><div className="modal report-post-modal"><p className="eyebrow">REPORTE ENVIADO</p><h2>Gracias por avisar</h2><p className="muted" role="status">El equipo de moderación revisará {que} en un plazo objetivo de 24 horas.</p><div className="modal-actions"><button className="primary" onClick={onSaved}>Listo</button></div></div></div>
  return <div className="modal-backdrop"><form className="modal report-post-modal" onSubmit={submit} noValidate><button type="button" className="close" aria-label="Cerrar reporte" onClick={onClose}><X size={20} /></button><p className="eyebrow">REPORTAR {target.tipo === 'comentario' ? 'COMENTARIO' : 'PUBLICACIÓN'}</p><h2>Cuéntanos qué pasó</h2><p className="muted">Tu mensaje ayudará al equipo de moderación a revisar {que} de {target.autor}.</p><label htmlFor="report-post-reason">Motivo del reporte<textarea id="report-post-reason" rows={5} maxLength={200} value={message} aria-invalid={fieldError} aria-describedby={fieldError ? 'report-post-error' : undefined} onChange={e => { setMessage(e.target.value); setError(''); setFieldError(false) }} placeholder="Describe lo sucedido..." /></label>{error && <p className="form-error" id={fieldError ? 'report-post-error' : undefined} role={fieldError ? undefined : 'alert'}>{error}</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" type="submit">Enviar reporte</button></div></form></div>
}
