import { useCallback, useRef, useState } from 'react'
import { fetchFountains } from '../services/overpass.js'

/**
 * @typedef {import('../services/overpass.js').Fountain} Fountain
 */

/**
 * @typedef {Object} FountainsState
 * @property {Fountain[]} fountains - The fountains for the last searched area.
 * @property {boolean} loading - True while a search is in flight.
 * @property {string|null} error - Human-readable error, if any.
 * @property {(bbox: [number, number, number, number]) => Promise<void>} search
 *   - Fetch fountains for the given `[south, west, north, east]` bounding box.
 */

/**
 * React hook that owns the fountain dataset and the request lifecycle.
 *
 * Concurrent searches are coalesced: starting a new search aborts the previous
 * in-flight request so the UI always reflects the most recent query.
 *
 * @returns {FountainsState}
 */
export function useFountains() {
  const [fountains, setFountains] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const search = useCallback(async (bbox) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)
    try {
      const results = await fetchFountains(bbox, controller.signal)
      setFountains(results)
    } catch (err) {
      if (err.name === 'AbortError') return // superseded by a newer search
      setError(err.message)
    } finally {
      // Only clear loading if this request is still the current one.
      if (abortRef.current === controller) setLoading(false)
    }
  }, [])

  return { fountains, loading, error, search }
}
