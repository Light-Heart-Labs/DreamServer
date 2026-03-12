import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3001,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        headers: {
          Authorization: `Bearer ${process.env.DASHBOARD_API_KEY || 'dev'}`
        }
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
