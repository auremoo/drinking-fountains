/**
 * Geographic primitives shared by the search pipeline.
 *
 * Everything that turns map state into a query goes through here, because the
 * two most common ways this app used to break were geometric:
 *
 *  1. Invalid coordinates (`NaN`, `null`, out-of-range) reaching Leaflet, which
 *     throws synchronously and takes the whole React tree down with it.
 *  2. Out-of-range or enormous bounding boxes reaching Overpass, which answers
 *     with a 400 or a timeout instead of data.
 *
 * A bounding box is always `[south, west, north, east]` in decimal degrees.
 *
 * @module utils/geo
 */

/** Metres per degree of latitude (mean value; good to ~0.3%). */
const M_PER_DEG_LAT = 111320

/**
 * Longitude degrees shrink towards the poles. Below this cosine we stop
 * dividing (it would explode towards infinity near the poles) and accept a
 * wider-than-asked box instead.
 * @type {number}
 */
const MIN_COS_LAT = 0.05

/**
 * Is `value` a usable, finite number? Guards against `NaN`, `Infinity`,
 * `null`, `undefined` and numeric strings, all of which appear in third-party
 * API payloads.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Is this a coordinate Leaflet can safely render?
 *
 * @param {unknown} lat
 * @param {unknown} lng
 * @returns {boolean}
 */
export function isValidLatLng(lat, lng) {
  return (
    isFiniteNumber(lat) &&
    isFiniteNumber(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  )
}

/**
 * Coerce a value that should be a number (APIs return strings, `null`, …).
 *
 * @param {unknown} value
 * @returns {number|null} `null` when the value cannot be read as a finite number.
 */
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Wrap a longitude into `[-180, 180]`.
 *
 * Leaflet happily reports longitudes outside that range once the user has
 * panned past the antimeridian (world copies), and Overpass rejects such a
 * bbox outright — that is a "the app randomly stopped finding anything" bug.
 *
 * @param {number} lng
 * @returns {number}
 */
export function wrapLng(lng) {
  if (!isFiniteNumber(lng)) return NaN
  // Short-circuit the common case: the modular arithmetic below is exact in
  // spirit but not in floating point, and 2.3 must stay 2.3.
  if (lng >= -180 && lng <= 180) return lng
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180
  // `-180` and `180` are the same meridian; prefer the positive form so a
  // wrapped east edge never ends up numerically below its west edge.
  return wrapped === -180 ? 180 : wrapped
}

/** Clamp a latitude to the Web-Mercator-safe range. */
export function clampLat(lat) {
  return Math.min(90, Math.max(-90, lat))
}

/**
 * Validate and canonicalize a bounding box.
 *
 * Accepts anything (a Leaflet-derived array, a hand-built one) and returns a
 * bbox that is safe to send to Overpass, or `null` when it cannot be repaired.
 * Latitudes are clamped, longitudes wrapped, and a box that spans (nearly) the
 * whole world is collapsed to the full range rather than left inverted.
 *
 * @param {unknown} bbox - Expected `[south, west, north, east]`.
 * @returns {[number, number, number, number]|null}
 */
export function normalizeBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null

  const nums = bbox.map(toNumber)
  if (nums.some((n) => n === null)) return null

  let [south, west, north, east] = /** @type {number[]} */ (nums)

  south = clampLat(south)
  north = clampLat(north)
  if (south > north) [south, north] = [north, south]

  // A box wider than the world: no point asking a server for world copies.
  if (east - west >= 360 || west - east >= 360) {
    west = -180
    east = 180
  } else {
    west = wrapLng(west)
    east = wrapLng(east)
    // After wrapping, a box straddling the antimeridian reads as inverted.
    // Overpass has no notion of a wrapping bbox, so widen to the full range
    // (the caller's area guard then decides whether it is worth querying).
    if (west > east) {
      west = -180
      east = 180
    }
  }

  if (![south, west, north, east].every(isFiniteNumber)) return null
  return [south, west, north, east]
}

/**
 * Grow a bbox by `ratio` of its own size on each side.
 *
 * Searches are padded before hitting the network so that small pans stay
 * inside already-fetched territory — the single biggest reduction in Overpass
 * traffic, and therefore in rate-limit errors.
 *
 * @param {[number, number, number, number]} bbox
 * @param {number} [ratio] - e.g. `0.25` grows the box by 25% per side.
 * @returns {[number, number, number, number]}
 */
export function padBbox(bbox, ratio = 0.25) {
  const [south, west, north, east] = bbox
  const padLat = (north - south) * ratio
  const padLng = (east - west) * ratio
  return (
    normalizeBbox([
      south - padLat,
      west - padLng,
      north + padLat,
      east + padLng,
    ]) ?? bbox
  )
}

/**
 * Does `outer` fully contain `inner`?
 *
 * @param {[number, number, number, number]|null} outer
 * @param {[number, number, number, number]|null} inner
 * @returns {boolean} False when either box is missing.
 */
export function bboxContains(outer, inner) {
  if (!outer || !inner) return false
  return (
    outer[0] <= inner[0] &&
    outer[1] <= inner[1] &&
    outer[2] >= inner[2] &&
    outer[3] >= inner[3]
  )
}

/**
 * Geometric centre of a bbox.
 *
 * @param {[number, number, number, number]} bbox
 * @returns {{ lat: number, lng: number }}
 */
export function bboxCenter([south, west, north, east]) {
  return { lat: (south + north) / 2, lng: (west + east) / 2 }
}

/**
 * Approximate ground area of a bbox, in square kilometres.
 *
 * Used to refuse absurd queries ("show me every fountain in Europe"), which
 * either time out server-side or return so many markers that the browser
 * stalls.
 *
 * @param {[number, number, number, number]} bbox
 * @returns {number}
 */
export function bboxAreaKm2([south, west, north, east]) {
  const heightKm = ((north - south) * M_PER_DEG_LAT) / 1000
  const midLat = (south + north) / 2
  const widthKm =
    ((east - west) * M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180)) / 1000
  return Math.abs(heightKm * widthKm)
}

/**
 * Build a bbox of `radiusMeters` around a point.
 *
 * Metres rather than degrees: a fixed degree offset is ~1.3 km in Paris but
 * ~700 m in Reykjavík, which made the "around me" search silently shrink at
 * high latitudes.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusMeters
 * @returns {[number, number, number, number]|null} `null` for invalid input.
 */
export function bboxAround(lat, lng, radiusMeters) {
  if (!isValidLatLng(lat, lng) || !isFiniteNumber(radiusMeters)) return null
  const radius = Math.max(50, radiusMeters)
  const dLat = radius / M_PER_DEG_LAT
  const cosLat = Math.max(MIN_COS_LAT, Math.cos((lat * Math.PI) / 180))
  const dLng = radius / (M_PER_DEG_LAT * cosLat)
  return normalizeBbox([lat - dLat, lng - dLng, lat + dLat, lng + dLng])
}

/**
 * Stable cache key for a bbox, rounded so that visually identical views share
 * an entry (~11 m at 4 decimals).
 *
 * @param {[number, number, number, number]} bbox
 * @param {number} [decimals]
 * @returns {string}
 */
export function bboxKey(bbox, decimals = 4) {
  return bbox.map((n) => n.toFixed(decimals)).join(',')
}
