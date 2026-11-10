import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'node:fs';

const BUILD = new Date().toISOString();
export default defineConfig({
  plugins: [react(), { name: 'version-file', closeBundle() { try { writeFileSync('dist/version.json', JSON.stringify({ build: BUILD })); } catch { /* dev */ } } }],
  define: { __BUILD__: JSON.stringify(BUILD) },
  server: { proxy: { '/api': 'http://127.0.0.1:8080' } },
  build: { chunkSizeWarningLimit: 1500 },
});
