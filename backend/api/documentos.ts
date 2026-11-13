// Documentos de validación de los negocios (mismas reglas que src/mock/documentos.ts y src/shared/documentos.ts).
// Se guardan en la base y nunca se publican: solo los descargan el negocio y el equipo de PetSuite.
import { z } from 'zod'
import {
  avisoDocumentosCompletos, correoDocumentoRechazado, DOCUMENTO_INVALIDO, DOCUMENTO_NO_ENCONTRADO, DOCUMENTO_PESADO, DOCUMENTOS,
  nombreArchivo, revisarDocumento, TIPOS_ARCHIVO, TIPOS_DOCUMENTO, vistaDocumentos, type ArchivoDocumento, type TipoDocumento,
} from '../../src/shared/documentos'
import { desdeBase64 } from '../../src/shared/imagenes'
import { auth, avisarAsesores, correoDe, enviarCorreo, type Usuario } from './auth'
import { fail, idDe, now, on, parse, uid, una } from './core'
import type { Sql } from './db'
import { miPyme, PYME, type Pyme } from './negocio'

const ARCHIVO = 'id, tipo, nombre, mime, bytes, estado, motivo, subido_en, revisado_en'

export const documentosDe = async (sql: Sql, p: Pick<Pyme, 'id' | 'rut_empresa'>) =>
  vistaDocumentos(p.rut_empresa, await sql<ArchivoDocumento>(`select ${ARCHIVO} from documentos_pyme where pyme_id = $1`, [p.id]))

/** Al aprobar el alta, los documentos que esperaban revisión quedan aprobados por quien aprobó. */
export const aprobarDocumentos = (sql: Sql, p: Pick<Pyme, 'id'>, revisor: Usuario) =>
  sql("update documentos_pyme set estado = 'aprobado', revisado_por = $2, revisado_en = $3 where pyme_id = $1 and estado = 'pendiente'", [p.id, revisor.id, now()])

const subida = z.object({
  nombre: z.string().trim().min(1, 'Falta el nombre del archivo').max(200),
  mime: z.string().max(40),
  // El cuerpo HTTP ya limita a 3 MB; el tamaño real del archivo lo revisa revisarDocumento (413).
  datos: z.string().max(3_000_000, DOCUMENTO_PESADO),
})

async function binario(sql: Sql, condicion: string, params: unknown[]) {
  const d = await una<{ mime: string; nombre: string; datos: string }>(sql, `select mime, nombre, encode(datos, 'base64') as datos from documentos_pyme where ${condicion}`, params)
  if (!d) return fail(404, DOCUMENTO_NO_ENCONTRADO)
  return { __binario: true, privado: true, tipo: d.mime, base64: d.datos.replace(/\s/g, ''), nombre: d.nombre }
}

on('GET', '/pymes/:id/documentos', async req => documentosDe(req.sql, await miPyme(req, 'perfil')))

// Un documento por tipo: subir otro reemplaza al anterior y vuelve a revisión.
on('PUT', '/pymes/:id/documentos/:tipo', async req => {
  const p = await miPyme(req, 'perfil'), u = await auth(req)
  const tipo = req.params.tipo as TipoDocumento
  if (!TIPOS_DOCUMENTO.includes(tipo)) return fail(404, DOCUMENTO_NO_ENCONTRADO)
  const d = parse(subida, req.body)
  if (!(TIPOS_ARCHIVO as readonly string[]).includes(d.mime)) return fail(400, DOCUMENTO_INVALIDO)
  const bytes = desdeBase64(d.datos)
  if (!bytes) return fail(400, DOCUMENTO_INVALIDO)
  const motivo = revisarDocumento(bytes, d.mime)
  if (motivo) return fail(motivo === DOCUMENTO_PESADO ? 413 : 400, motivo)
  const faltabanAntes = (await documentosDe(req.sql, p)).faltan.length
  await req.sql(`insert into documentos_pyme (id, pyme_id, tipo, nombre, mime, datos, bytes, estado, motivo, subido_por, subido_en, revisado_por, revisado_en)
    values ($1, $2, $3, $4, $5, decode($6, 'base64'), $7, 'pendiente', null, $8, $9, null, null)
    on conflict (pyme_id, tipo) do update set id = excluded.id, nombre = excluded.nombre, mime = excluded.mime, datos = excluded.datos, bytes = excluded.bytes,
      estado = 'pendiente', motivo = null, subido_por = excluded.subido_por, subido_en = excluded.subido_en, revisado_por = null, revisado_en = null`,
  [uid(), p.id, tipo, nombreArchivo(d.nombre), d.mime, d.datos, bytes.length, u.id, now()])
  const vista = await documentosDe(req.sql, p)
  // El equipo se entera cuando un alta en revisión completa sus documentos, no con cada archivo.
  if (faltabanAntes > 0 && vista.faltan.length === 0 && p.estado_verificacion === 'pendiente') {
    const a = avisoDocumentosCompletos(p.nombre_comercial, p.rut_empresa)
    await avisarAsesores(req.sql, a.asunto, a.cuerpo)
  }
  return vista
})

on('GET', '/pymes/:id/documentos/:docId/archivo', async req => {
  const p = await miPyme(req, 'perfil')
  return binario(req.sql, 'id = $1 and pyme_id = $2', [idDe(req.params.docId), p.id])
})

on('GET', '/admin/pymes/:id/documentos', async req => {
  await auth(req, 'admin', 'asesor')
  const p = await una<Pyme>(req.sql, `select ${PYME} from pymes p where p.id = $1 and p.origen <> 'publica'`, [idDe(req.params.id)])
  return p ? documentosDe(req.sql, p) : fail(404, 'Pyme no encontrada')
})

on('GET', '/admin/documentos/:docId/archivo', async req => {
  await auth(req, 'admin', 'asesor')
  return binario(req.sql, 'id = $1', [idDe(req.params.docId)])
})

on('PATCH', '/admin/documentos/:docId', async req => {
  const revisor = await auth(req, 'admin', 'asesor')
  const d = parse(z.object({ decision: z.enum(['aprobar', 'rechazar']), motivo: z.string().trim().max(500).optional() })
    .refine(x => x.decision === 'aprobar' || (x.motivo ?? '').length >= 10, { message: 'Explica al negocio qué corregir (mínimo 10 caracteres)', path: ['motivo'] }), req.body)
  const doc = await una<{ pyme_id: string; tipo: TipoDocumento }>(req.sql, `update documentos_pyme set estado = $2, motivo = $3, revisado_por = $4, revisado_en = $5 where id = $1 returning pyme_id, tipo`,
    [idDe(req.params.docId), d.decision === 'aprobar' ? 'aprobado' : 'rechazado', d.decision === 'rechazar' ? d.motivo : null, revisor.id, now()])
  const p = doc && await una<Pyme>(req.sql, `select ${PYME} from pymes p where p.id = $1`, [doc.pyme_id])
  if (!doc || !p) return fail(404, DOCUMENTO_NO_ENCONTRADO)
  if (d.decision === 'rechazar') {
    const c = correoDocumentoRechazado(p.nombre_comercial, DOCUMENTOS[doc.tipo].nombre, d.motivo!)
    await enviarCorreo(req.sql, await correoDe(req.sql, p.propietario_id), c.asunto, c.cuerpo, 'aprobacion')
  }
  return documentosDe(req.sql, p)
})
