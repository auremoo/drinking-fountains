/**
 * Shared HTTP plumbing for the data services.
 *
 * The app talks to free, community-run APIs (Overpass, Nominatim, Photon).
 * They are generous but genuinely unreliable: a mirror can be down, saturated
 * (HTTP 429), mid-restart (502/504) or simply slow for a minute. Every helper
 * here exists to make that unreliability *survivable* instead of user-visible:
 *
 *  - {@link fetchJson} always finishes: it has its own timeout and honours the
 *    caller's `AbortSignal`, including one that was aborted before the call.
 *  - {@link raceWithHedging} queries several mirrors with a small delay between
 *    them and keeps the first answer, so one dead mirror costs a few seconds
 *    instead of the whole search.
 *
 * @module services/http
 */

/**
 * Create an `AbortError`-shaped error.
 *
 * `DOMException` is not constructible everywhere the code runs (older engines,
 * some test environments), so this normalizes the shape the app checks for.
 *
 * @param {string} [message]
 * @returns {Error}
 */
export function abortError(message = 'Aborted') {
  const err = new Error(message)
  err.name = 'AbortError'
  return err
}

/**
 * Create a `TimeoutError`. Deliberately distinct from {@link abortError}: a
 * timeout is a *failure* worth retrying on another mirror, whereas an abort
 * means the caller no longer wants the answer and must stay silent.
 *
 * @param {string} [message]
 * @returns {Error}
 */
export function timeoutError(message = 'Request timed out') {
  const err = new Error(message)
  err.name = 'TimeoutError'
  return err
}

/**
 * Was this error caused by the caller cancelling?
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isAbortError(err) {
  return Boolean(err) && /** @type {Error} */ (err).name === 'AbortError'
}

/**
 * An unsuccessful HTTP response.
 *
 * @property {number} status - HTTP status code.
 * @property {string} url - The endpoint that produced it.
 */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} url
   */
  constructor(status, url) {
    super(`HTTP ${status}`)
    this.name = 'HttpError'
    this.status = status
    this.url = url
  }

  /** True when the server asked us to slow down or is over capacity. */
  get isOverloaded() {
    return this.status === 429 || this.status === 503 || this.status === 504
  }
}

/**
 * Subscribe to an abort signal, returning an unsubscribe function.
 *
 * Handles the case an `addEventListener`-only approach gets wrong: a signal
 * that is *already* aborted never fires the event, so the listener would never
 * run and the request would proceed as if nothing had been cancelled. That bug
 * let superseded searches overwrite fresh results.
 *
 * @param {AbortSignal|undefined|null} signal
 * @param {() => void} onAbort - Called immediately if `signal` is already aborted.
 * @returns {() => void} Unsubscribe.
 */
export function onAbortSignal(signal, onAbort) {
  if (!signal) return () => {}
  if (signal.aborted) {
    onAbort()
    return () => {}
  }
  signal.addEventListener('abort', onAbort, { once: true })
  return () => signal.removeEventListener('abort', onAbort)
}

/**
 * Fetch JSON with a hard timeout and cancellation support.
 *
 * @param {string} url
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] - Caller cancellation.
 * @param {number} [options.timeoutMs] - Per-request budget.
 * @param {'GET'|'POST'} [options.method]
 * @param {string} [options.body]
 * @param {Record<string,string>} [options.headers]
 * @returns {Promise<any>} The parsed JSON body.
 * @throws {Error} `AbortError` when cancelled, `TimeoutError` on timeout,
 *   {@link HttpError} on a non-2xx response, `SyntaxError` on an unparsable
 *   body (some mirrors answer with an HTML error page).
 */
