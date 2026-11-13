// Documentos de validación sobre el servidor HTTP con PostgreSQL (PGlite): un PDF de hasta 2 MB entra (el cuerpo
// puede pasar del límite general de 1 MB solo en esa ruta), se descarga como adjunto privado y sin caché, y nadie
// más que el negocio y el equipo de PetSuite puede bajarlo. También las reglas compartidas de src/shared/documentos.ts.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createApiServer } from '../server.mjs'

const values = new Map()
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }

const { pgliteDatabase } = await import('./pglite.ts')
const { migrate } = await import('../db/migrate.mjs')
const { seedDemo } = await import('../db/seed.mjs')
const { esRutEmpresa, revisarDocumento, vistaDocumentos, nombreArchivo, MAX_BYTES_DOCUMENTO, DOCUMENTO_PESADO, DOCUMENTO_INVALIDO } = await import('../../src/shared/documentos.ts')

const pdf = (relleno = 0) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(relleno, 0x20), Buffer.from('\n%%EOF\n')])

test('reglas compartidas: RUT de empresa, firma del archivo, faltantes y nombre seguro', () => {
  assert.equal(esRutEmpresa('76123456-7'), true)
  assert.equal(esRutEmpresa('12345678-5'), false)
  assert.equal(esRutEmpresa(null), false)
  assert.equal(revisarDocumento(pdf(), 'application/pdf'), null)
  assert.equal(revisarDocumento(pdf(), 'image/png'), DOCUMENTO_INVALIDO, 'el tipo declarado debe coincidir con la firma real')
  assert.equal(revisarDocumento(pdf(MAX_BYTES_DOCUMENTO), 'application/pdf'), DOCUMENTO_PESADO)
  assert.deepEqual(vistaDocumentos('12345678-5', []).faltan, ['Patente comercial', 'Resolución sanitaria'])
  assert.deepEqual(vistaDocumentos('76123456-7', []).faltan, ['Patente comercial', 'Resolución sanitaria', 'Constitución de la sociedad'])
  const rechazada = { id: 'x', tipo: 'patente_comercial', nombre: 'p.pdf', mime: 'application/pdf', bytes: 10, estado: 'rechazado', motivo: 'vencida', subido_en: '', revisado_en: '' }
  assert.deepEqual(vistaDocumentos('12345678-5', [rechazada]).faltan, ['Patente comercial', 'Resolución sanitaria'], 'un documento rechazado cuenta como faltante')
  assert.equal(nombreArchivo('C:\\fakepath\\patente "2026".pdf'), 'patente 2026.pdf')
})

test('el negocio sube un PDF grande, lo descarga como adjunto privado y nadie más puede bajarlo', async () => {
  const { database, client } = await pgliteDatabase()
  await migrate(client, () => {})
  await seedDemo(client, { log: () => {} })
  const server = await createApiServer({ database, origins: 'http://localhost:5173' })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (path, { method = 'GET', token, body } = {}) => {
    const r = await fetch(`${base}/api/v1${path}`, { method, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body && { 'Content-Type': 'application/json' }) }, ...(body && { body: JSON.stringify(body) }) })
    return { status: r.status, data: await r.json().catch(() => null) }
  }
  const login = async correo => (await call('/auth/login', { method: 'POST', body: { correo, clave: 'petsuite123' } })).data.token
  try {
    const tienda = await login('tienda@petsuite.cl'), asesor = await login('asesor@petsuite.cl'), tutor = await login('tutor@petsuite.cl')
    const [pyme] = (await call('/pymes/mias', { token: tienda })).data

    // 1,5 MB: más que el límite general del cuerpo (1 MB), dentro del máximo de un documento.
    const grande = pdf(1_500_000)
    const subida = await call(`/pymes/${pyme.id}/documentos/patente_comercial`, { method: 'PUT', token: tienda, body: { nombre: 'patente.pdf', mime: 'application/pdf', datos: grande.toString('base64') } })
    assert.equal(subida.status, 200)
    const archivo = subida.data.documentos.find(d => d.tipo === 'patente_comercial').archivo
    assert.equal(archivo.bytes, grande.length)
    assert.equal(archivo.estado, 'pendiente')

    // Más de 2 MB: rechazado antes de llegar a la base. El límite general sigue rigiendo en las demás rutas.
    assert.equal((await call(`/pymes/${pyme.id}/documentos/patente_comercial`, { method: 'PUT', token: tienda, body: { nombre: 'p.pdf', mime: 'application/pdf', datos: pdf(2_100_000).toString('base64') } })).status, 413)
    assert.equal((await call('/imagenes', { method: 'POST', token: tienda, body: { datos: 'A'.repeat(1_100_000), tipo: 'image/jpeg' } })).status, 413)

    for (const [ruta, token] of [[`/pymes/${pyme.id}/documentos/${archivo.id}/archivo`, tienda], [`/admin/documentos/${archivo.id}/archivo`, asesor]]) {
      const r = await fetch(`${base}/api/v1${ruta}`, { headers: { Authorization: `Bearer ${token}` } })
      assert.equal(r.status, 200)
      assert.equal(r.headers.get('content-type'), 'application/pdf')
      assert.equal(r.headers.get('cache-control'), 'private, no-store')
      assert.match(r.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''patente\.pdf$/)
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), grande)
    }
    // Sin sesión o con otra cuenta, no.
    assert.equal((await fetch(`${base}/api/v1/admin/documentos/${archivo.id}/archivo`)).status, 401)
    assert.equal((await fetch(`${base}/api/v1/admin/documentos/${archivo.id}/archivo`, { headers: { Authorization: `Bearer ${tutor}` } })).status, 403)
    assert.equal((await client.query('select count(*)::int as n from documentos_pyme')).rows[0].n, 1)
  } finally {
    await new Promise(resolve => server.close(resolve))
    await database.close()
  }
})
