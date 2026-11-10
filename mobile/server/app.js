import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { SAMPLE } from './fixtures.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.map': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
const CAT_RE = /^[a-z-]+(\.[A-Za-z-]+)?$/;
const ID_RE = /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})$/;
const LISTS = ['notes', 'papers', 'collections', 'projects'];
const EMPTY = () => ({ notes: [], papers: [], collections: [], projects: [] });
const UA = 'yggdrasil-mobile/0.1 (personal reading app)';

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function parseAtom(xml) {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  return entries.map((e) => {
    const get = (t) => {
      const m = e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`));
      return m ? decode(m[1]).replace(/\s+/g, ' ').trim() : '';
    };
    const id = get('id').replace(/^.*\/abs\//, '').replace(/v\d+$/, '');
    const authors = [...e.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((a) => decode(a[1]).trim());
    return { id, title: get('title'), abstract: get('summary'), authors, published: get('published'), pdf: `https://arxiv.org/pdf/${id}` };
  });
}

export function mergeList(a = [], b = []) {
  const m = new Map();
  for (const x of [...a, ...b]) {
    if (!x || typeof x.id !== 'string') continue;
    const y = m.get(x.id);
    if (!y || (x.updated || 0) >= (y.updated || 0)) m.set(x.id, x);
  }
  return [...m.values()];
}

export function createApp({ distDir, dataDir, token = '', backend = '', fetchImpl = fetch }) {
  const vaultFile = path.join(dataDir, 'vault.json');
  const arxivCache = new Map();
  const tokenHash = token ? crypto.createHash('sha256').update(token).digest() : null;

  const send = (res, code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  const authed = (req) => {
    if (!tokenHash) return true;
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) return false;
    return crypto.timingSafeEqual(crypto.createHash('sha256').update(m[1]).digest(), tokenHash);
  };
  const readBody = (req, limit = 5e6) =>
    new Promise((resolve, reject) => {
      let n = 0; const chunks = [];
      req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  const loadVault = async () => {
    try { return { ...EMPTY(), ...JSON.parse(await fs.readFile(vaultFile, 'utf8')) }; } catch { return EMPTY(); }
  };

  async function arxiv(cat) {
    const hit = arxivCache.get(cat);
    if (hit && Date.now() - hit.t < 15 * 60e3) return hit.data;
    let data;
    try {
      const url = `https://export.arxiv.org/api/query?search_query=cat:${cat}&sortBy=submittedDate&sortOrder=descending&max_results=25`;
      const r = await fetchImpl(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`arXiv ${r.status}`);
      const items = parseAtom(await r.text());
      if (!items.length) throw new Error('empty');
      data = { source: 'live', cat, items };
      arxivCache.set(cat, { t: Date.now(), data });
    } catch {
      data = { source: 'sample', cat, items: SAMPLE };
    }
    return data;
  }

  async function compile(source) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tex-'));
    try {
      await fs.writeFile(path.join(dir, 'main.tex'), source);
      const out = await new Promise((resolve) => {
        const p = spawn('tectonic', ['main.tex'], { cwd: dir });
        let log = '';
        p.stdout.on('data', (d) => (log += d));
        p.stderr.on('data', (d) => (log += d));
        const timer = setTimeout(() => p.kill('SIGKILL'), 60e3);
        p.on('error', (e) => { clearTimeout(timer); resolve({ missing: e.code === 'ENOENT', log: String(e) }); });
        p.on('close', (code) => { clearTimeout(timer); resolve({ code, log }); });
      });
      if (out.missing) return { status: 501, error: 'LaTeX compiler not installed. Rebuild the image with --build-arg WITH_LATEX=1.' };
      if (out.code !== 0) return { status: 422, error: out.log.split('\n').slice(-15).join('\n') };
      return { status: 200, pdf: await fs.readFile(path.join(dir, 'main.pdf')) };
    } finally {
      fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }


  // Reverse proxy to the desktop Yggdrasil backend (/ygg/api/... -> BACKEND/api/...)
  async function proxy(req, res, u) {
    if (!backend) return send(res, 503, { error: 'YGG_BACKEND not set' });
    const target = u.pathname.slice('/ygg'.length);
    if (!target.startsWith('/api/') || target.includes('..')) return send(res, 400, { error: 'bad path' });
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const headers = {};
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    let r;
    try {
      r = await fetchImpl(backend.replace(/\/$/, '') + target + u.search, {
        method: req.method, headers, redirect: 'manual',
        body: hasBody ? await readBody(req, 50e6) : undefined,
        signal: AbortSignal.timeout(60000),
      });
    } catch { return send(res, 502, { error: 'Yggdrasil backend unreachable' }); }
    const out = { 'cache-control': 'no-store' };
    for (const h of ['content-type', 'content-disposition']) if (r.headers.get(h)) out[h] = r.headers.get(h);
    res.writeHead(r.status, out);
    if (!r.body) return res.end();
    return Readable.fromWeb(r.body).pipe(res);
  }

  async function serveStatic(req, res, pathname) {
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
    let file = path.join(distDir, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(distDir + path.sep) && file !== distDir) { res.writeHead(403); return res.end(); }
    let buf;
    try { buf = await fs.readFile(file); } catch {
      if (path.extname(rel)) { res.writeHead(404); return res.end('Not found'); }
      file = path.join(distDir, 'index.html');
      try { buf = await fs.readFile(file); } catch { res.writeHead(503); return res.end('App not built'); }
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': rel.startsWith('/assets/') ? 'public,max-age=31536000,immutable' : 'no-cache',
    });
    res.end(buf);
  }

  return http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      const p = u.pathname;
      if (p === '/api/health') return send(res, 200, { ok: true });
      if (p.startsWith('/ygg/')) {
        if (!authed(req)) return send(res, 401, { error: 'unauthorized' });
        return proxy(req, res, u);
      }

      if (p === '/api/arxiv' && req.method === 'GET') {
        const cat = u.searchParams.get('cat') || 'astro-ph.HE';
        if (!CAT_RE.test(cat)) return send(res, 400, { error: 'bad category' });
        return send(res, 200, await arxiv(cat));
      }

      if (p.startsWith('/api/pdf/') && req.method === 'GET') {
        let id; try { id = decodeURIComponent(p.slice('/api/pdf/'.length)); } catch { return send(res, 400, { error: 'bad id' }); }
        if (!ID_RE.test(id)) return send(res, 400, { error: 'bad id' });
        const r = await fetchImpl(`https://arxiv.org/pdf/${id}`, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) }).catch(() => null);
        if (!r || !r.ok) return send(res, 502, { error: 'arXiv unreachable' });
        res.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'public,max-age=86400' });
        return Readable.fromWeb(r.body).pipe(res);
      }

      if (p === '/api/sync') {
        if (!authed(req)) return send(res, 401, { error: 'unauthorized' });
        if (req.method === 'GET') return send(res, 200, await loadVault());
        if (req.method === 'PUT') {
          let incoming;
          try { incoming = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'bad json' }); }
          const cur = await loadVault();
          const merged = {};
          for (const k of LISTS) merged[k] = mergeList(cur[k], Array.isArray(incoming[k]) ? incoming[k] : []);
          await fs.mkdir(dataDir, { recursive: true });
          const tmp = `${vaultFile}.${process.pid}.tmp`;
          await fs.writeFile(tmp, JSON.stringify(merged));
          await fs.rename(tmp, vaultFile);
          return send(res, 200, merged);
        }
        return send(res, 405, { error: 'method' });
      }

      if (p === '/api/latex/compile' && req.method === 'POST') {
        if (!authed(req)) return send(res, 401, { error: 'unauthorized' });
        let body; try { body = JSON.parse(await readBody(req, 1e6)); } catch { return send(res, 400, { error: 'bad json' }); }
        if (typeof body.source !== 'string') return send(res, 400, { error: 'source required' });
        const out = await compile(body.source);
        if (out.status !== 200) return send(res, out.status, { error: out.error });
        res.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-store' });
        return res.end(out.pdf);
      }

      if (p.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      return serveStatic(req, res, p);
    } catch (e) {
      if (!res.headersSent) send(res, 500, { error: 'server error' });
      else res.end();
    }
  });
}
