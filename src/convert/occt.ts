// Reads STEP files with occt-import-js (OpenCascade compiled to wasm): one tessellated body per solid, plus the assembly tree.
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

interface OcctMesh {
  name: string;
  brep_faces: Array<{ first: number; last: number }>;
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
}
interface OcctNode { name: string; meshes: number[]; children: OcctNode[] }
interface OcctResult { success: boolean; meshes: OcctMesh[]; root: OcctNode }
interface OcctModule { ReadStepFile(content: Uint8Array, params: object | null): OcctResult }

const require = createRequire(import.meta.url);
const occtImport: () => Promise<OcctModule> = require('occt-import-js');
let occtModule: Promise<OcctModule> | null = null;

/** Absolute tessellation tolerances: linear deflection in millimetres, angular in radians. */
export interface Tolerance { linearMm: number; angularRad: number }

/** A coarse, fast read for structure and sizes only. */
export const REFERENCE_TOLERANCE: Tolerance = { linearMm: 0.32, angularRad: 0.5 };

/** A node of the file's assembly tree; `bodies` are flat indices of the meshes directly in this node. */
export interface StepNode { name: string; bodies: number[]; children: StepNode[] }

/** Every body of a STEP file (flat, in file order) plus the assembly tree that groups them. */
export interface StepFile { bodies: StepBody[]; root: StepNode }

function toStepNode(node: OcctNode): StepNode {
  return { name: node.name, bodies: [...node.meshes], children: node.children.map(toStepNode) };
}

function toStepBody(path: string, mesh: OcctMesh, index: number): StepBody {
  if (!mesh.attributes.normal) throw new Error(`${path}: body ${index} has no normals`);
  return {
    index,
    name: mesh.name,
    positions: new Float32Array(mesh.attributes.position.array),
    normals: new Float32Array(mesh.attributes.normal.array),
    indices: new Uint32Array(mesh.index.array),
    faces: mesh.brep_faces.map(f => ({ first: f.first, last: f.last })),
  };
}

/** Reads a STEP file (a single part or an assembly) at absolute tolerances. Positions come already placed in the file's frame. */
export async function readStepFile(path: string, tolerance: Tolerance): Promise<StepFile> {
  occtModule ??= occtImport();
  const occt: OcctModule = await occtModule;
  const result: OcctResult = occt.ReadStepFile(new Uint8Array(readFileSync(path)), {
    linearUnit: 'millimeter',
    linearDeflectionType: 'absolute_value',
    linearDeflection: tolerance.linearMm,
    angularDeflection: tolerance.angularRad,
  });
  if (!result.success) throw new Error(`OpenCascade could not read ${path}`);
  return { bodies: result.meshes.map((mesh, index) => toStepBody(path, mesh, index)), root: toStepNode(result.root) };
}
