import puppeteer from 'puppeteer-core';

const B = process.env.BASE || 'http://127.0.0.1:18081';
const MOCK = process.env.MOCK || 'http://127.0.0.1:18000';
const TOKEN = process.env.SYNC_TOKEN || 't0k';
const OUT = new URL('./shots/', import.meta.url).pathname;
const errors = []; const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const p = await browser.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Test thing' : undefined));
const text = () => p.evaluate(() => document.body.innerText);
const shot = (n) => p.screenshot({ path: `${OUT}${n}.png` });
const go = async (h) => { await p.goto(`${B}/#/${h}`); await p.reload(); await sleep(700); };
const click = async (sel, t) => { const ok = await p.evaluate((sel, t) => { const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().startsWith(t)); if (el) { el.click(); return true; } return false; }, sel, t); if (!ok) throw new Error(`no ${sel} "${t}"`); };
const mock = async () => (await fetch(`${MOCK}/__log`)).json();

// token
await p.goto(`${B}/#/sync`);
await p.evaluate((t) => { const raw = JSON.parse(localStorage.getItem('ygg.v1') || '{}'); raw.settings = { ...(raw.settings || {}), token: t, category: 'astro-ph.HE' }; localStorage.setItem('ygg.v1', JSON.stringify(raw)); }, TOKEN);
await p.reload(); await sleep(800);
let t = await text();
check('Connection screen shows backend connected + Zotero', t.includes('Connected') && t.includes('1 collections available'), t.replace(/\n+/g, ' | ').slice(0, 120));
await shot('01-connection');

// dashboard
await go('today'); await sleep(500);
t = await text();
check('Dashboard: active tasks card', t.includes('Active tasks') && t.includes('Pulse fitting paper') && t.includes('2/5'));
check('Dashboard: days left card with PhD countdown + event', t.includes('Days left') && /\d+\s*days left/.test(t) && t.includes('Group meeting'));
check('Dashboard: reading timer shows desktop totals', t.includes('Reading timer') && t.includes('20m papers'));
check('Dashboard: activity heatmap rendered', (await p.$$eval('.heat', (e) => e.length)) === 2 && (await p.$$eval('.heatcol i', (e) => e.length)) > 100);
check('Dashboard: mental health + lightcurve svg', t.includes('Mental health + lightcurve') && !!(await p.$('svg.lc polyline')));
await shot('02-dashboard');
await p.evaluate(() => document.querySelectorAll('.screen')[0].scrollTo(0, 99999)); await sleep(300); await shot('03-dashboard-bottom');
await click('button', 'Good'); await click('button.chip', 'Exercise'); await sleep(500);
let m = await mock();
check('Mood + habit toggles are written to backend', m.log.some((l) => l.startsWith('POST /api/habits/')));
// reading timer
await p.evaluate(() => document.querySelectorAll('.screen')[0].scrollTo(0, 400));
await click('button', 'Start'); await sleep(2300);
check('Timer counts up', /00:0[12]/.test(await text()));
await click('button', 'Pause'); await sleep(400);
m = await mock();
check('Pausing flushes time to /api/reading/time', m.log.some((l) => l === 'POST /api/reading/time'));

