// Fotos subidas por los usuarios (reglas en src/shared/imagenes.ts, iguales a las del mock).
// Se guardan en la base; GET /imagenes/:id las entrega como archivo (backend/http.mjs) con caché larga.
import { z } from 'zod'
import { desdeBase64, IMAGEN_AJENA, IMAGEN_INVALIDA, IMAGEN_PESADA, IMAGENES_AGOTADAS, idDeUrlImagen, MAX_IMAGENES_POR_USUARIO, revisarImagen, urlImagen } from '../../src/shared/imagenes'
import { auth } from './auth'
import { contar, fail, hace, idDe, now, on, parse, uid, una } from './core'
import type { Sql } from './db'

// Una foto está en uso mientras alguna fila la muestre. `url` es una expresión SQL con la dirección de la foto.
const enUso = (url: string) => `(exists (select 1 from publicaciones x where x.foto_url = ${url})
  or exists (select 1 from mascotas x where x.foto_url = ${url}) or exists (select 1 from animales x where x.foto_url = ${url})
  or exists (select 1 from items_catalogo x where x.foto_url = ${url}) or exists (select 1 from pymes x where x.foto_portada = ${url})
  or exists (select 1 from ongs x where x.perfil_borrador->>'foto_portada' = ${url} or x.perfil_publicado->>'foto_portada' = ${url}))`

/** La dirección de una foto subida por el usuario; 404 si no existe o es de otra persona. */
export async function fotoPropia(sql: Sql, imagenId: string, duenoId: string): Promise<string> {
  const i = await una<{ id: string }>(sql, 'select id from imagenes where id = $1 and dueno_id = $2', [idDe(imagenId), duenoId])
  if (!i) return fail(404, IMAGEN_AJENA)
  return urlImagen(i.id)
}

/** Borra la foto del usuario si ya nada la muestra (la foto anterior de una mascota, de un animal o de un producto). */
export async function liberarImagen(sql: Sql, url: string | null, duenoId: string) {
  const id = idDeUrlImagen(url)
  if (id) await sql(`delete from imagenes where id = $1 and dueno_id = $2 and not ${enUso('$3::text')}`, [id, duenoId, url])
}

on('POST', '/imagenes', async req => {
  const u = await auth(req)
  const d = parse(z.object({ datos: z.string().max(900_000, IMAGEN_PESADA), tipo: z.string().max(40) }), req.body)
  const bytes = desdeBase64(d.datos)
  if (!bytes) return fail(400, IMAGEN_INVALIDA)
  const motivo = revisarImagen(bytes, d.tipo)
  if (motivo) return fail(motivo === IMAGEN_PESADA ? 413 : 400, motivo)
  // Una foto elegida en un formulario que nunca se guardó deja de contar para el límite al día siguiente.
  await req.sql(`delete from imagenes i where i.dueno_id = $1 and i.creado_en < $2 and not ${enUso("('/api/v1/imagenes/' || i.id::text)")}`, [u.id, hace(1)])
  if (await contar(req.sql, 'select count(*) as n from imagenes where dueno_id = $1', [u.id]) >= MAX_IMAGENES_POR_USUARIO) return fail(422, IMAGENES_AGOTADAS)
  const id = uid()
  await req.sql("insert into imagenes (id, dueno_id, tipo, datos, bytes, creado_en) values ($1, $2, $3, decode($4, 'base64'), $5, $6)", [id, u.id, d.tipo, d.datos, bytes.length, now()])
  return { id, url: urlImagen(id) }
})

// Pública: la foto de la mascota aparece en su ficha QR. El id es aleatorio y no se puede adivinar.
on('GET', '/imagenes/:id', async req => {
  const i = await una<{ tipo: string; datos: string }>(req.sql, "select tipo, encode(datos, 'base64') as datos from imagenes where id = $1", [idDe(req.params.id)])
  if (!i) return fail(404, 'Foto no encontrada')
  return { __binario: true, tipo: i.tipo, base64: i.datos.replace(/\s/g, '') }
})
