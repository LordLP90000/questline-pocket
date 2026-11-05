/**
 * End-to-end check in a real browser: drives headless Edge or Chrome through the DevTools protocol (no
 * dependencies), plays the main flows on an emulated iPhone and Android phone, checks persistence, backups and
 * offline start, and saves screenshots to .e2e/. Run with `npm run e2e`; exits non-zero on the first failure.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const PORT = 8137;
const DEBUG_PORT = 9337;
/** `E2E_URL` checks a published copy (e.g. on GitHub Pages) instead of this folder. */
const ORIGIN = process.env.E2E_URL ? process.env.E2E_URL.replace(/\/$/, '') : `http://127.0.0.1:${PORT}`;
const OUT = fileURLToPath(new URL('../.e2e/', import.meta.url));
const DOWNLOADS = join(OUT, 'downloads');
const UA = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const log = (text) => process.stdout.write(`${text}\n`);

/* ───────── A minimal DevTools protocol client ───────── */

class Cdp {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((open, fail) => {
      socket.addEventListener('open', open, { once: true });
      socket.addEventListener('error', fail, { once: true });
    });
    return new Cdp(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.lastId = 0;
    this.waiting = new Map();
    this.listeners = new Set();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const call = this.waiting.get(message.id);
        this.waiting.delete(message.id);
        if (message.error) call.fail(new Error(`${call.method}: ${message.error.message}`));
        else call.done(message.result);
      } else {
        for (const listener of this.listeners) listener(message);
      }
    });
  }

  send(method, params = {}) {
    this.lastId += 1;
    this.socket.send(JSON.stringify({ id: this.lastId, method, params }));
    return new Promise((done, fail) => this.waiting.set(this.lastId, { done, fail, method }));
  }

  on(listener) {
    this.listeners.add(listener);
  }

  close() {
    this.socket.close();
  }
}

/* ───────── Page helpers ───────── */

let cdp;
const errors = [];
let shot = 0;

async function evaluate(expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(`in page: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
  return result.value;
}

async function waitFor(expression, what, timeout = 5000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await sleep(40);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const q = (selector) => `document.querySelector(${JSON.stringify(selector)})`;
const textOf = (selector) => evaluate(`${q(selector)}?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const count = (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);

async function click(selector, what = selector) {
  await waitFor(q(selector), what);
  await evaluate(`${q(selector)}.click()`);
  await sleep(60);
}

/** Clicks the element matching `selector` whose text contains `text`. */
async function clickText(selector, text) {
  const expression = `[...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => el.textContent.includes(${JSON.stringify(text)}))`;
  await waitFor(expression, `“${text}”`);
  await evaluate(`${expression}.click()`);
  await sleep(60);
}

async function fill(selector, value) {
  await waitFor(q(selector), selector);
  await evaluate(`(() => { const el = ${q(selector)}; el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}

function expect(condition, message) {
  if (!condition) throw new Error(`expected ${message}`);
  log(`  ✓ ${message}`);
}

async function screenshot(name) {
  shot += 1;
  await sleep(350); // let entrance animations finish
  await checkScreen();
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${String(shot).padStart(2, '0')}-${name}.png`), Buffer.from(data, 'base64'));
}

const scrollTo = (selector) => evaluate(`${q(selector)}?.scrollIntoView({ block: 'start' })`);

/** Every screen: unique IDs (labels and ARIA references depend on them) and no icon left blank. */
async function checkScreen() {
  const { duplicates, blank } = await evaluate(`(() => {
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
    return {
      duplicates: ids.filter((id, i) => ids.indexOf(id) !== i),
      blank: [...document.querySelectorAll('svg.icon')].filter((svg) => svg.childElementCount === 0).length,
    };
  })()`);
  if (duplicates.length) throw new Error(`duplicate IDs: ${duplicates.join(', ')}`);
  if (blank) throw new Error(`${blank} icons without a drawing`);
}

async function phone({ platform, dark = false }) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Emulation.setUserAgentOverride', { userAgent: UA[platform] });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
}

async function open(path = '/') {
  await evaluate('window.__leaving = true');
  await cdp.send('Page.navigate', { url: `${ORIGIN}${path}` });
  await waitFor(`!window.__leaving && document.readyState === 'complete' && document.querySelector('.screen')`, 'the app to start');
}

/** A date relative to the browser's today, as the app computes it. */
const dayFromToday = (days) =>
  evaluate(`(() => { const d = new Date(); d.setDate(d.getDate() + ${days}); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); })()`);

/* ───────── Flows ───────── */

