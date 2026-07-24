/**
 * Recovery helpers for the installed PWA.
 *
 * A service worker is what makes the app open instantly offline — and also the
 * one component that can wedge it: a half-updated precache serves an `index.html`
 * that points at JavaScript chunks which no longer exist, and the app appears
 * broken with no way out from the home-screen icon (no address bar, no reload).
 *
 * {@link resetApp} is that way out.
 *
 * @module utils/appReset
 */

import { clearFountainCache } from '../services/overpass.js'

/**
 * Unregister every service worker, delete every cache, then reload from the
 * network. Only user data lost is cached map tiles and fountain results, both
 * of which are re-fetched on demand.
 *
 * @returns {Promise<void>} Resolves just before the reload is triggered.
 */
export async function resetApp() {
  try {
    clearFountainCache()
  } catch {
    /* ignore */
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((r) => r.unregister()))
    }
  } catch {
    /* ignore: we still want the reload below */
  }

  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    }
  } catch {
    /* ignore */
  }

  if (typeof window !== 'undefined') window.location.reload()
}

/**
 * Reload once when the browser fails to fetch a lazily-loaded chunk.
 *
 * This is the signature failure of a stale precache after a deployment. A
 * single reload picks up the new asset manifest; the `sessionStorage` guard
 * makes sure a genuinely broken build cannot turn into a reload loop.
 *
 * @returns {void}
 */
export function installChunkErrorRecovery() {
  if (typeof window === 'undefined') return
  const FLAG = 'drinking-fountains:reloaded-for-chunk-error'

  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault?.()
    let alreadyTried = false
    try {
      alreadyTried = sessionStorage.getItem(FLAG) === '1'
      sessionStorage.setItem(FLAG, '1')
    } catch {
      /* storage unavailable: fall through and reload at most this once */
    }
    if (!alreadyTried) window.location.reload()
  })
}
