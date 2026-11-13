// Base de datos simulada del modo demo: estado inicial (seed) y persistencia en localStorage.
// Las claves se guardan sin cifrar solo porque es una demostración; el API real usa bcrypt.
import type { ApiRole, FichaDatos, Oferta } from '../shared/api'
import type { ModuloPyme, RolEquipo } from '../shared/permissions'
import { VERSION_PRIVACIDAD } from '../shared/legal'
import type { TipoToken } from '../shared/cuentas'
import type { ArchivoDocumento } from '../shared/documentos'

export type Rubro = 'veterinaria' | 'tienda' | 'peluqueria' | 'otro'
export type Verificacion = 'pendiente' | 'aprobada' | 'rechazada' | 'suspendida'

// Ley 21.719: cada consentimiento se registra con su versión y fecha para poder demostrarlo.
export type Consentimiento = { tipo: 'terminos' | 'privacidad' | 'comunicaciones' | 'metricas'; otorgado: boolean; version: string; fecha: string }
export type Suspension = { tipo: 'temporal' | 'permanente'; dias: number | null; hasta: string | null; motivo: string; mensaje: string; aplicada_en: string }
export type Usuario = {
  id: string; correo: string; clave: string; rol: ApiRole; nombre_visible: string; comuna_id: number | null; estado: 'activo' | 'suspendido' | 'eliminado'
  suspension?: Suspension | null; consentimientos?: Consentimiento[]; bloqueo_tratamiento?: boolean; creado_en: string
  // Sin confirmar, la cuenta no puede ingresar. Las cuentas de la demo nacen confirmadas.
  correo_verificado_en?: string | null
}
// Enlace de un solo uso enviado por correo: confirmar la cuenta, crear una contraseña nueva o aceptar una invitación.
export type TokenCuenta = { token: string; usuario_id: string; tipo: TipoToken; creado_en: string; expira_en: string; usado_en: string | null }
export type MascotaRow = { id: string; tutor_id: string; nombre: string; especie: string; raza: string | null; sexo: string | null; fecha_nacimiento: string | null; foto_url: string | null; datos_clinicos: FichaDatos; ficha_version: number; creado_en: string }
export type Medalla = { id: string; mascota_id: string; token: string; estado: 'activa' | 'inactiva' | 'reemplazada'; emitida_en: string }
export type Escaneo = { id: string; medalla_id: string; ocurrido_en: string }
export type MensajeQr = { id: string; medalla_id: string; remitente_nombre: string | null; remitente_contacto: string | null; mensaje: string; latitud: string | null; longitud: string | null; estado: 'nuevo' | 'leido' | 'respondido'; enviado_en: string }
export type Acceso = { id: string; mascota_id: string; pyme_id: string; otorgado_por: string; permiso: 'lectura' | 'escritura'; vigente_hasta: string; revocado_en: string | null }
// origen 'publica': ficha armada con datos públicos, sin dueño (propietario_id y rut_empresa vacíos; null en la base).
export type Pyme = { id: string; propietario_id: string; nombre_comercial: string; rut_empresa: string; rubro: Rubro; descripcion: string | null; comuna_id: number; direccion: string | null; latitud: string | null; longitud: string | null; telefono: string | null; whatsapp: string | null; horario: Record<string, string>; servicios: string[]; foto_portada?: string | null; estado_verificacion: Verificacion; origen: 'registro' | 'publica'; fuente: string | null; creado_en: string }
// Multitenant: una Pyme (empresa) tiene su casa matriz (los datos de la Pyme) y sucursales adicionales.
export type Sucursal = { id: string; pyme_id: string; nombre: string; comuna_id: number; direccion: string | null; latitud: string | null; longitud: string | null; telefono: string | null; whatsapp: string | null; horario: Record<string, string>; descripcion: string | null; servicios: string[]; creado_en: string }
// Equipo interno: cuentas de jefes de local o personal clínico con permisos por módulo. sucursal_id null = casa matriz.
export type Miembro = { id: string; pyme_id: string; usuario_id: string; rol: RolEquipo; sucursal_id: string | null; permisos: ModuloPyme[]; creado_en: string }
export type ContactoPyme = { id: string; pyme_id: string; remitente_id: string; remitente_nombre: string; remitente_contacto: string | null; mensaje: string; estado: 'nuevo' | 'leido' | 'respondido'; respuesta: string | null; creado_en: string; respondido_en: string | null }
export type Item = { id: string; pyme_id: string; tipo: 'producto' | 'servicio'; nombre: string; descripcion: string | null; precio_referencial_clp: number | null; disponible: boolean; categoria: string | null; sin_stock: boolean; oferta: Oferta | null; creado_en: string }
export type EventoPyme = { id: string; pyme_id: string; item_id: string | null; tipo: 'visita_perfil' | 'vista_item' | 'clic_contacto' | 'clic_whatsapp'; ocurrido_en: string }
export type Suscripcion = { id: string; pyme_id: string; plan_id: number; inicio: string; fin: string; estado: 'pendiente' | 'activa' | 'vencida' | 'cancelada' }
export type Pago = { id: string; suscripcion_id: string; monto_clp: number; canal: 'transferencia' | 'orcob' | 'mercadopago'; referencia: string | null; codigo_orcob?: string | null; estado: 'pendiente' | 'confirmado' | 'rechazado'; pagado_en: string }
// Caso derivado a cobranza externa (Orcob). Se guarda exactamente lo que se envió, para rendir cuentas (Ley 21.719).
export type CasoCobranza = { id: string; pyme_id: string; id_caso: string; monto_clp: number; dias_mora: number; datos_enviados: Record<string, string | number>; estado: 'en_gestion' | 'pagado' | 'cerrado'; derivado_por: string; derivado_en: string; cerrado_en: string | null }
export type TipoPublicacion = 'extravio' | 'encuentro' | 'recomendacion' | 'alerta' | 'evento' | 'adopcion'
export type Publicacion = {
  id: string; autor_id: string; comuna_id: number; mascota_id: string | null; animal_id: string | null; tipo: TipoPublicacion; texto: string
  sector: string | null; foto_url: string | null; fecha_evento: string | null; resuelto_en: string | null; editado_en: string | null
  estado: 'publicada' | 'oculta' | 'eliminada'; creado_en: string
}
export type Comentario = { id: string; autor_id: string; publicacion_id: string; texto: string; estado: 'visible' | 'oculto' | 'eliminado'; editado_en: string | null; creado_en: string }
export type Reaccion = { publicacion_id: string; usuario_id: string }
export type Guardado = { publicacion_id: string; usuario_id: string }
export type Reporte = { id: string; reportante_id: string; objeto_tipo: 'publicacion' | 'comentario'; objeto_id: string; motivo: string; estado: 'abierto' | 'resuelto_ocultado' | 'resuelto_mantenido'; creado_en: string }
// Perfil público editable por la ONG (CMS sin imágenes). Lo publicado es la última versión aprobada por el asesor.
export type OngPerfil = {
  mision: string; como_ayudar: string; necesidades: string[]; voluntariado: string; horario_visitas: string
  donaciones: { banco: string; tipo_cuenta: string; numero: string; titular: string; rut: string; correo: string } | null
  emblema: 'heart' | 'paw' | 'home' | 'shield'; color: 'acento' | 'calido' | 'info' | 'vino'
}
export type Ong = {
  id: string; propietario_id: string; nombre: string; tipo: 'refugio' | 'rescatista_independiente' | 'agrupacion'; descripcion: string | null; comuna_id: number; contacto: string | null; redes_sociales: string | null
  estado_verificacion: 'pendiente' | 'aprobada' | 'rechazada'; perfil_publicado: OngPerfil | null; perfil_borrador: OngPerfil | null; perfil_estado: 'sin_enviar' | 'en_revision' | 'publicado' | 'rechazado'; perfil_motivo: string | null; creado_en: string
}
export type Animal = { id: string; ong_id: string; nombre: string; especie: string; raza: string | null; edad_estimada: string | null; estado_salud: string | null; historia: string | null; historial_salud: FichaDatos; foto_url: string | null; estado: 'disponible' | 'en_proceso' | 'adoptado'; mascota_id: string | null; publicado_en: string }
export type Solicitud = { id: string; animal_id: string; solicitante_nombre: string | null; solicitante_contacto: string | null; mensaje: string; estado: 'nueva' | 'en_conversacion' | 'concretada' | 'cerrada'; creado_en: string }
export type EventoAdopcion = { id: string; animal_id: string; ocurrido_en: string }
// Publicidad sin imágenes: texto, tono de color y un destino interno. Siempre pasa por el asesor.
export type Banner = {
  id: string; autor_tipo: 'pyme' | 'ong'; autor_id: string; titulo: string; texto: string; destino: 'perfil' | 'adopciones' | 'convenio'; ubicacion: 'inicio' | 'directorio' | 'muro'
  comuna_id: number | null; tono: 'acento' | 'calido' | 'info'; desde: string; hasta: string; estado: 'pendiente' | 'aprobado' | 'rechazado' | 'retirado'
  motivo: string | null; revisado_por: string | null; impresiones: number; clics: number; creado_en: string
}
// Convenio Pyme–ONG: la ONG difunde un código de descuento y cada canje mide la visibilidad que entrega.
export type Convenio = {
  id: string; pyme_id: string; ong_id: string; titulo: string; descuento_pct: number; condiciones: string; codigo: string; desde: string; hasta: string
  meta_mensual: number; premio: string; estado: 'pendiente_ong' | 'pendiente_asesor' | 'activo' | 'rechazado' | 'finalizado'; motivo: string | null
  premios: { mes: string; otorgado_en: string }[]; creado_en: string
}
export type Canje = { id: string; convenio_id: string; sucursal_id: string | null; monto_clp: number | null; registrado_por: string; ocurrido_en: string }
export type Correo = { id: string; para: string; asunto: string; cuerpo: string; tipo: 'bienvenida' | 'verificacion' | 'restablecer' | 'cuenta_creada' | 'cuenta_equipo' | 'aprobacion' | 'convenio' | 'cobranza' | 'privacidad' | 'premio' | 'aviso_qr'; enviado_en: string }
/** Evento contado por los límites de solicitudes (src/shared/limites.ts). */
export type EventoLimite = { clave: string; ocurrido_en: string }
/** Foto subida por un usuario (datos en base64). En la demo, la foto de la mascota se guarda como data: URL. */
export type Imagen = { id: string; dueno_id: string; tipo: string; datos: string; bytes: number; creado_en: string }
/** Documento de validación de un negocio (src/shared/documentos.ts). En la demo, los archivos grandes van sin datos. */
export type DocumentoPyme = ArchivoDocumento & { pyme_id: string; datos: string | null; subido_por: string | null; revisado_por: string | null }
// Derechos ARSOPOL de la Ley 21.719: acceso, rectificación, supresión, oposición, portabilidad y bloqueo.
export type SolicitudPrivacidad = { id: string; usuario_id: string; derecho: 'acceso' | 'rectificacion' | 'supresion' | 'oposicion' | 'portabilidad' | 'bloqueo'; detalle: string; estado: 'recibida' | 'en_proceso' | 'respondida' | 'rechazada'; respuesta: string | null; creado_en: string; vence_en: string; respondido_en: string | null }

