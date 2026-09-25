import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev: `python -m fonttastic --dev` serves the API on 8765 and points the
// window at this dev server, which proxies /api there.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8765' },
    // the logos and tab icons live in the repo's images/ folder
    fs: { allow: ['..'] },
  },
  // harfbuzzjs loads its .wasm via `new URL(..., import.meta.url)` behind a
  // top-level await; keep Vite's pre-bundler away from it.
  optimizeDeps: { exclude: ['harfbuzzjs'] },
  build: { target: 'es2022' },
})