async function iphoneFlow() {
  log('iPhone, light');
  await phone({ platform: 'ios' });
  await open();
  expect((await textOf('.screen-header__title')) === 'Today', 'Today to open first');
  expect((await textOf('.empty h2')) === 'Your timeline is empty', 'an empty timeline on a fresh phone');
  expect((await evaluate('document.documentElement.dataset.platform')) === 'ios', 'the iOS look for an iPhone');
  await screenshot('ios-today-empty');

  await click('.glass-btn--prominent[data-action="new-goal"]', 'the + button');
  await waitFor(q('form[data-form="goal"]'), 'the new goal form');
  expect(await evaluate(`document.activeElement?.name === 'title'`), 'the title field to be focused');
  await click('form[data-form="goal"] button[type="submit"]');
  expect((await textOf('.field--error .field__helper')) === 'Give your goal a title.', 'a clear error for a missing title');

  const target = await dayFromToday(60);
  await fill('input[name="title"]', 'Swim 1 km without stopping');
  await click('[data-action="pick-category"][data-value="health"]');
  await fill('textarea[name="why"]', 'Feel at home in the lake this summer.');
  await fill('input[name="targetDate"]', target);
  const rows = ['Book a swimming lesson', 'Swim 200 m', 'Swim 500 m'];
  for (const [i, title] of rows.entries()) await fill(`#step-rows .step-row:nth-child(${i + 1}) input`, title);
  await click('[data-action="add-step-row"]');
  expect((await count('#step-rows input')) === 4, 'a fourth step row');
  await fill('#step-rows .step-row:nth-child(4) input', 'Swim 750 m');
  await screenshot('ios-new-goal');
  await click('form[data-form="goal"] button[type="submit"]');
  await waitFor(q('.detail-title'), 'the new goal');
  expect((await textOf('.detail-title')) === 'Swim 1 km without stopping', 'the goal detail after creating it');
  expect((await count('ol.tl > li')) === 6, 'a timeline: start, 4 steps, goal');
  expect((await textOf('ol.tl [aria-current="step"] .qpath__title')).includes('Book a swimming lesson'), 'the first step to be current');
  expect((await textOf('.progress-card__stats li:nth-child(3)')) === 'Day 1 on this goal', 'day one on a new goal');
  await screenshot('ios-goal-detail');

  await click('.next-card [data-action="toggle-step"]', 'Mark as done');
  await waitFor(`${q('.snackbar')}?.textContent.includes('Step done')`, 'the Step done snackbar');
  expect((await count('ol.tl .qpath__item--done')) === 1, 'one done step on the timeline');
  expect((await textOf('ol.tl [aria-current="step"] .qpath__title')).includes('Swim 200 m'), 'the next step to become current');
  await click('.snackbar [data-action="undo"]', 'Undo');
  expect((await count('ol.tl .qpath__item--done')) === 0, 'Undo to take the step back');
  await click('.next-card [data-action="toggle-step"]', 'Mark as done');
  await scrollTo('ol.tl');
  await screenshot('ios-timeline');

  await click('[data-action="add-step"]', 'Add step');
  await waitFor(q('form[data-form="step"]'), 'the new step form');
  await fill('form[data-form="step"] input[name="title"]', 'Swim 1 km');
  await fill('form[data-form="step"] input[name="dueDate"]', await dayFromToday(45));
  await fill('form[data-form="step"] textarea[name="note"]', 'Lake Zurich, early in the morning.');
  await click('form[data-form="step"] button[type="submit"]');
  await waitFor(q('.detail-title'), 'the goal after adding a step');
  expect((await count('ol.tl .tl-card')) === 5, 'five steps on the timeline');
  expect((await textOf('ol.tl > li:nth-child(6) .tl-note')) === 'Lake Zurich, early in the morning.', 'the note on the new step');

  await click('ol.tl > li:nth-child(6) .tl-card__link', 'the new step');
  await waitFor(q('form[data-form="step"]'), 'the edit step form');
  await fill('form[data-form="step"] input[name="title"]', 'Swim 1 km in the lake');
  await clickText('.lrow', 'Move earlier');
  expect((await evaluate(`document.querySelector('input[name="title"]').value`)) === 'Swim 1 km in the lake', 'typed text to survive moving the step');
  expect((await textOf('.lgroup__title')) === 'Step 4 of 5', 'the step to move one place up');
  await click('form[data-form="step"] button[type="submit"]');
  await waitFor(q('.detail-title'), 'the goal after editing');
  expect((await textOf('ol.tl > li:nth-child(5) .qpath__title')).includes('Swim 1 km in the lake'), 'the edited step in its new place');

  await click('[data-action="goal-menu"]', 'the ⋯ menu');
  await waitFor(q('.menu'), 'the menu');
  await evaluate('history.back()');
  await waitFor(`!${q('.menu')}`, 'the system back to close the menu');
  expect((await count('.detail-title')) === 1, 'the goal screen to stay after closing the menu');
  await evaluate('history.back()');
  await waitFor(`${q('.screen-header__title')}?.textContent === 'Today'`, 'the system back to return to Today');

  await open();
  expect((await textOf('#today-next')) === 'Up next', 'Today to list what is up next after a reload');
  expect((await textOf('.qcard .qcard__title')) === 'Swim 200 m', 'the saved progress after a reload');
  await screenshot('ios-today');

  await click('.ring-tile', 'the goal ring');
  await waitFor(q('.detail-title'), 'the goal');
  for (let i = 0; i < 5 && (await count('.unlock')) === 0; i += 1) await click('.next-card [data-action="toggle-step"]', 'Mark as done');
  await waitFor(q('.unlock'), 'the celebration');
  expect((await textOf('.unlock .t-overline')) === 'Goal reached', 'a celebration when the last step is done');
  await screenshot('ios-goal-reached');
  await click('.unlock [data-action="close-overlay"]', 'Continue');
  await waitFor(`!${q('.unlock')}`, 'the celebration to close');
  expect((await textOf('.detail-head .tag--done')) === 'Reached', 'the goal marked as reached');
  await screenshot('ios-goal-reached-detail');

  await click('.tab[data-tab="goals"]', 'the Goals tab');
  await click('[data-action="filter"][data-value="reached"]', 'Reached');
  expect((await textOf('.acard .acard__title')) === 'Swim 1 km without stopping', 'the goal among the reached ones');
  await screenshot('ios-goals-reached');

  await click('.tab[data-tab="settings"]', 'the Settings tab');
  await screenshot('ios-settings');
  await clickText('.lrow', 'Add an example goal');
  await waitFor(`${q('.detail-title')}?.textContent.includes('10 km')`, 'the example goal');
  expect((await count('ol.tl .qpath__item--done')) === 2 && (await count('ol.tl [aria-current="step"]')) === 1, 'the example to be under way');
  await scrollTo('ol.tl');
  await screenshot('ios-example-timeline');

  await click('[data-action="goal-menu"]', 'the ⋯ menu');
  await click('[data-action="delete-goal"]', 'Delete goal…');
  await waitFor(q('.asheet'), 'the iOS action sheet');
  await screenshot('ios-confirm-delete');
  await click('[data-action="confirm-delete-goal"]', 'Delete Goal');
  await waitFor(`${q('.screen-header__title')}?.textContent === 'Settings'`, 'to go back after deleting');
  expect((await textOf('.screen-header__sub')).startsWith('1 goal'), 'one goal left');
  await click('.snackbar [data-action="undo"]', 'Undo');
  expect((await textOf('.screen-header__sub')).startsWith('2 goals'), 'Undo to bring the goal back');
  await screenshot('ios-settings-restored');
}

