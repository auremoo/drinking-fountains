/**
 * Remembers where the map was last looking, so the next launch opens there
 * instead of on the default city.
 *
 * Until a GPS fix arrives — several seconds on a cold start, never when the
 * permission is refused — the app has to show *something*. Showing the last
 * area the user looked at means the tiles and the first fountain search are
 * very likely the ones they need, rather than a detour through Paris that is
 * thrown away the moment the fix lands.
 *
 * The view is kept in `localStorage`: it never leaves the device, and
 * "Reset app data" erases it. Nothing here throws — Safari in private mode
 * denies storage, and a map that cannot remember must still open.
 *
 * @module utils/lastView
 */

import { isFiniteNumber, isValidLatLng } from './geo.js'

const STORAGE_KEY = 'drinking-fountains:last-view'

/** Zoom range the map itself allows (see `MapView`). */
const MIN_ZOOM = 3
const MAX_ZOOM = 19

/**
 * @typedef {Object} MapViewState
 * @property {number} lat
 * @property {number} lng
 * @property {number} zoom
 */

/** @returns {Storage|null} */
function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

/**
 * Read the remembered view.
 *
 * @returns {MapViewState|null} `null` when nothing usable is stored. A value
 *   that is present but malformed is treated the same way: feeding Leaflet a
 *   bad centre throws and blanks the app.
 */
export function readLastView() {
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    if (!raw) return null
    const { lat, lng, zoom } = JSON.parse(raw) ?? {}
    if (!isValidLatLng(lat, lng) || !isFiniteNumber(zoom)) return null
    return { lat, lng, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) }
  } catch {
    return null
  }
}

/**
 * Remember a view. Invalid input is ignored rather than stored.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} zoom
 * @returns {void}
 */
export function saveLastView(lat, lng, zoom) {
  if (!isValidLatLng(lat, lng) || !isFiniteNumber(zoom)) return
  try {
    storage()?.setItem(
      STORAGE_KEY,
      // ~1 m is plenty for "roughly where I was".
      JSON.stringify({ lat: +lat.toFixed(5), lng: +lng.toFixed(5), zoom }),
    )
  } catch {
    /* storage unavailable or full: the app simply opens on the default view */
  }
}

/** Forget the remembered view. */
export function clearLastView() {
  try {
    storage()?.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
