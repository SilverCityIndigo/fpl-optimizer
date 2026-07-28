import { useState, useEffect } from 'react'
import { getCurrentGameweek } from '../api'
import { PHOTO } from '../playerPhoto'
import { usePlayers } from '../usePlayers'

// Where each sidebar destination goes, in the manager's own order of operations:
// look at the players, move them, pick an armband, time the chips.
const SECTIONS = [
  { key: 'players',       label: 'Players',   blurb: 'Form, price and expected output for every player in the game.',
    icon: <><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></> },
  { key: 'transfers',     label: 'Transfers', blurb: 'Paste a team ID, get ranked moves with the hit maths done.',
    icon: <path d="M4 8h13l-3-3M20 16H7l3 3" /> },
  { key: 'captain',       label: 'Captain',   blurb: 'Armband candidates ranked on projection and fixture.',
    icon: <path d="M13 2 4.5 13H11l-1 9 8.5-11H12z" /> },
  { key: 'chips',         label: 'Chips',     blurb: 'When the wildcard, bench boost and triple captain pay.',
    icon: <><circle cx="12" cy="12" r="8.4" /><circle cx="12" cy="12" r="3.4" /><path d="M12 3.6v3M12 17.4v3M3.6 12h3M17.4 12h3" /></> },
  { key: 'differentials', label: 'Scout',     blurb: 'Low-owned players whose numbers outrun their ownership.',
    icon: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.6-3.6" /></> },
  { key: 'pricechanges',  label: 'Prices',    blurb: 'Overnight risers and fallers, and who sits on the edge.',
    icon: <><path d="M20 12a8 8 0 1 1-8-8" /><path d="M12 12l5-3" /><path d="M12 4a8 8 0 0 1 8 8h-8z" /></> },
  { key: 'analytics',     label: 'Analytics', blurb: 'Per-player xG timelines and over/underperformance.',
    icon: <><path d="M4 20V4M4 20h16" /><rect x="7.5" y="12" width="3" height="5" /><rect x="13" y="8" width="3" height="9" /></> },
]

// Decorative shot map: penalty area seen from above, with attempts sized by xG.
// Hand-placed rather than random so the cluster reads like a real striker's season.
const POS_COLORS = { GKP: 'var(--gold)', DEF: 'var(--info)', MID: 'var(--accent)', FWD: 'var(--danger)' }

const SHOTS = [
  { x: 150, y: 96,  r: 13 }, { x: 128, y: 118, r: 9 },  { x: 173, y: 112, r: 8 },
  { x: 150, y: 138, r: 6.5 }, { x: 106, y: 92, r: 6 },  { x: 196, y: 88,  r: 5.5 },
  { x: 138, y: 62,  r: 4.5 }, { x: 168, y: 55, r: 4 },  { x: 88,  y: 132, r: 3.5 },
  { x: 214, y: 128, r: 3 },   { x: 150, y: 28, r: 3 },  { x: 118, y: 32,  r: 2.5 },
]

function ShotMap() {
  return (
    <svg className="home-shotmap" viewBox="0 0 300 200" fill="none" aria-hidden="true">
      <g stroke="var(--goal)" strokeWidth="1.3" opacity="0.5">
        <path d="M18 200V52h264v148" />
        <path d="M92 200v-64h116v64" />
        <path d="M150 200v-4" />
        <path d="M110 200a44 44 0 0 0 80 0" />
      </g>
      <circle cx="150" cy="174" r="2.4" fill="var(--goal)" opacity="0.5" />
      {SHOTS.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r}
          fill="var(--accent)" fillOpacity={0.06 + s.r / 90}
          stroke="var(--accent)" strokeWidth="1" strokeOpacity="0.5" />
      ))}
    </svg>
  )
}

function deadlineParts(iso) {
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return null
  const diff = when - Date.now()
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor(diff / 3600000) % 24
  const mins = Math.floor(diff / 60000) % 60
  return {
    stamp: when.toLocaleString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }),
    countdown: diff <= 0 ? 'Deadline passed'
      : days > 0 ? `${days}d ${hours}h away`
      : hours > 0 ? `${hours}h ${mins}m away`
      : `${mins}m away`,
    urgent: diff > 0 && diff < 86400000,
  }
}