export type Db = {
  comunas: { id: number; nombre: string }[]
  usuarios: Usuario[]
  sesiones: Record<string, string>
  mascotas: MascotaRow[]
  medallas: Medalla[]
  escaneos: Escaneo[]
  mensajes: MensajeQr[]
  accesos: Acceso[]
  pymes: Pyme[]
  sucursales: Sucursal[]
  miembros: Miembro[]
  catalogo: Item[]
  eventos: EventoPyme[]
  contactos_pymes: ContactoPyme[]
  suscripciones: Suscripcion[]
  pagos: Pago[]
  casos_cobranza: CasoCobranza[]
  publicaciones: Publicacion[]
  comentarios: Comentario[]
  reacciones: Reaccion[]
  guardados: Guardado[]
  reportes: Reporte[]
  ongs: Ong[]
  animales: Animal[]
  solicitudes: Solicitud[]
  eventos_adopcion: EventoAdopcion[]
  banners: Banner[]
  convenios: Convenio[]
  canjes: Canje[]
  correos: Correo[]
  solicitudes_privacidad: SolicitudPrivacidad[]
  tokens_cuenta: TokenCuenta[]
  limites: EventoLimite[]
  imagenes: Imagen[]
  documentos: DocumentoPyme[]
}

// v8: documentos de validación de los negocios y pagos con Mercado Pago. Los datos anteriores se descartan.
export const STORAGE_KEY = 'petsuite-mock-db-v8'
try { for (const old of ['petsuite-mock-db-v1', 'petsuite-mock-db-v2', 'petsuite-mock-db-v3', 'petsuite-mock-db-v4', 'petsuite-mock-db-v5', 'petsuite-mock-db-v6', 'petsuite-mock-db-v7']) localStorage.removeItem(old) } catch { /* sin almacenamiento */ }
export const CLAVE_DEMO = 'petsuite123'
export { VERSION_PRIVACIDAD }

