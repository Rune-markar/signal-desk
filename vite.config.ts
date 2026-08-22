import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/signal-desk/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Signal Desk - 監視・通知センター試作版',
        short_name: 'Signal Desk',
        description: '監視項目と通知の管理画面を試すブラウザ内機能試作版',
        theme_color: '#123f4a',
        background_color: '#f3f5f3',
        display: 'standalone',
        orientation: 'any',
        lang: 'ja',
        icons: [
          {
            src: 'app-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html}'],
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) =>
              request.destination === 'font' && url.origin === self.location.origin,
            handler: 'CacheFirst',
            options: {
              cacheName: 'signal-desk-fonts-v1',
              expiration: {
                maxEntries: 24,
                maxAgeSeconds: 60 * 60 * 24 * 365
              }
            }
          }
        ]
      }
    })
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    restoreMocks: true
  }
});
