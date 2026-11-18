import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import type { Product, Selection } from '../../src/schema/product.ts';
import { validateProduct } from '../../src/schema/validate.ts';
import { resolveConfiguration } from '../../src/schema/configurations.ts';
import { resolveAssembly } from '../../src/viewer/render/assembly.ts';

const ob1: Product = validateProduct(JSON.parse(readFileSync('products/ob1/product.json', 'utf8')));

/** A minimal valid product around the given models, slots and options. */
function synthetic(parts: Pick<Product, 'models' | 'slots' | 'options' | 'defaultSelection'>): Product {
  return validateProduct({
    schemaVersion: 1,
    id: 'synthetic',
    name: 'Synthetic',
    sources: {},
    finishes: { plain: { kind: 'matte', color: '#808080', roughness: 0.5 } },
    framing: { azimuthDeg: 0, polarDeg: 70, maxPolarDeg: 85, minZoom: 0.5, maxZoom: 2, fovDeg: 30 },
    ...parts,
  });
}

const rotated: Product = synthetic({
  models: {
    base: { kind: 'box', sizeMm: [20, 20, 20], sockets: { side: { positionMm: [10, 0, 0], rotationDeg: [0, 0, 90] } } },
    ball: { kind: 'sphere', radiusMm: 5 },
  },
  slots: [
    { id: 'root', model: 'base', finish: 'plain' },
    { id: 'child', parent: 'root', socket: 'side', placement: 'socket', model: 'ball', finish: 'plain' },
  ],
  options: [],
  defaultSelection: {},
});

const swappable: Product = synthetic({
  models: {
    shortBody: { kind: 'box', sizeMm: [90, 100, 90], sockets: { plateMount: { positionMm: [0, 100, 0] } } },
    tallBody: { kind: 'box', sizeMm: [90, 150, 90], sockets: { plateMount: { positionMm: [0, 150, 0] } } },
    plate: { kind: 'box', sizeMm: [90, 3, 90] },
  },
  slots: [
    { id: 'body', model: 'shortBody', finish: 'plain' },
    { id: 'plate', parent: 'body', socket: 'plateMount', placement: 'socket', model: 'plate', finish: 'plain' },
  ],
  options: [{
    name: 'Height',
    values: [
      { name: 'Short', sets: [{ slot: 'body', model: 'shortBody' }] },
      { name: 'Tall', sets: [{ slot: 'body', model: 'tallBody' }] },
    ],
  }],
  defaultSelection: { Height: 'Short' },
});
const short: Selection = { Height: 'Short' };
const tall: Selection = { Height: 'Tall' };

const yOf = (slot: string, selection: Selection): number =>
  new Vector3().setFromMatrixPosition(resolveAssembly(swappable, resolveConfiguration(swappable, selection)).get(slot)!).y;

test('the knob sits on the rod tip above the body', () => {
  const m = resolveAssembly(ob1, resolveConfiguration(ob1, ob1.defaultSelection));
  expect(new Vector3().setFromMatrixPosition(m.get('knob')!).y).toBeCloseTo(0.181, 6);
});

test('the ball stand-in attaches by its attach point', () => {
  const m = resolveAssembly(ob1, resolveConfiguration(ob1, { ...ob1.defaultSelection, 'Shift Knob': 'Aluminum | Gunmetal' }));
  expect(new Vector3().setFromMatrixPosition(m.get('knob')!).y).toBeCloseTo(0.199, 6);
});

test('as-in-CAD children share the parent frame', () => {
  const m = resolveAssembly(ob1, resolveConfiguration(ob1, ob1.defaultSelection));
  expect(m.get('grommet')!.equals(m.get('plate')!)).toBe(true);
});

test('a rotated socket rotates and moves its children', () => {
  const world = resolveAssembly(rotated, resolveConfiguration(rotated, rotated.defaultSelection)).get('child')!;
  const childY = new Vector3(0, 1, 0).transformDirection(world);
  expect(childY.x).toBeCloseTo(-1, 6);
  expect(new Vector3().setFromMatrixPosition(world).x).toBeCloseTo(0.010, 6);
});

test('swapping a parent model re-attaches its children', () => {
  expect(yOf('plate', short)).toBeCloseTo(0.100, 6);
  expect(yOf('plate', tall)).toBeCloseTo(0.150, 6);
});
