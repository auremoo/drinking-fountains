/**
 * Forward geocoding (place name -> coordinates), so users can type a city
 * instead of relying on GPS or tapping the map.
 *
 * Two independent public providers are tried in order, the same fallback
 * approach used for Overpass: a single provider being unreachable (down,
 * rate-limiting, or blocked for a given network) shouldn't break the feature.
 *
 * @module services/geocode
 * @see https://nominatim.org/release-docs/latest/api/Search/
 * @see https://photon.komoot.io/
 */

/**
 * Network timeout per provider, in milliseconds. Without this, a slow or
 * unresponsive response leaves the caller awaiting a promise that never
 * settles - the UI would show "searching" forever instead of failing
 * visibly or falling back to the next provider.
 */
const TIMEOUT_MS = 8000

/**
 * @typedef {Object} GeocodeResult
 * @property {number} lat
 * @property {number} lng
 * @property {string} label - Human-readable place name, for display/confirmation.
 */

const PROVIDERS = [
  {
    buildUrl: (q, limit) =>
      `https://nominatim.openstreetmap.org/search?format=json&limit=${limit}&q=${encodeURIComponent(q)}`,
    parse: (json) =>
      json.map((r) => ({
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        label: r.display_name,
      })),
  },
  {
    buildUrl: (q, limit) =>
      `https://photon.komoot.io/api/?limit=${limit}&q=${encodeURIComponent(q)}`,
    parse: (json) =>
      (json.features ?? []).map((f) => ({
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        label: [
          f.properties.name,
          f.properties.city,
          f.properties.state,
          f.properties.country,
        ]
          .filter(Boolean)
          .join(', '),
      })),
  },
]

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
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
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
 * @throws {Error} When every provider fails (network/CORS/timeout) - as
 *   opposed to a provider succeeding with zero matches, which resolves to `[]`.
 */
export async function searchPlaces(query, signal, limit = 5) {
  const q = query.trim()
  if (!q) return []

  let lastError
  for (const provider of PROVIDERS) {
    try {
      const json = await fetchJson(provider.buildUrl(q, limit), signal)
      return provider.parse(json)
    } catch (err) {
      if (signal?.aborted) throw err
      lastError = err
    }
  }
  throw new Error(
    `Place search is unreachable right now. ${lastError?.message ?? ''}`.trim(),
  )
}

/**
 * Look up a place by name and return its single best-matching coordinates.
 *
 * @param {string} query
 * @param {AbortSignal} [signal]
 * @returns {Promise<GeocodeResult>}
 * @throws {Error} When the query is empty, every provider fails, or no place matches.
 */
export async function geocodePlace(query, signal) {
  const [match] = await searchPlaces(query, signal, 1)
  if (!match) throw new Error(`No place found for "${query.trim()}".`)
  return match
}
