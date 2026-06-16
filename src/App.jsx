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

/**
 * Root application component.
 *
 * Responsibilities:
 *  - wires geolocation and the fountain dataset together,
 *  - performs one automatic search around the user on first fix,
 *  - exposes "recenter on me" and "search this area" controls,
 *  - coordinates the map view and the bottom-sheet list.
 */
export default function App() {
  const { position, error: geoError, locate } = useGeolocation()
  const { fountains, loading, error: dataError, search } = useFountains()

  /** Position the map should animate to (recenter button / list selection). */
  const [flyTo, setFlyTo] = useState(null)
  /** Latest map bounds, kept in a ref to avoid re-renders on every pan. */
  const currentBbox = useRef(null)
  /** Ensures the automatic "near me" search only runs once. */
  const autoSearched = useRef(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  // On the first GPS fix: center the map and search the surrounding area.
  useEffect(() => {
    if (!position || autoSearched.current) return
    autoSearched.current = true
    setFlyTo({ ...position })
    search([
      position.lat - AUTO_SEARCH_HALF_DEG,
      position.lng - AUTO_SEARCH_HALF_DEG,
      position.lat + AUTO_SEARCH_HALF_DEG,
      position.lng + AUTO_SEARCH_HALF_DEG,
    ])
  }, [position, search])

  const handleBoundsChange = useCallback((bbox) => {
    currentBbox.current = bbox
  }, [])

  const handleRecenter = useCallback(() => {
    locate()
    if (position) setFlyTo({ ...position }) // new object ref re-triggers flyTo
  }, [locate, position])

  const handleSearchArea = useCallback(() => {
    if (currentBbox.current) search(currentBbox.current)
  }, [search])

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
          className="btn btn--icon"
          onClick={handleRecenter}
          aria-label="Recenter on my location"
          title="Recenter on my location"
        >
          ◎
        </button>
      </div>

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
