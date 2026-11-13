import { Check, Crown, Minus } from 'lucide-react'
import { clp } from '../../shared/api'
import { LogoMark } from '../../shared/media'
import { ShareButton } from '../../shared/share'
import { PLANES, destacadoTexto, etiquetasLimite, limiteTexto, metricasTexto, type Limites, type Plan } from './plans'

const filasLimite = Object.keys(etiquetasLimite) as (keyof Limites)[]
const si = (ok: boolean) => ok ? <Check size={16} aria-label="Incluido" /> : <Minus size={16} aria-label="No incluido" />

export function PlanBadge({ plan }: { plan: Pick<Plan, 'codigo' | 'nombre'> }) {
  return <span className={`plan-badge plan-${plan.codigo}`}>{plan.codigo === 'oro' && <Crown size={13} aria-hidden="true" />}{plan.nombre}</span>
}

// Comparativa de las cuatro capas. Si se indica onChoose, cada tarjeta ofrece contratarla.
export function PlanGrid({ actual, onChoose, chooseLabel = 'Elegir' }: { actual?: number; onChoose?: (plan: Plan) => void; chooseLabel?: string }) {
  return <div className="plan-grid" role="list" aria-label="Planes de suscripción">{PLANES.map(p => <article role="listitem" key={p.id} className={`plan-card plan-${p.codigo}${p.id === actual ? ' current' : ''}${p.codigo === 'plata' ? ' recommended' : ''}`}>
    <div className="plan-card-head"><PlanBadge plan={p} />{p.id === actual ? <span className="plan-flag">Tu plan</span> : p.codigo === 'plata' ? <span className="plan-flag">Más elegido</span> : null}</div>
    <p className="plan-price"><strong>{p.precio_mensual_clp ? clp(p.precio_mensual_clp) : '$0'}</strong><span>/mes</span></p>
    <p className="muted plan-summary">{p.resumen}</p>
    <ul className="plan-features">
      {filasLimite.map(k => <li key={k} className={p.limites[k] === 0 ? 'off' : ''}><span>{etiquetasLimite[k]}</span><b>{limiteTexto(p.limites[k])}</b></li>)}
      <li className={p.beneficios.portada ? '' : 'off'}><span>Portada propia</span>{si(p.beneficios.portada)}</li>
      <li className={p.beneficios.perfil_sucursal ? '' : 'off'}><span>Perfil por sucursal</span>{si(p.beneficios.perfil_sucursal)}</li>
      <li><span>Buscador</span><b>{destacadoTexto[p.beneficios.destacado]}</b></li>
      <li><span>Métricas</span><b>{metricasTexto[p.beneficios.metricas]}</b></li>
      <li><span>Soporte</span><b>{p.beneficios.soporte}</b></li>
    </ul>
    {onChoose && p.id !== actual && <button type="button" className={p.codigo === 'plata' ? 'primary full' : 'secondary full'} onClick={() => onChoose(p)}>{chooseLabel} {p.nombre}</button>}
  </article>)}</div>
}

// Uso actual frente a los límites del plan vigente: deja claro qué se acerca al tope.
export function UsageMeters({ plan, uso }: { plan: Plan; uso: Record<keyof Limites, number> }) {
  return <div className="usage-grid">{filasLimite.map(k => {
    const max = plan.limites[k], usado = uso[k], pct = max === null ? 0 : max === 0 ? 100 : Math.min(100, (usado / max) * 100)
    const estado = max === 0 ? 'none' : max !== null && usado >= max ? 'full' : pct >= 80 ? 'near' : 'ok'
    return <div key={k} className={`usage-meter ${estado}`}><div className="usage-head"><span>{etiquetasLimite[k]}</span><strong>{max === 0 ? 'No incluye' : `${usado} de ${max === null ? '∞' : max}`}</strong></div><div className="usage-bar" aria-hidden="true"><span style={{ width: `${max === null ? 8 : pct}%` }} /></div></div>
  })}</div>
}

// Página pública de planes (#planes): se comparte con negocios antes de crear la cuenta.
export function PublicPlans() {
  return <div className="emergency-page adoption-public"><main style={{ width: 'min(1180px, 100%)' }}><div className="public-emergency-brand" style={{ justifyContent: 'space-between' }}><span><span className="brand-mark"><LogoMark /></span> PetSuite <span>PLANES PARA NEGOCIOS</span></span><div className="public-actions"><ShareButton hash="#planes" title="Planes PetSuite para negocios" text="Planes Gratis, Bronce, Plata y Oro para veterinarias, tiendas y peluquerías." /><a className="secondary" href="#ingresar">Crear cuenta o ingresar</a></div></div>
    <section className="page"><div className="page-title"><div><p className="eyebrow">TARIFA PLANA, SIN COMISIONES POR VENTA</p><h1>Elige cómo quieres crecer con PetSuite</h1><p className="muted">Veterinarias, tiendas y peluquerías aparecen gratis en el directorio. Los planes pagados suman sucursales, equipo, ofertas, publicidad y convenios con ONG. Pagas con Mercado Pago o por transferencia, y puedes cambiar de plan en cualquier momento.</p></div></div>
      <PlanGrid />
      <div className="plan-rules role-panel"><p className="eyebrow">REGLAS CLARAS</p><ul>
        <li>El periodo dura 30 días. Al renovar o subir de plan, el nuevo periodo empieza cuando termina el que ya pagaste.</li>
        <li>Tras el vencimiento tienes 5 días de gracia con todos tus beneficios. Después tu negocio pasa a Gratis: no se borra nada, pero lo que excede el plan deja de publicarse.</li>
        <li>Con más de 30 días de mora, la deuda puede derivarse a cobranza con Orcob. Te avisamos antes por correo.</li>
        <li>Banners y convenios siempre los revisa un asesor PetSuite antes de publicarse. Las ONG participan sin costo.</li>
      </ul></div></section></main></div>
}
