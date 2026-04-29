import { useState, useEffect, useRef } from 'react'
import {
  Chart as ChartJS,
  LinearScale, PointElement, LineElement, Tooltip as ChartTooltip,
  Legend, CategoryScale, Filler, BarElement
} from 'chart.js'
import { Scatter, Line, Bar } from 'react-chartjs-2'
import { getPlayers, getPlayerHistory } from '../api'

ChartJS.register(LinearScale, PointElement, LineElement, ChartTooltip, Legend, CategoryScale, Filler, BarElement)

const POSITIONS = ['All', 'GKP', 'DEF', 'MID', 'FWD']
const POS_COLORS = { GKP: '#f5a623', DEF: '#00b2ff', MID: '#00ff87', FWD: '#ff4444' }

function ptColor(pts) {
  if (pts >= 6) return '#00ff87'
  if (pts >= 4) return '#ffd700'
  return 'var(--text)'
}

const TH = ({ children }) => (
  <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--text)', fontWeight: 'bold', fontSize: '12px', borderBottom: '1px solid var(--border)' }}>
    {children}
  </th>
)

const TD = ({ children, color = 'var(--text-secondary)', bold = false }) => (
  <td style={{ padding: '7px 10px', color, fontWeight: bold ? 'bold' : 'normal' }}>{children}</td>
)

