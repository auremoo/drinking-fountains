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
  1: 'Location permission denied. Enable it to find fountains near you.',
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

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported by this device.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

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
        setError(ERROR_MESSAGES[err.code] ?? err.message)
        setLoading(false)
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    )
  }, [])

  // Best-effort automatic fix on first load (no user gesture, so Safari may
  // not prompt here if permission was never decided - that's what the
  // explicit "locate" button/gesture is for).
  useEffect(() => {
    locate()
    return () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current)
    }
  }, [locate])

  return { position, error, loading, locate }
}
