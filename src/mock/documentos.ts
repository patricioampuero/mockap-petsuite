// Documentos de validación de los negocios (mismas reglas que backend/api/documentos.ts y src/shared/documentos.ts).
// El negocio sube su patente, su resolución sanitaria y, si es empresa, su constitución; el asesor los revisa.
import { z } from 'zod'
import type { Session } from '../shared/api'
import type { ModuloPyme, Rol } from '../shared/permissions'
import {
  avisoDocumentosCompletos, correoDocumentoRechazado, DOCUMENTO_INVALIDO, DOCUMENTO_NO_ENCONTRADO, DOCUMENTO_PESADO, DOCUMENTO_SIN_ARCHIVO_DEMO,
  DOCUMENTOS, MAX_BYTES_DOCUMENTO_DEMO, nombreArchivo, revisarDocumento, SOLO_DUENO_DOCUMENTOS, TIPOS_ARCHIVO, TIPOS_DOCUMENTO, vistaDocumentos, type ArchivoDocumento, type TipoDocumento,
} from '../shared/documentos'
import { desdeBase64 } from '../shared/imagenes'
import { db, now, uid, type DocumentoPyme, type Pyme, type Usuario } from './db'
import { avisarAsesores, enviarCorreo } from './suite'

type Req = { params: Record<string, string>; query: URLSearchParams; body: unknown; session: Session | null }
type Ctx = {
  on: (method: string, path: string, h: (req: Req) => unknown) => void
  auth: (req: Req, ...roles: Rol[]) => Usuario
  parse: <T extends z.ZodType>(schema: T, body: unknown) => z.infer<T>
  fail: (status: number, message: string) => never
  miPyme: (req: Req, modulo: ModuloPyme) => Pyme
}

const archivoDe = ({ id, tipo, nombre, mime, bytes, estado, motivo, subido_en, revisado_en }: DocumentoPyme): ArchivoDocumento => ({ id, tipo, nombre, mime, bytes, estado, motivo, subido_en, revisado_en })
export const documentosDe = (p: Pyme) => vistaDocumentos(p.rut_empresa, db.documentos.filter(d => d.pyme_id === p.id).map(archivoDe))

/** Al aprobar el alta, los documentos que esperaban revisión quedan aprobados por quien aprobó. */
export function aprobarDocumentos(p: Pyme, revisor: Usuario) {
  for (const d of db.documentos) if (d.pyme_id === p.id && d.estado === 'pendiente') Object.assign(d, { estado: 'aprobado', revisado_por: revisor.id, revisado_en: now() })
}

export function registerDocumentosRoutes({ on, auth, parse, fail, miPyme }: Ctx) {
  const subida = z.object({
    nombre: z.string().trim().min(1, 'Falta el nombre del archivo').max(200),
    mime: z.string().max(40),
    // El cuerpo HTTP ya limita a 3 MB; el tamaño real del archivo lo revisa revisarDocumento (413).
  datos: z.string().max(3_000_000, DOCUMENTO_PESADO),
  })
  const delDueno = (req: Req) => {
    const p = miPyme(req, 'perfil'), u = auth(req)
    if (p.propietario_id !== u.id) fail(403, SOLO_DUENO_DOCUMENTOS)
    return { p, u }
  }
  const binario = (d: DocumentoPyme) => d.datos ? { __binario: true, privado: true, tipo: d.mime, base64: d.datos, nombre: d.nombre } : fail(404, DOCUMENTO_SIN_ARCHIVO_DEMO)

  on('GET', '/pymes/:id/documentos', req => documentosDe(delDueno(req).p))

  // Un documento por tipo: subir otro reemplaza al anterior y vuelve a revisión.
  on('PUT', '/pymes/:id/documentos/:tipo', req => {
    const { p, u } = delDueno(req)
    const tipo = req.params.tipo as TipoDocumento
    if (!TIPOS_DOCUMENTO.includes(tipo)) return fail(404, DOCUMENTO_NO_ENCONTRADO)
    const d = parse(subida, req.body)
    if (!(TIPOS_ARCHIVO as readonly string[]).includes(d.mime)) return fail(400, DOCUMENTO_INVALIDO)
    const bytes = desdeBase64(d.datos)
    if (!bytes) return fail(400, DOCUMENTO_INVALIDO)
    const motivo = revisarDocumento(bytes, d.mime)
    if (motivo) return fail(motivo === DOCUMENTO_PESADO ? 413 : 400, motivo)
    const faltabanAntes = documentosDe(p).faltan.length
    db.documentos = db.documentos.filter(x => !(x.pyme_id === p.id && x.tipo === tipo))
    db.documentos.push({
      id: uid(), pyme_id: p.id, tipo, nombre: nombreArchivo(d.nombre), mime: d.mime, bytes: bytes.length, estado: 'pendiente', motivo: null, subido_en: now(), revisado_en: null,
      datos: bytes.length <= MAX_BYTES_DOCUMENTO_DEMO ? d.datos : null, subido_por: u.id, revisado_por: null,
    })
    const vista = documentosDe(p)
    // El equipo se entera cuando un alta en revisión completa sus documentos, no con cada archivo.
    if (faltabanAntes > 0 && vista.faltan.length === 0 && p.estado_verificacion === 'pendiente') {
      const a = avisoDocumentosCompletos(p.nombre_comercial, p.rut_empresa)
      avisarAsesores(a.asunto, a.cuerpo)
    }
    return vista
  })

  on('GET', '/pymes/:id/documentos/:docId/archivo', req => {
    const { p } = delDueno(req)
    const d = db.documentos.find(x => x.id === req.params.docId && x.pyme_id === p.id)
    return d ? binario(d) : fail(404, DOCUMENTO_NO_ENCONTRADO)
  })

  on('GET', '/admin/pymes/:id/documentos', req => {
    auth(req, 'admin', 'asesor')
    const p = db.pymes.find(x => x.id === req.params.id && x.origen !== 'publica')
    return p ? documentosDe(p) : fail(404, 'Pyme no encontrada')
  })

  on('GET', '/admin/documentos/:docId/archivo', req => {
    auth(req, 'admin', 'asesor')
    const d = db.documentos.find(x => x.id === req.params.docId)
    return d ? binario(d) : fail(404, DOCUMENTO_NO_ENCONTRADO)
  })

  on('PATCH', '/admin/documentos/:docId', req => {
    const revisor = auth(req, 'admin', 'asesor')
    const d = parse(z.object({ decision: z.enum(['aprobar', 'rechazar']), motivo: z.string().trim().max(500).optional() })
      .refine(x => x.decision === 'aprobar' || (x.motivo ?? '').length >= 10, { message: 'Explica al negocio qué corregir (mínimo 10 caracteres)', path: ['motivo'] }), req.body)
    const doc = db.documentos.find(x => x.id === req.params.docId)
    const p = doc && db.pymes.find(x => x.id === doc.pyme_id)
    if (!doc || !p) return fail(404, DOCUMENTO_NO_ENCONTRADO)
    Object.assign(doc, { estado: d.decision === 'aprobar' ? 'aprobado' : 'rechazado', motivo: d.decision === 'rechazar' ? d.motivo : null, revisado_por: revisor.id, revisado_en: now() })
    if (d.decision === 'rechazar') {
      const c = correoDocumentoRechazado(p.nombre_comercial, DOCUMENTOS[doc.tipo].nombre, d.motivo!)
      enviarCorreo(db.usuarios.find(x => x.id === p.propietario_id)?.correo ?? '', c.asunto, c.cuerpo, 'aprobacion')
    }
    return documentosDe(p)
  })
}
