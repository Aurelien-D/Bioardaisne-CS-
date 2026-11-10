import { defineConfig } from 'vitest/config';

const SERVER_PORT = Number(process.env.BAS_SERVER_PORT ?? 8080);

export default defineConfig({
  root: '.',
  publicDir: 'public',
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