/** The person's text is shown as text: markup in a title never becomes HTML. */
async function escapingFlow() {
  log('Escaping');
  const title = '<img src=x onerror="window.__xss = 1"> & “quotes”';
  await click('.tab[data-tab="goals"]', 'Goals');
  await click('[data-action="new-goal"]', 'New goal');
  await fill('input[name="title"]', title);
  await fill('#step-rows .step-row:nth-child(1) input', '<b>bold?</b>');
  await click('form[data-form="goal"] button[type="submit"]');
  await waitFor(q('.detail-title'), 'the goal');
  expect((await textOf('.detail-title')) === title.replace(/\s+/g, ' '), 'the title to show as typed');
  expect((await count('.screen img, .screen b')) === 0 && (await evaluate('window.__xss')) === undefined, 'markup in titles never to become HTML');
  await click('[data-action="goal-menu"]', 'the ⋯ menu');
  await click('[data-action="delete-goal"]', 'Delete goal…');
  await click('[data-action="confirm-delete-goal"]', 'Delete Goal');
  await waitFor(`${q('.screen-header__title')}?.textContent === 'Goals'`, 'the Goals list');
}

async function androidFlow() {
  log('Android, dark');
  await phone({ platform: 'android', dark: true });
  await open();
  expect((await evaluate('document.documentElement.dataset.theme')) === 'dark', 'the dark theme from the phone setting');
  expect((await count('.fab')) === 1, 'the Android “New goal” button');
  await screenshot('android-today-dark');
  await click('.ring-tile', 'a goal ring');
  await waitFor(q('.detail-title'), 'the goal');
  await scrollTo('ol.tl');
  await screenshot('android-timeline-dark');
  await evaluate('history.back()');
  await waitFor(`${q('.screen-header__title')}?.textContent === 'Today'`, 'the back gesture to return to Today');

  await click('.tab[data-tab="settings"]', 'Settings');
  rmSync(DOWNLOADS, { recursive: true, force: true });
  mkdirSync(DOWNLOADS, { recursive: true });
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
  await clickText('.lrow', 'Download a backup');
  const until = Date.now() + 5000;
  while (Date.now() < until && !readdirSync(DOWNLOADS).some((f) => f.endsWith('.json'))) await sleep(50);
  const file = readdirSync(DOWNLOADS).find((f) => f.endsWith('.json'));
  expect(Boolean(file), 'a backup file to download');
  const backup = JSON.parse(readFileSync(join(DOWNLOADS, file), 'utf8'));
  expect(backup.app === 'questline-pocket' && backup.goals.length === 2, 'the backup to hold both goals');

  await clickText('.lrow', 'Delete all data');
  await waitFor(q('.mdialog'), 'the Material dialog');
  await screenshot('android-confirm-delete-all');
  await click('[data-action="confirm-delete-all"]', 'Delete everything');
  await waitFor(`${q('.screen-header__sub')}?.textContent.startsWith('0 goals')`, 'every goal to be deleted');

  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#import-file' });
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [join(DOWNLOADS, file)] });
  await evaluate(`document.getElementById('import-file').dispatchEvent(new Event('change'))`);
  await waitFor(q('.mdialog [data-action="confirm-import"]'), 'the restore confirmation');
  await click('[data-action="confirm-import"]', 'Replace my data');
  await waitFor(`${q('.screen-header__sub')}?.textContent.startsWith('2 goals')`, 'the backup to be restored');
  expect(true, 'a backup to restore every goal');

  await evaluate(`(() => { const input = document.getElementById('import-file'); const file = new File(['{"app":"other"}'], 'x.json'); const list = new DataTransfer(); list.items.add(file); input.files = list.files; input.dispatchEvent(new Event('change')); })()`);
  await waitFor(`${q('.snackbar')}?.textContent.includes('not a Questline Pocket backup')`, 'a refusal of a foreign file');
  expect(true, 'a foreign file to be refused without touching the data');
}

