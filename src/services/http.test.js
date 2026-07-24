import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  abortError,
  fetchJson,
  HttpError,
  isAbortError,
  raceWithHedging,
} from './http.js'

/** Build a minimal `Response`-alike for the fetch stub. */
function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('fetchJson', () => {
  it('returns the parsed body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ hello: 'world' })),
    )
    await expect(fetchJson('https://example.test/x')).resolves.toEqual({
      hello: 'world',
    })
  })

  it('throws an HttpError carrying the status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse('nope', { ok: false, status: 429 })),
    )
    const err = await fetchJson('https://example.test/x').catch((e) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err.status).toBe(429)
    expect(err.isOverloaded).toBe(true)
  })

  it('reports an HTML error page as a syntax error, not silent success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse('<html>Bad gateway</html>')),
    )
    await expect(fetchJson('https://example.test/x')).rejects.toThrow(
      /non-JSON/,
    )
  })

  it('never fires the request when the caller already aborted', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()

    const err = await fetchJson('https://example.test/x', {
      signal: controller.signal,
    }).catch((e) => e)

    // The old implementation subscribed to an already-aborted signal, which
    // never fires: the request went out and its result overwrote fresh data.
    expect(isAbortError(err)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('turns a stalled request into a TimeoutError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url, { signal }) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(abortError()))
          }),
      ),
    )
    const err = await fetchJson('https://example.test/x', {
      timeoutMs: 10,
    }).catch((e) => e)
    expect(err.name).toBe('TimeoutError')
  })
})

describe('raceWithHedging', () => {
  const resolveAfter = (ms, value) => () =>
    new Promise((resolve) => setTimeout(() => resolve(value), ms))

  it('keeps the first successful answer', async () => {
    const result = await raceWithHedging(
      [resolveAfter(5, 'first'), resolveAfter(50, 'second')],
      { hedgeDelayMs: 1, deadlineMs: 500 },
    )
    expect(result).toBe('first')
  })

  it('falls back immediately when a provider fails', async () => {
    const failing = vi.fn(async () => {
      throw new Error('mirror down')
    })
    const working = vi.fn(async () => 'data')
    await expect(
      raceWithHedging([failing, working], {
        hedgeDelayMs: 10000,
        deadlineMs: 500,
      }),
    ).resolves.toBe('data')
    expect(working).toHaveBeenCalledTimes(1)
  })

  it('overtakes a silent provider without waiting for its timeout', async () => {
    const stalled = vi.fn(() => new Promise(() => {}))
    const start = Date.now()
    const value = await raceWithHedging([stalled, resolveAfter(5, 'backup')], {
      hedgeDelayMs: 20,
      deadlineMs: 1000,
    })
    expect(value).toBe('backup')
    expect(Date.now() - start).toBeLessThan(500)
  })

  it('aborts the losing providers', async () => {
    let losingSignal
    const slow = (signal) => {
      losingSignal = signal
      return new Promise(() => {})
    }
    await raceWithHedging([resolveAfter(5, 'winner'), slow], {
      hedgeDelayMs: 1,
      deadlineMs: 500,
    })
    expect(losingSignal.aborted).toBe(true)
  })

  it('rejects with the last failure when every provider fails', async () => {
    await expect(
      raceWithHedging(
        [
          async () => {
            throw new Error('a down')
          },
          async () => {
            throw new Error('b down')
          },
        ],
        { hedgeDelayMs: 1, deadlineMs: 500 },
      ),
    ).rejects.toThrow(/down/)
  })

  it('propagates caller cancellation as an AbortError', async () => {
    const controller = new AbortController()
    const promise = raceWithHedging([resolveAfter(200, 'late')], {
      hedgeDelayMs: 50,
      deadlineMs: 1000,
      signal: controller.signal,
    })
    controller.abort()
    expect(isAbortError(await promise.catch((e) => e))).toBe(true)
  })

  it('gives up at the deadline instead of hanging forever', async () => {
    const err = await raceWithHedging([() => new Promise(() => {})], {
      hedgeDelayMs: 5,
      deadlineMs: 20,
    }).catch((e) => e)
    expect(err.name).toBe('TimeoutError')
  })
})
