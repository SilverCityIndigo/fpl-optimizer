import { useState, useEffect, useRef } from 'react'
import Home from './pages/Home'
import Players from './pages/Players'
import Transfers from './pages/Transfers'
import Captain from './pages/Captain'
import Differentials from './pages/Differentials'
import PriceChanges from './pages/PriceChanges'
import ChipAdvisor from './pages/ChipAdvisor'
import Analytics from './pages/Analytics'
import './index.css'

const THEME_KEY = 'xg-files-theme'
const COLLAPSE_KEY = 'xg-files-collapsed'

// Below this width the sidebar stops being a column and becomes an off-canvas
// drawer, so the content gets the whole screen instead of ~72px of it.
const MOBILE_Q = '(max-width: 900px)'

function getInitialTheme() {
  if (typeof window === 'undefined') return 'dark'
  const saved = window.localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light'
  return 'dark'
}

// ─── The xG Files sigil — a goal net with an X-target in front (FIFA skill-game nod)
function Sigil() {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      {/* goal frame: posts + crossbar */}
      <path d="M7 42V13.5h34V42" stroke="var(--goal)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      {/* net mesh */}
      <g stroke="var(--goal)" strokeWidth="0.9" opacity="0.28">
        <path d="M7 21h34M7 28.5h34M7 36h34" />
        <path d="M14 13.5V42M21 13.5V42M27 13.5V42M34 13.5V42" />
      </g>
      {/* target rings in front */}
      <circle cx="24" cy="29" r="11.4" stroke="var(--accent)" strokeWidth="2.3" />
      <circle cx="24" cy="29" r="5.6" stroke="var(--accent)" strokeWidth="1.5" opacity="0.45" />
      {/* the X */}
      <path d="M18.2 23.2 29.8 34.8M29.8 23.2 18.2 34.8" stroke="var(--accent)" strokeWidth="3.1" strokeLinecap="round" />
    </svg>
  )
}

// Sun when the lights are off, moon when they are on — i.e. what you get if you press it.
function ThemeIcon({ theme }) {
  return theme === 'dark' ? (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4.2" /><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.6 6.6 0 0 0 10.5 10.5z" /></svg>
  )
}

const NAV = [
  { key: 'home',          label: 'Home',      icon: <path d="M4 10.5 12 4l8 6.5V20H4z" /> },
  { group: 'Squad' },
  { key: 'players',       label: 'Players',   icon: <><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></> },
  { key: 'transfers',     label: 'Transfers', icon: <path d="M4 8h13l-3-3M20 16H7l3 3" /> },
  { key: 'captain',       label: 'Captain',   icon: <path d="M13 2 4.5 13H11l-1 9 8.5-11H12z" /> },
  { key: 'chips',         label: 'Chips',     icon: <><circle cx="12" cy="12" r="8.4" /><circle cx="12" cy="12" r="3.4" /><path d="M12 3.6v3M12 17.4v3M3.6 12h3M17.4 12h3" /></> },
  { group: 'Intelligence' },
  { key: 'differentials', label: 'Scout',     icon: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.6-3.6" /></> },
  { key: 'pricechanges',  label: 'Prices',    icon: <><path d="M20 12a8 8 0 1 1-8-8" /><path d="M12 12l5-3" /><path d="M12 4a8 8 0 0 1 8 8h-8z" /></> },
  { key: 'analytics',     label: 'Analytics', icon: <><path d="M4 20V4M4 20h16" /><rect x="7.5" y="12" width="3" height="5" /><rect x="13" y="8" width="3" height="9" /></> },
]

const PAGE_KEYS = NAV.filter(n => n.key).map(n => n.key)

// ─── Routing ────────────────────────────────────────────────────────────────
// Pages live on real paths — "/players", "/captain" — with home on the bare "/".
// Deep links work because vercel.json rewrites every path to index.html, so the
// server hands back the app and the code below reads the page off the pathname.
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '')

function urlFor(page) {
  return (BASE + (page === 'home' ? '/' : `/${page}`)) + window.location.search
}

