/**
 * A tiny persistent error log.
 *
 * Bugs on a phone are hard to report: the message flashes past, there is no
 * console, and by the time the user can describe it the details are gone. Every
 * unexpected error is therefore recorded here (last {@link MAX_ENTRIES}, in
 * `localStorage`) and can be copied to the clipboard from the error screen.
 *
 * It never throws: Safari in private mode denies `localStorage`, and an error
 * logger that itself errors is worse than no logger.
 *
 * @module utils/errorLog
 */

const STORAGE_KEY = 'drinking-fountains:errors'
const MAX_ENTRIES = 10
/** Stack traces are truncated: only the top frames are ever useful here. */
const MAX_STACK_CHARS = 900

/**
 * @typedef {Object} LoggedError
 * @property {string} at - ISO timestamp.
 * @property {string} source - Where it came from ("render", "window", …).
 * @property {string} message
 * @property {string} [stack]
 */

/** @returns {Storage|null} */
function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

/**
 * Read the stored errors, newest last.
 * @returns {LoggedError[]}
 */
export function readErrorLog() {
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Forget every recorded error. */
export function clearErrorLog() {
  try {
    storage()?.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Record an error.
 *
 * @param {string} source - Short origin tag, e.g. `"render"` or `"promise"`.
 * @param {unknown} err
 * @returns {LoggedError} The entry that was stored.
 */
export function logError(source, err) {
  const error = /** @type {Error} */ (err)
  /** @type {LoggedError} */
  const entry = {
    at: new Date().toISOString(),
    source,
    message:
      (typeof error?.message === 'string' && error.message) ||
      String(err ?? 'Unknown error'),
    stack:
      typeof error?.stack === 'string'
        ? error.stack.slice(0, MAX_STACK_CHARS)
        : undefined,
  }

  try {
    const entries = [...readErrorLog(), entry].slice(-MAX_ENTRIES)
    storage()?.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    /* storage unavailable or full: the in-app display still gets the entry */
  }

  // Keep the console useful for anyone who *can* open dev tools.
  if (typeof console !== 'undefined') console.error(`[${source}]`, err)
  return entry
}

/**
 * Render the log (plus a little environment context) as plain text, ready to be
 * pasted into a bug report.
 *
 * @returns {string}
 */
export function formatErrorLog() {
  const entries = readErrorLog()
  const header = [
    `Drinking Fountains — error report`,
    `Generated: ${new Date().toISOString()}`,
    typeof navigator !== 'undefined' ? `User agent: ${navigator.userAgent}` : '',
    typeof window !== 'undefined'
      ? `Viewport: ${window.innerWidth}x${window.innerHeight}`
      : '',
    typeof navigator !== 'undefined' && 'onLine' in navigator
      ? `Online: ${navigator.onLine}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  if (entries.length === 0) return `${header}\n\nNo errors recorded.`

  const body = entries
    .map(
      (e, i) =>
        `#${i + 1} [${e.at}] (${e.source})\n${e.message}${e.stack ? `\n${e.stack}` : ''}`,
    )
    .join('\n\n')
  return `${header}\n\n${body}`
}

/**
 * Capture errors that escape React: uncaught exceptions and rejected promises.
 * Purely observational — nothing is shown to the user, the entries are there
 * for the next time something "weird" happens.
 *
 * @returns {() => void} Uninstall function.
 */
export function installGlobalErrorLogging() {
  if (typeof window === 'undefined') return () => {}

  const onError = (event) => {
    logError('window', event?.error ?? event?.message ?? 'Unknown error')
  }
  const onRejection = (event) => {
    const reason = event?.reason
    // Cancelled fetches are a normal part of the search lifecycle.
    if (reason?.name === 'AbortError') return
    logError('promise', reason ?? 'Unhandled rejection')
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