export const uid = () => crypto.randomUUID()
// Estrictamente creciente: dos registros de una misma operación no comparten hora, así el orden por fecha es estable.
let ultimo = 0
export const now = () => { ultimo = Math.max(Date.now(), ultimo + 1); return new Date(ultimo).toISOString() }
export const dayOffset = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10) }

export const ficha = (d: Partial<FichaDatos> = {}): FichaDatos => ({ condiciones: [], medicamentos: [], notaEmergencia: '', vacunas: [], alergias: [], tratamientos: [], atenciones: [], alertasCriticas: [], ...d })
export const consentimientosBase = (comunicaciones = false, fecha = now()): Consentimiento[] => [
  { tipo: 'terminos', otorgado: true, version: VERSION_PRIVACIDAD, fecha },
  { tipo: 'privacidad', otorgado: true, version: VERSION_PRIVACIDAD, fecha },
  { tipo: 'comunicaciones', otorgado: comunicaciones, version: VERSION_PRIVACIDAD, fecha },
  { tipo: 'metricas', otorgado: true, version: VERSION_PRIVACIDAD, fecha },
]

function seed(): Db {
  // Horas consecutivas (1 ms) para que el orden de creación sea el mismo en el navegador y en PostgreSQL.
  const t0 = Date.now()
  let tick = 0
  const t = () => new Date(t0 + tick++).toISOString()
  const db: Db = {
    // Mismos ids que las migraciones 002 y 005.
    comunas: ['Osorno', 'Puerto Montt', 'Castro', 'Puerto Octay', 'Purranque', 'Puyehue', 'Río Negro', 'San Juan de la Costa', 'San Pablo', 'Calbuco', 'Cochamó', 'Fresia', 'Frutillar', 'Llanquihue', 'Los Muermos', 'Maullín', 'Puerto Varas', 'Ancud', 'Chonchi', 'Curaco de Vélez', 'Dalcahue', 'Puqueldón', 'Queilén', 'Quellón', 'Quemchi', 'Quinchao', 'Chaitén', 'Futaleufú', 'Hualaihué', 'Palena'].map((nombre, i) => ({ id: i + 1, nombre })),
    usuarios: [], sesiones: {}, mascotas: [], medallas: [], escaneos: [], mensajes: [], accesos: [], pymes: [], sucursales: [], miembros: [], catalogo: [], eventos: [], contactos_pymes: [],
    suscripciones: [], pagos: [], casos_cobranza: [], publicaciones: [], comentarios: [], reacciones: [], guardados: [], reportes: [], ongs: [], animales: [], solicitudes: [], eventos_adopcion: [],
    banners: [], convenios: [], canjes: [], correos: [], solicitudes_privacidad: [], tokens_cuenta: [], limites: [], imagenes: [], documentos: [],
  }
  const user = (correo: string, rol: ApiRole, nombre: string, comuna: number) => {
    const creado = t()
    const u: Usuario = { id: uid(), correo, clave: CLAVE_DEMO, rol, nombre_visible: nombre, comuna_id: comuna, estado: 'activo', consentimientos: consentimientosBase(), creado_en: creado, correo_verificado_en: creado }
    db.usuarios.push(u)
    return u.id
  }
  const tutor = user('tutor@petsuite.cl', 'tutor', 'Ana Soto', 1)
  const tutor2 = user('tutor2@petsuite.cl', 'tutor', 'Diego Ruiz', 2)
  const duenaVet = user('veterinaria@petsuite.cl', 'pyme', 'María González', 1)
  const clinico = user('clinico@petsuite.cl', 'clinico', 'Dr. Luis Pérez', 1)
  const tienda = user('tienda@petsuite.cl', 'pyme', 'Huellitas Osorno', 1)
  const jefe = user('jefe@petsuite.cl', 'jefe_local', 'Paula Muñoz', 2)
  const peluqueria = user('peluqueria@petsuite.cl', 'pyme', 'Rodrigo Vera', 2)
  const asesor = user('asesor@petsuite.cl', 'asesor', 'Camila Rojas', 1)
  user('admin@petsuite.cl', 'admin', 'Equipo PetSuite', 1)

  // Plan 2 Bronce, 3 Plata, 4 Oro (ver src/plans.ts). Inicio y fin relativos a hoy.
  const pyme = (owner: string, nombre: string, rut: string, rubro: Rubro, comuna: number, direccion: string, lat: number, lng: number, servicios: string[], plan: { id: number; monto: number; inicio: number; fin: number; canal: Pago['canal'] }) => {
    const p: Pyme = {
      id: uid(), propietario_id: owner, nombre_comercial: nombre, rut_empresa: rut, rubro, descripcion: `${nombre}: atención cercana para tu mascota.`, comuna_id: comuna,
      direccion, latitud: String(lat), longitud: String(lng), telefono: null, whatsapp: null, horario: { 'lun-vie': '09:00-18:00', sab: '10:00-14:00' }, servicios, estado_verificacion: 'aprobada', origen: 'registro', fuente: null, creado_en: t(),
    }
    db.pymes.push(p)
    const s: Suscripcion = { id: uid(), pyme_id: p.id, plan_id: plan.id, inicio: dayOffset(plan.inicio), fin: dayOffset(plan.fin), estado: 'activa' }
    db.suscripciones.push(s)
    db.pagos.push({ id: uid(), suscripcion_id: s.id, monto_clp: plan.monto, canal: plan.canal, referencia: plan.canal === 'orcob' ? null : 'TRF-DEMO', codigo_orcob: plan.canal === 'orcob' ? '48213907' : null, estado: 'confirmado', pagado_en: new Date(Date.now() + plan.inicio * 86_400_000).toISOString() })
    return p.id
  }
  const vet = pyme(duenaVet, 'Clínica Veterinaria Sur', '76111222-3', 'veterinaria', 1, 'Mackenna 1020, Osorno', -40.5735, -73.1335, ['Consulta general', 'Vacunación', 'Cirugía menor', 'Urgencias'], { id: 4, monto: 25_000, inicio: -10, fin: 20, canal: 'orcob' })
  const shop = pyme(tienda, 'Huellitas Osorno', '76333444-5', 'tienda', 1, 'Ramírez 550, Osorno', -40.5745, -73.1350, ['Despacho a domicilio', 'Asesoría en alimentación'], { id: 3, monto: 15_000, inicio: -5, fin: 25, canal: 'transferencia' })
  // Bronce vencido hace 35 días: ya bajó a Gratis y se puede derivar a cobranza.
  pyme(peluqueria, 'Peluquería Canina Patagonia', '76555666-7', 'peluqueria', 2, 'Varas 300, Puerto Montt', -41.4689, -72.9411, ['Baño', 'Corte de raza', 'Corte de uñas'], { id: 2, monto: 10_000, inicio: -65, fin: -35, canal: 'transferencia' })

  const sucursal = (pyme_id: string, nombre: string, comuna_id: number, direccion: string, lat: number, lng: number, descripcion: string | null, servicios: string[]) => {
    const s: Sucursal = { id: uid(), pyme_id, nombre, comuna_id, direccion, latitud: String(lat), longitud: String(lng), telefono: null, whatsapp: null, horario: { 'lun-vie': '10:00-19:00', sab: '10:00-14:00' }, descripcion, servicios, creado_en: t() }
    db.sucursales.push(s)
    return s.id
  }
  sucursal(vet, 'Sucursal Rahue', 1, 'Av. República 450, Osorno', -40.5690, -73.1560, 'Atención preventiva y peluquería clínica en el sector Rahue.', ['Consulta general', 'Vacunación', 'Peluquería clínica'])
  const huellitasPm = sucursal(shop, 'Huellitas Puerto Montt', 2, 'Urmeneta 620, Puerto Montt', -41.4717, -72.9396, null, [])
  db.miembros.push(
    { id: uid(), pyme_id: vet, usuario_id: clinico, rol: 'clinico', sucursal_id: null, permisos: ['pacientes'], creado_en: t() },
    { id: uid(), pyme_id: shop, usuario_id: jefe, rol: 'jefe_local', sucursal_id: huellitasPm, permisos: ['perfil', 'catalogo', 'contactos', 'metricas'], creado_en: t() },
  )

  for (const [nombre, descripcion, precio, tipo, categoria, oferta] of [
    ['Alimento adulto 15 kg', 'Alimento seco para perros adultos', 42990, 'producto', 'Alimentos', null],
    ['Arnés ajustable', 'Arnés acolchado talla M', 12990, 'producto', 'Accesorios', { precio_clp: 10990, desde: dayOffset(0), hasta: dayOffset(14) }],
    ['Shampoo hipoalergénico', 'Para pieles sensibles', 7990, 'producto', 'Higiene', null],
    ['Baño y corte', 'Servicio de peluquería', 18000, 'servicio', 'Servicios', null],
  ] as const) db.catalogo.push({ id: uid(), pyme_id: shop, tipo, nombre, descripcion, precio_referencial_clp: precio, disponible: true, categoria, sin_stock: false, oferta: oferta ? { ...oferta } : null, creado_en: t() })

  const luna: MascotaRow = {
    id: uid(), tutor_id: tutor, nombre: 'Luna', especie: 'perro', raza: 'Labrador', sexo: 'hembra', fecha_nacimiento: null, foto_url: '/img/perro-retrato.jpg', ficha_version: 1, creado_en: t(),
    datos_clinicos: ficha({
      vacunas: [{ nombre: 'Antirrábica', fecha: '2026-03-14', proxima: '2027-03-14' }],
      alergias: [{ agente: 'Pollo', reaccion: 'Dermatitis', gravedad: 'moderada' }],
      atenciones: [{ fecha: '2026-05-10', motivo: 'Control anual', notas: 'Sin hallazgos' }],
      alertasCriticas: ['Requiere medicación diaria'],
    }),
  }
  db.mascotas.push(luna)
  db.medallas.push({ id: uid(), mascota_id: luna.id, token: uid().replace(/-/g, ''), estado: 'activa', emitida_en: t() })

  const ong = (correo: string, nombre: string, tipo: Ong['tipo'], comuna: number, estado: Ong['estado_verificacion'], perfil: OngPerfil | null) => {
    const o: Ong = {
      id: uid(), propietario_id: user(correo, 'ong', nombre, comuna), nombre, tipo, descripcion: `${nombre}: rescatamos y damos en adopción responsable a perros y gatos de la zona.`, comuna_id: comuna, contacto: correo, redes_sociales: null,
      estado_verificacion: estado, perfil_publicado: perfil, perfil_borrador: perfil, perfil_estado: perfil ? 'publicado' : 'sin_enviar', perfil_motivo: null, creado_en: t(),
    }
    db.ongs.push(o)
    return o.id
  }
  const patitas = ong('ong@petsuite.cl', 'Patitas del Sur', 'refugio', 1, 'aprobada', {
    mision: 'Rescatamos, rehabilitamos y damos en adopción responsable a perros y gatos abandonados de Osorno.',
    como_ayudar: 'Puedes adoptar, ser hogar temporal, donar alimento o aportar con una transferencia. También ayudas comprando con nuestros cupones en negocios aliados.',
    necesidades: ['Alimento para cachorros', 'Mantas y camas', 'Arena sanitaria', 'Antiparasitarios'],
    voluntariado: 'Paseos y socialización los sábados en el refugio. Escríbenos para coordinar.', horario_visitas: 'Sábados de 10:00 a 13:00',
    donaciones: { banco: 'BancoEstado', tipo_cuenta: 'Cuenta Vista', numero: '00012345678', titular: 'Agrupación Patitas del Sur', rut: '65123456-7', correo: 'donaciones@patitasdelsur.cl' },
    emblema: 'heart', color: 'vino',
  })
  const nueva = ong('ong2@petsuite.cl', 'Rescate Nuevo', 'rescatista_independiente', 2, 'pendiente', null)
  const historial = () => ficha({ vacunas: [{ nombre: 'Óctuple', fecha: '2026-07-02' }], tratamientos: [{ descripcion: 'Desparasitación', inicio: '2026-07-02' }] })
  const animal = (ong_id: string, nombre: string, especie: string, raza: string, edad: string, salud: string | null, historia: string, foto: string | null, h = historial()): Animal =>
    ({ id: uid(), ong_id, nombre, especie, raza, edad_estimada: edad, estado_salud: salud, historia, historial_salud: h, foto_url: foto, estado: 'disponible', mascota_id: null, publicado_en: t() })
  db.animales.push(
    animal(patitas, 'Canela', 'perro', 'Mestiza', '1 a 2 años', 'Sana, esterilizada y vacunada', 'Rescatada de la vía pública en Osorno. Es cariñosa y se lleva bien con otros perros.', '/img/canela.jpg'),
    animal(patitas, 'Tomás', 'gato', 'Europeo', '6 meses', 'Sano y desparasitado', 'Encontrado junto a su camada. Juguetón y muy sociable.', '/img/gato-atigrado.jpg'),
    animal(patitas, 'Bruno', 'perro', 'Beagle', '4 años', 'Sano, vacunado y con chip', 'Entregado por su familia al mudarse. Tranquilo, ideal para departamento.', '/img/beagle.jpg'),
    animal(patitas, 'Miel', 'perro', 'Cachorra mestiza', '3 meses', 'Vacunada y desparasitada', 'Nació en un rescate. Juguetona y sociable con niños.', '/img/cachorro.jpg'),
    animal(patitas, 'Nube', 'gato', 'Mestizo', '2 años', 'Sano y esterilizado', 'Encontrada en una feria. Cariñosa, le gusta dormir en el regazo.', '/img/gato-3777622.jpg'),
    animal(nueva, 'Borrador', 'perro', 'Mestizo', '3 años', null, 'Aún sin publicar: la ONG no está verificada.', null, ficha()),
  )

  // Muro: una publicación de cada tipo, con horas escalonadas para que el orden sea estable.
  const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
  const post = (autor_id: string, comuna_id: number, tipo: Publicacion['tipo'], texto: string, min: number, extra: Partial<Publicacion> = {}): Publicacion =>
    ({ id: uid(), autor_id, comuna_id, mascota_id: null, animal_id: null, tipo, texto, sector: null, foto_url: null, fecha_evento: null, resuelto_en: null, editado_en: null, estado: 'publicada', creado_en: hace(min), ...extra })
  const canela = db.animales.find(a => a.nombre === 'Canela')!
  db.publicaciones.push(
    post(tutor2, 2, 'encuentro', 'Encontré un gato gris cerca del terminal.', 300, { sector: 'Terminal de buses' }),
    post(tutor, 1, 'recomendacion', 'Recomiendo la clínica de Mackenna, muy buena atención.', 240),
    post(db.ongs.find(o => o.id === patitas)!.propietario_id, 1, 'adopcion', 'Canela busca un hogar: es cariñosa, está esterilizada y se lleva bien con otros perros.', 180, { animal_id: canela.id, foto_url: canela.foto_url }),
    post(tutor, 1, 'evento', 'Operativo de vacunación antirrábica gratuito para perros y gatos. Lleven a sus mascotas con correa o transportadora.', 120, { sector: 'Plaza de Armas', fecha_evento: dayOffset(5) }),
    post(tutor, 1, 'alerta', 'Vecinos reportan cebos sospechosos en el sector del parque. Eviten que sus mascotas coman cosas del suelo.', 60, { sector: 'Parque Chuyaca' }),
  )

  // Publicidad: dos banners aprobados y uno de la ONG esperando al asesor.
  const banner = (autor_tipo: Banner['autor_tipo'], autor_id: string, titulo: string, texto: string, destino: Banner['destino'], ubicacion: Banner['ubicacion'], tono: Banner['tono'], estado: Banner['estado'], desde: number, hasta: number): Banner =>
    ({ id: uid(), autor_tipo, autor_id, titulo, texto, destino, ubicacion, comuna_id: null, tono, desde: dayOffset(desde), hasta: dayOffset(hasta), estado, motivo: null, revisado_por: estado === 'aprobado' ? asesor : null, impresiones: estado === 'aprobado' ? 140 : 0, clics: estado === 'aprobado' ? 12 : 0, creado_en: t() })
  db.banners.push(
    banner('pyme', shop, 'Arnés ajustable con precio de oferta', 'Pasa por cualquiera de nuestras sucursales en Osorno y Puerto Montt.', 'perfil', 'inicio', 'calido', 'aprobado', -2, 12),
    banner('pyme', vet, 'Operativo de vacunación en Rahue', 'Antirrábica y óctuple con hora agendada durante este mes.', 'perfil', 'directorio', 'acento', 'aprobado', -1, 20),
    banner('ong', patitas, 'Campaña de invierno: mantas para el refugio', 'Necesitamos 50 mantas. Revisa en nuestro perfil cómo donar.', 'perfil', 'inicio', 'info', 'pendiente', 0, 20),
  )

  // Convenio activo con historial de canjes (el mes pasado se cumplió la meta) y otro esperando al asesor.
  // Fechas a mediodía: a la hora local de Chile, una hora nocturna ya cae en otro día (y mes) en UTC.
  const hoyLocal = new Date(), mediodia = (dia: number) => new Date(hoyLocal.getFullYear(), hoyLocal.getMonth(), dia, 12)
  const mesPasado = mediodia(0)
  const convenioVet: Convenio = {
    id: uid(), pyme_id: vet, ong_id: patitas, titulo: 'Consulta general con 10 % de descuento', descuento_pct: 10, condiciones: 'Presenta el código en recepción. No acumulable con otras ofertas.',
    codigo: 'PATITAS-SUR10', desde: dayOffset(-60), hasta: dayOffset(60), meta_mensual: 100, premio: 'Premio de alimentos PetSuite: 2 sacos de 15 kg', estado: 'activo', motivo: null,
    premios: [{ mes: mesPasado.toISOString().slice(0, 7), otorgado_en: mesPasado.toISOString() }], creado_en: t(),
  }
  db.convenios.push(convenioVet, {
    id: uid(), pyme_id: shop, ong_id: patitas, titulo: 'Accesorios con 15 % de descuento', descuento_pct: 15, condiciones: 'Válido en accesorios. Un uso por compra.',
    codigo: 'PATITAS-HUELLITAS15', desde: dayOffset(0), hasta: dayOffset(60), meta_mensual: 100, premio: 'Premio de alimentos PetSuite: 2 sacos de 15 kg', estado: 'pendiente_asesor', motivo: null, premios: [], creado_en: t(),
  })
  const diaDelMes = hoyLocal.getDate()
  for (let i = 0; i < 62; i++) db.canjes.push({ id: uid(), convenio_id: convenioVet.id, sucursal_id: null, monto_clp: 18_000, registrado_por: clinico, ocurrido_en: mediodia(diaDelMes - (i % diaDelMes)).toISOString() })
  for (let i = 0; i < 100; i++) db.canjes.push({ id: uid(), convenio_id: convenioVet.id, sucursal_id: null, monto_clp: 18_000, registrado_por: clinico, ocurrido_en: mediodia(-(i % 25)).toISOString() })

  db.correos.push(
    { id: uid(), para: 'jefe@petsuite.cl', asunto: 'Tu cuenta de equipo en Huellitas Osorno', tipo: 'cuenta_equipo', enviado_en: t(), cuerpo: 'Hola, Paula:\n\nHuellitas Osorno te dio acceso como jefe de local de Huellitas Puerto Montt.\n\nCorreo: jefe@petsuite.cl\nClave temporal: petsuite123\n\nTe recomendamos cambiarla al ingresar.\n\nEquipo PetSuite' },
    { id: uid(), para: 'tutor@petsuite.cl', asunto: 'Bienvenida a PetSuite', tipo: 'bienvenida', enviado_en: t(), cuerpo: 'Hola, Ana:\n\nTu cuenta de tutor está lista. Crea la Ficha Única de tu mascota y activa su QR de emergencia.\n\nEquipo PetSuite' },
  )
  db.solicitudes_privacidad.push({ id: uid(), usuario_id: tutor2, derecho: 'acceso', detalle: 'Quiero saber qué datos personales guarda PetSuite sobre mí.', estado: 'recibida', respuesta: null, creado_en: hace(3 * 1440), vence_en: dayOffset(27), respondido_en: null })
  return db
}

function stored(): Db | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Db
    value.contactos_pymes ??= [] // compatibilidad con datos demo guardados antes de añadir la bandeja
    return value
  } catch { return null /* almacenamiento no disponible o dañado */ }
}

export let db: Db = stored() ?? seed()

export function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)) } catch { /* sin almacenamiento, los datos duran hasta recargar */ }
}

// El seed se guarda de inmediato para que todas las pestañas compartan los mismos identificadores.
save()

/** Relee el estado guardado: otra pestaña (por ejemplo, la ficha pública del QR) pudo haberlo cambiado. */
export function refresh() {
  const s = stored()
  if (s) db = s
}

/** Restaura los datos de demostración y borra todo lo creado en este navegador. */
export function resetDemo() {
  db = seed()
  save()
}
