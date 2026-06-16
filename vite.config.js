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
  // Served from a GitHub Pages *project* site, i.e.
  // https://auremoo.github.io/drinking-fountains/ — every asset URL must be
  // prefixed with the repository name. For a custom domain or a user/org
  // site, set this back to '/'.
  base: '/drinking-fountains/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
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
        // Pre-cache the build output (the app shell).
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // Map tiles: cache opportunistically so revisited areas load faster,
        // but always try the network first to stay current.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[a-c]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
})
