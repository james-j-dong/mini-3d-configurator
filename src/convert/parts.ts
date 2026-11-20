// Finds parts in a STEP file's assembly tree, picks bodies out of them, and checks that every body
// of a source is claimed exactly once: by one model, or by the source's left-out list.
import type { PartSelection, Vec3 } from '../schema/product.ts';
import type { StepBody, StepFile, StepNode } from './occt.ts';
import { normaliseAxes } from './geometry.ts';

export class ConvertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConvertError';
  }
}

/** An axis-aligned box in source millimetres (after axis normalisation). */
export interface BodyBox { minMm: Vec3; maxMm: Vec3 }

/** One occurrence of a named node or named mesh. `bodies`: flat indices of every mesh in its subtree, depth-first. */
export interface PartInstance { name: string; occurrence: number; bodies: number[] }

/** `owner[b]` is the index into `instances` of the innermost instance containing body b, or -1. */
export interface PartIndex { instances: PartInstance[]; boxes: BodyBox[]; owner: number[] }

/** The claimant name the left-out list uses in error reports. */
const LEAVE_OUT: string = 'leaveOut';
/** How many unclaimed bodies an error report lists before summarising the rest. */
const MAX_LISTED: number = 20;

export function boxOf(body: StepBody): BodyBox {
  const minMm: Vec3 = [Infinity, Infinity, Infinity];
  const maxMm: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < body.positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      minMm[a] = Math.min(minMm[a], body.positions[i + a]);
      maxMm[a] = Math.max(maxMm[a], body.positions[i + a]);
    }
  }
  return { minMm, maxMm };
}

/**
 * Lists every named node and every named mesh as a part instance, depth-first. A mesh named like
 * its own node is not a separate instance (single-body parts carry the same name twice).
 * Boxes are taken after normaliseAxes(body, upAxis).
 */
export function indexParts(file: StepFile, upAxis: 'y' | 'z'): PartIndex {
  const boxes: BodyBox[] = file.bodies.map(b => boxOf(normaliseAxes(b, upAxis)));
  const instances: PartInstance[] = [];
  const owner: number[] = new Array<number>(file.bodies.length).fill(-1);
  const occurrences: Map<string, number> = new Map();

  const addInstance = (name: string, bodies: number[]): number => {
    const occurrence: number = occurrences.get(name) ?? 0;
    occurrences.set(name, occurrence + 1);
    instances.push({ name, occurrence, bodies });
    return instances.length - 1;
  };

  // Parents are visited before children, so a deeper instance overwrites `owner`: the innermost wins.
  const visit = (node: StepNode): number[] => {
    const own: number = node.name !== '' ? addInstance(node.name, []) : -1;
    const subtree: number[] = [];
    for (const body of node.bodies) {
      subtree.push(body);
      if (own >= 0) owner[body] = own;
      const meshName: string = file.bodies[body].name;
      if (meshName !== '' && meshName !== node.name) owner[body] = addInstance(meshName, [body]);
    }
    for (const child of node.children) subtree.push(...visit(child));
    if (own >= 0) instances[own].bodies = subtree;
    return subtree;
  };
  visit(file.root);
  return { instances, boxes, owner };
}

/** The box around these bodies' boxes. */
export function combinedBox(index: PartIndex, bodies: number[]): BodyBox {
  const minMm: Vec3 = [Infinity, Infinity, Infinity];
  const maxMm: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of bodies) {
    for (let a = 0; a < 3; a++) {
      minMm[a] = Math.min(minMm[a], index.boxes[b].minMm[a]);
      maxMm[a] = Math.max(maxMm[a], index.boxes[b].maxMm[a]);
    }
  }
  return { minMm, maxMm };
}

export const centreOf = (box: BodyBox): Vec3 => [0, 1, 2].map(a => (box.minMm[a] + box.maxMm[a]) / 2) as Vec3;

function centreWithin(box: BodyBox, within: { minMm: Vec3; maxMm: Vec3 }): boolean {
  const centre: Vec3 = centreOf(box);
  return [0, 1, 2].every(a => centre[a] >= within.minMm[a] && centre[a] <= within.maxMm[a]);
}

