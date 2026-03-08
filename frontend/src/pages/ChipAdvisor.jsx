import { useState } from 'react'
import { getTeamSquad, getChipAdvice } from '../api'

const CHIP_CONFIG = {
  triple_captain: { emoji: '⚡', label: 'Triple Captain', color: '#ffd700' },
  bench_boost: { emoji: '🚀', label: 'Bench Boost', color: '#00b2ff' },
  wildcard: { emoji: '🃏', label: 'Wildcard', color: '#00ff87' },
  free_hit: { emoji: '🎯', label: 'Free Hit', color: '#ff8800' }
}

export default function ChipAdvisor() {
  const [teamId, setTeamId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [advice, setAdvice] = useState(null)

  async function fetchAdvice() {
    if (!teamId) return
    setLoading(true)
    setError('')
    try {
      const squadRes = await getTeamSquad(teamId)
      if (squadRes.data.error) { setError(squadRes.data.error); setLoading(false); return }
      const chipRes = await getChipAdvice(squadRes.data.player_ids)
      setAdvice(chipRes.data)
    } catch {
      setError('Failed to fetch advice. Check your team ID.')
    }
    setLoading(false)
  }

  const summary = advice?.squad_summary
  const chips = advice?.chips

  return (
    <div>
      <h2 style={{ marginBottom: '8px', color: '#00ff87' }}>🃏 Chip Advisor</h2>
      <p style={{ color: '#aaa', marginBottom: '24px', fontSize: '14px' }}>
        Import your squad and get data-driven advice on when to play your chips.
      </p>

      {/* Team ID input */}
      <div style={{ background: '#1a1f2e', borderRadius: '8px', padding: '20px', marginBottom: '20px' }}>
        <h3 style={{ marginBottom: '12px', fontSize: '15px' }}>Enter your FPL Team ID</h3>
        <p style={{ color: '#aaa', fontSize: '13px', marginBottom: '12px' }}>
          Find it at: fantasy.premierleague.com/entry/<strong style={{ color: '#00ff87' }}>YOUR_ID</strong>/event/...
        </p>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <input
            placeholder="e.g. 1234567"
            value={teamId}
            onChange={e => setTeamId(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #2a2f3e', background: '#0e1117', color: '#fff', width: '160px' }}
          />
          <button onClick={fetchAdvice} disabled={loading}
            style={{ padding: '8px 20px', borderRadius: '6px', background: '#00ff87', color: '#000', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
            {loading ? 'Analyzing...' : '🃏 Analyze Chips'}
          </button>
        </div>
        {error && <p style={{ color: '#ff4444', marginTop: '12px', fontSize: '13px' }}>{error}</p>}
      </div>

      {advice && summary && chips && (
        <>
          {/* Squad summary bar */}
          <div style={{ background: '#1a1f2e', borderRadius: '8px', padding: '16px 20px', marginBottom: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {[
              ['Starting 11 Avg', `${summary.avg_starting_pts} pts`],
              ['Bench Avg', `${summary.avg_bench_pts} pts`],
              ['Next GW Avg FDR', summary.avg_fdr_next_gw],
              ['5-GW Avg FDR', summary.avg_fdr_5gw],
            ].map(([label, value]) => (
              <div key={label} style={{ background: '#0e1117', borderRadius: '6px', padding: '10px 16px', textAlign: 'center', flex: '1', minWidth: '120px' }}>
                <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '4px' }}>{label}</div>
                <div style={{ color: '#00ff87', fontWeight: 'bold', fontSize: '18px' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Chip cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
            {Object.entries(chips).map(([key, chip]) => {
              const config = CHIP_CONFIG[key]
              return (
                <div key={key} style={{
                  background: '#1a1f2e',
                  borderRadius: '12px',
                  padding: '20px',
                  border: `1px solid ${chip.recommended ? config.color : '#2a2f3e'}`,
                  boxShadow: chip.recommended ? `0 0 16px ${config.color}22` : 'none'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                    <span style={{ fontSize: '24px' }}>{config.emoji}</span>
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '16px', color: chip.recommended ? config.color : '#fff' }}>
                        {config.label}
                      </div>
                      <div style={{
                        fontSize: '11px',
                        fontWeight: 'bold',
                        color: chip.recommended ? '#00ff87' : '#ff4444',
                        textTransform: 'uppercase',
                        letterSpacing: '1px'
                      }}>
                        {chip.recommended ? '✅ Recommended' : '❌ Not Recommended'}
                      </div>
                    </div>
                  </div>

                  <p style={{ color: '#ccc', fontSize: '13px', lineHeight: '1.6', marginBottom: '12px' }}>
                    {chip.reason}
                  </p>

                  {/* Extra stat per chip */}
                  {key === 'triple_captain' && chip.top_captain && (
                    <div style={{ background: '#0e1117', borderRadius: '6px', padding: '10px', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#aaa', fontSize: '12px' }}>Top Captain</span>
                      <span style={{ color: config.color, fontWeight: 'bold', fontSize: '12px' }}>{chip.top_captain} — {chip.projected_points} proj. pts</span>
                    </div>
                  )}
                  {key === 'bench_boost' && (
                    <div style={{ background: '#0e1117', borderRadius: '6px', padding: '10px', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#aaa', fontSize: '12px' }}>Bench Avg</span>
                      <span style={{ color: config.color, fontWeight: 'bold', fontSize: '12px' }}>{chip.avg_bench_pts} pts per player</span>
                    </div>
                  )}
                  {key === 'wildcard' && (
                    <div style={{ background: '#0e1117', borderRadius: '6px', padding: '10px', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#aaa', fontSize: '12px' }}>Starting 11 Avg</span>
                      <span style={{ color: config.color, fontWeight: 'bold', fontSize: '12px' }}>{chip.avg_starting_pts} pts per player</span>
                    </div>
                  )}
                  {key === 'free_hit' && (
                    <div style={{ background: '#0e1117', borderRadius: '6px', padding: '10px', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#aaa', fontSize: '12px' }}>Next GW Avg FDR</span>
                      <span style={{ color: config.color, fontWeight: 'bold', fontSize: '12px' }}>{chip.avg_fdr_next_gw}</span>
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