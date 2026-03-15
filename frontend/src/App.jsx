import { useState } from 'react'
import Players from './pages/Players'
import Transfers from './pages/Transfers'
import Captain from './pages/Captain'
import Differentials from './pages/Differentials'
import PriceChanges from './pages/PriceChanges'
import ChipAdvisor from './pages/ChipAdvisor'
import Analytics from './pages/Analytics'
import './index.css'

const API = import.meta.env.VITE_API_URL || 'https://fpl-optimizer-production.up.railway.app'

export default function App() {
  const [page, setPage] = useState('players')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [analyticsPlayer, setAnalyticsPlayer] = useState(null)

  async function handleSync() {
    setSyncing(true)
    setSyncMsg('')
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      const res = await fetch(`${API}/admin/sync`, { method: 'POST', signal: controller.signal })
      clearTimeout(timeout)
      if (!res.ok) throw new Error('Server error')
      await res.json()
      setSyncMsg('✅ Synced!')
    } catch (e) {
      if (e.name === 'AbortError') {
        setSyncMsg('⚠️ Sync timed out')
      } else {
        setSyncMsg('❌ Failed')
      }
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(''), 5000)
    }
  }

  function goToAnalytics(player) {
    setAnalyticsPlayer(player)
    setPage('analytics')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0e1117', color: '#fff', fontFamily: 'sans-serif' }}>
      <nav style={{ background: '#1a1f2e', padding: '12px 24px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ marginRight: '16px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <span style={{ fontWeight: 'bold', fontSize: '18px', color: '#00ff87', lineHeight: '1' }}>⚽ FPL Lab</span>
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.85)', lineHeight: '1', fontWeight: 'bold' }}>by SilverCityIndigo</span>
        </div>

        <button onClick={() => setPage('players')}        style={navBtn(page === 'players')}>      👤 Players</button>
        <button onClick={() => setPage('transfers')}      style={navBtn(page === 'transfers')}>    🔄 Transfers</button>
        <button onClick={() => setPage('captain')}        style={navBtn(page === 'captain')}>      ⚡ Captain</button>
        <button onClick={() => setPage('chips')}          style={navBtn(page === 'chips')}>        🃏 Chips</button>
        <button onClick={() => setPage('differentials')}  style={navBtn(page === 'differentials')}>🔍 Scout</button>
        <button onClick={() => setPage('pricechanges')}   style={navBtn(page === 'pricechanges')}> 💰 Prices</button>
        <button onClick={() => setPage('analytics')}      style={navBtn(page === 'analytics')}>    📊 Analytics</button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {syncMsg && <span style={{ fontSize: '12px', color: syncMsg.startsWith('✅') ? '#00ff87' : '#ff4444' }}>{syncMsg}</span>}
            <button
              onClick={handleSync}
              disabled={syncing}
              title="Sync latest FPL data"
              style={{
                background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '6px', color: syncing ? '#aaa' : 'rgba(255,255,255,0.6)',
                cursor: syncing ? 'not-allowed' : 'pointer', padding: '4px 10px',
                fontSize: '13px', transition: 'color 0.15s, border-color 0.15s'
              }}
              onMouseEnter={e => { if (!syncing) { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#fff' }}}
              onMouseLeave={e => { e.currentTarget.style.color = syncing ? '#aaa' : 'rgba(255,255,255,0.6)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)' }}
            >
              {syncing ? '⏳ Syncing...' : '🔃 Sync'}
            </button>
          </div>

          <a href="https://github.com/SilverCityIndigo" target="_blank" rel="noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'rgba(255,255,255,0.6)', textDecoration: 'none', fontSize: '13px', transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.6)'}>
            <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            SilverCityIndigo
          </a>
        </div>
      </nav>

      <div style={{ padding: '24px' }}>
        {page === 'players'       && <Players onAnalytics={goToAnalytics} />}
        {page === 'transfers'     && <Transfers />}
        {page === 'captain'       && <Captain />}
        {page === 'differentials' && <Differentials />}
        {page === 'pricechanges'  && <PriceChanges />}
        {page === 'chips'         && <ChipAdvisor />}
        {page === 'analytics'     && <Analytics initialPlayer={analyticsPlayer} />}
      </div>
    </div>
  )
}

function navBtn(active) {
  return {
    background: active ? '#00ff87' : 'transparent',
    color: active ? '#000' : '#fff',
    border: '1px solid #00ff87',
    borderRadius: '6px',
    padding: '6px 14px',
    cursor: 'pointer',
    fontWeight: active ? 'bold' : 'normal',
    fontSize: '14px',
    whiteSpace: 'nowrap'
  }
}