import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { md5Text } from './md5.ts';
import { canonicalJson, dumpFm, mergeFm, mergeSettings, parseFm, patchFm } from './fm.ts';
import { exportFiles, importFiles, kindOf, type Files } from './bridge.ts';
import { runSync, type RemoteApi, type RItem } from './engine.ts';
import { scanRemote, findRoot } from './drive.ts';
import { pollDeviceFlow } from './auth.ts';

const emptyDB = () => ({ notes: {}, tex: {}, cols: [], items: {}, habits: {}, goals: [], projects: [], log: {} }) as any;

test('md5 matches node crypto', () => {
  for (const s of ['', 'a', 'hello world', 'é✓ünï'.repeat(50), 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(1000)])
    assert.equal(md5Text(s), createHash('md5').update(s).digest('hex'));
});

const PY_TASK = `---
completed_at: null
created_at: '2026-11-01T09:30:00'
deadline: '2026-12-01'
main_task_id: mt-abc
name: Fit the pulse
priority_id: p1
status_id: in_progress
tags:
- grb
- fit
type: subtask
---
My note body
`;

test('front matter: parse python-frontmatter output, unchanged patch is byte-identical, dates stay strings', () => {
  const { meta, body } = parseFm(PY_TASK);
  assert.equal(meta.deadline, '2026-12-01');
  assert.deepEqual(meta.tags, ['grb', 'fit']);
  assert.equal(body, 'My note body\n');
  assert.equal(patchFm(PY_TASK, { name: 'Fit the pulse', status_id: 'in_progress' }), PY_TASK);
  const out = patchFm(PY_TASK, { status_id: 'done', completed_at: '2026-11-12T10:00:00' });
  assert.match(out, /status_id: done/);
  assert.match(out, /completed_at: "2026-11-12T10:00:00"/);   // quoted, so PyYAML on the desktop reads a string
  assert.match(out, /priority_id: p1/);                        // unknown keys survive
  assert.match(out, /My note body/);
});

test('canonical settings json matches python json.dumps(sort_keys, indent=1, ensure_ascii=False)', () => {
  assert.equal(canonicalJson({ b: 1, a: [1, { z: 'é' }], c: {}, d: [] }), '{\n "a": [\n  1,\n  {\n   "z": "é"\n  }\n ],\n "b": 1,\n "c": {},\n "d": []\n}');
});

test('mergeFm: independent edits combine, done wins a status clash', () => {
  const base = dumpFm({ name: 'A', status_id: 'todo', tags: ['x'] }, 'b');
  const local = dumpFm({ name: 'A', status_id: 'done', tags: ['x'] }, 'b');
  const remote = dumpFm({ name: 'A', status_id: 'in_progress', tags: ['x', 'y'] }, 'b');
  const m = parseFm(mergeFm(base, local, remote)).meta;
  assert.equal(m.status_id, 'done'); assert.deepEqual(m.tags, ['x', 'y']);
});

test('mergeSettings: goals combine by id, deletions are honoured', () => {
  const g = (id: string) => ({ id, name: id, start_date: '2026-01-01', end_date: '2027-01-01' });
  const base = canonicalJson({ goals: [g('a'), g('b')], other: 1 });
  const local = canonicalJson({ goals: [g('a'), g('b'), g('phone')], other: 1 });
  const remote = canonicalJson({ goals: [g('a')], other: 2 });
  const m = JSON.parse(mergeSettings(base, local, remote));
  assert.deepEqual(m.goals.map((x: any) => x.id).sort(), ['a', 'phone']);
  assert.equal(m.other, 2);
});

function sampleDB() {
  const db = emptyDB();
  db.notes['ideas/gamma.md'] = { source: '# Gamma', modified: '2026-11-10T08:00:00.000Z' };
  db.tex['paper.tex'] = { source: '\\section{A}', modified: '2026-11-10T08:00:00.000Z' };
  db.habits['2026-11-11'] = { read: true, exercise: false };
  db.goals = [{ id: 'g1', name: 'PhD', start_date: '2026-01-01', end_date: '2030-01-01' }];
  db.projects = [{ slug: 'thesis', name: 'Thesis', pinned: false, main: [{ id: 'mt-111', name: 'Chapter 1', deadline: '2026-12-01', is_active: true, subtasks: [{ id: 'st-222', name: 'Draft', deadline: null, status_id: 'todo' }, { id: 'st-333', name: 'Figures', deadline: null, status_id: 'done', done_at: '2026-11-09T10:00:00' }] }] }];
  return db;
}

