import { useState, useEffect } from 'react'
import { getDifferentials } from '../api'
import { PHOTO } from '../playerPhoto'

const POSITIONS = ['All', 'GKP', 'DEF', 'MID', 'FWD']
const POS_COLORS = { GKP: 'var(--gold)', DEF: 'var(--info)', MID: 'var(--accent)', FWD: 'var(--danger)' }
const FDR_COLORS = { 1: 'var(--accent)', 2: 'var(--info)', 3: 'var(--gold)', 4: '#e0872e', 5: 'var(--danger)' }
const POS_NAMES = { GKP: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards' }

export default function Differentials() {
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [position, setPosition] = useState('All')

  useEffect(() => {
    getDifferentials().then(res => setPlayers(res.data)).finally(() => setLoading(false))
  }, [])

  const filtered = position === 'All' ? players : players.filter(p => p.position === position)
  const positions = position === 'All' ? ['GKP', 'DEF', 'MID', 'FWD'] : [position]

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Differential Scout</h1>
        <p className="page-sub">Underrated, lower-ownership players — find the edge before anyone else does.</p>
      </div>

      <div className="toolbar">
        <div className="seg">
          {POSITIONS.map(pos => (
            <button key={pos} className={position === pos ? 'on' : ''} onClick={() => setPosition(pos)}>{pos}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="hint">Scouting differentials…</p>
      ) : filtered.length === 0 ? (
        <p className="hint">No differentials found for this position right now.</p>
      ) : (
        positions.map(pos => {
          const posPlayers = filtered.filter(p => p.position === pos).slice(0, 5)
          if (posPlayers.length === 0) return null

          return (
            <div key={pos} style={{ marginBottom: '26px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <span className="pos-pill" style={{ background: POS_COLORS[pos] }}>{pos}</span>
                <h3 className="section-title">{POS_NAMES[pos]}</h3>
                <span className="hint">{posPlayers.length} found</span>
              </div>

              <div className="list">
                {posPlayers.map((p, i) => (
                  <div key={p.id} className={`list-row${i === 0 ? ' lead' : ''}`}>
                    <div className={`rank${i === 0 ? ' lead' : ''}`}>#{i + 1}</div>
                    {p.code && <img src={PHOTO(p.code)} alt={p.web_name} style={{ height: '58px', objectFit: 'contain' }} onError={e => { e.target.style.display = 'none' }} />}
                    <div style={{ flex: 1, minWidth: '190px' }}>
                      <div style={{ fontWeight: 700, fontSize: '15px' }}>{p.web_name}</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: '6px' }}>{p.team_name} · £{p.price}m</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '12.5px', lineHeight: 1.45 }}>{p.why}</div>
                    </div>
                    <div className="tiles">
                      <div className="tile"><div className="k">Form</div><div className="v" style={{ color: 'var(--gold)' }}>{p.form}</div></div>
                      <div className="tile"><div className="k">PPG</div><div className="v">{p.points_per_game}</div></div>
                      <div className="tile"><div className="k">Owned</div><div className="v" style={{ color: 'var(--info)' }}>{p.selected_by_percent}%</div></div>
                      <div className="tile" style={{ minWidth: '90px' }}><div className="k">Next</div><div className="v" style={{ color: FDR_COLORS[p.fdr] || 'var(--text)', fontSize: '12px' }}>{p.fixture}</div></div>
                      <div className="tile"><div className="k">FDR</div><div className="v" style={{ color: FDR_COLORS[p.fdr] || 'var(--text)' }}>{p.fdr}</div></div>
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
