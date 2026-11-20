import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

interface DebugInfo { programs: number; textures: number; renderPath: string; level: { tier: string; dprCap: number }; displayMs: number | null; azimuthRad: number | null }
const debugInfo = (page: Page): Promise<DebugInfo> =>
  page.evaluate(() => (document.querySelector('mini3d-viewer') as unknown as { debugInfo(): Promise<DebugInfo> }).debugInfo());

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

async function waitForProgressComplete(page: Page, phase: 'current' | 'deferred' | 'background'): Promise<void> {
  await page.waitForFunction((p: string) => (window as unknown as { __events: ViewerEvent[] }).__events.some(e =>
    e.name === 'progress' && e.detail.phase === p && e.detail.loaded === e.detail.total), phase, { timeout: 60_000 });
}
const waitForBackgroundLoad = (page: Page): Promise<void> => waitForProgressComplete(page, 'background');
const waitForCurrentPartsLoaded = (page: Page): Promise<void> => waitForProgressComplete(page, 'current');

/** Holds every request matching `url` until the returned function is called. */
async function holdRequests(page: Page, url: RegExp): Promise<() => void> {
  let release: () => void = (): void => {};
  const released: Promise<void> = new Promise(resolve => { release = resolve; });
  await page.route(url, async route => { await released; await route.continue(); });
  return (): void => release();
}

/** Holds every request matching `url` until the returned function is called, then fails them. */
async function holdThenFail(page: Page, url: RegExp): Promise<() => void> {
  let release: () => void = (): void => {};
  const released: Promise<void> = new Promise(resolve => { release = resolve; });
  await page.route(url, async route => { await released; await route.abort(); });
  return (): void => release();
}

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
  const critical = (url: string): boolean => /\/v1\/loader\.js$|\/v1\/assets\/.+\.js$|\/product\.json$|\/products\/ob1\.json$|\/parts\/(housing|base|pad|usb-port|plate-screws|logo|stick|plate-6r-down|grommet-6r-down|knob-round)\.glb(\.gz)?$/.test(new URL(url).pathname);
  page.on('requestfinished', request => {
    if (!critical(request.url())) return;
    const timing = request.timing();
    seen.push(new URL(request.url()).pathname.split('/').pop()!.replace(/\.gz$/, '')); // parts come as <name>.glb.gz
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
  await page.route('**/parts/knob-senna*.glb*', r => r.abort());
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
  expect(critical.seen).toEqual(expect.arrayContaining([
    'loader.js', 'product.json', 'housing.glb', 'base.glb', 'pad.glb', 'usb-port.glb', 'plate-screws.glb', 'logo.glb', 'stick.glb',
    'plate-6r-down.glb', 'grommet-6r-down.glb', 'knob-round.glb',
  ]));
  test.info().annotations.push({ type: 'slow-4G critical path', description: `${lastCriticalResponseEndMs().toFixed(0)} ms (${critical.seen.join(', ')})` });
  expect(lastCriticalResponseEndMs()).toBeLessThan(5000);                         // loader, viewer chunks, product.json, current GLBs
});

const AFTER_FIRST_VIEW: RegExp = /\/parts\/(board|bracket|springs|bearings|mechanism-screws|base-screws|mechanism-hardware|board-hardware)(\.light)?\.glb(\.gz)?$/;

test('after-first-view parts neither delay the first view or picks nor compile new shaders', async ({ page }) => {   // Review Focus 1
  const release = await holdRequests(page, AFTER_FIRST_VIEW);
  await page.goto('/?stats'); await waitFor(page, 'ready');                 // every internal part is still held
  const before = await debugInfo(page);
  await pick(page, 'Shift Pattern', '7+R'); await waitFor(page, 'configurationchange');
  await pick(page, 'Shift Knob', 'Carbon Forged | Teardrop'); await waitFor(page, 'configurationchange');
  release();
  await waitForProgressComplete(page, 'deferred');
  expect((await debugInfo(page)).programs).toBe(before.programs);
});

