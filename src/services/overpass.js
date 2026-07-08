/**
 * Data access layer for drinking-water fountains.
 *
 * Fountains are sourced from OpenStreetMap through the public Overpass API.
 * OSM is the most complete and precise free dataset for street furniture in
 * large cities worldwide, and requires no API key.
 *
 * @module services/overpass
 * @see https://wiki.openstreetmap.org/wiki/Tag:amenity%3Ddrinking_water
 * @see https://wiki.openstreetmap.org/wiki/Overpass_API
 */

/**
 * Public Overpass endpoints. Queried in parallel (see {@link fetchFountains})
 * and raced against each other, so an overloaded mirror - overpass-api.de in
 * particular has had recurring slow-response periods - can't delay the whole
 * search when another mirror answers promptly.
 * @type {string[]}
 */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

/**
 * Per-endpoint network timeout, in milliseconds. Endpoints race in parallel,
 * so this bounds the worst case rather than stacking per mirror.
 * @type {number}
 */
const ENDPOINT_TIMEOUT_MS = 10000

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
 * Build the Overpass QL query selecting drinking-water fountains within a
 * bounding box.
 *
 * We match both the canonical `amenity=drinking_water` and the common
 * `drinking_water=yes` qualifier on fountains/taps, across nodes, ways and
 * relations, then ask Overpass for the geometric centre of non-node elements.
 *
 * @param {[number, number, number, number]} bbox - `[south, west, north, east]`.
 * @returns {string} Overpass QL query text.
 */
function buildQuery([south, west, north, east]) {
  const bb = `${south},${west},${north},${east}`
  return `[out:json][timeout:25];
(
  node["amenity"="drinking_water"](${bb});
  way["amenity"="drinking_water"](${bb});
  relation["amenity"="drinking_water"](${bb});
  node["drinking_water"="yes"]["amenity"!="drinking_water"](${bb});
  node["man_made"="water_tap"]["drinking_water"="yes"](${bb});
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
 * @param {object} el - Overpass element.
 * @returns {Fountain|null} Null when the element has no usable coordinate.
 */
function normalize(el) {
  const lat = el.lat ?? el.center?.lat
  const lng = el.lon ?? el.center?.lon
  if (lat == null || lng == null) return null
  const tags = el.tags ?? {}
  return {
    id: `${el.type}/${el.id}`,
    lat,
    lng,
    name: tags.name,
    wheelchair: parseBool(tags.wheelchair),
    bottle: parseBool(tags.bottle),
    tags,
  }
}

/**
 * Query a single Overpass mirror, aborting after {@link ENDPOINT_TIMEOUT_MS}
 * or when the caller's `signal` aborts, whichever comes first.
 *
 * @param {string} endpoint
 * @param {string} body - URL-encoded request body.
 * @param {AbortSignal} [signal]
 * @returns {Promise<Fountain[]>}
 */
async function fetchFromEndpoint(endpoint, body, signal) {
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), ENDPOINT_TIMEOUT_MS)
  const onAbort = () => timeoutController.abort()
  signal?.addEventListener('abort', onAbort)

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: timeoutController.signal,
    })
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`)
    const json = await res.json()
    return (json.elements ?? []).map(normalize).filter(Boolean)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Fetch drinking-water fountains within the given bounding box.
 *
 * All mirrors in {@link ENDPOINTS} are queried in parallel and the first
 * successful response wins, so one overloaded/slow mirror can't delay the
 * whole search when another answers promptly.
 *
 * @param {[number, number, number, number]} bbox - `[south, west, north, east]`.
 * @param {AbortSignal} [signal] - Optional signal to cancel an in-flight request.
 * @returns {Promise<Fountain[]>} Resolves with normalized fountains.
 * @throws {Error} When every Overpass endpoint fails.
 */
export async function fetchFountains(bbox, signal) {
  const body = `data=${encodeURIComponent(buildQuery(bbox))}`

  try {
    return await Promise.any(
      ENDPOINTS.map((endpoint) => fetchFromEndpoint(endpoint, body, signal)),
    )
  } catch (err) {
    if (signal?.aborted) {
      const abortError = new Error('Aborted')
      abortError.name = 'AbortError'
      throw abortError // caller cancelled; not a real failure
    }
    const reasons = (err.errors ?? [err]).map((e) => e.message).join('; ')
    throw new Error(`Could not reach any Overpass server. ${reasons}`.trim())
  }
}
