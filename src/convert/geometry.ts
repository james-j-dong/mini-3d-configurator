// Geometry steps of the converter: axis normalisation, B-rep face rules, merging and simplification.
import { MeshoptSimplifier } from 'meshoptimizer';
import { Euler, MathUtils, Matrix3, Matrix4, Vector3 } from 'three';
import type { FaceRule, Placement } from '../schema/product.ts';
import type { FaceRange, StepBody } from './occt.ts';

/** Returns the body in Y-up. A Z-up source is rotated −90° about X: (x, y, z) → (x, z, −y). */
export function normaliseAxes(body: StepBody, upAxis: 'y' | 'z'): StepBody {
  if (upAxis === 'y') return body;
  const rotate = (src: Float32Array): Float32Array => {
    const out: Float32Array = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      out[i] = src[i];
      out[i + 1] = src[i + 2];
      out[i + 2] = -src[i + 1];
    }
    return out;
  };
  return { ...body, positions: rotate(body.positions), normals: rotate(body.normals) };
}

interface FaceExtent { maxRadius: number; maxY: number }

/** The face's furthest distance from the model Y axis, and its highest point. */
function faceExtent(body: StepBody, face: FaceRange): FaceExtent {
  let maxRadius: number = 0;
  let maxY: number = -Infinity;
  for (let i = face.first * 3; i <= face.last * 3 + 2; i++) {
    const v: number = body.indices[i] * 3;
    maxRadius = Math.max(maxRadius, Math.hypot(body.positions[v], body.positions[v + 2]));
    maxY = Math.max(maxY, body.positions[v + 1]);
  }
  return { maxRadius, maxY };
}

function isDropped(extent: FaceExtent, rules: FaceRule[]): boolean {
  return rules.some(rule => rule.kind === 'dropNearAxis' && extent.maxRadius < rule.maxRadiusMm && extent.maxY < rule.maxHeightMm);
}

/**
 * Removes every B-rep face a rule matches (positions in mm, model Y axis), then drops the
 * vertices nothing uses any more. Kept faces keep their order, with renumbered triangle ranges.
 */
export function applyFaceRules(body: StepBody, rules: FaceRule[]): { body: StepBody; droppedTriangles: number } {
  const keptIndices: number[] = [];
  const keptFaces: FaceRange[] = [];
  let droppedTriangles: number = 0;
  for (const face of body.faces) {
    const triangles: number = face.last - face.first + 1;
    if (isDropped(faceExtent(body, face), rules)) {
      droppedTriangles += triangles;
      continue;
    }
    const first: number = keptIndices.length / 3;
    for (let i = face.first * 3; i <= face.last * 3 + 2; i++) keptIndices.push(body.indices[i]);
    keptFaces.push({ first, last: first + triangles - 1 });
  }

  return { body: { ...withOnlyUsedVertices(body, keptIndices), faces: keptFaces }, droppedTriangles };
}

/** The body with these triangle indices, its vertex arrays compacted to the vertices they still use. */
function withOnlyUsedVertices(body: StepBody, keptIndices: ArrayLike<number>): StepBody {
  const remap: Int32Array = new Int32Array(body.positions.length / 3).fill(-1);
  let vertexCount: number = 0;
  for (let i = 0; i < keptIndices.length; i++) if (remap[keptIndices[i]] < 0) remap[keptIndices[i]] = vertexCount++;
  const positions: Float32Array = new Float32Array(vertexCount * 3);
  const normals: Float32Array = new Float32Array(vertexCount * 3);
  for (let v = 0; v < remap.length; v++) {
    const n: number = remap[v];
    if (n < 0) continue;
    positions.set(body.positions.subarray(v * 3, v * 3 + 3), n * 3);
    normals.set(body.normals.subarray(v * 3, v * 3 + 3), n * 3);
  }
  const indices: Uint32Array = Uint32Array.from(keptIndices, v => remap[v]);
  return { ...body, positions, normals, indices };
}

/** Concatenates bodies into one (index 0, the given name). Faces are kept, with offset ranges. */
export function mergeBodies(name: string, bodies: StepBody[]): StepBody {
  const vertexFloats: number = bodies.reduce((sum, b) => sum + b.positions.length, 0);
  const indexCount: number = bodies.reduce((sum, b) => sum + b.indices.length, 0);
  const positions: Float32Array = new Float32Array(vertexFloats);
  const normals: Float32Array = new Float32Array(vertexFloats);
  const indices: Uint32Array = new Uint32Array(indexCount);
  const faces: FaceRange[] = [];
  let floatOffset: number = 0;
  let indexOffset: number = 0;
  for (const body of bodies) {
    const firstVertex: number = floatOffset / 3;
    const firstTriangle: number = indexOffset / 3;
    positions.set(body.positions, floatOffset);
    normals.set(body.normals, floatOffset);
    for (let i = 0; i < body.indices.length; i++) indices[indexOffset + i] = body.indices[i] + firstVertex;
    for (const face of body.faces) faces.push({ first: face.first + firstTriangle, last: face.last + firstTriangle });
    floatOffset += body.positions.length;
    indexOffset += body.indices.length;
  }
  return { index: 0, name, positions, normals, indices, faces };
}

/**
 * Turns the body by the placement's XYZ Euler rotation (degrees, the viewer's socket convention), then
 * moves it by its position (mm): the file's frame placed into the product frame. Normals turn with it.
 */
export function placeBody(body: StepBody, placement: Placement): StepBody {
  const [rx, ry, rz] = (placement.rotationDeg ?? [0, 0, 0]).map(d => MathUtils.degToRad(d));
  const transform: Matrix4 = new Matrix4().makeRotationFromEuler(new Euler(rx, ry, rz, 'XYZ')).setPosition(...placement.positionMm);
  const turn: Matrix3 = new Matrix3().setFromMatrix4(transform);
  const positions: Float32Array = new Float32Array(body.positions.length);
  const normals: Float32Array = new Float32Array(body.normals.length);
  const v: Vector3 = new Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    v.fromArray(body.positions, i).applyMatrix4(transform).toArray(positions, i);
    v.fromArray(body.normals, i).applyMatrix3(turn).toArray(normals, i);
  }
  return { ...body, positions, normals };
}

/**
 * Simplifies the body as far as `maxErrorMm` allows (meshoptimizer, absolute error, borders locked),
 * then drops unused vertices. occt-import-js gives every B-rep face its own vertices, so locking
 * borders keeps neighbouring faces sealed and opens no cracks. Face ranges are lost (faces = []),
 * so run face rules first.
 */
export async function simplifyBody(body: StepBody, maxErrorMm: number): Promise<{ body: StepBody; removedTriangles: number }> {
  await MeshoptSimplifier.ready;
  const [kept] = MeshoptSimplifier.simplify(body.indices, body.positions, 3, 0, maxErrorMm, ['LockBorder', 'ErrorAbsolute']);
  const removedTriangles: number = (body.indices.length - kept.length) / 3;
  return { body: { ...withOnlyUsedVertices(body, kept), faces: [] }, removedTriangles };
}
