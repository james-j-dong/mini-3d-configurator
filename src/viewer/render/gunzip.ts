// Part files are also published gzip-compressed (`<file>.gz`): the CDN serves .glb as it is, and
// gzip takes about a third off a meshopt-compressed part. The browser unpacks it here, so the saving
// does not depend on how any host is configured. Runs in the render worker and on the main thread.

/** Whether this browser can unpack gzip itself. Safari before 16.4 cannot, and downloads the plain files. */
export const canGunzip = (): boolean => typeof DecompressionStream === 'function';

const GZIP_MAGIC: readonly [number, number] = [0x1f, 0x8b];

/**
 * Unpacks gzip data. Anything that does not start with gzip's two magic bytes comes back
 * untouched: the plain file, or a download some host already unpacked on the way.
 */
export async function gunzipIfGzip(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  if (bytes.byteLength < 2) return bytes;
  const head: Uint8Array = new Uint8Array(bytes, 0, 2);
  if (head[0] !== GZIP_MAGIC[0] || head[1] !== GZIP_MAGIC[1]) return bytes;
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
