// Reads STEP files with occt-import-js (OpenCascade compiled to wasm) and returns one tessellated body per solid.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/** A run of triangles that came from one B-rep face. Triangle indices, inclusive. */
export interface FaceRange { first: number; last: number }

/** One body from a STEP file. Positions are in millimetres (OpenCascade converts from the file's declared unit). */
export interface StepBody {
  index: number;
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faces: FaceRange[];
}

/** Tessellation tolerances: linear deflection relative to each part's bounding box, angular in radians. */
export interface TessellationLevel { linearRatio: number; angularRad: number }

export const TESSELLATION_LEVELS: { default: TessellationLevel; light: TessellationLevel } = {
  default: { linearRatio: 0.001, angularRad: 0.35 },
  light: { linearRatio: 0.002, angularRad: 0.5 },
};

interface OcctMesh {
  name: string;
  brep_faces: Array<{ first: number; last: number }>;
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
}
interface OcctResult { success: boolean; meshes: OcctMesh[] }
interface OcctModule { ReadStepFile(content: Uint8Array, params: object | null): OcctResult }

const require = createRequire(import.meta.url);
const occtImport: () => Promise<OcctModule> = require('occt-import-js');
let occtModule: Promise<OcctModule> | null = null;

export async function readStepBodies(path: string, level: TessellationLevel): Promise<StepBody[]> {
  occtModule ??= occtImport();
  const occt: OcctModule = await occtModule;
  const result: OcctResult = occt.ReadStepFile(new Uint8Array(readFileSync(path)), {
    linearUnit: 'millimeter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: level.linearRatio,
    angularDeflection: level.angularRad,
  });
  if (!result.success) throw new Error(`OpenCascade could not read ${path}`);
  return result.meshes.map((mesh, index): StepBody => {
    if (!mesh.attributes.normal) throw new Error(`${path}: body ${index} has no normals`);
    return {
      index,
      name: mesh.name,
      positions: new Float32Array(mesh.attributes.position.array),
      normals: new Float32Array(mesh.attributes.normal.array),
      indices: new Uint32Array(mesh.index.array),
      faces: mesh.brep_faces.map(f => ({ first: f.first, last: f.last })),
    };
  });
}
