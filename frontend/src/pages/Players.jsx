import { useState, useEffect } from 'react'
import { PHOTO } from '../playerPhoto'
import { usePlayers } from '../usePlayers'

const POSITIONS = ['All', 'GKP', 'DEF', 'MID', 'FWD']
const POS_COLORS = { GKP: 'var(--gold)', DEF: 'var(--info)', MID: 'var(--accent)', FWD: 'var(--danger)' }

// Classification — same thresholds as before, emoji stripped.
function valueRating(player, allPlayers) {
  const ptsPer    = player.points_per_game / player.price
  const ownership = parseFloat(player.selected_by_percent || 0)
  const form      = parseFloat(player.form || 0)

  const samePosition = allPlayers.filter(p => p.position === player.position)
  const sorted = [...samePosition].sort((a, b) =>
    parseFloat(b.selected_by_percent) - parseFloat(a.selected_by_percent)
  )
  const rank = sorted.findIndex(p => p.id === player.id)
  if (rank !== -1 && rank < 3) return { label: 'Reliable', color: 'var(--info)' }

  if (form < 2) return { label: 'Avoid', color: 'var(--danger)' }
  if (player.price >= 8.0 && form < 4) return { label: 'Avoid', color: 'var(--danger)' }
  if (ownership >= 30 && ptsPer >= 0.55 && form >= 4) return { label: 'Reliable', color: 'var(--info)' }
  if (ptsPer >= 0.75 && form >= 4.2) return { label: 'Elite value', color: 'var(--accent)' }
  if (ptsPer >= 0.55 && form >= 3.2) return { label: 'Good value', color: 'var(--accent)' }
  if (ptsPer >= 0.35) return { label: 'Fair value', color: 'var(--gold)' }
  return { label: 'Avoid', color: 'var(--danger)' }
}

function formColor(form) {
  const f = parseFloat(form || 0)
  if (f >= 6) return 'var(--accent)'
  if (f >= 4) return 'var(--info)'
  if (f >= 2) return 'var(--text)'
  return 'var(--danger)'
}

function availability(status) {
  switch (status) {
    case 'i': return { label: 'Injured', color: 'var(--danger)' }
    case 's': return { label: 'Suspended', color: 'var(--danger)' }
    case 'u':
    case 'n': return { label: 'Unavailable', color: 'var(--danger)' }
    case 'd': return { label: 'Doubtful', color: 'var(--gold)' }
    default:  return null
  }
}

function Silhouette({ color }) {
  return (
    <svg className="pcard-silhouette" viewBox="0 0 92 110" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="sil" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.5" />
          <stop offset="1" stopColor={color} stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <circle cx="46" cy="33" r="19" fill="url(#sil)" />
      <path d="M13 110c0-19 15-33 33-33s33 14 33 33" fill="url(#sil)" />
    </svg>
  )
}

function PlayerCard({ p, allPlayers, onAnalytics }) {
  const [imgOk, setImgOk] = useState(true)
  const posColor = POS_COLORS[p.position] || 'var(--text-secondary)'
  const injury = availability(p.status)
  const chip = injury || valueRating(p, allPlayers)

  return (
    <article className="pcard">
      <div className="pcard-head">
        <span className="pcard-tag pos" style={{ background: posColor }}>{p.position}</span>
        <span className="pcard-tag price">£{p.price}m</span>
        {p.code && imgOk
          ? <img className="pcard-photo" src={PHOTO(p.code)} alt={p.web_name} onError={() => setImgOk(false)} />
          : <Silhouette color={posColor} />}
      </div>

      <div className="pcard-body">
        <div className="pcard-name">{p.web_name}</div>
        <div className="pcard-meta">
          <span className="club">{p.team_name}</span>
          <span className="dot" style={{ background: 'var(--text-muted)' }} />
          <span className="class-chip"><span className="dot" style={{ background: chip.color }} />{chip.label}</span>
        </div>

        <div className="stat-row">
          <div className="stat"><div className="k">Pts</div><div className="v">{p.total_points}</div></div>
          <div className="stat"><div className="k">Form</div><div className="v" style={{ color: formColor(p.form) }}>{p.form}</div></div>
          <div className="stat"><div className="k">PPG</div><div className="v">{p.points_per_game}</div></div>
        </div>

        <div className="pcard-foot">
          <span className="own"><b>{p.selected_by_percent}%</b> owned</span>
          <button className="ghost-btn" onClick={() => onAnalytics(p)} title="Open in Analytics">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19V5M4 19h16" /><path d="M8 15l3-4 3 2 4-6" /></svg>
            Analyse
          </button>
        </div>
      </div>
    </article>
  )
}

