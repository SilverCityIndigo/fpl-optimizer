import { useState, useEffect } from 'react'
import { getPriceChanges } from '../api'
import { PHOTO } from '../playerPhoto'

const POSITIONS = ['All', 'GKP', 'DEF', 'MID', 'FWD']
const POS_COLORS = { GKP: 'var(--gold)', DEF: 'var(--info)', MID: 'var(--accent)', FWD: 'var(--danger)' }

export default function PriceChanges() {
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [position, setPosition] = useState('All')
  const [tab, setTab] = useState('rising')

  useEffect(() => {
    getPriceChanges().then(res => setPlayers(res.data)).finally(() => setLoading(false))
  }, [])

  const filtered = players
    .filter(p => tab === 'rising' ? Number(p.pressure_score) >= 50 : Number(p.pressure_score) <= -50)
    .filter(p => position === 'All' || p.position === position)
    .sort((a, b) => tab === 'rising' ? Number(b.pressure_score) - Number(a.pressure_score) : Number(a.pressure_score) - Number(b.pressure_score))
    .slice(0, 20)

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Price Changes</h1>
        <p className="page-sub">Players likely to rise or fall in price based on this gameweek's transfer activity.</p>
      </div>

      <div className="toolbar">
        <div className="seg">
          <button className={tab === 'rising' ? 'on' : ''} onClick={() => setTab('rising')}
            style={tab === 'rising' ? undefined : { color: 'var(--text-secondary)' }}>▲ Rising</button>
          <button className={tab === 'falling' ? 'on' : ''} onClick={() => setTab('falling')}
            style={tab === 'falling' ? { background: 'var(--danger)', color: '#fff' } : { color: 'var(--text-secondary)' }}>▼ Falling</button>
        </div>
        <div className="seg">
          {POSITIONS.map(pos => (
            <button key={pos} className={position === pos ? 'on' : ''} onClick={() => setPosition(pos)}>{pos}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="hint">Analyzing transfer activity…</p>
      ) : filtered.length === 0 ? (
        <p className="hint">No players found for this filter.</p>
      ) : (
        <div className="list">
          {filtered.map((p, i) => {
            const isRising = p.pressure_score > 0
            const accent = isRising ? 'var(--accent)' : 'var(--danger)'
            const pressureAbs = Math.min(100, Math.abs(p.pressure_score))
            return (
              <div key={p.id} className={`list-row${i === 0 ? ' lead' : ''}`} style={i === 0 ? { borderColor: `color-mix(in srgb, ${accent} 50%, var(--line))` } : undefined}>
                <div className="rank" style={i === 0 ? { color: accent } : undefined}>#{i + 1}</div>
                {p.code && <img src={PHOTO(p.code)} alt={p.web_name} style={{ height: '52px', objectFit: 'contain' }} onError={e => { e.target.style.display = 'none' }} />}
                <div style={{ flex: 1, minWidth: '150px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                    <span className="pos-pill" style={{ background: POS_COLORS[p.position] || 'var(--text-muted)' }}>{p.position}</span>
                    <span style={{ fontWeight: 700, fontSize: '15px' }}>{p.web_name}</span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{p.team_name} · £{p.price}m</div>
                </div>
                <div style={{ minWidth: '150px' }}>
                  <div className="hint" style={{ marginBottom: '4px' }}>Transfer pressure</div>
                  <div style={{ background: 'var(--tile)', borderRadius: '5px', height: '8px', overflow: 'hidden', border: '1px solid var(--line)' }}>
                    <div style={{ width: `${pressureAbs}%`, height: '100%', background: accent, borderRadius: '5px', transition: 'width .3s' }} />
                  </div>
                  <div style={{ color: accent, fontSize: '12px', fontWeight: 700, marginTop: '3px', fontVariantNumeric: 'tabular-nums' }}>{isRising ? '+' : ''}{p.pressure_score}%</div>
                </div>
                <div className="tiles">
                  <div className="tile"><div className="k">Form</div><div className="v" style={{ color: 'var(--gold)' }}>{p.form}</div></div>
                  <div className="tile"><div className="k">Owned</div><div className="v" style={{ color: 'var(--info)' }}>{p.selected_by_percent}%</div></div>
                  <div className="tile"><div className="k">In</div><div className="v" style={{ color: 'var(--accent)', fontSize: '13px' }}>+{p.transfers_in_event?.toLocaleString()}</div></div>
                  <div className="tile"><div className="k">Out</div><div className="v" style={{ color: 'var(--danger)', fontSize: '13px' }}>−{p.transfers_out_event?.toLocaleString()}</div></div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
