import { useState, useEffect } from 'react'
import { getDifferentials } from '../api'

const POSITIONS = ['All', 'GKP', 'DEF', 'MID', 'FWD']
const FDR_COLORS = { 1: '#00ff87', 2: '#7fff00', 3: '#ffd700', 4: '#ff8800', 5: '#ff4444' }

export default function Differentials() {
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [position, setPosition] = useState('All')

  useEffect(() => {
    getDifferentials()
      .then(res => setPlayers(res.data))
      .finally(() => setLoading(false))
  }, [])

  const filtered = position === 'All'
    ? players
    : players.filter(p => p.position === position)

  // Group by position for display
  const positions = position === 'All' ? ['GKP', 'DEF', 'MID', 'FWD'] : [position]

  return (
    <div>
      <h2 style={{ marginBottom: '8px', color: '#00ff87' }}>🔍 Differential Scout</h2>
      <p style={{ color: '#aaa', marginBottom: '24px', fontSize: '14px' }}>
        Low-ownership players currently delivering points — find the edge before everyone else does.
      </p>

      {/* Position filter */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '28px', flexWrap: 'wrap' }}>
        {POSITIONS.map(pos => (
          <button key={pos} onClick={() => setPosition(pos)}
            style={{
              padding: '8px 16px', borderRadius: '6px',
              border: '1px solid #00ff87',
              background: position === pos ? '#00ff87' : 'transparent',
              color: position === pos ? '#000' : '#fff',
              cursor: 'pointer', fontWeight: position === pos ? 'bold' : 'normal'
            }}>
            {pos}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: '#aaa' }}>Scouting differentials...</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: '#aaa' }}>No differentials found for this position right now.</p>
      ) : (
        positions.map(pos => {
          const posPlayers = filtered.filter(p => p.position === pos).slice(0, 5)
          if (posPlayers.length === 0) return null

          const posColors = { GKP: '#f5a623', DEF: '#00b2ff', MID: '#00ff87', FWD: '#ff4444' }

          return (
            <div key={pos} style={{ marginBottom: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <span style={{
                  background: posColors[pos], color: '#000',
                  fontSize: '12px', fontWeight: 'bold',
                  padding: '4px 10px', borderRadius: '4px'
                }}>{pos}</span>
                <h3 style={{ margin: 0, fontSize: '16px' }}>
                  {pos === 'GKP' ? 'Goalkeepers' : pos === 'DEF' ? 'Defenders' : pos === 'MID' ? 'Midfielders' : 'Forwards'}
                </h3>
                <span style={{ color: '#aaa', fontSize: '13px' }}>{posPlayers.length} differential{posPlayers.length !== 1 ? 's' : ''} found</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {posPlayers.map((p, i) => (
                  <div key={p.id} style={{
                    background: '#1a1f2e',
                    borderRadius: '10px',
                    padding: '16px',
                    border: `1px solid ${i === 0 ? posColors[pos] : '#2a2f3e'}`,
                    display: 'flex',
                    gap: '16px',
                    alignItems: 'center',
                    flexWrap: 'wrap'
                  }}>
                    {/* Rank */}
                    <div style={{ color: i === 0 ? posColors[pos] : '#aaa', fontWeight: 'bold', fontSize: '20px', minWidth: '28px' }}>
                      #{i + 1}
                    </div>

                    {/* Photo */}
                    {p.code && (
                      <img
                        src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.code}.png`}
                        alt={p.web_name}
                        style={{ height: '65px', objectFit: 'contain' }}
                        onError={e => e.target.style.display = 'none'}
                      />
                    )}

                    {/* Name + why */}
                    <div style={{ flex: 1, minWidth: '180px' }}>
                      <div style={{ fontWeight: 'bold', fontSize: '16px', marginBottom: '2px' }}>{p.web_name}</div>
                      <div style={{ color: '#aaa', fontSize: '12px', marginBottom: '8px' }}>{p.team_name} · £{p.price}m</div>
                      <div style={{ color: '#ccc', fontSize: '13px', fontStyle: 'italic' }}>💡 {p.why}</div>
                    </div>

                    {/* Stats */}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {[
                        ['Form', p.form, '#ffd700'],
                        ['PPG', p.points_per_game, '#fff'],
                        ['Owned', `${p.selected_by_percent}%`, '#00d4ff'],
                      ].map(([label, value, color]) => (
                        <div key={label} style={{ background: '#0e1117', borderRadius: '6px', padding: '6px 10px', textAlign: 'center', minWidth: '55px' }}>
                          <div style={{ color: '#aaa', fontSize: '10px', marginBottom: '2px' }}>{label}</div>
                          <div style={{ color, fontWeight: 'bold', fontSize: '14px' }}>{value}</div>
                        </div>
                      ))}
                      <div style={{ background: '#0e1117', borderRadius: '6px', padding: '6px 10px', textAlign: 'center', minWidth: '90px' }}>
                        <div style={{ color: '#aaa', fontSize: '10px', marginBottom: '2px' }}>Next Fixture</div>
                        <div style={{ color: FDR_COLORS[p.fdr] || '#fff', fontWeight: 'bold', fontSize: '12px' }}>{p.fixture}</div>
                      </div>
                      <div style={{ background: '#0e1117', borderRadius: '6px', padding: '6px 10px', textAlign: 'center', minWidth: '70px' }}>
                        <div style={{ color: '#aaa', fontSize: '10px', marginBottom: '2px' }}>FDR</div>
                        <div style={{ color: FDR_COLORS[p.fdr] || '#fff', fontWeight: 'bold', fontSize: '14px' }}>{p.fdr} · {p.fdr_label}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}