import { useMemo } from 'react'
import { isValidLatLng } from '../utils/geo.js'

/**
 * @typedef {import('./useGeolocation.js').GeoPosition} GeoPosition
 */

/**
 * A position rounded to ~10 m whose identity only changes when the rounded
 * value does.
 *
 * A GPS watch reports a slightly different fix about once a second even when
 * the user stands still. Distances shown in the list and in popups do not need
 * that precision, so they are computed from this instead: components that
 * depend on it are left alone by GPS jitter and only update once the user has
 * actually moved.
 *
 * @param {GeoPosition|null} position
 * @returns {GeoPosition|null} `null` when there is no usable position.
 */
export function useAnchor(position) {
  const valid = Boolean(position) && isValidLatLng(position.lat, position.lng)
  const lat = valid ? Number(position.lat.toFixed(4)) : null
  const lng = valid ? Number(position.lng.toFixed(4)) : null
  return useMemo(
    () => (lat === null || lng === null ? null : { lat, lng, accuracy: 0 }),
    [lat, lng],
  )
}