test('an after-first-view part that fails is reported and blocks nothing', async ({ page }) => {   // Review Focus 2
  allowedConsole = /bearings|Failed to load resource|net::ERR_FAILED|NS_ERROR|Load failed/i;
  await page.route('**/parts/bearings*.glb*', r => r.abort());
  await page.goto('/'); await waitFor(page, 'ready');
  expect(await nextError(page)).toEqual(expect.objectContaining({ fatal: false, reason: expect.stringContaining('bearings') }));
  await waitForProgressComplete(page, 'deferred');
  await pick(page, 'Shift Knob', 'Carbon Forged | Round'); await waitFor(page, 'configurationchange');
});

test('an after-first-view part that fails never drops a pick still waiting for its parts', async ({ page }) => {
  allowedConsole = /bearings|Failed to load resource|net::ERR_FAILED|NS_ERROR|Load failed/i;
  const failBearings = await holdThenFail(page, /\/parts\/bearings(\.light)?\.glb(\.gz)?$/);
  const releaseSenna = await holdRequests(page, /\/parts\/knob-senna(\.light)?\.glb(\.gz)?$/);
  await page.goto('/'); await waitFor(page, 'ready');
  await pick(page, 'Shift Knob', 'Carbon Weave | Teardrop');               // waits for its held knob
  failBearings();
  expect(await nextError(page)).toEqual(expect.objectContaining({ fatal: false, reason: expect.stringContaining('bearings') }));
  await pick(page, 'Shift Plate Style', 'Forged Carbon');                 // a partial pick, merged onto the one in flight
  releaseSenna();
  await waitFor(page, 'configurationchange');
  expect(await waitForSettled(page)).toEqual([{ ...DEFAULT, 'Shift Knob': 'Carbon Weave | Teardrop', 'Shift Plate Style': 'Forged Carbon' }]);
});

test('after-first-view parts still appear after a lost graphics context', async ({ page }) => {   // Review Focus 3
  const release = await holdRequests(page, AFTER_FIRST_VIEW);
  await page.goto('/?stats'); await waitFor(page, 'ready');
  await page.evaluate(() => (document.querySelector('mini3d-viewer') as unknown as { debugLoseContext(): void }).debugLoseContext());
  await waitFor(page, 'restored');
  release();
  await waitForProgressComplete(page, 'deferred');
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

test('measures the display refresh interval once the viewer is idle', async ({ page }) => {
  await page.goto('/?stats'); await waitFor(page, 'ready');
  await expect.poll(async () => (await debugInfo(page)).displayMs ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
  const displayMs: number = (await debugInfo(page)).displayMs!;
  expect(displayMs).toBeGreaterThan(12); // the test browsers refresh at 60 Hz: 16.7 ms
  expect(displayMs).toBeLessThan(22);
});

test('a display capped at 30 fps keeps full quality while spinning', async ({ page, browserName }) => {
  // Headless Chromium's software renderer needs 25-45 ms a frame for this scene, so under a 30 fps
  // cap it really does miss refreshes and stepping down is correct there. Firefox renders it in time.
  test.skip(browserName !== 'firefox', 'needs a renderer that draws a frame well inside 33 ms');
  // Animation callbacks at most every 30 ms, as iOS does in Low Power Mode. The main-thread path, so
  // the page's requestAnimationFrame is the one the engine uses. A small viewer keeps rendering cheap.
  await page.setViewportSize({ width: 780, height: 160 });
  await page.addInitScript(() => {
    const raf: (callback: FrameRequestCallback) => number = window.requestAnimationFrame.bind(window);
    let waiting: FrameRequestCallback[] = [];
    let last: number = -Infinity;
    const loop = (t: number): void => {
      if (t - last >= 30 && waiting.length > 0) {
        last = t;
        const run: FrameRequestCallback[] = waiting;
        waiting = [];
        for (const callback of run) callback(t);
      }
      raf(loop);
    };
    raf(loop);
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => { waiting.push(callback); return 0; };
  });
  await page.goto('/?stats&render=main'); await waitFor(page, 'ready');
  await waitForBackgroundLoad(page);
  await expect.poll(async () => (await debugInfo(page)).displayMs ?? 0, { timeout: 15_000 }).toBeGreaterThan(28);

  // The speed test draws every frame for 6 s: three full windows of 60 frames at 30 fps.
  const result: { frames: number; p50Ms: number } = await page.evaluate(() =>
    (document.querySelector('mini3d-viewer') as unknown as { runSpeedTest(): Promise<{ frames: number; p50Ms: number }> }).runSpeedTest());
  expect(result.p50Ms).toBeGreaterThan(28); // the cap held: this was a 30 fps run
  expect((await debugInfo(page)).level).toEqual({ tier: 'full', dprCap: 1.5 });
});

test('a flick keeps the model turning after release; a drag that rests first does not', async ({ page }) => {
  await page.goto('/?stats'); await waitFor(page, 'ready');
  const azimuth = async (): Promise<number> => (await debugInfo(page)).azimuthRad!;
  const box = (await page.locator('mini3d-viewer').boundingBox())!;
  const x: number = box.x + box.width / 2 - 100;
  const y: number = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 200, y, { steps: 5 });
  await page.mouse.up();
  const afterFlick: number = await azimuth();
  await page.waitForTimeout(400);
  expect(Math.abs((await azimuth()) - afterFlick)).toBeGreaterThan(0.01); // still turning

  await page.waitForTimeout(2500); // let the coasting die out
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 200, y, { steps: 5 });
  await page.waitForTimeout(300); // the pointer rests before it lifts
  await page.mouse.up();
  const afterRest: number = await azimuth();
  await page.waitForTimeout(400);
  expect(await azimuth()).toBe(afterRest); // stopped where it was left
});

/** A page that embeds the viewer the way a store page does: the element and loader.js, nothing else. */
async function gotoEmbedPage(page: Page): Promise<void> {
  await page.route('**/embed.html', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>embed</title><mini3d-viewer product="ob1" style="display:block;width:600px;height:400px"></mini3d-viewer>'
      + '<script type="module" src="/v1/loader.js"></script>',
  }));
  await page.goto('/embed.html', { waitUntil: 'commit' }); // not 'load': a test may be holding the page's scripts back
}

