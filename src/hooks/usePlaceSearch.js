import { useCallback, useEffect, useRef, useState } from 'react'
import { geocodePlace, searchPlaces } from '../services/geocode.js'
import { isAbortError } from '../services/http.js'

/**
 * @typedef {import('../services/geocode.js').GeocodeResult} GeocodeResult
 */

/** Debounce before fetching suggestions while typing. */
const SUGGEST_DEBOUNCE_MS = 350

/** Minimum query length before anything is fetched. */
const MIN_LENGTH = 2

/**
 * @typedef {Object} PlaceSearchState
 * @property {string} query
 * @property {(value: string) => void} setQuery
 * @property {GeocodeResult[]} suggestions
 * @property {boolean} loading - True while a submitted query is resolving.
 * @property {string|null} error
 * @property {() => void} dismissError
 * @property {(place: GeocodeResult) => void} choose - Pick a suggestion.
 * @property {(event?: { preventDefault?: () => void }) => void} submit - Resolve
 *   the typed query to its best match.
 * @property {() => void} reset - Clear everything and cancel in-flight work.
 */

/**
 * Owns the "search a place" input: debounced type-ahead, submission, and the
 * cancellation of both.
 *
 * Extracted from `App` so the orchestration layer stays readable, and so this
 * state resets cleanly when the panel closes rather than lingering as stale
 * suggestions the next time it opens.
 *
 * @param {Object} options
 * @param {boolean} options.active - Whether the search panel is open.
 * @param {(place: GeocodeResult) => void} options.onPicked - Called with the
 *   chosen place.
 * @returns {PlaceSearchState}
 */
export function usePlaceSearch({ active, onPicked }) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState(
    /** @type {GeocodeResult[]} */ ([]),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(/** @type {string|null} */ (null))

  const abortRef = useRef(/** @type {AbortController|null} */ (null))
  const mountedRef = useRef(true)
  const onPickedRef = useRef(onPicked)
  onPickedRef.current = onPicked

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const cancelInFlight = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const reset = useCallback(() => {
    cancelInFlight()
    setQuery('')
    setSuggestions([])
    setError(null)
    setLoading(false)
  }, [cancelInFlight])

  // Closing the panel must not leave a request running or suggestions cached.
  useEffect(() => {
    if (!active) reset()
  }, [active, reset])

  // Debounced type-ahead.
  useEffect(() => {
    if (!active || query.trim().length < MIN_LENGTH) {
      setSuggestions([])
      return undefined
    }

    const timer = setTimeout(() => {
      cancelInFlight()
      const controller = new AbortController()
      abortRef.current = controller

      searchPlaces(query, { signal: controller.signal })
        .then((results) => {
          if (!mountedRef.current || controller.signal.aborted) return
          setSuggestions(results)
          setError(null)
        })
        .catch((err) => {
          if (isAbortError(err) || !mountedRef.current) return
          setSuggestions([])
          setError(err.message)
        })
    }, SUGGEST_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query, active, cancelInFlight])

  const choose = useCallback(
    (place) => {
      cancelInFlight()
      setSuggestions([])
      setQuery('')
      setError(null)
      onPickedRef.current?.(place)
    },
    [cancelInFlight],
  )

  const submit = useCallback(
    async (event) => {
      event?.preventDefault?.()
      cancelInFlight()
      const controller = new AbortController()
      abortRef.current = controller

      setSuggestions([])
      setLoading(true)
      setError(null)
      try {
        const place = await geocodePlace(query, { signal: controller.signal })
        if (!mountedRef.current || controller.signal.aborted) return
        setQuery('')
        onPickedRef.current?.(place)
      } catch (err) {
        if (isAbortError(err) || !mountedRef.current) return
        setError(err.message)
      } finally {
        if (mountedRef.current && abortRef.current === controller) {
          setLoading(false)
        }
      }
    },
    [query, cancelInFlight],
  )

  const dismissError = useCallback(() => setError(null), [])

  return {
    query,
    setQuery,
    suggestions,
    loading,
    error,
    dismissError,
    choose,
    submit,
    reset,
  }
}
