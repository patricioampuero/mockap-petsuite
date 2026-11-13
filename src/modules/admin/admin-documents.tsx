// Revisión de los documentos de validación de un negocio por parte del asesor o del administrador.
import { useCallback, useEffect, useState } from 'react'
import { Check, Download, X } from 'lucide-react'
import { api, errorText, fechaLarga } from '../../shared/api'
import { descargarArchivo } from '../../shared/archivos'
import type { VistaDocumentos } from '../../shared/documentos'
import { LoadingState } from '../../shared/feedback'

const estadoTexto = { pendiente: 'En revisión', aprobado: 'Aprobado', rechazado: 'Por corregir' } as const

export function PymeDocumentsReview({ pymeId, onChange }: { pymeId: string; onChange: () => Promise<void> | void }) {
  const [vista, setVista] = useState<VistaDocumentos | null>(null)
  const [error, setError] = useState('')
  const [rechazo, setRechazo] = useState<{ id: string; motivo: string } | null>(null)
  const load = useCallback(() => api<VistaDocumentos>(`/admin/pymes/${pymeId}/documentos`).then(setVista).catch(e => setError(errorText(e))), [pymeId])
  useEffect(() => { void load() }, [load])
  const decidir = async (id: string, decision: 'aprobar' | 'rechazar', motivo?: string) => {
    setError('')
    try { setVista(await api<VistaDocumentos>(`/admin/documentos/${id}`, { method: 'PATCH', body: { decision, ...(motivo && { motivo }) } })); setRechazo(null); await onChange() } catch (e) { setError(errorText(e)) }
  }
  const descargar = async (id: string, nombre: string) => { try { await descargarArchivo(`/admin/documentos/${id}/archivo`, nombre) } catch (e) { setError(errorText(e)) } }
  if (!vista) return error ? <p className="form-error" role="alert">{error}</p> : <LoadingState label="Cargando documentos" />
  return <div className="admin-documents">
    <p className="muted">{vista.faltan.length ? `Para aprobar el alta falta: ${vista.faltan.join(', ')}.` : 'Documentos obligatorios completos. Al aprobar el alta, los que siguen en revisión quedan aprobados.'}</p>
    {vista.documentos.map(d => <div className="admin-document" key={d.tipo}>
      <div><strong>{d.nombre}</strong>{!d.obligatorio && <small> · opcional</small>}
        {d.archivo ? <small>{estadoTexto[d.archivo.estado]} · subido el {fechaLarga(d.archivo.subido_en.slice(0, 10))}{d.archivo.motivo ? ` · ${d.archivo.motivo}` : ''}</small> : <small>Sin subir</small>}</div>
      {d.archivo && <div className="admin-document-actions">
        <button type="button" className="text-button" onClick={() => descargar(d.archivo!.id, d.archivo!.nombre)}><Download size={14} aria-hidden="true" /> Ver archivo</button>
        {d.archivo.estado !== 'aprobado' && <button type="button" className="secondary" onClick={() => decidir(d.archivo!.id, 'aprobar')}><Check size={14} aria-hidden="true" /> Aprobar</button>}
        {d.archivo.estado !== 'rechazado' && <button type="button" className="secondary" onClick={() => setRechazo({ id: d.archivo!.id, motivo: '' })}><X size={14} aria-hidden="true" /> Pedir corrección</button>}
      </div>}
      {rechazo && rechazo.id === d.archivo?.id && <form className="admin-document-reject" onSubmit={e => { e.preventDefault(); void decidir(rechazo.id, 'rechazar', rechazo.motivo.trim()) }}>
        <label className="composer-label">Qué debe corregir el negocio<textarea rows={2} maxLength={500} value={rechazo.motivo} onChange={e => setRechazo({ ...rechazo, motivo: e.target.value })} placeholder="Por ejemplo: la patente está vencida, sube la vigente." /></label>
        <div className="settings-actions"><button type="button" className="text-button" onClick={() => setRechazo(null)}>Cancelar</button><button className="primary">Enviar al negocio</button></div>
      </form>}
    </div>)}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>
}
