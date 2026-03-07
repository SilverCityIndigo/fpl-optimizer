import { useState, useEffect } from 'react'
import { getPriceChanges } from '../api'

const POSITIONS = ['All', 'GKP', 'DEF', 'MID', 'FWD']

export default function PriceChanges() {
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [position, setPosition] = useState('All') 
  const [tab, setTab] = useState('rising')

  useEffect(() => {
    getPriceChanges()
      .then(res => setPlayers(res.data))
      .finally(() => setLoading(false))
  }, [])

  const filtered = players
  .filter(p => tab === 'rising' ? Number(p.pressure_score) >= 50 : Number(p.pressure_score) <= -50)
  .filter(p => position === 'All' || p.position === position)
  .sort((a, b) => tab === 'rising' ? Number(b.pressure_score) - Number(a.pressure_score) : Number(a.pressure_score) - Number(b.pressure_score))
  .slice(0, 20)

  const posColors = { GKP: '#f5a623', DEF: '#00b2ff', MID: '#00ff87', FWD: '#ff4444' }

  return (
    <div>
      <h2 style={{ marginBottom: '8px', color: '#00ff87' }}>💰 Price Changes</h2>
      <p style={{ color: '#aaa', marginBottom: '24px', fontSize: '14px' }}>
        Players likely to rise or fall in price based on this gameweek's transfer activity.
      </p>

      {/* Rising / Falling tabs */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        {[['rising', '🔺 Rising'], ['falling', '🔻 Falling']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{
              padding: '10px 24px', borderRadius: '6px', fontWeight: 'bold', fontSize: '15px',
              border: `1px solid ${key === 'rising' ? '#00ff87' : '#ff4444'}`,
              background: tab === key ? (key === 'rising' ? '#00ff87' : '#ff4444') : 'transparent',
              color: tab === key ? '#000' : '#fff',
              cursor: 'pointer'
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* Position filter */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', flexWrap: 'wrap' }}>
        {POSITIONS.map(pos => (
          <button key={pos} onClick={() => setPosition(pos)}
            style={{
              padding: '6px 14px', borderRadius: '6px',
              border: '1px solid #2a2f3e',
              background: position === pos ? '#2a2f3e' : 'transparent',
              color: position === pos ? '#fff' : '#aaa',
              cursor: 'pointer', fontWeight: position === pos ? 'bold' : 'normal'
            }}>
            {pos}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: '#aaa' }}>Analyzing transfer activity...</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: '#aaa' }}>No players found for this filter.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map((p, i) => {
            const isRising = p.pressure_score > 0
            const accentColor = isRising ? '#00ff87' : '#ff4444'
            const pressureAbs = Math.abs(p.pressure_score)

            return (
              <div key={p.id} style={{
                background: '#1a1f2e',
                borderRadius: '10px',
                padding: '16px',
                border: `1px solid ${i === 0 ? accentColor : '#2a2f3e'}`,
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                flexWrap: 'wrap'
              }}>
                {/* Rank */}
                <div style={{ color: i === 0 ? accentColor : '#aaa', fontWeight: 'bold', fontSize: '18px', minWidth: '28px' }}>
                  #{i + 1}
                </div>

                {/* Photo */}
                {p.code && (
                  <img
                    src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.code}.png`}
                    alt={p.web_name}
                    style={{ height: '60px', objectFit: 'contain' }}
                    onError={e => e.target.style.display = 'none'}
                  />
                )}

                {/* Name + position */}
                <div style={{ flex: 1, minWidth: '140px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{
                      background: posColors[p.position] || '#aaa',
                      color: '#000', fontSize: '10px', fontWeight: 'bold',
                      padding: '2px 6px', borderRadius: '3px'
                    }}>{p.position}</span>
                    <span style={{ fontWeight: 'bold', fontSize: '15px' }}>{p.web_name}</span>
                  </div>
                  <div style={{ color: '#aaa', fontSize: '12px' }}>{p.team_name} · £{p.price}m</div>
                </div>

                {/* Pressure bar */}
                <div style={{ minWidth: '160px' }}>
                  <div style={{ color: '#aaa', fontSize: '10px', marginBottom: '4px' }}>Transfer Pressure</div>
                  <div style={{ background: '#0e1117', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${pressureAbs}%`,
                      height: '100%',
                      background: accentColor,
                      borderRadius: '4px',
                      transition: 'width 0.3s'
                    }} />
                  </div>
                  <div style={{ color: accentColor, fontSize: '12px', fontWeight: 'bold', marginTop: '2px' }}>
                    {isRising ? '+' : ''}{p.pressure_score}%
                  </div>
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {[
                    ['Price', `£${p.price}m`, '#fff'],
                    ['Form', p.form, '#ffd700'],
                    ['Owned', `${p.selected_by_percent}%`, '#00d4ff'],
                    ['In', `+${p.transfers_in_event?.toLocaleString()}`, '#00ff87'],
                    ['Out', `-${p.transfers_out_event?.toLocaleString()}`, '#ff4444'],
                  ].map(([label, value, color]) => (
                    <div key={label} style={{ background: '#0e1117', borderRadius: '6px', padding: '6px 10px', textAlign: 'center', minWidth: '55px' }}>
                      <div style={{ color: '#aaa', fontSize: '10px', marginBottom: '2px' }}>{label}</div>
                      <div style={{ color, fontWeight: 'bold', fontSize: '13px' }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}