test('loader.js shows the still on its own, before any hashed file has loaded', async ({ page }) => {
  const release: () => void = await holdRequests(page, /\/v1\/assets\//);
  await gotoEmbedPage(page);
  await expect(page.locator('mini3d-viewer[data-loader-still]')).toBeAttached({ timeout: 10_000 });
  release();
  await waitFor(page, 'ready'); // and the viewer still comes up once the hashed files arrive
});

test('loader.js has no static import', async ({ request }) => {
  // A static import of a hashed chunk would break a cached loader.js after a deploy that renames the chunk.
  const code: string = await (await request.get('/v1/loader.js')).text();
  expect(code).not.toMatch(/\bimport\s*(?:[\w$*{]|["'`])/);
  expect(code).toMatch(/element-[\w-]+\.js/); // it still names the viewer chunk
});

test('a speed test asked for before the after-first-view parts are shown waits for them', async ({ page }) => {
  const release = await holdRequests(page, AFTER_FIRST_VIEW);
  await page.goto('/?stats'); await waitFor(page, 'ready');
  const before: number = (await debugInfo(page)).azimuthRad!;
  await page.evaluate(() => {
    const viewer = document.querySelector('mini3d-viewer') as unknown as { runSpeedTest(): Promise<{ frames: number }> };
    (window as unknown as { __speedTest: Promise<{ frames: number }> }).__speedTest = viewer.runSpeedTest();
  });
  await page.waitForTimeout(700);
  expect((await debugInfo(page)).azimuthRad).toBe(before); // the speed test spins the model: it has not started
  release();
  const result: { frames: number } = await page.evaluate(() => (window as unknown as { __speedTest: Promise<{ frames: number }> }).__speedTest);
  expect(result.frames).toBeGreaterThan(30);
  // It could only have run after every after-first-view part was on screen.
  expect(await page.evaluate(() => (window as unknown as { __events: ViewerEvent[] }).__events
    .some(e => e.name === 'progress' && e.detail.phase === 'deferred' && e.detail.loaded === e.detail.total && (e.detail.total as number) > 0))).toBe(true);
});

// ---------- the 3D cannot start: the still stays and the page hears about it ----------

/** The still image is on screen (not faded out) and has a picture to show. */
const stillShown = (page: Page): Promise<boolean> => page.evaluate(() => {
  const still = document.querySelector('mini3d-viewer')!.shadowRoot!.querySelector('img.still') as HTMLImageElement;
  return !still.classList.contains('gone') && still.src !== '';
});

/** Makes the engine's texture generation throw: an unexpected failure in the middle of start-up. */
const BREAK_TEXTURES: string = `for (const C of [globalThis.OffscreenCanvasRenderingContext2D, globalThis.CanvasRenderingContext2D]) {
  if (C) C.prototype.getImageData = () => { throw new Error('boom'); };
}`;

/** Serves the render worker's script with `code` added in front. */
async function addToWorkerScript(page: Page, code: string): Promise<void> {
  await page.route('**/v1/assets/worker-*.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${code}\n${await response.text()}` });
  });
}

test('the 3D starts in a browser without OffscreenCanvas', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    delete (HTMLCanvasElement.prototype as unknown as { transferControlToOffscreen?: unknown }).transferControlToOffscreen;
  });
  await page.goto('/'); await waitFor(page, 'ready', 20_000);
});

for (const path of ['main', 'worker'] as const) {
  test(`an engine that throws while starting (${path} thread) reports a fatal error and leaves the still up`, async ({ page, browserName }) => {
    test.skip(path === 'worker' && browserName === 'webkit', 'WebKit renders on the main thread');
    if (path === 'main') await page.addInitScript(BREAK_TEXTURES);
    else await addToWorkerScript(page, BREAK_TEXTURES);
    await page.goto(path === 'main' ? '/?render=main' : '/');
    const error = await waitFor(page, 'error', 20_000);
    expect(error.fatal).toBe(true);
    expect(error.reason).toMatch(/^engine-failed: /);
    expect(await stillShown(page)).toBe(true);
    await pick(page, 'Shift Pattern', '7+R'); // the page keeps working, with stills
    expect((await waitFor(page, 'configurationchange')).selection).toMatchObject({ 'Shift Pattern': '7+R' });
  });
}

test('engine code that fails to download reports a fatal error and leaves the still up', async ({ page }) => {
  allowedConsole = /engine-|Failed to load|ERR_FAILED|NetworkError|module script|dynamically imported module|Importing a module script failed/i;
  await page.route('**/v1/assets/engine-*.js', route => route.abort());
  await page.goto('/?render=main');
  const error = await waitFor(page, 'error', 20_000);
  expect(error.fatal).toBe(true);
  expect(error.reason).toMatch(/^engine-load-failed: /);
  expect(await stillShown(page)).toBe(true);
});

test('a render worker that fails after it has started reports a fatal error and leaves the still up', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit renders on the main thread');
  allowedConsole = /late failure/;
  await addToWorkerScript(page, `setTimeout(() => { throw new Error('late failure'); }, 4000);`);
  await page.goto('/'); await waitFor(page, 'ready');
  const error = await waitFor(page, 'error', 20_000);
  expect(error.fatal).toBe(true);
  expect(error.reason).toMatch(/^engine-failed: /);
  expect(await stillShown(page)).toBe(true);
});