test('bridge: phone data -> vault files -> phone data round-trips', () => {
  const files = exportFiles(sampleDB(), {});
  assert.deepEqual(Object.keys(files).sort(), [
    '60-Meta/Daily-2026-11-11.md', '60-Meta/Notes/ideas/gamma.md', '70-LaTeX/paper.tex', '80-Tasks/thesis/_project.md',
    '80-Tasks/thesis/mt-111.md', '80-Tasks/thesis/st-222.md', '80-Tasks/thesis/st-333.md', '_app/settings.json']);
  assert.ok(Object.keys(files).every((p) => kindOf(p)));
  const back = emptyDB();
  importFiles(back, files);
  assert.deepEqual(back.notes['ideas/gamma.md'].source, '# Gamma');
  assert.deepEqual(back.habits, { '2026-11-11': { read: true, exercise: false } });
  assert.deepEqual(back.goals, sampleDB().goals);
  assert.deepEqual(back.projects[0].main[0].subtasks.map((s: any) => [s.id, s.status_id, s.done_at]), [['st-222', 'todo', undefined], ['st-333', 'done', '2026-11-09T10:00:00']]);
  assert.equal(back.projects[0].main[0].deadline, '2026-12-01');
  const raw = Object.fromEntries(Object.entries(files).filter(([p]) => !p.startsWith('60-Meta/Notes') && !p.startsWith('70-')).map(([p, f]) => [p, f.text]));
  const again = exportFiles(back, raw);
  for (const p of Object.keys(raw)) assert.equal(again[p].text, raw[p], p);   // nothing changed => nothing to upload
});

class FakeRemote implements RemoteApi {
  files = new Map<string, { id: string; text: string; modified: number }>();
  n = 0; clock = 1_000_000; corrupt = false;
  list(): Record<string, RItem> { return Object.fromEntries([...this.files].map(([p, f]) => [p, { id: f.id, md5: md5Text(f.text), modified: f.modified }])); }
  put(p: string, text: string) { const f = this.files.get(p); this.files.set(p, { id: f?.id ?? `id${++this.n}`, text, modified: (this.clock += 1000) }); }
  async upload(p: string, text: string, id?: string) { this.put(p, text); const f = this.files.get(p)!; return { id: f.id, md5: md5Text(text) }; }
  async download(id: string) { const f = [...this.files.values()].find((x) => x.id === id)!; return this.corrupt ? f.text + '!' : f.text; }
  async trash(id: string) { for (const [p, f] of this.files) if (f.id === id) this.files.delete(p); }
}

async function sync(db: any, remote: FakeRemote, state: { manifest: any; raw: any }, force = false) {
  const res = await runSync({ local: exportFiles(db, state.raw), remote: remote.list(), manifest: state.manifest, raw: state.raw, force }, remote);
  if (!res.needsConfirm) { importFiles(db, res.final); state.manifest = res.manifest; state.raw = res.raw; }
  return res;
}

test('first sync uploads everything, then stays quiet', async () => {
  const db = sampleDB(), remote = new FakeRemote(), s = { manifest: {}, raw: {} };
  const r1 = await sync(db, remote, s);
  assert.equal(r1.uploaded, 8); assert.ok(r1.ok);
  const r2 = await sync(db, remote, s);
  assert.equal(r2.uploaded + r2.downloaded + r2.conflicts, 0);
});

test('changes on either side flow through; second device receives the first device’s data', async () => {
  const a = sampleDB(), b = emptyDB(), remote = new FakeRemote(), sa = { manifest: {}, raw: {} }, sb = { manifest: {}, raw: {} };
  await sync(a, remote, sa);
  const rb = await sync(b, remote, sb);
  assert.equal(rb.downloaded, 8);
  assert.equal(b.projects[0].main[0].subtasks.length, 2);
  b.projects[0].main[0].subtasks[0].status_id = 'done';          // phone ticks a task
  b.notes['new.md'] = { source: 'hi', modified: new Date().toISOString() };
  await sync(b, remote, sb);
  await sync(a, remote, sa);
  assert.equal(a.projects[0].main[0].subtasks.find((s: any) => s.id === 'st-222').status_id, 'done');
  assert.equal(a.notes['new.md'].source, 'hi');
  delete a.notes['new.md'];                                      // delete propagates
  await sync(a, remote, sa); await sync(b, remote, sb);
  assert.equal(b.notes['new.md'], undefined);
});

test('unknown task fields written by the desktop survive a phone edit', async () => {
  const remote = new FakeRemote(), db = emptyDB(), s = { manifest: {}, raw: {} };
  remote.put('80-Tasks/p/_project.md', dumpFm({ type: 'project', name: 'P', created_at: '2026-01-01T00:00:00' }, ''));
  remote.put('80-Tasks/p/mt-1.md', dumpFm({ type: 'main_task', name: 'M', is_active: false, status_id: 'todo', created_at: '2026-01-01T00:00:00', priority_id: 'high', tags: ['t'] }, 'details'));
  remote.put('80-Tasks/p/st-1.md', PY_TASK.replace('mt-abc', 'mt-1'));
  await sync(db, remote, s);
  db.projects[0].main[0].subtasks[0].status_id = 'done';
  await sync(db, remote, s);
  const out = remote.files.get('80-Tasks/p/st-1.md')!.text;
  assert.match(out, /status_id: done/); assert.match(out, /priority_id: p1/); assert.match(out, /- grb/); assert.match(out, /My note body/);
});

