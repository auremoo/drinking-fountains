import { useMemo } from 'react'
import { distanceMeters, formatDistance } from '../utils/distance.js'
import { directionsUrl } from '../utils/directions.js'

/**
 * @typedef {import('../services/overpass.js').Fountain} Fountain
 * @typedef {import('../hooks/useGeolocation.js').GeoPosition} GeoPosition
 */

/**
 * A bottom sheet listing nearby fountains, sorted by distance from the user.
 * Tapping an item flies the map to that fountain; the "Go" link opens
 * turn-by-turn directions.
 *
 * @param {Object} props
 * @param {Fountain[]} props.fountains - Fountains in the current area.
 * @param {GeoPosition|null} props.userPosition - Used to compute distances.
 * @param {boolean} props.open - Whether the sheet is expanded.
 * @param {() => void} props.onToggle - Toggle the sheet open/closed.
 * @param {(fountain: Fountain) => void} props.onSelect - Fly the map to a fountain.
 */
export default function FountainList({
  fountains,
  userPosition,
  open,
  onToggle,
  onSelect,
}) {
  /** Fountains decorated with distance and sorted nearest-first. */
  const ranked = useMemo(() => {
    const withDistance = fountains.map((f) => ({
      ...f,
      distance: userPosition
        ? distanceMeters(userPosition.lat, userPosition.lng, f.lat, f.lng)
        : null,
    }))
    if (userPosition) withDistance.sort((a, b) => a.distance - b.distance)
    return withDistance
  }, [fountains, userPosition])

  return (
    <section className={`sheet ${open ? 'sheet--open' : ''}`} aria-label="Nearby fountains">
      <button className="sheet__handle" onClick={onToggle} aria-expanded={open}>
        <span className="sheet__grip" aria-hidden="true" />
        {fountains.length} fountain{fountains.length === 1 ? '' : 's'} nearby
      </button>

      <ul className="sheet__list">
        {ranked.length === 0 && (
          <li className="sheet__empty">
            No fountains found in this area. Try moving the map and searching
            again.
          </li>
        )}
        {ranked.map((f) => (
          <li key={f.id} className="fountain-item">
            <button className="fountain-item__main" onClick={() => onSelect(f)}>
              <span className="fountain-item__name">
                {f.name || 'Drinking water'}
              </span>
              <span className="fountain-item__meta">
                {f.distance != null && formatDistance(f.distance)}
                {f.wheelchair && <span title="Wheelchair accessible"> ♿</span>}
              </span>
            </button>
            <a
              className="fountain-item__go"
              href={directionsUrl(f.lat, f.lng)}
              target="_blank"
              rel="noreferrer"
            >
              Go
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
