import { useState } from 'react'
import Players from './pages/Players'
import Transfers from './pages/Transfers'
import Captain from './pages/Captain'
import Differentials from './pages/Differentials'
import PriceChanges from './pages/PriceChanges'
import './index.css'

export default function App() {
  const [page, setPage] = useState('players')

  return (
    <div style={{ minHeight: '100vh', background: '#0e1117', color: '#fff', fontFamily: 'sans-serif' }}>
      <nav style={{ background: '#1a1f2e', padding: '12px 24px', display: 'flex', gap: '16px', alignItems: 'center' }}>
        <div style={{ marginRight: '24px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <span style={{ fontWeight: 'bold', fontSize: '18px', color: '#00ff87', lineHeight: '1' }}>⚽ FPL Analyzer</span>
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.45)', lineHeight: '1' }}>by SilverCityIndigo</span>
        </div>
        <button onClick={() => setPage('players')} style={navBtn(page === 'players')}>Players</button>
        <button onClick={() => setPage('transfers')} style={navBtn(page === 'transfers')}>Transfers</button>
        <button onClick={() => setPage('captain')} style={navBtn(page === 'captain')}>⚡ Captain</button>
        <button onClick={() => setPage('differentials')} style={navBtn(page === 'differentials')}>🔍 Scout</button>
        <button onClick={() => setPage('pricechanges')} style={navBtn(page === 'pricechanges')}>💰 Prices</button>
      </nav>
      <div style={{ padding: '24px' }}>
        {page === 'players' && <Players />}
        {page === 'transfers' && <Transfers />}
        {page === 'captain' && <Captain />}
        {page === 'differentials' && <Differentials />}
        {page === 'pricechanges' && <PriceChanges />}
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
    padding: '6px 16px',
    cursor: 'pointer',
    fontWeight: active ? 'bold' : 'normal'
  }
}