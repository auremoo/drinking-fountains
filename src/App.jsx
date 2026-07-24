// Drinking Fountains — Auteur : Aurélien Moote - Moo - 2026 — Licence MIT
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapView from './components/MapView.jsx'
import FountainList from './components/FountainList.jsx'
import PlaceSearch from './components/PlaceSearch.jsx'
import Toast from './components/Toast.jsx'
import { useGeolocation } from './hooks/useGeolocation.js'
import { useFountains } from './hooks/useFountains.js'
import { usePlaceSearch } from './hooks/usePlaceSearch.js'
import { bboxAround } from './utils/geo.js'

/**
 * Radius, in metres, of the first automatic search around a known point (GPS
 * fix, dropped pin, geocoded place). A comfortable walking distance that keeps
 * the Overpass response small and fast.
 */
const FOCUS_SEARCH_RADIUS_M = 1300

/** Delay after the map stops moving before searching the new area. */
const PAN_SEARCH_DEBOUNCE_MS = 500

/**
 * Longer delay for the very first search, which fires as soon as the map is
 * ready. It gives a pending GPS fix a moment to win, so the app searches where
 * the user actually is instead of spending a request on the default view.
 */
const INITIAL_SEARCH_DELAY_MS = 1400

/**
 * Root application component.
 *
 * It is the only place that knows about *all* the moving parts, and its job is
 * to keep them from fighting each other:
 *
 *  - geolocation, dropped pins and place search all funnel into a single
 *    "current position",
 *  - every search request — automatic, panned or explicit — goes through
 *    {@link useFountains}, which decides on its own whether a network call is
 *    warranted. There is no flag to keep in sync, so no state in which the app
 *    silently stops searching (the previous `suppressNextPanSearch` boolean
 *    could get stuck and did exactly that).
 */
export default function App() {
  const {
    position: gpsPosition,
    error: geoError,
    loading: locating,
    locate,
  } = useGeolocation()
  const {
    fountains,
    loading,
    error: dataError,
    notice,
    hasSearched,
    search,
    retry,
  } = useFountains()

  /** Position chosen by tapping the map or searching a place, overriding GPS until cleared. */
  const [manualPosition, setManualPosition] = useState(null)
  /** True while the user is asked to tap the map to set their location. */
  const [pickMode, setPickMode] = useState(false)
  /** Whether the "search a place" panel is shown. */
  const [citySearchOpen, setCitySearchOpen] = useState(false)
  /** Position the map should animate to (recenter, pin, list selection). */
  const [flyTo, setFlyTo] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  /** Errors the user has dismissed, so a toast stays gone until it changes. */
  const [dismissedError, setDismissedError] = useState(null)
  const [dismissedNotice, setDismissedNotice] = useState(null)

  /** Debounce timer for searching after the map settles. */
  const panSearchTimer = useRef(null)
  /** True while we are waiting for a fix to centre on (initial load, recenter). */
  const awaitingFixRef = useRef(true)
  /** False until the map has reported its bounds at least once. */
  const firstBoundsSeenRef = useRef(false)

  const position = manualPosition ?? gpsPosition

  /** Search around a point, at walking scale. */
  const searchAround = useCallback(
    (lat, lng) => {
      const bbox = bboxAround(lat, lng, FOCUS_SEARCH_RADIUS_M)
      if (bbox) search(bbox)
    },
    [search],
  )

  // Centre on the user as soon as a fix is available — on first load, and again
  // whenever the recenter button is pressed before a fix has arrived.
  useEffect(() => {
    if (!gpsPosition || !awaitingFixRef.current) return
    awaitingFixRef.current = false
    setFlyTo({ ...gpsPosition })
    searchAround(gpsPosition.lat, gpsPosition.lng)
  }, [gpsPosition, searchAround])

  // Search the visible area once the map settles. `useFountains` skips requests
  // that are redundant (already covered) or unreasonable (too large), so this
  // can fire freely without hammering Overpass.
  //
  // The bounds are read when the debounce expires rather than when it is armed:
  // Leaflet also emits `moveend` mid-animation, and acting on those bounds made
  // the app query areas the map was merely flying over.
  const handleBoundsChange = useCallback(
    (getBbox) => {
      clearTimeout(panSearchTimer.current)
      const delay = firstBoundsSeenRef.current
        ? PAN_SEARCH_DEBOUNCE_MS
        : INITIAL_SEARCH_DELAY_MS
      firstBoundsSeenRef.current = true
      panSearchTimer.current = setTimeout(() => {
        const bbox = getBbox()
        if (bbox) search(bbox)
      }, delay)
    },
    [search],
  )

  useEffect(() => () => clearTimeout(panSearchTimer.current), [])

  const handleRecenter = useCallback(() => {
    setManualPosition(null)
    setPickMode(false)
    awaitingFixRef.current = true
    // Called synchronously from the click handler: Safari only shows the
    // permission prompt for geolocation requests made inside a user gesture.
    locate()
    if (gpsPosition) {
      awaitingFixRef.current = false
      setFlyTo({ ...gpsPosition })
      searchAround(gpsPosition.lat, gpsPosition.lng)
    }
  }, [locate, gpsPosition, searchAround])

  /** Adopt a point (map tap or geocoded place) as the current location. */
  const handlePick = useCallback(
    (lat, lng) => {
      setPickMode(false)
      setCitySearchOpen(false)
      awaitingFixRef.current = false
      setManualPosition({ lat, lng, accuracy: 0 })
      setFlyTo({ lat, lng, accuracy: 0 })
      searchAround(lat, lng)
    },
    [searchAround],
  )

  const handlePlacePicked = useCallback(
    (place) => handlePick(place.lat, place.lng),
    [handlePick],
  )

  const placeSearch = usePlaceSearch({
    active: citySearchOpen,
    onPicked: handlePlacePicked,
  })

  const handleSelect = useCallback((fountain) => {
    setFlyTo({ lat: fountain.lat, lng: fountain.lng, accuracy: 0 })
    setSheetOpen(false)
  }, [])

  // Once a manual location (pin or city) is active, a stale GPS error isn't
  // relevant anymore — the app is working via the alternative the user chose.
  const activeError = dataError || (!manualPosition && geoError) || null
  const visibleError = activeError && activeError !== dismissedError ? activeError : null
  const visibleNotice = notice && notice !== dismissedNotice ? notice : null

  const statusLabel = useMemo(() => {
    if (loading) return 'Searching…'
    if (locating && !position) return 'Locating…'
    return null
  }, [loading, locating, position])

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

      {citySearchOpen && <PlaceSearch state={placeSearch} />}

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
          aria-pressed={citySearchOpen}
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
          aria-pressed={pickMode}
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

      {pickMode && <Toast>Tap the map to set your location</Toast>}

      {!pickMode && visibleError && (
        <Toast
          variant="error"
          onDismiss={() => setDismissedError(activeError)}
          action={dataError ? { label: 'Retry', onClick: retry } : undefined}
        >
          {visibleError}
        </Toast>
      )}

      {!pickMode && !visibleError && visibleNotice && (
        <Toast onDismiss={() => setDismissedNotice(notice)}>
          {visibleNotice}
        </Toast>
      )}

      <FountainList
        fountains={fountains}
        status={statusLabel}
        searched={hasSearched}
        userPosition={position}
        open={sheetOpen}
        onToggle={() => setSheetOpen((o) => !o)}
        onSelect={handleSelect}
      />
    </div>
  )
}
