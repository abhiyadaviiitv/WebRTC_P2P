  import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
    define: {
    global: 'globalThis', // <-- this fixes "global is not defined"
  },
})  
