import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import type { Product, Selection } from '../../src/schema/product.ts';
import { validateProduct } from '../../src/schema/validate.ts';
import { resolveConfiguration } from '../../src/schema/configurations.ts';
import { resolveAssembly } from '../../src/viewer/render/assembly.ts';

const ob1: Product = validateProduct(JSON.parse(readFileSync('products/ob1/product.json', 'utf8')));

/** A minimal valid product around the given models, slots and options. */
function synthetic(parts: Pick<Product, 'models' | 'slots' | 'options' | 'defaultSelection'>): Product {
  return validateProduct({
    schemaVersion: 2,
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

test('each knob sits on the stick tip, where the assembly\'s knobs sat', () => {
  for (const [knob, liftMm] of [['Carbon Weave | Round', 0], ['Carbon Weave | Teardrop', 0], ['Aluminum | Silver', 18]] as const) {
    const p = new Vector3().setFromMatrixPosition(resolveAssembly(ob1, resolveConfiguration(ob1, { ...ob1.defaultSelection, 'Shift Knob': knob })).get('knob')!);
    expect(p.x).toBeCloseTo(-0.00753, 6); expect(p.y).toBeCloseTo(0.15125 + liftMm / 1000, 6); expect(p.z).toBeCloseTo(0, 6);
  }
});

test('the logo sits 0.05 mm above every plate, on its engraving, so it never flickers against it', () => {   // Review Focus 4
  for (const pattern of ['6+R Down', '6+R Up', '7+R']) {
    const world = resolveAssembly(ob1, resolveConfiguration(ob1, { ...ob1.defaultSelection, 'Shift Pattern': pattern }));
    const logo = new Vector3().setFromMatrixPosition(world.get('logo')!);
    expect(logo.y).toBeCloseTo(0.00005, 8);
    expect(logo.z).toBeCloseTo(0.0005, 8);                         // the REV5 engraving sits 0.5 mm nearer the driver than the V15 letters
    expect(logo.x).toBeCloseTo(0, 8);
    expect(new Vector3().setFromMatrixPosition(world.get('plate')!).y).toBe(0);
  }
});

test('6+R Up turns the stick and its mechanism 180° so the stick rests in the plate\'s 3/4 neutral', () => {
  const MECHANISM: string[] = ['stick', 'bracket', 'springs', 'bearings', 'mechanism-screws', 'mechanism-hardware'];
  const FIXED: string[] = ['housing', 'base', 'pad', 'usb-port', 'plate-screws', 'plate', 'grommet', 'board', 'base-screws', 'board-hardware'];
  for (const [pattern, turned] of [['6+R Down', false], ['6+R Up', true], ['7+R', false]] as const) {
    const world = resolveAssembly(ob1, resolveConfiguration(ob1, { ...ob1.defaultSelection, 'Shift Pattern': pattern }));
    const knob = new Vector3().setFromMatrixPosition(world.get('knob')!);
    expect(knob.x).toBeCloseTo(turned ? 0.00753 : -0.00753, 6);
    expect(knob.z).toBeCloseTo(0, 6);
    for (const slot of MECHANISM) {
      const xAxis = new Vector3(1, 0, 0).transformDirection(world.get(slot)!);
      expect(xAxis.x, `${pattern}: ${slot}`).toBeCloseTo(turned ? -1 : 1, 6);
      expect(new Vector3().setFromMatrixPosition(world.get(slot)!).length(), `${pattern}: ${slot}`).toBeCloseTo(0, 9);
    }
    for (const slot of FIXED) expect(world.get(slot)!.equals(new Matrix4()), `${pattern}: ${slot}`).toBe(true);
  }
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
