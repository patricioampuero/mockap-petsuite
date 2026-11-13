// Fotos en el navegador: antes de subirlas, la app las reduce y las vuelve a codificar como JPEG. Así pesan poco y
// pierden los metadatos de la cámara, incluida la ubicación GPS (una foto de la mascota no revela dónde vive el tutor).
import { api, modoDemo } from './api'
import { MAX_BYTES_IMAGEN } from './imagenes'

export type FotoSubida = { id: string; url: string }

const aBlob = (canvas: HTMLCanvasElement, calidad: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No pudimos preparar la foto'))), 'image/jpeg', calidad))

const aBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const lector = new FileReader()
  lector.onload = () => resolve(String(lector.result).split(',')[1] ?? '')
  lector.onerror = () => reject(new Error('No pudimos leer la foto'))
  lector.readAsDataURL(blob)
})

/**
 * Reduce la foto (lado mayor de 1280 px; 720 px en la demo, que guarda todo en el navegador) y la deja en JPEG.
 * Un documento fotografiado usa un lado mayor más grande para que se pueda leer.
 */
export async function prepararFoto(archivo: File, { ladoMax: lado, maxBytes = MAX_BYTES_IMAGEN }: { ladoMax?: number; maxBytes?: number } = {}): Promise<{ datos: string; tipo: 'image/jpeg' }> {
  if (!archivo.type.startsWith('image/')) throw new Error('Elige una foto (JPG, PNG o WebP)')
  if (archivo.size > 30_000_000) throw new Error('La foto es demasiado grande')
  const imagen = await createImageBitmap(archivo, { imageOrientation: 'from-image' }).catch(() => { throw new Error('No pudimos abrir esa foto. Prueba con otra en JPG o PNG.') })
  const ladoMax = lado ?? (modoDemo ? 720 : 1280)
  const escala = Math.min(1, ladoMax / Math.max(imagen.width, imagen.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(imagen.width * escala))
  canvas.height = Math.max(1, Math.round(imagen.height * escala))
  canvas.getContext('2d')!.drawImage(imagen, 0, 0, canvas.width, canvas.height)
  imagen.close()
  let calidad = modoDemo ? 0.72 : 0.82
  let blob = await aBlob(canvas, calidad)
  while (blob.size > maxBytes * 0.9 && calidad > 0.4) { calidad -= 0.12; blob = await aBlob(canvas, calidad) }
  return { datos: await aBase64(blob), tipo: 'image/jpeg' }
}

/** Un archivo cualquiera (por ejemplo, un PDF) en base64, sin el prefijo data:. */
export const archivoBase64 = (archivo: Blob) => aBase64(archivo)

/** Prepara y sube la foto; devuelve su id (para asociarla) y su dirección. */
export async function subirFoto(archivo: File): Promise<FotoSubida> {
  return api<FotoSubida>('/imagenes', { method: 'POST', body: await prepararFoto(archivo) })
}
