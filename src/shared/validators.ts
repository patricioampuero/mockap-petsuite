import { z } from 'zod'

export const loginSchema = z.object({
  email: z.email('Ingresa un correo válido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
})

export const emailSchema = z.object({ email: z.email('Ingresa un correo válido') })

export const newPasswordSchema = z.object({
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(72, 'La contraseña admite hasta 72 caracteres'),
  confirm: z.string(),
}).refine(d => d.password === d.confirm, { message: 'Las contraseñas no coinciden', path: ['confirm'] })

export const petSchema = z.object({
  name: z.string().trim().min(2, 'Ingresa el nombre de tu mascota').max(80, 'El nombre no puede superar 80 caracteres'),
  species: z.string().trim().min(2, 'Ingresa la especie').max(60, 'La especie es demasiado larga'),
  breed: z.string().trim().min(2, 'Ingresa la raza').max(80, 'La raza es demasiado larga'),
  age: z.coerce.number().min(0).max(40),
  weight: z.coerce.number().positive('El peso debe ser mayor que cero'),
  color: z.string().trim().min(2, 'Ingresa el color').max(80, 'El color es demasiado largo'),
})

const healthList = z.string().max(240, 'Resume los datos en menos de 240 caracteres').refine(value => {
  const items = value.split(',').map(item => item.trim()).filter(Boolean)
  return items.length <= 8 && items.every(item => item.length <= 80)
}, 'Usa hasta 8 elementos de máximo 80 caracteres, separados por comas')

export const petHealthSchema = z.object({
  allergies: healthList,
  conditions: healthList,
  medications: healthList,
  emergencyNotes: z.string().max(160, 'La nota pública no puede superar 160 caracteres'),
})

export const medicalEntrySchema = z.object({
  date: z.iso.date('Indica una fecha válida'),
  type: z.enum(['Vacuna', 'Atención', 'Tratamiento']),
  title: z.string().trim().min(3, 'Describe la atención').max(80, 'Usa un título más breve'),
  notes: z.string().trim().max(500, 'La descripción no puede superar 500 caracteres'),
})

export const publicPetSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  species: z.string().min(1).max(60),
  breed: z.string().min(1).max(80),
  initials: z.string().max(4),
  allergies: z.array(z.string().max(80)).max(8),
  conditions: z.array(z.string().max(80)).max(8),
  emergencyNotes: z.string().max(160),
})

export const emergencyContactSchema = z.object({ message: z.string().trim().min(10, 'Escribe al menos 10 caracteres').max(500, 'El mensaje es demasiado largo') })

export const communityPostSchema = z.object({
  type: z.enum(['Extravío', 'Encuentro', 'Recomendación']),
  title: z.string().min(5, 'El título debe tener al menos 5 caracteres'),
  body: z.string().min(15, 'Cuéntanos un poco más para ayudar a la comunidad'),
  location: z.string().min(2, 'Ingresa una comuna o ubicación'),
})

export const communityCommentSchema = z.object({
  text: z.string().trim().min(3, 'Escribe un comentario de al menos 3 caracteres').max(1000),
})

export const moderationMessageSchema = z.string().trim().min(10, 'Escribe un mensaje de al menos 10 caracteres').max(1000, 'El mensaje no puede superar 1000 caracteres')

export const moderationSuspensionSchema = z.object({
  duration: z.enum(['temporary', 'permanent']),
  days: z.coerce.number().int('Ingresa un número entero de días').min(1, 'Indica al menos 1 día').max(3650, 'El máximo es 3650 días'),
  message: moderationMessageSchema,
})

export const userSuspensionSchema = z.object({
  tipo: z.enum(['temporal', 'permanente']),
  dias: z.number().int('Indica un número entero de días').min(1, 'La suspensión temporal debe durar al menos 1 día').max(3650, 'El máximo es 3650 días').nullable(),
  motivo: z.enum(['acoso', 'spam', 'contenido_inapropiado', 'suplantacion', 'incumplimiento_normas', 'otro']),
  mensaje: z.string().trim().min(10, 'Explica la decisión en al menos 10 caracteres').max(1000, 'El mensaje no puede superar 1000 caracteres'),
}).refine(data => data.tipo === 'temporal' ? data.dias !== null : data.dias === null, 'Indica los días solo para la suspensión temporal')

