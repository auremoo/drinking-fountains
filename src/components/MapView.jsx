import { useEffect } from 'react'
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { fountainIcon, userIcon } from './mapIcons.js'
import { directionsUrl } from '../utils/directions.js'
import { formatDistance, distanceMeters } from '../utils/distance.js'

/**
 * @typedef {import('../services/overpass.js').Fountain} Fountain
 * @typedef {import('../hooks/useGeolocation.js').GeoPosition} GeoPosition
 */

/**
 * Imperatively pans/zooms the map whenever `center` changes. Rendered as a
 * child of {@link MapContainer} so it can access the Leaflet map instance.
 *
 * @param {{ center: GeoPosition | null, zoom?: number }} props
 */
function RecenterOnChange({ center, zoom = 16 }) {
  const map = useMap()
  useEffect(() => {
    if (center) map.flyTo([center.lat, center.lng], zoom, { duration: 0.75 })
  }, [center, zoom, map])
  return null
}

/**
 * Reports the map's current bounding box to the parent after the user finishes
 * panning or zooming, enabling the "Search this area" workflow.
 *
 * @param {{ onMoved: (bbox: [number, number, number, number]) => void }} props
 */
function BoundsReporter({ onMoved }) {
  useMapEvents({
    moveend: (e) => {
      const b = e.target.getBounds()
      onMoved([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()])
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
 * @param {(bbox: [number, number, number, number]) => void} props.onBoundsChange
 *   - Called with the new bounds whenever the user moves the map.
 */
export default function MapView({
  fountains,
  userPosition,
  flyTo,
  onBoundsChange,
}) {
  // Default view: Paris, until we get a real fix. Chosen because OSM fountain
  // coverage there is excellent, so the empty state still looks alive.
  const initialCenter = userPosition
    ? [userPosition.lat, userPosition.lng]
    : [48.8566, 2.3522]

  return (
    <MapContainer
      center={initialCenter}
      zoom={userPosition ? 16 : 13}
      zoomControl={false}
      className="map"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />

      <RecenterOnChange center={flyTo} />
      <BoundsReporter onMoved={onBoundsChange} />

      {userPosition && (
        <>
          <Circle
            center={[userPosition.lat, userPosition.lng]}
            radius={userPosition.accuracy}
            pathOptions={{ color: '#0ea5e9', weight: 1, fillOpacity: 0.1 }}
          />
          <Marker
            position={[userPosition.lat, userPosition.lng]}
            icon={userIcon}
          />
        </>
      )}

      <MarkerClusterGroup chunkedLoading>
        {fountains.map((f) => (
          <Marker key={f.id} position={[f.lat, f.lng]} icon={fountainIcon}>
            <Popup>
              <strong>{f.name || 'Drinking water'}</strong>
              {userPosition && (
                <div className="popup-distance">
                  {formatDistance(
                    distanceMeters(
                      userPosition.lat,
                      userPosition.lng,
                      f.lat,
                      f.lng,
                    ),
                  )}{' '}
                  away
                </div>
              )}
              <a
                className="popup-directions"
                href={directionsUrl(f.lat, f.lng)}
                target="_blank"
                rel="noreferrer"
              >
                Directions
              </a>
            </Popup>
          </Marker>
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  )
}
