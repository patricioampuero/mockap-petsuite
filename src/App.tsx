import { useEffect, useRef, useState } from 'react'
import { BadgePercent, Briefcase, Building2, ChartColumn, Check, ChevronDown, ClipboardCheck, Compass, CreditCard, FileCheck, FileUser, Heart, HeartHandshake, House, Landmark, Lock, LogOut, Mail, Megaphone, Menu, MessageCircle, MessagesSquare, Package, PanelLeftClose, PanelLeftOpen, PawPrint, Settings, ShieldCheck, Stethoscope, Store, UserPlus, Users, UsersRound, X } from 'lucide-react'
import { LogoMark } from './shared/media'
import { api, getSession, modoDemo, setSession, type ApiRole, type Session } from './shared/api'
import { Login } from './modules/auth/Login'
import { ResetPassword, VerifyEmail } from './modules/auth/AccountLinks'
import { EmergencyView, TutorArea } from './modules/tutor/tutor'
import { BusinessArea } from './modules/business/business'
import { ClinicalArea } from './modules/clinical/clinical'
import { AdminArea } from './modules/admin/admin'
import { AdoptionCatalog, OngArea } from './modules/ong/adoption'
import { PublicOngProfile } from './modules/ong/ong-profile'
import { PublicPlans } from './modules/plans/plans-ui'
import { Landing } from './modules/landing/landing'
import { ExplorePage } from './modules/directory/explore'
import { PublicBusiness } from './modules/directory/public-business'
import { MyInbox, PrivacyCenter } from './modules/privacy/privacy'
import { resetDemo } from './mock/db'
import { rolLabel, type Modulo } from './shared/permissions'

// [etiqueta, vista, módulo requerido]. Sin módulo, la vista es parte fija del rol.
type MenuItem = readonly [string, string, Modulo?]
// Las opciones se agrupan en secciones desplegables; Inicio y Configuración quedan sueltos.
type MenuGroup = { grupo: string; icono: typeof House; items: readonly MenuItem[] }
type MenuEntry = MenuItem | MenuGroup
const esGrupo = (entry: MenuEntry): entry is MenuGroup => !Array.isArray(entry)
const menuEmpresa = (perfil: string): MenuEntry[] => [
  ['Inicio', 'business-home'],
  { grupo: 'Mi negocio', icono: Briefcase, items: [[perfil, 'business-profile', 'perfil'], ['Documentos', 'documents', 'perfil'], ['Sucursales', 'branches', 'sucursales'], ['Catálogo', 'catalog', 'catalogo'], ['Equipo', 'team', 'equipo']] },
  { grupo: 'Clientes', icono: MessagesSquare, items: [['Consultas', 'contacts', 'contactos'], ['Métricas', 'metrics', 'metricas']] },
  { grupo: 'Promoción', icono: Megaphone, items: [['Publicidad', 'ads', 'publicidad'], ['Convenios', 'agreements', 'convenios']] },
  { grupo: 'Cuenta', icono: CreditCard, items: [['Suscripción', 'subscription', 'suscripcion'], ['Configuración', 'settings']] },
]
const roleMenus: Record<ApiRole, readonly MenuEntry[]> = {
  tutor: [['Inicio', 'home'], ['Mis mascotas', 'pets'], { grupo: 'Explorar y adoptar', icono: Compass, items: [['Directorio', 'directory'], ['Adopciones', 'adoption']] }, ['Muro comunal', 'community'], ['Configuración', 'settings']],
  ong: [['Inicio', 'ong-home'], { grupo: 'Mi organización', icono: HeartHandshake, items: [['Perfil público', 'ong-profile'], ['Mis animales', 'animals']] }, { grupo: 'Alianzas y difusión', icono: Megaphone, items: [['Convenios', 'ong-agreements'], ['Publicidad', 'ong-ads']] }, ['Configuración', 'settings']],
  pyme: menuEmpresa('Perfil del negocio'),
  jefe_local: menuEmpresa('Perfil del local'),
  clinico: [['Inicio', 'clinical-home'], { grupo: 'Atención', icono: Stethoscope, items: [['Pacientes', 'patients', 'pacientes'], ['Consultas', 'contacts', 'contactos']] }, ['Configuración', 'settings']],
  asesor: [['Inicio', 'admin-home'], { grupo: 'Cuentas', icono: Building2, items: [['Pymes y suscripciones', 'subscriptions', 'cuentas'], ['ONG', 'ongs', 'cuentas'], ['Crear cuentas', 'accounts', 'cuentas']] }, { grupo: 'Gestión', icono: ClipboardCheck, items: [['Aprobaciones', 'approvals', 'aprobaciones'], ['Cobranza', 'collections', 'cobranza'], ['Correos', 'emails', 'correos']] }, ['Configuración', 'settings']],
  admin: [['Inicio', 'admin-home'], { grupo: 'Comunidad', icono: Users, items: [['Usuarios', 'users', 'usuarios'], ['Moderación', 'moderation', 'moderacion']] }, { grupo: 'Cuentas comerciales', icono: Building2, items: [['Pymes y suscripciones', 'subscriptions', 'cuentas'], ['ONG', 'ongs', 'cuentas'], ['Aprobaciones', 'approvals', 'aprobaciones'], ['Cobranza', 'collections', 'cobranza']] }, { grupo: 'Cumplimiento', icono: Lock, items: [['Privacidad', 'privacy-admin', 'privacidad'], ['Correos', 'emails', 'correos']] }, ['Configuración', 'settings']],
}

