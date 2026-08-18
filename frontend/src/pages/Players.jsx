import { useState, useMemo } from 'react'
import { PHOTO } from '../playerPhoto'
import { usePlayers } from '../usePlayers'

const POSITIONS = ['All', 'GKP', 'DEF', 'MID', 'FWD']
const POS_COLORS = { GKP: 'var(--gold)', DEF: 'var(--info)', MID: 'var(--accent)', FWD: 'var(--danger)' }

// Value = projected points per £m. Using projections rather than
// points_per_game matters most right now: for the first few gameweeks PPG and
// form are near zero for everyone, and the old absolute thresholds
// (form < 2 -> Avoid) therefore labelled almost the entire league "Avoid".
// Projections are seeded pre-season, so they carry signal from GW1.
const valuePerMillion = p => (p.projected_points || 0) / Math.max(0.1, p.price || 0)

// Ranks are computed once per player list, not once per rendered card. The old
// version filtered and sorted the full ~700-player list inside every card.
function buildRatingContext(players) {
  const byPosition = {}
  for (const p of players) {
    if (!byPosition[p.position]) byPosition[p.position] = []
    byPosition[p.position].push(p)
  }
  const valuePct = new Map()  // 0 = best value in its position, 1 = worst
  const ownRank = new Map()
  for (const list of Object.values(byPosition)) {
    const denom = Math.max(1, list.length - 1)
    ;[...list]
      .sort((a, b) => valuePerMillion(b) - valuePerMillion(a))
      .forEach((p, i) => valuePct.set(p.id, i / denom))
    ;[...list]
      .sort((a, b) => parseFloat(b.selected_by_percent || 0) - parseFloat(a.selected_by_percent || 0))
      .forEach((p, i) => ownRank.set(p.id, i))
  }
  return { valuePct, ownRank }
}

// Percentiles within a position rather than absolute cutoffs, so the labels
// self-calibrate instead of all collapsing to one bucket early in the season,
// and so a 4.5m defender isn't judged on a striker's scale.
function valueRating(player, ctx) {
  if ((player.projected_points || 0) < 1.5) {
    return { label: 'Avoid', color: 'var(--danger)' }
  }
  const pct = ctx.valuePct.get(player.id) ?? 1
  const ownRank = ctx.ownRank.get(player.id) ?? 99
  // Heavily owned AND still decent value is the safe pick, not a bargain. The
  // old code returned Reliable for the top 3 owned unconditionally, so a
  // popular player in dreadful form still read as Reliable.
  if (ownRank < 3 && pct <= 0.5) return { label: 'Reliable', color: 'var(--info)' }
  if (pct <= 0.15) return { label: 'Elite value', color: 'var(--accent)' }
  if (pct <= 0.35) return { label: 'Good value', color: 'var(--accent)' }
  if (pct <= 0.65) return { label: 'Fair value', color: 'var(--gold)' }
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

function PlayerCard({ p, ratingCtx, onAnalytics }) {
  const [imgOk, setImgOk] = useState(true)
  const posColor = POS_COLORS[p.position] || 'var(--text-secondary)'
  const injury = availability(p.status)
  const chip = injury || valueRating(p, ratingCtx)

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
  // Projected, not total points: every total is 0 until the season is under way.
  const [sortBy, setSortBy] = useState('projected_points')
  const [search, setSearch] = useState('')
  const [view, setView] = useState('cards')

  const ratingCtx = useMemo(() => buildRatingContext(players), [players])

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
          <option value="projected_points">Sort · Projected Pts</option>
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
            {filtered.map(p => <PlayerCard key={p.id} p={p} ratingCtx={ratingCtx} onAnalytics={onAnalytics} />)}
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
                const val = valueRating(p, ratingCtx)
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
