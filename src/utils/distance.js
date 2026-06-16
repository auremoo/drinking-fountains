/**
 * Geospatial helpers.
 * @module utils/distance
 */

const EARTH_RADIUS_M = 6371000

const toRad = (deg) => (deg * Math.PI) / 180

/**
 * Great-circle distance between two WGS84 coordinates using the haversine
 * formula.
 *
 * @param {number} lat1 - Latitude of point A in decimal degrees.
 * @param {number} lng1 - Longitude of point A in decimal degrees.
 * @param {number} lat2 - Latitude of point B in decimal degrees.
 * @param {number} lng2 - Longitude of point B in decimal degrees.
 * @returns {number} Distance in metres.
 */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a))
}

/**
 * Format a distance in metres into a short, human-readable string.
 *
 * @param {number} meters - Distance in metres.
 * @returns {string} e.g. "120 m" or "1.4 km".
 */
export function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}
