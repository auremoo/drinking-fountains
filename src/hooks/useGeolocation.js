import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * @typedef {Object} GeoPosition
 * @property {number} lat
 * @property {number} lng
 * @property {number} accuracy - Accuracy radius in metres.
 */

/**
 * @typedef {Object} GeolocationState
 * @property {GeoPosition|null} position - Latest known position.
 * @property {string|null} error - Human-readable error, if any.
 * @property {boolean} loading - True until the first fix arrives.
 * @property {() => void} locate - Imperatively (re)request a fresh, high-accuracy fix.
 */

const ERROR_MESSAGES = {
  1: 'Location blocked for this site. On iPhone: Settings > Privacy & Security > Location Services > Safari Websites, or tap the "aA" icon in the address bar > Website Settings. Then retry, or set your location manually below.',
  2: 'Your position is currently unavailable.',
  3: 'Timed out while locating you.',
}

/**
 * React hook wrapping the browser Geolocation API.
 *
 * It starts a continuous `watchPosition` so the blue "you are here" dot tracks
 * the user, and exposes an imperative {@link GeolocationState.locate} that
 * restarts the watch.
 *
 * `locate` calls `navigator.geolocation.watchPosition` synchronously, with no
 * state/effect indirection in between. This matters on Safari/WebKit: the
 * permission prompt only appears when the geolocation call happens directly
 * inside a user-gesture handler (e.g. a button's `onClick`). Going through a
 * `setState` + `useEffect` round-trip loses that gesture association, so the
 * prompt can silently never show.
 *
 * @returns {GeolocationState}
 */
export function useGeolocation() {
  const [position, setPosition] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const watchId = useRef(null)

  /**
   * @param {{ silent?: boolean }} [opts] - When `silent` is true, failures are
   *   not surfaced as `error` (used for the best-effort attempt on first
   *   load, which Safari may legitimately ignore since it has no user
   *   gesture behind it - that's not worth alarming the user about).
   */
  const locate = useCallback(({ silent = false } = {}) => {
    if (!('geolocation' in navigator)) {
      if (!silent) setError('Geolocation is not supported by this device.')
      setLoading(false)
      return
    }

    setLoading(true)
    if (!silent) setError(null)

    if (watchId.current != null) {
      navigator.geolocation.clearWatch(watchId.current)
    }

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        })
        setLoading(false)
        setError(null)
      },
      (err) => {
        if (!silent) setError(ERROR_MESSAGES[err.code] ?? err.message)
        setLoading(false)
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    )
  }, [])

  // Best-effort silent fix on first load: works if permission was already
  // granted on a previous visit, and stays quiet otherwise. The explicit
  // "use my GPS location" button is what triggers the real prompt/error.
  useEffect(() => {
    locate({ silent: true })
    return () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current)
    }
  }, [locate])

  return { position, error, loading, locate }
}
