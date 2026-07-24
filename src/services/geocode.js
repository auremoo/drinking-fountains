/**
 * Forward geocoding (place name -> coordinates), so users can type a city
 * instead of relying on GPS or tapping the map.
 *
 * Two independent public providers are used. As with Overpass they are queried
 * with a stagger and the first usable answer wins, so a provider that is down,
 * rate-limiting or blocked on the user's network costs a couple of seconds
 * rather than the whole feature.
 *
 * Photon leads for type-ahead (it is built for prefix search and is lenient
 * about request rate); Nominatim leads for a submitted query, where its address
 * matching is better.
 *
 * @module services/geocode
 * @see https://nominatim.org/release-docs/latest/api/Search/
 * @see https://photon.komoot.io/
 */

import { fetchJson, raceWithHedging, isAbortError } from './http.js'
import { isValidLatLng, toNumber } from '../utils/geo.js'

/** Per-provider request budget. */
const TIMEOUT_MS = 8000

/** Delay before also trying the other provider. */
const HEDGE_DELAY_MS = 2000

/** Overall budget for a lookup. */
const DEADLINE_MS = 12000

/**
 * @typedef {Object} GeocodeResult
 * @property {number} lat
 * @property {number} lng
 * @property {string} label - Human-readable place name, for display/confirmation.
 */

/**
 * Thrown internally when a provider answered correctly but knows no such
 * place. It is a normal outcome, not a failure — it just means the *other*
 * provider deserves a turn before we tell the user "not found".
 */
class NoMatchError extends Error {
  constructor() {
    super('No match')
    this.name = 'NoMatchError'
  }
}

/**
 * Drop entries without a usable coordinate or label.
 *
 * Providers do return broken rows (missing geometry, `"lat": null`). Passing
 * one to the map means `flyTo(NaN, NaN)`, which throws inside Leaflet and
 * blanks the app — so results are filtered at the boundary.
 *
 * @param {Array<{lat: unknown, lng: unknown, label?: unknown}>} results
 * @returns {GeocodeResult[]}
 */
export function sanitizeResults(results) {
  if (!Array.isArray(results)) return []
  /** @type {GeocodeResult[]} */
  const clean = []
  for (const raw of results) {
    const lat = toNumber(raw?.lat)
    const lng = toNumber(raw?.lng)
    if (!isValidLatLng(lat, lng)) continue
    const label =
      typeof raw.label === 'string' && raw.label.trim()
        ? raw.label.trim()
        : `${lat.toFixed(4)}, ${lng.toFixed(4)}`
    clean.push({ lat, lng, label })
  }
  return clean
}

/** @type {Record<string, { buildUrl: (q: string, limit: number) => string, parse: (json: any) => any[] }>} */
const PROVIDERS = {
  nominatim: {
    buildUrl: (q, limit) =>
      `https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&limit=${limit}&q=${encodeURIComponent(q)}`,
    parse: (json) =>
      (Array.isArray(json) ? json : []).map((r) => ({
        lat: r?.lat,
        lng: r?.lon,
        label: r?.display_name,
      })),
  },
  photon: {
    buildUrl: (q, limit) =>
      `https://photon.komoot.io/api/?limit=${limit}&q=${encodeURIComponent(q)}`,
    parse: (json) =>
      (Array.isArray(json?.features) ? json.features : []).map((f) => ({
        lat: f?.geometry?.coordinates?.[1],
        lng: f?.geometry?.coordinates?.[0],
        label: [
          f?.properties?.name,
          f?.properties?.city,
          f?.properties?.state,
          f?.properties?.country,
        ]
          .filter((part) => typeof part === 'string' && part)
          .join(', '),
      })),
  },
}

/**
 * Look up places matching `query`.
 *
 * @param {string} query - Free-text place name, e.g. "Lyon" or "10 rue de la Paix, Paris".
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.limit] - Max number of suggestions.
 * @param {'photon'|'nominatim'} [options.prefer] - Which provider gets the head start.
 * @returns {Promise<GeocodeResult[]>} Empty when `query` is blank or nothing matches.
 * @throws {Error} `AbortError` when cancelled, or a descriptive error when every
 *   provider is unreachable — as opposed to answering with zero matches, which
 *   resolves to `[]`.
 */
export async function searchPlaces(
  query,
  { signal, limit = 5, prefer = 'photon' } = {},
) {
  const q = query.trim()
  if (!q) return []

  const order =
    prefer === 'nominatim'
      ? ['nominatim', 'photon']
      : ['photon', 'nominatim']

  // Tracks providers that answered but had nothing, so "not found" is never
  // reported as "service unavailable".
  let answeredEmpty = 0

  const tasks = order.map((name) => async (providerSignal) => {
    const provider = PROVIDERS[name]
    const json = await fetchJson(provider.buildUrl(q, limit), {
      signal: providerSignal,
      timeoutMs: TIMEOUT_MS,
    })
    const results = sanitizeResults(provider.parse(json))
    if (results.length === 0) {
      answeredEmpty += 1
      throw new NoMatchError()
    }
    return results
  })

  try {
    return await raceWithHedging(tasks, {
      hedgeDelayMs: HEDGE_DELAY_MS,
      deadlineMs: DEADLINE_MS,
      signal,
    })
  } catch (err) {
    if (isAbortError(err)) throw err
    // At least one provider was reachable and simply had no match.
    if (answeredEmpty > 0) return []
    throw new Error(
      'Place search is unavailable right now. Check your connection and retry.',
    )
  }
}

/**
 * Look up a place by name and return its single best-matching coordinates.
 *
 * @param {string} query
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<GeocodeResult>}
 * @throws {Error} When the query is empty, every provider fails, or no place matches.
 */
export async function geocodePlace(query, { signal } = {}) {
  const q = query.trim()
  if (!q) throw new Error('Type a place to search for.')
  const [match] = await searchPlaces(q, { signal, limit: 1, prefer: 'nominatim' })
  if (!match) throw new Error(`No place found for "${q}".`)
  return match
}
