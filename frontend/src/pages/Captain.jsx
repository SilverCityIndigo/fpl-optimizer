import { useState, useEffect } from 'react'
import { getTeamSquad, getCaptainPick } from '../api'

const FDR_COLORS = { 1: '#00ff87', 2: '#7fff00', 3: '#ffd700', 4: '#ff8800', 5: '#ff4444' }
const FDR_LABELS = { 1: 'Very Easy', 2: 'Easy', 3: 'Medium', 4: 'Hard', 5: 'Very Hard' }

export default function Captain({ sharedTeamId, setSharedTeamId, sharedSquadData, setSharedSquadData }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [picks, setPicks] = useState([])
  const [step, setStep] = useState(1)

  // Auto-load if squad already fetched on another page
  useEffect(() => {
    if (sharedSquadData && picks.length === 0) {
      loadCaptainFromSquad(sharedSquadData)
    }
  }, [])

  async function loadCaptainFromSquad(squadData) {
    setLoading(true)
    setError('')
    try {
      const captainRes = await getCaptainPick(squadData.player_ids)
      setPicks(captainRes.data)
      setStep(3)
    } catch {
      setError('Failed to get captain picks.')
    }
    setLoading(false)
  }

  async function fetchSquad() {
    if (!sharedTeamId) return
    setLoading(true)
    setError('')
    try {
      const res = await getTeamSquad(sharedTeamId)
      if (res.data.error) { setError(res.data.error); setLoading(false); return }
      setSharedSquadData(res.data)
      await loadCaptainFromSquad(res.data)
    } catch {
      setError('Failed to fetch team. Make sure your team ID is correct.')
    }
    setLoading(false)
  }

  return (
    <div>
      <h2 style={{ marginBottom: '8px', color: '#00ff87' }}>Captain Picker</h2>
      <p style={{ color: '#aaa', marginBottom: '24px', fontSize: '14px' }}>
        Import your squad and get fixture-adjusted captain recommendations for the next gameweek.
      </p>

      <div style={{ background: '#1a1f2e', borderRadius: '8px', padding: '20px', marginBottom: '20px' }}>
        <h3 style={{ marginBottom: '12px', fontSize: '15px' }}>Enter your FPL Team ID</h3>
        <p style={{ color: '#aaa', fontSize: '13px', marginBottom: '12px' }}>
           Find your team ID in the URL when viewing your FPL team page: fantasy.premierleague.com/entry/<strong style={{color:'#00ff87'}}>YOUR_ID</strong>/event/
        </p>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <input
            placeholder="e.g. 1234567"
            value={sharedTeamId}
            onChange={e => setSharedTeamId(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #2a2f3e', background: '#0e1117', color: '#fff', width: '160px' }}
          />
          <button onClick={fetchSquad} disabled={loading}
            style={{ padding: '8px 20px', borderRadius: '6px', background: '#00ff87', color: '#000', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
            {loading ? 'Analyzing...' : '⚡ Get Captain Picks'}
          </button>
        </div>
        {error && <p style={{ color: '#ff4444', marginTop: '12px', fontSize: '13px' }}>{error}</p>}
      </div>

      {step === 3 && picks.length > 0 && (
        <div>
          <div style={{
            background: 'linear-gradient(135deg, #0d2b1a, #1a3a2a)',
            border: '1px solid #00ff87', borderRadius: '12px', padding: '24px',
            marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap'
          }}>
            {picks[0].code && (
              <img src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${picks[0].code}.png`}
                alt={picks[0].web_name} style={{ height: '100px', objectFit: 'contain' }}
                onError={e => e.target.style.display = 'none'} />
            )}
            <div>
              <div style={{ color: '#00ff87', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '1px' }}>⭐ Recommended Captain</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '4px' }}>{picks[0].web_name}</div>
              <div style={{ color: '#aaa', fontSize: '14px', marginBottom: '12px' }}>{picks[0].team_name} · {picks[0].position}</div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {[
                  ['Form', picks[0].form],
                  ['PPG', picks[0].points_per_game],
                  ['Proj. Captain Pts', picks[0].projected_captain_points],
                  ['Next Fixture', picks[0].fixture],
                ].map(([label, value]) => (
                  <div key={label} style={{ background: '#0e1117', borderRadius: '6px', padding: '8px 14px', textAlign: 'center' }}>
                    <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '2px' }}>{label}</div>
                    <div style={{ color: '#00ff87', fontWeight: 'bold', fontSize: '18px' }}>{value}</div>
                  </div>
                ))}
                <div style={{ background: '#0e1117', borderRadius: '6px', padding: '8px 14px', textAlign: 'center' }}>
                  <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '2px' }}>Fixture Difficulty</div>
                  <div style={{ color: FDR_COLORS[picks[0].fdr] || '#fff', fontWeight: 'bold', fontSize: '18px' }}>
                    {picks[0].fdr} — {FDR_LABELS[picks[0].fdr] || 'Unknown'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <h3 style={{ marginBottom: '12px', fontSize: '15px', color: '#aaa' }}>Full Captain Rankings</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {picks.map((p, i) => (
              <div key={p.id} style={{
                background: '#1a1f2e', borderRadius: '8px', padding: '14px 16px',
                border: `1px solid ${i === 0 ? '#00ff87' : '#2a2f3e'}`,
                display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap'
              }}>
                <div style={{ color: i === 0 ? '#00ff87' : '#aaa', fontWeight: 'bold', fontSize: '18px', minWidth: '28px' }}>#{i + 1}</div>
                {p.code && (
                  <img src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.code}.png`}
                    alt={p.web_name} style={{ height: '50px', objectFit: 'contain' }}
                    onError={e => e.target.style.display = 'none'} />
                )}
                <div style={{ flex: 1, minWidth: '120px' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '15px' }}>{p.web_name}</div>
                  <div style={{ color: '#aaa', fontSize: '12px' }}>{p.team_name} · {p.position}</div>
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {[['Form', p.form], ['PPG', p.points_per_game], ['Cap Pts', p.projected_captain_points], ['Fixture', p.fixture]].map(([label, value]) => (
                    <div key={label} style={{ background: '#0e1117', borderRadius: '6px', padding: '6px 10px', textAlign: 'center', minWidth: '55px' }}>
                      <div style={{ color: '#aaa', fontSize: '10px', marginBottom: '2px' }}>{label}</div>
                      <div style={{ color: '#fff', fontWeight: 'bold', fontSize: '14px' }}>{value}</div>
                    </div>
                  ))}
                  <div style={{ background: '#0e1117', borderRadius: '6px', padding: '6px 10px', textAlign: 'center', minWidth: '80px' }}>
                    <div style={{ color: '#aaa', fontSize: '10px', marginBottom: '2px' }}>FDR</div>
                    <div style={{ color: FDR_COLORS[p.fdr] || '#fff', fontWeight: 'bold', fontSize: '14px' }}>
                      {p.fdr} {FDR_LABELS[p.fdr] ? `· ${FDR_LABELS[p.fdr]}` : ''}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}