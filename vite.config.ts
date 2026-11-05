import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The front end lives in web/. `npm run build` writes it to web/dist, which the bot server serves.
// `npm run dev:web` runs a hot-reloading copy on port 5173 that forwards /api to the bot server on port 3000.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000', '/health': 'http://localhost:3000' } },
});
