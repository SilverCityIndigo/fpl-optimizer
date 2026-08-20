// Expected minutes, turned into something a manager can act on.
//
// A projection is only as good as the assumption that the player is on the
// pitch. Two players can project similarly while one starts every week and the
// other is fourth choice — and the second is a wasted squad spot rather than a
// bargain. The backend estimates expected minutes from starts and minutes; this
// turns that number into a label and a colour.
//
// Thresholds mirror minutes_risk_label() in backend/services/optimizer.py.

export const RISK = {
  Nailed: { color: 'var(--accent)', blurb: 'Starts almost every week' },
  Rotation: { color: 'var(--gold)', blurb: 'Starts often but gets rotated' },
  Fringe: { color: '#e0872e', blurb: 'In and out of the side' },
  Bench: { color: 'var(--danger)', blurb: 'Rarely starts — likely a blank' },
}

export function minutesRisk(expectedMinutes) {
  const m = Number(expectedMinutes)
  if (!Number.isFinite(m)) return null
  if (m >= 70) return 'Nailed'
  if (m >= 45) return 'Rotation'
  if (m >= 20) return 'Fringe'
  return 'Bench'
}

export function riskMeta(expectedMinutes) {
  const label = minutesRisk(expectedMinutes)
  return label ? { label, ...RISK[label] } : null
}

export default minutesRisk
