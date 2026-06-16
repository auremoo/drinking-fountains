/**
 * Build a deep link that opens turn-by-turn directions to a coordinate in the
 * user's preferred maps application.
 * @module utils/directions
 */

/**
 * Returns a universal Google Maps directions URL. On mobile this opens the
 * native Google Maps / Apple Maps app when installed, otherwise the web map.
 *
 * @param {number} lat - Destination latitude.
 * @param {number} lng - Destination longitude.
 * @returns {string} A directions URL safe to use as an anchor `href`.
 */
export function directionsUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`
}
