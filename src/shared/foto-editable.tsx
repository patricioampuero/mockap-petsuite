import { useState } from 'react'
import { Camera } from 'lucide-react'
import { errorText } from './api'
import { subirFoto } from './fotos'
import { Photo } from './media'

/**
 * Foto con botón para subirla, cambiarla o quitarla (mascota, animal en adopción, producto del catálogo).
 * `asignar` recibe el id de la foto recién subida, o null para quitarla, y guarda el cambio.
 */
export function FotoEditable({ src, nombre, className = 'pet-photo large', asignar }: { src?: string | null; nombre: string; className?: string; asignar: (imagenId: string | null) => Promise<unknown> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cambiar = async (accion: () => Promise<unknown>) => { setBusy(true); setError(''); try { await accion() } catch (e) { setError(errorText(e)) } finally { setBusy(false) } }
  const elegir = (event: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0]
    event.target.value = ''
    if (archivo) void cambiar(async () => asignar((await subirFoto(archivo)).id))
  }
  return <div className="pet-photo-editor">
    <Photo src={src} nombre={nombre} className={className} />
    <label className={`pet-photo-change${busy ? ' is-busy' : ''}`}><Camera size={14} aria-hidden="true" /> {busy ? 'Subiendo…' : src ? 'Cambiar foto' : 'Agregar foto'}<input className="sr-only" type="file" accept="image/*" disabled={busy} onChange={elegir} aria-label={`${src ? 'Cambiar' : 'Agregar'} la foto de ${nombre}`} /></label>
    {src && !busy && <button type="button" className="text-button pet-photo-remove" onClick={() => void cambiar(() => asignar(null))}>Quitar foto</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>
}

/**
 * Foto elegida para un formulario que aún no se guarda (una publicación, un animal nuevo): se sube al elegirla y el
 * formulario envía su id. Muestra la vista previa y permite quitarla.
 */
export function FotoOpcional({ foto, onChange, texto = 'Agregar foto', nombre = 'la foto elegida' }: { foto: { id: string; url: string } | null; onChange: (foto: { id: string; url: string } | null) => void; texto?: string; nombre?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const elegir = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0]
    event.target.value = ''
    if (!archivo) return
    setBusy(true); setError('')
    try { onChange(await subirFoto(archivo)) } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <div className="photo-picker">
    {foto && <Photo src={foto.url} nombre={nombre} className="pet-photo photo-picker-preview" />}
    <div className="photo-picker-actions">
      <label className={`pet-photo-change${busy ? ' is-busy' : ''}`}><Camera size={14} aria-hidden="true" /> {busy ? 'Subiendo…' : foto ? 'Cambiar foto' : texto}<input className="sr-only" type="file" accept="image/*" disabled={busy} onChange={elegir} /></label>
      {foto && !busy && <button type="button" className="text-button pet-photo-remove" onClick={() => onChange(null)}>Quitar foto</button>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>
}
