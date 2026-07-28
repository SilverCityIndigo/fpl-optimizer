import { useEffect, useState } from 'react'
import { getPlayers } from './api'

// Shared, cached access to the full player list.
//
// The list is ~38KB gzipped and every page wants the same copy, but the API is
// hosted on an instance that sleeps when idle — so an uncached request can cost
// several seconds while the backend wakes up. Three things fix that:
//
//   1. localStorage cache — a returning visitor renders from disk immediately,
//      then we refresh in the background (stale-while-revalidate).
//   2. Module-level memory cache — navigating between pages reuses the copy we
//      already have instead of refetching.
//   3. In-flight de-duplication — pages that mount together (or a fast
//      navigation) share one request rather than firing several.
//
// Cached data is only ever a render-ahead: a fresh copy always replaces it once
// the network responds, so the UI cannot get stuck on stale numbers.

const KEY = 'xgfiles:players:v1'
// The backend syncs every couple of hours, so anything older is worth
// refreshing on mount. Newer than this and we serve cache without a request.
const REVALIDATE_AFTER = 10 * 60 * 1000

let memory = null      // { savedAt, data }
let inflight = null    // Promise, shared by concurrent callers

function readCache() {
  if (memory) return memory
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.data) || parsed.data.length === 0) return null
    memory = parsed
    return memory
  } catch {
    return null // corrupt/unavailable storage is just a cache miss
  }
}

function writeCache(data) {
  memory = { savedAt: Date.now(), data }
  try {
    localStorage.setItem(KEY, JSON.stringify(memory))
  } catch {
    /* private mode or quota exceeded — memory cache still applies */
  }
}

function fetchPlayers() {
  if (!inflight) {
    inflight = getPlayers()
      .then(res => {
        const data = res.data
        if (Array.isArray(data) && data.length) writeCache(data)
        return data
      })
      .finally(() => { inflight = null })
  }
  return inflight
}

/**
 * Returns the full player list, served from cache first when one exists.
 * `loading` is only true when there is nothing at all to render yet.
 */
export function usePlayers() {
  const [cached] = useState(readCache)
  const [players, setPlayers] = useState(() => cached?.data ?? [])
  const [loading, setLoading] = useState(() => !cached)

  useEffect(() => {
    let alive = true
    const fresh = cached && Date.now() - cached.savedAt < REVALIDATE_AFTER
    if (fresh) return // cache is recent enough; skip the network entirely

    fetchPlayers()
      .then(data => { if (alive && Array.isArray(data)) setPlayers(data) })
      .catch(() => { /* keep showing cache if the refresh fails */ })
      .finally(() => { if (alive) setLoading(false) })

    return () => { alive = false }
  }, [])

  return { players, loading }
}

export default usePlayers