// Quita las vistas sin permiso; una sección vacía desaparece y una de una sola opción se muestra suelta.
function menuVisible(entries: readonly MenuEntry[], permisos: readonly string[] | undefined): MenuEntry[] {
  const puede = ([, , modulo]: MenuItem) => !modulo || !!permisos?.includes(modulo)
  const visibles: MenuEntry[] = []
  for (const entry of entries) {
    if (!esGrupo(entry)) { if (puede(entry)) visibles.push(entry); continue }
    const items = entry.items.filter(puede)
    if (items.length > 1) visibles.push({ ...entry, items })
    else visibles.push(...items)
  }
  return visibles
}
const vistasDe = (entries: readonly MenuEntry[]) => entries.flatMap(entry => esGrupo(entry) ? entry.items : [entry])
const firstView: Record<ApiRole, string> = { tutor: 'home', pyme: 'business-home', jefe_local: 'business-home', clinico: 'clinical-home', asesor: 'admin-home', admin: 'admin-home', ong: 'ong-home' }

const navIcons: Record<string, typeof House> = {
  home: House, pets: PawPrint, directory: Store, community: Users, settings: Settings,
  'business-home': House, 'business-profile': Store, documents: FileCheck, branches: Building2, catalog: Package, contacts: MessageCircle, team: UsersRound, ads: Megaphone, agreements: BadgePercent, metrics: ChartColumn, subscription: CreditCard,
  'clinical-home': House, patients: Stethoscope, 'admin-home': House, users: Users, moderation: ShieldCheck, subscriptions: CreditCard,
  adoption: Heart, 'ong-home': House, 'ong-profile': FileUser, animals: PawPrint, 'ong-agreements': BadgePercent, 'ong-ads': Megaphone, ongs: ShieldCheck,
  approvals: ClipboardCheck, collections: Landmark, accounts: UserPlus, emails: Mail, 'privacy-admin': Lock,
}


