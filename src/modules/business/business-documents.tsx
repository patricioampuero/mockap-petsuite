// Documentos de validación del negocio: patente comercial, resolución sanitaria y, si es empresa, la constitución.
// El negocio los sube aquí; un asesor los revisa antes de aprobar el alta (src/shared/documentos.ts).
import { useCallback, useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, Clock, Download, FileUp } from 'lucide-react'
import { api, errorText, fechaLarga } from '../../shared/api'
import { descargarArchivo } from '../../shared/archivos'
import { archivoBase64, prepararFoto } from '../../shared/fotos'
import { MAX_BYTES_DOCUMENTO, type TipoDocumento, type VistaDocumentos } from '../../shared/documentos'
import { ErrorState, LoadingState } from '../../shared/feedback'
import type { MiPyme } from './business'

const kb = (bytes: number) => bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`
const estadoDoc = { pendiente: ['En revisión', Clock, 'chip chip-info'], aprobado: ['Aprobado', CircleCheck, 'chip chip-ok'], rechazado: ['Por corregir', CircleAlert, 'chip chip-alert'] } as const

/** Prepara un archivo para subirlo: un PDF va tal cual; una foto se reduce (sin perder legibilidad) y pierde sus metadatos. */
export async function prepararDocumento(archivo: File): Promise<{ nombre: string; mime: string; datos: string }> {
  if (archivo.type === 'application/pdf') {
    if (archivo.size > MAX_BYTES_DOCUMENTO) throw new Error('El PDF pesa más de 2 MB: escanéalo con menos resolución o súbelo como foto')
    return { nombre: archivo.name, mime: 'application/pdf', datos: await archivoBase64(archivo) }
  }
  if (!archivo.type.startsWith('image/')) throw new Error('Elige un PDF o una foto del documento (JPG o PNG)')
  const foto = await prepararFoto(archivo, { ladoMax: 2000, maxBytes: MAX_BYTES_DOCUMENTO })
  return { nombre: archivo.name.replace(/\.[^.]+$/, '') + '.jpg', mime: foto.tipo, datos: foto.datos }
}

export function BusinessDocuments({ pyme, onChange }: { pyme: MiPyme; onChange: () => Promise<void> | void }) {
  const [vista, setVista] = useState<VistaDocumentos | null>(null)
  const [error, setError] = useState('')
  const [subiendo, setSubiendo] = useState<TipoDocumento | null>(null)
  const [aviso, setAviso] = useState('')
  const load = useCallback(() => api<VistaDocumentos>(`/pymes/${pyme.id}/documentos`).then(v => { setVista(v); setError('') }).catch(e => setError(errorText(e))), [pyme.id])
  useEffect(() => { void load() }, [load])
  const subir = async (tipo: TipoDocumento, event: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0]
    event.target.value = ''
    if (!archivo) return
    setSubiendo(tipo); setError(''); setAviso('')
    try {
      const v = await api<VistaDocumentos>(`/pymes/${pyme.id}/documentos/${tipo}`, { method: 'PUT', body: await prepararDocumento(archivo) })
      setVista(v)
      setAviso(v.faltan.length ? 'Documento recibido. Sube los que faltan para que el asesor pueda aprobar tu negocio.' : 'Documento recibido. Ya están todos los obligatorios: un asesor los revisará.')
      await onChange()
    } catch (e) { setError(errorText(e)) } finally { setSubiendo(null) }
  }
  const descargar = async (id: string, nombre: string) => { try { await descargarArchivo(`/pymes/${pyme.id}/documentos/${id}/archivo`, nombre) } catch (e) { setError(errorText(e)) } }
  if (!vista) return <section className="page role-page">{error ? <ErrorState message={error} onRetry={() => void load()} /> : <LoadingState label="Cargando documentos" />}</section>
  return <section className="page role-page"><div className="page-title"><div><p className="eyebrow">VALIDACIÓN DEL NEGOCIO</p><h1>Documentos</h1><p className="muted">Con estos documentos un asesor confirma que tu negocio existe y funciona con sus permisos. Son privados: solo los ve el equipo de PetSuite y nunca se publican.</p></div></div>
    {pyme.estado_verificacion === 'pendiente' && <div className={vista.faltan.length ? 'alert-card warn' : 'alert-card'}><div className="alert-icon">{vista.faltan.length ? <CircleAlert size={22} /> : <CircleCheck size={22} />}</div><div><strong>{vista.faltan.length ? `Falta: ${vista.faltan.join(', ')}` : 'Documentos completos'}</strong><p>{vista.faltan.length ? 'Tu negocio se publica en Explorar cuando un asesor revisa estos documentos y aprueba el alta.' : 'Un asesor los revisará y te avisará por correo cuando tu negocio esté publicado.'}</p></div></div>}
    {error && <p className="form-error" role="alert">{error}</p>}{aviso && <p className="save-message" role="status">{aviso}</p>}
    <div className="document-list">{vista.documentos.map(d => {
      const a = d.archivo, [estado, Icono, clase] = a ? estadoDoc[a.estado] : ['Sin subir', FileUp, 'chip'] as const
      return <article className="document-row" key={d.tipo}>
        <div className="document-main"><div className="document-head"><h2>{d.nombre}</h2><span className={clase}><Icono size={13} aria-hidden="true" /> {estado}</span>{!d.obligatorio && <span className="chip">Opcional</span>}</div>
          <p className="muted">{d.detalle}{d.tipo === 'constitucion_sociedad' && !d.obligatorio ? ' Tu RUT es de persona natural, así que no es obligatorio.' : ''}</p>
          {a && <p className="document-file"><button type="button" className="text-button" onClick={() => descargar(a.id, a.nombre)}><Download size={14} aria-hidden="true" /> {a.nombre}</button><small>{kb(a.bytes)} · subido el {fechaLarga(a.subido_en.slice(0, 10))}</small></p>}
          {a?.estado === 'rechazado' && a.motivo && <p className="document-reason"><strong>Qué corregir:</strong> {a.motivo}</p>}</div>
        <label className={`secondary document-upload${subiendo === d.tipo ? ' is-busy' : ''}`}><FileUp size={16} aria-hidden="true" /> {subiendo === d.tipo ? 'Subiendo…' : a ? 'Reemplazar' : 'Subir archivo'}<input className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png" disabled={!!subiendo} onChange={e => subir(d.tipo, e)} /></label>
      </article>
    })}</div>
    <p className="muted document-help">Formatos: PDF, JPG o PNG, hasta 2 MB. Una foto del documento se reduce sola y pierde los datos de la cámara. Al reemplazar un documento vuelve a revisión.</p>
  </section>
}
