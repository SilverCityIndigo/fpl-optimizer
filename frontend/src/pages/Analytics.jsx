import { useState, useEffect, useRef } from 'react'
import {
  Chart as ChartJS,
  LinearScale, PointElement, LineElement, Tooltip as ChartTooltip,
  Legend, CategoryScale, Filler, BarElement
} from 'chart.js'
import { Scatter, Line } from 'react-chartjs-2'
import { getPlayerHistory } from '../api'
import { PHOTO } from '../playerPhoto'
import { usePlayers } from '../usePlayers'

ChartJS.register(LinearScale, PointElement, LineElement, ChartTooltip, Legend, CategoryScale, Filler, BarElement)

const POSITIONS = ['All', 'GKP', 'DEF', 'MID', 'FWD']
// DOM (CSS) colours — safe to use as CSS var strings in HTML/inline styles
const POS_COLORS = { GKP: 'var(--gold)', DEF: 'var(--info)', MID: 'var(--accent)', FWD: 'var(--danger)' }

// ─── Theme colour resolution for Chart.js (canvas can't read CSS vars) ───────
function readThemeColors() {
  const s = getComputedStyle(document.documentElement)
  const g = (n, fb) => (s.getPropertyValue(n).trim() || fb)
  return {
    text:   g('--text', '#e8eef8'),
    dim:    g('--text-secondary', '#93a2bd'),
    muted:  g('--text-muted', '#61718f'),
    grid:   g('--grid', '#212c44'),
    line:   g('--line', '#263049'),
    surface:g('--surface', '#111726'),
    accent: g('--accent', '#31e0a4'),
    gold:   g('--gold', '#f5b13d'),
    danger: g('--danger', '#ff5d6c'),
    info:   g('--info', '#5aa2ff'),
  }
}
function useThemeColors() {
  const [c, setC] = useState(readThemeColors)
  useEffect(() => {
    const obs = new MutationObserver(() => setC(readThemeColors()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return c
}
function alpha(hex, a) {
  let h = (hex || '').replace('#', '')
  if (h.length === 3) h = h.split('').map(x => x + x).join('')
  if (h.length !== 6) return hex
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
// shared Chart.js option scaffolding built from resolved colours
function baseScales(C, xTitle, yTitle, xRange, yRange) {
  const axis = (title, range) => ({
    title: title ? { display: true, text: title, color: C.dim, font: { size: 12, weight: '600' } } : undefined,
    ticks: { color: C.muted, font: { size: 11 } },
    grid: { color: C.grid, drawTicks: false },
    border: { color: C.line },
    ...(range || {}),
  })
  return { x: axis(xTitle, xRange), y: axis(yTitle, yRange) }
}
function baseTooltip(C) {
  return {
    backgroundColor: C.surface, borderColor: C.line, borderWidth: 1,
    titleColor: C.text, bodyColor: C.dim, padding: 10, cornerRadius: 8, displayColors: false,
  }
}

// ─── Shared Player Search ────────────────────────────────────────────────────
function PlayerSearch({ players, onSelect, placeholder = 'Search player…', excludeId = null }) {
  const [search, setSearch] = useState('')
  const filtered = players
    .filter(p => p.web_name.toLowerCase().includes(search.toLowerCase()))
    .filter(p => p.id !== excludeId)
    .slice(0, 24)

  return (
    <div className="psearch">
      <div className="search-box">
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.6-3.6" /></svg>
        <input placeholder={placeholder} value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {search && filtered.length > 0 && (
        <div className="psearch-menu">
          {filtered.map(p => (
            <div key={p.id} className="psearch-item" onClick={() => { onSelect(p); setSearch('') }}>
              {p.code && <img src={PHOTO(p.code)} style={{ height: '30px', objectFit: 'contain' }} onError={e => { e.target.style.display = 'none' }} alt="" />}
              <div>
                <div style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--text)' }}>{p.web_name}</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>{p.team_name} · {p.position} · £{p.price}m</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PosFilter({ value, onChange }) {
  return (
    <div className="seg">
      {POSITIONS.map(pos => (
        <button key={pos} className={value === pos ? 'on' : ''} onClick={() => onChange(pos)}>{pos}</button>
      ))}
    </div>
  )
}

function CompareRow({ players, compare, onCompare, onClear, excludeId }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
      <span className="hint">Compare with</span>
      <PlayerSearch players={players} onSelect={onCompare} placeholder="Search player…" excludeId={excludeId} />
      {compare && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="dot" style={{ background: 'var(--gold)', width: '10px', height: '10px' }} />
          <span style={{ color: 'var(--text)', fontSize: '13px', fontWeight: 700 }}>{compare.web_name}</span>
          <button onClick={onClear} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '17px', lineHeight: 1 }}>×</button>
        </div>
      )}
    </div>
  )
}

// Sized so the chart plus its controls, legend and the selected-player panel
// all fit in a standard viewport without scrolling at 100% zoom.
const CHART_H = { height: 'clamp(220px, 40vh, 380px)' }

// ─── Player detail header (shared by xG + timeline) ─────────────────────────
function PlayerHead({ selected, tiles }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '10px', flexWrap: 'wrap' }}>
      {selected.code && <img src={PHOTO(selected.code)} style={{ height: '46px', objectFit: 'contain' }} onError={e => { e.target.style.display = 'none' }} alt="" />}
      <div style={{ flex: 1, minWidth: '150px' }}>
        <div style={{ fontWeight: 700, fontSize: '17px' }}>{selected.web_name}</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '12.5px' }}>{selected.team_name} · {selected.position} · £{selected.price}m</div>
      </div>
      <div className="tiles">
        {tiles.map(([k, v, color]) => (
          <div key={k} className="tile"><div className="k">{k}</div><div className="v" style={color ? { color } : undefined}>{v}</div></div>
        ))}
      </div>
    </div>
  )
}

// ─── xG vs Goals ─────────────────────────────────────────────────────────────
function XGPanel({ players, selectedPlayer, onSelectPlayer }) {
  const C = useThemeColors()
  const [history, setHistory] = useState([])
  const [compare, setCompare] = useState(null)
  const [position, setPosition] = useState('All')
  const selected = selectedPlayer

  useEffect(() => {
    if (!selected) return
    getPlayerHistory(selected.id).then(res => setHistory(res.data)).catch(() => setHistory([]))
  }, [selected?.id])

  const filtered = players
    .filter(p => position === 'All' || p.position === position)
    .filter(p => p.xg_per90 != null && p.goals_scored != null && p.minutes > 180)
    .map(p => ({ ...p, xg_p90: parseFloat(p.xg_per90 || 0), goals_p90: parseFloat(((p.goals_scored / p.minutes) * 90).toFixed(3)) }))

  const maxVal = Math.max(...filtered.map(p => Math.max(p.xg_p90, p.goals_p90)), 0.5) + 0.2
  const bg = filtered.filter(p => p.id !== selected?.id && p.id !== compare?.id)
  const selDot = filtered.find(p => p.id === selected?.id)
  const cmpDot = filtered.find(p => p.id === compare?.id)

  // Dots are coloured by where a player sits against the xG = Goals line:
  // above it they are outscoring their chances, below it they are wasting them.
  // Selection is shown with a ring rather than a colour, so the colour always
  // means the same thing.
  const PERF_BAND = 0.05
  const perfColor = p => {
    const diff = p.goals_p90 - p.xg_p90
    if (diff > PERF_BAND) return C.accent
    if (diff < -PERF_BAND) return C.danger
    return C.muted
  }

  const data = {
    datasets: [
      { label: 'Players', data: bg.map(p => ({ x: p.xg_p90, y: p.goals_p90, player: p })), backgroundColor: bg.map(p => alpha(perfColor(p), 0.7)), pointRadius: 4, pointHoverRadius: 6 },
      ...(selDot ? [{ label: selected.web_name, data: [{ x: selDot.xg_p90, y: selDot.goals_p90, player: selDot }], backgroundColor: perfColor(selDot), borderColor: C.text, borderWidth: 3, pointRadius: 9, pointHoverRadius: 12 }] : []),
      ...(cmpDot ? [{ label: compare.web_name, data: [{ x: cmpDot.xg_p90, y: cmpDot.goals_p90, player: cmpDot }], backgroundColor: perfColor(cmpDot), borderColor: C.gold, borderWidth: 3, pointRadius: 9, pointHoverRadius: 12 }] : []),
      { label: 'xG = Goals', type: 'line', data: [{ x: 0, y: 0 }, { x: maxVal, y: maxVal }], borderColor: alpha(C.muted, 0.6), borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0, fill: false },
    ]
  }
  const options = {
    responsive: true, maintainAspectRatio: false, animation: false,
    onClick: (e, els) => { if (els.length) { const pt = data.datasets[els[0].datasetIndex].data[els[0].index]; if (pt?.player) onSelectPlayer(pt.player) } },
    plugins: {
      legend: { display: false },
      tooltip: { ...baseTooltip(C), callbacks: { label: ctx => { const p = ctx.raw?.player; if (!p) return ''; const d = (p.goals_p90 - p.xg_p90).toFixed(2); return [`${p.web_name} (${p.team_name})`, `Goals/90 ${p.goals_p90.toFixed(2)} · xG/90 ${p.xg_p90.toFixed(2)}`, `Diff ${parseFloat(d) >= 0 ? '+' : ''}${d}`] } } },
    },
    scales: baseScales(C, 'Expected Goals / 90', 'Actual Goals / 90', { min: 0, max: maxVal }, { min: 0, max: maxVal }),
  }

  const seasonXG = history.reduce((s, h) => s + parseFloat(h.expected_goals || 0), 0)
  const actualGoals = history.reduce((s, h) => s + (h.goals_scored || 0), 0)
  const xgDiff = (actualGoals - seasonXG).toFixed(2)

  return (
    <div>
      <div className="chart-controls">
        <PlayerSearch players={players} onSelect={onSelectPlayer} placeholder="Highlight a player…" />
        <PosFilter value={position} onChange={setPosition} />
        <span className="hint">{filtered.length} players · 180+ mins · click any dot</span>
      </div>
      <div style={CHART_H}><Scatter data={data} options={options} /></div>
      <div className="chart-legend">
        <span><i style={{ background: 'var(--accent)' }} /> Overperforming xG</span>
        <span><i style={{ background: 'var(--text-muted)' }} /> In line</span>
        <span><i style={{ background: 'var(--danger)' }} /> Underperforming xG</span>
        <span><i style={{ background: 'transparent', boxShadow: 'inset 0 0 0 2px var(--text)' }} /> Selected / compare</span>
      </div>

      {selected && (
        <div className="panel panel-pad" style={{ marginTop: '14px' }}>
          <PlayerHead selected={selected} tiles={[
            ['Goals', actualGoals, 'var(--gold)'],
            ['Season xG', seasonXG.toFixed(1), 'var(--info)'],
            ['xG Diff', `${parseFloat(xgDiff) >= 0 ? '+' : ''}${xgDiff}`, parseFloat(xgDiff) >= 0 ? 'var(--accent)' : 'var(--danger)'],
            ['xG/90', parseFloat(selected.xg_per90 || 0).toFixed(2), null],
            ['xA/90', parseFloat(selected.xa_per90 || 0).toFixed(2), null],
          ]} />
          <CompareRow players={players} compare={compare} onCompare={setCompare} onClear={() => setCompare(null)} excludeId={selected.id} />
        </div>
      )}
    </div>
  )
}

// ─── Form Timeline ───────────────────────────────────────────────────────────
function FormTimeline({ players, selectedPlayer, onSelectPlayer }) {
  const C = useThemeColors()
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [compare, setCompare] = useState(null)
  const [compareHistory, setCompareHistory] = useState([])
  const selected = selectedPlayer

  useEffect(() => {
    if (!selected) return
    setLoading(true)
    getPlayerHistory(selected.id).then(res => setHistory(res.data)).catch(() => setHistory([])).finally(() => setLoading(false))
  }, [selected?.id])

  async function selectCompare(player) {
    setCompare(player)
    try { const res = await getPlayerHistory(player.id); setCompareHistory(res.data) } catch { setCompareHistory([]) }
  }

  const played = history.filter(h => (h.minutes || 0) > 0)
  const avgPts = played.length ? (played.reduce((s, h) => s + h.total_points, 0) / played.length).toFixed(1) : '—'
  const bestGW = history.length ? history.reduce((b, h) => h.total_points > b.total_points ? h : b, history[0]) : null

  const data = {
    labels: history.map(h => `GW${h.gameweek}`),
    datasets: [
      { label: selected?.web_name || 'Player', data: history.map(h => h.total_points), borderColor: C.accent, backgroundColor: alpha(C.accent, 0.12), borderWidth: 2.5, pointRadius: 2, pointHoverRadius: 6, pointBackgroundColor: C.accent, fill: true, tension: 0.32 },
      ...(compare && compareHistory.length ? [{ label: compare.web_name, data: history.map(h => { const m = compareHistory.find(c => c.gameweek === h.gameweek); return m ? m.total_points : null }), borderColor: C.gold, backgroundColor: alpha(C.gold, 0.08), borderWidth: 2, borderDash: [5, 3], pointRadius: 2, pointHoverRadius: 5, fill: true, tension: 0.32, spanGaps: false }] : []),
    ]
  }
  const options = {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: {
      legend: { display: !!compare, labels: { color: C.dim, boxWidth: 12, font: { size: 12 } } },
      tooltip: { ...baseTooltip(C), callbacks: { afterBody: items => { const h = history[items[0].dataIndex]; if (!h) return []; const l = []; if (h.minutes !== undefined) l.push(`Minutes ${h.minutes}'`); if (h.goals_scored > 0) l.push(`Goals ${h.goals_scored}`); if (h.assists > 0) l.push(`Assists ${h.assists}`); if (h.bonus > 0) l.push(`Bonus ${h.bonus}`); return l } } },
    },
    scales: baseScales(C, 'Gameweek', null),
  }

  return (
    <div>
      <div className="chart-controls">
        <PlayerSearch players={players} onSelect={onSelectPlayer} placeholder="Search a player…" />
        {selected && <CompareRow players={players} compare={compare} onCompare={selectCompare} onClear={() => { setCompare(null); setCompareHistory([]) }} excludeId={selected.id} />}
      </div>

      {!selected ? (
        <div className="panel" style={{ padding: '48px', textAlign: 'center', borderStyle: 'dashed' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Search for a player to load their gameweek-by-gameweek points.</div>
        </div>
      ) : (
        <>
          <PlayerHead selected={selected} tiles={[
            ['Season', selected.total_points, null],
            ['Avg / GW', avgPts, 'var(--accent)'],
            ['Best', bestGW ? `${bestGW.total_points} (GW${bestGW.gameweek})` : '—', 'var(--gold)'],
            ['Form', selected.form, 'var(--info)'],
            ['xG/90', parseFloat(selected.xg_per90 || 0).toFixed(2), null],
          ]} />
          {loading ? <p className="hint">Loading timeline…</p> : <div style={CHART_H}><Line data={data} options={options} /></div>}
        </>
      )}
    </div>
  )
}

// ─── Price vs Output ─────────────────────────────────────────────────────────
function ValueMap({ players, selectedPlayer, onSelectPlayer }) {
  const C = useThemeColors()
  const [position, setPosition] = useState('All')
  const [compare, setCompare] = useState(null)

  const pool = players
    .filter(p => position === 'All' || p.position === position)
    .filter(p => (p.minutes || 0) >= 180)
    .map(p => ({ ...p, priceNum: parseFloat(p.price || 0), ppgNum: parseFloat(p.points_per_game || 0), valueNum: parseFloat(p.total_points || 0) / Math.max(0.1, parseFloat(p.price || 0)), ownNum: parseFloat(p.selected_by_percent || 0) }))

  const maxPrice = Math.max(...pool.map(p => p.priceNum), 8) + 0.5
  const maxPpg = Math.max(...pool.map(p => p.ppgNum), 6) + 0.6
  const bg = pool.filter(p => p.id !== selectedPlayer?.id && p.id !== compare?.id)
  const selDot = pool.find(p => p.id === selectedPlayer?.id)
  const cmpDot = pool.find(p => p.id === compare?.id)

  const data = {
    datasets: [
      { label: 'Players', data: bg.map(p => ({ x: p.priceNum, y: p.ppgNum, player: p })), pointRadius: ctx => { const p = ctx.raw?.player; return p ? Math.max(3, Math.min(9, p.valueNum * 0.9)) : 4 }, pointHoverRadius: 9, backgroundColor: alpha(C.muted, 0.45), borderColor: alpha(C.muted, 0.25), borderWidth: 1 },
      ...(selDot ? [{ label: selectedPlayer.web_name, data: [{ x: selDot.priceNum, y: selDot.ppgNum, player: selDot }], pointRadius: 11, pointHoverRadius: 13, backgroundColor: C.accent, borderColor: C.surface, borderWidth: 2 }] : []),
      ...(cmpDot ? [{ label: compare.web_name, data: [{ x: cmpDot.priceNum, y: cmpDot.ppgNum, player: cmpDot }], pointRadius: 11, pointHoverRadius: 13, backgroundColor: C.gold, borderColor: C.surface, borderWidth: 2 }] : []),
    ]
  }
  const options = {
    responsive: true, maintainAspectRatio: false, animation: false,
    onClick: (e, els) => { if (els.length) { const pt = data.datasets[els[0].datasetIndex].data[els[0].index]; if (pt?.player) onSelectPlayer(pt.player) } },
    plugins: {
      legend: { display: false },
      tooltip: { ...baseTooltip(C), callbacks: { label: ctx => { const p = ctx.raw?.player; if (!p) return ''; return [`${p.web_name} (${p.team_name})`, `£${p.priceNum.toFixed(1)}m · ${p.ppgNum.toFixed(1)} PPG`, `Value ${p.valueNum.toFixed(2)} pts/£m · ${p.ownNum.toFixed(1)}% owned`] } } },
    },
    scales: baseScales(C, 'Price (£m)', 'Points per Game', { min: 3.5, max: maxPrice }, { min: 0, max: maxPpg }),
  }

  return (
    <div>
      <div className="chart-controls">
        <PlayerSearch players={pool} onSelect={onSelectPlayer} placeholder="Search a player…" />
        <PosFilter value={position} onChange={setPosition} />
        <CompareRow players={pool} compare={compare} onCompare={setCompare} onClear={() => setCompare(null)} excludeId={selectedPlayer?.id ?? null} />
      </div>
      <div style={CHART_H}><Scatter data={data} options={options} /></div>
      <p className="hint" style={{ marginTop: '10px' }}>Bubble size reflects value (total points per £m). Top-left of the cloud = cheap and productive. Click a dot to inspect.</p>
    </div>
  )
}

// ─── Differential Radar — form-vs-ownership quadrant map ─────────────────────
function DifferentialQuadrant({ players, selectedPlayer, onSelectPlayer }) {
  const C = useThemeColors()
  const [position, setPosition] = useState('All')
  const [compare, setCompare] = useState(null)

  const pool = players
    .filter(p => position === 'All' || p.position === position)
    .filter(p => (p.minutes || 0) >= 270)
    .map(p => ({ ...p, ownNum: parseFloat(p.selected_by_percent || 0), ppgNum: parseFloat(p.points_per_game || 0) }))
    .filter(p => p.ownNum <= 60)

  const maxOwn = Math.max(...pool.map(p => p.ownNum), 20) + 3
  const maxPpg = Math.max(...pool.map(p => p.ppgNum), 5) + 0.6
  const ppgAvg = pool.length ? pool.reduce((s, p) => s + p.ppgNum, 0) / pool.length : 0
  const ownDiv = 15
  const isDiff = p => p.ownNum <= ownDiv && p.ppgNum >= ppgAvg

  const selId = selectedPlayer?.id, cmpId = compare?.id
  const bg = pool.filter(p => p.id !== selId && p.id !== cmpId)
  const selDot = pool.find(p => p.id === selId)
  const cmpDot = pool.find(p => p.id === cmpId)

  const data = {
    datasets: [
      // quadrant dividers
      { type: 'line', label: '_v', data: [{ x: ownDiv, y: 0 }, { x: ownDiv, y: maxPpg }], borderColor: alpha(C.muted, 0.5), borderDash: [5, 5], borderWidth: 1, pointRadius: 0, fill: false },
      { type: 'line', label: '_h', data: [{ x: 0, y: ppgAvg }, { x: maxOwn, y: ppgAvg }], borderColor: alpha(C.muted, 0.5), borderDash: [5, 5], borderWidth: 1, pointRadius: 0, fill: false },
      { label: 'Players', data: bg.map(p => ({ x: p.ownNum, y: p.ppgNum, player: p })), backgroundColor: bg.map(p => isDiff(p) ? alpha(C.accent, 0.8) : alpha(C.muted, 0.4)), pointRadius: bg.map(p => isDiff(p) ? 6 : 4), pointHoverRadius: 9, borderColor: C.surface, borderWidth: 1 },
      ...(selDot ? [{ label: selectedPlayer.web_name, data: [{ x: selDot.ownNum, y: selDot.ppgNum, player: selDot }], backgroundColor: C.accent, borderColor: C.surface, borderWidth: 2, pointRadius: 11, pointHoverRadius: 13 }] : []),
      ...(cmpDot ? [{ label: compare.web_name, data: [{ x: cmpDot.ownNum, y: cmpDot.ppgNum, player: cmpDot }], backgroundColor: C.gold, borderColor: C.surface, borderWidth: 2, pointRadius: 11, pointHoverRadius: 13 }] : []),
    ]
  }
  const options = {
    responsive: true, maintainAspectRatio: false, animation: false,
    onClick: (e, els) => { if (els.length) { const pt = data.datasets[els[0].datasetIndex].data[els[0].index]; if (pt?.player) onSelectPlayer(pt.player) } },
    plugins: {
      legend: { display: false },
      tooltip: { ...baseTooltip(C), filter: item => !!item.raw?.player, callbacks: { label: ctx => { const p = ctx.raw?.player; if (!p) return ''; return [`${p.web_name} (${p.team_name})`, `${p.ppgNum.toFixed(1)} PPG · ${p.ownNum.toFixed(1)}% owned`, isDiff(p) ? 'Differential — high output, low ownership' : ''] } } },
    },
    scales: baseScales(C, 'Ownership %', 'Points per Game', { min: 0, max: maxOwn }, { min: 0, max: maxPpg }),
  }

  return (
    <div>
      <div className="chart-controls">
        <PlayerSearch players={pool} onSelect={onSelectPlayer} placeholder="Search a player…" />
        <PosFilter value={position} onChange={setPosition} />
        <CompareRow players={pool} compare={compare} onCompare={setCompare} onClear={() => setCompare(null)} excludeId={selectedPlayer?.id ?? null} />
      </div>
      <div style={CHART_H}><Scatter data={data} options={options} /></div>
      <div className="chart-legend">
        <span><i style={{ background: 'var(--accent)' }} /> Differential (top-left: high output, ≤{ownDiv}% owned)</span>
        <span><i style={{ background: 'var(--text-muted)' }} /> The pack</span>
      </div>
    </div>
  )
}

// ─── Main Analytics Page ─────────────────────────────────────────────────────
const TABS = [
  { key: 'xg',       label: 'xG vs Goals',    icon: <><circle cx="12" cy="12" r="8.5" /><path d="M4 12h16" strokeLinecap="round" /></> },
  { key: 'timeline', label: 'Form Timeline',  icon: <path d="M4 15l4-5 4 3 5-7" strokeLinecap="round" strokeLinejoin="round" /> },
  { key: 'value',    label: 'Price vs Output',icon: <><path d="M4 20V5M4 20h16" strokeLinecap="round" /><circle cx="9" cy="13" r="1.6" /><circle cx="14" cy="9" r="1.6" /><circle cx="18" cy="11" r="1.6" /></> },
  { key: 'radar',    label: 'Differential Radar', icon: <><circle cx="12" cy="12" r="8.5" /><path d="M12 12l4-2" strokeLinecap="round" /></> },
]

export default function Analytics({ initialPlayer = null }) {
  const { players, loading } = usePlayers()
  const [tab, setTab] = useState('xg')
  const [selectedPlayer, setSelectedPlayer] = useState(initialPlayer)

  useEffect(() => { if (initialPlayer) { setSelectedPlayer(initialPlayer); setTab('timeline') } }, [initialPlayer])

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Analytics</h1>
        <p className="page-sub">Where players sit versus their peers — click any point to inspect.</p>
      </div>

      <div className="tabs" style={{ marginBottom: '14px' }}>
        {TABS.map(t => (
          <button key={t.key} className={`tab${tab === t.key ? ' on' : ''}`} onClick={() => setTab(t.key)}>
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7">{t.icon}</svg>{t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="panel panel-pad" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '48px' }}>Loading player data…</div>
      ) : (
        <div className="chart-panel">
          {tab === 'xg'       && <XGPanel players={players} selectedPlayer={selectedPlayer} onSelectPlayer={setSelectedPlayer} />}
          {tab === 'timeline' && <FormTimeline players={players} selectedPlayer={selectedPlayer} onSelectPlayer={setSelectedPlayer} />}
          {tab === 'value'    && <ValueMap players={players} selectedPlayer={selectedPlayer} onSelectPlayer={setSelectedPlayer} />}
          {tab === 'radar'    && <DifferentialQuadrant players={players} selectedPlayer={selectedPlayer} onSelectPlayer={setSelectedPlayer} />}
        </div>
      )}
    </div>
  )
}
