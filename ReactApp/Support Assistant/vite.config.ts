import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { supportAssistantApi } from './server/plugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), supportAssistantApi()],
  server: { port: 5199 },
})