export const businessProfileSchema = z.object({
  nombre_comercial: z.string().trim().min(2, 'Ingresa el nombre del negocio').max(100),
  descripcion: z.string().trim().max(1000),
  comuna_id: z.number().int().positive(),
  direccion: z.string().trim().max(200),
  telefono: z.string().trim().max(20),
  whatsapp: z.string().trim().max(20),
  horario: z.object({ 'lun-vie': z.string().trim().max(80), sab: z.string().trim().max(80), dom: z.string().trim().max(80) }),
  servicios: z.array(z.string().trim().min(2, 'Cada servicio debe tener al menos 2 caracteres').max(40, 'Cada servicio admite hasta 40 caracteres')).max(12, 'Puedes destacar hasta 12 servicios').default([]),
  latitud: z.number().min(-90).max(90).nullable(),
  longitud: z.number().min(-180).max(180).nullable(),
  // Una foto de muestra o una subida por el negocio (/api/v1/imagenes/<id> en el API; data: URL en la demo).
  foto_portada: z.union([
    z.enum(['/img/vet-2.jpg', '/img/collares.jpg', '/img/groomer-2.jpg', '/img/accesorios.jpg']),
    z.string().regex(/^\/api\/v1\/imagenes\/[0-9a-f-]{36}$/),
    z.string().max(900_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/),
  ], { message: 'Portada no válida' }).nullable(),
}).refine(data => (data.latitud === null) === (data.longitud === null), 'Indica latitud y longitud juntas')

export const businessContactSchema = z.object({
  mensaje: z.string().trim().min(10, 'Cuéntale al negocio qué necesitas (mínimo 10 caracteres)').max(500),
  contacto: z.string().trim().max(120, 'El contacto no puede superar 120 caracteres'),
})

export const businessReplySchema = z.object({
  respuesta: z.string().trim().min(3, 'Escribe una respuesta').max(500, 'La respuesta no puede superar 500 caracteres'),
})

export const catalogItemFormSchema = z.object({
  tipo: z.enum(['producto', 'servicio']),
  nombre: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(120),
  descripcion: z.string().trim().max(1000),
  precio: z.string().trim().refine(value => value === '' || /^\d+$/.test(value) && Number(value) <= 100_000_000, 'Ingresa un precio válido en pesos, sin puntos ni símbolos'),
})

export const registerPymeSchema = z.object({
  nombre_comercial: z.string().trim().min(2, 'Ingresa el nombre de tu negocio').max(100),
  rut_empresa: z.string().trim().regex(/^\d{7,8}-[\dkK]$/, 'RUT de empresa inválido (ej. 76123456-7)'),
  rubro: z.enum(['veterinaria', 'tienda', 'peluqueria', 'otro']),
  comuna_id: z.number().int().positive('Elige una comuna'),
  direccion: z.string().trim().max(200),
  telefono: z.string().trim().max(20),
  whatsapp: z.string().trim().max(20),
  descripcion: z.string().trim().max(1000),
  plan_id: z.number().int().positive('Elige un plan'),
  referencia_pago: z.string().trim().max(60),
  latitud: z.number().min(-90).max(90).nullable(),
  longitud: z.number().min(-180).max(180).nullable(),
}).refine(data => (data.latitud === null) === (data.longitud === null), 'Indica latitud y longitud juntas')

export const registrationSchema = z.object({
  email: z.email('Ingresa un correo válido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(72),
  name: z.string().trim().min(2, 'Ingresa tu nombre').max(80),
  comunaId: z.number().int().positive('Elige una comuna'),
  terms: z.literal(true, { message: 'Debes aceptar los términos de uso' }),
  privacy: z.literal(true, { message: 'Debes autorizar el tratamiento de tus datos para crear la cuenta' }),
})

export const petDetailsSchema = z.object({
  nombre: z.string().trim().min(2, 'Ingresa el nombre de tu mascota').max(60),
  especie: z.string().trim().min(1, 'Elige una especie').max(20),
  raza: z.string().trim().max(60),
  sexo: z.enum(['macho', 'hembra', 'desconocido']),
  fecha_nacimiento: z.string().refine(value => !value || z.iso.date().safeParse(value).success && value <= new Date().toISOString().slice(0, 10), 'Indica una fecha válida, no futura'),
})

export const wallPostSchema = z.object({
  tipo: z.enum(['extravio', 'encuentro', 'recomendacion']),
  texto: z.string().trim().min(15, 'Cuéntanos un poco más para ayudar a la comunidad').max(1000),
})

export type LoginInput = z.infer<typeof loginSchema>
export type PetInput = z.infer<typeof petSchema>
export type CommunityPostInput = z.infer<typeof communityPostSchema>
