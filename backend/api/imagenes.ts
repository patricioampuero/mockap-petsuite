// Fotos subidas por los usuarios (reglas en src/shared/imagenes.ts, iguales a las del mock).
// Se guardan en la base; GET /imagenes/:id las entrega como archivo (backend/http.mjs) con caché larga.
import { z } from 'zod'
import { desdeBase64, IMAGEN_INVALIDA, IMAGEN_PESADA, IMAGENES_AGOTADAS, MAX_IMAGENES_POR_USUARIO, revisarImagen, urlImagen } from '../../src/shared/imagenes'
import { auth } from './auth'
import { contar, fail, idDe, now, on, parse, uid, una } from './core'

on('POST', '/imagenes', async req => {
  const u = await auth(req)
  const d = parse(z.object({ datos: z.string().max(900_000, IMAGEN_PESADA), tipo: z.string().max(40) }), req.body)
  const bytes = desdeBase64(d.datos)
  if (!bytes) return fail(400, IMAGEN_INVALIDA)
  const motivo = revisarImagen(bytes, d.tipo)
  if (motivo) return fail(motivo === IMAGEN_PESADA ? 413 : 400, motivo)
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
