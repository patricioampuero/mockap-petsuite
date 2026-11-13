// Documentos con que un negocio respalda su validación: reglas compartidas por el mock, el API y la interfaz.
// El asesor los revisa antes de aprobar el alta; el sello «Validado por PetSuite» dice que se revisaron.

export const TIPOS_DOCUMENTO = ['patente_comercial', 'resolucion_sanitaria', 'constitucion_sociedad'] as const
export type TipoDocumento = typeof TIPOS_DOCUMENTO[number]

export const DOCUMENTOS: Record<TipoDocumento, { nombre: string; detalle: string }> = {
  patente_comercial: { nombre: 'Patente comercial', detalle: 'Patente municipal vigente del local, emitida por la municipalidad de la comuna.' },
  resolucion_sanitaria: { nombre: 'Resolución sanitaria', detalle: 'Resolución o autorización sanitaria de la SEREMI de Salud para el local.' },
  constitucion_sociedad: { nombre: 'Constitución de la sociedad', detalle: 'Escritura o certificado de constitución de la empresa, por ejemplo el del Registro de Empresas y Sociedades.' },
}

export const TIPOS_ARCHIVO = ['application/pdf', 'image/jpeg', 'image/png'] as const
export const MAX_BYTES_DOCUMENTO = 2_000_000
/** En la demo todo se guarda en el navegador: los archivos más grandes se registran sin su contenido. */
export const MAX_BYTES_DOCUMENTO_DEMO = 300_000

export const DOCUMENTO_INVALIDO = 'El archivo debe ser un PDF, JPG o PNG'
export const DOCUMENTO_PESADO = 'El archivo pesa más de 2 MB: escanéalo con menos resolución o súbelo como foto'
export const DOCUMENTO_NO_ENCONTRADO = 'Documento no encontrado'
/** Los documentos son de la empresa: un jefe de local o el personal clínico no los ve ni los cambia. */
export const SOLO_DUENO_DOCUMENTOS = 'Los documentos de validación los gestiona el dueño del negocio'
export const DOCUMENTO_SIN_ARCHIVO_DEMO = 'En la demo solo se guardan archivos de hasta 300 KB: este quedó registrado sin su contenido'

/**
 * Un RUT desde 50.000.000 corresponde a una persona jurídica (empresa). Una persona natural con giro comercial no
 * tiene escritura de constitución, así que ese documento solo es obligatorio para empresas.
 */
export const esRutEmpresa = (rut: string | null | undefined) => Number(String(rut ?? '').split('-')[0]) >= 50_000_000

export const documentoObligatorio = (tipo: TipoDocumento, rut: string | null | undefined) => tipo !== 'constitucion_sociedad' || esRutEmpresa(rut)

export type ArchivoDocumento = { id: string; tipo: TipoDocumento; nombre: string; mime: string; bytes: number; estado: 'pendiente' | 'aprobado' | 'rechazado'; motivo: string | null; subido_en: string; revisado_en: string | null }
export type VistaDocumentos = {
  documentos: { tipo: TipoDocumento; nombre: string; detalle: string; obligatorio: boolean; archivo: ArchivoDocumento | null }[]
  /** Nombres de los documentos obligatorios que faltan o que el asesor rechazó. */
  faltan: string[]
}

/** Lista para el negocio y para el asesor: cada documento que se pide, si es obligatorio y el archivo subido. */
export function vistaDocumentos(rut: string | null | undefined, archivos: ArchivoDocumento[]): VistaDocumentos {
  const documentos = TIPOS_DOCUMENTO.map(tipo => ({
    tipo, ...DOCUMENTOS[tipo], obligatorio: documentoObligatorio(tipo, rut),
    archivo: archivos.find(a => a.tipo === tipo) ?? null,
  }))
  return { documentos, faltan: documentos.filter(d => d.obligatorio && (!d.archivo || d.archivo.estado === 'rechazado')).map(d => d.nombre) }
}

export const documentosFaltantes = (faltan: string[]) => `Antes de aprobar el alta faltan documentos: ${faltan.join(', ')}`

const empieza = (b: Uint8Array, firma: number[]) => firma.every((x, i) => b[i] === x)

/** null si el archivo es válido; si no, el motivo. Revisa la firma real del archivo, no solo el tipo declarado. */
export function revisarDocumento(b: Uint8Array, mime: string): string | null {
  if (!(TIPOS_ARCHIVO as readonly string[]).includes(mime) || b.length < 8) return DOCUMENTO_INVALIDO
  if (b.length > MAX_BYTES_DOCUMENTO) return DOCUMENTO_PESADO
  const ok = mime === 'application/pdf' ? empieza(b, [0x25, 0x50, 0x44, 0x46, 0x2d])
    : mime === 'image/jpeg' ? empieza(b, [0xff, 0xd8, 0xff])
      : empieza(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return ok ? null : DOCUMENTO_INVALIDO
}

/** Nombre de archivo seguro para mostrar y descargar: sin rutas ni caracteres de control. */
export const nombreArchivo = (nombre: string) => nombre.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f"<>|*?:]/g, '').trim().slice(0, 120) || 'documento'

export function correoDocumentoRechazado(negocio: string, documento: string, motivo: string) {
  return {
    asunto: `${negocio}: revisa tu ${documento.toLowerCase()}`,
    cuerpo: `Hola:\n\nRevisamos la ${documento.toLowerCase()} que subiste y no pudimos aceptarla:\n\n${motivo}\n\nSube una nueva versión en Mi negocio → Documentos. Tu solicitud sigue abierta.\n\nEquipo PetSuite`,
  }
}

export function avisoDocumentosCompletos(negocio: string, rut: string) {
  return {
    asunto: `Documentos completos: ${negocio}`,
    cuerpo: `${negocio} (RUT ${rut}) subió todos sus documentos de validación. Revísalos en Administración → Pymes y suscripciones.\n\nEquipo PetSuite`,
  }
}
