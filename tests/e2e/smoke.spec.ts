import { expect, test, type Page } from '@playwright/test';

type Selection = Record<string, string>;
interface ViewerEvent { name: string; detail: Record<string, unknown>; t: number }

const DEFAULT: Selection = { 'Shift Knob': 'Carbon Weave | Round', 'Shift Plate Style': 'Carbon Weave', 'Shift Pattern': '6+R Down' };
const SWAPS: Array<[string, string]> = [
  ['Shift Knob', 'Carbon Forged | Teardrop'], ['Shift Plate Style', 'Anodized Grey Aluminium'], ['Shift Pattern', '7+R'],
  ['Shift Knob', 'Aluminum | Blue'], ['Shift Plate Style', 'Forged Carbon'], ['Shift Pattern', '6+R Up'],
];

// ---------- every test: record viewer events from page start; fail on page errors ----------

let consoleErrors: string[] = [];
/** Console errors a test expects (an aborted download logs one in some engines). */
let allowedConsole: RegExp | null = null;

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  allowedConsole = null;
  page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`); });
  await page.addInitScript(() => {
    const w = window as unknown as { __events: ViewerEvent[]; __seen: Record<string, number> };
    w.__events = [];
    w.__seen = {};
    for (const name of ['productload', 'progress', 'ready', 'configurationchange', 'error', 'restored']) {
      document.addEventListener(name, e => w.__events.push({ name, detail: (e as CustomEvent).detail, t: performance.now() }), true);
    }
  });
});

test.afterEach(() => {
  const unexpected: string[] = consoleErrors.filter(m => !(allowedConsole && allowedConsole.test(m)));
  expect(unexpected, 'page errors / console.error').toEqual([]);
});

// ---------- helpers ----------

/** The next not-yet-consumed event of that name (a per-name cursor, so no event is missed or read twice). */
async function waitFor(page: Page, name: string, timeout: number = 30_000): Promise<Record<string, unknown>> {
  const handle = await page.waitForFunction((n: string) => {
    const w = window as unknown as { __events: ViewerEvent[]; __seen: Record<string, number> };
    const seen: number = w.__seen[n] ?? 0;
    const matching: ViewerEvent[] = w.__events.filter(e => e.name === n);
    if (matching.length <= seen) return false;
    w.__seen[n] = seen + 1;
    return { detail: matching[seen].detail ?? {} };
  }, name, { timeout });
  return ((await handle.jsonValue()) as { detail: Record<string, unknown> }).detail;
}

const pick = (page: Page, option: string, value: string): Promise<void> =>
  page.locator(`button[data-option="${option}"][data-value="${value}"]`).click();

const debugInfo = (page: Page): Promise<{ programs: number; textures: number; renderPath: string }> =>
  page.evaluate(() => (document.querySelector('mini3d-viewer') as unknown as { debugInfo(): Promise<{ programs: number; textures: number; renderPath: string }> }).debugInfo());

const configuration = (page: Page): Promise<Selection> =>
  page.evaluate(() => (document.querySelector('mini3d-viewer') as unknown as { configuration: Record<string, string> }).configuration);

async function dragAcross(page: Page, px: number, steps: number): Promise<void> {
  const box = (await page.locator('mini3d-viewer').boundingBox())!;
  const x: number = box.x + box.width / 2 - px / 2;
  const y: number = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + px, y, { steps });
  await page.mouse.up();
}

const nextError = (page: Page): Promise<Record<string, unknown>> => waitFor(page, 'error');

async function setAndCatchError(page: Page, selection: Selection): Promise<Record<string, unknown>> {
  await page.evaluate(s => (document.querySelector('mini3d-viewer') as unknown as { setConfiguration(s: Record<string, string>): void }).setConfiguration(s), selection);
  return nextError(page);
}

/** Every configurationchange selection so far, once 1 s passes with no new one. */
async function waitForSettled(page: Page): Promise<Selection[]> {
  const count = (): Promise<number> => page.evaluate(() => (window as unknown as { __events: ViewerEvent[] }).__events.filter(e => e.name === 'configurationchange').length);
  let last: number = -1;
  for (;;) {
    const now: number = await count();
    if (now === last) break;
    last = now;
    await page.waitForTimeout(1000);
  }
  return page.evaluate(() => (window as unknown as { __events: ViewerEvent[] }).__events
    .filter(e => e.name === 'configurationchange').map(e => (e.detail as { selection: Record<string, string> }).selection));
}

async function waitForProgressComplete(page: Page, phase: 'current' | 'background'): Promise<void> {
  await page.waitForFunction((p: string) => (window as unknown as { __events: ViewerEvent[] }).__events.some(e =>
    e.name === 'progress' && e.detail.phase === p && e.detail.loaded === e.detail.total), phase, { timeout: 60_000 });
}
const waitForBackgroundLoad = (page: Page): Promise<void> => waitForProgressComplete(page, 'background');
const waitForCurrentPartsLoaded = (page: Page): Promise<void> => waitForProgressComplete(page, 'current');

const canvasSize = (page: Page): Promise<{ width: number; height: number }> => page.evaluate(() => {
  const r: DOMRect = document.querySelector('mini3d-viewer')!.shadowRoot!.querySelector('canvas')!.getBoundingClientRect();
  return { width: r.width, height: r.height };
});

/**
 * The latest responseEnd (ms after navigation started) among the loader, the viewer chunks,
 * product.json and the current configuration's GLBs. Uses Playwright's request timing so requests
 * made by the render worker count too.
 */
function trackCriticalResponses(page: Page): { latestMs: () => number; seen: string[] } {
  const navigationStart: number = Date.now();
  let latest: number = 0;
  const seen: string[] = [];
  const critical = (url: string): boolean => /\/v1\/loader\.js$|\/v1\/assets\/.+\.js$|\/product\.json$|\/products\/ob1\.json$|\/parts\/(knob-round|plate-6r-down|grommet-6r-down)\.glb$/.test(new URL(url).pathname);
  page.on('requestfinished', request => {
    if (!critical(request.url())) return;
    const timing = request.timing();
    seen.push(new URL(request.url()).pathname.split('/').pop()!);
    latest = Math.max(latest, timing.startTime + timing.responseEnd - navigationStart);
  });
  return { latestMs: (): number => latest, seen };
}

// ---------- tests ----------

test('loads, spins and swaps without new shaders or textures', async ({ page, browserName }) => {
  await page.goto('/?stats'); await waitFor(page, 'ready');
  await waitForBackgroundLoad(page);                       // progress phase 'background' reaches total
  const before = await debugInfo(page);
  await dragAcross(page, 300, 20);
  for (const [o, v] of SWAPS) { await pick(page, o, v); await waitFor(page, 'configurationchange'); }  // 6 picks across all options
  const after = await debugInfo(page);
  expect(after.programs).toBe(before.programs);
  expect(after.textures).toBe(before.textures);
  if (browserName !== 'webkit') expect(after.renderPath).toBe('worker');
});

test('rapid picks end on the last pick', async ({ page }) => {      // Review Focus 1
  await page.goto('/?stats'); await waitFor(page, 'ready');
  await page.evaluate(() => { const v = document.querySelector('mini3d-viewer') as unknown as { setConfiguration(s: Record<string, string>): void };
    v.setConfiguration({ 'Shift Pattern': '6+R Up' }); v.setConfiguration({ 'Shift Pattern': '7+R' }); v.setConfiguration({ 'Shift Pattern': '6+R Down' }); });
  const changes = await waitForSettled(page);
  expect(changes.every(s => s['Shift Pattern'] === '6+R Down')).toBe(true);   // no intermediate flash
});

test('rejects an unknown option value and keeps the current build', async ({ page }) => {  // Review Focus 2
  await page.goto('/'); await waitFor(page, 'ready');
  const err = await setAndCatchError(page, { 'Shift Pattern': '8+R' });
  expect(err).toEqual({ reason: 'invalid-selection: Shift Pattern', fatal: false });
  expect(await configuration(page)).toEqual(DEFAULT);
});

test('shows the viewer after being hidden, then rotated', async ({ page }) => {     // Review Focus 3
  await page.route('/', async route => {
    const res = await route.fetch();
    const html = (await res.text()).replace('</head>', '<style id="hide">mini3d-viewer{display:none}</style></head>');
    await route.fulfill({ response: res, body: html });
  });
  await page.goto('/'); await page.waitForTimeout(1000);
  await page.evaluate(() => document.getElementById('hide')!.remove());
  await waitFor(page, 'ready');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(300);
  expect((await canvasSize(page)).width).toBeGreaterThan(0);
});

test('keeps working when a part fails to download', async ({ page }) => {           // Review Focus 4
  allowedConsole = /knob-senna|Failed to load resource|net::ERR_FAILED|NS_ERROR|Load failed/i;
  await page.route('**/parts/knob-senna*.glb', r => r.abort());
  await page.goto('/'); await waitFor(page, 'ready');
  await pick(page, 'Shift Knob', 'Carbon Weave | Teardrop');
  expect(await nextError(page)).toEqual(expect.objectContaining({ fatal: false, reason: expect.stringContaining('knob-senna') }));
  expect((await configuration(page))['Shift Knob']).toBe('Carbon Weave | Round');
  await pick(page, 'Shift Knob', 'Carbon Forged | Round'); await waitFor(page, 'configurationchange');
});

test('recovers from a lost graphics context', async ({ page }) => {                 // Review Focus 5
  await page.goto('/?stats'); await waitFor(page, 'ready');
  await page.evaluate(() => (document.querySelector('mini3d-viewer') as unknown as { debugLoseContext(): void }).debugLoseContext());
  await waitFor(page, 'restored');
  await pick(page, 'Shift Plate Style', 'Forged Carbon'); await waitFor(page, 'configurationchange');
});

test('first parts arrive within 5 s on slow 4G', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'network emulation is Chromium-only');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 93_750 });
  const critical = trackCriticalResponses(page);
  const lastCriticalResponseEndMs = critical.latestMs;
  await page.goto('/'); await waitForCurrentPartsLoaded(page);                     // progress phase 'current' reaches total
  // The render worker's downloads must be in the measurement, or the test proves nothing.
  expect(critical.seen).toEqual(expect.arrayContaining(['loader.js', 'product.json', 'knob-round.glb', 'plate-6r-down.glb', 'grommet-6r-down.glb']));
  test.info().annotations.push({ type: 'slow-4G critical path', description: `${lastCriticalResponseEndMs().toFixed(0)} ms (${critical.seen.join(', ')})` });
  expect(lastCriticalResponseEndMs()).toBeLessThan(5000);                         // loader, viewer chunks, product.json, current GLBs
});

test('a loader.js cached from before a deploy still brings up the viewer', async ({ page }) => {
  allowedConsole = /element-STALE|Failed to load|module script|MIME|Importing a module script failed|404/i;
  // Serve the first loader.js as an old cached copy would be: pointing at a viewer chunk the new deploy no longer has.
  await page.route('**/v1/loader.js', async route => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace(/element-[\w-]+\.js/, 'element-STALE.js') });
  });
  await page.goto('/');
  await waitFor(page, 'ready');
});