/** Menú del rol con secciones desplegables. Se abre sola la sección de la vista actual. */
function SideNav({ entries, active, onSelect }: { entries: readonly MenuEntry[]; active: string; onSelect: (id: string) => void }) {
  const grupoDe = (id: string) => entries.find((entry): entry is MenuGroup => esGrupo(entry) && entry.items.some(([, vista]) => vista === id))?.grupo
  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set([grupoDe(active)].filter((g): g is string => !!g)))
  useEffect(() => { const grupo = grupoDe(active); if (grupo) setAbiertos(prev => prev.has(grupo) ? prev : new Set(prev).add(grupo)) }, [active])
  const alternar = (grupo: string) => setAbiertos(prev => { const next = new Set(prev); if (!next.delete(grupo)) next.add(grupo); return next })
  const opcion = ([label, id]: MenuItem) => { const Icon = navIcons[id]; return <button type="button" className={active === id ? 'nav-item active' : 'nav-item'} aria-current={active === id ? 'page' : undefined} aria-label={label} title={label} onClick={() => onSelect(id)} key={id}><Icon className="nav-icon" size={19} strokeWidth={1.8} /><span>{label}</span></button> }
  return <nav aria-label="Navegación principal">{entries.map(entry => {
    if (!esGrupo(entry)) return opcion(entry)
    const abierto = abiertos.has(entry.grupo)
    const panel = `menu-${entry.grupo.normalize('NFD').replace(/[^a-zA-Z]+/g, '-').toLowerCase()}`
    const Icon = entry.icono
    return <div className="nav-group" key={entry.grupo}>
      <button type="button" className={entry.items.some(([, id]) => id === active) ? 'nav-group-toggle has-active' : 'nav-group-toggle'} aria-expanded={abierto} aria-controls={panel} onClick={() => alternar(entry.grupo)}><Icon className="nav-icon" size={19} strokeWidth={1.8} aria-hidden="true" /><span>{entry.grupo}</span><ChevronDown className="nav-group-chevron" size={16} aria-hidden="true" /></button>
      <div id={panel} className={abierto ? 'nav-group-items' : 'nav-group-items is-closed'} role="group" aria-label={entry.grupo}>{entry.items.map(opcion)}</div>
    </div>
  })}</nav>
}

type ThemeName = 'original' | 'océano' | 'bosque' | 'lavanda' | 'coral' | 'vino'
type ColorMode = 'light' | 'dark' | 'system'

const themeOptions: { name: ThemeName; color: string; label: string }[] = [
  { name: 'original', color: '#0e7c72', label: 'PetSuite' },
  { name: 'océano', color: '#1a6fa0', label: 'Océano' },
  { name: 'bosque', color: '#3a7d44', label: 'Bosque' },
  { name: 'lavanda', color: '#6b4fbb', label: 'Lavanda' },
  { name: 'coral', color: '#d4553f', label: 'Coral' },
  { name: 'vino', color: '#8a3a55', label: 'Vino' },
]


function applyAppearance(theme: ThemeName, mode: ColorMode, brightness: number) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.dataset.mode = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'
  root.style.setProperty('--brightness-dark', `${Math.max(0, 100 - brightness) * 0.7}%`)
  root.style.setProperty('--brightness-light', `${Math.max(0, brightness - 100) * 0.45}%`)
}

const roleLabels = rolLabel

type Profile = { name: string; email: string; phone: string; avatar: string }

