/**
 * The search policy: given the map's current view and what the app already
 * knows, decide whether a network request is warranted.
 *
 * This is deliberately a pure function rather than a tangle of conditions
 * inside the hook. Deciding *when not to call Overpass* is the single most
 * important reliability rule in the app — too many calls means rate-limit
 * failures, too few means stale or missing data — so it deserves to be
 * readable and directly testable.
 *
 * @module utils/searchPlan
 */

import { bboxAreaKm2, bboxContains, normalizeBbox, padBbox } from './geo.js'

/**
 * Largest area worth querying, in km². Roughly a 40 × 40 km window: more than
 * any city view, far less than a region. Beyond it Overpass times out and the
 * browser drowns in markers.
 */
export const MAX_SEARCH_AREA_KM2 = 1600

/**
 * Fraction by which a requested box is grown before querying, so that small
 * pans land inside already-fetched territory and cost nothing.
 */
export const PAD_RATIO = 0.3

/** How long a covered area stays "fresh enough" to skip a re-query. */
export const FRESH_MS = 3 * 60 * 1000

/**
 * @typedef {Object} SearchPlan
 * @property {'search'|'covered'|'inflight'|'backoff'|'too-large'|'invalid'} action
 *   - What to do, and when skipping, why.
 * @property {number[]|null} queryBbox - The (padded) box to query, when
 *   `action` is `'search'`.
 */

/**
 * Decide what to do about a requested view.
 *
 * @param {Object} input
 * @param {unknown} input.bbox - The requested view, `[south, west, north, east]`.
 * @param {{ bbox: number[], at: number }|null} [input.covered] - Area covered by
 *   the last successful search, and when it completed.
 * @param {number[]|null} [input.inflight] - Box of the request currently running.
 * @param {number} [input.quietUntil] - Timestamp until which automatic searches
 *   pause after a failure.
 * @param {boolean} [input.force] - User-initiated: ignore every skip rule.
 * @param {number} [input.now] - Injectable clock, for tests.
 * @returns {SearchPlan}
 */
export function planSearch({
  bbox,
  covered = null,
  inflight = null,
  quietUntil = 0,
  force = false,
  now = Date.now(),
}) {
  const box = normalizeBbox(bbox)
  if (!box) return { action: 'invalid', queryBbox: null }

  // Too big to answer: no request is better than one that times out.
  if (bboxAreaKm2(box) > MAX_SEARCH_AREA_KM2) {
    return { action: 'too-large', queryBbox: null }
  }

  if (force) return { action: 'search', queryBbox: padBbox(box, PAD_RATIO) }

  // Already known, recently enough.
  if (
    covered &&
    now - covered.at < FRESH_MS &&
    bboxContains(covered.bbox, box)
  ) {
    return { action: 'covered', queryBbox: null }
  }

  // The answer is already on its way.
  if (bboxContains(inflight, box)) {
    return { action: 'inflight', queryBbox: null }
  }

  // The service just failed; piling on keeps it failing.
  if (now < quietUntil) return { action: 'backoff', queryBbox: null }

  return { action: 'search', queryBbox: padBbox(box, PAD_RATIO) }
}

/**
 * How long to stay quiet after `failures` consecutive failures: exponential
 * backoff, capped so the app always recovers on its own eventually.
 *
 * @param {number} failures - Consecutive failure count (1 for the first).
 * @returns {number} Milliseconds.
 */
export function backoffMs(failures) {
  const BASE_MS = 6000
  const MAX_MS = 60000
  if (failures <= 0) return 0
  return Math.min(MAX_MS, BASE_MS * 2 ** (failures - 1))
}
