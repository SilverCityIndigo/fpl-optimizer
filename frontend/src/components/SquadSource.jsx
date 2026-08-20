import { useState, useMemo } from 'react'
import { getTeamSquad, getDraftSquad, getSquadFromIds } from '../api'
import { PHOTO } from '../playerPhoto'
import { usePlayers } from '../usePlayers'
import { riskMeta } from '../minutesRisk'

// Three ways to get a squad into the transfer / captain / chip tools.
//
// "Team ID" is the real one, but it only works once the gameweek deadline has
// locked: FPL's entry/{id}/event/{gw}/picks/ endpoint returns 404 until then, so
// before the season opens there is nothing to import. The other two modes exist
// so the tools are usable in that window — one asks the solver for a squad, the
// other lets you assemble your own.

const SQUAD_SHAPE = { GKP: 2, DEF: 5, MID: 5, FWD: 3 }
const POSITIONS = ['GKP', 'DEF', 'MID', 'FWD']
const POS_COLORS = { GKP: 'var(--gold)', DEF: 'var(--info)', MID: 'var(--accent)', FWD: 'var(--danger)' }
const BUDGET = 100.0

const MODES = [
  { key: 'id', label: 'Team ID' },
  { key: 'draft', label: 'Build for me' },
  { key: 'manual', label: 'Pick my own' },
]

function ManualPicker({ onSubmit, busy }) {
  const { players, loading } = usePlayers()
  const [picked, setPicked] = useState([])
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState('GKP')

  const pickedIds = useMemo(() => new Set(picked.map(p => p.id)), [picked])
  const counts = useMemo(() => {
    const c = { GKP: 0, DEF: 0, MID: 0, FWD: 0 }
    for (const p of picked) c[p.position] = (c[p.position] || 0) + 1
    return c
  }, [picked])

  const spend = picked.reduce((s, p) => s + (p.price || 0), 0)
  const remaining = BUDGET - spend
  const complete = POSITIONS.every(pos => counts[pos] === SQUAD_SHAPE[pos])

  const clubCounts = useMemo(() => {
    const c = {}
    for (const p of picked) c[p.team_id] = (c[p.team_id] || 0) + 1
    return c
  }, [picked])

  // Only offer players who can legally still be added, so the picker cannot
  // build a squad the backend will reject.
  const options = useMemo(() => {
    const term = search.trim().toLowerCase()
    return players
      .filter(p => p.position === position)
      .filter(p => !pickedIds.has(p.id))
      .filter(p => counts[p.position] < SQUAD_SHAPE[p.position])
      .filter(p => (clubCounts[p.team_id] || 0) < 3)
      .filter(p => (p.price || 0) <= remaining + 1e-9)
      .filter(p => !term || p.web_name.toLowerCase().includes(term))
      .sort((a, b) => (b.projected_points || 0) - (a.projected_points || 0))
      .slice(0, 40)
  }, [players, position, pickedIds, counts, clubCounts, remaining, search])

  if (loading) return <p className="hint">Loading players…</p>

  return (
    <div>
      <div className="tiles" style={{ marginBottom: '12px' }}>
        {POSITIONS.map(pos => (
          <div key={pos} className="tile">
            <div className="k">{pos}</div>
            <div className="v" style={{ color: counts[pos] === SQUAD_SHAPE[pos] ? 'var(--accent)' : 'var(--text)' }}>
              {counts[pos]}/{SQUAD_SHAPE[pos]}
            </div>
          </div>
        ))}
        <div className="tile">
          <div className="k">Bank</div>
          <div className="v" style={{ color: remaining < 0 ? 'var(--danger)' : 'var(--accent)' }}>
            £{remaining.toFixed(1)}m
          </div>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: '12px' }}>
        <div className="seg">
          {POSITIONS.map(pos => (
            <button key={pos} className={position === pos ? 'on' : ''} onClick={() => setPosition(pos)}>
              {pos} {counts[pos]}/{SQUAD_SHAPE[pos]}
            </button>
          ))}
        </div>
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.6-3.6" /></svg>
          <input placeholder="Search player…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {picked.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
          {picked.map(p => (
            <button key={p.id} className="ghost-btn" onClick={() => setPicked(list => list.filter(x => x.id !== p.id))}
              title={`Remove ${p.web_name}`}>
              <span className="pos-pill" style={{ background: POS_COLORS[p.position] }}>{p.position}</span>
              {p.web_name} £{p.price}m ×
            </button>
          ))}
        </div>
      )}

      <div className="psearch-menu" style={{ position: 'static', maxHeight: '260px', marginBottom: '12px' }}>
        {options.length === 0 && <div className="psearch-item"><span className="hint">No eligible players — adjust your budget or position.</span></div>}
        {options.map(p => (
          <div key={p.id} className="psearch-item" onClick={() => setPicked(list => [...list, p])}>
            {p.code && <img src={PHOTO(p.code)} alt="" style={{ height: '28px', objectFit: 'contain' }} onError={e => { e.target.style.display = 'none' }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '13.5px' }}>{p.web_name}</div>
              <div className="hint">
                {p.team_name} · £{p.price}m · {(p.projected_points ?? 0).toFixed(1)} proj
                {riskMeta(p.expected_minutes) && (
                  <> · <span style={{ color: riskMeta(p.expected_minutes).color, fontWeight: 600 }}>
                    {riskMeta(p.expected_minutes).label}
                  </span></>
                )}
              </div>
            </div>
            <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '18px', lineHeight: 1 }}>+</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn-3d" disabled={!complete || remaining < 0 || busy}
          onClick={() => onSubmit(picked.map(p => p.id))}>
          {busy ? 'Analysing…' : `Use this squad (${picked.length}/15)`}
        </button>
        {picked.length > 0 && (
          <button className="ghost-btn" onClick={() => setPicked([])}>Clear all</button>
        )}
        {!complete && <span className="hint">Fill all 15 slots to continue.</span>}
      </div>
    </div>
  )
}