function App() {
  const [user, setUser] = useState<Session | null>(getSession)
  const [active, setActive] = useState(() => { const s = getSession(); return s ? firstView[s.rol] : 'home' })
  const [theme, setTheme] = useState<ThemeName>(() => {
    const stored = localStorage.getItem('petsuite-theme')
    return themeOptions.some(option => option.name === stored) ? stored as ThemeName : 'original'
  })
  const [mode, setMode] = useState<ColorMode>(() => (localStorage.getItem('petsuite-mode') as ColorMode) || 'light')
  const [brightness, setBrightness] = useState(() => Number(localStorage.getItem('petsuite-brightness')) || 100)
  const [profile, setProfile] = useState<Profile>({ name: '', email: '', phone: '', avatar: '' })
  const [hash, setHash] = useState(window.location.hash)
  // Escritorio: el menú se contrae a íconos y se recuerda en este navegador. Hasta 800 px se abre con ☰ como panel.
  const [contraido, setContraido] = useState(() => { try { return localStorage.getItem('petsuite-menu-contraido') === '1' } catch { return false } })
  const [menuAbierto, setMenuAbierto] = useState(false)
  const menuBoton = useRef<HTMLButtonElement>(null)
  // Al cerrar el panel, el foco vuelve a ☰ después de que el contenido deja de estar inerte.
  const volverFoco = useRef(false)
  useEffect(() => { try { localStorage.setItem('petsuite-menu-contraido', contraido ? '1' : '0') } catch { /* almacenamiento no disponible */ } }, [contraido])
  useEffect(() => {
    if (!menuAbierto) {
      if (volverFoco.current) { volverFoco.current = false; menuBoton.current?.focus() }
      return
    }
    document.querySelector<HTMLElement>('#menu-lateral .sidebar-close')?.focus()
    const escritorio = window.matchMedia('(min-width: 801px)')
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); volverFoco.current = true; setMenuAbierto(false) } }
    const onAncho = () => { if (escritorio.matches) setMenuAbierto(false) }
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    escritorio.addEventListener('change', onAncho)
    return () => { document.removeEventListener('keydown', onKey); escritorio.removeEventListener('change', onAncho); document.body.style.overflow = overflow }
  }, [menuAbierto])

  useEffect(() => {
    const applyMode = () => applyAppearance(theme, mode, brightness)
    applyMode(); localStorage.setItem('petsuite-theme', theme); localStorage.setItem('petsuite-mode', mode); localStorage.setItem('petsuite-brightness', String(brightness))
    if (mode === 'system') { const media = window.matchMedia('(prefers-color-scheme: dark)'); media.addEventListener('change', applyMode); return () => media.removeEventListener('change', applyMode) }
  }, [theme, mode, brightness])

  useEffect(() => { const updateHash = () => setHash(window.location.hash); window.addEventListener('hashchange', updateHash); return () => window.removeEventListener('hashchange', updateHash) }, [])

  // El perfil se completa con los datos reales de la cuenta; teléfono y avatar son preferencias locales de este navegador.
  useEffect(() => {
    if (!user) return
    const stored = JSON.parse(localStorage.getItem(`petsuite-profile-${user.id}`) || '{}') as Partial<Profile>
    setProfile({ name: user.nombre, email: '', phone: stored.phone || '', avatar: user.nombre.slice(0, 2).toUpperCase() })
    // Los permisos se releen del servidor: el dueño de la Pyme pudo cambiarlos desde otra sesión.
    api<{ correo: string; permisos: string[] }>('/auth/yo').then(me => {
      setProfile(p => ({ ...p, email: me.correo }))
      if (JSON.stringify(me.permisos) !== JSON.stringify(user.permisos)) { const next = { ...user, permisos: me.permisos }; setSession(next); setUser(next) }
    }).catch(() => undefined)
  }, [user])

  if (hash.startsWith('#qr/')) return <EmergencyView token={hash.slice(4)} />
  if (hash.startsWith('#emergency/')) return <EmergencyView token={null} />
  if (hash.startsWith('#adopciones')) return <AdoptionCatalog standalone />
  if (hash.startsWith('#ong/')) return <PublicOngProfile id={hash.slice(5)} />
  if (hash.startsWith('#planes')) return <PublicPlans />
  if (hash.startsWith('#explorar')) return <ExplorePage hash={hash} />
  if (hash.startsWith('#local/')) return <PublicBusiness key={hash} id={hash.slice(7).split('?')[0]} />

  // Cambia la dirección sin dejar en el historial el enlace anterior (por ejemplo, un token de un solo uso).
  const goTo = (next: string) => { window.history.replaceState(null, '', window.location.pathname + window.location.search + next); setHash(next) }
  const enter = (session: Session) => { goTo(''); setUser(session); setActive(firstView[session.rol]) }
  const logout = () => { setSession(null); setUser(null); setMenuAbierto(false) }
  const leaveLink = () => goTo('#ingresar')
  if (hash.startsWith('#verificar/')) return <VerifyEmail token={hash.slice(11)} onLogin={enter} onExit={leaveLink} />
  // Una contraseña nueva cierra las sesiones en el servidor: también se cierra la de este navegador.
  if (hash.startsWith('#restablecer/')) return <ResetPassword token={hash.slice(13)} onDone={logout} onExit={leaveLink} />
  // Sin sesión, la raíz es la landing; el ingreso y el registro tienen su propia dirección.
  if (!user) return hash.startsWith('#ingresar') || hash.startsWith('#registro') ? <Login key={hash} initialMode={hash.startsWith('#registro') ? 'register' : 'login'} onLogin={enter} /> : <Landing />
  const saveProfile = (next: Profile) => { setProfile(next); localStorage.setItem(`petsuite-profile-${user.id}`, JSON.stringify({ phone: next.phone })) }
  const menu = menuVisible(roleMenus[user.rol], user.permisos)
  const ir = (id: string) => { setActive(id); setMenuAbierto(false) }
  const cerrarMenu = () => { volverFoco.current = true; setMenuAbierto(false) }

  return (
    <div className={contraido ? 'app-shell menu-collapsed' : 'app-shell'}>
      <aside id="menu-lateral" className={menuAbierto ? 'sidebar is-open' : 'sidebar'} aria-label="Menú">
        <div className="sidebar-head">
          <div className="brand"><span className="brand-mark"><LogoMark /></span><span>Pet<span>Suite</span></span></div>
          <button type="button" className="sidebar-toggle" aria-label={contraido ? 'Expandir el menú' : 'Contraer el menú'} title={contraido ? 'Expandir el menú' : 'Contraer el menú'} onClick={() => setContraido(!contraido)}>{contraido ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}</button>
          <button type="button" className="sidebar-close" aria-label="Cerrar el menú" onClick={cerrarMenu}><X size={20} aria-hidden="true" /></button>
        </div>
        <div className="profile-mini"><div className="avatar">{user.nombre.slice(0, 2).toUpperCase()}</div><div><strong>{user.nombre}</strong><small>{roleLabels[user.rol]}</small></div></div>
        <SideNav entries={menu} active={active} onSelect={ir} />
        <div className="sidebar-bottom"><button type="button" className="sidebar-logout" onClick={logout} title="Cerrar sesión"><LogOut size={18} aria-hidden="true" /><span>Cerrar sesión</span></button></div>
      </aside>
      {menuAbierto && <div className="sidebar-backdrop" onClick={cerrarMenu} />}
      <main className="main-content" inert={menuAbierto}>
        <header className="topbar"><button ref={menuBoton} type="button" className="menu-toggle" aria-label="Abrir el menú" aria-controls="menu-lateral" aria-expanded={menuAbierto} onClick={() => setMenuAbierto(true)}><Menu size={22} aria-hidden="true" /></button><div className="mobile-brand brand"><span className="brand-mark"><LogoMark /></span><span>Pet<span>Suite</span></span></div><div className="topbar-context"><strong>{vistasDe(menu).find(([, id]) => id === active)?.[0] ?? 'Inicio'}</strong><span>{roleLabels[user.rol]}</span></div><div className="top-actions"><div className="topbar-user"><strong>{user.nombre}</strong><small>{roleLabels[user.rol]}</small></div><div className="avatar small" aria-label={user.nombre}>{user.nombre.slice(0, 2).toUpperCase()}</div></div></header>
        {active !== 'settings' && user.rol === 'tutor' && <TutorArea active={active} setActive={setActive} name={user.nombre} />}
        {active !== 'settings' && (user.rol === 'pyme' || user.rol === 'jefe_local') && <BusinessArea active={active} setActive={ir} />}
        {active !== 'settings' && user.rol === 'clinico' && <ClinicalArea active={active} />}
        {active !== 'settings' && (user.rol === 'admin' || user.rol === 'asesor') && <AdminArea active={active} rol={user.rol} />}
        {active !== 'settings' && user.rol === 'ong' && <OngArea active={active} />}
        {active === 'settings' && <div className="settings-workspace"><TabbedSettingsView profile={profile} setProfile={saveProfile} theme={theme} setTheme={setTheme} mode={mode} setMode={setMode} brightness={brightness} setBrightness={setBrightness} onLogout={logout} /><section className="settings-card profile-session-card"><div><p className="eyebrow">SESIÓN</p><h2>Salir de PetSuite</h2><p className="muted">Cierra la sesión de este dispositivo.</p></div><button type="button" className="secondary" onClick={logout}>Cerrar sesión</button></section></div>}
      </main>
    </div>
  )
}


