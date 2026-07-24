import { useCallback, useEffect, useRef, useState } from 'react'
import { describeFailure, fetchFountains, MAX_FOUNTAINS } from '../services/overpass.js'
import { isAbortError } from '../services/http.js'
import { backoffMs, planSearch } from '../utils/searchPlan.js'

/**
 * @typedef {import('../services/overpass.js').Fountain} Fountain
 */

/**
 * @typedef {Object} FountainsState
 * @property {Fountain[]} fountains - Fountains for the last successful search.
 * @property {boolean} loading - True while a search is in flight.
 * @property {string|null} error - Human-readable failure, if any.
 * @property {string|null} notice - Non-blocking information (zoom in, partial
 *   results, …). Never an error.
 * @property {boolean} hasSearched - True once a search has completed at least once.
 * @property {(bbox: number[], options?: { force?: boolean }) => void} search
 *   - Request fountains for a `[south, west, north, east]` box.
 * @property {() => void} retry - Re-run the last request, bypassing all caches.
 */

/**
 * Do two result sets describe the same fountains?
 *
 * Re-using the previous array when nothing changed keeps React from tearing
 * down and rebuilding every marker, which is what used to make the map flicker
 * (and close any open popup) each time a pan triggered a search.
 *
 * @param {Fountain[]} a
 * @param {Fountain[]} b
 * @returns {boolean}
 */
function sameFountains(a, b) {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id) return false
  }
  return true
}

/**
 * React hook owning the fountain dataset and the whole request lifecycle.
 *
 * Stability rules, in order of importance:
 *
 *  1. **Only one search matters.** Every request carries a token; a response
 *     whose token is stale is discarded, so a slow answer can never overwrite a
 *     newer one (the classic "the map shows the previous city" bug).
 *  2. **Don't ask twice.** A request whose area is already covered by a recent
 *     successful search is skipped entirely — panning a few streets no longer
 *     hammers Overpass, which is what triggered rate-limit failures.
 *  3. **Don't ask for the impossible.** Oversized areas produce a friendly
 *     notice instead of a doomed query.
 *  4. **Never lose good data.** A failed search keeps the fountains already on
 *     screen and surfaces a retryable error.
 *  5. **Back off after a failure.** Automatic searches pause, with exponential
 *     backoff, while the service is failing — the opposite of the retry storm
 *     that used to keep the app stuck on "servers busy".
 *
 * Rules 2, 3 and 5 live in {@link planSearch}, a pure function, so they can be
 * reasoned about and tested on their own.
 *
 * @returns {FountainsState}
 */
export function useFountains() {
  const [fountains, setFountains] = useState(/** @type {Fountain[]} */ ([]))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(/** @type {string|null} */ (null))
  /** Notice describing the data on screen (truncated, partial). */
  const [resultNotice, setResultNotice] = useState(
    /** @type {string|null} */ (null),
  )
  /** True while the visible area is too large to be worth querying. */
  const [areaTooLarge, setAreaTooLarge] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  const abortRef = useRef(/** @type {AbortController|null} */ (null))
  /** Monotonic id of the most recent request; older responses are ignored. */
  const tokenRef = useRef(0)
  /** Area already covered by a successful search, and when. */
  const coveredRef = useRef(
    /** @type {{ bbox: number[], at: number }|null} */ (null),
  )
  /** Last box actually sent to the network, for {@link retry}. */
  const lastQueryRef = useRef(/** @type {number[]|null} */ (null))
  /** Box of the request currently in flight, if any. */
  const inflightBoxRef = useRef(/** @type {number[]|null} */ (null))
  /** Consecutive failures, and the timestamp until which we stay quiet. */
  const failuresRef = useRef(0)
  const quietUntilRef = useRef(0)
  /** Guards against setting state after unmount. */
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const run = useCallback(async (queryBbox, force) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const token = (tokenRef.current += 1)
    lastQueryRef.current = queryBbox
    inflightBoxRef.current = queryBbox

    setLoading(true)
    setError(null)

    try {
      const result = await fetchFountains(queryBbox, {
        signal: controller.signal,
        force,
      })
      if (!mountedRef.current || token !== tokenRef.current) return

      setFountains((previous) =>
        sameFountains(previous, result.fountains) ? previous : result.fountains,
      )
      coveredRef.current = { bbox: queryBbox, at: Date.now() }
      failuresRef.current = 0
      quietUntilRef.current = 0
      setHasSearched(true)
      setResultNotice(
        result.truncated
          ? `Showing the ${MAX_FOUNTAINS} closest fountains — zoom in for the rest.`
          : result.partial
            ? 'The server returned partial results for this area.'
            : null,
      )
    } catch (err) {
      // A superseded or cancelled request must stay completely silent.
      if (isAbortError(err)) return
      if (!mountedRef.current || token !== tokenRef.current) return

      // Stop trying for a while: repeatedly re-querying a service that just
      // said "too many requests" is what keeps it saying that.
      failuresRef.current += 1
      quietUntilRef.current = Date.now() + backoffMs(failuresRef.current)

      // Keep whatever is on screen; the user can retry.
      setError(describeFailure(err))
    } finally {
      if (token === tokenRef.current) {
        inflightBoxRef.current = null
        if (mountedRef.current) setLoading(false)
      }
    }
  }, [])

  /**
   * Request fountains for a bounding box. Cheap to call on every map move:
   * invalid, oversized and already-covered boxes are filtered out here.
   */
  const search = useCallback(
    (bbox, { force = false } = {}) => {
      const plan = planSearch({
        bbox,
        covered: coveredRef.current,
        inflight: inflightBoxRef.current,
        quietUntil: quietUntilRef.current,
        force,
      })

      setAreaTooLarge(plan.action === 'too-large')
      // Every skip keeps the current result notice: it still describes what is
      // on screen, and only a new result should replace it.
      if (plan.action !== 'search') return

      run(plan.queryBbox, force)
    },
    [run],
  )

  /**
   * Re-run the last query, ignoring the coverage rule, the failure backoff and
   * the cache. This is the user explicitly asking, so it always goes out.
   */
  const retry = useCallback(() => {
    const last = lastQueryRef.current
    if (!last) return
    coveredRef.current = null
    quietUntilRef.current = 0
    run(last, true)
  }, [run])

  // "Zoom in" is about the current view and always wins over a notice about
  // data that is no longer being displayed.
  const notice = areaTooLarge
    ? 'Zoom in to load fountains for this area.'
    : resultNotice

  return { fountains, loading, error, notice, hasSearched, search, retry }
}
