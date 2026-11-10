import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8080;
const token = process.env.SYNC_TOKEN || '';

const app = createApp({
  distDir: path.resolve(root, '../dist'),
  dataDir: process.env.DATA_DIR || path.resolve(root, '../data'),
  token,
  backend: process.env.YGG_BACKEND || '',
});

app.listen(port, '0.0.0.0', () => console.log(`yggdrasil-mobile listening on :${port}`));
if (!token) console.warn('SYNC_TOKEN is not set: /api/sync and /api/latex are open. Set it before exposing the server.');