function pageFromUrl() {
  const path = window.location.pathname
  const rest = path.startsWith(BASE) ? path.slice(BASE.length) : path
  const seg = rest.replace(/^\/+|\/+$/g, '').toLowerCase()
  if (PAGE_KEYS.includes(seg)) return seg
  // Links minted by the old hash router ("/#captain") still resolve.
  if (!seg) {
    const legacy = (window.location.hash || '').replace(/^#/, '').toLowerCase()
    if (PAGE_KEYS.includes(legacy)) return legacy
  }
  return 'home'
}

export default function App() {
  const [page, setPage] = useState(pageFromUrl)
  const [theme, setTheme] = useState(getInitialTheme)
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem(COLLAPSE_KEY) === '1')
  const [analyticsPlayer, setAnalyticsPlayer] = useState(null)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_Q).matches)
  const [navOpen, setNavOpen] = useState(false)
  const menuBtnRef = useRef(null)
  const drawerCloseRef = useRef(null)

  // Shared team ID state across Transfers, Captain, Chips
  const [sharedTeamId, setSharedTeamId] = useState('')
  const [sharedSquadData, setSharedSquadData] = useState(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { window.localStorage.setItem(THEME_KEY, theme) } catch { /* ignore */ }
  }, [theme])

  useEffect(() => {
    try { window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0') } catch { /* ignore */ }
  }, [collapsed])

  // Wire the browser back/forward buttons to move between our pages. The
  // replaceState also canonicalises the address bar, so a legacy "/#captain"
  // link rewrites itself to "/captain" on arrival.
  useEffect(() => {
    window.history.replaceState({ page }, '', urlFor(page))
    const onPop = e => setPage(e.state?.page || pageFromUrl())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track the drawer breakpoint so the desktop-only collapsed state and the
  // drawer never fight over the same element.
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_Q)
    const onChange = e => {
      setIsMobile(e.matches)
      if (!e.matches) setNavOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // While the drawer is open: freeze the page behind it and close on Escape.
  useEffect(() => {
    if (!navOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    drawerCloseRef.current?.focus()
    const onKey = e => { if (e.key === 'Escape') closeNav() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [navOpen])

  // Hand focus back to the button that opened the drawer. On desktop that
  // button is display:none, so this is a no-op there.
  function closeNav() {
    setNavOpen(false)
    menuBtnRef.current?.focus()
  }

  function navigate(next) {
    if (navOpen) closeNav()
    if (next === page) return
    setPage(next)
    window.history.pushState({ page: next }, '', urlFor(next))
    window.scrollTo(0, 0)
  }

  function toggleTheme() { setTheme(t => (t === 'dark' ? 'light' : 'dark')) }

  function goToAnalytics(player) {
    setAnalyticsPlayer(player)
    navigate('analytics')
  }

  const themeTitle = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
  const currentLabel = NAV.find(n => n.key === page)?.label ?? 'Home'
  const shellClass = [
    'app-shell',
    !isMobile && collapsed ? 'collapsed' : '',
    navOpen ? 'nav-open' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={shellClass}>
      <div className="nav-scrim" onClick={closeNav} aria-hidden="true" />

      <aside id="app-sidebar" className="sidebar" aria-label="Main navigation">
        <button ref={drawerCloseRef} className="drawer-close" onClick={closeNav} aria-label="Close navigation">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>

        <div className="brand">
          <button className="brand-id" onClick={() => navigate('home')} title="The xG Files">
            <span className="brand-sigil"><Sigil /></span>
            <span className="brand-word">
              <span className="the">The</span>
              <span className="name"><span className="xg">xG</span> <span className="files">FILES</span></span>
            </span>
          </button>
          <a className="brand-by" href="https://github.com/SilverCityIndigo" target="_blank" rel="noreferrer" title="SilverCityIndigo on GitHub">
            <svg className="gh" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48l-.01-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.36 1.09 2.93.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85l-.01 2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" /></svg>
            by SilverCityIndigo
          </a>
        </div>

        <nav className="nav">
          {NAV.map((item, i) =>
            item.group ? (
              <div key={`g-${i}`} className="nav-group">{item.group}</div>
            ) : (
              <button
                key={item.key}
                className={`nav-item${page === item.key ? ' active' : ''}`}
                onClick={() => navigate(item.key)}
                title={item.label}
                aria-current={page === item.key ? 'page' : undefined}
              >
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{item.icon}</svg>
                <span className="nav-txt">{item.label}</span>
              </button>
            )
          )}
        </nav>

        <div className="side-foot">
          <button className="theme-toggle" onClick={toggleTheme} title={themeTitle}>
            <ThemeIcon theme={theme} />
            <span className="nav-txt">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          </button>

          <button className="collapse-btn" onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expand' : 'Collapse'}>
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            <span className="nav-txt">Collapse</span>
          </button>
        </div>
      </aside>

      <main className="main">
        {/* Mobile-only bar. It carries the drawer trigger, so the nav costs no
            horizontal space until it is asked for. */}
        <header className="topbar">
          <button
            ref={menuBtnRef}
            className="topbar-btn"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={navOpen}
            aria-controls="app-sidebar"
          >
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>

          <button className="topbar-brand" onClick={() => navigate('home')} title="The xG Files">
            <span className="topbar-sigil"><Sigil /></span>
            <span className="topbar-word"><span className="xg">xG</span> FILES</span>
          </button>

          <span className="topbar-page">{currentLabel}</span>

          <button className="topbar-btn" onClick={toggleTheme} aria-label={themeTitle} title={themeTitle}>
            <ThemeIcon theme={theme} />
          </button>
        </header>

        <div className="page">
          {page === 'home'          && <Home onNavigate={navigate} onAnalytics={goToAnalytics} />}
          {page === 'players'       && <Players onAnalytics={goToAnalytics} />}
          {page === 'transfers'     && <Transfers sharedTeamId={sharedTeamId} setSharedTeamId={setSharedTeamId} sharedSquadData={sharedSquadData} setSharedSquadData={setSharedSquadData} />}
          {page === 'captain'       && <Captain sharedTeamId={sharedTeamId} setSharedTeamId={setSharedTeamId} sharedSquadData={sharedSquadData} setSharedSquadData={setSharedSquadData} />}
          {page === 'differentials' && <Differentials />}
          {page === 'pricechanges'  && <PriceChanges />}
          {page === 'chips'         && <ChipAdvisor sharedTeamId={sharedTeamId} setSharedTeamId={setSharedTeamId} sharedSquadData={sharedSquadData} setSharedSquadData={setSharedSquadData} />}
          {page === 'analytics'     && <Analytics initialPlayer={analyticsPlayer} />}
        </div>
      </main>
    </div>
  )
}
