/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': process.env.API_URL ?? 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    // A negative UTC offset, where `new Date('YYYY-MM-DD')` shows the previous day: date bugs fail here.
    env: { TZ: 'America/Sao_Paulo' },
    setupFiles: ['src/test/setup.ts'],
    passWithNoTests: true,
  },
})
