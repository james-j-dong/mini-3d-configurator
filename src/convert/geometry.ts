// Pure geometry steps of the converter: axis normalisation and B-rep face rules.
import type { FaceRule } from '../schema/product.ts';
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

  // Compact the vertex arrays to the vertices still referenced.
  const remap: Int32Array = new Int32Array(body.positions.length / 3).fill(-1);
  let vertexCount: number = 0;
  for (const v of keptIndices) if (remap[v] < 0) remap[v] = vertexCount++;
  const positions: Float32Array = new Float32Array(vertexCount * 3);
  const normals: Float32Array = new Float32Array(vertexCount * 3);
  for (let v = 0; v < remap.length; v++) {
    const n: number = remap[v];
    if (n < 0) continue;
    positions.set(body.positions.subarray(v * 3, v * 3 + 3), n * 3);
    normals.set(body.normals.subarray(v * 3, v * 3 + 3), n * 3);
  }
  const indices: Uint32Array = Uint32Array.from(keptIndices, v => remap[v]);
  return { body: { ...body, positions, normals, indices, faces: keptFaces }, droppedTriangles };
}
