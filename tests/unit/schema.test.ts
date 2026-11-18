import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { ProductError, validateProduct } from '../../src/schema/validate.ts';
import {
  configurationKey,
  listConfigurations,
  normaliseSelection,
  resolveConfiguration,
} from '../../src/schema/configurations.ts';

const ob1 = (): unknown => JSON.parse(readFileSync('products/ob1/product.json', 'utf8'));

test('OB1 settings file validates', () => {
  const p = validateProduct(ob1());
  expect(p.options.map(o => o.values.length)).toEqual([7, 3, 3]);
});

test('lists 63 configurations with unique keys', () => {
  const p = validateProduct(ob1());
  const keys = listConfigurations(p).map(s => configurationKey(p, s));
  expect(keys).toHaveLength(63);
  expect(new Set(keys).size).toBe(63);
  expect(configurationKey(p, p.defaultSelection)).toBe('4-0-0');
});

test('resolves a selection to slot models and finishes', () => {
  const p = validateProduct(ob1());
  const r = resolveConfiguration(p, { 'Shift Knob': 'Carbon Forged | Teardrop', 'Shift Plate Style': 'Anodized Grey Aluminium', 'Shift Pattern': '7+R' });
  expect(r.knob).toEqual({ model: 'knob-senna', finish: 'forgedCarbon' });
  expect(r.plate).toEqual({ model: 'plate-7r', finish: 'anodizedGrey' });
  expect(r.grommet).toEqual({ model: 'grommet-7r', finish: 'tpuGrey' });
  expect(r.rod).toEqual({ model: 'rod', finish: 'steel' });
});

test.each([
  ['unknown finish on a slot', (p: any) => { p.slots[0].finish = 'nope'; }, 'slots[0].finish'],
  ['missing parent slot', (p: any) => { p.slots[1].parent = 'nope'; }, 'slots[1].parent'],
  ['parent cycle', (p: any) => { p.slots[0].parent = 'knob'; p.slots[0].socket = 'x'; }, 'slots'],
  ['option sets an unknown slot', (p: any) => { p.options[0].values[0].sets[0].slot = 'nope'; }, 'options[0].values[0].sets[0].slot'],
  ['socket missing on a parent model', (p: any) => { p.slots[1].socket = 'nope'; }, 'slots[1].socket'],
  ['converted model with unknown source', (p: any) => { p.models['knob-round'].source = 'nope'; }, 'models.knob-round.source'],
])('rejects a broken file: %s', (_n, breakIt, path) => {
  const p = ob1() as any; breakIt(p);
  try { validateProduct(p); throw new Error('accepted'); } catch (e) { expect(e).toBeInstanceOf(ProductError); expect((e as ProductError).path).toBe(path); }
});

test('normaliseSelection merges a partial pick and rejects unknown values', () => {
  const p = validateProduct(ob1());
  expect(normaliseSelection(p, { 'Shift Pattern': '7+R' }, p.defaultSelection)).toEqual({ ...p.defaultSelection, 'Shift Pattern': '7+R' });
  expect(() => normaliseSelection(p, { 'Shift Pattern': '8+R' }, p.defaultSelection)).toThrow(ProductError);
  expect(() => normaliseSelection(p, { 'Gear Lever': 'x' }, p.defaultSelection)).toThrow(ProductError);
});
