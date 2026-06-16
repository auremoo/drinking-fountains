# 💧 Drinking Fountains

A mobile-first, **installable PWA** that shows the publicly available
drinking-water fountains around you on a map. Data comes from
**OpenStreetMap** — the most complete, precise and free source of street
furniture for large cities worldwide.

![tech](https://img.shields.io/badge/React-18-149eca)
![tech](https://img.shields.io/badge/Vite-5-646cff)
![tech](https://img.shields.io/badge/Leaflet-1.9-199900)
![pwa](https://img.shields.io/badge/PWA-installable-5a0fc8)

---

## Features

- 🗺️ **Live map** of nearby drinking-water fountains (OpenStreetMap tiles).
- 📍 **Geolocation** with a pulsing "you are here" dot and accuracy halo, plus a
  one-tap **recenter** button.
- 🔍 **"Search this area"** — pan/zoom anywhere and refresh the fountains for the
  visible map.
- 📋 **Nearby list** in a bottom sheet, sorted by distance; tap to fly the map to
  a fountain.
- 🧭 **Directions** — one tap opens walking directions in Google/Apple Maps.
- 🌀 **Marker clustering** so dense city centres stay readable.
- 📱 **PWA** — installable to the home screen, with a cached app shell for
  instant loads.

## Quick start

```bash
npm install
npm run dev        # start the dev server (http://localhost:5173)
```

> **Geolocation note:** browsers only grant location access over `https://` or
> `http://localhost`. `npm run dev` on localhost works out of the box.

### Production build

```bash
npm run build      # outputs static files to dist/
npm run preview    # serve the production build locally
```

The `dist/` folder is a fully static site — deploy it to GitHub Pages, Netlify,
Vercel, Cloudflare Pages, or any static host.

## How it works

The app queries the public **Overpass API** for OSM elements tagged
`amenity=drinking_water` (plus a few common variants) inside the current map
bounding box, normalizes them, and plots them. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.

```
You ──locate──► Geolocation API
            └─► bounding box ──► Overpass API ──► fountains ──► Map + List
```

## Project structure

```
src/
├── main.jsx                # App entry; imports Leaflet + global CSS
├── App.jsx                 # Top-level state & control flow
├── styles.css              # Global, mobile-first styles
├── components/
│   ├── MapView.jsx         # Leaflet map, markers, clustering, popups
│   ├── FountainList.jsx    # Distance-sorted bottom-sheet list
│   └── mapIcons.js         # Custom SVG Leaflet markers
├── hooks/
│   ├── useGeolocation.js   # Wraps the browser Geolocation API
│   └── useFountains.js     # Owns the dataset + request lifecycle
├── services/
│   └── overpass.js         # Overpass API client (query + normalize)
└── utils/
    ├── distance.js         # Haversine distance + formatting
    └── directions.js       # Maps deep-link builder
```

## Data & attribution

Map data and fountains © **OpenStreetMap contributors**, available under the
[Open Database License (ODbL)](https://www.openstreetmap.org/copyright).
Fountain data is fetched live from the [Overpass API](https://overpass-api.de/).

Missing a fountain? **[Add it to OpenStreetMap](https://www.openstreetmap.org/)**
with `amenity=drinking_water` and it will appear here.

## Roadmap ideas

- Offline data caching (last viewed fountains + tiles) for fully offline use.
- Filters (wheelchair access, bottle-fill suitable, fee).
- Crowd-sourced status reports (working / out of order).

## License

MIT — see [`LICENSE`](LICENSE). Note that the *data* served by the app is ODbL
(OpenStreetMap), which is separate from this source code's license.