function TopPick({ player, onAnalytics }) {
  const [imgOk, setImgOk] = useState(true)
  return (
    <button className="top-row" onClick={() => onAnalytics(player)} title={`Analyse ${player.web_name}`}>
      <span className="top-pos" style={{ color: POS_COLORS[player.position] }}>{player.position}</span>
      <span className="top-face">
        {imgOk
          ? <img src={PHOTO(player.code)} alt="" onError={() => setImgOk(false)} />
          : <span className="top-face-blank" />}
      </span>
      <span className="top-id">
        <b>{player.web_name}</b>
        <span className="top-meta">{player.team_name} · £{player.price.toFixed(1)}m</span>
      </span>
      <span className="top-proj">{player.projected_points.toFixed(1)}</span>
    </button>
  )
}

export default function Home({ onNavigate, onAnalytics }) {
  const [gw, setGw] = useState(null)
  const { players: playerList, loading: playersLoading } = usePlayers()
  // Preserve the original null-until-loaded contract used by the UI below.
  const players = playersLoading && playerList.length === 0 ? null : playerList
  const [tick, setTick] = useState(0)

  useEffect(() => {
    getCurrentGameweek().then(r => { if (!r.data?.error) setGw(r.data) }).catch(() => {})
  }, [])

  // Keep the countdown honest without re-rendering the whole page constantly.
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60000)
    return () => clearInterval(t)
  }, [])

  const deadline = gw?.deadline_time ? deadlineParts(gw.deadline_time) : null
  void tick

  // Two per position rather than a flat top 8: keepers carry the highest floor in the
  // model, so an unsplit list is just six goalkeepers and tells a manager nothing.
  const top = players
    ? Object.keys(POS_COLORS).flatMap(pos =>
        players
          .filter(p => p.position === pos && p.status === 'a' && p.projected_points > 0)
          .sort((a, b) => b.projected_points - a.projected_points)
          .slice(0, 2)
      )
    : null

  const updated = players?.[0]?.projected_updated_at
  const updatedLabel = updated
    ? new Date(updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : '—'

  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-hero-copy">
          <div className="eyebrow">Season 2026/27</div>
          <h1 className="home-title">
            Judge your squad on expected goals,<br />not on last week&rsquo;s luck.
          </h1>
          <p className="home-lede">
            Every Premier League player tracked on xG, xA and minutes. The projections rebuild
            after each round and feed the transfer, captain and chip tools directly &mdash;
            so a good week and a good process stay two different things.
          </p>
          <div className="home-cta">
            <button className="btn-3d" onClick={() => onNavigate('players')}>
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.6-3.6" />
              </svg>
              Browse the player database
            </button>
            <button className="home-cta-alt" onClick={() => onNavigate('transfers')}>
              Analyse my team
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h13M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>

        <aside className="home-status">
          <ShotMap />
          <div className="home-status-body">
            <div className="home-status-k">{gw?.preseason ? 'Season opens' : 'Next deadline'}</div>
            <div className="home-status-gw">{gw ? gw.name : 'Loading'}</div>
            {deadline && (
              <>
                <div className="home-status-stamp">{deadline.stamp}</div>
                <div className={`home-status-count${deadline.urgent ? ' urgent' : ''}`}>{deadline.countdown}</div>
              </>
            )}
            <div className="home-status-facts">
              <span><b>{players ? players.length : '—'}</b> players tracked</span>
              <span>model rebuilt <b>{updatedLabel}</b></span>
            </div>
          </div>
        </aside>
      </section>

      <div className="home-cols">
        <section className="home-index">
          <div className="home-sec-head">
            <h2 className="section-title">Where to start</h2>
            <span className="hint">Seven views over the same dataset</span>
          </div>
          <div className="home-index-grid">
            {SECTIONS.map(s => (
              <button key={s.key} className="home-dest" onClick={() => onNavigate(s.key)}>
                <span className="home-dest-icon">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{s.icon}</svg>
                </span>
                <span className="home-dest-txt">
                  <b>{s.label}</b>
                  <span>{s.blurb}</span>
                </span>
                <svg className="home-dest-arrow" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            ))}
          </div>
        </section>

        <section className="home-top">
          <div className="home-sec-head">
            <h2 className="section-title">Highest projected</h2>
            <span className="hint">pts per GW</span>
          </div>
          <div className="home-top-list">
            {!top && [...Array(8)].map((_, i) => <div key={i} className="top-row skeleton" />)}
            {top?.map(p => <TopPick key={p.id} player={p} onAnalytics={onAnalytics} />)}
            {top?.length === 0 && <p className="hint">Projections unavailable right now.</p>}
          </div>
          <p className="home-top-foot">
            Top two per position, built from last season&rsquo;s per-90 output, minutes
            and upcoming fixture difficulty.
          </p>
        </section>
      </div>
    </div>
  )
}
