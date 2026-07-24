> Créé par **Aurélien Moote - Moo - 2026**. Logiciel libre (licence MIT) :
> réutilisable à condition de conserver la mention de l'auteur.

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
- 🔍 **Automatic area search** — pan or zoom anywhere and the visible area is
  searched for you, without re-querying areas already loaded.
- 🏙️ **Place search** — type a city or address (with type-ahead) or drop a pin,
  for when GPS is unavailable or refused.
- 📋 **Nearby list** in a bottom sheet, sorted by distance; tap to fly the map to
  a fountain.
- 🧭 **Directions** — one tap opens walking directions in Google/Apple Maps.
- 🌀 **Marker clustering** so dense city centres stay readable.
- 📱 **PWA** — installable to the home screen, with a cached app shell for
  instant loads.
- 🛟 **Resilient by design** — several Overpass mirrors queried in parallel,
  short-lived caching, backoff when a server is saturated, and clear, retryable
  errors instead of a spinner that never ends. See
  [Reliability](#reliability) below.

## Quick start

```bash
npm install
npm run dev        # start the dev server (http://localhost:5173)
npm test           # run the unit tests
npm run lint       # lint
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
├── main.jsx                # App entry; error logging, Leaflet + global CSS
├── App.jsx                 # Top-level state & control flow
├── styles.css              # Global, mobile-first styles
├── components/
│   ├── MapView.jsx         # Leaflet map, markers, clustering, popups
│   ├── FountainList.jsx    # Distance-sorted bottom-sheet list
│   ├── PlaceSearch.jsx     # City/address search panel
│   ├── Toast.jsx           # Errors, hints and notices
│   ├── ErrorBoundary.jsx   # Crash screen with reload / reset / copy details
│   └── mapIcons.js         # Custom SVG Leaflet markers
├── hooks/
│   ├── useGeolocation.js   # Wraps the browser Geolocation API
│   ├── useFountains.js     # Owns the dataset + request lifecycle
│   └── usePlaceSearch.js   # Type-ahead + geocoding state
├── services/
│   ├── http.js             # Timeouts, abort handling, hedged mirrors
│   ├── overpass.js         # Overpass API client (query + normalize + cache)
│   └── geocode.js          # Place search (Photon + Nominatim)
└── utils/
    ├── geo.js              # Coordinate/bbox validation and maths
    ├── searchPlan.js       # When to search — the reliability policy
    ├── distance.js         # Haversine distance + formatting
    ├── directions.js       # Maps deep-link builder
    ├── errorLog.js         # Persisted error log for bug reports
    └── appReset.js         # Service-worker / cache recovery
```

Every `*.test.js` file sits next to the module it covers; `npm test` runs them
in Node with `fetch` stubbed (no network, no browser).

## Reliability

The app depends on free, community-run services that are occasionally slow,
saturated or down. Rather than hoping otherwise, it is built to keep working:

| Failure | What the app does |
| --- | --- |
| An Overpass mirror is down or silent | Three mirrors are queried with a 3.5 s stagger; the first usable answer wins |
| Every mirror fails | Keeps the fountains already on screen, shows a plain-language error with a **Retry** button |
| A server answers "too many requests" | Automatic searches back off exponentially (6 s → 60 s) instead of piling on |
| The user pans a few streets | No request at all — searches are padded and their coverage remembered for 3 minutes |
| The user zooms out to a whole region | No request; a "zoom in" notice, instead of a query that would time out |
| A slow answer arrives after a newer search | Discarded — results can never overwrite fresher ones |
| The data contains broken coordinates | Filtered out before reaching Leaflet, which would otherwise throw and blank the screen |
| A dense city returns thousands of fountains | Capped at the 500 nearest, with a notice |
| Location permission is refused | The visible area is still searched; pin-drop and place search remain available |
| A render error escapes anyway | An error screen with **Reload**, **Reset app data** and **Copy details** — never a white page |

Recorded errors (including ones that only happened once) can be copied from that
error screen and pasted into a bug report.

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

## Auteur & licence

**Aurélien Moote - Moo - 2026**
Copyright (c) 2026 Aurélien Moote ("Moo") — https://github.com/auremoo/drinking-fountains

Logiciel libre distribué sous licence **MIT** — voir [`LICENSE`](LICENSE).
Réutilisable à condition de conserver la mention de l'auteur.

Note : les *données* cartographiques servies par l'app sont sous ODbL
(OpenStreetMap contributors), indépendante de la licence MIT du code source.

## License

MIT — see [`LICENSE`](LICENSE). Note that the *data* served by the app is ODbL
(OpenStreetMap), which is separate from this source code's license.
