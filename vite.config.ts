import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// scripts/cleanWeb.mjs may choose another output folder (web/.outdir) when web/dist cannot be written on Windows.
const chosen = (() => { try { const n = fs.readFileSync(fileURLToPath(new URL('./web/.outdir', import.meta.url)), 'utf8').trim(); return /^dist(-\d+)?$/.test(n) ? n : 'dist'; } catch { return 'dist'; } })();

// The front end lives in web/. `npm run build` writes it to web/dist, which the bot server serves.
// `npm run dev:web` runs a hot-reloading copy on port 5173 that forwards /api to the bot server on port 3000.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  // A different number in every build, so the built files get new names each time (a file name that a Windows virus scanner or
  // folder lock once blocked can then never be hit again).
  define: { __BUILD_ID__: JSON.stringify(String(Date.now())) },
  build: { outDir: chosen, emptyOutDir: false, sourcemap: false },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000', '/health': 'http://localhost:3000' } },
});
