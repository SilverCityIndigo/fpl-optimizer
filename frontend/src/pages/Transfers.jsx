import { useState, useEffect } from 'react'
import { getTransferSuggestions, getHitAnalysis } from '../api'
import pitchImg from '../assets/fpl_pitch.jpg'
import { PHOTO } from '../playerPhoto'
import SquadSource from '../components/SquadSource'


function XGStats({ player }) {
  const xgi = parseFloat(player.xgi_per90 || 0)
  const xg = parseFloat(player.xg_per90 || 0)
  const xa = parseFloat(player.xa_per90 || 0)
  if (!xgi || player.position === 'GKP' || player.position === 'DEF') return null
  const color = xgi >= 0.6 ? 'var(--accent)' : xgi >= 0.35 ? 'var(--gold)' : '#e0872e'
  const fmt = v => v.toFixed(2)
  return (
    <div style={{ marginTop: '8px' }}>
      <div className="hint" style={{ marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.06em', fontSize: '10px' }}>xG stats / 90</div>
      <div style={{ display: 'flex', gap: '6px' }}>
        {[['xG', xg], ['xA', xa], ['xGI', xgi]].map(([label, val]) => (
          <div key={label} className="tile" style={{ minWidth: '44px', padding: '5px 8px', borderColor: label === 'xGI' ? `color-mix(in srgb, ${color} 45%, var(--line))` : 'var(--line)' }}>
            <div className="v" style={{ fontSize: '13px', color: label === 'xGI' ? color : 'var(--text)' }}>{fmt(val)}</div>
            <div className="k">{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PitchPlayerCard({ player, isBench }) {
  const [imgOk, setImgOk] = useState(true)
  const pts = player.projected_points
  const fixture = player.next_fixture || ''
  return (
    <div className={`pitch-card${isBench ? ' bench' : ''}`}>
      <div className="pitch-face">
        {player.code && imgOk
          ? <img src={PHOTO(player.code)} alt={player.web_name} onError={() => setImgOk(false)} />
          : <span className="pitch-face-initial">{player.web_name?.[0] || '·'}</span>}
      </div>
      <div className="pitch-name">{player.web_name}</div>
      <div className="pitch-club">{player.team_name}</div>
      {!isBench && (
        <div className="pitch-chips">
          {fixture && <span className="pitch-chip fix">{fixture}</span>}
          {pts != null && <span className="pitch-chip pts">{pts} pts</span>}
        </div>
      )}
    </div>
  )
}

function PitchView({ squad, picks }) {
  const ordered = picks.map(pick => {
    const player = squad.find(p => p.id === pick.element)
    return player ? { ...player, pickPosition: pick.position, isSub: pick.is_sub } : null
  }).filter(Boolean)
  const starters = ordered.filter(p => !p.isSub)
  const bench = ordered.filter(p => p.isSub)
  const gkp = starters.filter(p => p.position === 'GKP')
  const defs = starters.filter(p => p.position === 'DEF')
  const mids = starters.filter(p => p.position === 'MID')
  const fwds = starters.filter(p => p.position === 'FWD')
  const totalProj = starters.reduce((sum, p) => sum + (p.projected_points || 0), 0)
  const Row = ({ players, isBench = false }) => (
    <div className="pitch-row">
      {players.map(p => <PitchPlayerCard key={p.id} player={p} isBench={isBench} />)}
    </div>
  )
  return (
    <div className="pitch">
      <div className="pitch-head">
        <span>Projected GW points (Starting 11):</span>
        <b>{totalProj.toFixed(1)} pts</b>
      </div>
      <div className="pitch-grass" style={{ background: `url(${pitchImg}) top center/cover no-repeat` }}>
        <Row players={gkp} /><Row players={defs} /><Row players={mids} /><Row players={fwds} />
      </div>
      <div className="pitch-bench">
        <div className="pitch-bench-k">Bench</div>
        <Row players={bench} isBench />
      </div>
    </div>
  )
}

export default function Transfers({ sharedTeamId, setSharedTeamId, sharedSquadData, setSharedSquadData }) {
  const [budgetItb, setBudgetItb] = useState(0)
  const [freeTransfers, setFreeTransfers] = useState(1)
  const [squad, setSquad] = useState([])
  const [squadIds, setSquadIds] = useState([])
  const [picks, setPicks] = useState([])
  const [nextGw, setNextGw] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [hitAnalysis, setHitAnalysis] = useState(null)
  const [viewMode, setViewMode] = useState('pitch')

  useEffect(() => {
    if (sharedSquadData && squad.length === 0) applySquadData(sharedSquadData)
  }, [])

  function applySquadData(data) {
    setSquad(data.players); setSquadIds(data.player_ids); setPicks(data.picks || [])
    setNextGw(data.next_gw || null)
    if (data.bank !== undefined) setBudgetItb(data.bank)
    if (data.transfers_left !== undefined) setFreeTransfers(data.transfers_left)
    setStep(2)
  }

  async function fetchSuggestions() {
    setLoading(true); setError('')
    try {
      const [transferRes, hitRes] = await Promise.all([
        getTransferSuggestions(squadIds, budgetItb, freeTransfers),
        getHitAnalysis(squadIds, budgetItb, freeTransfers)
      ])
      setSuggestions(transferRes.data); setHitAnalysis(hitRes.data); setStep(3)
    } catch { setError('Failed to get suggestions.') }
    setLoading(false)
  }

  function getValueColor(val) {
    if (val > 1.5) return 'var(--accent)'
    if (val > 0.5) return 'var(--gold)'
    return 'var(--danger)'
  }

  const gwLabel = nextGw ? `GW${nextGw}` : 'GW'

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Transfer Recommendations</h1>
        <p className="page-sub">Import your squad for data-driven transfer suggestions ranked by projected points gain.</p>
      </div>

      <SquadSource
        sharedTeamId={sharedTeamId}
        setSharedTeamId={setSharedTeamId}
        actionLabel="Import Squad"
        onSquad={data => { setSharedSquadData(data); applySquadData(data) }}
      />
      {error && <p style={{ color: 'var(--danger)', marginTop: '12px', fontSize: '13px' }}>{error}</p>}

      {step >= 2 && squad.length > 0 && (
        <div className="panel panel-pad" style={{ marginBottom: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <h3 className="section-title">Your Current Squad</h3>
            <div className="seg">
              <button className={viewMode === 'pitch' ? 'on' : ''} onClick={() => setViewMode('pitch')}>Pitch</button>
              <button className={viewMode === 'list' ? 'on' : ''} onClick={() => setViewMode('list')}>List</button>
            </div>
          </div>

          {viewMode === 'pitch' && picks.length > 0 ? (
            <PitchView squad={squad} picks={picks} />
          ) : (
            <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
              <table className="data-table">
                <thead>
                  <tr>{['Player', 'Team', 'Pos', 'Price', 'Pts', 'Form', 'PPG', `${gwLabel} Proj`].map(h => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {squad.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 700 }}>{p.web_name}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{p.team_name}</td>
                      <td><span className="pos-pill" style={{ background: 'var(--surface-3)', color: 'var(--text)' }}>{p.position}</span></td>
                      <td style={{ color: 'var(--accent)', fontWeight: 700 }}>£{p.price}m</td>
                      <td>{p.total_points}</td><td>{p.form}</td><td>{p.points_per_game}</td>
                      <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{p.projected_points != null ? p.projected_points : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'flex-end' }}>
            <div>
              <label className="hint" style={{ display: 'block', marginBottom: '5px' }}>Budget in the bank (£m)</label>
              <input type="number" step="0.1" min="0" value={budgetItb} onChange={e => setBudgetItb(parseFloat(e.target.value) || 0)} className="field" style={{ width: '120px' }} />
            </div>
            <div>
              <label className="hint" style={{ display: 'block', marginBottom: '5px' }}>Free transfers</label>
              <select value={freeTransfers} onChange={e => setFreeTransfers(parseInt(e.target.value))} className="field">
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          <button className="btn-3d" onClick={fetchSuggestions} disabled={loading}>
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.6-3.6" /></svg>
            {loading ? 'Analyzing…' : 'Get Transfer Suggestions'}
          </button>
        </div>
      )}

      {step >= 3 && suggestions.length > 0 && (
        <div className="panel panel-pad">
          <h3 className="section-title" style={{ marginBottom: '16px' }}>Recommended Transfers</h3>

          {hitAnalysis && (
            <div className="panel panel-pad" style={{ marginBottom: '18px', borderColor: hitAnalysis.take_hit ? 'var(--accent)' : 'var(--danger)', background: hitAnalysis.take_hit ? 'color-mix(in srgb, var(--accent) 8%, var(--surface))' : 'color-mix(in srgb, var(--danger) 8%, var(--surface))' }}>
              <h3 style={{ color: hitAnalysis.take_hit ? 'var(--accent)' : 'var(--danger)', marginBottom: '10px', fontSize: '16px' }}>
                {hitAnalysis.take_hit ? 'Recommendation: Take the −4 Hit' : 'Recommendation: No Hit Needed'}
              </h3>
              <p style={{ color: 'var(--text)', marginBottom: '16px', fontSize: '14px' }}>{hitAnalysis.recommendation}</p>
              <div className="tiles" style={{ marginBottom: '16px' }}>
                {[['Best 1 Transfer', `+${hitAnalysis.gain_1_transfer}`, 'var(--gold)'], ['Best 2 Transfers', `+${hitAnalysis.gain_2_transfers}`, 'var(--gold)'], ['2 Transfers − Hit', `+${hitAnalysis.gain_2_after_hit}`, hitAnalysis.take_hit ? 'var(--accent)' : 'var(--danger)']].map(([k, v, c]) => (
                  <div key={k} className="tile" style={{ flex: 1, minWidth: '130px' }}><div className="k">{k}</div><div className="v" style={{ color: c, fontSize: '20px' }}>{v} pts</div></div>
                ))}
              </div>
              <div className="hint" style={{ textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '10px' }}>Multi-week plan</div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {hitAnalysis.multi_week_plan.map((week, i) => (
                  <div key={i} className="tile" style={{ flex: 1, minWidth: '200px', textAlign: 'left', padding: '12px' }}>
                    <div style={{ color: 'var(--accent)', fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>{week.week}</div>
                    <div style={{ color: 'var(--text)', fontSize: '13px', marginBottom: '6px' }}>{week.action}</div>
                    {week.transfers.map((t, j) => (
                      <div key={j} style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                        OUT <span style={{ color: 'var(--danger)' }}>{t.sell.web_name}</span> → IN <span style={{ color: 'var(--accent)' }}>{t.buy.web_name}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {suggestions.map((s, i) => (
            <div key={i} className="panel" style={{ padding: '16px', marginBottom: '12px', background: 'var(--surface-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <span className="rank">#{i + 1}</span>
                <span style={{ color: 'var(--danger)', fontWeight: 700, fontSize: '15px' }}>OUT: {s.sell.web_name}</span>
                <span style={{ color: 'var(--text-secondary)' }}>→</span>
                <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '15px' }}>IN: {s.buy.web_name}</span>
                <span style={{ marginLeft: 'auto', color: getValueColor(s.points_gain), fontWeight: 700, fontSize: '15px' }}>+{s.points_gain} pts</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))', gap: '12px' }}>
                {[['Selling', s.sell, 'var(--danger)'], ['Buying', s.buy, 'var(--accent)']].map(([label, p, color]) => (
                  <div key={label} className="panel" style={{ padding: '12px', background: 'var(--surface)' }}>
                    <div style={{ color, fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>{label}</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', marginBottom: '8px' }}>
                      {p.code && <img src={PHOTO(p.code)} alt={p.web_name} style={{ height: '60px', objectFit: 'contain' }} onError={e => { e.target.style.display = 'none' }} />}
                      <div style={{ fontSize: '17px', fontWeight: 700 }}>{p.web_name}</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                      <span>Price</span><span style={{ color: 'var(--text)' }}>£{p.price}m</span>
                      <span>Total Pts</span><span style={{ color: 'var(--text)' }}>{p.total_points}</span>
                      <span>Form</span><span style={{ color: 'var(--text)' }}>{p.form}</span>
                      <span>PPG</span><span style={{ color: 'var(--text)' }}>{p.points_per_game}</span>
                      <span>Team</span><span style={{ color: 'var(--text)' }}>{p.team_name}</span>
                    </div>
                    {label === 'Buying' && <XGStats player={p} />}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Cost difference: <span style={{ color: s.cost_diff > 0 ? 'var(--danger)' : 'var(--accent)' }}>{s.cost_diff > 0 ? `+£${s.cost_diff}m` : `£${s.cost_diff}m`}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {step >= 3 && suggestions.length === 0 && (
        <div className="panel panel-pad" style={{ color: 'var(--text-secondary)' }}>
          No beneficial transfers found with your current budget. Try adding more budget in the bank.
        </div>
      )}
    </div>
  )
}
