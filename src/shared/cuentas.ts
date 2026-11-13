// Reglas compartidas de las cuentas reales: confirmación de correo, recuperación de contraseña e invitaciones.
// Las usan el mock, el API con PostgreSQL y el frontend, para que plazos, mensajes y correos no se desalineen.
import { z } from 'zod'

/** Cambios del perfil desde Configuración: nombre visible y comuna (el correo no se cambia ahí). */
export const perfilSchema = z.object({
  nombre_visible: z.string().trim().min(2, 'Ingresa tu nombre').max(80).optional(),
  comuna_id: z.number().int().positive().optional(),
})
/** Cambio de contraseña con la actual, desde Configuración. */
export const cambiarClaveSchema = z.object({
  actual: z.string().min(1, 'Ingresa tu contraseña actual').max(72),
  nueva: z.string().min(8, 'La contraseña nueva debe tener al menos 8 caracteres').max(72),
}).refine(d => d.actual !== d.nueva, { message: 'La contraseña nueva debe ser distinta de la actual', path: ['nueva'] })
export const CLAVE_ACTUAL_INCORRECTA = 'La contraseña actual no es correcta'

/** 403 al ingresar con la clave correcta y el correo sin confirmar. El frontend lo reconoce para ofrecer el reenvío. */
export const CORREO_SIN_CONFIRMAR = 'Confirma tu correo para ingresar. Revisa tu bandeja de entrada o pide un nuevo enlace.'
export const ENLACE_INVALIDO = 'El enlace no es válido o ya venció. Pide uno nuevo desde la pantalla de ingreso.'
/** Entre dos correos del mismo tipo a una cuenta, para que nadie use PetSuite para llenar una bandeja ajena. */
export const SEGUNDOS_ENTRE_ENVIOS = 60

export type TipoToken = 'verificacion' | 'restablecer' | 'invitacion'
/** Vigencia de cada enlace, en horas. */
export const VIGENCIA_HORAS: Record<TipoToken, number> = { verificacion: 24, restablecer: 1, invitacion: 24 * 7 }

const RUTA: Record<TipoToken, string> = { verificacion: 'verificar', restablecer: 'restablecer', invitacion: 'restablecer' }
/** Enlace a la app con el token en el hash: nunca viaja al servidor de páginas ni queda en sus registros. */
export const enlaceCuenta = (base: string, tipo: TipoToken, token: string) => `${base.replace(/\/?$/, '/')}#${RUTA[tipo]}/${token}`

const bienvenida: Record<string, string> = {
  pyme: 'Después registra tu negocio y elige un plan: el plan Gratis te publica en el directorio sin costo.',
  ong: 'Después registra tu organización: participar es gratis.',
  tutor: 'Después crea la Ficha Única de tu mascota y activa su QR de emergencia.',
}

export const correoVerificacion = (nombre: string, rol: string, enlace: string) => ({
  asunto: 'Confirma tu correo en PetSuite',
  cuerpo: `Hola, ${nombre}:\n\nPara activar tu cuenta, abre este enlace:\n${enlace}\n\nVence en ${VIGENCIA_HORAS.verificacion} horas. ${bienvenida[rol] ?? bienvenida.tutor}\n\nSi no creaste una cuenta en PetSuite, ignora este correo.\n\nEquipo PetSuite`,
})

export const correoRestablecer = (nombre: string, enlace: string) => ({
  asunto: 'Crea una nueva contraseña en PetSuite',
  cuerpo: `Hola, ${nombre}:\n\nRecibimos una solicitud para cambiar tu contraseña. Abre este enlace para crear una nueva:\n${enlace}\n\nVence en ${VIGENCIA_HORAS.restablecer} hora. Si no la pediste, ignora este correo: tu contraseña actual sigue funcionando.\n\nEquipo PetSuite`,
})

export const correoEquipo = (d: { nombre: string; negocio: string; rol: 'jefe_local' | 'clinico'; lugar: string; permisos: string[]; enlace: string }) => ({
  asunto: `Tu cuenta de equipo en ${d.negocio}`,
  cuerpo: `Hola, ${d.nombre}:\n\n${d.negocio} te dio acceso como ${d.rol === 'clinico' ? 'personal clínico' : 'jefe de local'} de ${d.lugar}.\n\nCrea tu contraseña con este enlace (vence en ${VIGENCIA_HORAS.invitacion / 24} días):\n${d.enlace}\n\nPodrás usar: ${d.permisos.join(', ')}.\n\nEquipo PetSuite`,
})

export const correoCuentaCreada = (d: { nombre: string; asesor: string; tipo: 'pyme' | 'ong'; enlace: string }) => ({
  asunto: 'Tu cuenta PetSuite está lista',
  cuerpo: `Hola, ${d.nombre}:\n\n${d.asesor}, tu asesor PetSuite, creó tu cuenta de ${d.tipo === 'pyme' ? 'negocio' : 'organización'}.\n\nCrea tu contraseña con este enlace (vence en ${VIGENCIA_HORAS.invitacion / 24} días):\n${d.enlace}\n\nAl ingresar, registra ${d.tipo === 'pyme' ? 'tu negocio y elige un plan (Gratis, Bronce, Plata u Oro)' : 'tu organización; participar es gratis'}. Al primer ingreso te pediremos aceptar el aviso de privacidad.\n\nEquipo PetSuite`,
})