test('the loader\'s still goes once the viewer\'s own still is up, so an early pick never shows two stills', async ({ page }) => {
  const releaseParts: () => void = await holdRequests(page, /\/parts\/[^/]+\.glb(\.gz)?$/); // the 3D stays unready throughout
  const releaseCode: () => void = await holdRequests(page, /\/v1\/assets\//);
  await gotoEmbedPage(page);
  await expect(page.locator('mini3d-viewer[data-loader-still]')).toBeAttached(); // loader.js has painted the default still
  releaseCode();
  await waitFor(page, 'productload');
  await page.waitForFunction(() => {
    const still = document.querySelector('mini3d-viewer')!.shadowRoot!.querySelector('img.still') as HTMLImageElement;
    return still.complete && still.naturalWidth > 0; // the viewer's own copy of the still is showing
  });
  await expect(page.locator('mini3d-viewer:not([data-loader-still])')).toBeAttached({ timeout: 5_000 });
  expect(await page.evaluate(() => (document.querySelector('mini3d-viewer') as HTMLElement).style.background)).toBe('');

  // An early pick now swaps the only still there is.
  await page.evaluate(() => (document.querySelector('mini3d-viewer') as unknown as { setConfiguration(s: Record<string, string>): void })
    .setConfiguration({ 'Shift Knob': 'Carbon Forged | Teardrop' }));
  await page.waitForFunction(() => {
    const still = document.querySelector('mini3d-viewer')!.shadowRoot!.querySelector('img.still') as HTMLImageElement;
    return still.complete && still.naturalWidth > 0 && !/4-0-0/.test(still.src);
  });
  releaseParts();
  await waitFor(page, 'ready');
});

// ---------- the picker while a pick is still waiting for its parts ----------

/** The value whose button is pressed in that option's group. */
const pressed = (page: Page, option: string): Promise<string | null> =>
  page.locator(`button[data-option="${option}"][aria-pressed="true"]`).getAttribute('data-value');

const requestedConfiguration = (page: Page): Promise<Selection> =>
  page.evaluate(() => (document.querySelector('mini3d-viewer') as unknown as { requestedConfiguration: Record<string, string> }).requestedConfiguration);

test('a second pick does not un-press a pick still waiting for its parts', async ({ page }) => {
  const releaseSenna = await holdRequests(page, /\/parts\/knob-senna(\.light)?\.glb(\.gz)?$/);
  await page.goto('/'); await waitFor(page, 'ready');
  await pick(page, 'Shift Knob', 'Carbon Weave | Teardrop');   // waits for its held knob
  await pick(page, 'Shift Plate Style', 'Forged Carbon');
  expect(await pressed(page, 'Shift Knob')).toBe('Carbon Weave | Teardrop');
  expect(await pressed(page, 'Shift Plate Style')).toBe('Forged Carbon');
  // The viewer says both what was asked for and what is on screen.
  expect(await requestedConfiguration(page)).toEqual({ ...DEFAULT, 'Shift Knob': 'Carbon Weave | Teardrop', 'Shift Plate Style': 'Forged Carbon' });
  expect(await configuration(page)).toEqual(DEFAULT);
  releaseSenna();
  await waitFor(page, 'configurationchange');
  expect(await pressed(page, 'Shift Knob')).toBe('Carbon Weave | Teardrop');
  expect(await configuration(page)).toEqual(await requestedConfiguration(page));
});

test('an after-first-view part that fails does not un-press a pick still waiting for its parts', async ({ page }) => {
  allowedConsole = /bearings|Failed to load resource|net::ERR_FAILED|NS_ERROR|Load failed/i;
  const failBearings = await holdThenFail(page, /\/parts\/bearings(\.light)?\.glb(\.gz)?$/);
  const releaseSenna = await holdRequests(page, /\/parts\/knob-senna(\.light)?\.glb(\.gz)?$/);
  await page.goto('/'); await waitFor(page, 'ready');
  await pick(page, 'Shift Knob', 'Carbon Weave | Teardrop');
  failBearings();
  expect(await nextError(page)).toEqual(expect.objectContaining({ fatal: false, reason: expect.stringContaining('bearings') }));
  expect(await pressed(page, 'Shift Knob')).toBe('Carbon Weave | Teardrop'); // the pick is still on its way
  releaseSenna();
  await waitFor(page, 'configurationchange');
  expect(await pressed(page, 'Shift Knob')).toBe('Carbon Weave | Teardrop');
});

test('a pick whose part fails to download goes back to the button for what is on screen', async ({ page }) => {
  allowedConsole = /knob-senna|Failed to load resource|net::ERR_FAILED|NS_ERROR|Load failed/i;
  await page.route('**/parts/knob-senna*.glb*', r => r.abort());
  await page.goto('/'); await waitFor(page, 'ready');
  await pick(page, 'Shift Knob', 'Carbon Weave | Teardrop');
  expect(await nextError(page)).toEqual(expect.objectContaining({ fatal: false, reason: expect.stringContaining('knob-senna') }));
  expect(await pressed(page, 'Shift Knob')).toBe('Carbon Weave | Round');
  expect(await requestedConfiguration(page)).toEqual(DEFAULT);
});

test('compiles only the shader programs the product can use', async ({ page }) => {
  // OB1 needs six: carbon weave at full quality (clear coat + weave normals), forged carbon at full
  // quality (clear coat), both carbons at lean quality (one shared program), metal, matte, and the
  // contact shadow. Each one costs tens of milliseconds before the first view.
  const release = await holdRequests(page, AFTER_FIRST_VIEW); // the internal parts' slots are still empty at `ready`
  await page.goto('/?stats'); await waitFor(page, 'ready');
  expect((await debugInfo(page)).programs).toBe(6);
  release();
  await waitForBackgroundLoad(page);
  expect((await debugInfo(page)).programs).toBe(6); // and showing every part adds none
});

// ---------- leaving the page ----------

/** Records every WebGL2 context the page creates, so a test can ask whether any is still alive. */
async function recordContexts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const contexts: WebGL2RenderingContext[] = [];
    (window as unknown as { __contexts: WebGL2RenderingContext[] }).__contexts = contexts;
    const getContext = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, type: string, options?: unknown) => unknown;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown): unknown {
      const context: unknown = getContext.call(this, type, options);
      if (type === 'webgl2' && context && !contexts.includes(context as WebGL2RenderingContext)) contexts.push(context as WebGL2RenderingContext);
      return context;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}