// arxiv
await go('arxiv'); await sleep(500);
t = await text();
check('arXiv: lists today papers from backend', t.includes('Paper 0 for') && t.includes('4 papers'));
check('arXiv: topic selector grouped + date + search present', !!(await p.$('select optgroup')) && !!(await p.$('input[type=date]')) && !!(await p.$('input[type=search]')));
await shot('04-arxiv');
await p.type('input[type=search]', 'magnetar'); await p.keyboard.press('Enter'); await sleep(600);
t = await text();
check('arXiv: search returns results', t.includes('Result magnetar'));
await click('button.chip', 'Clear search'); await sleep(500);
await p.$eval('input[type=date]', (el) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const d = new Date(Date.now() - 3 * 864e5); s.call(el, d.toISOString().slice(0, 10)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
await sleep(700);
m = await mock();
check('arXiv: date picker queries that day', m.log.some((l) => l.includes('/api/arxiv/daily') && l.includes('date=')));
await click('button.chip', 'Today'); await sleep(500);

// abstract + save picker
await p.evaluate(() => document.querySelector('article.card a').click()); await sleep(500);
t = await text();
check('Abstract view shows abstract + Save…', t.includes('Abstract text') && t.includes('Save…'));
await shot('05-abstract');
await click('.actionbar button', 'Save'); await sleep(600);
t = await text();
check('Save picker lists collection tree with Zotero tags', t.includes('GRB') && t.includes('Prompt emission') && t.includes('Local only') && t.includes('ZOTERO'));
await shot('06-save-picker');
await click('.pick', 'Prompt emission');
await click('.sheet button', 'Save'); await sleep(900);
m = await mock();
check('Save files paper into sub-collection on the desktop', m.items.length === 1 && m.items[0].collection === 'c_sub');
check('Save pushes to the linked Zotero collection key', m.log.some((l) => l.startsWith('ZOTERO') && l.includes('"collection":"ZK2"')));
// new sub-collection
await go('arxiv'); await sleep(500);
await click('article.card .btn', 'Save'); await sleep(500);
await click('.pick', 'GRB'); await click('.sheet button', 'New sub-collection'); await sleep(700);
m = await mock();
check('Can create sub-collection under selected parent', m.cols.some((c) => c.name === 'Test thing' && c.parent === 'c_grb'));
await click('.sheet button', 'Save'); await sleep(800);

// library
await go('library'); await sleep(500);
t = await text();
check('Library shows nested collections with Zotero tag', t.includes('Prompt emission') && t.includes('ZOTERO') && t.includes('Recently added'));
await shot('07-library');
await p.evaluate(() => [...document.querySelectorAll('a.grow')].find((a) => a.textContent.includes('Prompt emission')).click()); await sleep(500);
check('Collection lists saved paper', (await text()).includes('Paper 0 for'));

// notes
await go('notes'); await sleep(500);
t = await text();
check('Notes: lists vault notes', t.includes('Pulse ideas') && t.includes('Other'));
await shot('08-notes');
await p.evaluate(() => [...document.querySelectorAll('a.note')].find((a) => a.textContent.includes('Pulse ideas')).click()); await sleep(600);
await p.type('textarea.body', ' edited'); await sleep(2000);
m = await mock();
check('Note edits autosave to vault', m.log.some((l) => l === 'NOTESAVE Research/Pulse ideas.md'));
await p.click('button[aria-label="Preview"]'); await sleep(300);
check('Wiki link resolves in preview', !!(await p.$('.md a[href^="#/notes/"]')));

// write
await go('write'); await sleep(500);
check('Write: lists vault tex files', (await text()).includes('Paper/main'));
await p.evaluate(() => document.querySelector('a.card.link').click()); await sleep(700);
check('LaTeX source loads from vault', (await p.$eval('textarea.code', (e) => e.value)).includes('documentclass'));
await click('button.pill', 'Compile'); await sleep(800);
check('Compile errors from desktop are shown', (await text()).includes('Undefined control sequence'));
await shot('09-latex');

// tasks
await go('tasks/phd'); await sleep(600);
await p.evaluate(() => document.querySelector('.card .plainbtn').click()); await sleep(600);
t = await text();
check('Tasks: subtasks with statuses', t.includes('Write intro') && t.includes('Fit pulses'));
await click('.subrow', 'Write intro'); await sleep(400);
m = await mock();
check('Tapping subtask cycles status on backend', m.log.some((l) => l.startsWith('SUB') && l.includes('in_progress')));
await shot('10-tasks');

// auth
const noTok = await fetch(`${B}/ygg/api/info`);
check('Proxy refuses requests without the token', noTok.status === 401);
check('No uncaught page/console errors', errors.length === 0, errors.slice(0, 3).join(' || '));
await browser.close();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
