import { useState } from 'react'
import { getTeamSquad, getTransferSuggestions, getHitAnalysis } from '../api' 

export default function Transfers() {
  const [teamId, setTeamId] = useState('')
  const [budgetItb, setBudgetItb] = useState(0)
  const [freeTransfers, setFreeTransfers] = useState(1)
  const [squad, setSquad] = useState([])
  const [squadIds, setSquadIds] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [hitAnalysis, setHitAnalysis] = useState(null) 

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

  return (
    <div>
      <h2 style={{ marginBottom: '8px', color: '#00ff87' }}>Transfer Recommendations</h2>
      <p style={{ color: '#aaa', marginBottom: '24px', fontSize: '14px' }}>
        Import your FPL squad and get data-driven transfer suggestions ranked by projected points gain.
      </p>

      {/* Step 1: Enter team ID */}
      <div style={{ background: '#1a1f2e', borderRadius: '8px', padding: '20px', marginBottom: '20px' }}>
        <h3 style={{ marginBottom: '16px', fontSize: '15px' }}>Step 1: Enter your FPL Team ID</h3>
        <p style={{ color: '#aaa', fontSize: '13px', marginBottom: '12px' }}>
          Find your team ID in the URL when viewing your FPL team page: fantasy.premierleague.com/entry/<strong style={{color:'#00ff87'}}>YOUR_ID</strong>/event/...
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

      {/* Step 2: Show squad + transfer settings */}
      {step >= 2 && squad.length > 0 && (
        <div style={{ background: '#1a1f2e', borderRadius: '8px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ marginBottom: '16px', fontSize: '15px' }}>Step 2: Your Current Squad</h3>
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
          {/* Hit Analysis Banner */}
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