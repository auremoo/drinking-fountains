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

### Services (`src/services/`)
The only place that knows about the outside world.

- **`http.js`** is the transport floor everything else stands on: a `fetchJson`
  that always settles (own timeout, honours the caller's `AbortSignal`, refuses
  to fire at all for an already-aborted one), typed `HttpError`s, and
  `raceWithHedging`, which queries interchangeable providers with a small
  stagger and keeps the first success.
- **`overpass.js`** builds the Overpass QL query for a bounding box, runs it
  against two planet-wide mirrors via `raceWithHedging`, and **normalizes** raw OSM
  elements into a small, stable `Fountain` shape. It validates every coordinate,
  de-duplicates elements matched by several query clauses, caps huge result
  sets, and caches answers for five minutes.
- **`geocode.js`** resolves place names through Photon and Nominatim, with the
  same hedging and the same defensive parsing.

Keeping this isolated means the rest of the app is decoupled from the data
source — swapping in a different provider would only touch these files.

### Hooks (`src/hooks/`)
- **`useGeolocation`** wraps `navigator.geolocation.watchPosition` so the user
  dot tracks movement, and exposes an imperative `locate()` for the recenter
  button. It stops watching after a denial, ignores transient failures once a
  fix exists, falls back to a coarse fix when a precise one times out, and
  refuses a cached position for any fix the user explicitly asked for.
- **`useFountains`** owns the dataset and request lifecycle: request tokens so a
  stale answer can never overwrite a newer one, exponential backoff after
  failures, previous results preserved on error, and a `retry()` that bypasses
  every cache.
- **`usePlaceSearch`** owns the debounced type-ahead and submission, including
  cancelling in-flight lookups when the panel closes.

### Components (`src/components/`)
- **`MapView`** is the Leaflet map. Helper child components
  (`RecenterOnChange`, `BoundsReporter`, `ViewportSync`, `LocationPicker`,
  `ViewMemory`) use `react-leaflet` hooks to bridge React state and the
  imperative Leaflet instance.
- **`FountainLayer`** draws the fountains, **clustered** so dense city centres
  remain legible. It drives `leaflet.markercluster` directly instead of
  rendering one React component per marker (see *Rendering cost* below).
- **`FountainList`** is a bottom sheet that sorts fountains by distance and
  offers "fly to" and "directions" actions. Its rows exist only while it is
  open, and only as far as the user has scrolled.
- **`PlaceSearch`** and **`Toast`** are presentational.
- **`ErrorBoundary`** turns a render-time crash into a screen with *Reload*,
  *Reset app data* and *Copy details*, instead of a blank page.

### Utils (`src/utils/`)
Pure, dependency-free functions — trivial to test and reuse: `geo` (coordinate
and bbox validation/maths), `searchPlan` (the search policy, see below),
`distance`, `directions`, `lastView` (the remembered map view), plus `errorLog`
and `appReset` for diagnostics and recovery.

### State ownership (`src/App.jsx`)
`App` is the single source of truth and orchestrator. It:
- funnels GPS fixes, dropped pins and geocoded places into one "current
  position",
- centres on the user as soon as a fix arrives (on load, or after *recenter*),
- forwards every settled map view to `useFountains`, which decides on its own
  whether a request is warranted,
- drives `flyTo` animations for recenter and list selection.

Two moments get special treatment, because both are when the position the app
believes in is most likely to be wrong: the user tapping *locate me*, and the
app returning to the foreground after more than 30 seconds away. In both cases a
**fresh** fix is requested, and the app stays armed to re-centre and re-search on
the fix that comes back — never on the one it already had. iOS suspends the page
and stops the position watch, so "the position I know" can be a whole trip old.

It holds **no flag describing what the search layer should do**. An earlier
version kept a `suppressNextPanSearch` boolean to stop programmatic map moves
from re-triggering a search; when a fly-to did not produce the expected
`moveend`, the flag stayed set and the app silently stopped searching until
reload. Replacing it with a policy that derives its decision from observable
state (what is covered, what is in flight, what recently failed) removed that
class of bug entirely.

## Key decisions