const liveContexts = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __contexts: WebGL2RenderingContext[] }).__contexts.filter(c => !c.isContextLost()).length);

const removeViewer = (page: Page): Promise<void> => page.evaluate(() => {
  const viewer = document.querySelector('mini3d-viewer')!;
  (window as unknown as { __viewer: Element }).__viewer = viewer; // the page may put it back
  viewer.remove();
});

test('removing the viewer from the page releases its WebGL context (main thread)', async ({ page }) => {
  await recordContexts(page);
  await page.goto('/?render=main'); await waitFor(page, 'ready');
  expect(await liveContexts(page)).toBe(1);
  await removeViewer(page);
  await expect.poll(() => liveContexts(page)).toBe(0);
});

test('removing the viewer from the page stops its render worker', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit renders on the main thread');
  await page.goto('/'); await waitFor(page, 'ready');
  expect(page.workers().length).toBe(1);
  await removeViewer(page);
  await expect.poll(() => page.workers().length).toBe(0);
});

test('a fatal error on the main thread releases the WebGL context', async ({ page }) => {
  await recordContexts(page);
  await page.addInitScript(BREAK_TEXTURES);
  await page.goto('/?render=main');
  expect((await waitFor(page, 'error', 20_000)).fatal).toBe(true);
  await expect.poll(() => liveContexts(page)).toBe(0);
});

