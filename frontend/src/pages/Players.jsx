import { useState, useEffect } from 'react'
import { getPlayers } from '../api'

const POSITIONS = ['All', 'GKP', 'DEF', 'MID', 'FWD']

function valueRating(player, allPlayers) {
  const ptsPer    = player.points_per_game / player.price
  const ownership = parseFloat(player.selected_by_percent || 0)
  const form      = parseFloat(player.form || 0)

  const samePosition = allPlayers.filter(p => p.position === player.position)
  const sorted = [...samePosition].sort((a, b) =>
    parseFloat(b.selected_by_percent) - parseFloat(a.selected_by_percent)
  )
  const rank = sorted.findIndex(p => p.id === player.id)
  if (rank !== -1 && rank < 3) return { label: '📊 Reliable', color: '#00b2ff' }

  if (form < 2) return { label: '🚫 Avoid', color: '#ff4444' }
  if (player.price >= 8.0 && form < 4) return { label: '🚫 Avoid', color: '#ff4444' }
  if (ownership >= 30 && ptsPer >= 0.55 && form >= 4) return { label: '📊 Reliable', color: '#00b2ff' }
  if (ptsPer >= 0.75 && form >= 4.2) return { label: '⭐ Elite Value', color: '#00ff87' }
  if (ptsPer >= 0.55 && form >= 3.2) return { label: '✅ Good Value', color: '#7fff00' }
  if (ptsPer >= 0.35) return { label: '📉 Poor Value', color: '#ffd700' }
  return { label: '🚫 Avoid', color: '#ff4444' }
}

function formEmoji(form) {
  const f = parseFloat(form || 0)
  if (f >= 6) return { label: '🔥 On Fire', color: '#00ff87' }
  if (f >= 4) return { label: '😁 Good',    color: '#7fff00' }
  if (f >= 2) return { label: '❄️ Cold',    color: '#00b2ff' }
  return           { label: '💀 Terrible',  color: '#ff4444' }
}

