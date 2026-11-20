import { expect, test } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Product } from '../../src/schema/product.ts';
import { validateProduct } from '../../src/schema/validate.ts';
import { compareWithBaseline, computeVersion, groupModels, lookFingerprint, partFiles, type SizeReport } from '../../src/convert/bundle.ts';

const ob1: Product = validateProduct(JSON.parse(readFileSync('products/ob1/product.json', 'utf8')));

test('same inputs give the same version', () => {
  const a = computeVersion('{"x":1}', [['b', new Uint8Array([2])], ['a', new Uint8Array([1])]]);
  expect(a).toMatch(/^[0-9a-f]{12}$/);
  expect(computeVersion('{"x":1}', [['a', new Uint8Array([1])], ['b', new Uint8Array([2])]])).toBe(a);
  expect(computeVersion('{"x":2}', [['a', new Uint8Array([1])], ['b', new Uint8Array([2])]])).not.toBe(a);
});

test('flags growth over 10%', () => {
  const r = (t: number): SizeReport => ({ version: 'v', gzipBytes: {}, totalGzipBytes: t });
  expect(compareWithBaseline(r(1110), r(1000)).flagged).toBe(true);
  expect(compareWithBaseline(r(1090), r(1000)).flagged).toBe(false);
  expect(compareWithBaseline(r(5000), null).flagged).toBe(false);
});

test('a baseline written when sizes were measured another way counts as no baseline', () => {
  const old = { version: 'v', brotliBytes: {}, totalBrotliBytes: 1000 } as unknown as SizeReport;
  expect(compareWithBaseline({ version: 'w', gzipBytes: {}, totalGzipBytes: 5000 }, old)).toEqual({ deltaRatio: 0, flagged: false });
});

test('every part is published as the GLB and as a gzip copy of it', () => {
  const glb = new Uint8Array(Array.from({ length: 4000 }, (_, i) => (i * 13) % 97));
  const files = partFiles('housing.light', glb);
  expect(files.map(([path]) => path)).toEqual(['parts/housing.light.glb', 'parts/housing.light.glb.gz']);
  expect(files[0][1]).toBe(glb);
  expect(files[1][1].length).toBeLessThan(glb.length);
  expect(new Uint8Array(gunzipSync(files[1][1]))).toEqual(glb);
});

test('groups models into always shown, variants and after the first view', () => {
  expect(groupModels(ob1)).toEqual({
    alwaysShown: ['housing', 'base', 'pad', 'usb-port', 'plate-screws', 'logo', 'stick'],
    variants: ['plate-6r-down', 'grommet-6r-down', 'plate-6r-up', 'grommet-6r-up', 'plate-7r', 'grommet-7r', 'knob-round', 'knob-senna'],
    afterFirstView: ['board', 'bracket', 'springs', 'bearings', 'mechanism-screws', 'base-screws', 'mechanism-hardware', 'board-hardware'],
  });
});

test('a change to the render code that draws the stills changes the bundle fingerprint', () => {
  const dir: string = mkdtempSync(join(tmpdir(), 'look-'));
  writeFileSync(join(dir, 'materials.ts'), 'export const clearcoat = 1;');
  writeFileSync(join(dir, 'studio.ts'), 'export const card = 2;');
  const before: string = lookFingerprint(dir);
  expect(lookFingerprint(dir)).toBe(before);
  writeFileSync(join(dir, 'studio.ts'), 'export const card = 3;');
  expect(lookFingerprint(dir)).not.toBe(before);
});
