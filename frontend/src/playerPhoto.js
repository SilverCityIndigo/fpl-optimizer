// Player headshot URLs.
//
// FPL serves headshots from two asset namespaces, and the difference matters:
//
//   legacy:  /premierleague/photos/players/110x140/p{code}.png
//   current: /premierleague25/photos/players/110x140/{code}.png   <- note: no "p"
//
// The legacy namespace is frozen — Isak's file there is dated Aug 2024 and
// still shows him in a Newcastle shirt long after his move, and recent
// signings 404 outright. The current namespace is the one the official FPL
// site uses and is kept up to date (Isak Sep 2025, Semenyo Feb 2026).
//
// Measured over a 70-player spread: current 60 hits vs legacy 49, with zero
// players present in legacy but missing from current — so this is a strict
// improvement, not a trade-off. Players missing from both simply have no
// headshot uploaded yet; call sites already handle that via onError.
const CURRENT = 'https://resources.premierleague.com/premierleague25/photos/players/110x140'
const LEGACY = 'https://resources.premierleague.com/premierleague/photos/players/110x140'

export const PHOTO = code => `${CURRENT}/${code}.png`

export const PHOTO_LEGACY = code => `${LEGACY}/p${code}.png`

export default PHOTO
