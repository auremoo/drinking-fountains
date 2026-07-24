import { useCallback, useEffect, useRef, useState } from 'react'
import { isValidLatLng } from '../utils/geo.js'

/**
 * @typedef {Object} GeoPosition
 * @property {number} lat
 * @property {number} lng
 * @property {number} accuracy - Accuracy radius in metres (0 when unknown).
 */

/**
 * @typedef {Object} GeolocationState
 * @property {GeoPosition|null} position - Latest known position.
 * @property {string|null} error - Human-readable error, if any.
 * @property {boolean} loading - True while waiting for a first fix.
 * @property {boolean} supported - False when the browser has no Geolocation API.
 * @property {(options?: { silent?: boolean }) => void} locate - Imperatively
 *   (re)request a fresh fix.
 */

const PERMISSION_DENIED = 1
const POSITION_UNAVAILABLE = 2
const TIMEOUT = 3

const ERROR_MESSAGES = {
  [PERMISSION_DENIED]:
    'Location blocked for this site. On iPhone: Settings > Privacy & Security > Location Services > Safari Websites, or tap the "aA" icon in the address bar > Website Settings. Then retry, or set your location manually.',
  [POSITION_UNAVAILABLE]: 'Your position is currently unavailable.',
  [TIMEOUT]: 'Timed out while locating you. Retry, or set your location manually.',
}

/** Options for the first, precise attempt. */
const HIGH_ACCURACY_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 10000,
  timeout: 15000,
}

/**
 * Fallback options. Devices without GPS (most desktops, some tablets) can only
 * answer from Wi-Fi/IP databases, and a high-accuracy request there often just
 * times out. Retrying without it turns "Timed out while locating you" into an
 * approximate but usable fix.
 */
const LOW_ACCURACY_OPTIONS = {
  enableHighAccuracy: false,
  maximumAge: 60000,
  timeout: 20000,
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
 * Robustness details that were the source of real misbehaviour:
 *  - a denied permission stops the watch instead of re-firing the same error
 *    forever,
 *  - once a fix exists, transient errors are ignored rather than replacing a
 *    working position with an alarming toast,
 *  - a high-accuracy timeout falls back to a coarse fix instead of failing,
 *  - every callback checks the component is still mounted, and cleanup never
 *    touches a missing `navigator.geolocation`.
 *
 * @returns {GeolocationState}
 */
export function useGeolocation() {
  const supported =
    typeof navigator !== 'undefined' && 'geolocation' in navigator

  const [position, setPosition] = useState(
    /** @type {GeoPosition|null} */ (null),
  )
  const [error, setError] = useState(/** @type {string|null} */ (null))
  const [loading, setLoading] = useState(supported)

  const watchIdRef = useRef(/** @type {number|null} */ (null))
  const mountedRef = useRef(true)
  /** True once any fix has arrived; later failures then become non-events. */
  const hasFixRef = useRef(false)
  /** Ensures the coarse-accuracy fallback is only attempted once per request. */
  const triedFallbackRef = useRef(false)

  const clearWatch = useCallback(() => {
    if (watchIdRef.current == null) return
    // `navigator.geolocation` can be absent (or the page torn down) by the time
    // cleanup runs; a throw here would surface as an unmount error.
    try {
      navigator.geolocation?.clearWatch(watchIdRef.current)
    } catch {
      /* nothing sensible to do */
    }
    watchIdRef.current = null
  }, [])

  /**
   * Start (or restart) a position watch.
   *
   * @param {{ silent?: boolean, options?: PositionOptions }} [config]
   */
  const start = useCallback(
    ({ silent = false, options = HIGH_ACCURACY_OPTIONS } = {}) => {
      if (!supported) {
        if (!silent) setError('Geolocation is not supported by this device.')
        setLoading(false)
        return
      }

      setLoading(true)
      if (!silent) setError(null)
      clearWatch()

      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          if (!mountedRef.current) return
          const lat = pos?.coords?.latitude
          const lng = pos?.coords?.longitude
          // Some browsers have been known to emit a fix with null coordinates;
          // rendering it would throw inside Leaflet.
          if (!isValidLatLng(lat, lng)) return
          const accuracy = Number.isFinite(pos.coords.accuracy)
            ? pos.coords.accuracy
            : 0
          hasFixRef.current = true
          setPosition({ lat, lng, accuracy })
          setLoading(false)
          setError(null)
        },
        (err) => {
          if (!mountedRef.current) return

          if (err?.code === PERMISSION_DENIED) {
            // Safari keeps firing this for every watch tick; stop listening.
            clearWatch()
            setLoading(false)
            if (!silent) setError(ERROR_MESSAGES[PERMISSION_DENIED])
            return
          }

          // A precise fix is unavailable — try again coarsely before giving up.
          if (!hasFixRef.current && !triedFallbackRef.current) {
            triedFallbackRef.current = true
            start({ silent, options: LOW_ACCURACY_OPTIONS })
            return
          }

          setLoading(false)
          // With a position already on screen, an intermittent failure is not
          // worth interrupting the user for.
          if (hasFixRef.current || silent) return
          setError(ERROR_MESSAGES[err?.code] ?? 'Could not determine your location.')
        },
        options,
      )
    },
    [clearWatch, supported],
  )

  const locate = useCallback(
    ({ silent = false } = {}) => {
      triedFallbackRef.current = false
      start({ silent })
    },
    [start],
  )

  // Best-effort silent fix on first load: works if permission was already
  // granted on a previous visit, and stays quiet otherwise. The explicit
  // "use my GPS location" button is what triggers the real prompt/error.
  useEffect(() => {
    mountedRef.current = true
    locate({ silent: true })
    return () => {
      mountedRef.current = false
      clearWatch()
    }
  }, [locate, clearWatch])

  return { position, error, loading, supported, locate }
}
