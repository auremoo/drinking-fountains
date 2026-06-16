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
 * @property {() => void} locate - Imperatively request a fresh, high-accuracy fix.
 */

/**
 * React hook wrapping the browser Geolocation API.
 *
 * It starts a continuous `watchPosition` so the blue "you are here" dot tracks
 * the user, and exposes an imperative {@link GeolocationState.locate} for the
 * "recenter on me" button.
 *
 * @returns {GeolocationState}
 */
export function useGeolocation() {
  const [position, setPosition] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  /** Counter used only to force a re-run of the watch effect on demand. */
  const [nonce, setNonce] = useState(0)
  const watchId = useRef(null)

  const locate = useCallback(() => {
    setLoading(true)
    setError(null)
    setNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported by this device.')
      setLoading(false)
      return
    }

    const onSuccess = (pos) => {
      setPosition({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      })
      setLoading(false)
      setError(null)
    }

    const onError = (err) => {
      const messages = {
        1: 'Location permission denied. Enable it to find fountains near you.',
        2: 'Your position is currently unavailable.',
        3: 'Timed out while locating you.',
      }
      setError(messages[err.code] ?? err.message)
      setLoading(false)
    }

    watchId.current = navigator.geolocation.watchPosition(onSuccess, onError, {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 15000,
    })

    return () => {
      if (watchId.current != null) {
        navigator.geolocation.clearWatch(watchId.current)
      }
    }
  }, [nonce])

  return { position, error, loading, locate }
}
