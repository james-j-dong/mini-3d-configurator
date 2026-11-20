// Per-part tessellation quality. occt-import-js's relative tolerance ('bounding_box_ratio') is
// relative to the whole file, so parts of an assembly would come out coarser than the same part
// read from its own file. Instead, each body gets an absolute tolerance from its own size, rounded
// to a √2 grid so a whole assembly needs only a handful of read passes.
import { readStepFile, type StepBody, type StepFile } from './occt.ts';
import { boxOf, type BodyBox } from './parts.ts';

export type DetailLevel = 'default' | 'light';

/** Linear tolerance as a fraction of a part's size, and angular tolerance in radians. */
export const DETAIL_LEVELS: Record<DetailLevel, { ratio: number; angularRad: number }> = {
  default: { ratio: 0.001, angularRad: 0.35 },
  light: { ratio: 0.002, angularRad: 0.5 },
};

/** The finest tolerance any part is read at. */
export const MIN_TOLERANCE_MM: number = 0.01;

/** ratio × the average of the box's three dimensions (what occt-import-js's bounding_box_ratio measures). */
export function targetToleranceMm(box: BodyBox, level: DetailLevel): number {
  const averageMm: number = [0, 1, 2].reduce((sum, a) => sum + (box.maxMm[a] - box.minMm[a]), 0) / 3;
  return DETAIL_LEVELS[level].ratio * averageMm;
}

/** Nearest point, in log space, on the grid MIN_TOLERANCE_MM × √2^k (k ≥ 0). Never below MIN_TOLERANCE_MM. */
export function bucketMm(targetMm: number): number {
  const k: number = Math.max(0, Math.round(2 * Math.log2(targetMm / MIN_TOLERANCE_MM)));
  return MIN_TOLERANCE_MM * Math.SQRT2 ** k;
}

/**
 * One readStepFile pass per distinct bucket that the bodies in `only` need (default: all bodies), at the
 * level's angular tolerance. Each body comes from its own bucket's pass; bodies not in `only` keep the
 * reference tessellation, so flat indices stay aligned. Throws if a pass's body count differs from the reference.
 *
 * Every pass reads and meshes the whole file, because occt-import-js cannot read chosen parts only.
 * The cost is therefore passes × file size, nearly all of it inside OpenCascade: the 23 MB OB1
 * assembly takes 8 to 11 s a pass, and its 10 passes are most of a conversion.
 */
export async function readAtDetail(path: string, reference: StepFile, level: DetailLevel, only?: number[]): Promise<StepFile> {
  const wanted: number[] = only ?? reference.bodies.map((_, b) => b);
  const buckets: Map<number, number[]> = new Map();
  for (const b of wanted) {
    const mm: number = bucketMm(targetToleranceMm(boxOf(reference.bodies[b]), level));
    buckets.set(mm, [...(buckets.get(mm) ?? []), b]);
  }

  const bodies: StepBody[] = [...reference.bodies];
  for (const [linearMm, members] of buckets) {
    const pass: StepFile = await readStepFile(path, { linearMm, angularRad: DETAIL_LEVELS[level].angularRad });
    if (pass.bodies.length !== reference.bodies.length) {
      throw new Error(`${path}: a read at ${linearMm.toFixed(4)} mm found ${pass.bodies.length} bodies, but the reference read found ${reference.bodies.length}`);
    }
    for (const b of members) bodies[b] = pass.bodies[b];
  }
  return { bodies, root: reference.root };
}
