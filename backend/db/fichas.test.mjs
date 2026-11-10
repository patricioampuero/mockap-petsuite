// Fichas con información pública sobre PostgreSQL (PGlite): carga desde JSON sin duplicados, restricciones de la
// base (sin dueño, sin RUT, nunca validada) y cómo las muestra el API público.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier) && !context.parentURL?.includes('/node_modules/')) {
    return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
  }
  return nextResolve(specifier, context)
} })

const { createApi } = await import('../api/index.ts')
const { pgliteDatabase } = await import('../api/pglite.ts')
const { migrate } = await import('./migrate.mjs')
const { cargarFichas, quitarFicha } = await import('./cargar-fichas.mjs')

const datos = {
  fichas: [
    { nombre: 'Veterinaria Ejemplo Rahue', rubro: 'veterinaria', comuna: 'Osorno', direccion: 'Calle Ejemplo 100, Osorno', latitud: -40.574, longitud: -73.15, telefono: '+56642111111', fuente: 'https://ejemplo.test/veterinaria' },
    { nombre: 'VETERINARIA EJEMPLO RAHÚE', rubro: 'veterinaria', comuna: 'Osorno', direccion: 'Calle Ejemplo 100, Osorno', latitud: -40.574, longitud: -73.15, fuente: 'https://ejemplo.test/duplicada' },
    // Sin punto exacto: aparece en la lista sin pin y «Cómo llegar» usa la dirección escrita.
    { nombre: 'Pet Shop Ejemplo Angelmó', rubro: 'tienda', comuna: 'Puerto Montt', direccion: 'Avenida Ejemplo 200', whatsapp: '+56911111111', fuente: 'https://ejemplo.test/tienda' },
  ],
}

test('carga las fichas sin duplicar, primero en simulación', async () => {
  const { database, client } = await pgliteDatabase()
  try {
    await migrate(client, () => {})
    const silencio = { log: () => {} }
    assert.deepEqual(await cargarFichas(client, datos, silencio), { nuevas: 2, omitidas: 1 }, 'el mismo nombre con otras tildes o mayúsculas es el mismo negocio')
    assert.equal((await client.query('select 1 from pymes')).rows.length, 0, 'la simulación no escribe')
    assert.deepEqual(await cargarFichas(client, datos, { ...silencio, aplicar: true }), { nuevas: 2, omitidas: 1 })
    assert.deepEqual(await cargarFichas(client, datos, { ...silencio, aplicar: true }), { nuevas: 0, omitidas: 3 }, 'una segunda carga no repite')

    const { rows } = await client.query('select origen, estado_verificacion, propietario_id, rut_empresa, fuente from pymes order by nombre_comercial')
    assert.ok(rows.every(r => r.origen === 'publica' && r.estado_verificacion === 'pendiente' && r.propietario_id === null && r.rut_empresa === null && r.fuente))

    await assert.rejects(() => cargarFichas(client, { fichas: [{ ...datos.fichas[0], comuna: 'Santiago' }] }, silencio), /Comuna desconocida/)
    await assert.rejects(() => cargarFichas(client, { fichas: [{ ...datos.fichas[0], telefono: '642111111' }] }, silencio), /\+56/)
    await assert.rejects(() => cargarFichas(client, { fichas: [{ ...datos.fichas[0], nombre: 'Otra', longitud: null }] }, silencio), /van juntas/)
    const { rows: [sinPunto] } = await client.query("select latitud, longitud from pymes where nombre_comercial = 'Pet Shop Ejemplo Angelmó'")
    assert.deepEqual(sinPunto, { latitud: null, longitud: null })

    // El API la muestra en Explorar, sin datos de registro.
    const handle = createApi(database)
    const lista = await handle('GET', '/pymes', undefined, null)
    assert.equal(lista.length, 2)
    assert.ok(lista.every(p => p.sin_reclamar === true && !('rut_empresa' in p) && !('propietario_id' in p)))
    assert.equal((await handle('GET', `/pymes/${lista[0].id}`, undefined, null)).catalogo.length, 0)

    assert.equal(await quitarFicha(client, 'Pet Shop Ejemplo Angelmó', 'Puerto Montt'), 1)
    assert.equal((await handle('GET', '/pymes', undefined, null)).length, 1)
  } finally {
    await database.close()
  }
})

test('la base no deja una ficha pública con dueño, ni validada, ni un negocio inscrito sin RUT', async () => {
  const { database, client } = await pgliteDatabase()
  try {
    await migrate(client, () => {})
    const { rows: [u] } = await client.query("insert into usuarios (correo, clave_hash, rol, nombre_visible, estado) values ('duena@petsuite.test', 'x', 'pyme', 'Dueña', 'activo') returning id")
    const insertar = (campos, valores) => client.query(`insert into pymes (nombre_comercial, rubro, comuna_id, ${campos}) values ('Negocio', 'tienda', 1, ${valores.map((_, i) => `$${i + 1}`).join(', ')})`, valores)
    await assert.rejects(() => insertar('origen, fuente, propietario_id', ['publica', 'https://ejemplo.test', u.id]), /pymes_publica_con_fuente/)
    await assert.rejects(() => insertar('origen', ['publica']), /pymes_publica_con_fuente/)
    await assert.rejects(() => insertar('origen, fuente, estado_verificacion', ['publica', 'https://ejemplo.test', 'aprobada']), /pymes_publica_sin_validar/)
    await assert.rejects(() => insertar('propietario_id', [u.id]), /pymes_registro_completo/)
    await insertar('propietario_id, rut_empresa', [u.id, '76123456-7'])
  } finally {
    await database.close()
  }
})
