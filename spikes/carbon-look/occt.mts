// Throwaway spike helpers around occt-import-js (OpenCascade compiled to wasm).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const occtimportjs: () => Promise<OcctModule> = require('occt-import-js');

export interface OcctFaceRange { first: number; last: number; color: number[] | null }
export interface OcctMesh {
  name: string;
  color?: number[];
  brep_faces: OcctFaceRange[];
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
}
export interface OcctResult { success: boolean; meshes: OcctMesh[] }
interface OcctModule { ReadStepFile(content: Uint8Array, params: object | null): OcctResult }

export interface TessellationParams {
  linearUnit: 'millimeter';
  linearDeflectionType: 'bounding_box_ratio' | 'absolute_value';
  linearDeflection: number;
  angularDeflection: number;
}

let modulePromise: Promise<OcctModule> | null = null;

export async function readStep(path: string, params: TessellationParams): Promise<OcctResult> {
  modulePromise ??= occtimportjs();
  const occt: OcctModule = await modulePromise;
  const bytes: Uint8Array = new Uint8Array(readFileSync(path));
  const result: OcctResult = occt.ReadStepFile(bytes, params);
  if (!result.success) throw new Error(`occt failed to read ${path}`);
  return result;
}

export interface Bounds { min: [number, number, number]; max: [number, number, number] }

export function meshBounds(mesh: OcctMesh): Bounds {
  const p: number[] = mesh.attributes.position.array;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[i + a]);
      max[a] = Math.max(max[a], p[i + a]);
    }
  }
  return { min, max };
}