test('note edited on both sides keeps both versions; structured conflict merges', async () => {
  const a = emptyDB(), b = emptyDB(), remote = new FakeRemote(), sa = { manifest: {}, raw: {} }, sb = { manifest: {}, raw: {} };
  a.notes['n.md'] = { source: 'base', modified: new Date(1).toISOString() };
  await sync(a, remote, sa); await sync(b, remote, sb);
  a.notes['n.md'] = { source: 'from A', modified: new Date(5_000_000).toISOString() };
  b.notes['n.md'] = { source: 'from B', modified: new Date(9_000_000).toISOString() };
  await sync(a, remote, sa);
  const r = await sync(b, remote, sb);
  assert.equal(r.conflicts, 1);
  const texts = Object.entries(b.notes).map(([, f]: any) => f.source).sort();
  assert.deepEqual(texts, ['from A', 'from B']);
});

test('mass deletion asks first; corrupt download is reported and retried', async () => {
  const db = emptyDB(), remote = new FakeRemote(), s = { manifest: {}, raw: {} };
  for (let i = 0; i < 40; i++) db.notes[`n${i}.md`] = { source: `x${i}`, modified: new Date().toISOString() };
  await sync(db, remote, s);
  remote.files.clear();
  const r = await sync(db, remote, s);
  assert.ok(r.needsConfirm); assert.equal(Object.keys(db.notes).length, 40);
  const r2 = await sync(db, remote, s, true);
  assert.equal(r2.deleted_local, 40);

  const b = emptyDB(), rm = new FakeRemote(), sb = { manifest: {}, raw: {} };
  rm.put('60-Meta/Notes/x.md', 'hello'); rm.corrupt = true;
  const bad = await sync(b, rm, sb);
  assert.ok(!bad.ok && Object.keys(b.notes).length === 0);
  rm.corrupt = false;
  const good = await sync(b, rm, sb);
  assert.ok(good.ok && b.notes['x.md'].source === 'hello');
});

test('Drive listing: nested paths, root lookup, foreign/odd items ignored', () => {
  const F = 'application/vnd.google-apps.folder';
  const items = [
    { id: 'r', name: 'Yggdrasil Vault', mimeType: F, createdTime: '2026-01-02' }, { id: 'r2', name: 'Yggdrasil Vault', mimeType: F, createdTime: '2026-01-01' },
    { id: 'f1', name: '80-Tasks', mimeType: F, parents: ['r2'] }, { id: 'a', name: 'st-1.md', mimeType: 'text/plain', parents: ['f1'], md5Checksum: 'm', modifiedTime: '2026-01-01T00:00:00Z' },
    { id: 'd', name: 'doc', mimeType: 'application/vnd.google-apps.document', parents: ['r2'] }, { id: 'e', name: '..', mimeType: 'text/plain', parents: ['r2'], md5Checksum: 'x' },
  ];
  assert.equal(findRoot(items, 'Yggdrasil Vault'), 'r2');
  const { files, folders } = scanRemote(items, 'r2');
  assert.deepEqual(Object.keys(files), ['80-Tasks/st-1.md']); assert.equal(folders['80-Tasks'], 'f1');
});

test('device sign-in polls through pending and slow_down', async () => {
  const seq = [{ error: 'authorization_pending' }, { error: 'slow_down' }, { refresh_token: 'rt', access_token: 'at', expires_in: 3600 }];
  const waits: number[] = [];
  const fetchImpl = (async () => { const j = seq.shift()!; return { ok: !('error' in j), json: async () => j } as Response; }) as unknown as typeof fetch;
  const t = await pollDeviceFlow({ id: 'c', secret: 's' }, { device_code: 'd', user_code: 'U', verification_url: 'u', expires_in: 600, interval: 5 }, { fetchImpl, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(t.refresh_token, 'rt'); assert.deepEqual(waits, [5000, 5000, 10000]);
});

import { isNewer, latestRelease } from '../update.ts';
test('update check: version compare and APK asset from GitHub release', async () => {
  assert.ok(isNewer('0.4.28', '0.4.27')); assert.ok(isNewer('0.10.0', '0.9.9')); assert.ok(!isNewer('0.4.27', '0.4.27')); assert.ok(!isNewer('0.4.26', '0.4.27'));
  const f = (async () => ({ ok: true, json: async () => ({ tag_name: 'v0.4.28', html_url: 'u', body: 'n', assets: [{ name: 'Yggdrasil-0.4.28-android.apk', browser_download_url: 'apk-url' }, { name: 'x.zip', browser_download_url: 'z' }] }) })) as unknown as typeof fetch;
  assert.deepEqual(await latestRelease(f), { version: '0.4.28', url: 'u', apk: 'apk-url', notes: 'n' });
});
