// Throwaway spike: print what OpenCascade sees in a STEP file at a given tessellation quality.
// Usage: node inspect.mts <file.step> [linearDeflectionRatio] [angularDeflectionRad]
import { readStep, meshBounds, type OcctResult, type Bounds } from './occt.mts';

const file: string = process.argv[2];
const linear: number = Number(process.argv[3] ?? 0.001);
const angular: number = Number(process.argv[4] ?? 0.5);

const t0: number = performance.now();
const result: OcctResult = await readStep(file, {
  linearUnit: 'millimeter',
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: linear,
  angularDeflection: angular,
});
const ms: number = performance.now() - t0;

console.log(`${file}\n  read+tessellate ${ms.toFixed(0)} ms, ${result.meshes.length} mesh(es)`);
for (const mesh of result.meshes) {
  const b: Bounds = meshBounds(mesh);
  const size: string = b.max.map((v: number, i: number) => (v - b.min[i]).toFixed(1)).join(' x ');
  const centre: string = b.max.map((v: number, i: number) => ((v + b.min[i]) / 2).toFixed(1)).join(', ');
  const tris: number = mesh.index.array.length / 3;
  const verts: number = mesh.attributes.position.array.length / 3;
  console.log(`  "${mesh.name}": ${tris} tris, ${verts} verts, ${mesh.brep_faces.length} faces, size ${size} mm, centre (${centre}), color ${JSON.stringify(mesh.color ?? null)}`);
}