const instanceLabel = (instance: PartInstance): string => `"${instance.name}" #${instance.occurrence}`;

/** Sorted, unique flat body indices. Throws ConvertError for a body position past the end of an instance. */
export function selectBodies(index: PartIndex, sel: PartSelection): number[] {
  const wholeFile: PartInstance = { name: '', occurrence: 0, bodies: index.boxes.map((_, b) => b) };
  const candidates: PartInstance[] = sel.part === undefined ? [wholeFile] : index.instances.filter(i => i.name === sel.part);
  const picked: Set<number> = new Set();
  for (const instance of candidates) {
    if (sel.within && !centreWithin(combinedBox(index, instance.bodies), sel.within)) continue;
    const label: string = sel.part === undefined ? 'the whole file' : instanceLabel(instance);
    const positions: number[] = sel.bodies ?? instance.bodies.map((_, k) => k);
    for (const k of positions) {
      if (k >= instance.bodies.length) throw new ConvertError(`${label} has only ${instance.bodies.length} bodies, so it has no body ${k}`);
      picked.add(instance.bodies[k]);
    }
  }
  return [...picked].sort((a, b) => a - b);
}

/** Rounds to 0.1 and never prints "-0.0". */
export const formatMm = (n: number): string => (Math.round(n * 10) / 10 + 0).toFixed(1);

/** e.g. `"Plate" #0 body 1 (60.0 × 3.0 × 50.0 mm at 0.0, 101.5, 0.0)`, or `(unnamed) body 6 (…)`. */
export function describeBody(index: PartIndex, body: number): string {
  const box: BodyBox = index.boxes[body];
  const size: string = [0, 1, 2].map(a => formatMm(box.maxMm[a] - box.minMm[a])).join(' × ');
  const centre: string = centreOf(box).map(formatMm).join(', ');
  const ownerIndex: number = index.owner[body];
  const where: string = ownerIndex < 0
    ? `(unnamed) body ${body}`
    : `${instanceLabel(index.instances[ownerIndex])} body ${index.instances[ownerIndex].bodies.indexOf(body)}`;
  return `${where} (${size} mm at ${centre})`;
}

/** Model id → its sorted body indices. Throws ConvertError on unclaimed, doubly claimed, or empty selections. */
export function claimBodies(
  sourceKey: string,
  index: PartIndex,
  models: Array<{ id: string; parts: PartSelection[] }>,
  leaveOut: PartSelection[],
): Map<string, number[]> {
  const claimedBy: Array<string | undefined> = new Array<string | undefined>(index.boxes.length);

  const claim = (claimant: string, selections: PartSelection[]): number[] => {
    const bodies: Set<number> = new Set();
    for (const sel of selections) {
      const picked: number[] = selectBodies(index, sel);
      if (picked.length === 0) {
        const who: string = claimant === LEAVE_OUT ? LEAVE_OUT : `model "${claimant}"`;
        throw new ConvertError(`${sourceKey}: ${who} selects nothing with ${JSON.stringify(sel)}`);
      }
      for (const b of picked) bodies.add(b);
    }
    const sorted: number[] = [...bodies].sort((a, b) => a - b);
    for (const b of sorted) {
      const earlier: string | undefined = claimedBy[b];
      if (earlier !== undefined) throw new ConvertError(`${sourceKey}: ${describeBody(index, b)} is claimed by both "${earlier}" and "${claimant}"`);
      claimedBy[b] = claimant;
    }
    return sorted;
  };

  const result: Map<string, number[]> = new Map();
  for (const model of models) result.set(model.id, claim(model.id, model.parts));
  claim(LEAVE_OUT, leaveOut);

  const unclaimed: number[] = [];
  for (let b = 0; b < claimedBy.length; b++) if (claimedBy[b] === undefined) unclaimed.push(b);
  if (unclaimed.length > 0) {
    const lines: string[] = unclaimed.slice(0, MAX_LISTED).map(b => `  ${describeBody(index, b)}`);
    if (unclaimed.length > MAX_LISTED) lines.push(`  …and ${unclaimed.length - MAX_LISTED} more`);
    throw new ConvertError(`${sourceKey}: not used by any model and not left out:\n${lines.join('\n')}`);
  }
  return result;
}