export default function SquadSource({ sharedTeamId, setSharedTeamId, onSquad, actionLabel = 'Import Squad' }) {
  const [mode, setMode] = useState('id')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Every mode resolves to the same payload shape, so callers stay simple.
  async function run(request) {
    setLoading(true)
    setError('')
    try {
      const res = await request()
      if (res.data?.error) { setError(res.data.error); return }
      await onSquad(res.data)
    } catch {
      setError('Something went wrong reaching the server. Try again in a moment.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="import-panel">
      <h3>Load your squad</h3>
      <div className="tabs" style={{ marginBottom: '14px' }}>
        {MODES.map(m => (
          <button key={m.key} className={`tab${mode === m.key ? ' on' : ''}`}
            onClick={() => { setMode(m.key); setError('') }}>
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'id' && (
        <>
          <p>Find your ID in your team URL: fantasy.premierleague.com/entry/<strong style={{ color: 'var(--accent)' }}>YOUR_ID</strong>/event/…</p>
          <div className="import-row">
            <input className="field" placeholder="e.g. 1234567" value={sharedTeamId}
              onChange={e => setSharedTeamId(e.target.value)} style={{ width: '170px' }} />
            <button className="btn-3d" disabled={loading || !sharedTeamId}
              onClick={() => run(() => getTeamSquad(sharedTeamId))}>
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
              {loading ? 'Loading…' : actionLabel}
            </button>
          </div>
          <p className="hint" style={{ marginTop: '10px' }}>
            FPL only publishes squads once a gameweek deadline has passed. Before the
            season opens this will not find a team — use one of the other two tabs
            in the meantime.
          </p>
        </>
      )}

      {mode === 'draft' && (
        <>
          <p>
            Let the model build a £{BUDGET.toFixed(0)}m squad from current projections —
            a legal 15 under the budget and the three-per-club limit. A useful
            starting point to compare your own draft against.
          </p>
          <div className="import-row">
            <button className="btn-3d" disabled={loading} onClick={() => run(() => getDraftSquad(BUDGET))}>
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4.5 13H11l-1 9 8.5-11H12z" /></svg>
              {loading ? 'Building…' : 'Build optimal squad'}
            </button>
          </div>
        </>
      )}

      {mode === 'manual' && (
        <ManualPicker busy={loading} onSubmit={ids => run(() => getSquadFromIds(ids, BUDGET))} />
      )}

      {error && <p style={{ color: 'var(--danger)', marginTop: '12px', fontSize: '13px' }}>{error}</p>}
    </div>
  )
}
