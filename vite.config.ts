import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Relative base so the site works under https://<user>.github.io/<repo>/
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 900 },
  plugins: [react(), tailwindcss()],
})