test('moving the viewer within the page keeps it running', async ({ page }) => {
  await recordContexts(page);
  await page.goto('/?render=main'); await waitFor(page, 'ready');
  await page.evaluate(() => {
    const viewer = document.querySelector('mini3d-viewer')!;
    const wrapper: HTMLDivElement = document.createElement('div');
    wrapper.style.cssText = 'width:100%;height:100%';
    viewer.parentElement!.append(wrapper);
    wrapper.append(viewer); // leaves the page and comes back in the same task
  });
  await page.waitForTimeout(300);
  expect(await liveContexts(page)).toBe(1);
  await pick(page, 'Shift Pattern', '7+R');
  expect((await waitFor(page, 'configurationchange')).selection).toMatchObject({ 'Shift Pattern': '7+R' });
});

test('a viewer put back on the page starts again and shows the same configuration', async ({ page }) => {
  await page.goto('/'); await waitFor(page, 'ready');
  await pick(page, 'Shift Pattern', '7+R'); await waitFor(page, 'configurationchange');
  const stage = await page.evaluateHandle(() => document.querySelector('mini3d-viewer')!.parentElement!);
  await removeViewer(page);
  await page.waitForTimeout(300);
  await page.evaluate(parent => parent.append((window as unknown as { __viewer: Element }).__viewer), stage);
  await waitFor(page, 'ready', 30_000); // a second `ready`: the 3D started again
  await expect.poll(async () => (await configuration(page))['Shift Pattern']).toBe('7+R');
  await pick(page, 'Shift Knob', 'Aluminum | Blue');
  expect((await waitFor(page, 'configurationchange')).selection).toMatchObject({ 'Shift Knob': 'Aluminum | Blue', 'Shift Pattern': '7+R' });
});

