import { expect, test } from 'vitest';
import type { Vec3 } from '../../src/schema/product.ts';
import type { StepBody, StepFile, StepNode } from '../../src/convert/occt.ts';
import { claimBodies, describeBody, indexParts, selectBodies, type PartIndex } from '../../src/convert/parts.ts';

/** A box-shaped fake body: its 8 corners, no triangles. */
function boxBody(index: number, name: string, minMm: Vec3, maxMm: Vec3): StepBody {
  const corners: number[] = [];
  for (const x of [minMm[0], maxMm[0]]) for (const y of [minMm[1], maxMm[1]]) for (const z of [minMm[2], maxMm[2]]) corners.push(x, y, z);
  return {
    index,
    name,
    positions: new Float32Array(corners),
    normals: new Float32Array(corners.length),
    indices: new Uint32Array(0),
    faces: [],
  };
}

const node = (name: string, bodies: number[], children: StepNode[] = []): StepNode => ({ name, bodies, children });

const file: StepFile = {
  bodies: [
    boxBody(0, 'Screw', [-1, 96, -1], [1, 100, 1]),
    boxBody(1, 'Screw', [-1, -1, -1], [1, 3, 1]),
    boxBody(2, '', [-45, 100, -45], [45, 103, 45]),
    boxBody(3, '', [-30, 100, -25], [30, 103, 25]),
    boxBody(4, 'PCB', [-20, 10, -20], [20, 12, 20]),
    boxBody(5, 'USB', [40, 10, -5], [45, 13, 5]),
    boxBody(6, '', [0, 0, 0], [1, 1, 1]),
  ],
  root: node('', [], [
    node('Asm', [], [
      node('Screw', [0]),
      node('Screw', [1]),
      node('Plate', [2, 3]),
      node('Board', [4, 5]),
    ]),
    node('', [6]),
  ]),
};

const index: PartIndex = indexParts(file, 'y');

test('picks a part by name, its bodies by position, and repeated instances by where they sit', () => {
  expect(selectBodies(index, { part: 'Screw', within: { minMm: [-100, 50, -100], maxMm: [100, 200, 100] } })).toEqual([0]);
  expect(selectBodies(index, { part: 'Screw' })).toEqual([0, 1]);
  expect(selectBodies(index, { part: 'Plate', bodies: [1] })).toEqual([3]);
  expect(selectBodies(index, {})).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(selectBodies(index, { bodies: [6] })).toEqual([6]);
});

test('a named mesh inside a named part can be picked on its own', () => {
  expect(selectBodies(index, { part: 'USB' })).toEqual([5]);
  expect(selectBodies(index, { part: 'Board' })).toEqual([4, 5]);
});

test('a body position past the end of a part fails', () => {
  expect(() => selectBodies(index, { part: 'Plate', bodies: [2] })).toThrow(/"Plate" #0 has only 2 bodies/);
});

test('every body must be claimed exactly once', () => {
  const models = [{ id: 'screws', parts: [{ part: 'Screw' }] }, { id: 'rest', parts: [{ part: 'Plate' }, { part: 'Board' }] }];
  expect(() => claimBodies('asm', index, models, [])).toThrow(/asm: not used by any model and not left out:[\s\S]*\(unnamed\) body 6/);
  expect(() => claimBodies('asm', index, models, [{ part: 'Screw' }, { bodies: [6] }])).toThrow(/claimed by both "screws" and "leaveOut"/);
  expect(() => claimBodies('asm', index, [{ id: 'x', parts: [{ part: 'Nut' }] }], [])).toThrow(/model "x" selects nothing/);
  expect(claimBodies('asm', index, [...models, { id: 'misc', parts: [{ bodies: [6] }] }], []))
    .toEqual(new Map([['screws', [0, 1]], ['rest', [2, 3, 4, 5]], ['misc', [6]]]));
});

test('error reports describe bodies that sit under no named part', () => {   // Review Focus 5
  expect(describeBody(index, 6)).toBe('(unnamed) body 6 (1.0 × 1.0 × 1.0 mm at 0.5, 0.5, 0.5)');
  expect(describeBody(index, 3)).toBe('"Plate" #0 body 1 (60.0 × 3.0 × 50.0 mm at 0.0, 101.5, 0.0)');
});

test('a source that states its body count fails when the file no longer has that many', () => {
  const everything = [{ id: 'everything', parts: [{}] }]; // a whole-file selection would quietly swallow an added body
  expect(claimBodies('asm', index, everything, [], 7)).toEqual(new Map([['everything', [0, 1, 2, 3, 4, 5, 6]]]));
  expect(() => claimBodies('asm', index, everything, [], 6)).toThrow(/asm: the file has 7 bodies, but its "bodyCount" says 6/);
  expect(() => claimBodies('asm', index, everything, [], 8)).toThrow(/asm: the file has 7 bodies, but its "bodyCount" says 8/);
});
