/**
 * Data access layer for drinking-water fountains.
 *
 * Fountains are sourced from OpenStreetMap through the public Overpass API.
 * OSM is the most complete and precise free dataset for street furniture in
 * large cities worldwide, and requires no API key.
 *
 * The public Overpass instances are the least reliable dependency in the app —
 * they rate-limit, restart, and occasionally answer HTML error pages with a
 * 200 status. This module is built around that reality:
 *
 *  - **Hedged mirrors.** Several instances are queried with a short stagger and
 *    the first usable answer wins, so one dead mirror costs seconds, not the
 *    search (see {@link raceWithHedging}).
 *  - **Short-lived cache.** Identical/nearby views reuse a recent answer instead
 *    of re-querying, which is both faster and the main reason we stay under the
 *    mirrors' rate limits.
 *  - **Defensive parsing.** Every element is validated before it can reach
 *    Leaflet; a single malformed coordinate used to crash the whole map.
 *  - **Bounded result sets.** Huge answers are capped, keeping the browser
 *    responsive on dense city centres.
 *
 * @module services/overpass
 * @see https://wiki.openstreetmap.org/wiki/Tag:amenity%3Ddrinking_water
 * @see https://wiki.openstreetmap.org/wiki/Overpass_API
 */

import { fetchJson, raceWithHedging, HttpError } from './http.js'
import {
  bboxCenter,
  bboxKey,
  isValidLatLng,
  normalizeBbox,
  toNumber,
} from '../utils/geo.js'
import { distanceMeters } from '../utils/distance.js'

/**
 * Public Overpass endpoints, in order of preference. They are queried with a
 * stagger rather than strictly one after another, so this order only decides
 * who gets a head start.
 *
 * **Every entry must cover the whole planet.** The race keeps the first valid
 * answer, and a regional instance answers a query outside its region with a
 * perfectly valid, fast, *empty* result. `overpass.osm.ch` (Switzerland only)
 * used to sit here: whenever the main mirror was slow it won the race and the
 * app reported "0 fountains" everywhere else — then cached that for minutes.
 *
 * `overpass.private.coffee` is the current name of the former
 * `overpass.kumi.systems`; the new host is used directly so the POST is not
 * subject to a cross-origin redirect.
 *
 * @see https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances
 * @type {string[]}
 */
export const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

/**
 * How long to wait for a mirror before *also* trying the next one. Overpass
 * answers a neighbourhood-sized query in ~1-3 s when healthy, so a mirror that
 * is still silent after this is very likely struggling.
 */
const HEDGE_DELAY_MS = 3500

/**
 * Overall budget for a search across every mirror. Past this the app reports a
 * clear failure instead of leaving a spinner running forever.
 */
const DEADLINE_MS = 20000

/** Per-mirror request budget. Generous: a slow answer still beats no answer. */
const ENDPOINT_TIMEOUT_MS = 15000

/** Run time the query asks the server for, in seconds. */
const SERVER_TIMEOUT_S = ENDPOINT_TIMEOUT_MS / 1000

/**
 * Memory the query asks the server for (64 MiB, against a default of 512).
 * The largest area the app will query fits in half of this.
 */
const SERVER_MAXSIZE_BYTES = 64 * 1024 * 1024

/** How long a cached answer stays usable. */
const CACHE_TTL_MS = 5 * 60 * 1000

/** Maximum number of cached bounding boxes kept in memory. */
const CACHE_MAX_ENTRIES = 24

/**
 * Hard cap on the fountains handed to the UI. Beyond this the map's marker
 * clustering and the bottom-sheet list start costing more than they give;
 * the nearest ones to the centre of the search are kept.
 */
export const MAX_FOUNTAINS = 500

/**
 * A normalized drinking-water fountain.
 * @typedef {Object} Fountain
 * @property {string} id - Stable unique id ("node/123", "way/456").
 * @property {number} lat - Latitude in decimal degrees.
 * @property {number} lng - Longitude in decimal degrees.
 * @property {string} [name] - Human name, if tagged.
 * @property {boolean|null} wheelchair - Wheelchair accessibility, if known.
 * @property {boolean|null} bottle - Whether it is suitable for refilling
 *   bottles (`bottle=yes`), if known.
 * @property {Record<string,string>} tags - Raw OSM tags for reference.
 */

