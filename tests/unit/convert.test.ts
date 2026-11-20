import { expect, test } from 'vitest';
import { NodeIO, type Accessor, type Node } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import type { Vec3 } from '../../src/schema/product.ts';
import { readStepFile, REFERENCE_TOLERANCE, type FaceRange, type StepBody, type StepFile } from '../../src/convert/occt.ts';
import { boxOf, indexParts, selectBodies } from '../../src/convert/parts.ts';
import { applyFaceRules, mergeBodies, normaliseAxes, placeBody, simplifyBody } from '../../src/convert/geometry.ts';
import { bucketMm, readAtDetail, targetToleranceMm } from '../../src/convert/tessellate.ts';
import { writeGlb } from '../../src/convert/glb.ts';

const REAL_FILE_TIMEOUT_MS: number = 60_000;
const ASSEMBLY_TIMEOUT_MS: number = 120_000;
const ASSEMBLY: string = 'assets/source/OB1-V2-ALL.STEP';

let assembly: Promise<StepFile> | null = null;
/** One coarse read of the assembly, shared by every test that needs it. */
const readAssembly = (): Promise<StepFile> => (assembly ??= readStepFile(ASSEMBLY, REFERENCE_TOLERANCE));

function sizeMm(body: StepBody): Vec3 {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const i of body.indices) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], body.positions[i * 3 + a]);
      max[a] = Math.max(max[a], body.positions[i * 3 + a]);
    }
  }
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

const near = (value: number, target: number, tolerance: number): boolean => Math.abs(value - target) <= tolerance;

const triangles = (b: StepBody): number => b.indices.length / 3;

/** Every body of a file at today's default per-part quality. */
const readAtDefaultDetail = async (path: string): Promise<StepBody[]> =>
  (await readAtDetail(path, await readStepFile(path, REFERENCE_TOLERANCE), 'default')).bodies;

/** One triangle in the plane z = `zMm`, as its own one-face body. */
function oneTriangle(zMm: number): StepBody {
  return {
    index: 0,
    name: 'triangle',
    positions: new Float32Array([0, 0, zMm, 1, 0, zMm, 0, 1, zMm]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    faces: [{ first: 0, last: 0 }],
  };
}

function faceVertices(body: StepBody, face: FaceRange): number[] {
  const vertices: number[] = [];
  for (let t = face.first; t <= face.last; t++) vertices.push(body.indices[t * 3], body.indices[t * 3 + 1], body.indices[t * 3 + 2]);
  return vertices;
}

const faceMaxRadius = (body: StepBody, face: FaceRange): number =>
  Math.max(...faceVertices(body, face).map(v => Math.hypot(body.positions[v * 3], body.positions[v * 3 + 2])));

const faceMaxY = (body: StepBody, face: FaceRange): number =>
  Math.max(...faceVertices(body, face).map(v => body.positions[v * 3 + 1]));

/** Reads a GLB back with the meshopt decoder and returns the highest world-space Y of any vertex. */
async function maxYOfGlb(glb: Uint8Array): Promise<number> {
  await MeshoptDecoder.ready;
  const io: NodeIO = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(glb);
  let maxY: number = -Infinity;
  for (const node of doc.getRoot().listNodes() as Node[]) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m: number[] = node.getWorldMatrix() as unknown as number[];
    for (const prim of mesh.listPrimitives()) {
      const pos: Accessor = prim.getAttribute('POSITION')!;
      const p: number[] = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, p);
        maxY = Math.max(maxY, m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]);
      }
    }
  }
  return maxY;
}

function syntheticBody(points: Vec3[]): StepBody {
  return {
    index: 0,
    name: 'synthetic',
    positions: new Float32Array(points.flat()),
    normals: new Float32Array(points.flatMap(() => [0, 0, 1])),
    indices: new Uint32Array(0),
    faces: [],
  };
}

const THREAD_RULE = [{ kind: 'dropNearAxis', maxRadiusMm: 6.3, maxHeightMm: 17 }] as const;

test.each(['SHIFT_KNOB_ROUND (M12x1.25)_REV2 (1).STEP', 'SHIFT_KNOB_SENNA (M12x1.25)_REV2 (2).STEP'])('removes the M12 thread from %s', async (f) => {
  const [raw] = await readAtDefaultDetail(`assets/source/${f}`);
  const { body, droppedTriangles } = applyFaceRules(normaliseAxes(raw, 'y'), [...THREAD_RULE]);
  expect(droppedTriangles).toBeGreaterThan(0.15 * raw.indices.length / 3);
  expect(body.faces.every(face => !(faceMaxRadius(body, face) < 6.3 && faceMaxY(body, face) < 17))).toBe(true);
  expect(sizeMm(body)[1]).toBeCloseTo(sizeMm(raw)[1], 1);
}, REAL_FILE_TIMEOUT_MS);

test('writes a compact GLB that reads back in metres', async () => {
  const [raw] = await readAtDefaultDetail('assets/source/SHIFT_KNOB_ROUND (M12x1.25)_REV2 (1).STEP');
  const glb = await writeGlb(applyFaceRules(normaliseAxes(raw, 'y'), [...THREAD_RULE]).body, 0.001);
  expect(glb.byteLength).toBeLessThan(120_000);
  expect(await maxYOfGlb(glb)).toBeCloseTo(0.050, 3); // read back with NodeIO + meshopt decoder
}, REAL_FILE_TIMEOUT_MS);

test('reads the assembly as a tree of named parts', async () => {
  const index = indexParts(await readAssembly(), 'y');
  expect(index.boxes).toHaveLength(132);
  const [housing] = selectBodies(index, { part: 'ALI_SHIFTER_BODY_USB-C' });
  const { minMm, maxMm } = index.boxes[housing];
  expect([0, 1, 2].every(a => near(maxMm[a] - minMm[a], [90, 100.25, 90][a], 0.2))).toBe(true);
  expect(index.instances.filter(i => i.name === 'socket countersunk head screw_iso_ISO 10642 - M3 x 10 - 10S')).toHaveLength(8);
}, ASSEMBLY_TIMEOUT_MS);

