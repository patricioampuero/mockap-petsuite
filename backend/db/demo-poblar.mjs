// Datos de demostración abundantes para la versión real: tutores con sus mascotas, negocios, ONG con animales en
// adopción, publicaciones del muro con comentarios y apoyos, consultas, convenios con canjes y banners.
// Agrega filas a la demo del mock (misma forma que src/mock/db.ts) antes de cargarla; las fotos se guardan en la
// tabla imagenes, como si cada persona las hubiera subido, y se muestran con /api/v1/imagenes/<id>.
// Todo es ficticio y determinista: cada carga produce el mismo contenido (con otros ids).
import { readFileSync } from 'node:fs'
import { DOMINIO_DEMO } from '../../src/shared/demo.ts'

const FOTOS = new URL('./demo-fotos/', import.meta.url)
const DIA = 86_400_000
const uid = () => crypto.randomUUID()
const ficha = (d = {}) => ({ condiciones: [], medicamentos: [], notaEmergencia: '', vacunas: [], alergias: [], tratamientos: [], atenciones: [], alertasCriticas: [], ...d })
const dayOffset = dias => new Date(Date.now() + dias * DIA).toISOString().slice(0, 10)
// Hace `dias` días, a una hora de Chile (UTC-3), con minutos variados.
const hace = (dias, hora = 12, minuto = 0) => { const d = new Date(Date.now() - dias * DIA); d.setUTCHours(hora + 3, minuto, 0, 0); return (d.getTime() > Date.now() ? new Date(Date.now() - 60_000) : d).toISOString() }
const sinTildes = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Coordenadas aproximadas del centro de cada comuna (para el mapa de Explorar).
const COMUNAS = { 1: [-40.5740, -73.1330], 2: [-41.4690, -72.9420], 3: [-42.4800, -73.7620], 5: [-40.9100, -73.1660], 10: [-41.7730, -73.1310], 13: [-41.1270, -73.0490], 14: [-41.2580, -73.0070], 17: [-41.3190, -72.9850], 18: [-41.8660, -73.8280], 24: [-43.1160, -73.6160] }

