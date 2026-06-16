# Architecture

This document explains how the app is put together and the reasoning behind the
main decisions. The code itself is heavily commented with JSDoc; this is the
"why", not the "what".

## Goals

1. Show drinking-water fountains around the user on a map.
2. Be **precise in large cities worldwide** → use OpenStreetMap.
3. Be a **responsive, installable PWA**.
4. Be **well structured and documented** so it is easy to extend.

## High-level flow

```
┌─────────────┐   first fix    ┌──────────────┐
│ useGeolocation │ ───────────► │    App.jsx   │
└─────────────┘                └──────┬───────┘
        ▲ recenter                    │ bbox
        │                             ▼
   ┌────┴─────┐               ┌───────────────┐   POST   ┌────────────┐
   │ controls │               │ useFountains  │ ───────► │ overpass.js│
   └──────────┘               └──────┬────────┘          └─────┬──────┘
                                     │ fountains               │ OSM
                          ┌──────────┴──────────┐              ▼
                          ▼                     ▼        Overpass API
                    ┌──────────┐         ┌──────────────┐
                    │ MapView  │         │ FountainList │
                    └──────────┘         └──────────────┘
```

## Layers

### Services (`src/services/overpass.js`)
The only place that knows about OpenStreetMap. It builds an Overpass QL query
for a bounding box, posts it, and **normalizes** the raw OSM elements into a
small, stable `Fountain` shape. Keeping this isolated means the rest of the app
is decoupled from the data source — swapping in a different provider would only
touch this file.

Resilience: it tries multiple public Overpass mirrors in order, and supports
request cancellation via `AbortSignal`.

### Hooks (`src/hooks/`)
- **`useGeolocation`** wraps `navigator.geolocation.watchPosition` so the user
  dot tracks movement, and exposes an imperative `locate()` for the recenter
  button. All permission/error states are mapped to friendly messages.
- **`useFountains`** owns the dataset and request lifecycle. Concurrent searches
  are **coalesced** — a new search aborts the previous in-flight request so the
  UI always reflects the latest query.

### Components (`src/components/`)
- **`MapView`** is the Leaflet map. Helper child components
  (`RecenterOnChange`, `BoundsReporter`) use `react-leaflet` hooks to bridge
  React state and the imperative Leaflet instance. Markers are **clustered** so
  dense city centres remain legible.
- **`FountainList`** is a bottom sheet that sorts fountains by distance and
  offers "fly to" and "directions" actions.

### Utils (`src/utils/`)
Pure, dependency-free functions: haversine `distance` + formatting, and the
maps `directions` deep-link builder. Pure functions are trivial to test and
reuse.

### State ownership (`src/App.jsx`)
`App` is the single source of truth and orchestrator. It:
- runs **one** automatic search around the user on the first GPS fix,
- keeps the latest map bounds in a `ref` (so panning doesn't re-render),
- drives `flyTo` animations for recenter and list selection.

## Key decisions

| Decision | Why |
| --- | --- |
| **OpenStreetMap / Overpass** | Most complete, precise, free, key-less dataset for fountains in big cities worldwide. |
| **Leaflet + react-leaflet** | Mature, lightweight, works great with free OSM tiles; no billing or token. |
| **Clustering** | City centres can have hundreds of fountains; clustering keeps the map usable. |
| **"Search this area" button** | Avoids hammering Overpass on every pan; user controls when to refetch (Overpass has usage limits). |
| **`divIcon` SVG markers** | Sidesteps the classic Leaflet+bundler broken-marker-image issue and stays crisp on retina. |
| **App-shell-only PWA caching** | Keeps fountain data and tiles fresh while still giving instant repeat loads; full offline data is a roadmap item. |

## Rate limiting & etiquette

The public Overpass API is a shared community resource. We are gentle with it:
queries are bounded by the visible bbox, triggered explicitly via "Search this
area", have a server-side `timeout:25`, and old requests are aborted. For heavy
or production traffic, host your own Overpass instance or pre-process an extract.

## Testing the data layer

`overpass.js` and the `utils/*` modules are pure and side-effect-light, making
them the natural first targets for unit tests (e.g. with Vitest):
- `distanceMeters` against known city-to-city distances,
- `normalize` against sample Overpass element fixtures,
- `buildQuery` snapshotting the generated QL.