export default function Players({ onAnalytics }) {
  const { players, loading } = usePlayers()
  const [position, setPosition] = useState('All')
  const [sortBy, setSortBy] = useState('total_points')
  const [search, setSearch] = useState('')
  const [view, setView] = useState('cards')

  // Position is filtered client-side: the full list is already in hand, so
  // re-requesting it per tab click only added latency.
  const filtered = players
    .filter(p => position === 'All' || p.position === position)
    .filter(p => p.web_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b[sortBy] - a[sortBy])
    .slice(0, 100)

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Player Stats &amp; Prices</h1>
        <p className="page-sub">Form, value, and expected output for every player. Hit Analyse to break one down.</p>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.6-3.6" /></svg>
          <input placeholder="Search player…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="seg">
          {POSITIONS.map(pos => (
            <button key={pos} className={position === pos ? 'on' : ''} onClick={() => setPosition(pos)}>{pos}</button>
          ))}
        </div>

        <select className="field" value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ marginLeft: 'auto', cursor: 'pointer' }}>
          <option value="total_points">Sort · Total Points</option>
          <option value="form">Sort · Form</option>
          <option value="price">Sort · Price</option>
          <option value="points_per_game">Sort · PPG</option>
          <option value="selected_by_percent">Sort · Ownership</option>
        </select>

        <div className="seg">
          <button className={view === 'cards' ? 'on' : ''} onClick={() => setView('cards')} title="Card view" aria-label="Card view">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
          </button>
          <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')} title="Table view" aria-label="Table view">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)' }}>Loading players…</p>
      ) : view === 'cards' ? (
        <>
          <div className="card-grid">
            {filtered.map(p => <PlayerCard key={p.id} p={p} allPlayers={players} onAnalytics={onAnalytics} />)}
          </div>
          <p className="result-count">{filtered.length} players shown</p>
        </>
      ) : (
        <div className="panel" style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                {['Player', 'Team', 'Pos', 'Price', 'Pts', 'Form', 'PPG', 'Value', 'Status', 'Owned', ''].map(h => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const val = valueRating(p, players)
                const injury = availability(p.status)
                const posColor = POS_COLORS[p.position] || 'var(--text-secondary)'
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 700 }}>
                      {p.code && <img src={PHOTO(p.code)} style={{ width: '22px', height: '28px', objectFit: 'contain', marginRight: '8px', verticalAlign: 'middle' }} onError={e => { e.target.style.display = 'none' }} alt="" />}
                      {p.web_name}
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{p.team_name}</td>
                    <td><span className="pos-pill" style={{ background: posColor }}>{p.position}</span></td>
                    <td style={{ color: 'var(--accent)', fontWeight: 700 }}>£{p.price}m</td>
                    <td style={{ fontWeight: 700 }}>{p.total_points}</td>
                    <td style={{ color: formColor(p.form), fontWeight: 600 }}>{p.form}</td>
                    <td>{p.points_per_game}</td>
                    <td style={{ color: val.color, fontWeight: 600 }}>{val.label}</td>
                    <td style={{ color: injury ? injury.color : 'var(--text-muted)', fontWeight: injury ? 600 : 400 }}>{injury ? injury.label : 'Available'}</td>
                    <td style={{ fontWeight: 600 }}>{p.selected_by_percent}%</td>
                    <td>
                      <button className="ghost-btn" onClick={() => onAnalytics(p)}>
                        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19V5M4 19h16" /><path d="M8 15l3-4 3 2 4-6" /></svg>
                        Analyse
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