| Decision | Why |
| --- | --- |
| **OpenStreetMap / Overpass** | Most complete, precise, free, key-less dataset for fountains in big cities worldwide. |
| **Leaflet + react-leaflet** | Mature, lightweight, works great with free OSM tiles; no billing or token. |
| **Clustering** | City centres can have hundreds of fountains; clustering keeps the map usable. |
| **Automatic search + a coverage policy** | A button the user must find and press is a worse experience than a map that just loads; the policy in `searchPlan.js` is what keeps that from hammering Overpass. |
| **Hedged mirrors instead of sequential fallback** | Sequential fallback makes a *silent* mirror cost a full timeout before the next one is tried. Hedging bounds that at 3.5 s, which is the difference between "slow" and "broken". |
| **`divIcon` SVG markers** | Sidesteps the classic Leaflet+bundler broken-marker-image issue and stays crisp on retina. |
| **App-shell-only PWA caching** | Keeps fountain data and tiles fresh while still giving instant repeat loads; full offline data is a roadmap item. |
| **Open on the last view** | Until a fix arrives (seconds on a cold start, never when location is refused) the app must show something. The area last looked at is usually the right one, so its tiles and first search are useful instead of a detour through the default city. Stored on the device only (`utils/lastView.js`); "Reset app data" clears it. |
| **Vendor code in its own chunk** | React and Leaflet are 90% of the JavaScript and change only on a dependency bump; split out, an app release re-downloads ~11 kB instead of ~110 kB. |
| **Tiles fetched with CORS** | Lets the service worker store only genuine 200s, and avoids the multi-megabyte quota padding browsers apply to each opaque response. |

## The search policy (`src/utils/searchPlan.js`)

Deciding **when not to call Overpass** is the most important reliability rule in
the app: too many calls means rate-limit failures, too few means stale or
missing data. That decision is a pure function, `planSearch()`, which returns
one of `search` / `covered` / `inflight` / `backoff` / `too-large` / `invalid`.

```
map settles ──► debounce 500 ms ──► read bounds NOW ──► planSearch()
                                                          │
     covered · inflight · backoff · too-large ◄────────────┤
                                                          ▼
                                                   pad bbox 30% ──► Overpass
```

Two details matter more than they look:

- **Bounds are read when the debounce expires**, not when it is armed. Leaflet
  emits `moveend` during a `flyTo` as well as at its end, so acting on the
  snapshot made the app query areas it was merely flying over.
- **Query boxes are padded by 30%** and their coverage remembered for three
  minutes, so ordinary small pans cost nothing at all.

## Rendering cost

The app runs on phones, outdoors, on battery, so what the main thread does
between two taps matters as much as the network. Three rules keep it quiet:

- **A search result is diffed, not re-rendered.** A pan mostly returns
  fountains that are already on the map. `FountainLayer` adds and removes only
  the difference, in bulk. One `<Marker>` per fountain looked equivalent but
  re-set every marker's position on each result, and the cluster library
  answers a position change by removing and re-inserting the marker.
- **GPS jitter stops at `useAnchor`.** A watch reports a slightly different fix
  about once a second. Only the user dot follows the raw fix; distances (list,
  popups) are computed from the position rounded to ~10 m, and `MapView`,
  `FountainLayer` and `FountainList` are memoized on it.
- **Nothing is built before it can be seen.** Popups are created when opened;
  list rows when the sheet opens, a page at a time.

The always-on animation (the pulsing user dot) uses `transform` and `opacity`
only, so it runs on the compositor instead of repainting every frame.

## Rate limiting & etiquette

The public Overpass API is a shared community resource. We are gentle with it:
queries are bounded by the visible bbox, capped in area, de-duplicated by the
coverage rule, cached for five minutes, backed off after failures, declared
with a small server-side budget (`timeout:15`, `maxsize` 64 MiB — a query that
asks for less is admitted more readily when a server is busy), and aborted when
superseded. For heavy or production
traffic, host your own Overpass instance or pre-process an extract.

## Testing

`npm test` runs Vitest in Node with `fetch` stubbed — no network, no browser —
and CI runs it before every deployment. Coverage focuses where failures are
invisible until a user is standing in the street:

- `geo` — coordinate validation, bbox repair (including the out-of-range
  longitudes Leaflet reports past the antimeridian),
- `searchPlan` — every branch of the policy above,
- `http` — abort/timeout semantics and hedged fallback,
- `overpass` — normalization, de-duplication, capping, mirror fallback, cache,
- `geocode` — provider parsing and "no match" versus "unavailable",
- `distance` — known city-to-city distances and formatting,
- `App` — the orchestration between locating and searching (fresh fix after a
  background spell, refresh on resume, and what the sheet is allowed to claim),
  with the map stubbed out since none of that is about drawing,
- `FountainList` — which rows exist when (none while closed, the nearest on
  open, more on scroll).

The React layer is verified by driving the built app in a real browser
(Playwright) against a stubbed Overpass: happy path, dead mirror, malformed
payload, all mirrors rate-limited, no geolocation permission, oversized area and
retry-to-recovery.