/** A second window of the app on the same phone, as a browser tab next to the installed app. */
async function twoWindowsFlow() {
  log('Two windows');
  await phone({ platform: 'ios' });
  await open();
  await click('.tab[data-tab="goals"]', 'Goals');
  const overline = await textOf('.screen-header__overline');
  const created = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${ORIGIN}/`, { method: 'PUT' })).json();
  const other = await Cdp.connect(created.webSocketDebuggerUrl);
  const inOther = async (expression) => (await other.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  try {
    for (let i = 0; i < 100 && !(await inOther(`Boolean(document.querySelector('.tab[data-tab="settings"]'))`)); i += 1) await sleep(50);
    await inOther(`document.querySelector('.tab[data-tab="settings"]').click()`);
    await sleep(200);
    await inOther(`[...document.querySelectorAll('.lrow')].find((el) => el.textContent.includes('Add an example goal')).click()`);
    await waitFor(`${q('.screen-header__overline')}?.textContent !== ${JSON.stringify(overline)}`, 'this window to show the other window’s new goal');
    expect((await textOf('.snackbar')).includes('another window'), 'a note that the data came from another window');

    // A change the other window's event didn't deliver: the next save must not overwrite it.
    await click('.tab[data-tab="today"]', 'Today');
    await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('questline-pocket/state')); s.goals[0].title = 'Changed elsewhere'; localStorage.setItem('questline-pocket/state', JSON.stringify(s)); })()`);
    const stepId = await evaluate(`document.querySelector('.qcard [data-action="toggle-step"]').dataset.step`);
    await click('.qcard [data-action="toggle-step"]', 'a check button');
    await waitFor(`${q('.snackbar')}?.textContent.includes('Please try again')`, 'the save to be refused');
    const stored = await evaluate(`JSON.parse(localStorage.getItem('questline-pocket/state'))`);
    expect(stored.goals[0].title === 'Changed elsewhere', 'the other window’s change to survive');
    expect(stored.goals.flatMap((g) => g.steps).find((s) => s.id === stepId).doneOn === null, 'the refused change not to be saved');
    expect(await evaluate(`document.querySelector('.screen').textContent.includes('Changed elsewhere')`), 'this window to show the newer data');
  } finally {
    other.close();
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${created.id}`);
  }
}

/** Stored data the app can't read is never written over. */
async function unreadableFlow() {
  log('Unreadable data');
  const broken = '{"schema":1,"goals":[{"broken":';
  await phone({ platform: 'android' });
  // A full storage: the copy aside fails.
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (String(key).includes('/unreadable-')) throw new DOMException('full', 'QuotaExceededError'); return set.call(this, key, value); }; })();`,
  });
  await evaluate(`localStorage.setItem('questline-pocket/state', ${JSON.stringify(broken)})`);
  await open();
  expect((await textOf('.empty h2')) === 'Your saved data can’t be read', 'a recovery screen when the data can’t be put aside');
  await screenshot('android-recover');
  rmSync(DOWNLOADS, { recursive: true, force: true });
  mkdirSync(DOWNLOADS, { recursive: true });
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
  await click('[data-action="download-unreadable"]', 'Download the data');
  const until = Date.now() + 5000;
  while (Date.now() < until && !readdirSync(DOWNLOADS).some((f) => f.endsWith('.txt'))) await sleep(50);
  const saved = readdirSync(DOWNLOADS).find((f) => f.endsWith('.txt'));
  expect(saved && readFileSync(join(DOWNLOADS, saved), 'utf8') === broken, 'the unreadable data to download unchanged');
  expect((await evaluate(`localStorage.getItem('questline-pocket/state')`)) === broken, 'the unreadable data to stay in place');
  await click('[data-action="start-fresh"]', 'Start fresh');
  await click('[data-action="confirm-start-fresh"]', 'Delete and start fresh');
  await waitFor(`${q('.empty h2')}?.textContent === 'Your timeline is empty'`, 'an empty app after starting fresh');
  expect(true, 'starting fresh only after asking');
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

  // With room to spare, the data is put aside and the app starts at once.
  await evaluate(`localStorage.setItem('questline-pocket/state', ${JSON.stringify(broken)})`);
  await open();
  expect((await textOf('.banner')).includes('couldn’t be read'), 'a notice that unreadable data was put aside');
  await click('.tab[data-tab="settings"]', 'Settings');
  expect((await count('[data-action="download-aside"]')) === 1, 'a way to download the data put aside');
}

