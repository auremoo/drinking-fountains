import { useCallback, useEffect, useRef, useState } from 'react'
import MapView from './components/MapView.jsx'
import FountainList from './components/FountainList.jsx'
import { useGeolocation } from './hooks/useGeolocation.js'
import { useFountains } from './hooks/useFountains.js'
import { geocodePlace, searchPlaces } from './services/geocode.js'

/** Debounce, in milliseconds, before fetching place suggestions while typing. */
const CITY_SUGGEST_DEBOUNCE_MS = 350
/** Minimum query length before suggestions are fetched. */
const CITY_SUGGEST_MIN_LENGTH = 2

/**
 * Half-width/height (in degrees) of the bounding box used for the first
 * automatic search around the user. ~0.012° ≈ 1.3 km, a comfortable walking
 * radius that keeps the Overpass response fast.
 */
const AUTO_SEARCH_HALF_DEG = 0.012

/** Search a bbox of this half-width/height (degrees) around a manually-picked point. */
const PICK_SEARCH_HALF_DEG = AUTO_SEARCH_HALF_DEG

/** Delay after the map stops moving before auto-searching the new area. */
const PAN_SEARCH_DEBOUNCE_MS = 600

/**
 * Root application component.
 *
 * Responsibilities:
 *  - wires geolocation and the fountain dataset together,
 *  - performs one automatic search around the user on first fix,
 *  - exposes "recenter on me", "choose location on map" and "search this
 *    area" controls,
 *  - coordinates the map view and the bottom-sheet list.
 */
