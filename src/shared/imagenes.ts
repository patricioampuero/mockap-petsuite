// Fotos subidas por los usuarios: reglas compartidas por el mock y el API.
// La app reduce cada foto en el teléfono (src/shared/fotos.tsx) y, al volver a codificarla, le quita los metadatos,
// incluida la ubicación GPS. El servidor igual revisa el tipo, el tamaño y que no queden datos EXIF.

export const TIPOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'] as const
export type TipoImagen = typeof TIPOS_IMAGEN[number]
export const MAX_BYTES_IMAGEN = 600_000
export const MAX_IMAGENES_POR_USUARIO = 40

export const IMAGEN_INVALIDA = 'El archivo no es una foto JPG, PNG o WebP'
export const IMAGEN_PESADA = 'La foto pesa demasiado: súbela desde la app, que la reduce sola'
export const IMAGEN_CON_UBICACION = 'La foto conserva datos de la cámara o de ubicación: súbela desde la app, que los quita'
export const IMAGENES_AGOTADAS = `Puedes tener hasta ${MAX_IMAGENES_POR_USUARIO} fotos: quita alguna antes de subir otra`
export const IMAGEN_AJENA = 'Esa foto no existe o no es tuya'

/** Dirección pública de una foto en el API (la ficha QR la muestra sin sesión). En la demo, la foto va como data: URL. */
export const urlImagen = (id: string) => `/api/v1/imagenes/${id}`
export const idDeUrlImagen = (url: string | null | undefined) => /^\/api\/v1\/imagenes\/([0-9a-f-]{36})$/i.exec(url ?? '')?.[1] ?? null

const empieza = (b: Uint8Array, firma: number[], desde = 0) => firma.every((x, i) => b[desde + i] === x)

/** null si la foto es válida; si no, el motivo. Revisa la firma real del archivo, no solo el tipo declarado. */
export function revisarImagen(b: Uint8Array, tipo: string): string | null {
  if (!(TIPOS_IMAGEN as readonly string[]).includes(tipo) || b.length < 12) return IMAGEN_INVALIDA
  if (b.length > MAX_BYTES_IMAGEN) return IMAGEN_PESADA
  const ok = tipo === 'image/jpeg' ? empieza(b, [0xff, 0xd8, 0xff])
    : tipo === 'image/png' ? empieza(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      : empieza(b, [0x52, 0x49, 0x46, 0x46]) && empieza(b, [0x57, 0x45, 0x42, 0x50], 8)
  if (!ok) return IMAGEN_INVALIDA
  // Un JPEG con un bloque APP1 «Exif» trae datos de la cámara y, a veces, la ubicación donde se tomó.
  if (tipo === 'image/jpeg') {
    for (let i = 2; i < Math.min(b.length - 10, 65_536); i++) {
      if (b[i] === 0xff && b[i + 1] === 0xe1 && empieza(b, [0x45, 0x78, 0x69, 0x66, 0, 0], i + 4)) return IMAGEN_CON_UBICACION
    }
  }
  return null
}

/** Base64 (sin el prefijo data:) a bytes, en el navegador y en Node. */
export function desdeBase64(base64: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null
  const bin = atob(base64)
  const b = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i)
  return b
}
