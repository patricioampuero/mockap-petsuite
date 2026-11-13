import { useId } from 'react'
import { iniciales, recursoApi } from './api'

// Imágenes de demostración de Pexels (licencia libre). Créditos en public/img/CREDITOS.md.
export const rubroFoto: Record<string, string> = {
  veterinaria: '/img/vet-2.jpg',
  tienda: '/img/collares.jpg',
  peluqueria: '/img/groomer-2.jpg',
  otro: '/img/accesorios.jpg',
}

// Las rutas de /public se resuelven contra la base del sitio (en GitHub Pages es /mockap-petsuite/); las fotos subidas
// (/api/v1/imagenes/<id>) contra el API. Las data: URL de la demo se usan tal cual.
export const assetUrl = (src: string) => src.startsWith('/api/') ? recursoApi(src) : src.startsWith('/') ? `${import.meta.env.BASE_URL}${src.slice(1)}` : src

/**
 * Foto de un negocio en Explorar: su portada o, si no tiene, una foto de muestra de su rubro. Una ficha con información
 * pública no lleva foto de muestra (se podría creer que es su local): muestra sus iniciales.
 */
export const fotoNegocio = (p: { foto_portada?: string | null; rubro: string; sin_reclamar?: boolean }) =>
  p.sin_reclamar ? null : p.foto_portada || rubroFoto[p.rubro] || rubroFoto.otro

/** Foto de mascota o animal; si no hay foto, muestra sus iniciales. */
export function Photo({ src, nombre, className = 'pet-photo' }: { src?: string | null; nombre: string; className?: string }) {
  if (!src) return <div className={className}>{iniciales(nombre)}</div>
  return <div className={`${className} has-photo`} role="img" aria-label={`Foto de ${nombre}`} style={{ background: `url(${assetUrl(src)}) center / cover no-repeat` }} />
}

/** Logotipo de PetSuite: medalla con huella. Es el mismo dibujo de public/icon.svg. */
export function LogoMark({ size = 34 }: { size?: number }) {
  // Id propio por logo: si dos compartieran id y el primero estuviera oculto, el otro perdería su degradado.
  const gradient = `ps-logo-bg-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
    <defs><linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#17a394" /><stop offset="1" stopColor="#0a5c55" /></linearGradient></defs>
    <rect width="512" height="512" rx="116" fill={`url(#${gradient})`} />
    <circle cx="256" cy="112" r="34" fill="none" stroke="#fff" strokeWidth="22" />
    <circle cx="256" cy="296" r="148" fill="#fff" />
    <g fill="#0e7c72">
      <ellipse cx="256" cy="336" rx="62" ry="48" />
      <ellipse cx="186" cy="268" rx="22" ry="30" transform="rotate(-22 186 268)" />
      <ellipse cx="230" cy="226" rx="22" ry="32" transform="rotate(-6 230 226)" />
      <ellipse cx="282" cy="226" rx="22" ry="32" transform="rotate(6 282 226)" />
      <ellipse cx="326" cy="268" rx="22" ry="30" transform="rotate(22 326 268)" />
    </g>
    <circle cx="356" cy="182" r="20" fill="#f28c28" />
  </svg>
}

/** Marcador de carga con forma de tarjetas, para no dejar la pantalla vacía mientras llegan los datos. */
export function Loading({ rows = 3, label = 'Cargando' }: { rows?: number; label?: string }) {
  return <div className="skeleton-list" role="status" aria-label={label}>
    {Array.from({ length: rows }, (_, i) => <div className="skeleton-card" key={i}><div className="skeleton skeleton-photo" /><div className="skeleton-lines"><div className="skeleton skeleton-line w60" /><div className="skeleton skeleton-line w40" /><div className="skeleton skeleton-line w80" /></div></div>)}
  </div>
}
