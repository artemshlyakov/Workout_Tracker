import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/Workout_Tracker/',
  build: { rollupOptions: { output: { manualChunks: { supabase: ['@supabase/supabase-js'], database: ['dexie'], 'exercise-library': ['./src/data/catalog/exercises.json'] } } } },
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    manifest: {
      name: 'Workout Tracker', short_name: 'Workout Tracker',
      description: 'Ваш личный дневник тренировок, история и прогресс',
      start_url: '/Workout_Tracker/', scope: '/Workout_Tracker/', display: 'standalone',
      background_color: '#090D12', theme_color: '#090D12', lang: 'ru',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{html,js,css,png,jpg,svg,ico,txt}'],
      globIgnores: ['exercises/**'],
      navigateFallback: '/Workout_Tracker/index.html',
      navigateFallbackDenylist: [/\/api\//, /\/auth\//],
      runtimeCaching: [{
        urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/Workout_Tracker/exercises/'),
        handler: 'CacheFirst',
        options: { cacheName: 'local-exercise-images-v1', expiration: { maxEntries: 280, maxAgeSeconds: 60 * 60 * 24 * 90 }, cacheableResponse: { statuses: [200] } },
      }, {
        urlPattern: /^https:\/\/raw\.githubusercontent\.com\/yuhonas\/free-exercise-db\/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5\/exercises\/.*\.jpg$/,
        handler: 'CacheFirst',
        options: { cacheName: 'exercise-reference-images-v1', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 90 }, cacheableResponse: { statuses: [0, 200] } },
      }],
      cleanupOutdatedCaches: true,
    },
  })],
})
