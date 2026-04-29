import { useState, useEffect } from 'react'
import Players from './pages/Players'
import Transfers from './pages/Transfers'
import Captain from './pages/Captain'
import Differentials from './pages/Differentials'
import PriceChanges from './pages/PriceChanges'
import ChipAdvisor from './pages/ChipAdvisor'
import Analytics from './pages/Analytics'
import './index.css'

const THEME_KEY = 'fpl-lab-theme'

function getInitialTheme() {
  if (typeof window === 'undefined') return 'dark'
  const saved = window.localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light'
  return 'dark'
}

export default function App() {
  const [page, setPage] = useState('players')
  const [theme, setTheme] = useState(getInitialTheme)
  const [analyticsPlayer, setAnalyticsPlayer] = useState(null)

  // Shared team ID state across Transfers, Captain, Chips
  const [sharedTeamId, setSharedTeamId] = useState('')
  const [sharedSquadData, setSharedSquadData] = useState(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { window.localStorage.setItem(THEME_KEY, theme) } catch { /* ignore */ }
  }, [theme])

  function toggleTheme() {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  }

  function goToAnalytics(player) {
    setAnalyticsPlayer(player)
    setPage('analytics')
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'sans-serif' }}>
      <nav style={{ background: 'var(--bg-card)', padding: '12px 24px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
        <div style={{ marginRight: '16px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <span style={{ fontWeight: 'bold', fontSize: '18px', color: '#00ff87', lineHeight: '1' }}>⚽ FPL Lab</span>
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', lineHeight: '1', fontWeight: 'bold' }}>by SilverCityIndigo</span>
        </div>

        <div style={{ display: 'flex', gap: '8px', flex: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => setPage('players')}        style={navBtn(page === 'players')}>      👤 Players</button>
          <button onClick={() => setPage('transfers')}      style={navBtn(page === 'transfers')}>    🔄 Transfers</button>
          <button onClick={() => setPage('captain')}        style={navBtn(page === 'captain')}>      ⚡ Captain</button>
          <button onClick={() => setPage('chips')}          style={navBtn(page === 'chips')}>        🃏 Chips</button>
          <button onClick={() => setPage('differentials')}  style={navBtn(page === 'differentials')}>🔍 Scout</button>
          <button onClick={() => setPage('pricechanges')}   style={navBtn(page === 'pricechanges')}> 💰 Prices</button>
          <button onClick={() => setPage('analytics')}      style={navBtn(page === 'analytics')}>    📊 Analytics</button>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to navy (softer) theme' : 'Switch to charcoal dark theme'}
            aria-label={theme === 'dark' ? 'Switch to navy theme' : 'Switch to dark theme'}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '4px 10px',
              fontSize: '15px',
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'color 0.15s, border-color 0.15s, background 0.15s'
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--text-secondary)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
            <span style={{ fontSize: '12px', fontWeight: 500 }}>
              {theme === 'dark' ? 'Navy' : 'Dark'}
            </span>
          </button>

          <a href="https://github.com/SilverCityIndigo" target="_blank" rel="noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '13px', transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}>
            <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            SilverCityIndigo
          </a>
        </div>
      </nav>

      <div style={{ padding: '24px' }}>
        {page === 'players'       && <Players onAnalytics={goToAnalytics} />}
        {page === 'transfers'     && <Transfers sharedTeamId={sharedTeamId} setSharedTeamId={setSharedTeamId} sharedSquadData={sharedSquadData} setSharedSquadData={setSharedSquadData} />}
        {page === 'captain'       && <Captain sharedTeamId={sharedTeamId} setSharedTeamId={setSharedTeamId} sharedSquadData={sharedSquadData} setSharedSquadData={setSharedSquadData} />}
        {page === 'differentials' && <Differentials />}
        {page === 'pricechanges'  && <PriceChanges />}
        {page === 'chips'         && <ChipAdvisor sharedTeamId={sharedTeamId} setSharedTeamId={setSharedTeamId} sharedSquadData={sharedSquadData} setSharedSquadData={setSharedSquadData} />}
        {page === 'analytics'     && <Analytics initialPlayer={analyticsPlayer} />}
      </div>
    </div>
  )
}

function navBtn(active) {
  return {
    background: active ? '#00ff87' : 'transparent',
    color: active ? '#000' : 'var(--text)',
    border: '1px solid #00ff87',
    borderRadius: '6px',
    padding: '6px 14px',
    cursor: 'pointer',
    fontWeight: active ? 'bold' : 'normal',
    fontSize: '14px',
    whiteSpace: 'nowrap'
  }
}
