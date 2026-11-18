import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Product, Selection } from '../../src/schema/product.ts';
import { validateProduct } from '../../src/schema/validate.ts';
import { LoadPlanner, SwapScheduler } from '../../src/viewer/render/scheduler.ts';

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

test('current models load first, then one-change-away models, each once', () => {
  const order = new LoadPlanner(ob1).order(ob1.defaultSelection);
  expect(order.slice(0, 3)).toEqual(['plate-6r-down', 'grommet-6r-down', 'knob-round']);
  expect(order[3]).toBe('knob-senna');
  expect(new Set(order).size).toBe(order.length);
  expect(order).toHaveLength(8);
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