export function poblarDemo(db) {
  let semilla = 11
  const azar = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647 }
  const elegir = lista => lista[Math.floor(azar() * lista.length)]
  const consentimientos = fecha => ['terminos', 'privacidad', 'comunicaciones', 'metricas'].map(tipo => ({ tipo, otorgado: tipo !== 'comunicaciones' || azar() < 0.5, version: db.usuarios[0]?.consentimientos?.[0]?.version ?? '2026-10', fecha }))

  // Foto guardada en la base, de quien la usa. La misma foto de la misma persona se guarda una sola vez.
  const fotos = new Map()
  const foto = (archivo, duenoId) => {
    const clave = `${archivo}|${duenoId}`
    if (fotos.has(clave)) return fotos.get(clave)
    const datos = readFileSync(new URL(`${archivo}.jpg`, FOTOS))
    const id = uid()
    db.imagenes.push({ id, dueno_id: duenoId, tipo: 'image/jpeg', datos: datos.toString('base64'), bytes: datos.length, creado_en: hace(40) })
    fotos.set(clave, `/api/v1/imagenes/${id}`)
    return fotos.get(clave)
  }
  const usuario = (nombre, rol, comuna, correo = null) => {
    const creado = hace(30 + Math.floor(azar() * 60), 10)
    const u = { id: uid(), correo: correo ?? `${sinTildes(nombre).replace(/[^a-z]+/g, '.')}@${DOMINIO_DEMO}`, clave: '-', rol, nombre_visible: nombre, comuna_id: comuna, estado: 'activo', consentimientos: consentimientos(creado), creado_en: creado, correo_verificado_en: creado }
    db.usuarios.push(u)
    return u
  }

  // ---------- Tutores y mascotas ----------
  const TUTORES = [
    ['Camila Fuentes', 1, [['Rocco', 'perro', 'Golden retriever', 'macho', 'golden-sonrie', { vacunas: [['Antirrábica', -120]], alergias: [] }]]],
    ['Joaquín Herrera', 1, [['Mía', 'gato', 'Mestiza', 'hembra', 'gato-naranjo', {}], ['Simón', 'perro', 'Corgi', 'macho', 'corgi', { vacunas: [['Óctuple', -60]] }]]],
    ['Valentina Rojas', 2, [['Thor', 'perro', 'Pastor alemán', 'macho', 'pastor-aleman', { alergias: [['Pulgas', 'Dermatitis', 'moderada']] }]]],
    ['Matías Vargas', 2, [['Kira', 'perro', 'Husky siberiano', 'hembra', 'husky-cachorro', { vacunas: [['Óctuple', -20]] }]]],
    ['Fernanda Soto', 17, [['Lola', 'perro', 'Caniche', 'hembra', 'caniche-cafe', {}], ['Michi', 'gato', 'Atigrado', 'macho', 'gato-atigrado-2', { condiciones: ['Hipertiroidismo'] }]]],
    ['Benjamín Muñoz', 17, [['Max', 'perro', 'Labrador', 'macho', 'labrador-silla', { vacunas: [['Antirrábica', -200]] }]]],
    ['Antonia Díaz', 13, [['Nala', 'gato', 'Mestiza', 'hembra', 'gato-canasto', {}]]],
    ['Tomás Castillo', 13, [['Pancho', 'perro', 'Border collie', 'macho', 'border-pelota', { vacunas: [['Óctuple', -90]] }]]],
    ['Isidora Morales', 3, [['Pelusa', 'perro', 'Pomerania', 'hembra', 'pomerania', { alergias: [['Pollo', 'Vómitos', 'leve']] }]]],
    ['Felipe Navarro', 3, [['Toby', 'perro', 'Shih tzu', 'macho', 'shih-tzu', {}]]],
    ['Martina Silva', 18, [['Coco', 'perro', 'Cocker spaniel', 'macho', 'cocker-bosque', { condiciones: ['Otitis recurrente'] }], ['Pipa', 'gato', 'Tricolor', 'hembra', 'gatita-tricolor', {}]]],
    ['Sebastián Torres', 14, [['Zeus', 'perro', 'Rottweiler', 'macho', 'rottweiler-cachorro', { vacunas: [['Óctuple', -15]] }]]],
    ['Catalina Pérez', 1, [['Frida', 'perro', 'Pug', 'hembra', 'pug', { condiciones: ['Braquicefálica: evitar calor y ejercicio intenso'] }]]],
    ['Nicolás Espinoza', 5, [['Rayo', 'perro', 'Border collie', 'macho', 'border-collie', {}]]],
    ['Josefa Reyes', 2, [['Oliver', 'gato', 'Gris', 'macho', 'gatito-gris', {}], ['Sasha', 'gato', 'Mestiza', 'hembra', 'gato-ojos-verdes', { alergias: [['Pescado', 'Picazón', 'leve']] }]]],
    ['Ignacio Contreras', 10, [['Chispa', 'perro', 'Shiba inu', 'hembra', 'shiba', {}]]],
    ['Florencia Sepúlveda', 17, [['Milo', 'perro', 'Cavalier King Charles', 'macho', 'cavalier', { condiciones: ['Soplo cardíaco leve'], medicamentos: ['Pimobendán 2,5 mg'] }]]],
    ['Vicente Gallardo', 1, [['Kiara', 'perro', 'Labrador', 'hembra', 'labrador-nieve', { vacunas: [['Antirrábica', -30]] }]]],
    ['Agustina Cárcamo', 24, [['Misha', 'gato', 'Mestiza', 'hembra', 'gato-panuelo', {}]]],
    ['Cristóbal Oyarzún', 18, [['Negro', 'perro', 'Mestizo', 'macho', 'perro-mestizo', {}]]],
    ['Daniela Barrientos', 3, [['Gaspar', 'gato', 'Atigrado', 'macho', 'gato-arbol', {}]]],
    ['Gabriel Alarcón', 2, [['Lucas', 'perro', 'Golden retriever', 'macho', 'golden-plaza', { vacunas: [['Óctuple', -45]] }]]],
  ]
  const tutores = [], mascotas = {}
  for (const [nombre, comuna, mascotasDe] of TUTORES) {
    const u = usuario(nombre, 'tutor', comuna)
    tutores.push(u)
    for (const [mn, especie, raza, sexo, archivo, salud] of mascotasDe) {
      const m = {
        id: uid(), tutor_id: u.id, nombre: mn, especie, raza, sexo, fecha_nacimiento: dayOffset(-365 * (1 + Math.floor(azar() * 8)) - Math.floor(azar() * 200)), foto_url: foto(archivo, u.id), ficha_version: 1, creado_en: hace(25, 11),
        datos_clinicos: ficha({
          vacunas: (salud.vacunas ?? []).map(([n, d]) => ({ id: uid(), nombre: n, fecha: dayOffset(d), proxima: dayOffset(d + 365) })),
          alergias: (salud.alergias ?? []).map(([agente, reaccion, gravedad]) => ({ agente, reaccion, gravedad })),
          condiciones: salud.condiciones ?? [], medicamentos: salud.medicamentos ?? [],
          notaEmergencia: azar() < 0.4 ? 'Es asustadizo: acércate despacio y con voz tranquila.' : '',
        }),
      }
      db.mascotas.push(m)
      db.medallas.push({ id: uid(), mascota_id: m.id, token: uid().replace(/-/g, ''), estado: 'activa', emitida_en: hace(20, 15) })
      mascotas[mn] = m
    }
  }
  const tutor = nombre => tutores.find(t => t.nombre_visible === nombre)
  const deComuna = (comuna, excepto) => tutores.filter(t => t.comuna_id === comuna && t.id !== excepto?.id)

  // Una medalla escaneada con avisos: Thor se perdió en Puerto Montt.
  const medallaThor = db.medallas.find(md => md.mascota_id === mascotas.Thor.id)
  for (const d of [2, 1, 1]) db.escaneos.push({ id: uid(), medalla_id: medallaThor.id, ocurrido_en: hace(d, 18, Math.floor(azar() * 59)) })
  db.mensajes.push(
    { id: uid(), medalla_id: medallaThor.id, remitente_nombre: 'Rosa', remitente_contacto: 'Por este medio', mensaje: 'Vi a Thor cerca de la costanera, iba hacia Angelmó. Parecía asustado pero bien.', latitud: '-41.4805', longitud: '-72.9530', estado: 'leido', enviado_en: hace(1, 19, 10) },
    { id: uid(), medalla_id: medallaThor.id, remitente_nombre: null, remitente_contacto: null, mensaje: 'Un perro como el de la foto está en la plaza de Pelluco, alguien le dio agua.', latitud: null, longitud: null, estado: 'nuevo', enviado_en: hace(0, 9, 40) },
  )

  // ---------- Negocios ----------
  const NEGOCIOS = [
    ['Paola Andrade', 'Veterinaria Volcán', 'veterinaria', 17, 'Avenida Gramado 820, Puerto Varas', 4, 'vet-pastor', ['Consulta general', 'Vacunación', 'Cirugía', 'Ecografía', 'Urgencias 24 h'],
      [['servicio', 'Consulta general', 'Servicios', 18000, null, 'vet-pastor'], ['servicio', 'Vacuna óctuple', 'Vacunas', 15000, null], ['servicio', 'Desparasitación interna y externa', 'Servicios', 9000, 7500], ['servicio', 'Ecografía abdominal', 'Exámenes', 35000, null], ['servicio', 'Esterilización (perro mediano)', 'Cirugía', 95000, null]],
      'Atención veterinaria integral en Puerto Varas, con urgencias las 24 horas y cirugía mínimamente invasiva.'],
    ['Rodrigo Ulloa', 'Clínica Animal Chiloé', 'veterinaria', 3, 'Calle Blanco 455, Castro', 3, 'vet-gato', ['Consulta general', 'Vacunación', 'Medicina felina', 'Laboratorio'],
      [['servicio', 'Consulta felina', 'Servicios', 16000, null, 'vet-gato'], ['servicio', 'Hemograma completo', 'Exámenes', 22000, null], ['servicio', 'Vacuna triple felina', 'Vacunas', 14000, 11900], ['servicio', 'Limpieza dental', 'Servicios', 45000, null]],
      'Clínica con atención especial para gatos: sala de espera separada y manejo amable.'],
    ['Carolina Mansilla', 'Pet Shop Frutillar', 'tienda', 13, 'Avenida Philippi 1100, Frutillar', 2, 'perros-pequenos', ['Alimento', 'Accesorios', 'Despacho a domicilio'],
      [['producto', 'Alimento perro adulto 15 kg', 'Alimentos', 39990, 34990], ['producto', 'Alimento gato esterilizado 7,5 kg', 'Alimentos', 32990, null], ['producto', 'Cama acolchada mediana', 'Accesorios', 24990, null], ['producto', 'Arena sanitaria 10 kg', 'Higiene', 8990, null]],
      'Alimento, accesorios y snacks para perros y gatos, con despacho en Frutillar y Llanquihue.'],
    ['Javier Alvarado', 'Peluquería Canina Llanquihue', 'peluqueria', 14, 'Calle Vicente Pérez Rosales 340, Llanquihue', 3, 'peluquero', ['Baño', 'Corte de raza', 'Corte de uñas', 'Deslanado'],
      [['servicio', 'Baño perro pequeño', 'Baño', 12000, null, 'peluqueria-yorkie'], ['servicio', 'Baño y corte de raza', 'Corte', 22000, 19000, 'peluqueria-bn'], ['servicio', 'Deslanado', 'Baño', 18000, null], ['servicio', 'Corte de uñas', 'Corte', 4000, null]],
      'Peluquería canina con productos hipoalergénicos y atención con hora.'],
    ['Marcela Leiva', 'Forrajería del Sur', 'tienda', 18, 'Calle Pudeto 210, Ancud', 1, null, ['Alimento a granel', 'Accesorios'],
      [['producto', 'Alimento a granel (kg)', 'Alimentos', 2200, null], ['producto', 'Collar de nylon', 'Accesorios', 4990, null]],
      'Alimento a granel para perros, gatos y aves en Ancud.'],
    ['Pablo Ojeda', 'Estética Felina', 'peluqueria', 2, 'Avenida Angelmó 1650, Puerto Montt', 2, 'peluqueria-yorkie', ['Baño de gatos', 'Corte higiénico', 'Peluquería canina'],
      [['servicio', 'Baño de gato', 'Baño', 15000, null, 'gato-panuelo'], ['servicio', 'Corte higiénico', 'Corte', 10000, null], ['servicio', 'Baño perro mediano', 'Baño', 16000, 13900, 'peluquero']],
      'Peluquería especializada en gatos y razas pequeñas, sin sedación.'],
  ]
  const PRECIOS = { 1: 0, 2: 10_000, 3: 15_000, 4: 25_000 }
  const negocios = []
  NEGOCIOS.forEach(([dueno, nombre, rubro, comuna, direccion, plan, portada, servicios, items, descripcion], i) => {
    const u = usuario(dueno, 'pyme', comuna)
    const [lat, lng] = COMUNAS[comuna]
    const rut = 76_900_000 + i * 13_579
    const p = {
      id: uid(), propietario_id: u.id, nombre_comercial: nombre, rut_empresa: `${rut}-${dvRut(rut)}`, rubro, descripcion, comuna_id: comuna, direccion,
      latitud: String((lat + (azar() - 0.5) * 0.01).toFixed(5)), longitud: String((lng + (azar() - 0.5) * 0.01).toFixed(5)), telefono: null, whatsapp: null,
      horario: rubro === 'veterinaria' ? { 'lun-vie': '09:00-19:00', sab: '10:00-14:00' } : { 'lun-vie': '10:00-19:00', sab: '10:00-17:00' }, servicios,
      foto_portada: plan >= 2 && portada ? foto(portada, u.id) : null, estado_verificacion: 'aprobada', origen: 'registro', fuente: null, creado_en: hace(50 - i, 10),
    }
    db.pymes.push(p)
    if (plan > 1) {
      const s = { id: uid(), pyme_id: p.id, plan_id: plan, inicio: dayOffset(-8 - i), fin: dayOffset(22 - i), estado: 'activa' }
      db.suscripciones.push(s)
      db.pagos.push({ id: uid(), suscripcion_id: s.id, monto_clp: PRECIOS[plan], canal: 'transferencia', referencia: 'DEMO', codigo_orcob: null, estado: 'confirmado', pagado_en: hace(8 + i, 11) })
    }
    for (const [tipo, n, categoria, precio, oferta, fotoItem] of items) {
      db.catalogo.push({ id: uid(), pyme_id: p.id, tipo, nombre: n, descripcion: null, precio_referencial_clp: precio, disponible: true, categoria, sin_stock: false, oferta: oferta ? { precio_clp: oferta, desde: dayOffset(-3), hasta: dayOffset(18) } : null, foto_url: fotoItem ? foto(fotoItem, u.id) : null, creado_en: hace(30, 12) })
    }
    negocios.push({ p, dueno: u })
  })
  const negocio = nombre => negocios.find(n => n.p.nombre_comercial === nombre)

  // Consultas de tutores a los negocios, con o sin respuesta.
  const CONSULTAS = [
    ['Fernanda Soto', 'Veterinaria Volcán', '¿Atienden urgencias el domingo? Michi está decaído desde ayer.', 'Sí, tenemos urgencias las 24 horas. Tráelo cuando puedas y avísanos al llegar.'],
    ['Benjamín Muñoz', 'Veterinaria Volcán', '¿Cuánto cuesta la esterilización para un labrador de 30 kg?', 'Para ese peso el valor es $120.000 e incluye control a los 7 días.'],
    ['Florencia Sepúlveda', 'Veterinaria Volcán', 'Milo necesita un control cardiológico, ¿hacen ecocardiograma?', null],
    ['Isidora Morales', 'Clínica Animal Chiloé', '¿Tienen alimento hipoalergénico sin pollo?', 'Sí, tenemos dos marcas sin pollo. Te las mostramos en la clínica.'],
    ['Antonia Díaz', 'Pet Shop Frutillar', '¿Despachan a Llanquihue el sábado?', 'Sí, los sábados despachamos hasta las 14:00.'],
    ['Sebastián Torres', 'Peluquería Canina Llanquihue', '¿Hacen corte de raza a rottweiler cachorro?', null],
    ['Josefa Reyes', 'Estética Felina', 'Quiero bañar a mis dos gatos, ¿puedo llevarlos juntos?', 'Claro, los atendemos en la misma hora. Trae su transportadora.'],
    ['Martina Silva', 'Forrajería del Sur', '¿Venden arena sanitaria?', null],
  ]
  for (const [quien, a, mensaje, respuesta] of CONSULTAS) {
    const t = tutor(quien), n = negocio(a), creado = hace(2 + Math.floor(azar() * 9), 10 + Math.floor(azar() * 8))
    db.contactos_pymes.push({ id: uid(), pyme_id: n.p.id, remitente_id: t.id, remitente_nombre: t.nombre_visible, remitente_contacto: null, mensaje, estado: respuesta ? 'respondido' : 'nuevo', respuesta, creado_en: creado, respondido_en: respuesta ? new Date(new Date(creado).getTime() + 3 * 3_600_000).toISOString() : null })
  }

  // ---------- ONG y animales en adopción ----------
  const perfil = (mision, necesidades, color, emblema) => ({
    mision, como_ayudar: 'Puedes adoptar, ser hogar temporal, donar alimento o comprar con nuestros cupones en negocios aliados.', necesidades,
    voluntariado: 'Paseos y socialización los sábados en la mañana. Escríbenos para coordinar.', horario_visitas: 'Sábados de 11:00 a 14:00, con cita previa.', donaciones: null, emblema, color,
  })
  const ONGS = [
    ['Francisca Gómez', 'Huellas de Chiloé', 'agrupacion', 3, perfil('Rescatamos perros y gatos abandonados en Castro y alrededores y buscamos familias responsables.', ['Alimento para cachorros', 'Mantas', 'Antiparasitarios'], 'calido', 'paw'),
      [['Manchas', 'perro', 'Mestizo cachorro', '4 meses', 'cachorro-boyero', 'Lo encontramos junto a su madre en un camino rural. Es juguetón y aprende rápido.', true],
        ['Copito', 'gato', 'Mestizo', '6 meses', 'gatito-durmiendo', 'Llegó con una herida en la pata, ya está sano. Duerme mucho y busca regazo.', false],
        ['Pampa y Lucero', 'perro', 'Mestizos', '2 años', 'perros-campo', 'Hermanos inseparables rescatados de un campo. Buscamos una familia con patio que los adopte juntos.', false]], 'perros-campo'],
    ['Ricardo Cárdenas', 'Refugio Lago Llanquihue', 'refugio', 17, perfil('Refugio sin fines de lucro con más de 40 animales a la espera de un hogar en la cuenca del lago.', ['Alimento adulto', 'Arena sanitaria', 'Voluntarios para paseos'], 'acento', 'home'),
      [['Ramón', 'perro', 'Mestizo', '6 años', 'perro-cerca', 'Lleva dos años en el refugio. Es tranquilo, ideal para una familia con niños o una persona mayor.', true],
        ['Duquesa', 'gato', 'Mestiza', '3 años', 'gato-acostado', 'Le encanta tomar sol. Es independiente pero cariñosa con quien conoce.', false],
        ['Pirata', 'gato', 'Mestizo', '1 año', 'gato-estirandose', 'Rescatado de un techo en invierno. Activo y curioso.', false]], 'paseo-perros'],
    ['Paula Henríquez', 'Gatitos de Puerto Montt', 'rescatista_independiente', 2, perfil('Rescatista independiente: rehabilito y doy en adopción gatos de la calle en Puerto Montt.', ['Arena sanitaria', 'Alimento húmedo', 'Hogares temporales'], 'vino', 'heart'),
      [['Mora y Tizón', 'gato', 'Mestizos', '3 meses', 'gatos-patitas', 'Hermanitos que se cuidan entre sí. Se entregan juntos, esterilizados al cumplir la edad.', true],
        ['Sombra', 'gato', 'Mestizo', '2 años', 'gato-asoma', 'Tímido al principio, luego no se despega. Necesita un hogar sin perros.', false],
        ['Lunita', 'gato', 'Mestiza', '1 año', 'gato-ventana', 'Le encanta mirar por la ventana. Esterilizada y con vacunas al día.', false]], 'gatos-patitas'],
  ]
  const ongs = [], animales = {}
  ONGS.forEach(([dueno, nombre, tipo, comuna, perfilBase, lista, portada], i) => {
    const u = usuario(dueno, 'ong', comuna)
    const perfilOng = { ...perfilBase, foto_portada: foto(portada, u.id) }
    const o = { id: uid(), propietario_id: u.id, nombre, tipo, descripcion: perfilOng.mision, comuna_id: comuna, contacto: u.correo, redes_sociales: null, estado_verificacion: 'aprobada', perfil_publicado: perfilOng, perfil_borrador: perfilOng, perfil_estado: 'publicado', perfil_motivo: null, creado_en: hace(70 - i * 5, 10) }
    db.ongs.push(o)
    ongs.push({ o, dueno: u })
    lista.forEach(([an, especie, raza, edad, archivo, historia, prioritario], k) => {
      const a = { id: uid(), ong_id: o.id, nombre: an, especie, raza, edad_estimada: edad, estado_salud: 'Sano, desparasitado y con vacunas al día', historia, historial_salud: ficha({ vacunas: [{ id: uid(), nombre: especie === 'gato' ? 'Triple felina' : 'Óctuple', fecha: dayOffset(-30) }] }), foto_url: foto(archivo, u.id), estado: k === 2 && i === 1 ? 'en_proceso' : 'disponible', mascota_id: null, publicado_en: hace(20 - k * 4 - i, 12), prioritario }
      db.animales.push(a)
      animales[an] = { a, o, dueno: u }
      for (let v = 0; v < 6 + Math.floor(azar() * 25); v++) db.eventos_adopcion.push({ id: uid(), animal_id: a.id, ocurrido_en: hace(Math.floor(azar() * 7), 9 + Math.floor(azar() * 12)) })
    })
  })
  const SOLICITUDES = [
    ['Ramón', 'Benjamín Muñoz', 'Vivimos en una parcela con patio cercado. Ramón sería muy feliz con nosotros y nuestros hijos.', 'en_conversacion'],
    ['Ramón', 'Florencia Sepúlveda', 'Trabajo desde casa y tengo experiencia con perros adultos.', 'nueva'],
    ['Manchas', 'Felipe Navarro', 'Me encantaría adoptar a Manchas, tengo tiempo para educarlo.', 'nueva'],
    ['Mora y Tizón', 'Josefa Reyes', 'Ya tengo gatos y sé cuidarlos. Puedo adoptar a los dos.', 'en_conversacion'],
    ['Lunita', 'Gabriel Alarcón', 'Departamento con mallas en las ventanas, ideal para una gata.', 'nueva'],
    ['Pirata', 'Antonia Díaz', 'Quiero darle un hogar a Pirata, tengo experiencia con gatos activos.', 'en_conversacion'],
  ]
  for (const [an, quien, mensaje, estado] of SOLICITUDES) {
    const t = tutor(quien)
    db.solicitudes.push({ id: uid(), animal_id: animales[an].a.id, solicitante_nombre: t.nombre_visible, solicitante_contacto: t.correo, mensaje, estado, creado_en: hace(1 + Math.floor(azar() * 6), 20) })
  }

  // ---------- Convenios con canjes y banners ----------
  const CONVENIOS = [
    ['Veterinaria Volcán', 'Refugio Lago Llanquihue', 'Consulta con 15 % de descuento', 15, 'VOLCAN-REFUGIO15', 40],
    ['Clínica Animal Chiloé', 'Huellas de Chiloé', 'Vacunas con 10 % de descuento', 10, 'CHILOE-HUELLAS10', 28],
    ['Estética Felina', 'Gatitos de Puerto Montt', 'Baño de gato con 20 % de descuento', 20, 'FELINA-GATITOS20', 18],
  ]
  for (const [n, o, titulo, pct, codigo, canjes] of CONVENIOS) {
    const neg = negocio(n), ong = ongs.find(x => x.o.nombre === o)
    const c = { id: uid(), pyme_id: neg.p.id, ong_id: ong.o.id, titulo, descuento_pct: pct, condiciones: 'Presenta el código al pagar. Un uso por compra.', codigo, desde: dayOffset(-35), hasta: dayOffset(60), meta_mensual: 50, premio: 'Un saco de alimento de 15 kg para la organización', estado: 'activo', motivo: null, premios: [], creado_en: hace(38, 10) }
    db.convenios.push(c)
    for (let k = 0; k < canjes; k++) db.canjes.push({ id: uid(), convenio_id: c.id, sucursal_id: null, monto_clp: 8000 + Math.floor(azar() * 40) * 1000, registrado_por: neg.dueno.id, ocurrido_en: hace(Math.floor(azar() * 34), 10 + Math.floor(azar() * 9)) })
  }
  const banner = (autorTipo, autorId, titulo, texto, destino, ubicacion, tono, comuna) => db.banners.push({ id: uid(), autor_tipo: autorTipo, autor_id: autorId, titulo, texto, destino, ubicacion, comuna_id: comuna, tono, desde: dayOffset(-5), hasta: dayOffset(25), estado: 'aprobado', motivo: null, revisado_por: null, impresiones: 200 + Math.floor(azar() * 900), clics: 10 + Math.floor(azar() * 80), creado_en: hace(6, 10) })
  banner('pyme', negocio('Veterinaria Volcán').p.id, 'Urgencias 24 horas en Puerto Varas', 'Veterinario de turno todas las noches y fines de semana.', 'perfil', 'inicio', 'acento', 17)
  banner('pyme', negocio('Estética Felina').p.id, 'Baño de gatos sin sedación', 'Manejo amable y con hora agendada en Puerto Montt.', 'perfil', 'directorio', 'calido', 2)
  banner('ong', ongs[1].o.id, 'Ramón te está esperando', 'Lleva dos años en el refugio. ¿Le das una oportunidad?', 'adopciones', 'muro', 'info', null)

  // ---------- Muro comunal ----------
  const publicaciones = []
  const publicar = (autor, tipo, texto, { dias = 1, hora = 12, sector = null, foto: fotoUrl = null, mascota = null, animal = null, resuelto = false, evento = null, comuna = null } = {}) => {
    const p = {
      id: uid(), autor_id: autor.id, comuna_id: comuna ?? autor.comuna_id, mascota_id: mascota?.id ?? null, animal_id: animal?.id ?? null, tipo, texto, sector, foto_url: fotoUrl ?? mascota?.foto_url ?? animal?.foto_url ?? null,
      fecha_evento: evento === null ? null : dayOffset(evento), resuelto_en: resuelto ? hace(Math.max(0, dias - 1), 16) : null, editado_en: null, estado: 'publicada', creado_en: hace(dias, hora, Math.floor(azar() * 59)),
    }
    db.publicaciones.push(p)
    publicaciones.push(p)
    return p
  }
  const T = tutor
  // Extravíos (con la foto de la mascota) y encuentros.
  const extravioThor = publicar(T('Valentina Rojas'), 'extravio', 'Se perdió Thor, pastor alemán de 4 años, con collar azul y medalla PetSuite. Responde a su nombre. Por favor avisen si lo ven.', { dias: 2, hora: 19, sector: 'Costanera, cerca del mall', mascota: mascotas.Thor })
  publicar(T('Catalina Pérez'), 'extravio', 'Frida salió por el portón esta mañana. Es una pug pequeña y no aguanta el calor, si la ven por favor denle agua.', { dias: 5, hora: 9, sector: 'Población Rahue Alto', mascota: mascotas.Frida, resuelto: true })
  publicar(T('Fernanda Soto'), 'extravio', 'Michi no volvió anoche. Gato atigrado, toma medicamento para la tiroides. Lo buscamos por el sector.', { dias: 9, hora: 21, sector: 'Calle Imperial', mascota: mascotas.Michi, resuelto: true })
  publicar(T('Gabriel Alarcón'), 'encuentro', 'Encontré este gatito escondido bajo un auto en el estacionamiento. Está asustado pero bien, lo tengo en casa mientras aparece su familia.', { dias: 1, hora: 17, sector: 'Avenida Presidente Ibáñez', foto: foto('gato-asoma', T('Gabriel Alarcón').id) })
  publicar(T('Nicolás Espinoza'), 'encuentro', 'Perrito café dando vueltas cerca de la plaza, sin collar. Lo dejé en la carnicería de la esquina con agua y comida.', { dias: 3, hora: 13, sector: 'Plaza de Purranque', foto: foto('perro-cerca', T('Nicolás Espinoza').id) })
  // Alertas.
  publicar(T('Joaquín Herrera'), 'alerta', 'Ojo con el sector del río: vecinos encontraron trozos de carne con algo extraño. No suelten a sus perros por ahí esta semana.', { dias: 2, hora: 8, sector: 'Ribera del río Rahue' })
  publicar(T('Martina Silva'), 'alerta', 'Hay casos de parvovirus en cachorros del sector. Revisen que sus perros tengan la vacuna óctuple al día.', { dias: 4, hora: 10, sector: 'Ancud centro' })
  publicar(T('Matías Vargas'), 'alerta', 'Atropellaron a un perro en la ruta a Alerce porque iba suelto. Por favor usen correa cerca de la carretera.', { dias: 6, hora: 20, sector: 'Ruta 5, Alerce' })
  // Recomendaciones.
  publicar(T('Benjamín Muñoz'), 'recomendacion', 'Muy buena la atención en Veterinaria Volcán: me explicaron todo el tratamiento de Max y no me cobraron de más.', { dias: 3, hora: 18, foto: mascotas.Max.foto_url })
  publicar(T('Isidora Morales'), 'recomendacion', 'Para los que buscan alimento sin pollo, en Clínica Animal Chiloé tienen dos marcas. A Pelusa le sentó bien.', { dias: 7, hora: 15 })
  publicar(T('Antonia Díaz'), 'recomendacion', 'El despacho de Pet Shop Frutillar llegó el mismo día y bien empacado. Lo recomiendo.', { dias: 5, hora: 12 })
  publicar(T('Josefa Reyes'), 'recomendacion', 'Llevé a Oliver y Sasha a Estética Felina: los bañaron sin sedación y quedaron tranquilos. Excelente trato.', { dias: 8, hora: 17, foto: mascotas.Oliver.foto_url })
  publicar(T('Sebastián Torres'), 'recomendacion', '¿Alguien sabe de un adiestrador en Llanquihue? Zeus está creciendo rápido y tira mucho de la correa.', { dias: 1, hora: 21, foto: mascotas.Zeus.foto_url })
  publicar(T('Camila Fuentes'), 'recomendacion', 'El parque Chuyaca tiene un sector amplio para perros en la mañana. Rocco lo pasa increíble.', { dias: 10, hora: 11, foto: foto('paseo-perros', T('Camila Fuentes').id) })
  publicar(T('Daniela Barrientos'), 'recomendacion', 'Gaspar dejó de rascar los muebles con un rascador alto junto a la ventana. Les comparto el dato.', { dias: 12, hora: 19, foto: mascotas.Gaspar.foto_url })
  // Eventos.
  publicar(T('Florencia Sepúlveda'), 'evento', 'Caminata solidaria con perros por la costanera. Lo recaudado va al Refugio Lago Llanquihue. ¡Vengan con sus mascotas!', { dias: 2, hora: 10, sector: 'Costanera de Puerto Varas', evento: 9 })
  publicar(T('Tomás Castillo'), 'evento', 'Operativo de vacunación antirrábica gratuito en la junta de vecinos. Traer carnet de la mascota.', { dias: 3, hora: 9, sector: 'Junta de vecinos Frutillar Bajo', evento: 6 })
  publicar(T('Agustina Cárcamo'), 'evento', 'Jornada de esterilización a bajo costo para gatos. Cupos limitados, inscripción en la municipalidad.', { dias: 4, hora: 14, sector: 'Gimnasio municipal de Quellón', evento: 12 })
  publicar(T('Vicente Gallardo'), 'evento', 'Encuentro de labradores en el parque. Traigan agua y bolsitas.', { dias: 1, hora: 16, sector: 'Parque Chuyaca', evento: 4, foto: mascotas.Kiara.foto_url })
  // Adopciones difundidas por las ONG.
  for (const an of ['Ramón', 'Manchas', 'Mora y Tizón', 'Lunita']) {
    const { a, o, dueno } = animales[an]
    publicar(dueno, 'adopcion', `${an} busca un hogar. ${a.historia}`, { dias: 2 + Math.floor(azar() * 5), hora: 13, animal: a, comuna: o.comuna_id })
  }

  // Comentarios, apoyos y guardados de vecinos de la misma comuna (o de quien quiera ayudar).
  const COMENTARIOS = {
    extravio: ['Compartido en el grupo del barrio, ojalá aparezca pronto.', 'Lo voy a buscar cuando salga a pasear a mi perro.', 'Revisen en la clínica de la esquina, a veces los llevan ahí.', 'Mucha fuerza, ojalá vuelva a casa.'],
    encuentro: ['Gracias por cuidarlo mientras aparece su familia.', 'Comparto, quizás alguien lo reconoce.', 'Si nadie lo reclama, avisa a una ONG para que lo ayude a encontrar hogar.'],
    alerta: ['Gracias por avisar, evitaremos ese sector.', 'Hay que avisar a la municipalidad también.', 'Qué terrible, comparto.'],
    recomendacion: ['Gracias por el dato.', 'Yo también fui y me atendieron muy bien.', 'Lo voy a probar con mi perrita.', '¿Tienen estacionamiento?'],
    evento: ['¡Ahí estaremos!', '¿Hay que inscribirse antes?', 'Excelente iniciativa, comparto.'],
    adopcion: ['¡Qué lindo! Ojalá encuentre familia pronto.', 'Comparto con mis amigos de la zona.', 'Si no tuviera tres gatos me lo llevaba.'],
  }
  for (const p of publicaciones) {
    const vecinos = [...deComuna(p.comuna_id, { id: p.autor_id }), ...tutores.filter(t => t.comuna_id !== p.comuna_id)]
    const nComentarios = Math.floor(azar() * 4)
    for (let k = 0; k < nComentarios; k++) {
      const quien = vecinos[k % vecinos.length]
      db.comentarios.push({ id: uid(), autor_id: quien.id, publicacion_id: p.id, texto: elegir(COMENTARIOS[p.tipo]), estado: 'visible', editado_en: null, creado_en: new Date(new Date(p.creado_en).getTime() + (k + 1) * 47 * 60_000).toISOString() })
    }
    const apoyos = new Set()
    const nApoyos = 1 + Math.floor(azar() * 9)
    for (let k = 0; k < nApoyos && k < vecinos.length; k++) apoyos.add(vecinos[(k * 3 + Math.floor(azar() * 3)) % vecinos.length].id)
    for (const usuario_id of apoyos) db.reacciones.push({ publicacion_id: p.id, usuario_id })
    if (azar() < 0.3) db.guardados.push({ publicacion_id: p.id, usuario_id: vecinos[0].id })
  }
  // Un avance en el extravío de Thor.
  db.comentarios.push({ id: uid(), autor_id: T('Gabriel Alarcón').id, publicacion_id: extravioThor.id, texto: 'Creo que lo vi en Pelluco esta mañana, cerca de la plaza. Le avisé por su medalla.', estado: 'visible', editado_en: null, creado_en: hace(0, 10, 5) })
}

/** Dígito verificador del RUT (módulo 11). */
function dvRut(n) {
  let suma = 0, factor = 2
  for (const d of String(n).split('').reverse()) { suma += Number(d) * factor; factor = factor === 7 ? 2 : factor + 1 }
  const dv = 11 - (suma % 11)
  return dv === 11 ? '0' : dv === 10 ? 'K' : String(dv)
}
