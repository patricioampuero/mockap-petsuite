// Alta de negocios y solicitudes de plan en la versión real (sin Orcob simulado), sobre PGlite con los datos demo:
// Orcob se rechaza, nadie puede confirmar un pago Orcob, la Pyme recibe cómo transferir y el equipo recibe el aviso
// (los asesores o, si no hay, los administradores).
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier) && !context.parentURL?.includes('/node_modules/')) {
    return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
  }
  return nextResolve(specifier, context)
} })

const values = new Map()
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }

const mockDb = await import('../../src/mock/db.ts')
const { createApi } = await import('./index.ts')
const { pgliteDatabase } = await import('./pglite.ts')
const { migrate } = await import('../db/migrate.mjs')
const { cargarDemo } = await import('../db/seed.mjs')
const { ORCOB_NO_DISPONIBLE, SOLO_ORCOB_CONFIRMA } = await import('../../src/shared/pagos.ts')

const sesion = r => ({ token: r.token, id: r.usuario.id, rol: r.usuario.rol, nombre: r.usuario.nombre_visible, comunaId: r.usuario.comuna_id })
const error = promesa => promesa.then(() => null, e => ({ status: e.status, message: e.message }))

test('sin Orcob simulado: el alta y el cambio de plan van por transferencia y avisan al equipo', async () => {
  delete process.env.ORCOB_SIMULADO
  mockDb.resetDemo()
  const { database, client } = await pgliteDatabase()
  try {
    await migrate(client, () => {})
    await cargarDemo(client, structuredClone(mockDb.db), { log: () => {} })
    const handle = createApi(database)
    // Base real recién creada: sin asesores, los avisos van a los administradores.
    await client.query("update usuarios set estado = 'suspendido' where rol = 'asesor'")

    // Cuenta de Pyme nueva, confirmada con su enlace.
    await handle('POST', '/auth/registro', { correo: 'nueva@pyme.test', clave: 'secreta123', nombre_visible: 'Nueva Pyme', comuna_id: 1, rol: 'pyme', acepta_terminos: true, acepta_privacidad: true }, null)
    const { rows: [enlace] } = await client.query("select cuerpo from correos where para = 'nueva@pyme.test'")
    const pyme = sesion(await handle('POST', '/auth/verificar', { token: /#verificar\/([0-9a-f]{32})/.exec(enlace.cuerpo)[1] }, null))

    const alta = { nombre_comercial: 'Veterinaria Nueva', rut_empresa: '76111999-2', rubro: 'veterinaria', comuna_id: 1, plan_id: 4 }
    assert.deepEqual(await error(handle('POST', '/pymes', { ...alta, canal_pago: 'orcob' }, pyme)), { status: 422, message: ORCOB_NO_DISPONIBLE })
    const r = await handle('POST', '/pymes', { ...alta, canal_pago: 'transferencia' }, pyme)
    assert.equal(r.estado_verificacion, 'pendiente', 'sin referencia también se puede enviar: el asesor confirma el pago')

    const { rows: correos } = await client.query("select c.para, c.asunto, c.cuerpo from correos c where c.asunto like '%Veterinaria Nueva%' or c.asunto like 'Recibimos tu solicitud%' order by c.enviado_en")
    const admins = (await client.query("select correo from usuarios where rol = 'admin' and estado = 'activo'")).rows.map(x => x.correo)
    assert.ok(admins.length && correos.some(c => admins.includes(c.para) && c.asunto === 'Negocio por verificar: Veterinaria Nueva'), 'sin asesores, el aviso llega al administrador')
    const instrucciones = correos.find(c => c.para === 'nueva@pyme.test')
    assert.ok(instrucciones && /transfiere el primer mes/.test(instrucciones.cuerpo) && /\$25\.000/.test(instrucciones.cuerpo), 'la Pyme recibe el monto y cómo pagar')

    // Una Pyme ya validada no puede usar Orcob ni confirmar un pago Orcob por su cuenta.
    const vet = sesion(await handle('POST', '/auth/login', { correo: 'veterinaria@petsuite.cl', clave: 'petsuite123' }, null))
    const [{ id: vetId }] = await handle('GET', '/pymes/mias', undefined, vet)
    assert.deepEqual(await error(handle('POST', `/pymes/${vetId}/suscripcion`, { plan_id: 3, canal: 'orcob' }, vet)), { status: 422, message: ORCOB_NO_DISPONIBLE })
    const { rows: [pago] } = await client.query("select pg.id from pagos pg join suscripciones s on s.id = pg.suscripcion_id where s.pyme_id = $1 limit 1", [vetId])
    assert.deepEqual(await error(handle('POST', `/pymes/${vetId}/pagos/${pago.id}/orcob-confirmado`, undefined, vet)), { status: 403, message: SOLO_ORCOB_CONFIRMA })
  } finally {
    await database.close()
  }
})