test('6+R Up is mounted as the 6+R Down grommet turned 180°', async () => {
  const index = indexParts(await readAssembly(), 'y');
  const centreX = (part: string): number => { const [b] = selectBodies(index, { part, bodies: [0] }); return (index.boxes[b].minMm[0] + index.boxes[b].maxMm[0]) / 2; };
  expect(near(centreX('OB1-SHPL-6R_MP_6R-DOWN'), -1.4, 0.2)).toBe(true);
  expect(near(centreX('OB1-SHPL-6R_MP_6R-UP'), 1.4, 0.2)).toBe(true);
}, ASSEMBLY_TIMEOUT_MS);

test('tolerance buckets sit on a √2 grid and never go below 0.01 mm', () => {
  expect(targetToleranceMm({ minMm: [0, 0, 0], maxMm: [43.4, 72, 43.4] }, 'default')).toBeCloseTo(0.0529, 4);
  expect(bucketMm(0.0529)).toBeCloseTo(0.0566, 4);
  expect(bucketMm(0.04)).toBeCloseTo(0.04, 6);
  expect(bucketMm(0.0018)).toBe(0.01);
});

test('a part read from the assembly gets the same quality as from its own file', async () => {
  const ref = await readAssembly();
  const [senna] = selectBodies(indexParts(ref, 'y'), { part: 'SHIFT_KNOB_SENNA (M12x1.25)_PRODUCTION' });
  const fromAssembly = (await readAtDetail(ASSEMBLY, ref, 'default', [senna])).bodies[senna];
  const SENNA = 'assets/source/SHIFT_KNOB_SENNA (M12x1.25)_REV2 (2).STEP';
  const fromOwnFile = (await readAtDetail(SENNA, await readStepFile(SENNA, REFERENCE_TOLERANCE), 'default')).bodies[0];
  expect(triangles(fromOwnFile)).toBeGreaterThan(20_000);              // today's quality, not the coarse reference read
  expect(triangles(fromAssembly) / triangles(fromOwnFile)).toBeGreaterThan(0.9);
  expect(triangles(fromAssembly) / triangles(fromOwnFile)).toBeLessThan(1.1);
}, ASSEMBLY_TIMEOUT_MS);

test('simplifying the bearings removes most triangles without changing their size', async () => {
  const ref = await readAssembly();
  const ids = selectBodies(indexParts(ref, 'y'), { part: '7804K126_Stainless Steel Ball Bearing_7804K126' });
  const file = await readAtDetail(ASSEMBLY, ref, 'default', ids);
  const merged = mergeBodies('bearings', ids.map(i => file.bodies[i]));
  const { body, removedTriangles } = await simplifyBody(merged, 0.05);
  expect(removedTriangles).toBeGreaterThan(0.5 * triangles(merged));
  expect(triangles(body) + removedTriangles).toBe(triangles(merged));
  sizeMm(body).forEach((s, a) => expect(near(s, sizeMm(merged)[a], 0.05)).toBe(true));
}, ASSEMBLY_TIMEOUT_MS);

test('merging keeps every triangle pointing at its own vertices', () => {
  // two one-triangle bodies (z = 0 and z = 10), each with faces [{ first: 0, last: 0 }]
  const merged = mergeBodies('pair', [oneTriangle(0), oneTriangle(10)]);
  expect([...merged.indices]).toEqual([0, 1, 2, 3, 4, 5]);
  expect(merged.positions[3 * 3 + 2]).toBe(10);
  expect(merged.faces).toEqual([{ first: 0, last: 0 }, { first: 1, last: 1 }]);
});

test('a placed source is turned, then moved, into the product frame', () => {
  const placed = placeBody(syntheticBody([[1, 0, 2]]), { positionMm: [0, 100.25, 0], rotationDeg: [0, 180, 0] });
  const [x, y, z] = placed.positions;
  expect(x).toBeCloseTo(-1, 5); expect(y).toBeCloseTo(100.25, 5); expect(z).toBeCloseTo(-2, 5);
  expect(placed.normals[2]).toBeCloseTo(-1, 5);                     // normals turn too: (0, 0, 1) → (0, 0, −1)
});

test('the REV5 6+R Up file, placed, lands where the assembly mounts its 6+R Up grommet', async () => {
  const index = indexParts(await readAssembly(), 'y');
  const [assemblyGrommet] = selectBodies(index, { part: 'OB1-SHPL-6R_MP_6R-UP', bodies: [0] });
  const [rev5] = (await readStepFile('assets/source/OB1-SHPL_6RUP_AL_REV5.STEP', REFERENCE_TOLERANCE)).bodies;
  const placed = placeBody(rev5, { positionMm: [0, 100.25, 0], rotationDeg: [0, 180, 0] });
  const box = boxOf(placed);
  const expected = index.boxes[assemblyGrommet];
  for (let a = 0; a < 3; a++) {
    expect(near(box.minMm[a], expected.minMm[a], 0.05)).toBe(true);
    expect(near(box.maxMm[a], expected.maxMm[a], 0.05)).toBe(true);
  }
}, ASSEMBLY_TIMEOUT_MS);

test('z-up sources are rotated to y-up', () => {
  const [x, y, z] = normaliseAxes(syntheticBody([[0, 0, 10]]), 'z').positions;
  expect(x).toBeCloseTo(0, 9); expect(y).toBeCloseTo(10, 9); expect(z).toBeCloseTo(0, 9);
});