async function offlineFlow() {
  log('Offline');
  await phone({ platform: 'ios' });
  await open();
  const cached = await evaluate(`navigator.serviceWorker.ready.then(() => caches.keys()).then((keys) => Promise.all(keys.map((k) => caches.open(k).then((c) => c.keys())))).then((lists) => lists.flat().length)`);
  expect(cached >= 26, `the service worker to cache the app (${cached} files)`);
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await open();
  expect((await textOf('.screen-header__title')) === 'Today', 'the app to start without a connection');
  expect((await count('.ring-tile')) >= 1, 'the goals to be there offline');
  await screenshot('offline-today');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
}

/* ───────── Run ───────── */

const browser = BROWSERS.find((path) => existsSync(path));
if (!browser) {
  log('No Edge or Chrome found.');
  process.exit(1);
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'questline-e2e-'));
const server = process.env.E2E_URL ? null : await startServer({ port: PORT });
const child = spawn(browser, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });

let failed = false;
try {
  let target;
  for (let i = 0; i < 100 && !target; i += 1) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find((t) => t.type === 'page');
    } catch {
      await sleep(100);
    }
  }
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  cdp.on(({ method, params }) => {
    if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
    if (method === 'Runtime.consoleAPICalled' && params.type === 'error') errors.push(params.args.map((a) => a.value ?? a.description).join(' '));
    if (method === 'Log.entryAdded' && params.entry.level === 'error' && !params.entry.url?.endsWith('favicon.ico')) errors.push(params.entry.text);
  });
  await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable', 'DOM.enable'].map((m) => cdp.send(m)));

  await iphoneFlow();
  await escapingFlow();
  await androidFlow();
  await twoWindowsFlow();
  await offlineFlow();
  await unreadableFlow();
  expect(errors.length === 0, `no errors in the browser console${errors.length ? `:\n${errors.join('\n')}` : ''}`);
  log(`\nAll flows passed. Screenshots in ${OUT}`);
} catch (error) {
  failed = true;
  log(`\n✗ ${error.message}`);
  if (errors.length) log(`Browser errors:\n${errors.join('\n')}`);
  try {
    await screenshot('failure');
  } catch {
    // The page may be gone.
  }
} finally {
  cdp?.close();
  child.kill();
  server?.close();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exit(failed ? 1 : 0);
