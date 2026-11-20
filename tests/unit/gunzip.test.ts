import { gzipSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { gunzipIfGzip } from '../../src/viewer/render/gunzip.ts';

/** A stand-in for a GLB file: the four magic bytes 'glTF' and then some data. */
const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, ...Array.from({ length: 5000 }, (_, i) => (i * 7) % 251)]);
const toBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

test('a gzip-compressed part comes back as the original file', async () => {
  const compressed: ArrayBuffer = toBuffer(gzipSync(glb, { level: 9 }));
  expect(compressed.byteLength).toBeLessThan(glb.byteLength);
  expect(new Uint8Array(await gunzipIfGzip(compressed))).toEqual(glb);
});

test('a part that is not gzip (a host already unpacked it, or the plain file) is left as it is', async () => {
  const plain: ArrayBuffer = toBuffer(glb);
  expect(await gunzipIfGzip(plain)).toBe(plain);
});

test('an empty or one-byte download is left as it is', async () => {
  const empty: ArrayBuffer = new ArrayBuffer(0);
  expect(await gunzipIfGzip(empty)).toBe(empty);
  const one: ArrayBuffer = toBuffer(new Uint8Array([0x1f]));
  expect(await gunzipIfGzip(one)).toBe(one);
});
