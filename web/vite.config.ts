import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev: `npm run dev` on :5173 proxies /api (HTTP + WebSocket) to the Python server on :8010.
// Prod: `npm run build` writes dist/, which the Python server serves at http://localhost:8010
export default defineConfig({
  plugins: [react()],
  server: {
    // The local CPS bridge is loopback-only; do not expose its /api proxy on the LAN.
    host: '127.0.0.1',
    proxy: { '/api': { target: 'http://127.0.0.1:8010', changeOrigin: true, ws: true } },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
});
