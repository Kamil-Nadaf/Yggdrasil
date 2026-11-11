import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';

const BUILD = new Date().toISOString();
const VERSION = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
export default defineConfig({
  plugins: [react(), { name: 'version-file', closeBundle() { try { writeFileSync('dist/version.json', JSON.stringify({ build: BUILD, version: VERSION })); } catch { /* dev */ } } }],
  define: { __BUILD__: JSON.stringify(BUILD), __APP_VERSION__: JSON.stringify(VERSION) },
  server: { proxy: { '/api': 'http://127.0.0.1:8080' } },
  build: { chunkSizeWarningLimit: 1500 },
});
