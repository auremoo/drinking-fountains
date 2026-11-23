import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Vite configuration.
 *
 * The {@link VitePWA} plugin turns the app into an installable Progressive Web
 * App: it injects the web manifest, registers a service worker and pre-caches
 * the application shell so the UI loads instantly on repeat visits.
 *
 * Note on offline scope: only the *app shell* (HTML/CSS/JS + icons) is cached.
 * Live fountain data and map tiles are always fetched from the network so the
 * information stays fresh. (Full offline data caching was intentionally left
 * out of the initial scope.)
 *
 * @see https://vite-pwa-org.netlify.app/
 */
export default defineConfig({
  // Unit tests (`npm test`) cover the pure logic and the data services, which
  // is where the app's reliability is decided. They run in Node with `fetch`
  // stubbed — no network, no browser needed.
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
  },
  // Served from a GitHub Pages *project* site, i.e.
  // https://auremoo.github.io/drinking-fountains/ — every asset URL must be
  // prefixed with the repository name. For a custom domain or a user/org
  // site, set this back to '/'.
  base: '/drinking-fountains/',
  build: {
    rollupOptions: {
      output: {
        // Third-party code (React, Leaflet) is nine tenths of the JavaScript
        // and only changes when a dependency is bumped. In its own file it
        // keeps its content hash across app releases, so an update downloads
        // the few kilobytes that changed instead of the whole bundle again.
        // Stylesheets are left alone so their cascade order stays as imported.
        manualChunks(id) {
          if (id.includes('node_modules') && !/\.css($|\?)/.test(id)) {
            return 'vendor'
          }
          return undefined
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      // The install icons are fetched by the browser when (and if) the app is
      // installed. Pre-caching them made every first visit download ~480 kB of
      // artwork the page itself never displays — more than all of its code.
      includeManifestIcons: false,
      manifest: {
        name: 'Drinking Fountains',
        short_name: 'Fountains',
        description:
          'Find publicly available drinking-water fountains around you.',
        theme_color: '#0ea5e9',
        background_color: '#f0f9ff',
        display: 'standalone',
        // `start_url` and `scope` are intentionally omitted: vite-plugin-pwa
        // derives them from the Vite `base` above, so they stay correct on
        // GitHub Pages (/drinking-fountains/) without hardcoding.
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Pre-cache the build output (the app shell). The two icons the page
        // links to come in through `includeAssets` above.
        globPatterns: ['**/*.{js,css,html}'],
        // Take over immediately after an update. Without this, a home-screen
        // install can keep serving an old shell whose JavaScript chunks no
        // longer exist on the server — the app then fails to boot with no
        // address bar to force-reload from.
        clientsClaim: true,
        skipWaiting: true,
        // Delete precaches from previous Workbox versions instead of letting
        // them accumulate and compete for storage quota.
        cleanupOutdatedCaches: true,
        // Never let the service worker answer an API call from the cache: stale
        // fountains are worse than no fountains.
        navigateFallbackDenylist: [/^\/api/],
        // Map tiles: cache opportunistically so revisited areas load faster,
        // but always try the network first to stay current.
        //
        // Tiles are requested with CORS (see `MapView`), so only genuine 200s
        // are stored. The cache name changed with that switch: the previous
        // `osm-tiles` cache holds opaque responses, which cannot be served to a
        // CORS request, and is deleted on startup (see `main.jsx`).
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'osm-tiles-cors',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30,
                // Tiles are the only bulky thing the app stores; if the device
                // runs short, drop them rather than fail to cache the shell.
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
})
