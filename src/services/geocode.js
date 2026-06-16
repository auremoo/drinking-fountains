/**
 * Forward geocoding (place name -> coordinates) via the public OSM Nominatim
 * API, so users can type a city instead of relying on GPS or tapping the map.
 *
 * @module services/geocode
 * @see https://nominatim.org/release-docs/latest/api/Search/
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

/**
 * @typedef {Object} GeocodeResult
 * @property {number} lat
 * @property {number} lng
 * @property {string} label - Human-readable place name, for display/confirmation.
 */

/**
 * Look up a place by name and return its best-matching coordinates.
 *
 * @param {string} query - Free-text place name, e.g. "Lyon" or "10 rue de la Paix, Paris".
 * @param {AbortSignal} [signal]
 * @returns {Promise<GeocodeResult>}
 * @throws {Error} When the query is empty, the request fails, or no place matches.
 */
export async function geocodePlace(query, signal) {
  const q = query.trim()
  if (!q) throw new Error('Type a place name to search.')

  const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(q)}`
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Place search failed (HTTP ${res.status}).`)

  const results = await res.json()
  if (results.length === 0) {
    throw new Error(`No place found for "${q}".`)
  }

  const [match] = results
  return {
    lat: parseFloat(match.lat),
    lng: parseFloat(match.lon),
    label: match.display_name,
  }
}
