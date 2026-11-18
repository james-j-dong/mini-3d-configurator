// Writes one body as a welded, quantized, meshopt-compressed GLB in metres.
// No UVs: finishes use world-space triplanar mapping in the viewer.
import { Document, Logger, NodeIO, type Buffer } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt, quantize, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import type { StepBody } from './occt.ts';

export async function writeGlb(body: StepBody, metresPerUnit: number): Promise<Uint8Array> {
  await MeshoptEncoder.ready;
  const doc: Document = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  const buffer: Buffer = doc.createBuffer();
  const positions: Float32Array<ArrayBuffer> = Float32Array.from(body.positions, v => v * metresPerUnit);
  const primitive = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(body.normals)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(body.indices)).setBuffer(buffer));
  const mesh = doc.createMesh(body.name).addPrimitive(primitive);
  doc.createScene().addChild(doc.createNode(body.name).setMesh(mesh));

  await doc.transform(
    weld(),
    quantize({ quantizePosition: 14, quantizeNormal: 10 }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const io: NodeIO = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  return io.writeBinary(doc);
}
