// Throwaway spike: STEP -> optimised GLB for the carbon-look test.
// Usage: node convert.mts
// Writes public/models/*.glb and prints a size table for several tessellation levels.
import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { Document, NodeIO, type Mesh, type Primitive, type Accessor } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { weld, unweld, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { readStep, type OcctMesh, type OcctResult, type OcctFaceRange } from './occt.mts';

const SOURCE_DIR: string = '../../assets/source';
const OUT_DIR: string = 'public/models';

/** A B-rep face is kept when this returns true. Positions are in mm, Y up. */
type FaceFilter = (face: FaceStats) => boolean;
interface FaceStats { rMax: number; yMax: number; triangles: number }

interface PartJob {
  name: string;
  file: string;
  /** Keep only these meshes (by index in the STEP file). */
  meshIndices: number[];
  faceFilter: FaceFilter;
  /** How UVs are generated (1 UV unit = 100 mm, centred on 0.5). */
  uv: 'top-planar' | 'box';
}

const keepAll: FaceFilter = (): boolean => true;
/** The M12x1.25 thread: surfaces within 6.3 mm of the knob's axis and in the bottom 17 mm. */
const dropThread: FaceFilter = (f: FaceStats): boolean => !(f.rMax < 6.3 && f.yMax < 17);

const JOBS: PartJob[] = [
  { name: 'knob-round', file: 'SHIFT_KNOB_ROUND (M12x1.25)_REV2 (1).STEP', meshIndices: [0], faceFilter: dropThread, uv: 'box' },
  { name: 'plate-6r-down', file: 'OB1-SHPL_6RDOWN_AL_REV5.STEP', meshIndices: [1], faceFilter: keepAll, uv: 'top-planar' },
  { name: 'plate-6r-down-second-body', file: 'OB1-SHPL_6RDOWN_AL_REV5.STEP', meshIndices: [0], faceFilter: keepAll, uv: 'top-planar' },
];

interface Level { label: string; linear: number; angular: number }
const LEVELS: Level[] = [
  { label: 'fine', linear: 0.0005, angular: 0.25 },
  { label: 'medium', linear: 0.001, angular: 0.35 },
  { label: 'coarse', linear: 0.002, angular: 0.5 },
];
/** The level written to public/models for the viewer. */
const SHIP_LEVEL: string = 'medium';

function faceStats(mesh: OcctMesh, face: OcctFaceRange): FaceStats {
  const p: number[] = mesh.attributes.position.array;
  const idx: number[] = mesh.index.array;
  let rMax: number = 0;
  let yMax: number = -Infinity;
  for (let t: number = face.first; t <= face.last; t++) {
    for (let k: number = 0; k < 3; k++) {
      const v: number = idx[t * 3 + k] * 3;
      rMax = Math.max(rMax, Math.hypot(p[v], p[v + 2]));
      yMax = Math.max(yMax, p[v + 1]);
    }
  }
  return { rMax, yMax, triangles: face.last - face.first + 1 };
}

/** Collect kept triangles (as an index list into the original vertex arrays). */
function keptIndices(mesh: OcctMesh, filter: FaceFilter): { indices: Uint32Array; dropped: number } {
  const out: number[] = [];
  let dropped: number = 0;
  const idx: number[] = mesh.index.array;
  for (const face of mesh.brep_faces) {
    const stats: FaceStats = faceStats(mesh, face);
    if (!filter(stats)) { dropped += stats.triangles; continue; }
    for (let t: number = face.first; t <= face.last; t++) out.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
  }
  return { indices: new Uint32Array(out), dropped };
}

/** Per-triangle UVs in millimetres. Requires an unwelded primitive (3 unique vertices per triangle). */
function writeUVs(doc: Document, prim: Primitive, mode: PartJob['uv']): void {
  const pos: Accessor = prim.getAttribute('POSITION')!;
  const count: number = pos.getCount();
  const uv: Float32Array = new Float32Array(count * 2);
  const a: number[] = [0, 0, 0], b: number[] = [0, 0, 0], c: number[] = [0, 0, 0];
  for (let i: number = 0; i < count; i += 3) {
    pos.getElement(i, a); pos.getElement(i + 1, b); pos.getElement(i + 2, c);
    // Face normal picks the projection axis for this triangle.
    const e1: number[] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: number[] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: number[] = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const ax: number[] = n.map(Math.abs);
    const axis: number = mode === 'top-planar' ? 1 : ax[0] > ax[1] && ax[0] > ax[2] ? 0 : ax[1] > ax[2] ? 1 : 2;
    const [u, v]: [number, number] = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
    for (const [k, p] of [[0, a], [1, b], [2, c]] as [number, number[]][]) {
      // Positions are in metres here. UV = mm / 100 + 0.5 keeps it inside [0,1] so it can be quantized;
      // the viewer scales textures back to millimetres (1 UV unit = 100 mm).
      uv[(i + k) * 2] = p[u] * 10 + 0.5;
      uv[(i + k) * 2 + 1] = p[v] * 10 + 0.5;
    }
  }
  prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(doc.getRoot().listBuffers()[0]));
}

async function buildGlb(job: PartJob, level: Level): Promise<{ glb: Uint8Array; tris: number; dropped: number; rawTris: number }> {
  const result: OcctResult = await readStep(`${SOURCE_DIR}/${job.file}`, {
    linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: level.linear, angularDeflection: level.angular,
  });
  const doc: Document = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(job.name);
  let tris: number = 0, dropped: number = 0, rawTris: number = 0;
  for (const mi of job.meshIndices) {
    const src: OcctMesh = result.meshes[mi];
    rawTris += src.index.array.length / 3;
    const kept = keptIndices(src, job.faceFilter);
    dropped += kept.dropped;
    tris += kept.indices.length / 3;
    const positions: Float32Array = new Float32Array(src.attributes.position.array.map((v: number): number => v / 1000)); // mm -> m
    const normals: Float32Array = new Float32Array(src.attributes.normal!.array);
    const prim: Primitive = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normals).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(kept.indices).setBuffer(buffer));
    const mesh: Mesh = doc.createMesh(`${job.name}-${mi}`).addPrimitive(prim);
    scene.addChild(doc.createNode(`${job.name}-${mi}`).setMesh(mesh));
  }
  // Box/planar UVs need per-triangle vertices, then weld merges identical ones back.
  await doc.transform(unweld());
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) writeUVs(doc, prim, job.uv);
  await doc.transform(weld(), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  const io: NodeIO = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const glb: Uint8Array = await io.writeBinary(doc);
  return { glb, tris, dropped, rawTris };
}

await MeshoptEncoder.ready;
mkdirSync(OUT_DIR, { recursive: true });
const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;
console.log('part | level | raw tris | thread tris dropped | shipped tris | glb | gzip | brotli');
for (const job of JOBS) {
  for (const level of LEVELS) {
    const { glb, tris, dropped, rawTris } = await buildGlb(job, level);
    const gz: number = gzipSync(glb, { level: 9 }).length;
    const br: number = brotliCompressSync(glb).length;
    console.log(`${job.name} | ${level.label} | ${rawTris} | ${dropped} | ${tris} | ${kb(glb.length)} | ${kb(gz)} | ${kb(br)}`);
    if (level.label === SHIP_LEVEL) writeFileSync(`${OUT_DIR}/${job.name}.glb`, glb);
    for (const lv of LEVELS) if (lv.label === level.label && lv.label !== SHIP_LEVEL) writeFileSync(`${OUT_DIR}/${job.name}.${lv.label}.glb`, glb);
  }
}