test('a pick made before the 3D starts is what the 3D opens with', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __atReady: Record<string, string> | null };
    w.__atReady = null;
    type Viewer = HTMLElement & { configuration: Record<string, string>; setConfiguration(s: Record<string, string>): void };
    // As a store page would: tell the viewer the shopper's variant the moment the element exists.
    void customElements.whenDefined('mini3d-viewer').then(() => (document.querySelector('mini3d-viewer') as Viewer).setConfiguration({ 'Shift Pattern': '7+R' }));
    document.addEventListener('ready', e => { w.__atReady = { ...(e.target as Viewer).configuration }; }, true);
  });
  await page.goto('/'); await waitFor(page, 'ready');
  expect(await page.evaluate(() => (window as unknown as { __atReady: Record<string, string> }).__atReady)).toEqual({ ...DEFAULT, 'Shift Pattern': '7+R' });
  expect(await pressed(page, 'Shift Pattern')).toBe('7+R');
});

// ---------- part downloads ----------

/** The file name of every part download, in order. */
function trackPartDownloads(page: Page): string[] {
  const names: string[] = [];
  page.on('request', request => {
    const path: string = new URL(request.url()).pathname;
    if (path.includes('/parts/')) names.push(path.split('/').pop()!);
  });
  return names;
}

/** The folder of the bundle the site currently points at, on disk. */
function currentBundleDir(): string {
  const pointer = JSON.parse(readFileSync('public/products/ob1.json', 'utf8')) as { bundle: string };
  return join('public', pointer.bundle);
}

test('parts are downloaded as their gzip copies, about a third smaller', async ({ page }) => {
  const names: string[] = trackPartDownloads(page);
  await page.goto('/'); await waitFor(page, 'ready');
  await waitForBackgroundLoad(page);
  expect(names.length).toBeGreaterThan(10);
  expect(names.filter(name => !name.endsWith('.glb.gz'))).toEqual([]);
  // And each copy really is smaller than the file it replaces.
  const parts: string = join(currentBundleDir(), 'parts');
  const size = (name: string): number => statSync(join(parts, name)).size;
  const downloaded: number = names.reduce((sum, name) => sum + size(name), 0);
  const plain: number = names.reduce((sum, name) => sum + size(name.replace(/\.gz$/, '')), 0);
  expect(downloaded).toBeLessThan(plain * 0.75);
});

test('gzip copies served as plain files, the way a CDN serves them, are unpacked by the viewer', async ({ page }) => {
  // The local test server marks .gz files `Content-Encoding: gzip`, so the browser unpacks them and the
  // viewer never has to. A CDN serves them as ordinary gzip files: this serves them that way.
  const parts: string = join(currentBundleDir(), 'parts');
  let served: number = 0;
  await page.route(/\/parts\/[^/]+\.glb\.gz$/, async route => {
    served++;
    const name: string = new URL(route.request().url()).pathname.split('/').pop()!;
    await route.fulfill({ status: 200, contentType: 'application/gzip', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(join(parts, name)) });
  });
  await page.goto('/'); await waitFor(page, 'ready');
  await waitForBackgroundLoad(page);
  expect(served).toBeGreaterThan(10);
  await pick(page, 'Shift Knob', 'Carbon Weave | Teardrop');
  expect((await waitFor(page, 'configurationchange')).selection).toMatchObject({ 'Shift Knob': 'Carbon Weave | Teardrop' });
});

test('a browser that cannot unpack gzip downloads the plain parts', async ({ page }) => {
  await page.addInitScript(() => { delete (window as unknown as { DecompressionStream?: unknown }).DecompressionStream; });
  const names: string[] = trackPartDownloads(page);
  await page.goto('/?render=main'); await waitFor(page, 'ready'); // the main thread, where the page's globals are the engine's
  expect(names.length).toBeGreaterThan(5);
  expect(names.filter(name => !name.endsWith('.glb'))).toEqual([]);
});
