import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Product, Selection } from '../../src/schema/product.ts';
import { validateProduct } from '../../src/schema/validate.ts';
import { deferredModelsOf, LoadPlanner, requiredModelsOf, SwapScheduler } from '../../src/viewer/render/scheduler.ts';

const ob1: Product = validateProduct(JSON.parse(readFileSync('products/ob1/product.json', 'utf8')));
const A: Selection = { ...ob1.defaultSelection, 'Shift Pattern': '6+R Up' };
const B: Selection = { ...ob1.defaultSelection, 'Shift Pattern': '7+R' };
const C: Selection = { ...ob1.defaultSelection, 'Shift Pattern': '6+R Down' };

test('latest request wins when picks arrive faster than parts load', () => {
  const s = new SwapScheduler(); s.request(A); s.request(B); s.request(C);
  expect(s.next(() => false)).toBeNull();
  expect(s.next(() => true)).toEqual(C);
  expect(s.pending).toBeNull();
});

const REQUIRED: string[] = ['housing', 'base', 'pad', 'usb-port', 'plate-screws', 'logo', 'plate-6r-down', 'grommet-6r-down', 'stick', 'knob-round'];
const DEFERRED: string[] = ['board', 'bracket', 'springs', 'bearings', 'mechanism-screws', 'base-screws', 'mechanism-hardware', 'board-hardware'];

test('the first view and swaps wait only for parts not marked after-first-view', () => {
  expect(requiredModelsOf(ob1, ob1.defaultSelection)).toEqual(REQUIRED);
  expect(deferredModelsOf(ob1, ob1.defaultSelection)).toEqual(DEFERRED);
});

test('after-first-view parts load right after the first view, before other variants', () => {
  const order = new LoadPlanner(ob1).order(ob1.defaultSelection);
  expect(order.slice(0, 18)).toEqual([...REQUIRED, ...DEFERRED]);
  expect(order[18]).toBe('knob-senna');
  expect(new Set(order).size).toBe(23);
});

test('required parts load before after-first-view parts, whatever the slot order', () => {
  const converted = { kind: 'converted', source: 'cad', parts: [{}] } as const;
  const p: Product = validateProduct({
    schemaVersion: 2, id: 'synthetic', name: 'Synthetic',
    sources: { cad: { file: 'x.step', units: 'mm', upAxis: 'y' } },
    models: { shell: converted, inside: converted, lid: converted },
    finishes: { plain: { kind: 'matte', color: '#808080', roughness: 0.5 } },
    slots: [
      { id: 'shell', model: 'shell', finish: 'plain' },
      { id: 'inside', parent: 'shell', placement: 'asInCad', model: 'inside', finish: 'plain', afterFirstView: true },
      { id: 'lid', parent: 'shell', placement: 'asInCad', model: 'lid', finish: 'plain' },
    ],
    options: [], defaultSelection: {},
    framing: { azimuthDeg: 0, polarDeg: 70, maxPolarDeg: 85, minZoom: 0.5, maxZoom: 2, fovDeg: 30 },
  });
  expect(new LoadPlanner(p).order({})).toEqual(['shell', 'lid', 'inside']);
});

test('a pick never swaps in a part that is loaded but not yet warmed; it asks for the warm-up first', () => {
  const s = new SwapScheduler(sel => [sel['Shift Pattern'] === '7+R' ? 'plate-7r' : 'plate-6r-up']);
  s.request(B);                                                     // 7+R
  expect(s.step(() => 'loading')).toBeNull();
  expect(s.step(() => 'loaded')).toEqual({ kind: 'warm', models: ['plate-7r'] });
  expect(s.pending).toEqual(B);                                     // still waiting
  expect(s.step(() => 'warmed')).toEqual({ kind: 'swap', selection: B });
  expect(s.pending).toBeNull();
});
