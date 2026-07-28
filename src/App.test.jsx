// @vitest-environment jsdom
/**
 * Orchestration tests for {@link App}.
 *
 * These cover the coordination between geolocation and searching — the part
 * that has no visible logic of its own and therefore fails silently. Every case
 * here is a bug that reached a user:
 *
 *  - tapping "locate me" after the app spent time in the background searched
 *    around the *old* position (or not at all),
 *  - returning to the app never refreshed anything,
 *  - the sheet announced "0 fountains nearby" when in truth nothing had been
 *    looked up yet.
 *
 * The map is stubbed out: Leaflet needs a real layout engine, and none of these
 * behaviours are about drawing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import App from './App.jsx'
import { clearFountainCache } from './services/overpass.js'

vi.mock('./components/MapView.jsx', () => ({
  default: () => null,
}))

const PARIS = { latitude: 48.8566, longitude: 2.3522 }
const LYON = { latitude: 45.764, longitude: 4.8357 }

/** Centres of the bounding boxes Overpass was asked about, in order. */
let queried = []
/** Controls what the geolocation watch reports, and whether it reports at all. */
let geo

/** Install a geolocation watch we can freeze, as a suspended page does. */
function installGeolocation() {
  geo = { position: PARIS, frozen: false, watchers: new Map(), nextId: 1 }

  const deliver = (onSuccess) => {
    if (geo.frozen) return
    onSuccess({
      coords: { ...geo.position, accuracy: 20 },
      timestamp: Date.now(),
    })
  }

  const geolocation = {
    watchPosition: (onSuccess) => {
      const id = geo.nextId++
      geo.watchers.set(id, onSuccess)
      // Deliver asynchronously, like the real API.
      setTimeout(() => deliver(onSuccess), 10)
      return id
    },
    clearWatch: (id) => geo.watchers.delete(id),
    getCurrentPosition: (onSuccess) => deliver(onSuccess),
  }

  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: geolocation,
  })
}

/** Make the current watches report `position` (as a real device would). */
function moveTo(position) {
  geo.position = position
  geo.watchers.forEach((onSuccess) =>
    onSuccess({ coords: { ...position, accuracy: 20 }, timestamp: Date.now() }),
  )
}

/** Answer every Overpass query with two fountains near the requested centre. */
function stubOverpass({ fail = false } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options) => {
      const body = decodeURIComponent(options?.body ?? '')
      const [south, west, north, east] = (body.match(/\(([-\d.,]+)\);/)?.[1] ?? '')
        .split(',')
        .map(Number)
      const lat = (south + north) / 2
      const lon = (west + east) / 2
      queried.push({ lat, lon })

      if (fail) {
        return { ok: false, status: 429, text: async () => 'busy' }
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            elements: [
              { type: 'node', id: 1, lat, lon },
              { type: 'node', id: 2, lat: lat + 0.0005, lon },
            ],
          }),
      }
    }),
  )
}

/** Did any query cover this point? */
const queriedNear = (point) =>
  queried.some(
    (q) =>
      Math.abs(q.lat - point.latitude) < 0.05 &&
      Math.abs(q.lon - point.longitude) < 0.05,
  )

/** Drive the app's timers and pending promises forward. */
async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Emulate the page being hidden and shown again `awayMs` later. */
async function backgroundFor(awayMs) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'hidden',
  })
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await advance(awayMs)
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  })
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

const sheetHeader = () => screen.getByRole('button', { expanded: false }).textContent

beforeEach(() => {
  queried = []
  clearFountainCache()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  installGeolocation()
  stubOverpass()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('App: locating and searching', () => {
  it('searches around the user on the first fix', async () => {
    render(<App />)
    await advance(2000)
    await waitFor(() => expect(queriedNear(PARIS)).toBe(true))
  })

  it('follows the fresh fix when locating after time in the background', async () => {
    render(<App />)
    await advance(2000)
    expect(queriedNear(PARIS)).toBe(true)

    // The page is suspended: the watch goes quiet while the user travels.
    geo.frozen = true
    await advance(60000)
    geo.position = LYON
    queried = []

    // The user taps "use my GPS location" while the app still believes it is
    // in Paris; the real fix only lands a moment later.
    await act(async () => {
      screen.getByLabelText('Use my GPS location').click()
    })
    geo.frozen = false
    await act(async () => {
      moveTo(LYON)
    })
    await advance(2000)

    // The regression: the stale position was treated as authoritative and the
    // fresh one ignored, so Lyon was never searched.
    await waitFor(() => expect(queriedNear(LYON)).toBe(true))
  })

  it('re-locates and searches when the app is reopened after a long absence', async () => {
    render(<App />)
    await advance(2000)
    expect(queriedNear(PARIS)).toBe(true)

    geo.frozen = true
    geo.position = LYON
    queried = []

    await backgroundFor(60000)
    geo.frozen = false
    await act(async () => {
      moveTo(LYON)
    })
    await advance(2000)

    await waitFor(() => expect(queriedNear(LYON)).toBe(true))
  })

  it('ignores a brief app switch rather than re-locating for nothing', async () => {
    render(<App />)
    await advance(2000)
    queried = []

    await backgroundFor(3000)
    await advance(2000)

    expect(queried).toEqual([])
  })
})

describe('App: what the sheet claims', () => {
  it('never reports zero fountains before a search has completed', async () => {
    stubOverpass({ fail: true })
    render(<App />)

    const seen = new Set()
    for (let i = 0; i < 12; i += 1) {
      seen.add(sheetHeader())
      await advance(500)
    }

    expect([...seen]).not.toContain('0 fountains nearby')
    // It says what is actually happening instead.
    await waitFor(() => expect(sheetHeader()).toBe('Fountains unavailable'))
  })

  it('reports a genuine empty area as zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ elements: [] }),
      })),
    )
    render(<App />)
    await advance(2000)
    await waitFor(() => expect(sheetHeader()).toBe('0 fountains nearby'))
  })

  it('lists the fountains it found', async () => {
    render(<App />)
    await advance(2000)
    await waitFor(() => expect(sheetHeader()).toBe('2 fountains nearby'))
  })
})
