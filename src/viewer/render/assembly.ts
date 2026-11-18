// Resolves the slot tree into world matrices (metres). Pure math, safe in a worker.
import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { ModelDef, Placement, Product, ResolvedConfiguration, SlotDef, Vec3 } from '../../schema/product.ts';

const METRES_PER_MM: number = 0.001;

/** Millimetres → metres; rotation is XYZ Euler in degrees. */
export function placementMatrix(p: Placement): Matrix4 {
  const [rx, ry, rz]: Vec3 = p.rotationDeg ?? [0, 0, 0];
  const rotation: Quaternion = new Quaternion().setFromEuler(new Euler(MathUtils.degToRad(rx), MathUtils.degToRad(ry), MathUtils.degToRad(rz), 'XYZ'));
  const position: Vector3 = new Vector3(...p.positionMm).multiplyScalar(METRES_PER_MM);
  return new Matrix4().compose(position, rotation, new Vector3(1, 1, 1));
}

/** Slots ordered so every parent comes before its children (validateProduct has ruled out cycles). */
function parentsFirst(slots: SlotDef[]): SlotDef[] {
  const ordered: SlotDef[] = [];
  const placed: Set<string> = new Set();
  while (ordered.length < slots.length) {
    for (const slot of slots) {
      if (placed.has(slot.id)) continue;
      if (slot.parent === undefined || placed.has(slot.parent)) {
        ordered.push(slot);
        placed.add(slot.id);
      }
    }
  }
  return ordered;
}

/**
 * Slot id → world matrix, parents before children.
 * - root: identity
 * - socket: world(parent) × placement(parent model's socket) × translation(−attach point of the child model)
 * - asInCad: world(parent)
 */
export function resolveAssembly(p: Product, resolved: ResolvedConfiguration): Map<string, Matrix4> {
  const world: Map<string, Matrix4> = new Map();
  for (const slot of parentsFirst(p.slots)) {
    if (slot.parent === undefined) {
      world.set(slot.id, new Matrix4());
      continue;
    }
    const parentWorld: Matrix4 = world.get(slot.parent)!;
    if (slot.placement === 'asInCad') {
      world.set(slot.id, parentWorld.clone());
      continue;
    }
    const parentModel: ModelDef = p.models[resolved[slot.parent].model];
    const childModel: ModelDef = p.models[resolved[slot.id].model];
    const socket: Placement | undefined = parentModel.sockets?.[slot.socket!];
    if (!socket) throw new Error(`slot "${slot.id}": parent model has no socket "${slot.socket}"`);
    const attach: Vector3 = new Vector3(...(childModel.attachPointMm ?? [0, 0, 0])).multiplyScalar(-METRES_PER_MM);
    world.set(slot.id, parentWorld.clone().multiply(placementMatrix(socket)).multiply(new Matrix4().makeTranslation(attach)));
  }
  return world;
}
