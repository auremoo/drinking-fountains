import { memo, useMemo, useState } from 'react'
import { distanceMeters, formatDistance } from '../utils/distance.js'
import { directionsUrl } from '../utils/directions.js'

/**
 * @typedef {import('../services/overpass.js').Fountain} Fountain
 * @typedef {import('../hooks/useGeolocation.js').GeoPosition} GeoPosition
 */

/**
 * Rows rendered when the sheet opens, and added each time the user scrolls
 * near the end. The list is sorted nearest-first, so the first screenful is
 * what almost everyone came for.
 */
const ROWS_PER_PAGE = 40

/** Distance from the end of the list, in pixels, at which more rows are added. */
const LOAD_MORE_WITHIN_PX = 800

/**
 * A bottom sheet listing nearby fountains, sorted by distance from the user.
 * Tapping an item flies the map to that fountain; the "Go" link opens
 * turn-by-turn directions.
 *
 * Rows are only rendered when someone can see them:
 *
 *  - none while the sheet is closed. It used to keep up to 500 in the page —
 *    rebuilt on every search for a list most visits never open, and reachable
 *    by keyboard and screen readers while off-screen;
 *  - the nearest {@link ROWS_PER_PAGE} when it opens, so the tap is answered at
 *    once, then more as the user scrolls towards the end.
 *
 * Memoized, and every prop is expected to be stable: the parent re-renders on
 * each GPS fix and each keystroke in the place search, none of which concerns
 * the list.
 *
 * @param {Object} props
 * @param {Fountain[]} props.fountains - Fountains in the current area.
 * @param {string|null} [props.status] - Transient status shown instead of the
 *   count ("Searching…", "Locating…").
 * @param {boolean} [props.searched] - True once a search has completed, so the
 *   empty state is not announced before anything has been looked up.
 * @param {GeoPosition|null} props.userPosition - Used to compute distances.
 *   Pass a quantized position (see `useAnchor`): raw GPS jitter would re-sort
 *   the whole list about once a second.
 * @param {boolean} props.open - Whether the sheet is expanded.
 * @param {() => void} props.onToggle - Toggle the sheet open/closed.
 * @param {(fountain: Fountain) => void} props.onSelect - Fly the map to a fountain.
 */
function FountainList({
  fountains,
  status,
  searched = false,
  userPosition,
  open,
  onToggle,
  onSelect,
}) {
  // Rows are mounted on open and unmounted once the closing slide has ended,
  // so the sheet never visibly collapses mid-animation.
  const [showRows, setShowRows] = useState(open)
  if (open && !showRows) setShowRows(true)
  /** How many rows are rendered so far; grows on scroll, resets on close. */
  const [limit, setLimit] = useState(ROWS_PER_PAGE)

  const anchorLat = userPosition ? userPosition.lat : null
  const anchorLng = userPosition ? userPosition.lng : null

  /** Fountains decorated with distance and sorted nearest-first. */
  const ranked = useMemo(() => {
    if (!showRows) return null

    const located = anchorLat !== null && anchorLng !== null
    const withDistance = fountains.map((f) => ({
      ...f,
      distance: located
        ? distanceMeters(anchorLat, anchorLng, f.lat, f.lng)
        : null,
    }))
    if (located) withDistance.sort((a, b) => a.distance - b.distance)
    return withDistance
  }, [showRows, fountains, anchorLat, anchorLng])

  const rows = useMemo(() => {
    if (!ranked) return null
    return ranked.slice(0, limit).map((f) => (
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
    ))
  }, [ranked, limit, onSelect])

  const handleTransitionEnd = (event) => {
    if (open || event.target !== event.currentTarget) return
    if (event.propertyName !== 'transform') return
    setShowRows(false)
    setLimit(ROWS_PER_PAGE)
  }

  const handleScroll = (event) => {
    if (!ranked || limit >= ranked.length) return
    const list = event.currentTarget
    const remaining = list.scrollHeight - list.scrollTop - list.clientHeight
    if (remaining < LOAD_MORE_WITHIN_PX) {
      setLimit((shown) => shown + ROWS_PER_PAGE)
    }
  }

  return (
    <section
      className={`sheet ${open ? 'sheet--open' : ''}`}
      aria-label="Nearby fountains"
      onTransitionEnd={handleTransitionEnd}
    >
      <button className="sheet__handle" onClick={onToggle} aria-expanded={open}>
        <span className="sheet__grip" aria-hidden="true" />
        {status ??
          `${fountains.length} fountain${fountains.length === 1 ? '' : 's'} nearby`}
      </button>

      <ul className="sheet__list" onScroll={handleScroll}>
        {rows && rows.length === 0 && (
          <li className="sheet__empty">
            {searched
              ? 'No fountains found here. Move the map or zoom in — the area is searched automatically.'
              : 'Looking for fountains around you…'}
          </li>
        )}
        {rows}
      </ul>
    </section>
  )
}

export default memo(FountainList)
