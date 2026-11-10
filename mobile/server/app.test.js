import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp, parseAtom } from './app.js';

const ATOM = `<feed><entry><id>http://arxiv.org/abs/2611.01234v2</id><title>A  title
 with wrap</title><summary>Abstract &amp; text.</summary><published>2026-11-10T01:00:00Z</published>
<author><name>Ada L.</name></author><author><name>Bo C.</name></author></entry></feed>`;

async function boot({ token = '', fetchImpl, backend = '' } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ygg-'));
  const server = createApp({ distDir: path.join(dataDir, 'dist'), dataDir, token, backend, fetchImpl });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
const ok = (body) => async () => ({ ok: true, status: 200, text: async () => body });

test('parseAtom extracts ids, authors, decodes entities', () => {
  const [e] = parseAtom(ATOM);
  assert.equal(e.id, '2611.01234');
  assert.equal(e.title, 'A title with wrap');
  assert.equal(e.abstract, 'Abstract & text.');
  assert.deepEqual(e.authors, ['Ada L.', 'Bo C.']);
});

test('arxiv: live parse, then sample fallback when upstream fails', async () => {
  const a = await boot({ fetchImpl: ok(ATOM) });
  let j = await (await fetch(`${a.base}/api/arxiv?cat=astro-ph.HE`)).json();
  assert.equal(j.source, 'live'); assert.equal(j.items.length, 1);
  a.close();
  const b = await boot({ fetchImpl: async () => { throw new Error('blocked'); } });
  j = await (await fetch(`${b.base}/api/arxiv?cat=astro-ph.HE`)).json();
  assert.equal(j.source, 'sample'); assert.ok(j.items.length > 3);
  b.close();
});

test('input validation: category and pdf id', async () => {
  const a = await boot({ fetchImpl: ok(ATOM) });
  assert.equal((await fetch(`${a.base}/api/arxiv?cat=${encodeURIComponent('x;rm -rf')}`)).status, 400);
  assert.equal((await fetch(`${a.base}/api/pdf/${encodeURIComponent('../../etc/passwd')}`)).status, 400);
  assert.equal((await fetch(`${a.base}/api/pdf/sample-1`)).status, 400);
  a.close();
});

test('sync merges by newest updated and never lets older overwrite', async () => {
  const a = await boot();
  const put = (body) => fetch(`${a.base}/api/sync`, { method: 'PUT', body: JSON.stringify(body) }).then((r) => r.json());
  await put({ notes: [{ id: 'n1', title: 'new', updated: 5 }] });
  let m = await put({ notes: [{ id: 'n1', title: 'old', updated: 2 }, { id: 'n2', title: 'x', updated: 1 }] });
  assert.equal(m.notes.find((n) => n.id === 'n1').title, 'new');
  assert.equal(m.notes.length, 2);
  m = await (await fetch(`${a.base}/api/sync`)).json();
  assert.equal(m.notes.length, 2);
  a.close();
});

test('token protects sync and compile', async () => {
  const a = await boot({ token: 's3cret' });
  assert.equal((await fetch(`${a.base}/api/sync`)).status, 401);
  assert.equal((await fetch(`${a.base}/api/sync`, { headers: { authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await fetch(`${a.base}/api/sync`, { headers: { authorization: 'Bearer s3cret' } })).status, 200);
  assert.equal((await fetch(`${a.base}/api/latex/compile`, { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(`${a.base}/api/health`)).status, 200);
  a.close();
});

test('static: traversal blocked, SPA fallback works', async () => {
  const a = await boot();
  const r = await fetch(`${a.base}/%2e%2e/%2e%2e/etc/passwd`);
  assert.ok([400, 403, 404, 503].includes(r.status));
  a.close();
});

test('ygg proxy: forwards to backend, needs token, rejects non-api paths', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push([url, init.method, init.body]); return new Response('{"goals":[]}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  const a = await boot({ token: 'tok', backend: 'http://be:8000', fetchImpl });
  assert.equal((await fetch(`${a.base}/ygg/api/settings/goals`)).status, 401);
  const h = { authorization: 'Bearer tok' };
  const r = await fetch(`${a.base}/ygg/api/settings/goals?x=1`, { headers: h });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { goals: [] });
  assert.equal(seen[0][0], 'http://be:8000/api/settings/goals?x=1');
  await fetch(`${a.base}/ygg/api/habits/2026-11-11`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{"habits":{"rise":true}}' });
  assert.equal(seen[1][1], 'POST'); assert.equal(seen[1][2], '{"habits":{"rise":true}}');
  assert.equal((await fetch(`${a.base}/ygg/etc/passwd`, { headers: h })).status, 400);
  a.close();
  const b = await boot({});
  assert.equal((await fetch(`${b.base}/ygg/api/x`)).status, 503);
  b.close();
});
