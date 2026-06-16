import L from 'leaflet'

/**
 * Custom Leaflet icons rendered as inline SVG `divIcon`s. Using `divIcon`
 * avoids the well-known Leaflet/bundler problem of broken default marker image
 * paths, and keeps the icons crisp on high-DPI screens.
 * @module components/mapIcons
 */

/** Marker for a drinking-water fountain. */
export const fountainIcon = L.divIcon({
  className: 'marker marker--fountain',
  html: `
    <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
      <path fill="#0ea5e9" stroke="#ffffff" stroke-width="1.5"
        d="M12 2c5 0 9 4 9 9 0 6-9 11-9 11S3 17 3 11c0-5 4-9 9-9z"/>
      <circle cx="12" cy="11" r="3.2" fill="#ffffff"/>
    </svg>`,
  iconSize: [34, 34],
  iconAnchor: [17, 33],
  popupAnchor: [0, -30],
})

/** Pulsing dot marking the user's current location. */
export const userIcon = L.divIcon({
  className: 'marker marker--user',
  html: '<span class="user-dot"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})
