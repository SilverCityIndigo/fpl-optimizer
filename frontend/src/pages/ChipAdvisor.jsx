import { useState, useEffect } from 'react'
import { getTeamSquad, getChipAdvice } from '../api'

const CHIP_CONFIG = {
  triple_captain: { label: 'Triple Captain', color: 'var(--gold)',   apiKey: '3xc'      },
  bench_boost:    { label: 'Bench Boost',    color: 'var(--info)',   apiKey: 'bboost'   },
  wildcard:       { label: 'Wildcard',       color: 'var(--accent)', apiKey: 'wildcard' },
  free_hit:       { label: 'Free Hit',       color: '#e0872e',       apiKey: 'freehit'  },
}

export default function ChipAdvisor({ sharedTeamId, setSharedTeamId, sharedSquadData, setSharedSquadData }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [advice, setAdvice] = useState(null)
  const [chipsAvailable, setChipsAvailable] = useState(null)

  useEffect(() => {
    if (sharedSquadData && !advice) loadChipsFromSquad(sharedSquadData)
  }, [])

  async function loadChipsFromSquad(squadData) {
    setLoading(true); setError('')
    try {
      setChipsAvailable(squadData.chips_available || null)
      const res = await getChipAdvice(squadData.player_ids)
      setAdvice(res.data)
    } catch { setError('Failed to get chip advice.') }
    setLoading(false)
  }

  async function fetchAdvice() {
    if (!sharedTeamId) return
    setLoading(true); setError('')
    try {
      const res = await getTeamSquad(sharedTeamId)
      if (res.data.error) { setError(res.data.error); setLoading(false); return }
      setSharedSquadData(res.data)
      await loadChipsFromSquad(res.data)
    } catch { setError('Failed to fetch advice. Check your team ID.') }
    setLoading(false)
  }

  const summary = advice?.squad_summary
  const chips = advice?.chips

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Chip Advisor</h1>
        <p className="page-sub">Import your squad for data-driven advice on when to play each chip.</p>
      </div>

      <div className="import-panel">
        <h3>Enter your FPL Team ID</h3>
        <p>Find it in your team URL: fantasy.premierleague.com/entry/<strong style={{ color: 'var(--accent)' }}>YOUR_ID</strong>/event/…</p>
        <div className="import-row">
          <input className="field" placeholder="e.g. 1234567" value={sharedTeamId} onChange={e => setSharedTeamId(e.target.value)} style={{ width: '170px' }} />
          <button className="btn-3d" onClick={fetchAdvice} disabled={loading}>
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.4" /><circle cx="12" cy="12" r="3.2" /></svg>
            {loading ? 'Analyzing…' : 'Analyze Chips'}
          </button>
        </div>
        {error && <p style={{ color: 'var(--danger)', marginTop: '12px', fontSize: '13px' }}>{error}</p>}
      </div>

      {advice && summary && chips && (
        <>
          <div className="tiles" style={{ marginBottom: '18px' }}>
            {[['Starting 11 Avg', `${summary.avg_starting_pts} pts`], ['Bench Avg', `${summary.avg_bench_pts} pts`], ['Next GW Avg FDR', summary.avg_fdr_next_gw], ['5-GW Avg FDR', summary.avg_fdr_5gw]].map(([k, v]) => (
              <div key={k} className="tile" style={{ flex: 1, minWidth: '130px' }}><div className="k">{k}</div><div className="v" style={{ color: 'var(--accent)' }}>{v}</div></div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
            {Object.entries(chips).map(([key, chip]) => {
              const config = CHIP_CONFIG[key]
              const isAvailable = chipsAvailable ? (chipsAvailable[config.apiKey] ?? true) : true

              if (!isAvailable) {
                return (
                  <div key={key} className="panel panel-pad" style={{ opacity: 0.55 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '8px' }}>
                      <span className="dot" style={{ background: 'var(--text-muted)', width: '9px', height: '9px' }} />
                      <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-secondary)' }}>{config.label}</div>
                    </div>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '6px' }}>Already Played</div>
                    <p className="hint">You've already used this chip this season.</p>
                  </div>
                )
              }

              return (
                <div key={key} className="panel panel-pad" style={{ borderColor: chip.recommended ? config.color : 'var(--line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '12px' }}>
                    <span className="dot" style={{ background: config.color, width: '9px', height: '9px' }} />
                    <div style={{ fontWeight: 700, fontSize: '15px', color: chip.recommended ? config.color : 'var(--text)' }}>{config.label}</div>
                    <span style={{ marginLeft: 'auto', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: chip.recommended ? 'var(--accent)' : 'var(--text-muted)' }}>
                      {chip.recommended ? 'Recommended' : 'Not now'}
                    </span>
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.55, marginBottom: '12px' }}>{chip.reason}</p>
                  {key === 'triple_captain' && chip.top_captain && (
                    <div className="tile" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', minWidth: 0 }}>
                      <span className="hint">Top Captain</span><span style={{ color: config.color, fontWeight: 700, fontSize: '12.5px' }}>{chip.top_captain} — {chip.projected_points} pts</span>
                    </div>
                  )}
                  {key === 'bench_boost' && (
                    <div className="tile" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', minWidth: 0 }}>
                      <span className="hint">Bench Avg</span><span style={{ color: config.color, fontWeight: 700, fontSize: '12.5px' }}>{chip.avg_bench_pts} pts / player</span>
                    </div>
                  )}
                  {key === 'wildcard' && (
                    <div className="tile" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', minWidth: 0 }}>
                      <span className="hint">Starting 11 Avg</span><span style={{ color: config.color, fontWeight: 700, fontSize: '12.5px' }}>{chip.avg_starting_pts} pts / player</span>
                    </div>
                  )}
                  {key === 'free_hit' && (
                    <div className="tile" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', minWidth: 0 }}>
                      <span className="hint">Next GW Avg FDR</span><span style={{ color: config.color, fontWeight: 700, fontSize: '12.5px' }}>{chip.avg_fdr_next_gw}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
