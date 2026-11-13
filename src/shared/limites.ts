// Límites de solicitudes contra la fuerza bruta y el abuso, compartidos por el mock y el API.
// Cada regla cuenta eventos de una clave dentro de una ventana; al llegar al máximo, la ruta responde 429
// antes de ejecutarse. El API guarda solo la huella SHA-256 de cada clave, nunca el correo ni la IP.

export type Regla = { clave: string; max: number; segundos: number }
/** cuenta: qué resultado suma un evento. 'fallo' = credenciales incorrectas (401); 'exito' = la ruta respondió bien. */
export type Limite = { reglas: Regla[]; cuenta: 'fallo' | 'exito'; limpiarAlExito?: string; /** Estado que cuenta como fallo (401 si no se indica). */ estadoFallo?: number }

export const STATUS_DEMASIADOS = 429

function espera(segundos: number) {
  if (segundos < 3600) return `${Math.round(segundos / 60)} minutos`
  if (segundos === 3600) return 'una hora'
  return `${Math.round(segundos / 3600)} horas`
}
export const mensajeDemasiados = (segundos: number) => `Demasiados intentos. Espera ${espera(segundos)} y vuelve a intentarlo.`

const correoDe = (body: unknown) => {
  const c = (body as { correo?: unknown } | null | undefined)?.correo
  return typeof c === 'string' ? c.trim().toLowerCase().slice(0, 254) : ''
}

/**
 * Límites de una solicitud. cliente identifica a quien llama (huella de su IP en el API; 'local' en el mock).
 * - Ingreso: 5 contraseñas incorrectas por correo y cliente cada 15 minutos, y 30 por cliente (varias cuentas).
 * - Registro, reenvío de confirmación y recuperación: 10 envíos por cliente cada hora, para no usar PetSuite
 *   para llenar de correos a otras personas.
 * - Mensajes desde un QR: 5 por medalla y cliente cada hora, y 30 por medalla al día, para que nadie
 *   inunde de avisos al tutor.
 */
export function limitesDe(method: string, path: string, body: unknown, cliente: string): Limite | null {
  if (method !== 'POST') return null
  if (path === '/auth/login') {
    const porCuenta = `login:${correoDe(body)}:${cliente}`
    return { reglas: [{ clave: porCuenta, max: 5, segundos: 900 }, { clave: `login:${cliente}`, max: 30, segundos: 900 }], cuenta: 'fallo', limpiarAlExito: porCuenta }
  }
  if (path === '/auth/registro' || path === '/auth/reenviar-verificacion' || path === '/auth/recuperar') {
    return { reglas: [{ clave: `correos:${cliente}`, max: 10, segundos: 3600 }], cuenta: 'exito' }
  }
  // Cambiar la contraseña: como el ingreso, 5 contraseñas actuales incorrectas por cliente cada 15 minutos.
  if (path === '/auth/cambiar-clave') return { reglas: [{ clave: `cambiar-clave:${cliente}`, max: 5, segundos: 900 }], cuenta: 'fallo', estadoFallo: 403 }
  // Avisos de Mercado Pago: públicos, así que se limitan (300 por cliente cada hora; Mercado Pago reintenta si recibe 429).
  if (path === '/pagos/mercadopago/webhook') return { reglas: [{ clave: `mp:${cliente}`, max: 300, segundos: 3600 }], cuenta: 'exito' }
  // Fotos: 30 por cliente cada hora (además del máximo de fotos por cuenta).
  if (path === '/imagenes') return { reglas: [{ clave: `imagenes:${cliente}`, max: 30, segundos: 3600 }], cuenta: 'exito' }
  const qr = /^\/qr\/([^/]+)\/mensajes$/.exec(path)
  if (qr) {
    return { reglas: [{ clave: `qr:${qr[1]}:${cliente}`, max: 5, segundos: 3600 }, { clave: `qr:${qr[1]}`, max: 30, segundos: 86_400 }], cuenta: 'exito' }
  }
  return null
}

/** El estado de la respuesta que suma un evento según la regla. */
export const sumaEvento = (limite: Limite, status: number) => limite.cuenta === 'exito' ? status < 400 : status === (limite.estadoFallo ?? 401)