/**
 * The outcome of a search.
 * @typedef {Object} FountainsResult
 * @property {Fountain[]} fountains - Validated, de-duplicated fountains.
 * @property {boolean} truncated - True when more matches existed than
 *   {@link MAX_FOUNTAINS} and the list was trimmed to the nearest ones.
 * @property {boolean} partial - True when Overpass answered with a `remark`
 *   (usually "query timed out"), i.e. the data may be incomplete.
 * @property {boolean} cached - True when served from the in-memory cache.
 */

/**
 * Build the Overpass QL query selecting drinking-water fountains within a
 * bounding box.
 *
 * We match both the canonical `amenity=drinking_water` and the common
 * `drinking_water=yes` qualifier on fountains/taps, across nodes, ways and
 * relations, then ask Overpass for the geometric centre of non-node elements.
 * Together the two node clauses select every node tagged with either, so a
 * dedicated clause for drinkable `man_made=water_tap` would only repeat them.
 *
 * The declared budgets are deliberately modest. Overpass decides whether to
 * admit a query from the `timeout` and `maxsize` it announces, not from what it
 * ends up using, so asking for the defaults gets a small query turned away
 * first when a server is busy. The timeout matches {@link ENDPOINT_TIMEOUT_MS}:
 * past it nobody is listening for the answer anyway.
 *
 * @param {[number, number, number, number]} bbox - `[south, west, north, east]`.
 * @returns {string} Overpass QL query text.
 */
export function buildQuery([south, west, north, east]) {
  const bb = `${south},${west},${north},${east}`
  return `[out:json][timeout:${SERVER_TIMEOUT_S}][maxsize:${SERVER_MAXSIZE_BYTES}];
(
  node["amenity"="drinking_water"](${bb});
  way["amenity"="drinking_water"](${bb});
  relation["amenity"="drinking_water"](${bb});
  node["drinking_water"="yes"]["amenity"!="drinking_water"](${bb});
);
out center tags;`
}

/**
 * Parse an OSM boolean-ish tag value into a tri-state boolean.
 * @param {string|undefined} value
 * @returns {boolean|null} true/false, or null when unknown.
 */
function parseBool(value) {
  if (value === undefined) return null
  return value === 'yes' || value === 'designated'
}

/**
 * Convert a raw Overpass element into a {@link Fountain}.
 *
 * Returns `null` for anything unusable — a missing, non-numeric or
 * out-of-range coordinate, or an element without an id. Rendering such an
 * element throws inside Leaflet, which unmounts the map and leaves a blank
 * screen, so filtering here is a stability feature, not tidiness.
 *
 * @param {object} el - Overpass element.
 * @returns {Fountain|null}
 */
export function normalize(el) {
  if (!el || typeof el !== 'object') return null

  const lat = toNumber(el.lat ?? el.center?.lat)
  const lng = toNumber(el.lon ?? el.center?.lon)
  if (!isValidLatLng(lat, lng)) return null
  if (el.id === undefined || el.id === null) return null

  const tags = el.tags && typeof el.tags === 'object' ? el.tags : {}
  return {
    id: `${el.type ?? 'node'}/${el.id}`,
    lat,
    lng,
    name: typeof tags.name === 'string' ? tags.name : undefined,
    wheelchair: parseBool(tags.wheelchair),
    bottle: parseBool(tags.bottle),
    tags,
  }
}

/**
 * Turn a raw Overpass payload into validated, de-duplicated fountains capped
 * at {@link MAX_FOUNTAINS} (nearest to `center` first when trimming).
 *
 * @param {any} json - Parsed Overpass response.
 * @param {{ lat: number, lng: number }} center - Reference point for trimming.
 * @returns {{ fountains: Fountain[], truncated: boolean }}
 */
