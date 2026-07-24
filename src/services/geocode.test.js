import { afterEach, describe, expect, it, vi } from 'vitest'
import { geocodePlace, sanitizeResults, searchPlaces } from './geocode.js'

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, text: async () => JSON.stringify(body) }
}

const photonPayload = {
  features: [
    {
      geometry: { coordinates: [2.3522, 48.8566] },
      properties: { name: 'Paris', country: 'France' },
    },
  ],
}

const nominatimPayload = [
  { lat: '45.7640', lon: '4.8357', display_name: 'Lyon, France' },
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sanitizeResults', () => {
  it('drops rows without a usable coordinate', () => {
    expect(
      sanitizeResults([
        { lat: 48.8, lng: 2.3, label: 'ok' },
        { lat: null, lng: 2.3, label: 'no lat' },
        { lat: 'abc', lng: 2.3, label: 'bad lat' },
        { lat: 91, lng: 2.3, label: 'off planet' },
      ]),
    ).toEqual([{ lat: 48.8, lng: 2.3, label: 'ok' }])
  })

  it('accepts numeric strings and falls back to a coordinate label', () => {
    expect(sanitizeResults([{ lat: '48.8', lng: '2.3' }])).toEqual([
      { lat: 48.8, lng: 2.3, label: '48.8000, 2.3000' },
    ])
  })

  it('never throws on garbage', () => {
    expect(sanitizeResults(null)).toEqual([])
    expect(sanitizeResults([null, undefined, 3])).toEqual([])
  })
})

describe('searchPlaces', () => {
  it('returns nothing for a blank query without touching the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchPlaces('   ')).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('parses Photon suggestions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(photonPayload)),
    )
    const [first] = await searchPlaces('paris')
    expect(first.lat).toBeCloseTo(48.8566)
    expect(first.lng).toBeCloseTo(2.3522)
    expect(first.label).toBe('Paris, France')
  })

  it('falls back to the other provider when the preferred one fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        url.includes('photon')
          ? response({}, { ok: false, status: 503 })
          : response(nominatimPayload),
      ),
    )
    const [first] = await searchPlaces('lyon')
    expect(first.label).toBe('Lyon, France')
    expect(first.lat).toBeCloseTo(45.764)
  })

  it('reports "no match" rather than "unavailable" when a provider answers empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        url.includes('photon') ? response({ features: [] }) : response([]),
      ),
    )
    await expect(searchPlaces('zzzzzzzz')).resolves.toEqual([])
  })

  it('throws a clear error when every provider is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await expect(searchPlaces('paris')).rejects.toThrow(/unavailable/i)
  })
})

describe('geocodePlace', () => {
  it('returns the best match', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(nominatimPayload)),
    )
    await expect(geocodePlace('lyon')).resolves.toMatchObject({
      label: 'Lyon, France',
    })
  })

  it('rejects an empty query before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(geocodePlace('  ')).rejects.toThrow(/Type a place/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says so when nothing matches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        url.includes('photon') ? response({ features: [] }) : response([]),
      ),
    )
    await expect(geocodePlace('zzzzzzzz')).rejects.toThrow(/No place found/)
  })
})
