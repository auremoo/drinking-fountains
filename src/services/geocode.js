/**
 * Forward geocoding (place name -> coordinates) via the public OSM Nominatim
 * API, so users can type a city instead of relying on GPS or tapping the map.
 *
 * @module services/geocode
 * @see https://nominatim.org/release-docs/latest/api/Search/
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

/**
 * Network timeout, in milliseconds. Without this, a slow or unresponsive
 * Nominatim response leaves the caller awaiting a promise that never settles
 * - the UI would show "searching" forever instead of failing visibly.
 */
const TIMEOUT_MS = 10000

/**
 * @typedef {Object} GeocodeResult
 * @property {number} lat
 * @property {number} lng
 * @property {string} label - Human-readable place name, for display/confirmation.
 */

/**
 * Fetch JSON from `url`, aborting after {@link TIMEOUT_MS} or when the
 * caller's `signal` aborts, whichever comes first.
 *
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @returns {Promise<unknown>}
 */
async function fetchJson(url, signal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`Place search failed (HTTP ${res.status}).`)
    return await res.json()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Look up places matching `query`, for type-ahead suggestions.
 *
 * @param {string} query - Free-text place name, e.g. "Lyon" or "10 rue de la Paix, Paris".
 * @param {AbortSignal} [signal]
 * @param {number} [limit] - Max number of suggestions.
 * @returns {Promise<GeocodeResult[]>} Empty when `query` is blank or nothing matches.
 */
export async function searchPlaces(query, signal, limit = 5) {
  const q = query.trim()
  if (!q) return []

  const url = `${NOMINATIM_URL}?format=json&limit=${limit}&q=${encodeURIComponent(q)}`
  const results = await fetchJson(url, signal)
  return results.map((r) => ({
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    label: r.display_name,
  }))
}

/**
 * Look up a place by name and return its single best-matching coordinates.
 *
 * @param {string} query
 * @param {AbortSignal} [signal]
 * @returns {Promise<GeocodeResult>}
 * @throws {Error} When the query is empty, the request fails, or no place matches.
 */
export async function geocodePlace(query, signal) {
  const [match] = await searchPlaces(query, signal, 1)
  if (!match) throw new Error(`No place found for "${query.trim()}".`)
  return match
}
