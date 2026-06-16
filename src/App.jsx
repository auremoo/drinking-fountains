import { useCallback, useEffect, useRef, useState } from 'react'
import MapView from './components/MapView.jsx'
import FountainList from './components/FountainList.jsx'
import { useGeolocation } from './hooks/useGeolocation.js'
import { useFountains } from './hooks/useFountains.js'

/**
 * Half-width/height (in degrees) of the bounding box used for the first
 * automatic search around the user. ~0.012° ≈ 1.3 km, a comfortable walking
 * radius that keeps the Overpass response fast.
 */
const AUTO_SEARCH_HALF_DEG = 0.012

/** Search a bbox of this half-width/height (degrees) around a manually-picked point. */
const PICK_SEARCH_HALF_DEG = AUTO_SEARCH_HALF_DEG

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

  /** Position chosen by tapping the map, overriding the GPS fix until cleared. */
  const [manualPosition, setManualPosition] = useState(null)
  /** True while the user is asked to tap the map to set their location. */
  const [pickMode, setPickMode] = useState(false)
  /** Position the map should animate to (recenter button / list selection). */
  const [flyTo, setFlyTo] = useState(null)
  /** Latest map bounds, kept in a ref to avoid re-renders on every pan. */
  const currentBbox = useRef(null)
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

  const handleBoundsChange = useCallback((bbox) => {
    currentBbox.current = bbox
  }, [])

  const handleRecenter = useCallback(() => {
    setManualPosition(null) // go back to tracking GPS
    locate() // called directly from this click handler so Safari shows the permission prompt
    if (gpsPosition) setFlyTo({ ...gpsPosition }) // new object ref re-triggers flyTo
  }, [locate, gpsPosition])

  const handleSearchArea = useCallback(() => {
    if (currentBbox.current) search(currentBbox.current)
  }, [search])

  const handlePick = useCallback(
    (lat, lng) => {
      setPickMode(false)
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

  const handleSelect = useCallback((fountain) => {
    setFlyTo({ lat: fountain.lat, lng: fountain.lng, accuracy: 0 })
    setSheetOpen(false)
  }, [])

  const error = dataError || geoError

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

      <div className="controls">
        <button
          className="btn btn--primary"
          onClick={handleSearchArea}
          disabled={loading}
        >
          {loading ? 'Searching…' : 'Search this area'}
        </button>
        <button
          className={
            pickMode ? 'btn btn--icon btn--icon-active' : 'btn btn--icon'
          }
          onClick={() => setPickMode((on) => !on)}
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
        <div className="toast toast--info" role="status">
          Tap the map to set your location
        </div>
      )}

      {error && <div className="toast toast--error" role="alert">{error}</div>}

      <FountainList
        fountains={fountains}
        userPosition={position}
        open={sheetOpen}
        onToggle={() => setSheetOpen((o) => !o)}
        onSelect={handleSelect}
      />
    </div>
  )
}