export function parseElements(json, center) {
  const elements = Array.isArray(json?.elements) ? json.elements : []

  /** @type {Map<string, Fountain>} */
  const byId = new Map()
  for (const el of elements) {
    const fountain = normalize(el)
    // A node can match several clauses of the union; keep one marker per id.
    if (fountain && !byId.has(fountain.id)) byId.set(fountain.id, fountain)
  }

  let fountains = [...byId.values()]
  const truncated = fountains.length > MAX_FOUNTAINS
  if (truncated) {
    fountains = fountains
      .map((f) => ({
        f,
        d: distanceMeters(center.lat, center.lng, f.lat, f.lng),
      }))
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_FOUNTAINS)
      .map((entry) => entry.f)
  }
  return { fountains, truncated }
}

/**
 * In-memory cache of recent answers, keyed by bounding box.
 * @type {Map<string, { at: number, result: FountainsResult }>}
 */
const cache = new Map()

/** Drop the cache (used by tests and by the "hard refresh" recovery path). */
export function clearFountainCache() {
  cache.clear()
}

/**
 * @param {string} key
 * @returns {FountainsResult|null}
 */
function readCache(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  // Refresh recency so the eviction below behaves like an LRU.
  cache.delete(key)
  cache.set(key, entry)
  return { ...entry.result, cached: true }
}

/**
 * @param {string} key
 * @param {FountainsResult} result
 */
function writeCache(key, result) {
  cache.set(key, { at: Date.now(), result })
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    cache.delete(oldest)
  }
}

/**
 * Turn a transport-level failure into something a user can act on.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function describeFailure(err) {
  if (err instanceof HttpError) {
    if (err.isOverloaded) {
      return 'The OpenStreetMap servers are busy right now. Tap retry in a moment.'
    }
    if (err.status >= 500) {
      return 'The OpenStreetMap servers are having trouble. Tap retry in a moment.'
    }
    return `The fountain service refused the request (HTTP ${err.status}).`
  }
  if (/** @type {Error} */ (err)?.name === 'TimeoutError') {
    return 'The fountain search took too long. Check your connection and retry.'
  }
  return 'Could not reach the fountain service. Check your connection and retry.'
}

/**
 * Fetch drinking-water fountains within the given bounding box.
 *
 * @param {[number, number, number, number]} bbox - `[south, west, north, east]`.
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] - Cancels the search.
 * @param {boolean} [options.force] - Bypass the cache (used by "retry").
 * @returns {Promise<FountainsResult>}
 * @throws {Error} `AbortError` when cancelled, or a descriptive error when
 *   every mirror failed.
 */
export async function fetchFountains(bbox, { signal, force = false } = {}) {
  const box = normalizeBbox(bbox)
  if (!box) throw new Error('Invalid search area')

  const key = bboxKey(box)
  if (!force) {
    const hit = readCache(key)
    if (hit) return hit
  }

  const body = `data=${encodeURIComponent(buildQuery(box))}`
  const center = bboxCenter(box)

  const json = await raceWithHedging(
    ENDPOINTS.map((endpoint) => async (mirrorSignal) => {
      const payload = await fetchJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: mirrorSignal,
        timeoutMs: ENDPOINT_TIMEOUT_MS,
      })
      // Overpass reports server-side failures as a 200 with a `remark` and no
      // elements. Treat that as a mirror failure so a sibling can answer.
      if (
        !Array.isArray(payload?.elements) ||
        (payload.elements.length === 0 && payload?.remark)
      ) {
        throw new Error(
          typeof payload?.remark === 'string'
            ? payload.remark
            : 'Malformed Overpass response',
        )
      }
      return payload
    }),
    { hedgeDelayMs: HEDGE_DELAY_MS, deadlineMs: DEADLINE_MS, signal },
  )

  const { fountains, truncated } = parseElements(json, center)
  /** @type {FountainsResult} */
  const result = {
    fountains,
    truncated,
    partial: typeof json?.remark === 'string' && json.remark.length > 0,
    cached: false,
  }
  writeCache(key, result)
  return result
}
