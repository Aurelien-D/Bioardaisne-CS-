import { defineConfig } from 'vitest/config';

const SERVER_PORT = Number(process.env.BAS_SERVER_PORT ?? 8080);

/**
 * Static hosting without a game server (GitHub Pages, any file host):
 *   BAS_BASE=./ BAS_STATIC=1 npm run build:client
 * BAS_BASE makes every URL relative to the page (it can live in a sub-folder) and
 * BAS_STATIC marks the page as solo-only (no WebSocket server behind it).
 */
const STATIC = process.env.BAS_STATIC === '1';

export default defineConfig({
  root: '.',
  base: process.env.BAS_BASE ?? '/',
  publicDir: 'public',
  plugins: [
    {
      name: 'bas-static-flag',
      transformIndexHtml: (html: string) => (STATIC ? html.replace('</head>', '    <script>window.__BAS_STANDALONE__ = true;</script>\n  </head>') : html),
    },
  ],
  // Parallel dev servers (tooling) can use separate dependency caches.
  cacheDir: process.env.BAS_VITE_CACHE ?? 'node_modules/.vite',
  server: {
    port: Number(process.env.BAS_CLIENT_PORT ?? 5173),
    host: true,
    proxy: {
      '/ws': { target: `ws://localhost:${SERVER_PORT}`, ws: true },
      '/api': { target: `http://localhost:${SERVER_PORT}` },
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
});
