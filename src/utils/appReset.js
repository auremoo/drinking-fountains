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
import { clearLastView } from './lastView.js'

/**
 * Unregister every service worker, delete every cache, then reload from the
 * network. Only user data lost is cached map tiles and fountain results, both
 * of which are re-fetched on demand, and the remembered map view.
 *
 * @returns {Promise<void>} Resolves just before the reload is triggered.
 */
export async function resetApp() {
  try {
    clearFountainCache()
  } catch {
    /* ignore */
  }

  // "Reset app data" means all of it, including where the map was last left.
  clearLastView()

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
 * Delete the tile cache written by earlier versions of the app.
 *
 * Those versions fetched tiles without CORS, so every entry is an opaque
 * response: unusable now that tiles are requested with CORS, and counted
 * against the storage quota at several megabytes apiece. The current cache
 * lives under another name (see `vite.config.js`), so this is pure cleanup,
 * and a no-op once done.
 *
 * @returns {void}
 */
export function dropLegacyTileCache() {
  try {
    if (typeof caches !== 'undefined') caches.delete('osm-tiles').catch(() => {})
  } catch {
    /* Cache Storage unavailable (private mode, insecure origin): nothing to drop */
  }
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