function TabbedSettingsView({ profile, setProfile, theme, setTheme, mode, setMode, brightness, setBrightness, onLogout }: { profile: { name: string; email: string; phone: string; avatar: string }; setProfile: (profile: { name: string; email: string; phone: string; avatar: string }) => void; theme: ThemeName; setTheme: (theme: ThemeName) => void; mode: ColorMode; setMode: (mode: ColorMode) => void; brightness: number; setBrightness: (brightness: number) => void; onLogout: () => void }) {
  const [section, setSection] = useState('profile')
  const [draft, setDraft] = useState(profile)
  const [saved, setSaved] = useState(false)
  const [notifications, setNotifications] = useState(() => localStorage.getItem('petsuite-notifications') !== 'false')
  const [publicProfile, setPublicProfile] = useState(() => localStorage.getItem('petsuite-public-profile') !== 'false')
  const [draftTheme, setDraftTheme] = useState(theme)
  const [draftMode, setDraftMode] = useState(mode)
  const [draftBrightness, setDraftBrightness] = useState(brightness)
  useEffect(() => {
    if (section !== 'appearance') return
    const preview = () => applyAppearance(draftTheme, draftMode, draftBrightness)
    preview()
    if (draftMode === 'system') {
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      media.addEventListener('change', preview)
      return () => { media.removeEventListener('change', preview); applyAppearance(theme, mode, brightness) }
    }
    return () => applyAppearance(theme, mode, brightness)
  }, [section, draftTheme, draftMode, draftBrightness, theme, mode, brightness])
  useEffect(() => {
    if (section !== 'appearance') {
      setDraftTheme(theme)
      setDraftMode(mode)
      setDraftBrightness(brightness)
    }
  }, [section, theme, mode, brightness])
  const saveProfile = (event: React.FormEvent) => { event.preventDefault(); setProfile({ ...draft, avatar: draft.name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase() }); setSaved(true); window.setTimeout(() => setSaved(false), 2200) }
  const toggle = (key: 'notifications' | 'publicProfile', value: boolean) => { if (key === 'notifications') { setNotifications(value); localStorage.setItem('petsuite-notifications', String(value)) } else { setPublicProfile(value); localStorage.setItem('petsuite-public-profile', String(value)) } }
  const confirmAppearance = () => { setTheme(draftTheme); setMode(draftMode); setBrightness(draftBrightness); setSaved(true); window.setTimeout(() => setSaved(false), 2200) }
  const sections = [['profile', 'Perfil'], ['appearance', 'Apariencia'], ['notifications', 'Notificaciones'], ['privacy', 'Privacidad y datos'], ['inbox', 'Correos (demo)']] as const
  return <section className="page settings-page"><div className="page-title"><div><p className="eyebrow">TU CUENTA</p><h1>Configuración</h1><p className="muted">Personaliza tu experiencia en PetSuite.</p></div></div><div className="settings-layout"><div className="settings-nav">{sections.map(([id, label]) => <button key={id} className={section === id ? 'settings-nav-item active' : 'settings-nav-item'} onClick={() => setSection(id)}>{label}</button>)}</div><div className="settings-content">{section === 'profile' && <form className="settings-card" onSubmit={saveProfile}><div className="settings-card-heading"><div><p className="eyebrow">INFORMACIÓN PERSONAL</p><h2>Perfil</h2></div><div className="profile-avatar">{draft.avatar}</div></div><div className="settings-form-grid"><label>Nombre completo<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label>Correo electrónico<input type="email" value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })} /></label><label>Teléfono<input value={draft.phone} onChange={event => setDraft({ ...draft, phone: event.target.value })} /></label></div><div className="settings-actions"><span className="save-message">{saved ? 'Cambios guardados' : ''}</span><button className="primary">Guardar cambios</button></div></form>}{section === 'appearance' && <div className="settings-card"><div className="settings-card-heading"><div><p className="eyebrow">PERSONALIZA LA INTERFAZ</p><h2>Apariencia</h2><p className="muted">Previsualiza y confirma tus preferencias visuales.</p></div></div><div className="theme-options">{themeOptions.map(option => <button type="button" key={option.name} className={draftTheme === option.name ? 'theme-option selected' : 'theme-option'} onClick={() => setDraftTheme(option.name)}><span className="theme-swatch" style={{ background: option.color }} /><span>{option.label}</span>{draftTheme === option.name && <Check size={16} aria-hidden="true" />}</button>)}</div><div className="mode-options"><button type="button" className={draftMode === 'light' ? 'mode-option active' : 'mode-option'} onClick={() => setDraftMode('light')}>Claro</button><button type="button" className={draftMode === 'dark' ? 'mode-option active' : 'mode-option'} onClick={() => setDraftMode('dark')}>Oscuro</button><button type="button" className={draftMode === 'system' ? 'mode-option active' : 'mode-option'} onClick={() => setDraftMode('system')}>Sistema</button></div><label className="brightness-control">Brillo de la interfaz <output>{draftBrightness}%</output><input type="range" min="70" max="115" value={draftBrightness} onChange={event => setDraftBrightness(Number(event.target.value))} /></label><div className="settings-actions"><span className="save-message">{saved ? 'Preferencias confirmadas' : ''}</span><button type="button" className="primary" onClick={confirmAppearance}>Confirmar cambios</button></div></div>}{section === 'notifications' && <div className="settings-card"><div className="settings-card-heading"><div><p className="eyebrow">PREFERENCIAS</p><h2>Notificaciones</h2><p className="muted">Controla los avisos que recibes de PetSuite.</p></div></div><SettingRow title="Avisos de la comunidad" text="Recibe novedades sobre publicaciones y contactos." value={notifications} onChange={value => toggle('notifications', value)} /></div>}{section === 'privacy' && <><div className="settings-card"><div className="settings-card-heading"><div><p className="eyebrow">VISIBILIDAD</p><h2>Privacidad</h2><p className="muted">Decide qué información pueden ver otros tutores.</p></div></div><SettingRow title="Perfil público" text="Permite que otros vean tu nombre en el muro comunal." value={publicProfile} onChange={value => toggle('publicProfile', value)} /></div><PrivacyCenter />{modoDemo && <div className="settings-card"><div><p className="eyebrow">MODO DEMOSTRACIÓN</p><h2>Datos de demostración</h2><p className="muted">Sin servidor, los datos viven solo en este navegador: un QR abierto en otro teléfono mostrará «Medalla no válida». Restablecer borra lo que creaste aquí y cierra la sesión.</p></div><button type="button" className="secondary" onClick={() => { if (window.confirm('¿Restablecer los datos de demostración? Se perderán las mascotas, publicaciones y cambios hechos en este navegador.')) { resetDemo(); onLogout() } }}>Restablecer datos de demostración</button></div>}<div className="settings-card danger-card"><div><p className="eyebrow">SESIÓN</p><h2>Salir de PetSuite</h2><p className="muted">Cierra la sesión de este dispositivo.</p></div><button type="button" className="secondary danger-button" onClick={onLogout}>Cerrar sesión</button></div></>}{section === 'inbox' && <MyInbox />}</div></div></section>
}

function SettingRow({ title, text, value, onChange }: { title: string; text: string; value: boolean; onChange: (value: boolean) => void }) { return <div className="setting-row"><div><strong>{title}</strong><p>{text}</p></div><button type="button" aria-label={`Cambiar ${title}`} className={value ? 'toggle on' : 'toggle'} onClick={() => onChange(!value)} /></div> }

export default App
