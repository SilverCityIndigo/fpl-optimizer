import { useState, useEffect, useRef } from 'react'
import {
  Chart as ChartJS,
  LinearScale, PointElement, LineElement, Tooltip as ChartTooltip,
  Legend, CategoryScale, Filler
} from 'chart.js'
import { Scatter, Line } from 'react-chartjs-2'
import { getPlayers, getPlayerHistory } from '../api'

ChartJS.register(LinearScale, PointElement, LineElement, ChartTooltip, Legend, CategoryScale, Filler)

const POSITIONS = ['All', 'GKP', 'DEF', 'MID', 'FWD']
const POS_COLORS = { GKP: '#f5a623', DEF: '#00b2ff', MID: '#00ff87', FWD: '#ff4444' }

function ptColor(pts) {
  if (pts >= 7) return '#00ff87'
  if (pts >= 4) return '#ffd700'
  return '#fff'
}

const TH = ({ children }) => (
  <th style={{ padding: '8px 10px', textAlign: 'left', color: '#fff', fontWeight: 'bold', fontSize: '12px', borderBottom: '1px solid #2a2f3e' }}>
    {children}
  </th>
)

// ─── xG Scatter ─────────────────────────────────────────────────────────────
function XGScatter({ players, onSelectPlayer, selectedPlayer }) {
  const [position, setPosition] = useState('All')
  const [history, setHistory] = useState([])
  const [histLoading, setHistLoading] = useState(false)
  const chartRef = useRef(null)

  // Use xg_per90 vs goals_per90 for a fair comparison
  const filtered = players
    .filter(p => position === 'All' || p.position === position)
    .filter(p => p.xg_per90 != null && p.goals_scored != null && p.minutes > 180)
    .map(p => ({
      ...p,
      xg_p90: parseFloat(p.xg_per90 || 0),
      goals_p90: parseFloat(((p.goals_scored / p.minutes) * 90).toFixed(3)),
    }))

  const positionsPresent = [...new Set(filtered.map(p => p.position))]
  const datasets = positionsPresent.map(pos => ({
    label: pos,
    data: filtered
      .filter(p => p.position === pos)
      .map(p => ({
        x: p.xg_p90,
        y: p.goals_p90,
        player: p,
      })),
    backgroundColor: POS_COLORS[pos] + 'cc',
    pointRadius: 6,
    pointHoverRadius: 9,
  }))

  const maxVal = Math.max(...filtered.map(p => Math.max(p.xg_p90, p.goals_p90)), 0.5) + 0.2
  const refLine = {
    label: 'xG = Goals',
    data: [{ x: 0, y: 0 }, { x: maxVal, y: maxVal }],
    type: 'line',
    borderColor: '#3a4050',
    borderDash: [6, 4],
    borderWidth: 2,
    pointRadius: 0,
    fill: false,
  }

  const scatterData = { datasets: [...datasets, refLine] }

  const scatterOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    onClick: (event, elements) => {
      if (!elements.length) return
      const el = elements[0]
      const ds = scatterData.datasets[el.datasetIndex]
      const point = ds.data[el.index]
      if (point?.player) handleSelect(point.player)
    },
    plugins: {
      legend: { labels: { color: '#aaa', boxWidth: 10, font: { size: 12 } } },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const p = ctx.raw?.player
            if (!p) return ''
            const diff = (p.goals_p90 - p.xg_p90).toFixed(3)
            const sign = diff >= 0 ? '+' : ''
            return [
              `${p.web_name} (${p.team_name})`,
              `Goals/90: ${p.goals_p90.toFixed(3)}   xG/90: ${p.xg_p90.toFixed(3)}`,
              `Diff: ${sign}${diff} ${parseFloat(diff) >= 0 ? '🔥 Overperforming' : '⏳ Due a return'}`,
            ]
          }
        },
        backgroundColor: '#0e1117', borderColor: '#2a2f3e', borderWidth: 1,
        titleColor: '#fff', bodyColor: '#aaa', padding: 12,
      }
    },
    scales: {
      x: {
        title: { display: true, text: 'Expected Goals per 90 (xG/90)', color: '#aaa', font: { size: 13 } },
        ticks: { color: '#aaa' }, grid: { color: '#1e2330' }, min: 0, max: maxVal,
      },
      y: {
        title: { display: true, text: 'Actual Goals per 90', color: '#aaa', font: { size: 13 } },
        ticks: { color: '#aaa' }, grid: { color: '#1e2330' }, min: 0, max: maxVal,
      }
    }
  }

  async function handleSelect(player) {
    onSelectPlayer(player)
    setHistLoading(true)
    try {
      const res = await getPlayerHistory(player.id)
      setHistory(res.data)
    } catch { setHistory([]) }
    setHistLoading(false)
  }

  const selected = selectedPlayer

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: '#aaa', fontSize: '13px' }}>Position:</span>
        {POSITIONS.map(pos => (
          <button key={pos} onClick={() => setPosition(pos)} style={{
            padding: '5px 14px', borderRadius: '6px',
            border: `1px solid ${pos === 'All' ? '#00ff87' : POS_COLORS[pos] || '#00ff87'}`,
            background: position === pos ? (POS_COLORS[pos] || '#00ff87') : 'transparent',
            color: position === pos ? '#000' : '#fff',
            cursor: 'pointer', fontWeight: position === pos ? 'bold' : 'normal', fontSize: '13px'
          }}>{pos}</button>
        ))}
        <span style={{ color: '#555', fontSize: '12px', marginLeft: 'auto' }}>
          {filtered.length} players · click a dot to see their season timeline
        </span>
      </div>

      <div style={{ height: '420px', marginBottom: '12px' }}>
        <Scatter ref={chartRef} data={scatterData} options={scatterOptions} />
      </div>

      <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginBottom: '24px' }}>
        <span style={{ fontSize: '12px', color: '#00ff87' }}>▲ Above line = overperforming xG</span>
        <span style={{ fontSize: '12px', color: '#ff8800' }}>▼ Below line = due a return</span>
      </div>

      {selected && (
        <div style={{ background: '#0e1117', borderRadius: '12px', padding: '20px', border: `1px solid ${POS_COLORS[selected.position] || '#00ff87'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
            {selected.code && (
              <img src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${selected.code}.png`}
                style={{ height: '60px', objectFit: 'contain' }}
                onError={e => e.target.style.display = 'none'} />
            )}
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '18px' }}>{selected.web_name}</div>
              <div style={{ color: '#aaa', fontSize: '13px' }}>{selected.team_name} · {selected.position} · £{selected.price}m</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {[
                ['Goals', selected.goals_scored, '#ffd700'],
                ['xG/90', parseFloat(selected.xg_per90 || 0).toFixed(3), '#00b2ff'],
                ['xA/90', parseFloat(selected.xa_per90 || 0).toFixed(3), '#00b2ff'],
                ['xGI/90', parseFloat(selected.xgi_per90 || 0).toFixed(3), '#00ff87'],
              ].map(([label, val, color]) => (
                <div key={label} style={{ background: '#1a1f2e', borderRadius: '8px', padding: '8px 14px', textAlign: 'center' }}>
                  <div style={{ color: '#aaa', fontSize: '10px', marginBottom: '2px' }}>{label}</div>
                  <div style={{ color, fontWeight: 'bold', fontSize: '16px' }}>{val}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ color: '#aaa', fontSize: '12px', marginBottom: '10px' }}>GW Points Timeline</div>
          {histLoading ? (
            <p style={{ color: '#aaa', fontSize: '13px' }}>Loading history...</p>
          ) : history.length === 0 ? (
            <p style={{ color: '#555', fontSize: '13px' }}>No gameweek history found.</p>
          ) : (
            <div style={{ height: '200px' }}>
              <Line
                data={{
                  labels: history.map(h => `GW${h.gameweek}`),
                  datasets: [{
                    label: selected.web_name,
                    data: history.map(h => h.total_points),
                    borderColor: '#00ff87',
                    backgroundColor: 'rgba(0,255,135,0.15)',
                    borderWidth: 2, pointRadius: 3, pointHoverRadius: 6,
                    fill: true, tension: 0.3,
                  }]
                }}
                options={{
                  responsive: true, maintainAspectRatio: false, animation: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      backgroundColor: '#0e1117', borderColor: '#2a2f3e', borderWidth: 1,
                      titleColor: '#aaa', bodyColor: '#fff',
                    }
                  },
                  scales: {
                    x: { ticks: { color: '#aaa', font: { size: 10 } }, grid: { color: '#1e2330' } },
                    y: { ticks: { color: '#aaa', font: { size: 10 } }, grid: { color: '#1e2330' } }
                  }
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Form Timeline ───────────────────────────────────────────────────────────
function FormTimeline({ players, selectedPlayer, onSelectPlayer }) {
  const [search, setSearch] = useState('')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [compare, setCompare] = useState(null)
  const [compareHistory, setCompareHistory] = useState([])
  const [compareSearch, setCompareSearch] = useState('')

  const selected = selectedPlayer

  const filtered = players
    .filter(p => p.web_name.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 30)

  const filteredCompare = players
    .filter(p => p.web_name.toLowerCase().includes(compareSearch.toLowerCase()))
    .filter(p => p.id !== selected?.id)
    .slice(0, 20)

  // Auto-load history when selectedPlayer changes (e.g. from Players page redirect)
  useEffect(() => {
    if (!selected) return
    setLoading(true)
    getPlayerHistory(selected.id)
      .then(res => setHistory(res.data))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false))
  }, [selected?.id])

  async function selectPlayer(player) {
    onSelectPlayer(player)
    setSearch('')
  }

  async function selectCompare(player) {
    setCompare(player)
    setCompareSearch('')
    try {
      const res = await getPlayerHistory(player.id)
      setCompareHistory(res.data)
    } catch { setCompareHistory([]) }
  }

  const avgPts = history.length
    ? (history.reduce((s, h) => s + h.total_points, 0) / history.length).toFixed(1)
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
      legend: { display: !!compare, labels: { color: '#aaa', boxWidth: 12, font: { size: 12 } } },
      tooltip: {
        backgroundColor: '#0e1117', borderColor: '#2a2f3e', borderWidth: 1,
        titleColor: '#aaa', bodyColor: '#fff',
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
        ticks: { color: '#aaa', font: { size: 11 } }, grid: { color: '#1e2330' },
        title: { display: true, text: 'Gameweek', color: '#555', font: { size: 12 } }
      },
      y: { ticks: { color: '#aaa', font: { size: 11 } }, grid: { color: '#1e2330' } }
    }
  }

  return (
    <div>
      <div style={{ position: 'relative', marginBottom: '16px', maxWidth: '320px' }}>
        <input
          placeholder="Search player..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', padding: '10px 14px', borderRadius: '8px',
            border: '1px solid #2a2f3e', background: '#0e1117',
            color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box'
          }}
        />
        {search && filtered.length > 0 && (
          <div style={{
            position: 'absolute', zIndex: 100, background: '#1a1f2e',
            border: '1px solid #2a2f3e', borderRadius: '8px', marginTop: '4px',
            maxHeight: '240px', overflowY: 'auto', width: '100%'
          }}>
            {filtered.map(p => (
              <div key={p.id} onClick={() => selectPlayer(p)}
                style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid #0e1117' }}
                onMouseEnter={e => e.currentTarget.style.background = '#0e1117'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                {p.code && (
                  <img src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.code}.png`}
                    style={{ height: '32px', objectFit: 'contain' }}
                    onError={e => e.target.style.display = 'none'} />
                )}
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#fff' }}>{p.web_name}</div>
                  <div style={{ color: '#aaa', fontSize: '11px' }}>{p.team_name} · {p.position} · £{p.price}m</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!selected && (
        <div style={{ background: '#0e1117', borderRadius: '12px', padding: '48px', textAlign: 'center', border: '1px dashed #2a2f3e' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📈</div>
          <div style={{ color: '#aaa', fontSize: '14px' }}>Search for a player above to load their GW-by-GW points timeline</div>
        </div>
      )}

      {selected && (
        <div style={{ background: '#0e1117', borderRadius: '12px', padding: '20px', border: `1px solid ${POS_COLORS[selected.position] || '#00ff87'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
            {selected.code && (
              <img src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${selected.code}.png`}
                style={{ height: '65px', objectFit: 'contain' }}
                onError={e => e.target.style.display = 'none'} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 'bold', fontSize: '20px' }}>{selected.web_name}</div>
              <div style={{ color: '#aaa', fontSize: '13px' }}>{selected.team_name} · {selected.position} · £{selected.price}m</div>
            </div>
            {avgPts && (
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {[
                  ['Season Pts', selected.total_points, '#fff'],
                  ['Avg / GW', avgPts, '#00ff87'],
                  ['Best GW', `GW${bestGW?.gameweek} (${bestGW?.total_points}pts)`, '#ffd700'],
                  ['Form', selected.form, '#00b2ff'],
                  ['xG/90', parseFloat(selected.xg_per90 || 0).toFixed(3), '#00b2ff'],
                  ['xA/90', parseFloat(selected.xa_per90 || 0).toFixed(3), '#00b2ff'],
                  ['xGI/90', parseFloat(selected.xgi_per90 || 0).toFixed(3), '#00ff87'],
                ].map(([label, val, color]) => (
                  <div key={label} style={{ background: '#1a1f2e', borderRadius: '8px', padding: '8px 14px', textAlign: 'center' }}>
                    <div style={{ color: '#aaa', fontSize: '10px', marginBottom: '2px' }}>{label}</div>
                    <div style={{ color, fontWeight: 'bold', fontSize: '15px' }}>{val}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <span style={{ color: '#aaa', fontSize: '13px' }}>Compare with:</span>
            <div style={{ position: 'relative', minWidth: '200px' }}>
              <input
                placeholder="Search player to compare..."
                value={compareSearch}
                onChange={e => setCompareSearch(e.target.value)}
                style={{
                  width: '100%', padding: '7px 12px', borderRadius: '6px',
                  border: '1px solid #2a2f3e', background: '#1a1f2e',
                  color: '#fff', fontSize: '13px', outline: 'none'
                }}
              />
              {compareSearch && filteredCompare.length > 0 && (
                <div style={{
                  position: 'absolute', zIndex: 100, background: '#1a1f2e',
                  border: '1px solid #2a2f3e', borderRadius: '8px', marginTop: '4px',
                  maxHeight: '200px', overflowY: 'auto', minWidth: '220px'
                }}>
                  {filteredCompare.map(p => (
                    <div key={p.id} onClick={() => selectCompare(p)}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#fff', borderBottom: '1px solid #0e1117' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#0e1117'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      {p.web_name} <span style={{ color: '#aaa' }}>· {p.team_name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {compare && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '12px', height: '3px', background: '#ff8800', borderRadius: '2px' }} />
                <span style={{ color: '#ff8800', fontSize: '13px', fontWeight: 'bold' }}>{compare.web_name}</span>
                <button onClick={() => { setCompare(null); setCompareHistory([]); setCompareSearch('') }}
                  style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>×</button>
              </div>
            )}
          </div>

          {loading ? (
            <p style={{ color: '#aaa', fontSize: '13px' }}>Loading timeline...</p>
          ) : (
            <div style={{ height: '280px', marginBottom: '24px' }}>
              <Line data={lineData} options={lineOptions} />
            </div>
          )}

          {history.length > 0 && (
            <div>
              <div style={{ color: '#fff', fontSize: '13px', fontWeight: 'bold', marginBottom: '10px' }}>Gameweek Breakdown</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <TH>GW</TH>
                      <TH>Pts</TH>
                      <TH>Mins</TH>
                      <TH>Goals</TH>
                      <TH>Assists</TH>
                      <TH>CS</TH>
                      <TH>Bonus</TH>
                      <TH>BPS</TH>
                      <TH>ICT</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {[...history].reverse().slice(0, 10).map(h => (
                      <tr key={h.gameweek} style={{ borderBottom: '1px solid #1a1f2e' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#1a1f2e'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ padding: '7px 10px', color: '#aaa' }}>GW{h.gameweek}</td>
                        <td style={{ padding: '7px 10px', color: ptColor(h.total_points), fontWeight: 'bold' }}>{h.total_points}</td>
                        <td style={{ padding: '7px 10px', color: h.minutes === 0 ? '#ff4444' : '#fff' }}>{h.minutes}'</td>
                        <td style={{ padding: '7px 10px', color: h.goals_scored > 0 ? '#ffd700' : '#555' }}>{h.goals_scored || '—'}</td>
                        <td style={{ padding: '7px 10px', color: h.assists > 0 ? '#00b2ff' : '#555' }}>{h.assists || '—'}</td>
                        <td style={{ padding: '7px 10px', color: h.clean_sheets > 0 ? '#00ff87' : '#555' }}>{h.clean_sheets > 0 ? '✓' : '—'}</td>
                        <td style={{ padding: '7px 10px', color: h.bonus > 0 ? '#00ff87' : '#555' }}>{h.bonus || '—'}</td>
                        <td style={{ padding: '7px 10px', color: '#aaa' }}>{h.bps ?? '—'}</td>
                        <td style={{ padding: '7px 10px', color: '#aaa' }}>{h.ict_index != null ? parseFloat(h.ict_index).toFixed(1) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {history.length > 10 && (
                  <div style={{ color: '#555', fontSize: '11px', marginTop: '6px', textAlign: 'right' }}>Showing last 10 GWs</div>
                )}
              </div>
            </div>
          )}
        </div>
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

  // If initialPlayer is passed in (from Players page), auto-switch to timeline
  useEffect(() => {
    if (initialPlayer) {
      setSelectedPlayer(initialPlayer)
      setTab('timeline')
    }
  }, [initialPlayer])

  const tabs = [
    { key: 'xg',       label: '⚽ xG vs Goals',  desc: 'Who is over/underperforming their expected goals per 90?' },
    { key: 'timeline', label: '📈 Form Timeline', desc: 'GW-by-GW scoring history for any player' },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: '6px', color: '#00ff87' }}>📊 Analytics</h2>
      <p style={{ color: '#aaa', marginBottom: '24px', fontSize: '14px' }}>
        Deeper stats and visualisations — go beyond the surface numbers.
      </p>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '28px', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '10px 20px', borderRadius: '8px', cursor: 'pointer',
            border: `1px solid ${tab === t.key ? '#00ff87' : '#2a2f3e'}`,
            background: tab === t.key ? 'rgba(0,255,135,0.1)' : 'transparent',
            color: tab === t.key ? '#00ff87' : '#aaa',
            fontWeight: tab === t.key ? 'bold' : 'normal', fontSize: '14px',
            transition: 'all 0.15s'
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#aaa' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
          Loading player data...
        </div>
      ) : (
        <div style={{ background: '#1a1f2e', borderRadius: '12px', padding: '24px', border: '1px solid #2a2f3e' }}>
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ margin: 0, fontSize: '17px', marginBottom: '4px' }}>
              {tabs.find(t => t.key === tab)?.label}
            </h3>
            <p style={{ color: '#555', fontSize: '13px', margin: 0 }}>
              {tabs.find(t => t.key === tab)?.desc}
            </p>
          </div>
          {tab === 'xg' && (
            <XGScatter
              players={players}
              selectedPlayer={selectedPlayer}
              onSelectPlayer={setSelectedPlayer}
            />
          )}
          {tab === 'timeline' && (
            <FormTimeline
              players={players}
              selectedPlayer={selectedPlayer}
              onSelectPlayer={setSelectedPlayer}
            />
          )}
        </div>
      )}
    </div>
  )
}