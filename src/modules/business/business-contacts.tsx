import { useCallback, useEffect, useState } from 'react'
import { Check, MessageCircle, Send } from 'lucide-react'
import { api, errorText, modoDemo } from '../../shared/api'
import type { MiPyme } from './business'
import { EmptyState, ErrorState, LoadingState } from '../../shared/feedback'
import { businessReplySchema } from '../../shared/validators'

type Contact = { id: string; remitente_nombre: string; remitente_contacto: string | null; mensaje: string; estado: 'nuevo' | 'leido' | 'respondido'; respuesta: string | null; creado_en: string; respondido_en: string | null }

export function BusinessContacts({ pyme }: { pyme: MiPyme }) {
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const [filter, setFilter] = useState<'Todos' | 'Nuevos' | 'Respondidos'>('Todos')
  const [open, setOpen] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [error, setError] = useState('')
  const [replyInvalid, setReplyInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => { try { setContacts(await api<Contact[]>(`/pymes/${pyme.id}/contactos`)); setError('') } catch (e) { setError(errorText(e)) } }, [pyme.id])
  useEffect(() => { void load() }, [load])

  const markRead = async (contact: Contact) => {
    if (contact.estado !== 'nuevo') return
    try { await api(`/pymes/${pyme.id}/contactos/${contact.id}`, { method: 'PATCH', body: { estado: 'leido' } }); await load() } catch (e) { setError(errorText(e)) }
  }
  const startReply = (contact: Contact) => { setOpen(open === contact.id ? null : contact.id); setReply(contact.respuesta || ''); setError(''); setReplyInvalid(false); void markRead(contact) }
  const send = async (event: React.FormEvent, contact: Contact) => {
    event.preventDefault()
    const parsed = businessReplySchema.safeParse({ respuesta: reply })
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || 'Revisa la respuesta'); setReplyInvalid(true); requestAnimationFrame(() => document.getElementById(`reply-${contact.id}`)?.focus()); return }
    setBusy(true); setError('')
    try { await api(`/pymes/${pyme.id}/contactos/${contact.id}`, { method: 'PATCH', body: { estado: 'respondido', ...parsed.data } }); setOpen(null); setReply(''); await load() } catch (e) { setError(errorText(e)); setReplyInvalid(false) } finally { setBusy(false) }
  }
  const shown = (contacts || []).filter(c => filter === 'Todos' || filter === 'Nuevos' && c.estado === 'nuevo' || filter === 'Respondidos' && c.estado === 'respondido')
  const unread = contacts?.filter(c => c.estado === 'nuevo').length || 0
  return <section className="page business-contacts-page"><div className="page-title"><div><p className="eyebrow">TU NEGOCIO EN PETSUITE</p><h1>Contactos recibidos</h1><p className="muted">Consultas que llegaron desde tu ficha en el directorio.</p></div><span className="moderation-title-count">{unread} {unread === 1 ? 'nuevo' : 'nuevos'}</span></div>
    <div className="business-contacts-intro"><div className="business-contacts-icon"><MessageCircle size={24} /></div><div><strong>Conversaciones con la comunidad</strong><p>Responde aquí para que el tutor vea tu mensaje en «Mis consultas».{modoDemo && ' En la demo, este intercambio se guarda en este navegador.'}</p></div></div>
    <div className="user-filters">{(['Todos', 'Nuevos', 'Respondidos'] as const).map(value => <button key={value} className={filter === value ? 'category-tab active' : 'category-tab'} onClick={() => setFilter(value)}>{value}{value === 'Nuevos' ? ` · ${unread}` : ''}</button>)}</div>
    {error && !contacts && <ErrorState message={error} onRetry={() => void load()} />}
    {error && contacts && !open && <p className="form-error" role="alert">{error}</p>}
    {!contacts && !error ? <LoadingState label="Cargando consultas" rows={2} /> : <div className="business-contact-list">{shown.map(contact => <article className="business-contact-card" key={contact.id}><div className="business-contact-head"><div className="avatar">{contact.remitente_nombre.slice(0, 2).toUpperCase()}</div><div><h2>{contact.remitente_nombre}</h2><p>{new Date(contact.creado_en).toLocaleString('es-CL')}{contact.remitente_contacto && ` · Contacto: ${contact.remitente_contacto}`}</p></div><span className={`business-contact-status ${contact.estado}`}>{contact.estado === 'nuevo' ? 'Nuevo' : contact.estado === 'leido' ? 'Leído' : 'Respondido'}</span></div><p className="business-contact-message">{contact.mensaje}</p>{contact.respuesta && open !== contact.id && <div className="business-contact-answer"><strong>Tu respuesta</strong><p>{contact.respuesta}</p></div>}
        <div className="business-contact-actions">{contact.estado === 'nuevo' && <button className="secondary" onClick={() => void markRead(contact)}><Check size={16} /> Marcar leído</button>}<button className="secondary" onClick={() => startReply(contact)}><Send size={16} /> {open === contact.id ? 'Cancelar respuesta' : contact.respuesta ? 'Editar respuesta' : 'Responder'}</button></div>
        {open === contact.id && <form className="business-reply-form" onSubmit={event => void send(event, contact)} noValidate><label htmlFor={`reply-${contact.id}`}>Respuesta para {contact.remitente_nombre}<textarea id={`reply-${contact.id}`} maxLength={500} rows={4} value={reply} aria-invalid={replyInvalid} aria-describedby={replyInvalid ? `reply-error-${contact.id}` : undefined} onChange={event => { setReply(event.target.value); setError(''); setReplyInvalid(false) }} placeholder="Escribe una respuesta clara a la consulta..." /></label>{error && <p className="form-error" id={replyInvalid ? `reply-error-${contact.id}` : undefined} role={replyInvalid ? undefined : 'alert'}>{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Enviando...' : 'Enviar respuesta'}</button></form>}
      </article>)}{contacts && !shown.length && <EmptyState title="Sin consultas en esta bandeja" description={filter === 'Todos' ? 'Las consultas que envíen los tutores desde el directorio aparecerán aquí.' : 'Prueba con otra categoría.'} action={filter === 'Todos' ? 'Actualizar' : 'Ver todas'} onAction={() => filter === 'Todos' ? void load() : setFilter('Todos')} />}</div>}
  </section>
}
