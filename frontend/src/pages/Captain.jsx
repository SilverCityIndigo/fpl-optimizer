import { useState, useEffect } from 'react'
import { getTeamSquad, getCaptainPick } from '../api'
import { PHOTO } from '../playerPhoto'

const FDR_COLORS = { 1: 'var(--accent)', 2: 'var(--info)', 3: 'var(--gold)', 4: '#e0872e', 5: 'var(--danger)' }
const FDR_LABELS = { 1: 'Very Easy', 2: 'Easy', 3: 'Medium', 4: 'Hard', 5: 'Very Hard' }

export default function Captain({ sharedTeamId, setSharedTeamId, sharedSquadData, setSharedSquadData }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [picks, setPicks] = useState([])
  const [step, setStep] = useState(1)

  useEffect(() => {
    if (sharedSquadData && picks.length === 0) loadCaptainFromSquad(sharedSquadData)
  }, [])

  async function loadCaptainFromSquad(squadData) {
    setLoading(true); setError('')
    try {
      const res = await getCaptainPick(squadData.player_ids)
      setPicks(res.data); setStep(3)
    } catch { setError('Failed to get captain picks.') }
    setLoading(false)
  }

  async function fetchSquad() {
    if (!sharedTeamId) return
    setLoading(true); setError('')
    try {
      const res = await getTeamSquad(sharedTeamId)
      if (res.data.error) { setError(res.data.error); setLoading(false); return }
      setSharedSquadData(res.data)
      await loadCaptainFromSquad(res.data)
    } catch { setError('Failed to fetch team. Make sure your team ID is correct.') }
    setLoading(false)
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Captain Picker</h1>
        <p className="page-sub">Import your squad for fixture-adjusted captain recommendations for the next gameweek.</p>
      </div>

      <div className="import-panel">
        <h3>Enter your FPL Team ID</h3>
        <p>Find it in your team URL: fantasy.premierleague.com/entry/<strong style={{ color: 'var(--accent)' }}>YOUR_ID</strong>/event/…</p>
        <div className="import-row">
          <input className="field" placeholder="e.g. 1234567" value={sharedTeamId} onChange={e => setSharedTeamId(e.target.value)} style={{ width: '170px' }} />
          <button className="btn-3d" onClick={fetchSquad} disabled={loading}>
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4.5 13H11l-1 9 8.5-11H12z" /></svg>
            {loading ? 'Analyzing…' : 'Get Captain Picks'}
          </button>
        </div>
        {error && <p style={{ color: 'var(--danger)', marginTop: '12px', fontSize: '13px' }}>{error}</p>}
      </div>

      {step === 3 && picks.length > 0 && (
        <div>
          <div className="panel" style={{
            padding: '22px', marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap',
            background: 'radial-gradient(140% 130% at 88% -30%, var(--accent-soft), transparent 55%), var(--surface)',
            borderColor: 'color-mix(in srgb, var(--accent) 45%, var(--line))'
          }}>
            {picks[0].code && <img src={PHOTO(picks[0].code)} alt={picks[0].web_name} style={{ height: '92px', objectFit: 'contain' }} onError={e => { e.target.style.display = 'none' }} />}
            <div style={{ flex: 1, minWidth: '200px' }}>
              <div style={{ color: 'var(--accent)', fontSize: '11px', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.14em' }}>Recommended Captain</div>
              <div style={{ fontSize: '26px', fontWeight: 800 }}>{picks[0].web_name}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '14px' }}>{picks[0].team_name} · {picks[0].position}</div>
              <div className="tiles">
                {[['Form', picks[0].form], ['PPG', picks[0].points_per_game], ['Proj. Cap Pts', picks[0].projected_captain_points], ['Next', picks[0].fixture]].map(([k, v]) => (
                  <div key={k} className="tile"><div className="k">{k}</div><div className="v" style={{ color: 'var(--accent)' }}>{v}</div></div>
                ))}
                <div className="tile"><div className="k">Difficulty</div><div className="v" style={{ color: FDR_COLORS[picks[0].fdr] || 'var(--text)' }}>{picks[0].fdr} · {FDR_LABELS[picks[0].fdr] || '—'}</div></div>
              </div>
            </div>
          </div>

          <div className="section-title" style={{ color: 'var(--text-secondary)', marginBottom: '12px' }}>Full Captain Rankings</div>
          <div className="list">
            {picks.map((p, i) => (
              <div key={p.id} className={`list-row${i === 0 ? ' lead' : ''}`}>
                <div className={`rank${i === 0 ? ' lead' : ''}`}>#{i + 1}</div>
                {p.code && <img src={PHOTO(p.code)} alt={p.web_name} style={{ height: '46px', objectFit: 'contain' }} onError={e => { e.target.style.display = 'none' }} />}
                <div style={{ flex: 1, minWidth: '120px' }}>
                  <div style={{ fontWeight: 700, fontSize: '15px' }}>{p.web_name}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{p.team_name} · {p.position}</div>
                </div>
                <div className="tiles">
                  {[['Form', p.form], ['PPG', p.points_per_game], ['Cap Pts', p.projected_captain_points], ['Next', p.fixture]].map(([k, v]) => (
                    <div key={k} className="tile"><div className="k">{k}</div><div className="v">{v}</div></div>
                  ))}
                  <div className="tile"><div className="k">FDR</div><div className="v" style={{ color: FDR_COLORS[p.fdr] || 'var(--text)' }}>{p.fdr}</div></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
