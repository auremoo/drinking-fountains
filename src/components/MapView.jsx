import { memo, useCallback, useEffect, useRef } from 'react'
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import FountainLayer from './FountainLayer.jsx'
import { userIcon } from './mapIcons.js'
import { useAnchor } from '../hooks/useAnchor.js'
import { isValidLatLng } from '../utils/geo.js'
import { readLastView, saveLastView } from '../utils/lastView.js'

/**
 * @typedef {import('../services/overpass.js').Fountain} Fountain
 * @typedef {import('../hooks/useGeolocation.js').GeoPosition} GeoPosition
 */

/** Zoom used when flying to a point (user, picked location, fountain). */
const FOCUS_ZOOM = 16

/** Largest accuracy halo we draw; beyond this it covers the whole screen. */
const MAX_ACCURACY_RADIUS_M = 2000

/**
 * Read the map's current bounds as a `[south, west, north, east]` box.
 *
 * @param {import('leaflet').Map} map
 * @returns {[number, number, number, number]}
 */
function boundsOf(map) {
  try {
    const b = map.getBounds()
    return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]
  } catch {
    // The map can be torn down between an event and a deferred read.
    return null
  }
}

/**
 * Keep a value in a ref so effects can call the latest callback without
 * re-subscribing to Leaflet events on every parent render.
 *
 * @template T
 * @param {T} value
 * @returns {{ current: T }}
 */
function useLatest(value) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

/**
 * Imperatively pans/zooms the map whenever `center` changes.
 *
 * Invalid targets are ignored: `flyTo(NaN, NaN)` throws inside Leaflet and
 * takes the map (and the app) down with it.
 *
 * @param {{ center: GeoPosition | null, zoom?: number }} props
 */
function RecenterOnChange({ center, zoom = FOCUS_ZOOM }) {
  const map = useMap()
  useEffect(() => {
    if (!center || !isValidLatLng(center.lat, center.lng)) return
    try {
      map.flyTo([center.lat, center.lng], zoom, { duration: 0.75 })
    } catch {
      // A failed animation must never break the render tree.
      map.setView([center.lat, center.lng], zoom)
    }
  }, [center, zoom, map])
  return null
}

/**
 * Tells the parent that the view changed: once as soon as the map is ready,
 * then after every pan/zoom.
 *
 * It hands over a **getter**, not a snapshot. The parent debounces these
 * notifications, and Leaflet emits `moveend` during a `flyTo` animation as well
 * as at its end — a snapshot therefore captured mid-flight bounds and made the
 * app search an area the user was only passing over. Reading at the end of the
 * debounce always yields where the map actually came to rest.
 *
 * The initial report is what makes the app useful without geolocation: before
 * it existed, a user who declined the permission prompt sat in front of an
 * empty map until they happened to drag it.
 *
 * @param {{ onSettled: (getBbox: () => [number, number, number, number]|null) => void }} props
 */
function BoundsReporter({ onSettled }) {
  const map = useMap()
  const onSettledRef = useLatest(onSettled)

  const notify = useCallback(() => {
    onSettledRef.current(() => boundsOf(map))
  }, [map, onSettledRef])

  useMapEvents({ moveend: notify })

  useEffect(() => {
    let cancelled = false
    map.whenReady(() => {
      if (!cancelled) notify()
    })
    return () => {
      cancelled = true
    }
  }, [map, notify])

  return null
}

/**
 * Recomputes the map size when the viewport changes.
 *
 * Mobile browsers resize the viewport when the address bar collapses, the
 * on-screen keyboard opens or the device rotates. Leaflet caches its container
 * size, so without this the map ends up with grey bands, mis-placed markers and
 * taps landing on the wrong coordinates.
 */
function ViewportSync() {
  const map = useMap()
  useEffect(() => {
    let frame = 0
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        try {
          map.invalidateSize({ debounceMoveend: true })
        } catch {
          /* map already torn down */
        }
      })
    }
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
    }
  }, [map])
  return null
}

/**
 * While {@link pickMode} is active, reports the lat/lng of the user's next
 * map tap so it can be used as a manual location (for devices/browsers where
 * GPS is unavailable or permission was refused).
 *
 * @param {{ pickMode: boolean, onPick: (lat: number, lng: number) => void }} props
 */
function LocationPicker({ pickMode, onPick }) {
  const stateRef = useLatest({ pickMode, onPick })
  const map = useMapEvents({
    click: (e) => {
      const { pickMode: active, onPick: pick } = stateRef.current
      if (!active || !pick) return
      if (!isValidLatLng(e.latlng?.lat, e.latlng?.lng)) return
      pick(e.latlng.lat, e.latlng.lng)
    },
  })

  // Show a crosshair while picking. The class is toggled on the container
  // directly: `MapContainer` reads its `className` once, on mount, so passing
  // a changing one as a prop silently does nothing.
  useEffect(() => {
    const container = map.getContainer()
    container.classList.toggle('map--picking', pickMode)
    return () => container.classList.remove('map--picking')
  }, [map, pickMode])

  return null
}

