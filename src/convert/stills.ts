// Renders one still per configuration with the viewer itself (headless Chromium), so stills match
// the 3D exactly. Stills are build outputs: rerun after any model or assembly change.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import type { BuiltProduct, Selection } from '../schema/product.ts';
import { validateProduct } from '../schema/validate.ts';
import { configurationKey, listConfigurations } from '../schema/configurations.ts';

const STILL_SIZE_PX: number = 1000;
const READY_TIMEOUT_MS: number = 60_000;

/** Records every viewer event from page start (they bubble and are composed). */
const RECORD_EVENTS: string = `
  window.__events = [];
  for (const name of ['productload', 'progress', 'ready', 'configurationchange', 'error', 'restored']) {
    document.addEventListener(name, e => window.__events.push({ name, detail: e.detail }), true);
  }`;

function readBuiltProduct(productId: string, publicDir: string): { product: BuiltProduct; bundleDir: string } {
  const pointer: { bundle: string } = JSON.parse(readFileSync(join(publicDir, 'products', `${productId}.json`), 'utf8')) as { bundle: string };
  const bundleDir: string = join(publicDir, pointer.bundle);
  const product: BuiltProduct = validateProduct(JSON.parse(readFileSync(join(bundleDir, 'product.json'), 'utf8'))) as BuiltProduct;
  return { product, bundleDir };
}

/** Sets the configuration, waits until it's on screen, and returns the captured WebP as base64. */
async function captureConfiguration(page: Page, selection: Selection, sizePx: number): Promise<string> {
  return page.evaluate(async ({ selection, sizePx }) => {
    const viewer = document.getElementById('viewer') as HTMLElement & {
      setConfiguration(s: Record<string, string>): void;
      captureStill(size: number): Promise<Blob>;
    };
    const shown = new Promise<void>((resolve, reject) => {
      viewer.addEventListener('configurationchange', () => resolve(), { once: true });
      viewer.addEventListener('error', e => reject(new Error((e as unknown as CustomEvent<{ reason: string }>).detail.reason)), { once: true });
    });
    viewer.setConfiguration(selection);
    await shown;
    const blob: Blob = await viewer.captureStill(sizePx);
    const bytes: Uint8Array = new Uint8Array(await blob.arrayBuffer());
    let binary: string = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }, { selection, sizePx });
}

export async function renderStills(productId: string, publicDir: string): Promise<{ count: number; totalBytes: number }> {
  const { product, bundleDir } = readBuiltProduct(productId, publicDir);
  const stillsDir: string = join(bundleDir, 'stills');
  mkdirSync(stillsDir, { recursive: true });

  const server: ViteDevServer = await createServer({ logLevel: 'error', server: { port: 5199, strictPort: false } });
  let browser: Browser | null = null;
  try {
    await server.listen();
    const base: string = server.resolvedUrls!.local[0];
    browser = await chromium.launch();
    const page: Page = await browser.newPage({ viewport: { width: STILL_SIZE_PX, height: STILL_SIZE_PX }, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.addInitScript(RECORD_EVENTS);
    await page.goto(new URL(`src/site/capture.html?product=${encodeURIComponent(productId)}`, base).href);
    await page.waitForFunction(() => {
      const events = (window as unknown as { __events: Array<{ name: string; detail: { fatal?: boolean; reason?: string } }> }).__events;
      const fatal = events.find(e => e.name === 'error' && e.detail.fatal);
      if (fatal) throw new Error(`viewer failed: ${fatal.detail.reason}`);
      return events.some(e => e.name === 'ready');
    }, undefined, { timeout: READY_TIMEOUT_MS });

    let count: number = 0;
    let totalBytes: number = 0;
    for (const selection of listConfigurations(product)) {
      const bytes: Buffer = Buffer.from(await captureConfiguration(page, selection, product.stills.sizePx), 'base64');
      const file: string = product.stills.pattern.replace('{key}', configurationKey(product, selection));
      writeFileSync(join(bundleDir, file), bytes);
      count++;
      totalBytes += bytes.length;
    }
    if (pageErrors.length) throw new Error(`page errors while rendering stills:\n${pageErrors.join('\n')}`);
    return { count, totalBytes };
  } finally {
    await browser?.close();
    await server.close();
  }
}