export async function fetchJson(
  url,
  { signal, timeoutMs = 10000, method = 'GET', body, headers } = {},
) {
  if (signal?.aborted) throw abortError()

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const unsubscribe = onAbortSignal(signal, () => controller.abort())

  try {
    const res = await fetch(url, {
      method,
      body,
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
      // Community mirrors are public data; never send cookies or credentials.
      credentials: 'omit',
      // Let the browser/service worker revalidate rather than serve a stale
      // body for a query whose whole point is being current.
      cache: 'no-store',
    })

    if (!res.ok) throw new HttpError(res.status, url)

    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      const err = new SyntaxError(
        `${new URL(url).host} returned a non-JSON response`,
      )
      err.name = 'SyntaxError'
      throw err
    }
  } catch (err) {
    // Translate our own aborts so callers can tell "we gave up on this mirror"
    // apart from "the user cancelled".
    if (isAbortError(err)) {
      if (signal?.aborted) throw abortError()
      if (timedOut) throw timeoutError(`${new URL(url).host} timed out`)
    }
    throw err
  } finally {
    clearTimeout(timer)
    unsubscribe()
  }
}

/**
 * Run interchangeable async tasks (typically the same query against different
 * mirrors) and resolve with the first success.
 *
 * Tasks are *hedged*, not merely chained: task N+1 starts as soon as task N
 * fails **or** `hedgeDelayMs` elapses without an answer. A silently dead mirror
 * therefore costs `hedgeDelayMs`, not a full timeout, which is what makes the
 * search feel dependable when a provider is having a bad day.
 *
 * @template T
 * @param {Array<(signal: AbortSignal) => Promise<T>>} tasks - Ordered by preference.
 * @param {Object} [options]
 * @param {number} [options.hedgeDelayMs] - Delay before adding the next mirror.
 * @param {number} [options.deadlineMs] - Overall budget for all attempts.
 * @param {AbortSignal} [options.signal] - Caller cancellation.
 * @returns {Promise<T>} The first successful result.
 * @throws {Error} `AbortError` when cancelled, otherwise the last failure
 *   (or a `TimeoutError` if the overall deadline was hit first).
 */
export function raceWithHedging(
  tasks,
  { hedgeDelayMs = 3500, deadlineMs = 20000, signal } = {},
) {
  return new Promise((resolve, reject) => {
    if (!tasks.length) {
      reject(new Error('No providers available'))
      return
    }
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    /** @type {AbortController[]} */
    const controllers = []
    let settled = false
    let started = 0
    let failed = 0
    /** @type {unknown} */
    let lastError
    /** @type {ReturnType<typeof setTimeout>|null} */
    let hedgeTimer = null

    const finish = (fn, value) => {
      if (settled) return
      settled = true
      if (hedgeTimer) clearTimeout(hedgeTimer)
      clearTimeout(deadlineTimer)
      unsubscribe()
      controllers.forEach((c) => c.abort())
      fn(value)
    }

    const scheduleHedge = () => {
      if (hedgeTimer) clearTimeout(hedgeTimer)
      if (started >= tasks.length) return
      hedgeTimer = setTimeout(startNext, hedgeDelayMs)
    }

    function startNext() {
      if (settled || started >= tasks.length) return
      const index = started++
      const controller = new AbortController()
      controllers.push(controller)

      Promise.resolve()
        .then(() => tasks[index](controller.signal))
        .then(
          (value) => finish(resolve, value),
          (err) => {
            // An abort we triggered ourselves (a sibling already won, or the
            // caller cancelled) is not a provider failure.
            if (settled) return
            if (signal?.aborted) {
              finish(reject, abortError())
              return
            }
            lastError = err
            failed += 1
            if (failed >= tasks.length) {
              finish(reject, lastError)
            } else {
              startNext()
              scheduleHedge()
            }
          },
        )

      scheduleHedge()
    }

    const deadlineTimer = setTimeout(
      () => finish(reject, lastError ?? timeoutError()),
      deadlineMs,
    )
    const unsubscribe = onAbortSignal(signal, () =>
      finish(reject, abortError()),
    )

    startNext()
  })
}