export default function App() {
  const { position: gpsPosition, error: geoError, locate } = useGeolocation()
  const { fountains, loading, error: dataError, search } = useFountains()

  /** Position chosen by tapping the map or searching a place, overriding the GPS fix until cleared. */
  const [manualPosition, setManualPosition] = useState(null)
  /** True while the user is asked to tap the map to set their location. */
  const [pickMode, setPickMode] = useState(false)
  /** Whether the "search a place" input is shown. */
  const [citySearchOpen, setCitySearchOpen] = useState(false)
  const [cityQuery, setCityQuery] = useState('')
  const [cityError, setCityError] = useState(null)
  const [cityLoading, setCityLoading] = useState(false)
  /** Type-ahead place suggestions for the current query. */
  const [citySuggestions, setCitySuggestions] = useState([])
  const citySuggestAbortRef = useRef(null)
  /** True once the user has dismissed the current geolocation error toast. */
  const [errorDismissed, setErrorDismissed] = useState(false)
  /** Position the map should animate to (recenter button / list selection). */
  const [flyTo, setFlyTo] = useState(null)
  /** Debounce timer for auto-searching after the map stops moving. */
  const panSearchTimer = useRef(null)
  /** Ensures the automatic "near me" search only runs once. */
  const autoSearched = useRef(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  const position = manualPosition ?? gpsPosition

  // On the first GPS fix: center the map and search the surrounding area.
  useEffect(() => {
    if (!gpsPosition || autoSearched.current) return
    autoSearched.current = true
    setFlyTo({ ...gpsPosition })
    search([
      gpsPosition.lat - AUTO_SEARCH_HALF_DEG,
      gpsPosition.lng - AUTO_SEARCH_HALF_DEG,
      gpsPosition.lat + AUTO_SEARCH_HALF_DEG,
      gpsPosition.lng + AUTO_SEARCH_HALF_DEG,
    ])
  }, [gpsPosition, search])

  // Re-search automatically once the user stops panning/zooming, instead of
  // requiring an explicit "search this area" button.
  const handleBoundsChange = useCallback(
    (bbox) => {
      clearTimeout(panSearchTimer.current)
      panSearchTimer.current = setTimeout(
        () => search(bbox),
        PAN_SEARCH_DEBOUNCE_MS,
      )
    },
    [search],
  )

  useEffect(() => () => clearTimeout(panSearchTimer.current), [])

  const handleRecenter = useCallback(() => {
    setManualPosition(null) // go back to tracking GPS
    setErrorDismissed(false)
    locate() // called directly from this click handler so Safari shows the permission prompt
    if (gpsPosition) setFlyTo({ ...gpsPosition }) // new object ref re-triggers flyTo
  }, [locate, gpsPosition])

  const handlePick = useCallback(
    (lat, lng) => {
      setPickMode(false)
      setCitySearchOpen(false)
      setManualPosition({ lat, lng, accuracy: 0 })
      setFlyTo({ lat, lng })
      search([
        lat - PICK_SEARCH_HALF_DEG,
        lng - PICK_SEARCH_HALF_DEG,
        lat + PICK_SEARCH_HALF_DEG,
        lng + PICK_SEARCH_HALF_DEG,
      ])
    },
    [search],
  )

  // Debounced type-ahead suggestions as the user types a place name.
  useEffect(() => {
    if (!citySearchOpen || cityQuery.trim().length < CITY_SUGGEST_MIN_LENGTH) {
      setCitySuggestions([])
      return
    }
    const timer = setTimeout(() => {
      citySuggestAbortRef.current?.abort()
      const controller = new AbortController()
      citySuggestAbortRef.current = controller
      searchPlaces(cityQuery, controller.signal)
        .then((results) => {
          setCitySuggestions(results)
          setCityError(null)
        })
        .catch((err) => {
          if (err.name === 'AbortError') return
          setCitySuggestions([])
          setCityError(err.message)
        })
    }, CITY_SUGGEST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [cityQuery, citySearchOpen])

  const handleSuggestionSelect = useCallback(
    (place) => {
      citySuggestAbortRef.current?.abort()
      setCitySuggestions([])
      setCityQuery('')
      setCityError(null)
      handlePick(place.lat, place.lng)
    },
    [handlePick],
  )

  const handleCitySubmit = useCallback(
    async (e) => {
      e.preventDefault()
      citySuggestAbortRef.current?.abort()
      setCitySuggestions([])
      setCityLoading(true)
      setCityError(null)
      try {
        const { lat, lng } = await geocodePlace(cityQuery)
        handlePick(lat, lng)
        setCityQuery('')
      } catch (err) {
        if (err.name !== 'AbortError') setCityError(err.message)
      } finally {
        setCityLoading(false)
      }
    },
    [cityQuery, handlePick],
  )

  const handleSelect = useCallback((fountain) => {
    setFlyTo({ lat: fountain.lat, lng: fountain.lng, accuracy: 0 })
    setSheetOpen(false)
  }, [])

  // Once a manual location (pin or city) is active, a stale GPS error isn't
  // relevant anymore - the app is working via the alternative the user chose.
  const rawError = dataError || (!manualPosition && geoError) || null

  // Re-show the toast whenever the underlying error actually changes, even
  // if the user dismissed a previous one.
  useEffect(() => {
    setErrorDismissed(false)
  }, [rawError])

  const error = !errorDismissed && rawError

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="topbar__title">
          <span aria-hidden="true">💧</span> Drinking Fountains
        </h1>
      </header>

      <MapView
        fountains={fountains}
        userPosition={position}
        flyTo={flyTo}
        onBoundsChange={handleBoundsChange}
        pickMode={pickMode}
        onPick={handlePick}
      />

      {citySearchOpen && (
        <div className="city-search-wrap">
          <form className="city-search" onSubmit={handleCitySubmit}>
            <input
              className="city-search__input"
              type="text"
              value={cityQuery}
              onChange={(e) => setCityQuery(e.target.value)}
              placeholder="Search a city or address…"
              autoComplete="off"
              autoFocus
            />
            <button
              className="btn btn--primary city-search__submit"
              type="submit"
              disabled={cityLoading || !cityQuery.trim()}
            >
              {cityLoading ? '…' : 'Go'}
            </button>
          </form>
          {citySuggestions.length > 0 && (
            <ul className="city-suggestions">
              {citySuggestions.map((place, i) => (
                <li key={`${place.lat},${place.lng}-${i}`}>
                  <button
                    type="button"
                    className="city-suggestions__item"
                    onClick={() => handleSuggestionSelect(place)}
                  >
                    {place.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {citySearchOpen && cityError && (
        <div className="toast toast--error toast--compact" role="alert">
          <span>{cityError}</span>
          <button
            className="toast__dismiss"
            onClick={() => setCityError(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div className="controls">
        <button
          className={
            citySearchOpen ? 'btn btn--icon btn--icon-active' : 'btn btn--icon'
          }
          onClick={() => {
            setCitySearchOpen((on) => !on)
            setPickMode(false)
          }}
          aria-label="Search a city"
          title="Search a city"
        >
          🔎
        </button>
        <button
          className={
            pickMode ? 'btn btn--icon btn--icon-active' : 'btn btn--icon'
          }
          onClick={() => {
            setPickMode((on) => !on)
            setCitySearchOpen(false)
          }}
          aria-label="Choose location on the map"
          title="Choose location on the map"
        >
          📍
        </button>
        <button
          className="btn btn--icon"
          onClick={handleRecenter}
          aria-label="Use my GPS location"
          title="Use my GPS location"
        >
          ◎
        </button>
      </div>

      {pickMode && (
        <div className="toast toast--info toast--compact" role="status">
          Tap the map to set your location
        </div>
      )}

      {error && (
        <div className="toast toast--error toast--compact" role="alert">
          <span>{error}</span>
          <button
            className="toast__dismiss"
            onClick={() => setErrorDismissed(true)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <FountainList
        fountains={fountains}
        loading={loading}
        userPosition={position}
        open={sheetOpen}
        onToggle={() => setSheetOpen((o) => !o)}
        onSelect={handleSelect}
      />
    </div>
  )
}
