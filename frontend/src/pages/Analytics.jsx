import { useState, useEffect, useCallback } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, LineChart, Line, Area, AreaChart
} from 'recharts'
import { getPlayers, getPlayerHistory } from '../api'

const POSITIONS = ['All', 'GKP', 'DEF', 'MID', 'FWD']
const POS_COLORS = { GKP: '#f5a623', DEF: '#00b2ff', MID: '#00ff87', FWD: '#ff4444' }

// ─── xG Scatter Tooltip ────────────────────────────────────────────────────
function XGTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const diff = (d.goals - d.xg).toFixed(2)
  const over = d.goals >= d.xg
  return (
    <div style={{
      background: '#0e1117', border: '1px solid #2a2f3e', borderRadius: '10px',
      padding: '12px 16px', fontSize: '13px', minWidth: '180px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        {d.code && (
          <img
            src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${d.code}.png`}
            style={{ height: '40px', objectFit: 'contain' }}
            onError={e => e.target.style.display = 'none'}
          />
        )}
        <div>
          <div style={{ fontWeight: 'bold', color: '#fff' }}>{d.web_name}</div>
          <div style={{ color: '#aaa', fontSize: '11px' }}>{d.team_name} · {d.position}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '24px' }}>
          <span style={{ color: '#aaa' }}>Goals</span>
          <span style={{ color: '#fff', fontWeight: 'bold' }}>{d.goals}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '24px' }}>
          <span style={{ color: '#aaa' }}>xG</span>
          <span style={{ color: '#fff', fontWeight: 'bold' }}>{d.xg}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '24px', borderTop: '1px solid #2a2f3e', paddingTop: '4px', marginTop: '2px' }}>
          <span style={{ color: '#aaa' }}>Diff</span>
          <span style={{ color: over ? '#00ff87' : '#ff4444', fontWeight: 'bold' }}>
            {over ? '+' : ''}{diff}
          </span>
        </div>
        <div style={{ fontSize: '11px', color: over ? '#00ff87' : '#ff8800', marginTop: '2px', fontStyle: 'italic' }}>
          {over ? '🔥 Overperforming xG' : '⏳ Due a return'}
        </div>
      </div>
    </div>
  )
}

// ─── Form Timeline Tooltip ──────────────────────────────────────────────────
function TimelineTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div style={{
      background: '#0e1117', border: '1px solid #2a2f3e', borderRadius: '10px',
      padding: '12px 16px', fontSize: '13px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
    }}>
      <div style={{ color: '#aaa', marginBottom: '6px', fontSize: '11px' }}>GW {d?.round}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px' }}>
          <span style={{ color: '#aaa' }}>Points</span>
          <span style={{ color: '#00ff87', fontWeight: 'bold' }}>{d?.total_points}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px' }}>
          <span style={{ color: '#aaa' }}>Minutes</span>
          <span style={{ color: '#fff' }}>{d?.minutes}'</span>
        </div>
        {d?.goals_scored > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px' }}>
            <span style={{ color: '#aaa' }}>Goals</span>
            <span style={{ color: '#ffd700', fontWeight: 'bold' }}>{d.goals_scored} ⚽</span>
          </div>
        )}
        {d?.assists > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px' }}>
            <span style={{ color: '#aaa' }}>Assists</span>
            <span style={{ color: '#00b2ff', fontWeight: 'bold' }}>{d.assists} 🅰️</span>
          </div>
        )}
        {d?.bonus > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px' }}>
            <span style={{ color: '#aaa' }}>Bonus</span>
            <span style={{ color: '#ff8800' }}>{d.bonus}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Custom Scatter Dot ─────────────────────────────────────────────────────
function CustomDot(props) {
  const { cx, cy, payload, selectedPlayer, onSelect } = props
  const isSelected = selectedPlayer?.id === payload.id
  const color = POS_COLORS[payload.position] || '#aaa'
  return (
    <circle
      cx={cx} cy={cy}
      r={isSelected ? 8 : 5}
      fill={color}
      fillOpacity={isSelected ? 1 : 0.75}
      stroke={isSelected ? '#fff' : color}
      strokeWidth={isSelected ? 2 : 0}
      style={{ cursor: 'pointer', transition: 'r 0.15s' }}
      onClick={() => onSelect(payload)}
    />
  )
}

// ─── xG Scatter Panel ───────────────────────────────────────────────────────
function XGScatter({ players }) {
  const [position, setPosition] = useState('All')
  const [selected, setSelected] = useState(null)
  const [history, setHistory] = useState([])
  const [histLoading, setHistLoading] = useState(false)

  const data = players
    .filter(p => position === 'All' || p.position === position)
    .filter(p => p.xg != null && p.goals_scored != null && p.minutes > 180)
    .map(p => ({
      ...p,
      xg: parseFloat(p.xg || 0),
      goals: p.goals_scored,
    }))

  const maxVal = Math.max(...data.map(p => Math.max(p.xg, p.goals)), 1) + 1

  async function handleSelect(player) {
    setSelected(player)
    setHistLoading(true)
    try {
      const res = await getPlayerHistory(player.id)
      setHistory(res.data)
    } catch {
      setHistory([])
    }
    setHistLoading(false)
  }

  return (
    <div>
      {/* Position filter */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: '#aaa', fontSize: '13px', marginRight: '4px' }}>Position:</span>
        {POSITIONS.map(pos => (
          <button key={pos} onClick={() => setPosition(pos)} style={{
            padding: '5px 14px', borderRadius: '6px',
            border: `1px solid ${pos === 'All' ? '#00ff87' : POS_COLORS[pos] || '#00ff87'}`,
            background: position === pos ? (POS_COLORS[pos] || '#00ff87') : 'transparent',
            color: position === pos ? '#000' : '#fff',
            cursor: 'pointer', fontWeight: position === pos ? 'bold' : 'normal', fontSize: '13px'
          }}>{pos}</button>
        ))}
        <span style={{ color: '#555', fontSize: '12px', marginLeft: 'auto' }}>{data.length} players · click a dot to see their season timeline</span>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {Object.entries(POS_COLORS).map(([pos, color]) => (
          <div key={pos} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: color }} />
            <span style={{ color: '#aaa', fontSize: '12px' }}>{pos}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px' }}>
          <div style={{ width: '24px', height: '1px', background: '#444', borderTop: '2px dashed #444' }} />
          <span style={{ color: '#555', fontSize: '12px' }}>xG = Goals line</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={420}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" />
          <XAxis
            dataKey="xg" type="number" name="xG" domain={[0, maxVal]}
            label={{ value: 'Expected Goals (xG)', position: 'insideBottom', offset: -20, fill: '#aaa', fontSize: 13 }}
            tick={{ fill: '#aaa', fontSize: 12 }} tickLine={false} axisLine={{ stroke: '#2a2f3e' }}
          />
          <YAxis
            dataKey="goals" type="number" name="Goals" domain={[0, maxVal]}
            label={{ value: 'Actual Goals', angle: -90, position: 'insideLeft', offset: 10, fill: '#aaa', fontSize: 13 }}
            tick={{ fill: '#aaa', fontSize: 12 }} tickLine={false} axisLine={{ stroke: '#2a2f3e' }}
          />
          <ReferenceLine
            segment={[{ x: 0, y: 0 }, { x: maxVal, y: maxVal }]}
            stroke="#2a2f3e" strokeDasharray="6 4" strokeWidth={2}
          />
          <Tooltip content={<XGTooltip />} cursor={false} />
          <Scatter
            data={data}
            shape={(props) => (
              <CustomDot {...props} selectedPlayer={selected} onSelect={handleSelect} />
            )}
          />
        </ScatterChart>
      </ResponsiveContainer>

      {/* Above/below line labels */}
      <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '8px', marginBottom: '24px' }}>
        <span style={{ fontSize: '12px', color: '#00ff87' }}>▲ Above line = overperforming xG</span>
        <span style={{ fontSize: '12px', color: '#ff8800' }}>▼ Below line = due a return</span>
      </div>

      {/* Selected player timeline */}
      {selected && (
        <div style={{
          background: '#1a1f2e', borderRadius: '12px', padding: '20px',
          border: `1px solid ${POS_COLORS[selected.position] || '#00ff87'}`,
          marginTop: '8px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
            {selected.code && (
              <img
                src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${selected.code}.png`}
                style={{ height: '60px', objectFit: 'contain' }}
                onError={e => e.target.style.display = 'none'}
              />
            )}
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '18px' }}>{selected.web_name}</div>
              <div style={{ color: '#aaa', fontSize: '13px' }}>{selected.team_name} · {selected.position} · £{selected.price}m</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {[
                ['Goals', selected.goals, '#ffd700'],
                ['xG', parseFloat(selected.xg).toFixed(2), '#00b2ff'],
                ['Diff', ((selected.goals || 0) - parseFloat(selected.xg || 0)).toFixed(2), (selected.goals || 0) >= parseFloat(selected.xg || 0) ? '#00ff87' : '#ff4444'],
              ].map(([label, val, color]) => (
                <div key={label} style={{ background: '#0e1117', borderRadius: '8px', padding: '8px 14px', textAlign: 'center' }}>
                  <div style={{ color: '#aaa', fontSize: '10px', marginBottom: '2px' }}>{label}</div>
                  <div style={{ color, fontWeight: 'bold', fontSize: '16px' }}>{val}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ color: '#aaa', fontSize: '12px', marginBottom: '8px' }}>GW Points Timeline</div>
          {histLoading ? (
            <p style={{ color: '#aaa', fontSize: '13px' }}>Loading history...</p>
          ) : history.length === 0 ? (
            <p style={{ color: '#555', fontSize: '13px' }}>No gameweek history found.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={history} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="ptsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00ff87" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#00ff87" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" />
                <XAxis dataKey="round" tick={{ fill: '#aaa', fontSize: 11 }} tickLine={false} axisLine={false} label={{ value: 'Gameweek', position: 'insideBottom', offset: -2, fill: '#555', fontSize: 11 }} />
                <YAxis tick={{ fill: '#aaa', fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip content={<TimelineTooltip />} />
                <Area type="monotone" dataKey="total_points" stroke="#00ff87" strokeWidth={2} fill="url(#ptsFill)" dot={{ fill: '#00ff87', r: 3 }} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Standalone Form Timeline Panel ─────────────────────────────────────────
function FormTimeline({ players }) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [compare, setCompare] = useState(null)
  const [compareHistory, setCompareHistory] = useState([])

  const filtered = players
    .filter(p => p.web_name.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 30)

  async function selectPlayer(player, isCompare = false) {
    if (isCompare) {
      setCompare(player)
      const res = await getPlayerHistory(player.id)
      setCompareHistory(res.data)
    } else {
      setSelected(player)
      setLoading(true)
      try {
        const res = await getPlayerHistory(player.id)
        setHistory(res.data)
      } catch { setHistory([]) }
      setLoading(false)
    }
  }

  // Merge histories by round for comparison
  const mergedHistory = history.map(h => {
    const comp = compareHistory.find(c => c.round === h.round)
    return {
      ...h,
      compare_points: comp?.total_points ?? null
    }
  })

  const avgPts = history.length
    ? (history.reduce((s, h) => s + h.total_points, 0) / history.length).toFixed(1)
    : null
  const bestGW = history.length
    ? history.reduce((best, h) => h.total_points > best.total_points ? h : best, history[0])
    : null

  return (
    <div>
      {/* Search */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: '220px' }}>
          <input
            placeholder="Search player..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '10px 14px', borderRadius: '8px',
              border: '1px solid #2a2f3e', background: '#0e1117',
              color: '#fff', fontSize: '14px', outline: 'none'
            }}
          />
          {search && filtered.length > 0 && (
            <div style={{
              position: 'absolute', zIndex: 100, background: '#1a1f2e',
              border: '1px solid #2a2f3e', borderRadius: '8px', marginTop: '4px',
              maxHeight: '240px', overflowY: 'auto', minWidth: '240px'
            }}>
              {filtered.map(p => (
                <div key={p.id}
                  onClick={() => { selectPlayer(p); setSearch('') }}
                  style={{
                    padding: '10px 14px', cursor: 'pointer', display: 'flex',
                    alignItems: 'center', gap: '10px', borderBottom: '1px solid #0e1117'
                  }}
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
        <div style={{ color: '#555', fontSize: '12px', paddingTop: '12px' }}>
          Search and select a player to view their season scoring history
        </div>
      </div>

      {!selected && (
        <div style={{
          background: '#1a1f2e', borderRadius: '12px', padding: '48px',
          textAlign: 'center', border: '1px dashed #2a2f3e'
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📈</div>
          <div style={{ color: '#aaa', fontSize: '14px' }}>Search for a player above to load their GW-by-GW points timeline</div>
        </div>
      )}

      {selected && (
        <div style={{ background: '#1a1f2e', borderRadius: '12px', padding: '20px', border: `1px solid ${POS_COLORS[selected.position] || '#00ff87'}` }}>
          {/* Player header */}
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
            {/* Season summary stats */}
            {avgPts && (
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {[
                  ['Season Pts', selected.total_points, '#fff'],
                  ['Avg / GW', avgPts, '#00ff87'],
                  ['Best GW', `GW${bestGW?.round} (${bestGW?.total_points}pts)`, '#ffd700'],
                  ['Form', selected.form, '#00b2ff'],
                ].map(([label, val, color]) => (
                  <div key={label} style={{ background: '#0e1117', borderRadius: '8px', padding: '8px 14px', textAlign: 'center' }}>
                    <div style={{ color: '#aaa', fontSize: '10px', marginBottom: '2px' }}>{label}</div>
                    <div style={{ color, fontWeight: 'bold', fontSize: '15px' }}>{val}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Compare toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <span style={{ color: '#aaa', fontSize: '13px' }}>Compare with:</span>
            <div style={{ position: 'relative', minWidth: '200px' }}>
              <input
                placeholder="Search player to compare..."
                onChange={e => {
                  const val = e.target.value
                  if (!val) { setCompare(null); setCompareHistory([]) }
                  // reuse main search for simplicity
                  setSearch(val)
                }}
                style={{
                  width: '100%', padding: '7px 12px', borderRadius: '6px',
                  border: '1px solid #2a2f3e', background: '#0e1117',
                  color: '#fff', fontSize: '13px', outline: 'none'
                }}
              />
              {search && filtered.length > 0 && (
                <div style={{
                  position: 'absolute', zIndex: 100, background: '#1a1f2e',
                  border: '1px solid #2a2f3e', borderRadius: '8px', marginTop: '4px',
                  maxHeight: '200px', overflowY: 'auto', minWidth: '220px'
                }}>
                  {filtered.filter(p => p.id !== selected.id).map(p => (
                    <div key={p.id}
                      onClick={() => { selectPlayer(p, true); setSearch('') }}
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
                <button onClick={() => { setCompare(null); setCompareHistory([]) }}
                  style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>×</button>
              </div>
            )}
          </div>

          {/* Chart */}
          {loading ? (
            <p style={{ color: '#aaa', fontSize: '13px' }}>Loading timeline...</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={mergedHistory} margin={{ top: 5, right: 10, bottom: 20, left: 0 }}>
                <defs>
                  <linearGradient id="mainFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00ff87" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#00ff87" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="compFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ff8800" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#ff8800" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" />
                <XAxis dataKey="round" tick={{ fill: '#aaa', fontSize: 11 }} tickLine={false} axisLine={false}
                  label={{ value: 'Gameweek', position: 'insideBottom', offset: -10, fill: '#555', fontSize: 12 }} />
                <YAxis tick={{ fill: '#aaa', fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip content={<TimelineTooltip />} />
                <Area type="monotone" dataKey="total_points" stroke="#00ff87" strokeWidth={2.5}
                  fill="url(#mainFill)" dot={{ fill: '#00ff87', r: 3 }} activeDot={{ r: 6 }} name={selected.web_name} />
                {compare && compareHistory.length > 0 && (
                  <Area type="monotone" dataKey="compare_points" stroke="#ff8800" strokeWidth={2}
                    fill="url(#compFill)" dot={{ fill: '#ff8800', r: 3 }} activeDot={{ r: 5 }} name={compare.web_name} strokeDasharray="5 3" />
                )}
              </AreaChart>
            </ResponsiveContainer>
          )}

          {/* GW breakdown table */}
          {history.length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <div style={{ color: '#aaa', fontSize: '12px', marginBottom: '8px' }}>Gameweek Breakdown</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #2a2f3e' }}>
                      {['GW', 'Pts', 'Mins', 'Goals', 'Assists', 'CS', 'Bonus', 'xG', 'xA'].map(h => (
                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#555', fontWeight: 'normal' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...history].reverse().slice(0, 10).map(h => (
                      <tr key={h.round} style={{ borderBottom: '1px solid #1a1f2e' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#1a1f2e'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ padding: '6px 10px', color: '#aaa' }}>GW{h.round}</td>
                        <td style={{ padding: '6px 10px', color: h.total_points >= 9 ? '#00ff87' : h.total_points >= 6 ? '#ffd700' : '#fff', fontWeight: 'bold' }}>{h.total_points}</td>
                        <td style={{ padding: '6px 10px', color: h.minutes === 0 ? '#ff4444' : '#fff' }}>{h.minutes}'</td>
                        <td style={{ padding: '6px 10px', color: h.goals_scored > 0 ? '#ffd700' : '#555' }}>{h.goals_scored || '—'}</td>
                        <td style={{ padding: '6px 10px', color: h.assists > 0 ? '#00b2ff' : '#555' }}>{h.assists || '—'}</td>
                        <td style={{ padding: '6px 10px', color: h.clean_sheets > 0 ? '#00ff87' : '#555' }}>{h.clean_sheets > 0 ? '✓' : '—'}</td>
                        <td style={{ padding: '6px 10px', color: h.bonus > 0 ? '#ff8800' : '#555' }}>{h.bonus || '—'}</td>
                        <td style={{ padding: '6px 10px', color: '#aaa' }}>{h.expected_goals != null ? parseFloat(h.expected_goals).toFixed(2) : '—'}</td>
                        <td style={{ padding: '6px 10px', color: '#aaa' }}>{h.expected_assists != null ? parseFloat(h.expected_assists).toFixed(2) : '—'}</td>
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
export default function Analytics() {
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('xg')

  useEffect(() => {
    getPlayers()
      .then(res => setPlayers(res.data))
      .finally(() => setLoading(false))
  }, [])

  const tabs = [
    { key: 'xg',      label: '⚽ xG vs Goals',      desc: 'Who is over/underperforming their expected goals?' },
    { key: 'timeline', label: '📈 Form Timeline',    desc: 'GW-by-GW scoring history for any player' },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: '6px', color: '#00ff87' }}>📊 Analytics</h2>
      <p style={{ color: '#aaa', marginBottom: '24px', fontSize: '14px' }}>
        Deeper stats and visualisations — go beyond the surface numbers.
      </p>

      {/* Tab bar */}
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
          {tab === 'xg'       && <XGScatter players={players} />}
          {tab === 'timeline' && <FormTimeline players={players} />}
        </div>
      )}
    </div>
  )
}