/**
 * Remembers where the map comes to rest, so the next launch can open there
 * (see {@link readLastView}).
 */
function ViewMemory() {
  useMapEvents({
    moveend: (e) => {
      try {
        const map = e.target
        const { lat, lng } = map.getCenter()
        saveLastView(lat, lng, map.getZoom())
      } catch {
        /* map torn down mid-event: nothing worth remembering */
      }
    },
  })
  return null
}

/**
 * The full-screen interactive map: OSM tiles, the user's location, an accuracy
 * halo and clustered fountain markers with detail popups.
 *
 * @param {Object} props
 * @param {Fountain[]} props.fountains - Fountains to plot.
 * @param {GeoPosition|null} props.userPosition - Current user location.
 * @param {GeoPosition|null} props.flyTo - Target the map should animate to.
 * @param {(getBbox: () => [number, number, number, number]|null) => void} props.onBoundsChange
 *   - Called once the map is ready and after every move, with a getter for the
 *   current bounds (see {@link BoundsReporter}).
 * @param {boolean} [props.pickMode] - When true, the next map tap is reported
 *   via `onPick` instead of opening a popup.
 * @param {(lat: number, lng: number) => void} [props.onPick] - Called with the
 *   tapped coordinates while `pickMode` is active.
 */
function MapView({
  fountains,
  userPosition,
  flyTo,
  onBoundsChange,
  pickMode = false,
  onPick,
}) {
  // Where to open, in order of preference: on the user if a fix is already
  // known; else where the map was last left, which is very likely where they
  // are again; else Paris, chosen because OSM fountain coverage there is
  // excellent, so a first launch still looks alive.
  // Computed once: `MapContainer` only reads it on mount, and recomputing it
  // on every render invites accidental remounts of the whole map.
  const initialView = useRef(null)
  if (initialView.current === null) {
    const remembered = readLastView()
    initialView.current =
      userPosition && isValidLatLng(userPosition.lat, userPosition.lng)
        ? { center: [userPosition.lat, userPosition.lng], zoom: FOCUS_ZOOM }
        : remembered
          ? { center: [remembered.lat, remembered.lng], zoom: remembered.zoom }
          : { center: [48.8566, 2.3522], zoom: 13 }
  }

  const validUser =
    userPosition && isValidLatLng(userPosition.lat, userPosition.lng)
      ? userPosition
      : null

  // Popup distances only need ~10 m precision; the fountain layer is keyed on
  // this rather than on the raw fix, so GPS jitter never reaches it.
  const anchor = useAnchor(userPosition)

  const accuracyRadius = validUser
    ? Math.min(
        MAX_ACCURACY_RADIUS_M,
        Number.isFinite(validUser.accuracy) ? validUser.accuracy : 0,
      )
    : 0

  const handleBounds = useCallback(
    (getBbox) => onBoundsChange?.(getBbox),
    [onBoundsChange],
  )

  return (
    <MapContainer
      center={initialView.current.center}
      zoom={initialView.current.zoom}
      minZoom={3}
      maxZoom={19}
      zoomControl={false}
      className="map"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
        // Request tiles with CORS. The service worker can then see what it is
        // caching: an opaque (no-CORS) response hides its status, so an error
        // tile gets cached like a good one, and browsers pad each opaque entry
        // by megabytes when counting the app's storage quota.
        crossOrigin="anonymous"
        // Fetch tiles only once the pan settles: fewer requests, less chance of
        // being throttled by the tile servers mid-gesture.
        updateWhenIdle
        keepBuffer={3}
      />

      <RecenterOnChange center={flyTo} />
      <BoundsReporter onSettled={handleBounds} />
      <ViewportSync />
      <LocationPicker pickMode={pickMode} onPick={onPick} />
      <ViewMemory />

      {validUser && (
        <>
          {accuracyRadius > 0 && (
            <Circle
              center={[validUser.lat, validUser.lng]}
              radius={accuracyRadius}
              pathOptions={{ color: '#0ea5e9', weight: 1, fillOpacity: 0.1 }}
            />
          )}
          <Marker position={[validUser.lat, validUser.lng]} icon={userIcon} />
        </>
      )}

      <FountainLayer fountains={fountains} userPosition={anchor} />
    </MapContainer>
  )
}

// Memoized: `App` re-renders for reasons the map does not care about (a
// keystroke in the place search, a toast, the sheet opening).
export default memo(MapView)
