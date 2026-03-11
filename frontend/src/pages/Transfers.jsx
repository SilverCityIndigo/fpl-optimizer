import { useState } from 'react'
import { getTeamSquad, getTransferSuggestions, getHitAnalysis } from '../api'
import pitchImg from '../assets/fpl_pitch.jpg'

function XGStats({ player }) {
  const xgi = parseFloat(player.xgi_per90 || 0)
  const xg  = parseFloat(player.xg_per90  || 0)
  const xa  = parseFloat(player.xa_per90  || 0)

  if (!xgi || player.position === 'GKP' || player.position === 'DEF') return null

  const color = xgi >= 0.6 ? '#00ff87' : xgi >= 0.35 ? '#ffd700' : '#ff8800'
  const fmt = v => v.toFixed(2)

  return (
    <div style={{ marginTop: '8px' }}>
      <div style={{ color: '#aaa', fontSize: '10px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        xG Stats / 90
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        {[['xG', xg], ['xA', xa], ['xGI', xgi]].map(([label, val]) => (
          <div key={label} style={{
            background: '#0e1117',
            border: `1px solid ${label === 'xGI' ? color + '55' : '#2a2f3e'}`,
            borderRadius: '5px',
            padding: '4px 8px',
            textAlign: 'center',
            minWidth: '44px'
          }}>
            <div style={{ color: label === 'xGI' ? color : '#fff', fontWeight: 'bold', fontSize: '13px' }}>
              {fmt(val)}
            </div>
            <div style={{ color: '#6b7280', fontSize: '10px' }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ color: '#6b7280', fontSize: '10px', marginTop: '3px' }}>
        {xgi > 0 ? '⚡ xGI blended into projection' : ''}
      </div>
    </div>
  )
}

function PitchPlayerCard({ player, isBench }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '90px',
    }}>
      <div style={{
        width: '68px',
        height: '68px',
        borderRadius: '50%',
        overflow: 'hidden',
        background: '#1a1f2e',
        border: `3px solid ${isBench ? '#4b5563' : '#fff'}`,
        marginBottom: '5px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: isBench ? 'none' : '0 2px 8px rgba(0,0,0,0.5)',
      }}>
        {player.code ? (
          <img
            src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${player.code}.png`}
            alt={player.web_name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
            onError={e => {
              e.target.style.display = 'none'
              e.target.parentNode.innerHTML = `<span style="font-size:26px">👤</span>`
            }}
          />
        ) : (
          <span style={{ fontSize: '26px' }}>👤</span>
        )}
      </div>
      <div style={{
        background: isBench ? '#374151' : '#1a1f2e',
        color: '#fff',
        fontSize: '11px',
        fontWeight: 'bold',
        padding: '3px 8px',
        borderRadius: '4px',
        maxWidth: '90px',
        textAlign: 'center',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        marginBottom: '2px',
        border: isBench ? 'none' : '1px solid rgba(255,255,255,0.2)',
      }}>
        {player.web_name}
      </div>
      <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '10px' }}>{player.team_name}</div>
    </div>
  )
}

function PitchView({ squad, picks }) {
  const ordered = picks.map(pick => {
    const player = squad.find(p => p.id === pick.element)
    return player ? { ...player, pickPosition: pick.position, isSub: pick.is_sub } : null
  }).filter(Boolean)

  const starters = ordered.filter(p => !p.isSub)
  const bench    = ordered.filter(p => p.isSub)

  const gkp  = starters.filter(p => p.position === 'GKP')
  const defs = starters.filter(p => p.position === 'DEF')
  const mids = starters.filter(p => p.position === 'MID')
  const fwds = starters.filter(p => p.position === 'FWD')

  const Row = ({ players, isBench = false }) => (
    <div style={{
      display: 'flex',
      justifyContent: 'space-evenly',
      alignItems: 'center',
      width: '100%',
      padding: '6px 24px',
      boxSizing: 'border-box',
    }}>
      {players.map(p => (
        <PitchPlayerCard key={p.id} player={p} isBench={isBench} />
      ))}
    </div>
  )

  return (
    <div style={{ borderRadius: '12px', overflow: 'hidden', marginBottom: '20px' }}>
      {/* Pitch — GKP at top, FWD at bottom */}
      <div style={{
        background: `url(${pitchImg}) top center/cover no-repeat`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-evenly',
        minHeight: '560px',
        padding: '12px 0',
        boxSizing: 'border-box',
      }}>
        <Row players={gkp} />
        <Row players={defs} />
        <Row players={mids} />
        <Row players={fwds} />
      </div>

      {/* Bench strip */}
      <div style={{
        background: '#111827',
        borderTop: '2px dashed #374151',
        padding: '12px 8px 16px',
      }}>
        <div style={{ color: '#6b7280', fontSize: '11px', textAlign: 'center', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Bench
        </div>
        <Row players={bench} isBench={true} />
      </div>
    </div>
  )
}

export default function Transfers() {
  const [teamId, setTeamId]               = useState('')
  const [budgetItb, setBudgetItb]         = useState(0)
  const [freeTransfers, setFreeTransfers] = useState(1)
  const [squad, setSquad]                 = useState([])
  const [squadIds, setSquadIds]           = useState([])
  const [picks, setPicks]                 = useState([])
  const [suggestions, setSuggestions]     = useState([])
  const [loading, setLoading]             = useState(false)
  const [step, setStep]                   = useState(1)
  const [error, setError]                 = useState('')
  const [hitAnalysis, setHitAnalysis]     = useState(null)
  const [viewMode, setViewMode]           = useState('list')

  const td = { padding: '10px 12px', borderBottom: '1px solid #1a1f2e', fontSize: '14px' }
  const th = { padding: '10px 12px', textAlign: 'left', borderBottom: '1px solid #2a2f3e', color: '#aaa', fontSize: '13px' }

  async function fetchSquad() {
    if (!teamId) return
    setLoading(true)
    setError('')
    try {
      const res = await getTeamSquad(teamId)
      if (res.data.error) { setError(res.data.error); setLoading(false); return }
      setSquad(res.data.players)
      setSquadIds(res.data.player_ids)
      setPicks(res.data.picks || [])
      if (res.data.bank !== undefined) setBudgetItb(res.data.bank)
      if (res.data.transfers_left !== undefined) setFreeTransfers(res.data.transfers_left)
      setStep(2)
    } catch {
      setError('Failed to fetch team. Make sure your team ID is correct.')
    }
    setLoading(false)
  }

  async function fetchSuggestions() {
    setLoading(true)
    setError('')
    try {
      const [transferRes, hitRes] = await Promise.all([
        getTransferSuggestions(squadIds, budgetItb, freeTransfers),
        getHitAnalysis(squadIds, budgetItb, freeTransfers)
      ])
      setSuggestions(transferRes.data)
      setHitAnalysis(hitRes.data)
      setStep(3)
    } catch {
      setError('Failed to get suggestions.')
    }
    setLoading(false)
  }

  function getValueColor(val) {
    if (val > 1.5) return '#00ff87'
    if (val > 0.5) return '#ffd700'
    return '#ff4444'
  }

  const toggleBtn = (mode, label) => (
    <button
      onClick={() => setViewMode(mode)}
      style={{
        padding: '6px 16px',
        borderRadius: '6px',
        border: '1px solid #2a2f3e',
        background: viewMode === mode ? '#00ff87' : '#0e1117',
        color: viewMode === mode ? '#000' : '#aaa',
        fontWeight: viewMode === mode ? 'bold' : 'normal',
        cursor: 'pointer',
        fontSize: '13px',
      }}
    >
      {label}
    </button>
  )

  return (
    <div>
      <h2 style={{ marginBottom: '8px', color: '#00ff87' }}>Transfer Recommendations</h2>
      <p style={{ color: '#aaa', marginBottom: '24px', fontSize: '14px' }}>
        Import your FPL squad and get data-driven transfer suggestions ranked by projected points gain.
      </p>

      {/* Step 1: Enter team ID */}
      <div style={{ background: '#1a1f2e', borderRadius: '8px', padding: '20px', marginBottom: '20px' }}>
        <h3 style={{ marginBottom: '16px', fontSize: '15px' }}>Enter your FPL Team ID</h3>
        <p style={{ color: '#aaa', fontSize: '13px', marginBottom: '12px' }}>
          Find your team ID in the URL when viewing your FPL team page: fantasy.premierleague.com/entry/<strong style={{ color: '#00ff87' }}>YOUR_ID</strong>/event/...
        </p>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="e.g. 1234567"
            value={teamId}
            onChange={e => setTeamId(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #2a2f3e', background: '#0e1117', color: '#fff', width: '160px' }}
          />
          <button onClick={fetchSquad} disabled={loading}
            style={{ padding: '8px 20px', borderRadius: '6px', background: '#00ff87', color: '#000', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
            {loading ? 'Loading...' : 'Import Squad'}
          </button>
        </div>
        {error && <p style={{ color: '#ff4444', marginTop: '12px', fontSize: '13px' }}>{error}</p>}
      </div>

      {/* Step 2: Squad + settings */}
      {step >= 2 && squad.length > 0 && (
        <div style={{ background: '#1a1f2e', borderRadius: '8px', padding: '20px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <h3 style={{ fontSize: '15px', margin: 0 }}>Step 2: Your Current Squad</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              {toggleBtn('list',  '☰ List View')}
              {toggleBtn('pitch', '⚽ Pitch View')}
            </div>
          </div>

          {viewMode === 'pitch' && picks.length > 0 ? (
            <PitchView squad={squad} picks={picks} />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px' }}>
              <thead style={{ background: '#0e1117' }}>
                <tr>
                  <th style={th}>Player</th>
                  <th style={th}>Team</th>
                  <th style={th}>Pos</th>
                  <th style={th}>Price</th>
                  <th style={th}>Pts</th>
                  <th style={th}>Form</th>
                  <th style={th}>PPG</th>
                </tr>
              </thead>
              <tbody>
                {squad.map(p => (
                  <tr key={p.id}
                    onMouseEnter={e => e.currentTarget.style.background = '#222736'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ ...td, fontWeight: 'bold' }}>{p.web_name}</td>
                    <td style={{ ...td, color: '#aaa' }}>{p.team_name}</td>
                    <td style={td}><span style={{ background: '#2a2f3e', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>{p.position}</span></td>
                    <td style={{ ...td, color: '#00ff87' }}>£{p.price}m</td>
                    <td style={td}>{p.total_points}</td>
                    <td style={td}>{p.form}</td>
                    <td style={td}>{p.points_per_game}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '16px' }}>
            <div>
              <label style={{ color: '#aaa', fontSize: '13px', display: 'block', marginBottom: '4px' }}>Budget in the bank (£m)</label>
              <input type="number" step="0.1" min="0" value={budgetItb}
                onChange={e => setBudgetItb(parseFloat(e.target.value) || 0)}
                style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #2a2f3e', background: '#0e1117', color: '#fff', width: '120px' }} />
            </div>
            <div>
              <label style={{ color: '#aaa', fontSize: '13px', display: 'block', marginBottom: '4px' }}>Free transfers</label>
              <select value={freeTransfers} onChange={e => setFreeTransfers(parseInt(e.target.value))}
                style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #2a2f3e', background: '#0e1117', color: '#fff' }}>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
                <option value={5}>5</option>
              </select>
            </div>
          </div>

          <button onClick={fetchSuggestions} disabled={loading}
            style={{ padding: '10px 24px', borderRadius: '6px', background: '#00ff87', color: '#000', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
            {loading ? 'Analyzing...' : '🔍 Get Transfer Suggestions'}
          </button>
        </div>
      )}

      {/* Step 3: Suggestions */}
      {step >= 3 && suggestions.length > 0 && (
        <div style={{ background: '#1a1f2e', borderRadius: '8px', padding: '20px' }}>
          <h3 style={{ marginBottom: '16px', fontSize: '15px' }}>Step 3: Recommended Transfers</h3>

          {hitAnalysis && (
            <div style={{
              background: hitAnalysis.take_hit ? '#0d2b1a' : '#2b0d0d',
              border: `1px solid ${hitAnalysis.take_hit ? '#00ff87' : '#ff4444'}`,
              borderRadius: '8px', padding: '20px', marginBottom: '20px'
            }}>
              <h3 style={{ color: hitAnalysis.take_hit ? '#00ff87' : '#ff4444', marginBottom: '12px' }}>
                {hitAnalysis.take_hit ? '✅ Recommendation: Take the -4 Hit' : '❌ Recommendation: No Hit Needed'}
              </h3>
              <p style={{ color: '#fff', marginBottom: '16px', fontSize: '15px' }}>{hitAnalysis.recommendation}</p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
                {[
                  ['Best 1 Transfer', `+${hitAnalysis.gain_1_transfer} pts`, '#ffd700'],
                  ['Best 2 Transfers', `+${hitAnalysis.gain_2_transfers} pts`, '#ffd700'],
                  ['2 Transfers - Hit', `+${hitAnalysis.gain_2_after_hit} pts`, hitAnalysis.take_hit ? '#00ff87' : '#ff4444']
                ].map(([label, value, color]) => (
                  <div key={label} style={{ background: '#0e1117', borderRadius: '6px', padding: '12px', textAlign: 'center' }}>
                    <div style={{ color: '#aaa', fontSize: '12px', marginBottom: '4px' }}>{label}</div>
                    <div style={{ color, fontSize: '22px', fontWeight: 'bold' }}>{value}</div>
                  </div>
                ))}
              </div>

              <h4 style={{ color: '#aaa', marginBottom: '12px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '1px' }}>Multi-Week Plan</h4>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {hitAnalysis.multi_week_plan.map((week, i) => (
                  <div key={i} style={{ background: '#0e1117', borderRadius: '6px', padding: '12px', flex: '1', minWidth: '200px' }}>
                    <div style={{ color: '#00ff87', fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>{week.week}</div>
                    <div style={{ color: '#fff', fontSize: '13px', marginBottom: '8px' }}>{week.action}</div>
                    {week.transfers.map((t, j) => (
                      <div key={j} style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>
                        OUT <span style={{ color: '#ff4444' }}>{t.sell.web_name}</span> → IN <span style={{ color: '#00ff87' }}>{t.buy.web_name}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {suggestions.map((s, i) => (
            <div key={i} style={{ background: '#0e1117', borderRadius: '8px', padding: '16px', marginBottom: '12px', border: '1px solid #2a2f3e' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <span style={{ background: '#222736', borderRadius: '4px', padding: '2px 8px', fontSize: '12px', color: '#aaa' }}>#{i + 1}</span>
                <span style={{ color: '#ff4444', fontWeight: 'bold', fontSize: '16px' }}>OUT: {s.sell.web_name}</span>
                <span style={{ color: '#aaa' }}>→</span>
                <span style={{ color: '#00ff87', fontWeight: 'bold', fontSize: '16px' }}>IN: {s.buy.web_name}</span>
                <span style={{ marginLeft: 'auto', color: getValueColor(s.points_gain), fontWeight: 'bold', fontSize: '15px' }}>
                  +{s.points_gain} pts gain
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                {[['Selling', s.sell, '#ff4444'], ['Buying', s.buy, '#00ff87']].map(([label, p, color]) => (
                  <div key={label} style={{ background: '#1a1f2e', borderRadius: '6px', padding: '12px' }}>
                    <div style={{ color, fontSize: '12px', fontWeight: 'bold', marginBottom: '8px' }}>{label}</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', marginBottom: '8px' }}>
                      {p.code && (
                        <img
                          src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.code}.png`}
                          alt={p.web_name}
                          style={{ height: '70px', objectFit: 'contain' }}
                          onError={e => e.target.style.display = 'none'}
                        />
                      )}
                      <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{p.web_name}</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '13px', color: '#aaa' }}>
                      <span>Price</span><span style={{ color: '#fff' }}>£{p.price}m</span>
                      <span>Total Pts</span><span style={{ color: '#fff' }}>{p.total_points}</span>
                      <span>Form</span><span style={{ color: '#fff' }}>{p.form}</span>
                      <span>PPG</span><span style={{ color: '#fff' }}>{p.points_per_game}</span>
                      <span>Team</span><span style={{ color: '#fff' }}>{p.team_name}</span>
                    </div>
                    {label === 'Buying' && <XGStats player={p} />}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '10px', fontSize: '13px', color: '#aaa' }}>
                Cost difference: <span style={{ color: s.cost_diff > 0 ? '#ff4444' : '#00ff87' }}>
                  {s.cost_diff > 0 ? `+£${s.cost_diff}m` : `£${s.cost_diff}m`}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {step >= 3 && suggestions.length === 0 && (
        <div style={{ background: '#1a1f2e', borderRadius: '8px', padding: '20px', color: '#aaa' }}>
          No beneficial transfers found with your current budget. Try adding more budget in the bank.
        </div>
      )}
    </div>
  )
}
