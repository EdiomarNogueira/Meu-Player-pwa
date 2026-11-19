import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command }) => {
  const isBuild = command === 'build';

  return {
    base: './',
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: ['favicon.svg', 'pwa-192x192.png', 'pwa-512x512.png', 'apple-touch-icon.png'],
        devOptions: {
          enabled: false,
          type: 'module',
          suppressWarnings: true,
        },
        manifest: {
          id: './',
          name: 'MeuPlayer',
          short_name: 'MeuPlayer',
          description: 'Streaming IPTV e Estúdio de Vídeos e Fotos Locais em PWA instalável.',
          lang: 'pt-BR',
          start_url: './',
          scope: './',
          display: 'standalone',
          display_override: ['window-controls-overlay', 'standalone'],
          orientation: 'any',
          background_color: '#0a0b0f',
          theme_color: '#0a0b0f',
          categories: ['entertainment', 'video', 'photo'],
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
        workbox: {
          globPatterns: isBuild ? ['**/*.{js,css,html,svg,png,ico,woff2}'] : [],
          globIgnores: ['ffmpeg/**'],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: 'index.html',
          runtimeCaching: [
            {
              urlPattern: ({ request, url }) =>
                request.destination === 'image' && url.protocol.startsWith('http'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'meuplayer-artwork-cache',
                expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: ({ url }) => /\/ffmpeg\/ffmpeg-core\.(js|wasm)$/.test(url.pathname),
              handler: 'CacheFirst',
              options: {
                cacheName: 'meuplayer-codec-engine',
                expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [200] },
              },
            },
          ],
        },
      }),
    ],
  };
});
