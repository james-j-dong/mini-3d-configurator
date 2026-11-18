import { expect, test } from 'vitest';
import { NodeIO, type Accessor, type Node } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import type { Vec3 } from '../../src/schema/product.ts';
import { readStepBodies, TESSELLATION_LEVELS, type FaceRange, type StepBody } from '../../src/convert/occt.ts';
import { applyFaceRules, normaliseAxes } from '../../src/convert/geometry.ts';
import { writeGlb } from '../../src/convert/glb.ts';

const REAL_FILE_TIMEOUT_MS: number = 60_000;

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

test('reads both bodies of the 6+R Down plate file', async () => {
  const bodies = await readStepBodies('assets/source/OB1-SHPL_6RDOWN_AL_REV5.STEP', TESSELLATION_LEVELS.default);
  expect(bodies).toHaveLength(2);
  expect(bodies.map(sizeMm).some(([x, y, z]) => near(x, 90, 0.1) && near(y, 3, 0.1) && near(z, 90, 0.1))).toBe(true);
}, REAL_FILE_TIMEOUT_MS);

test.each(['SHIFT_KNOB_ROUND (M12x1.25)_REV2 (1).STEP', 'SHIFT_KNOB_SENNA (M12x1.25)_REV2 (2).STEP'])('removes the M12 thread from %s', async (f) => {
  const [raw] = await readStepBodies(`assets/source/${f}`, TESSELLATION_LEVELS.default);
  const { body, droppedTriangles } = applyFaceRules(normaliseAxes(raw, 'y'), [...THREAD_RULE]);
  expect(droppedTriangles).toBeGreaterThan(0.15 * raw.indices.length / 3);
  expect(body.faces.every(face => !(faceMaxRadius(body, face) < 6.3 && faceMaxY(body, face) < 17))).toBe(true);
  expect(sizeMm(body)[1]).toBeCloseTo(sizeMm(raw)[1], 1);
}, REAL_FILE_TIMEOUT_MS);

test('writes a compact GLB that reads back in metres', async () => {
  const [raw] = await readStepBodies('assets/source/SHIFT_KNOB_ROUND (M12x1.25)_REV2 (1).STEP', TESSELLATION_LEVELS.default);
  const glb = await writeGlb(applyFaceRules(normaliseAxes(raw, 'y'), [...THREAD_RULE]).body, 0.001);
  expect(glb.byteLength).toBeLessThan(120_000);
  expect(await maxYOfGlb(glb)).toBeCloseTo(0.050, 3); // read back with NodeIO + meshopt decoder
}, REAL_FILE_TIMEOUT_MS);

test('z-up sources are rotated to y-up', () => {
  const [x, y, z] = normaliseAxes(syntheticBody([[0, 0, 10]]), 'z').positions;
  expect(x).toBeCloseTo(0, 9); expect(y).toBeCloseTo(10, 9); expect(z).toBeCloseTo(0, 9);
});