// ─── Shared Player Search ────────────────────────────────────────────────────
function PlayerSearch({ players, onSelect, placeholder = 'Search player...', excludeId = null }) {
  const [search, setSearch] = useState('')
  const filtered = players
    .filter(p => p.web_name.toLowerCase().includes(search.toLowerCase()))
    .filter(p => p.id !== excludeId)
    .slice(0, 30)

  return (
    <div style={{ position: 'relative', maxWidth: '320px' }}>
      <input
        placeholder={placeholder}
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          width: '100%', padding: '10px 14px', borderRadius: '8px',
          border: '1px solid var(--border)', background: 'var(--bg)',
          color: 'var(--text)', fontSize: '14px', outline: 'none', boxSizing: 'border-box'
        }}
      />
      {search && filtered.length > 0 && (
        <div style={{
          position: 'absolute', zIndex: 200, background: 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: '8px', marginTop: '4px',
          maxHeight: '240px', overflowY: 'auto', width: '100%'
        }}>
          {filtered.map(p => (
            <div key={p.id}
              onClick={() => { onSelect(p); setSearch('') }}
              style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--bg)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              {p.code && (
                <img src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.code}.png`}
                  style={{ height: '32px', objectFit: 'contain' }}
                  onError={e => e.target.style.display = 'none'} />
              )}
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '14px', color: 'var(--text)' }}>{p.web_name}</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>{p.team_name} · {p.position} · £{p.price}m</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Position-aware GW Breakdown Table ──────────────────────────────────────
function GWTable({ history, position }) {
  if (!history.length) return null

  const isGKP = position === 'GKP'
  const isDEF = position === 'DEF'
  const isMID = position === 'MID'
  const isFWD = position === 'FWD'
  const hasAttack = !isGKP

  // Defcon thresholds: DEF=10, MID/FWD=12
  const defconThreshold = isDEF ? 10 : 12

  return (
    <div>
      <div style={{ color: 'var(--text)', fontSize: '13px', fontWeight: 'bold', marginBottom: '10px' }}>Gameweek Breakdown</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr>
              <TH>GW</TH>
              <TH>Mins</TH>
              <TH>Pts</TH>
              {isGKP && <><TH>Saves</TH><TH>xGC</TH><TH>CS</TH></>}
              {hasAttack && <><TH>Goals</TH><TH>Assists</TH></>}
              {(isDEF || isMID) && <TH>CS</TH>}
              {hasAttack && <><TH>xG</TH><TH>xA</TH></>}
              {(isDEF || isMID) && <TH>Defcon</TH>}
              {isDEF && <TH>CBI</TH>}
              {isMID && <TH>Recoveries</TH>}
              <TH>Bonus</TH>
              <TH>BPS</TH>
              <TH>ICT</TH>
            </tr>
          </thead>
          <tbody>
            {[...history].reverse().slice(0, 10).map(h => {
              const xg = parseFloat(h.expected_goals || 0)
              const xa = parseFloat(h.expected_assists || 0)
              const xgc = parseFloat(h.expected_goals_conceded || 0)
              const defcon = parseInt(h.defensive_contribution || 0)
              const cbi = parseInt(h.clearances_blocks_interceptions || 0)
              const recoveries = parseInt(h.recoveries || 0)
              const saves = parseInt(h.saves || 0)
              const hitDefcon = defcon >= defconThreshold

              return (
                <tr key={h.gameweek} style={{ borderBottom: '1px solid var(--bg-card)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <TD color="#aaa">GW{h.gameweek}</TD>
                  <TD color={h.minutes === 0 ? '#ff4444' : 'var(--text)'}>{h.minutes}'</TD>
                  <TD color={ptColor(h.total_points)} bold>{h.total_points}</TD>

                  {isGKP && <>
                    <TD color={saves > 0 ? '#00b2ff' : 'var(--text-muted)'}>{saves || '—'}</TD>
                    <TD color={xgc > 1 ? '#ff4444' : 'var(--text-secondary)'}>{xgc > 0 ? xgc.toFixed(2) : '—'}</TD>
                    <TD color={h.clean_sheets > 0 ? '#00ff87' : 'var(--text-muted)'}>{h.clean_sheets > 0 ? '✓' : '—'}</TD>
                  </>}

                  {hasAttack && <>
                    <TD color={h.goals_scored > 0 ? '#ffd700' : 'var(--text-muted)'}>{h.goals_scored || '—'}</TD>
                    <TD color={h.assists > 0 ? '#7fff00' : 'var(--text-muted)'}>{h.assists || '—'}</TD>
                  </>}

                  {(isDEF || isMID) && (
                    <TD color={h.clean_sheets > 0 ? '#00ff87' : 'var(--text-muted)'}>{h.clean_sheets > 0 ? '✓' : '—'}</TD>
                  )}

                  {hasAttack && <>
                    <TD color={xg > 0.3 ? '#00b2ff' : 'var(--text-secondary)'}>{xg > 0 ? xg.toFixed(2) : '—'}</TD>
                    <TD color={xa > 0.2 ? '#00b2ff' : 'var(--text-secondary)'}>{xa > 0 ? xa.toFixed(2) : '—'}</TD>
                  </>}

                  {(isDEF || isMID) && (
                    <TD color={hitDefcon ? '#00ff87' : defcon > 0 ? 'var(--text-secondary)' : 'var(--text-muted)'}>
                      {defcon > 0 ? `${defcon}${hitDefcon ? ' ✓' : ''}` : '—'}
                    </TD>
                  )}

                  {isDEF && <TD color={cbi > 3 ? '#00b2ff' : 'var(--text-secondary)'}>{cbi || '—'}</TD>}
                  {isMID && <TD color={recoveries > 5 ? '#00b2ff' : 'var(--text-secondary)'}>{recoveries || '—'}</TD>}

                  <TD color={h.bonus > 0 ? '#00ff87' : 'var(--text-muted)'}>{h.bonus || '—'}</TD>
                  <TD>{h.bps ?? '—'}</TD>
                  <TD>{h.ict_index != null ? parseFloat(h.ict_index).toFixed(1) : '—'}</TD>
                </tr>
              )
            })}
          </tbody>
        </table>
        {history.length > 10 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '6px', textAlign: 'right' }}>Showing last 10 GWs</div>
        )}
      </div>
    </div>
  )
}

// ─── Positional Comparison Bar ───────────────────────────────────────────────
function PositionalComparison({ selected, players }) {
  if (!selected) return null

  const peers = players.filter(p =>
    p.position === selected.position &&
    p.minutes > 180 &&
    p.xg_per90 != null
  )

  if (peers.length === 0) return null

  const avg = (field) => peers.reduce((s, p) => s + parseFloat(p[field] || 0), 0) / peers.length

  const avgXG = avg('xg_per90')
  const avgXA = avg('xa_per90')
  const avgXGI = avg('xgi_per90')

  const playerXG = parseFloat(selected.xg_per90 || 0)
  const playerXA = parseFloat(selected.xa_per90 || 0)
  const playerXGI = parseFloat(selected.xgi_per90 || 0)

  const metrics = [
    { label: 'xG/90', player: playerXG, avg: avgXG, color: '#00b2ff' },
    { label: 'xA/90', player: playerXA, avg: avgXA, color: '#7fff00' },
    { label: 'xGI/90', player: playerXGI, avg: avgXGI, color: '#00ff87' },
  ]

  const maxVal = Math.max(...metrics.map(m => Math.max(m.player, m.avg))) * 1.2 || 0.1

  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ color: 'var(--text)', fontSize: '13px', fontWeight: 'bold', marginBottom: '12px' }}>
        vs {selected.position} Average ({peers.length} players with 180+ mins)
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {metrics.map(m => {
          const playerPct = (m.player / maxVal) * 100
          const avgPct = (m.avg / maxVal) * 100
          const isAbove = m.player >= m.avg

          return (
            <div key={m.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{m.label}</span>
                <span style={{ fontSize: '12px' }}>
                  <span style={{ color: m.color, fontWeight: 'bold' }}>{m.player.toFixed(3)}</span>
                  <span style={{ color: 'var(--text-muted)' }}> vs avg </span>
                  <span style={{ color: 'var(--text-secondary)' }}>{m.avg.toFixed(3)}</span>
                  <span style={{ color: isAbove ? '#00ff87' : '#ff4444', marginLeft: '6px', fontWeight: 'bold' }}>
                    {isAbove ? '▲' : '▼'} {Math.abs(m.player - m.avg).toFixed(3)}
                  </span>
                </span>
              </div>
              <div style={{ position: 'relative', height: '20px', background: 'var(--bg)', borderRadius: '4px', overflow: 'hidden' }}>
                {/* Avg marker */}
                <div style={{
                  position: 'absolute', left: `${avgPct}%`, top: 0, bottom: 0,
                  width: '2px', background: 'var(--text-muted)', zIndex: 2
                }} />
                {/* Player bar */}
                <div style={{
                  position: 'absolute', left: 0, top: '3px', bottom: '3px',
                  width: `${playerPct}%`,
                  background: m.color,
                  borderRadius: '3px',
                  opacity: 0.85,
                  transition: 'width 0.3s ease'
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>│ avg</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── xG vs Goals Panel ──────────────────────────────────────────────────────
function XGPanel({ players, selectedPlayer, onSelectPlayer }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [compare, setCompare] = useState(null)
  const [compareHistory, setCompareHistory] = useState([])
  const [position, setPosition] = useState('All')
  const chartRef = useRef(null)

  const selected = selectedPlayer

  useEffect(() => {
    if (!selected) return
    setLoading(true)
    getPlayerHistory(selected.id)
      .then(res => setHistory(res.data))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false))
  }, [selected?.id])

  async function selectCompare(player) {
    setCompare(player)
    try {
      const res = await getPlayerHistory(player.id)
      setCompareHistory(res.data)
    } catch { setCompareHistory([]) }
  }

  const filtered = players
    .filter(p => position === 'All' || p.position === position)
    .filter(p => p.xg_per90 != null && p.goals_scored != null && p.minutes > 180)
    .map(p => ({
      ...p,
      xg_p90: parseFloat(p.xg_per90 || 0),
      goals_p90: parseFloat(((p.goals_scored / p.minutes) * 90).toFixed(3)),
    }))

  const maxVal = Math.max(...filtered.map(p => Math.max(p.xg_p90, p.goals_p90)), 0.5) + 0.2

  const bgDots = filtered.filter(p => p.id !== selected?.id && p.id !== compare?.id)
  const selectedDot = filtered.find(p => p.id === selected?.id)
  const compareDot = filtered.find(p => p.id === compare?.id)

  const dotColor = (dot) => {
    if (!dot) return 'var(--text)'
    const diff = dot.goals_p90 - dot.xg_p90
    if (diff >= 0.08) return '#00ff87'
    if (diff <= -0.08) return '#ff8800'
    return '#ffffff'
  }

  const scatterData = {
    datasets: [
      {
        label: 'Players',
        data: bgDots.map(p => ({ x: p.xg_p90, y: p.goals_p90, player: p })),
        backgroundColor: 'rgba(255,255,255,0.12)',
        pointRadius: 4,
        pointHoverRadius: 6,
      },
      ...(selectedDot ? [{
        label: selected.web_name,
        data: [{ x: selectedDot.xg_p90, y: selectedDot.goals_p90, player: selectedDot }],
        backgroundColor: dotColor(selectedDot),
        pointRadius: 10,
        pointHoverRadius: 13,
      }] : []),
      ...(compareDot ? [{
        label: compare.web_name,
        data: [{ x: compareDot.xg_p90, y: compareDot.goals_p90, player: compareDot }],
        backgroundColor: dotColor(compareDot),
        pointRadius: 10,
        pointHoverRadius: 13,
      }] : []),
      {
        label: 'xG = Goals',
        data: [{ x: 0, y: 0 }, { x: maxVal, y: maxVal }],
        type: 'line',
        borderColor: '#3a4050',
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
      }
    ]
  }

  const scatterOptions = {
    responsive: true, maintainAspectRatio: false, animation: false,
    onClick: (event, elements) => {
      if (!elements.length) return
      const el = elements[0]
      const point = scatterData.datasets[el.datasetIndex].data[el.index]
      if (point?.player) onSelectPlayer(point.player)
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const p = ctx.raw?.player
            if (!p) return ''
            const diff = (p.goals_p90 - p.xg_p90).toFixed(3)
            const sign = parseFloat(diff) >= 0 ? '+' : ''
            return [
              `${p.web_name} (${p.team_name})`,
              `Goals/90: ${p.goals_p90.toFixed(3)}   xG/90: ${p.xg_p90.toFixed(3)}`,
              `Diff: ${sign}${diff}`,
            ]
          }
        },
        backgroundColor: 'var(--bg)', borderColor: 'var(--border)', borderWidth: 1,
        titleColor: 'var(--text)', bodyColor: 'var(--text-secondary)', padding: 12,
      }
    },
    scales: {
      x: {
        title: { display: true, text: 'Expected Goals per 90 (xG/90)', color: 'var(--text-secondary)', font: { size: 13 } },
        ticks: { color: 'var(--text-secondary)' }, grid: { color: 'var(--grid)' }, min: 0, max: maxVal,
      },
      y: {
        title: { display: true, text: 'Actual Goals per 90', color: 'var(--text-secondary)', font: { size: 13 } },
        ticks: { color: 'var(--text-secondary)' }, grid: { color: 'var(--grid)' }, min: 0, max: maxVal,
      }
    }
  }

  const seasonXG = history.reduce((s, h) => s + parseFloat(h.expected_goals || 0), 0)
  const seasonXA = history.reduce((s, h) => s + parseFloat(h.expected_assists || 0), 0)
  const actualGoals = history.reduce((s, h) => s + (h.goals_scored || 0), 0)
  const xgDiff = (actualGoals - seasonXG).toFixed(2)
  const per90Diff = selectedDot ? (selectedDot.goals_p90 - selectedDot.xg_p90) : 0

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        <PlayerSearch players={players} onSelect={onSelectPlayer} placeholder="Search player to highlight..." />
        <div style={{ display: 'flex', gap: '6px' }}>
          {POSITIONS.map(pos => (
            <button key={pos} onClick={() => setPosition(pos)} style={{
              padding: '5px 12px', borderRadius: '6px',
              border: `1px solid ${pos === 'All' ? '#00ff87' : POS_COLORS[pos] || '#00ff87'}`,
              background: position === pos ? (POS_COLORS[pos] || '#00ff87') : 'transparent',
              color: position === pos ? '#000' : 'var(--text)',
              cursor: 'pointer', fontWeight: position === pos ? 'bold' : 'normal', fontSize: '12px'
            }}>{pos}</button>
          ))}
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{filtered.length} players (180+ mins) · click any dot</span>
      </div>

      <div style={{ height: '420px', marginBottom: '12px' }}>
        <Scatter ref={chartRef} data={scatterData} options={scatterOptions} />
      </div>

      <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginBottom: '24px' }}>
        <span style={{ fontSize: '12px', color: '#00ff87' }}>● Green = overperforming xG</span>
        <span style={{ fontSize: '12px', color: 'var(--text)' }}>● White = in line with xG</span>
        <span style={{ fontSize: '12px', color: '#ff8800' }}>● Orange = due a return</span>
      </div>

      {selected && (
        <div style={{ background: 'var(--bg)', borderRadius: '12px', padding: '20px', border: `1px solid ${POS_COLORS[selected.position] || '#00ff87'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
            {selected.code && (
              <img src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${selected.code}.png`}
                style={{ height: '60px', objectFit: 'contain' }}
                onError={e => e.target.style.display = 'none'} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 'bold', fontSize: '18px' }}>{selected.web_name}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{selected.team_name} · {selected.position} · £{selected.price}m</div>
            </div>
            {history.length > 0 && (
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {[
                  ['Goals', actualGoals, '#ffd700'],
                  ['xG (season)', seasonXG.toFixed(2), '#00b2ff'],
                  ['xG Diff', `${parseFloat(xgDiff) >= 0 ? '+' : ''}${xgDiff}`, parseFloat(xgDiff) >= 0 ? '#00ff87' : '#ff4444'],
                  ['xA (season)', seasonXA.toFixed(2), '#00b2ff'],
                  ['xG/90', parseFloat(selected.xg_per90 || 0).toFixed(3), 'var(--text-secondary)'],
                  ['xA/90', parseFloat(selected.xa_per90 || 0).toFixed(3), 'var(--text-secondary)'],
                ].map(([label, val, color]) => (
                  <div key={label} style={{ background: 'var(--bg-card)', borderRadius: '8px', padding: '8px 14px', textAlign: 'center' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '10px', marginBottom: '2px' }}>{label}</div>
                    <div style={{ color, fontWeight: 'bold', fontSize: '15px' }}>{val}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {history.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              {per90Diff >= 0.08 ? (
                <span style={{ background: 'rgba(0,255,135,0.1)', border: '1px solid #00ff87', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', color: '#00ff87' }}>
                  🔥 Overperforming xG by {per90Diff.toFixed(3)} goals/90 — form may regress
                </span>
              ) : per90Diff <= -0.08 ? (
                <span style={{ background: 'rgba(255,136,0,0.1)', border: '1px solid #ff8800', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', color: '#ff8800' }}>
                  ⏳ Underperforming xG by {Math.abs(per90Diff).toFixed(3)} goals/90 — return incoming
                </span>
              ) : (
                <span style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  ✅ Performing in line with xG
                </span>
              )}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Compare with:</span>
            <PlayerSearch players={players} onSelect={selectCompare} placeholder="Search player..." excludeId={selected.id} />
            {compare && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '12px', height: '3px', background: '#ff8800', borderRadius: '2px' }} />
                <span style={{ color: 'var(--text)', fontSize: '13px', fontWeight: 'bold' }}>{compare.web_name}</span>
                <button onClick={() => { setCompare(null); setCompareHistory([]) }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>×</button>
              </div>
            )}
          </div>

          {/* Positional comparison bar replaces the redundant table */}
          <PositionalComparison selected={selected} players={players} />
        </div>
      )}
    </div>
  )
}

// ─── Form Timeline Panel ─────────────────────────────────────────────────────
function FormTimeline({ players, selectedPlayer, onSelectPlayer }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [compare, setCompare] = useState(null)
  const [compareHistory, setCompareHistory] = useState([])

  const selected = selectedPlayer

  useEffect(() => {
    if (!selected) return
    setLoading(true)
    getPlayerHistory(selected.id)
      .then(res => setHistory(res.data))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false))
  }, [selected?.id])

  async function selectCompare(player) {
    setCompare(player)
    try {
      const res = await getPlayerHistory(player.id)
      setCompareHistory(res.data)
    } catch { setCompareHistory([]) }
  }

  // Only count gameweeks the player actually appeared in (minutes > 0). This
  // matches FPL's own Pts/Match — blanks, injuries, and full benchings would
  // otherwise drag the average down and misrepresent the player.
  const playedGWs = history.filter(h => (h.minutes || 0) > 0)
  const avgPts = playedGWs.length
    ? (playedGWs.reduce((s, h) => s + h.total_points, 0) / playedGWs.length).toFixed(1)
    : null
  const bestGW = history.length
    ? history.reduce((best, h) => h.total_points > best.total_points ? h : best, history[0])
    : null

  const lineData = {
    labels: history.map(h => `GW${h.gameweek}`),
    datasets: [
      {
        label: selected?.web_name || 'Player',
        data: history.map(h => h.total_points),
        borderColor: '#00ff87',
        backgroundColor: 'rgba(0,255,135,0.12)',
        borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 6,
        fill: true, tension: 0.3,
      },
      ...(compare && compareHistory.length > 0 ? [{
        label: compare.web_name,
        data: history.map(h => {
          const match = compareHistory.find(c => c.gameweek === h.gameweek)
          return match ? match.total_points : null
        }),
        borderColor: '#ff8800',
        backgroundColor: 'rgba(255,136,0,0.08)',
        borderWidth: 2, borderDash: [5, 3],
        pointRadius: 3, pointHoverRadius: 5,
        fill: true, tension: 0.3, spanGaps: false,
      }] : [])
    ]
  }

  const lineOptions = {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: {
      legend: { display: !!compare, labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 12 } } },
      tooltip: {
        backgroundColor: 'var(--bg)', borderColor: 'var(--border)', borderWidth: 1,
        titleColor: 'var(--text-secondary)', bodyColor: 'var(--text)',
        callbacks: {
          afterBody: (items) => {
            const h = history[items[0].dataIndex]
            if (!h) return []
            const lines = []
            if (h.minutes !== undefined) lines.push(`Minutes: ${h.minutes}'`)
            if (h.goals_scored > 0) lines.push(`Goals: ${h.goals_scored} ⚽`)
            if (h.assists > 0) lines.push(`Assists: ${h.assists} 🅰️`)
            if (h.bonus > 0) lines.push(`Bonus: ${h.bonus}`)
            return lines
          }
        }
      }
    },
    scales: {
      x: {
        ticks: { color: 'var(--text-secondary)', font: { size: 11 } }, grid: { color: 'var(--grid)' },
        title: { display: true, text: 'Gameweek', color: 'var(--text-muted)', font: { size: 12 } }
      },
      y: { ticks: { color: 'var(--text-secondary)', font: { size: 11 } }, grid: { color: 'var(--grid)' } }
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <PlayerSearch players={players} onSelect={onSelectPlayer} placeholder="Search player..." />
      </div>

      {!selected && (
        <div style={{ background: 'var(--bg)', borderRadius: '12px', padding: '48px', textAlign: 'center', border: '1px dashed var(--border)' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📈</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Search for a player above to load their GW-by-GW points timeline</div>
        </div>
      )}

      {selected && (
        <div style={{ background: 'var(--bg)', borderRadius: '12px', padding: '20px', border: `1px solid ${POS_COLORS[selected.position] || '#00ff87'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
            {selected.code && (
              <img src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${selected.code}.png`}
                style={{ height: '65px', objectFit: 'contain' }}
                onError={e => e.target.style.display = 'none'} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 'bold', fontSize: '20px' }}>{selected.web_name}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{selected.team_name} · {selected.position} · £{selected.price}m</div>
            </div>
            {avgPts && (
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {[
                  ['Season Pts', selected.total_points, 'var(--text)'],
                  ['Avg / GW', avgPts, '#00ff87'],
                  ['Best GW', `GW${bestGW?.gameweek} (${bestGW?.total_points}pts)`, '#ffd700'],
                  ['Form', selected.form, '#00b2ff'],
                  ['xG/90', parseFloat(selected.xg_per90 || 0).toFixed(3), '#00b2ff'],
                  ['xA/90', parseFloat(selected.xa_per90 || 0).toFixed(3), '#00b2ff'],
                ].map(([label, val, color]) => (
                  <div key={label} style={{ background: 'var(--bg-card)', borderRadius: '8px', padding: '8px 14px', textAlign: 'center' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '10px', marginBottom: '2px' }}>{label}</div>
                    <div style={{ color, fontWeight: 'bold', fontSize: '15px' }}>{val}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Compare with:</span>
            <PlayerSearch players={players} onSelect={selectCompare} placeholder="Search player to compare..." excludeId={selected.id} />
            {compare && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '12px', height: '3px', background: '#ff8800', borderRadius: '2px' }} />
                <span style={{ color: 'var(--text)', fontSize: '13px', fontWeight: 'bold' }}>{compare.web_name}</span>
                <button onClick={() => { setCompare(null); setCompareHistory([]) }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>×</button>
              </div>
            )}
          </div>

          {loading ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Loading timeline...</p>
          ) : (
            <div style={{ height: '280px', marginBottom: '24px' }}>
              <Line data={lineData} options={lineOptions} />
            </div>
          )}

          <GWTable history={history} position={selected.position} />
        </div>
      )}
    </div>
  )
}

// ─── Price vs Output Map ─────────────────────────────────────────────────────
function ValueMap({ players, selectedPlayer, onSelectPlayer }) {
  const [position, setPosition] = useState('All')
  const [focusIds, setFocusIds] = useState([])
  const [viewMode, setViewMode] = useState('all') // all | focus | empty
  const pool = players
    .filter(p => position === 'All' || p.position === position)
    .filter(p => (p.minutes || 0) >= 180)
    .map(p => ({
      ...p,
      priceNum: parseFloat(p.price || 0),
      ppgNum: parseFloat(p.points_per_game || 0),
      valueNum: parseFloat(p.total_points || 0) / Math.max(0.1, parseFloat(p.price || 0)),
      ownNum: parseFloat(p.selected_by_percent || 0),
    }))

  const focusedPool = focusIds.length ? pool.filter(p => focusIds.includes(p.id)) : []
  const visiblePool =
    viewMode === 'empty' ? [] :
    viewMode === 'focus' ? focusedPool :
    pool

  const maxPrice = Math.max(...pool.map(p => p.priceNum), 8) + 0.5
  const maxPpg = Math.max(...pool.map(p => p.ppgNum), 6) + 0.6
  const markerColor = (pos) => POS_COLORS[pos] || '#fff'

  const addFocusedPlayer = (player) => {
    setFocusIds(prev => {
      if (prev.includes(player.id)) return prev
      return [...prev.slice(-1), player.id] // keep max 2 for quick compare
    })
    setViewMode('focus')
    onSelectPlayer(player)
  }

  const clearGraph = () => {
    setFocusIds([])
    setViewMode('empty')
    onSelectPlayer(null)
  }

  const scatterData = {
    datasets: [{
      label: 'Players',
      data: visiblePool.map(p => ({ x: p.priceNum, y: p.ppgNum, player: p })),
      pointRadius: (ctx) => {
        const p = ctx.raw?.player
        if (!p) return 4
        if (focusIds.includes(p.id)) return 12
        return Math.max(4, Math.min(12, p.valueNum * 1.25))
      },
      pointHoverRadius: 10,
      backgroundColor: visiblePool.map(p => markerColor(p.position)),
      borderColor: 'rgba(0,0,0,0.25)',
      borderWidth: 1,
    }]
  }

  const scatterOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    onClick: (_, elements) => {
      if (!elements.length) return
      const point = scatterData.datasets[elements[0].datasetIndex].data[elements[0].index]
      if (point?.player) onSelectPlayer(point.player)
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'var(--bg)',
        borderColor: 'var(--border)',
        borderWidth: 1,
        callbacks: {
          label: (ctx) => {
            const p = ctx.raw?.player
            if (!p) return ''
            return [
              `${p.web_name} (${p.team_name})`,
              `£${p.priceNum.toFixed(1)}m · ${p.ppgNum.toFixed(1)} PPG`,
              `Value: ${p.valueNum.toFixed(2)} pts/£m · Ownership: ${p.ownNum.toFixed(1)}%`,
            ]
          }
        }
      }
    },
    scales: {
      x: {
        title: { display: true, text: 'Price (£m)', color: 'var(--text-secondary)' },
        min: 3.5, max: maxPrice, ticks: { color: 'var(--text-secondary)' }, grid: { color: 'var(--grid)' },
      },
      y: {
        title: { display: true, text: 'Points per Game', color: 'var(--text-secondary)' },
        min: 0, max: maxPpg, ticks: { color: 'var(--text-secondary)' }, grid: { color: 'var(--grid)' },
      }
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {POSITIONS.map(pos => (
          <button key={pos} onClick={() => setPosition(pos)} style={{
            padding: '5px 11px', borderRadius: '6px', cursor: 'pointer',
            border: `1px solid ${position === pos ? '#00ff87' : 'var(--border)'}`,
            background: position === pos ? 'rgba(0,255,135,0.12)' : 'transparent',
            color: position === pos ? '#00ff87' : 'var(--text-secondary)',
            fontSize: '12px'
          }}>{pos}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
        <PlayerSearch
          players={pool}
          onSelect={addFocusedPlayer}
          placeholder="Search player to focus (max 2)..."
        />
        <button onClick={() => setViewMode('all')} style={{
          padding: '6px 10px', borderRadius: '6px', border: `1px solid ${viewMode === 'all' ? '#00ff87' : 'var(--border)'}`,
          background: viewMode === 'all' ? 'rgba(0,255,135,0.12)' : 'transparent',
          color: viewMode === 'all' ? '#00ff87' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px'
        }}>Show all</button>
        <button onClick={() => setViewMode('focus')} disabled={!focusIds.length} style={{
          padding: '6px 10px', borderRadius: '6px', border: `1px solid ${viewMode === 'focus' ? '#00ff87' : 'var(--border)'}`,
          background: viewMode === 'focus' ? 'rgba(0,255,135,0.12)' : 'transparent',
          color: !focusIds.length ? 'var(--text-muted)' : (viewMode === 'focus' ? '#00ff87' : 'var(--text-secondary)'),
          cursor: !focusIds.length ? 'not-allowed' : 'pointer', fontSize: '12px'
        }}>Focused only</button>
        <button onClick={clearGraph} style={{
          padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)',
          background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px'
        }}>Clear graph</button>
      </div>

      <div style={{ height: '420px' }}>
        <Scatter data={scatterData} options={scatterOptions} />
      </div>

      <p style={{ marginTop: '10px', color: 'var(--text-muted)', fontSize: '12px' }}>
        Bubble size reflects value (total points per £m). Click a player to inspect them in other tabs.
      </p>
      {selectedPlayer && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
          Selected: <span style={{ color: '#00ff87', fontWeight: 'bold' }}>{selectedPlayer.web_name}</span>
        </p>
      )}
      {focusIds.length > 0 && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
          Focused: {focusedPool.map(p => p.web_name).join(' vs ')}
        </p>
      )}
    </div>
  )
}

// ─── Differential Radar ──────────────────────────────────────────────────────
function DifferentialRadar({ players }) {
  const [position, setPosition] = useState('All')
  const [focusIds, setFocusIds] = useState([])
  const [viewMode, setViewMode] = useState('all') // all | focus | empty

  const allCandidates = players
    .filter(p => position === 'All' || p.position === position)
    .filter(p => (p.minutes || 0) >= 270)
    .map(p => ({
      ...p,
      ownNum: parseFloat(p.selected_by_percent || 0),
      formNum: parseFloat(p.form || 0),
      ppgNum: parseFloat(p.points_per_game || 0),
    }))
    .filter(p => p.ownNum <= 40)
    .sort((a, b) => (b.formNum * 0.7 + b.ppgNum * 0.3) - (a.formNum * 0.7 + a.ppgNum * 0.3))
    .slice(0, 15)

  const focusedCandidates = focusIds.length ? allCandidates.filter(p => focusIds.includes(p.id)) : []
  const candidates =
    viewMode === 'empty' ? [] :
    viewMode === 'focus' ? focusedCandidates :
    allCandidates

  const addFocusedPlayer = (player) => {
    setFocusIds(prev => {
      if (prev.includes(player.id)) return prev
      return [...prev.slice(-1), player.id]
    })
    setViewMode('focus')
  }

  const clearGraph = () => {
    setFocusIds([])
    setViewMode('empty')
  }

  const barData = {
    labels: candidates.map(p => p.web_name),
    datasets: [
      {
        label: 'Form',
        data: candidates.map(p => p.formNum),
        backgroundColor: 'rgba(0, 255, 135, 0.72)',
        borderColor: '#00ff87',
        borderWidth: 1,
      },
      {
        label: 'Ownership %',
        data: candidates.map(p => p.ownNum),
        backgroundColor: 'rgba(0, 178, 255, 0.55)',
        borderColor: '#00b2ff',
        borderWidth: 1,
      }
    ]
  }

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: 'var(--text-secondary)' } },
      tooltip: {
        backgroundColor: 'var(--bg)',
        borderColor: 'var(--border)',
        borderWidth: 1,
      }
    },
    scales: {
      x: { ticks: { color: 'var(--text-secondary)' }, grid: { color: 'var(--grid)' } },
      y: { ticks: { color: 'var(--text-secondary)' }, grid: { color: 'var(--grid)' } }
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {POSITIONS.map(pos => (
          <button key={pos} onClick={() => setPosition(pos)} style={{
            padding: '5px 11px', borderRadius: '6px', cursor: 'pointer',
            border: `1px solid ${position === pos ? '#00ff87' : 'var(--border)'}`,
            background: position === pos ? 'rgba(0,255,135,0.12)' : 'transparent',
            color: position === pos ? '#00ff87' : 'var(--text-secondary)',
            fontSize: '12px'
          }}>{pos}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
        <PlayerSearch
          players={allCandidates}
          onSelect={addFocusedPlayer}
          placeholder="Search differential to focus (max 2)..."
        />
        <button onClick={() => setViewMode('all')} style={{
          padding: '6px 10px', borderRadius: '6px', border: `1px solid ${viewMode === 'all' ? '#00ff87' : 'var(--border)'}`,
          background: viewMode === 'all' ? 'rgba(0,255,135,0.12)' : 'transparent',
          color: viewMode === 'all' ? '#00ff87' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px'
        }}>Show all</button>
        <button onClick={() => setViewMode('focus')} disabled={!focusIds.length} style={{
          padding: '6px 10px', borderRadius: '6px', border: `1px solid ${viewMode === 'focus' ? '#00ff87' : 'var(--border)'}`,
          background: viewMode === 'focus' ? 'rgba(0,255,135,0.12)' : 'transparent',
          color: !focusIds.length ? 'var(--text-muted)' : (viewMode === 'focus' ? '#00ff87' : 'var(--text-secondary)'),
          cursor: !focusIds.length ? 'not-allowed' : 'pointer', fontSize: '12px'
        }}>Focused only</button>
        <button onClick={clearGraph} style={{
          padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)',
          background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px'
        }}>Clear graph</button>
      </div>

      <div style={{ height: '390px' }}>
        <Bar data={barData} options={barOptions} />
      </div>

      <p style={{ marginTop: '10px', color: 'var(--text-muted)', fontSize: '12px' }}>
        Idea: target high-form, lower-owned players before ownership catches up.
      </p>
      {focusIds.length > 0 && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
          Focused: {focusedCandidates.map(p => p.web_name).join(' vs ')}
        </p>
      )}
    </div>
  )
}

// ─── Main Analytics Page ─────────────────────────────────────────────────────
export default function Analytics({ initialPlayer = null }) {
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('xg')
  const [selectedPlayer, setSelectedPlayer] = useState(initialPlayer)

  useEffect(() => {
    getPlayers()
      .then(res => setPlayers(res.data))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (initialPlayer) {
      setSelectedPlayer(initialPlayer)
      setTab('timeline')
    }
  }, [initialPlayer])

  const tabs = [
    { key: 'xg',       label: '⚽ xG vs Goals',  desc: 'See where any player sits vs their peers — click to highlight' },
    { key: 'timeline', label: '📈 Form Timeline', desc: 'GW-by-GW scoring history for any player' },
    { key: 'value',    label: '💸 Price vs Output', desc: 'Spot value picks by viewing price, PPG, and value bubbles together' },
    { key: 'radar',    label: '🛰️ Differential Radar', desc: 'Track high-form players whose ownership is still relatively low' },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: '6px', color: '#00ff87' }}>📊 Analytics</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '14px' }}>
        Other stats and cool charts! 
      </p>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '28px', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '10px 20px', borderRadius: '8px', cursor: 'pointer',
            border: `1px solid ${tab === t.key ? '#00ff87' : 'var(--border)'}`,
            background: tab === t.key ? 'rgba(0,255,135,0.1)' : 'transparent',
            color: tab === t.key ? '#00ff87' : 'var(--text-secondary)',
            fontWeight: tab === t.key ? 'bold' : 'normal', fontSize: '14px',
            transition: 'all 0.15s'
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
          Loading player data...
        </div>
      ) : (
        <div style={{ background: 'var(--bg-card)', borderRadius: '12px', padding: '24px', border: '1px solid var(--border)' }}>
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ margin: 0, fontSize: '17px', marginBottom: '4px' }}>
              {tabs.find(t => t.key === tab)?.label}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
              {tabs.find(t => t.key === tab)?.desc}
            </p>
          </div>
          {tab === 'xg' && (
            <XGPanel players={players} selectedPlayer={selectedPlayer} onSelectPlayer={setSelectedPlayer} />
          )}
          {tab === 'timeline' && (
            <FormTimeline players={players} selectedPlayer={selectedPlayer} onSelectPlayer={setSelectedPlayer} />
          )}
          {tab === 'value' && (
            <ValueMap players={players} selectedPlayer={selectedPlayer} onSelectPlayer={setSelectedPlayer} />
          )}
          {tab === 'radar' && (
            <DifferentialRadar players={players} />
          )}
        </div>
      )}
    </div>
  )
}