import test from 'node:test'
import assert from 'node:assert/strict'
import { buscar, coincidencia, filtrosDesdeHash, hashExplorar, normalizar, patrocinados } from './explore-search.ts'

const negocio = (id, nombre, rubro, servicios, extra = {}) => ({ id, nombre_comercial: nombre, rubro, descripcion: null, comuna: 'Osorno', direccion: null, latitud: null, longitud: null, telefono: null, whatsapp: null, horario: {}, servicios, destacado: 0, sucursales: [], cupones: [], ...extra })
const pymes = [
  negocio('vet', 'Clínica Veterinaria Sur', 'veterinaria', ['Consulta general', 'Vacunación'], { destacado: 2 }),
  negocio('tienda', 'Huellitas Osorno', 'tienda', ['Despacho a domicilio'], { destacado: 1, sucursales: [{ id: 's1', nombre: 'Huellitas Puerto Montt', comuna: 'Puerto Montt', direccion: null, latitud: null, longitud: null, telefono: null, whatsapp: null, horario: {}, descripcion: null, servicios: [] }] }),
  negocio('pelu', 'Peluquería Canina Patagonia', 'peluqueria', ['Baño', 'Corte de uñas'], { comuna: 'Puerto Montt' }),
  negocio('pelu2', 'Aseo Animal', 'peluqueria', ['Baño']),
]
const ids = rows => rows.map(p => p.id)
const todo = { q: '', comuna: '', rubro: '', ofertas: false }

test('ignora tildes y mayúsculas', () => {
  assert.equal(normalizar('Peluquería  CANINA'), 'peluqueria canina')
  assert.deepEqual(ids(buscar(pymes, { ...todo, q: 'VACUNACION' })), ['vet'])
})

test('entiende sinónimos y palabras incompletas', () => {
  assert.deepEqual(ids(buscar(pymes, { ...todo, q: 'lavado' })).sort(), ['pelu', 'pelu2'])
  assert.deepEqual(ids(buscar(pymes, { ...todo, q: 'vacu' })), ['vet'])
  assert.deepEqual(ids(buscar(pymes, { ...todo, q: 'corte de uñas' })), ['pelu'])
  assert.deepEqual(ids(buscar(pymes, { ...todo, q: 'paseador' })), [])
})

test('el plan no cambia el orden normal; solo define los patrocinados', () => {
  // Con la misma coincidencia, el orden es alfabético aunque Huellitas y la clínica paguen un plan.
  assert.deepEqual(ids(buscar(pymes, todo)), ['pelu2', 'vet', 'tienda', 'pelu'])
  assert.deepEqual(ids(patrocinados(buscar(pymes, todo))), ['vet', 'tienda'])
  assert.deepEqual(ids(patrocinados(buscar(pymes, { ...todo, rubro: 'peluqueria' }))), [])
})

test('la comuna incluye negocios con una sucursal en ella', () => {
  assert.deepEqual(ids(buscar(pymes, { ...todo, comuna: 'Puerto Montt' })).sort(), ['pelu', 'tienda'])
})

test('la búsqueda se puede compartir en la dirección', () => {
  const hash = hashExplorar({ q: 'baño perro', comuna: 'Puerto Montt', ofertas: true })
  assert.match(hash, /^#explorar\?/)
  assert.deepEqual(filtrosDesdeHash(hash), { q: 'baño perro', comuna: 'Puerto Montt', rubro: '', ofertas: true })
  assert.equal(hashExplorar({}), '#explorar')
})

test('explica con qué servicio coincide un negocio que no lo dice en su nombre', () => {
  const clinica = negocio('vet2', 'Clínica Veterinaria Sur', 'veterinaria', ['Consulta general'], { sucursales: [{ id: 's2', nombre: 'Sucursal Rahue', comuna: 'Osorno', direccion: null, latitud: null, longitud: null, telefono: null, whatsapp: null, horario: {}, descripcion: null, servicios: ['Consulta general', 'Peluquería clínica'] }] })
  assert.deepEqual(ids(buscar([clinica], { ...todo, q: 'cortes' })), ['vet2'], '«corte» es sinónimo de peluquería')
  assert.equal(coincidencia(clinica, 'cortes'), 'Peluquería clínica (Sucursal Rahue)')
  assert.equal(coincidencia(pymes[2], 'corte de uñas'), 'Corte de uñas')
  assert.equal(coincidencia(pymes[2], 'peluqueria'), null, 'si está en el nombre o el rubro no hace falta explicarlo')
  assert.equal(coincidencia(pymes[0], ''), null)
})