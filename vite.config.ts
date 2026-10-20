import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/Workout_Tracker/',
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    manifest: {
      name: 'Workout Tracker — режим разработки', short_name: 'Workout Tracker',
      description: 'Локальный тестовый журнал силовых тренировок',
      start_url: '/Workout_Tracker/', scope: '/Workout_Tracker/', display: 'standalone',
      background_color: '#090D12', theme_color: '#090D12', lang: 'ru',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{html,js,css,png,svg,ico}'],
      navigateFallback: '/Workout_Tracker/index.html',
      navigateFallbackDenylist: [/\/api\//, /\/auth\//],
      runtimeCaching: [],
      cleanupOutdatedCaches: true,
    },
  })],
})
