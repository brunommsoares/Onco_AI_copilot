// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/copilot/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3004',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
