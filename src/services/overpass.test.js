import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildQuery,
  clearFountainCache,
  describeFailure,
  ENDPOINTS,
  fetchFountains,
  MAX_FOUNTAINS,
  normalize,
  parseElements,
} from './overpass.js'
import { HttpError, timeoutError } from './http.js'

const PARIS_BBOX = [48.85, 2.34, 48.86, 2.35]
const CENTER = { lat: 48.855, lng: 2.345 }

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  }
}

beforeEach(() => {
  clearFountainCache()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildQuery', () => {
  it('embeds the bbox in every clause and asks for centres', () => {
    const query = buildQuery(PARIS_BBOX)
    expect(query).toContain('48.85,2.34,48.86,2.35')
    expect(query).toContain('amenity"="drinking_water')
    expect(query).toContain('out center tags;')
    expect(query).toContain('[out:json]')
  })
})

describe('normalize', () => {
  it('maps a node with tags', () => {
    expect(
      normalize({
        type: 'node',
        id: 42,
        lat: 48.85,
        lon: 2.35,
        tags: { name: 'Wallace', wheelchair: 'yes', bottle: 'no' },
      }),
    ).toEqual({
      id: 'node/42',
      lat: 48.85,
      lng: 2.35,
      name: 'Wallace',
      wheelchair: true,
      bottle: false,
      tags: { name: 'Wallace', wheelchair: 'yes', bottle: 'no' },
    })
  })

  it('uses the centre of a way', () => {
    const fountain = normalize({
      type: 'way',
      id: 7,
      center: { lat: 48.1, lon: 2.1 },
    })
    expect(fountain.id).toBe('way/7')
    expect(fountain.lat).toBe(48.1)
  })

  it('drops elements that would crash the map', () => {
    expect(normalize(null)).toBeNull()
    expect(normalize({ type: 'node', id: 1 })).toBeNull()
    expect(normalize({ type: 'node', id: 1, lat: null, lon: 2 })).toBeNull()
    expect(normalize({ type: 'node', id: 1, lat: NaN, lon: 2 })).toBeNull()
    expect(normalize({ type: 'node', id: 1, lat: 999, lon: 2 })).toBeNull()
    expect(normalize({ type: 'node', lat: 48, lon: 2 })).toBeNull()
  })

  it('leaves unknown accessibility as unknown', () => {
    const fountain = normalize({ type: 'node', id: 1, lat: 48, lon: 2 })
    expect(fountain.wheelchair).toBeNull()
    expect(fountain.bottle).toBeNull()
  })
})

describe('parseElements', () => {
  it('survives a malformed payload', () => {
    expect(parseElements(null, CENTER).fountains).toEqual([])
    expect(parseElements({ elements: 'nope' }, CENTER).fountains).toEqual([])
  })

  it('de-duplicates elements matched by several query clauses', () => {
    const el = { type: 'node', id: 1, lat: 48, lon: 2 }
    const { fountains } = parseElements({ elements: [el, el] }, CENTER)
    expect(fountains).toHaveLength(1)
  })

  it('caps huge result sets, keeping the closest', () => {
    const elements = Array.from({ length: MAX_FOUNTAINS + 50 }, (_, i) => ({
      type: 'node',
      id: i,
      lat: 48.855 + i * 0.0005,
      lon: 2.345,
    }))
    const { fountains, truncated } = parseElements({ elements }, CENTER)
    expect(truncated).toBe(true)
    expect(fountains).toHaveLength(MAX_FOUNTAINS)
    expect(fountains[0].id).toBe('node/0')
  })
})

describe('fetchFountains', () => {
  it('returns validated fountains from the first healthy mirror', async () => {
    const fetchMock = vi.fn(async () =>
      response({
        elements: [
          { type: 'node', id: 1, lat: 48.855, lon: 2.345 },
          { type: 'node', id: 2, lat: null, lon: 2.345 },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchFountains(PARIS_BBOX)
    expect(result.fountains).toHaveLength(1)
    expect(result.cached).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(ENDPOINTS[0])
  })

  it('falls back to another mirror when the first is rate-limited', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url === ENDPOINTS[0]) return response({}, { ok: false, status: 429 })
      return response({ elements: [{ type: 'node', id: 9, lat: 48.85, lon: 2.34 }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchFountains(PARIS_BBOX)
    expect(result.fountains).toHaveLength(1)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
  })

  it('treats an Overpass "remark" with no data as a mirror failure', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url === ENDPOINTS[0]) {
        return response({ elements: [], remark: 'runtime error: query timed out' })
      }
      return response({ elements: [{ type: 'node', id: 3, lat: 48.85, lon: 2.34 }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchFountains(PARIS_BBOX)
    expect(result.fountains).toHaveLength(1)
  })

  it('reuses a cached answer for the same view', async () => {
    const fetchMock = vi.fn(async () =>
      response({ elements: [{ type: 'node', id: 1, lat: 48.85, lon: 2.34 }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchFountains(PARIS_BBOX)
    const second = await fetchFountains(PARIS_BBOX)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second.cached).toBe(true)
    expect(second.fountains).toHaveLength(1)
  })

  it('bypasses the cache when forced (the retry button)', async () => {
    const fetchMock = vi.fn(async () =>
      response({ elements: [{ type: 'node', id: 1, lat: 48.85, lon: 2.34 }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchFountains(PARIS_BBOX)
    await fetchFountains(PARIS_BBOX, { force: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports a clear failure when every mirror is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({}, { ok: false, status: 502 })),
    )
    const err = await fetchFountains(PARIS_BBOX).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(describeFailure(err)).toMatch(/trouble|busy|reach/i)
  })

  it('refuses an unusable bounding box instead of querying', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchFountains([NaN, 2, 3, 4])).rejects.toThrow(/Invalid/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stays silent when the caller cancels', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ elements: [] })),
    )
    const controller = new AbortController()
    controller.abort()
    const err = await fetchFountains(PARIS_BBOX, {
      signal: controller.signal,
    }).catch((e) => e)
    expect(err.name).toBe('AbortError')
  })
})

describe('describeFailure', () => {
  it('explains an overloaded server', () => {
    expect(describeFailure(new HttpError(429, 'x'))).toMatch(/busy/i)
  })

  it('explains a timeout', () => {
    expect(describeFailure(timeoutError())).toMatch(/too long/i)
  })

  it('falls back to a connectivity hint', () => {
    expect(describeFailure(new Error('boom'))).toMatch(/connection/i)
  })
})