function PlayerCard({ p, allPlayers, onAnalytics }) {
  const val  = valueRating(p, allPlayers)
  const form = formEmoji(p.form)
  const photoUrl = p.code
    ? `https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.code}.png`
    : null

  const posColors = { GKP: '#f5a623', DEF: '#00b2ff', MID: '#00ff87', FWD: '#ff4444' }

  return (
    <div style={{
      background: '#1a1f2e', borderRadius: '12px', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', transition: 'transform 0.15s, box-shadow 0.15s',
      border: '1px solid #2a2f3e', cursor: 'default'
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,255,135,0.15)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' }}>

      <div style={{
        background: 'linear-gradient(135deg, #0e1117 0%, #1a2744 100%)',
        display: 'flex', justifyContent: 'center', alignItems: 'flex-end',
        height: '140px', position: 'relative', overflow: 'hidden'
      }}>
        <div style={{ position: 'absolute', top: '10px', left: '10px', background: posColors[p.position] || '#aaa', color: '#000', fontSize: '11px', fontWeight: 'bold', padding: '3px 8px', borderRadius: '4px' }}>{p.position}</div>
        <div style={{ position: 'absolute', top: '10px', right: '10px', background: '#00ff87', color: '#000', fontSize: '12px', fontWeight: 'bold', padding: '3px 8px', borderRadius: '4px' }}>£{p.price}m</div>
        {photoUrl ? (
          <img src={photoUrl} alt={p.web_name} style={{ height: '130px', objectFit: 'contain' }} onError={e => { e.target.style.display = 'none' }} />
        ) : (
          <div style={{ fontSize: '48px', paddingBottom: '8px' }}>👤</div>
        )}
      </div>

      <div style={{ padding: '12px 14px', flex: 1 }}>
        <div style={{ fontWeight: 'bold', fontSize: '15px', marginBottom: '2px', color: '#fff' }}>{p.web_name}</div>
        <div style={{ color: '#aaa', fontSize: '12px', marginBottom: '10px' }}>{p.team_name}</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '10px' }}>
          {[['Pts', p.total_points], ['Form', p.form], ['PPG', p.points_per_game]].map(([label, val]) => (
            <div key={label} style={{ background: '#0e1117', borderRadius: '6px', padding: '6px', textAlign: 'center' }}>
              <div style={{ color: '#aaa', fontSize: '10px', marginBottom: '2px' }}>{label}</div>
              <div style={{ color: '#fff', fontWeight: 'bold', fontSize: '14px' }}>{val}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
          <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', background: '#0e1117', color: val.color, fontWeight: 'bold' }}>{val.label}</span>
          <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', background: '#0e1117', color: p.status !== 'a' ? '#ff8800' : form.color, fontWeight: 'bold' }}>
            {p.status !== 'a' ? '🤕 Injured' : form.label}
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
          <div style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold' }}>{p.selected_by_percent}% selected</div>
          <button
            onClick={() => onAnalytics(p)}
            title="View in Analytics"
            style={{
              background: 'transparent', border: '1px solid #2a2f3e', borderRadius: '5px',
              color: '#aaa', cursor: 'pointer', padding: '3px 8px', fontSize: '11px',
              transition: 'all 0.15s'
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#00ff87'; e.currentTarget.style.color = '#00ff87' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2f3e'; e.currentTarget.style.color = '#aaa' }}>
            📊 Analyse
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Players({ onAnalytics }) {
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [position, setPosition] = useState('All')
  const [sortBy, setSortBy] = useState('total_points')
  const [search, setSearch] = useState('')
  const [view, setView] = useState('cards')

  useEffect(() => {
    setLoading(true)
    getPlayers(position === 'All' ? null : position)
      .then(res => setPlayers(res.data))
      .finally(() => setLoading(false))
  }, [position])

  const filtered = players
    .filter(p => p.web_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b[sortBy] - a[sortBy])
    .slice(0, 100)

  return (
    <div>
      <h2 style={{ marginBottom: '16px', color: '#00ff87' }}>Player Stats & Prices</h2>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Search player..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #2a2f3e', background: '#1a1f2e', color: '#fff', width: '200px' }}
        />
        {POSITIONS.map(pos => (
          <button key={pos} onClick={() => setPosition(pos)}
            style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid #00ff87', background: position === pos ? '#00ff87' : 'transparent', color: position === pos ? '#000' : '#fff', cursor: 'pointer', fontWeight: position === pos ? 'bold' : 'normal' }}>
            {pos}
          </button>
        ))}
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #2a2f3e', background: '#1a1f2e', color: '#fff', marginLeft: 'auto' }}>
          <option value="total_points">Sort: Total Points</option>
          <option value="form">Sort: Form</option>
          <option value="price">Sort: Price</option>
          <option value="points_per_game">Sort: PPG</option>
          <option value="selected_by_percent">Sort: Ownership</option>
        </select>
        <div style={{ display: 'flex', gap: '4px' }}>
          {['cards', 'table'].map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #2a2f3e', background: view === v ? '#2a2f3e' : 'transparent', color: '#fff', cursor: 'pointer' }}>
              {v === 'cards' ? '⊞' : '☰'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p style={{ color: '#aaa' }}>Loading players...</p>
      ) : view === 'cards' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
            {filtered.map(p => <PlayerCard key={p.id} p={p} allPlayers={players} onAnalytics={onAnalytics} />)}
          </div>
          <p style={{ color: '#aaa', marginTop: '16px', fontSize: '13px' }}>{filtered.length} players shown</p>
        </>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#1a1f2e', borderRadius: '8px', overflow: 'hidden' }}>
            <thead style={{ background: '#0e1117' }}>
              <tr>
                {['Player', 'Team', 'Pos', 'Price', 'Pts', 'Form', 'PPG', 'Value', 'Form Rating', 'Selected %', ''].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '1px solid #2a2f3e', color: '#aaa', fontSize: '13px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const val  = valueRating(p, players)
                const form = formEmoji(p.form)
                return (
                  <tr key={p.id}
                    onMouseEnter={e => e.currentTarget.style.background = '#222736'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #1a1f2e', fontWeight: 'bold' }}>
                      {p.code && <img src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.code}.png`}
                        style={{ width: '24px', height: '30px', objectFit: 'contain', marginRight: '8px', verticalAlign: 'middle' }}
                        onError={e => e.target.style.display = 'none'} />}
                      {p.web_name}
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #1a1f2e', color: '#aaa' }}>{p.team_name}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #1a1f2e' }}><span style={{ background: '#2a2f3e', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>{p.position}</span></td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #1a1f2e', color: '#00ff87', fontWeight: 'bold' }}>£{p.price}m</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #1a1f2e', fontWeight: 'bold' }}>{p.total_points}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #1a1f2e' }}>{p.form}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #1a1f2e' }}>{p.points_per_game}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #1a1f2e', color: val.color, fontWeight: 'bold' }}>{val.label}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #1a1f2e', color: p.status !== 'a' ? '#ff8800' : form.color, fontWeight: 'bold' }}>
                      {p.status !== 'a' ? '🤕 Injured' : form.label}
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #1a1f2e', color: '#fff', fontWeight: 'bold' }}>{p.selected_by_percent}%</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #1a1f2e' }}>
                      <button onClick={() => onAnalytics(p)}
                        style={{ background: 'transparent', border: '1px solid #2a2f3e', borderRadius: '5px', color: '#aaa', cursor: 'pointer', padding: '3px 10px', fontSize: '11px', transition: 'all 0.15s' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = '#00ff87'; e.currentTarget.style.color = '#00ff87' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2f3e'; e.currentTarget.style.color = '#aaa' }}>
                        📊 Analyse
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p style={{ color: '#aaa', marginTop: '12px', fontSize: '13px' }}>{filtered.length} players shown</p>
        </div>
      )}
    </div>
  )
} 