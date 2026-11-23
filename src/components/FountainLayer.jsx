import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
// Side-effect import: registers `L.markerClusterGroup` on the Leaflet global.
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { useMap } from 'react-leaflet'
import { fountainIcon } from './mapIcons.js'
import { directionsUrl } from '../utils/directions.js'
import { distanceMeters, formatDistance } from '../utils/distance.js'
import { isValidLatLng } from '../utils/geo.js'

/**
 * @typedef {import('../services/overpass.js').Fountain} Fountain
 * @typedef {import('../hooks/useGeolocation.js').GeoPosition} GeoPosition
 */

/** Below this many departures, removing them individually is cheap enough. */
const REBUILD_MIN_REMOVED = 25

/**
 * Rebuild the whole group once the markers leaving exceed a third of those
 * staying. Found by measurement: removal is far dearer than insertion, but a
 * rebuild also redraws everything on screen, so below this share it loses.
 */
const REBUILD_STAYING_PER_REMOVED = 3

/**
 * Write "120 m away" into a popup's distance line, or hide the line when the
 * user's position is unknown.
 *
 * @param {HTMLElement} el
 * @param {Fountain} fountain
 * @param {GeoPosition|null} user
 */
function writeDistance(el, fountain, user) {
  el.hidden = !user
  el.textContent = user
    ? `${formatDistance(
        distanceMeters(user.lat, user.lng, fountain.lat, fountain.lng),
      )} away`
    : ''
}

/**
 * Build a fountain's popup.
 *
 * Plain DOM with `textContent`, never `innerHTML`: the name comes straight
 * from OpenStreetMap, which anyone can edit.
 *
 * @param {Fountain} fountain
 * @param {GeoPosition|null} user
 * @returns {{ root: HTMLElement, distance: HTMLElement }}
 */
function buildPopup(fountain, user) {
  const root = document.createElement('div')

  const title = document.createElement('strong')
  title.textContent = fountain.name || 'Drinking water'

  const distance = document.createElement('div')
  distance.className = 'popup-distance'
  writeDistance(distance, fountain, user)

  const link = document.createElement('a')
  link.className = 'popup-directions'
  link.href = directionsUrl(fountain.lat, fountain.lng)
  link.target = '_blank'
  link.rel = 'noreferrer'
  link.textContent = 'Directions'

  root.append(title, distance, link)
  return { root, distance }
}

/**
 * The clustered fountain markers.
 *
 * Driven imperatively rather than as one React component per marker, because
 * that is where the map used to spend its time:
 *
 *  - **Results are diffed by id.** A pan-triggered search mostly returns
 *    fountains already on screen. Only the ones that appeared or disappeared
 *    touch the cluster, in two bulk calls — re-rendering a `<Marker>` instead
 *    re-set its position, which makes the cluster remove and re-insert it, for
 *    every marker, on every search.
 *  - **Popups are built when opened.** A few hundred markers no longer cost a
 *    few hundred popup trees that nobody looks at.
 *  - **Nothing here re-renders** when the user moves; an open popup's distance
 *    is patched in place.
 *
 * @param {Object} props
 * @param {Fountain[]} props.fountains - Fountains to plot.
 * @param {GeoPosition|null} props.userPosition - Reference point for popup
 *   distances. Pass a stable (quantized) object: its identity is what triggers
 *   a refresh.
 */
function FountainLayer({ fountains, userPosition }) {
  const map = useMap()
  /** @type {{ current: import('leaflet').MarkerClusterGroup|null }} */
  const groupRef = useRef(null)
  /** Markers currently in the cluster, by fountain id. */
  const markersRef = useRef(/** @type {Map<string, import('leaflet').Marker>} */ (new Map()))
  /** The popup most recently built, so its distance can be kept current. */
  const openRef = useRef(
    /** @type {{ marker: import('leaflet').Marker, distance: HTMLElement }|null} */ (null),
  )
  const userRef = useRef(userPosition)
  userRef.current = userPosition

  // The cluster group lives exactly as long as the map does.
  useEffect(() => {
    const group = L.markerClusterGroup({ removeOutsideVisibleBounds: true })
    groupRef.current = group
    map.addLayer(group)
    // The same Map object for the component's whole life (it is mutated in
    // place below), so emptying it here is what the next mount will see.
    const markers = markersRef.current
    return () => {
      groupRef.current = null
      openRef.current = null
      markers.clear()
      try {
        map.removeLayer(group)
      } catch {
        /* map already torn down */
      }
    }
  }, [map])

  // Reconcile the markers with the latest result set.
  useEffect(() => {
    const group = groupRef.current
    if (!group) return

    const markers = markersRef.current
    const seen = new Set()
    const added = []
    const removed = []

    for (const fountain of fountains) {
      // Defence in depth: the service already filters bad coordinates, but a
      // single invalid marker throws inside Leaflet and blanks the screen.
      if (!isValidLatLng(fountain.lat, fountain.lng) || seen.has(fountain.id)) {
        continue
      }
      seen.add(fountain.id)

      let marker = markers.get(fountain.id)
      if (marker) {
        const at = marker.getLatLng()
        // Moved in OSM since the last search: replace rather than relocate.
        if (at.lat !== fountain.lat || at.lng !== fountain.lng) {
          removed.push(marker)
          marker = undefined
        }
      }
      if (!marker) {
        marker = L.marker([fountain.lat, fountain.lng], { icon: fountainIcon })
        // Leaflet calls this each time the popup opens.
        marker.bindPopup((layer) => {
          const { root, distance } = buildPopup(layer.fountain, userRef.current)
          openRef.current = { marker: layer, distance }
          return root
        })
        markers.set(fountain.id, marker)
        added.push(marker)
      }
      // Always point at the freshest data (a name can change between searches).
      marker.fountain = fountain
    }

    markers.forEach((marker, id) => {
      if (seen.has(id)) return
      removed.push(marker)
      markers.delete(id)
    })

    // Taking markers out of a cluster one by one costs about ten times what
    // putting one in does (each removal walks every zoom level). Once a large
    // share is leaving — an ordinary pan across a dense city — emptying the
    // group and re-adding the survivors in bulk is cheaper. It all happens
    // before the next paint, so nothing flickers; but it would close an open
    // popup, so that case keeps the gentle path.
    const open = openRef.current
    const popupStays =
      open !== null &&
      open.marker.isPopupOpen() &&
      markers.get(open.marker.fountain.id) === open.marker
    const kept = markers.size - added.length
    const rebuild =
      !popupStays &&
      removed.length > REBUILD_MIN_REMOVED &&
      removed.length * REBUILD_STAYING_PER_REMOVED > kept

    if (rebuild) {
      group.clearLayers()
      group.addLayers([...markers.values()])
    } else {
      if (removed.length) group.removeLayers(removed)
      if (added.length) group.addLayers(added)
    }
  }, [fountains, map])

  // Keep an open popup's distance in step with the user.
  useEffect(() => {
    const open = openRef.current
    if (!open || !open.marker.isPopupOpen()) return
    writeDistance(open.distance, open.marker.fountain, userPosition)
  }, [userPosition])

  return null
}

export default memo(FountainLayer)
