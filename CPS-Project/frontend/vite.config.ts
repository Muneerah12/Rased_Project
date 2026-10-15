import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_CPS_API_TARGET || 'http://127.0.0.1:8000'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/nodes': { target: apiTarget, changeOrigin: true },
        '/locations': { target: apiTarget, changeOrigin: true },
        '/readings': { target: apiTarget, changeOrigin: true },
        '/heartbeats': { target: apiTarget, changeOrigin: true },
      },
    },
  }
})
