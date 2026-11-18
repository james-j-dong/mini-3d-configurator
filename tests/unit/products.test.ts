import { expect, test, vi } from 'vitest';
import { resolveProductUrl } from '../../src/viewer/products.ts';

test('resolves a product id through its pointer file', async () => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ version: 'abc123', bundle: 'bundles/ob1/abc123/', defaultStill: 'bundles/ob1/abc123/stills/4-0-0.webp' })));
  expect(await resolveProductUrl('ob1', 'https://x.test')).toEqual({ productUrl: 'https://x.test/bundles/ob1/abc123/product.json', defaultStillUrl: 'https://x.test/bundles/ob1/abc123/stills/4-0-0.webp' });
  expect(fetch).toHaveBeenCalledWith('https://x.test/products/ob1.json');
});
