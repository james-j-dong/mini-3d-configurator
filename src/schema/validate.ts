import type { Product, SlotDef } from './product.ts';

/** A settings-file problem. `path` is the dotted path of the offending field, e.g. `slots[1].parent`. */
export class ProductError extends Error {
  path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ProductError';
    this.path = path;
  }
}

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function record(v: unknown, path: string): Json {
  if (!isRecord(v)) throw new ProductError(path, 'expected an object');
  return v;
}

function array(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new ProductError(path, 'expected an array');
  return v;
}

function string(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new ProductError(path, 'expected a non-empty string');
  return v;
}

function number(v: unknown, path: string, min: number = -Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) throw new ProductError(path, `expected a number ≥ ${min}`);
  return v;
}

function integer(v: unknown, path: string, min: number = 0): number {
  if (!Number.isInteger(v) || (v as number) < min) throw new ProductError(path, `expected an integer ≥ ${min}`);
  return v as number;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (!allowed.includes(v as T)) throw new ProductError(path, `expected one of ${allowed.join(', ')}`);
  return v as T;
}

function vec3(v: unknown, path: string): void {
  const a: unknown[] = array(v, path);
  if (a.length !== 3) throw new ProductError(path, 'expected three numbers');
  a.forEach((n, i) => number(n, `${path}[${i}]`));
}

function colour(v: unknown, path: string): void {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new ProductError(path, 'expected a #rrggbb colour');
}

function reference(v: unknown, known: Json, path: string): string {
  const id: string = string(v, path);
  if (!(id in known)) throw new ProductError(path, `unknown id "${id}"`);
  return id;
}

function validatePlacement(v: unknown, path: string): void {
  const p: Json = record(v, path);
  vec3(p.positionMm, `${path}.positionMm`);
  if (p.rotationDeg !== undefined) vec3(p.rotationDeg, `${path}.rotationDeg`);
}

function validateSources(sources: Json): void {
  for (const [key, value] of Object.entries(sources)) {
    const path: string = `sources.${key}`;
    const s: Json = record(value, path);
    string(s.file, `${path}.file`);
    oneOf(s.units, ['mm', 'm', 'in'] as const, `${path}.units`);
    oneOf(s.upAxis, ['y', 'z'] as const, `${path}.upAxis`);
    const bodyCount: number = integer(s.bodyCount, `${path}.bodyCount`, 1);
    if (s.dropBodies !== undefined) {
      array(s.dropBodies, `${path}.dropBodies`).forEach((b, i) => {
        if (integer(b, `${path}.dropBodies[${i}]`) >= bodyCount) throw new ProductError(`${path}.dropBodies[${i}]`, 'body index out of range');
      });
    }
  }
}

function validateModels(models: Json, sources: Json): void {
  for (const [id, value] of Object.entries(models)) {
    const path: string = `models.${id}`;
    const m: Json = record(value, path);
    const kind = oneOf(m.kind, ['converted', 'box', 'cylinder', 'sphere'] as const, `${path}.kind`);
    if (kind === 'converted') {
      const sourceKey: string = reference(m.source, sources, `${path}.source`);
      const bodyCount: number = (sources[sourceKey] as Json).bodyCount as number;
      if (integer(m.bodyIndex, `${path}.bodyIndex`) >= bodyCount) throw new ProductError(`${path}.bodyIndex`, `source has only ${bodyCount} bodies`);
      if (m.faceRules !== undefined) {
        array(m.faceRules, `${path}.faceRules`).forEach((r, i) => {
          const rulePath: string = `${path}.faceRules[${i}]`;
          const rule: Json = record(r, rulePath);
          oneOf(rule.kind, ['dropNearAxis'] as const, `${rulePath}.kind`);
          number(rule.maxRadiusMm, `${rulePath}.maxRadiusMm`, 0);
          number(rule.maxHeightMm, `${rulePath}.maxHeightMm`);
        });
      }
    } else if (kind === 'box') {
      vec3(m.sizeMm, `${path}.sizeMm`);
    } else if (kind === 'cylinder') {
      number(m.radiusMm, `${path}.radiusMm`, 0);
      number(m.heightMm, `${path}.heightMm`, 0);
    } else {
      number(m.radiusMm, `${path}.radiusMm`, 0);
    }
    if (m.attachPointMm !== undefined) vec3(m.attachPointMm, `${path}.attachPointMm`);
    if (m.sockets !== undefined) {
      for (const [name, placement] of Object.entries(record(m.sockets, `${path}.sockets`))) {
        validatePlacement(placement, `${path}.sockets.${name}`);
      }
    }
  }
}

function validateFinishes(finishes: Json): void {
  for (const [id, value] of Object.entries(finishes)) {
    const path: string = `finishes.${id}`;
    const f: Json = record(value, path);
    const kind = oneOf(f.kind, ['carbonWeave', 'forgedCarbon', 'metal', 'matte'] as const, `${path}.kind`);
    if (kind === 'carbonWeave') number(f.towMm, `${path}.towMm`, 0);
    else if (kind === 'forgedCarbon') number(f.tileMm, `${path}.tileMm`, 0);
    else {
      colour(f.color, `${path}.color`);
      number(f.roughness, `${path}.roughness`, 0);
    }
  }
}

/** Checks each slot's own fields, then the tree: unknown parents first, then cycles. */
function validateSlots(slots: unknown[], models: Json, finishes: Json): void {
  if (slots.length === 0) throw new ProductError('slots', 'expected at least one slot');
  const ids: Set<string> = new Set();
  slots.forEach((value, i) => {
    const path: string = `slots[${i}]`;
    const s: Json = record(value, path);
    const id: string = string(s.id, `${path}.id`);
    if (ids.has(id)) throw new ProductError(`${path}.id`, `duplicate slot id "${id}"`);
    ids.add(id);
    reference(s.model, models, `${path}.model`);
    reference(s.finish, finishes, `${path}.finish`);
    if (s.placement !== undefined) oneOf(s.placement, ['socket', 'asInCad'] as const, `${path}.placement`);
    if (s.socket !== undefined) string(s.socket, `${path}.socket`);
  });

  const typed: SlotDef[] = slots as SlotDef[];
  typed.forEach((s, i) => {
    if (s.parent !== undefined && !ids.has(s.parent)) throw new ProductError(`slots[${i}].parent`, `unknown slot "${s.parent}"`);
  });

  const byId: Map<string, SlotDef> = new Map(typed.map(s => [s.id, s]));
  for (const start of typed) {
    const seen: Set<string> = new Set();
    let current: SlotDef | undefined = start;
    while (current?.parent !== undefined) {
      if (seen.has(current.id)) throw new ProductError('slots', `slot tree has a cycle through "${current.id}"`);
      seen.add(current.id);
      current = byId.get(current.parent);
    }
  }
}

function validateOptions(options: unknown[], slotIds: Set<string>, models: Json, finishes: Json): void {
  const names: Set<string> = new Set();
  options.forEach((value, i) => {
    const path: string = `options[${i}]`;
    const o: Json = record(value, path);
    const name: string = string(o.name, `${path}.name`);
    if (names.has(name)) throw new ProductError(`${path}.name`, `duplicate option "${name}"`);
    names.add(name);
    const values: unknown[] = array(o.values, `${path}.values`);
    if (values.length === 0) throw new ProductError(`${path}.values`, 'expected at least one value');
    const valueNames: Set<string> = new Set();
    values.forEach((vv, j) => {
      const vPath: string = `${path}.values[${j}]`;
      const v: Json = record(vv, vPath);
      const valueName: string = string(v.name, `${vPath}.name`);
      if (valueNames.has(valueName)) throw new ProductError(`${vPath}.name`, `duplicate value "${valueName}"`);
      valueNames.add(valueName);
      array(v.sets, `${vPath}.sets`).forEach((ss, k) => {
        const sPath: string = `${vPath}.sets[${k}]`;
        const s: Json = record(ss, sPath);
        const slot: string = string(s.slot, `${sPath}.slot`);
        if (!slotIds.has(slot)) throw new ProductError(`${sPath}.slot`, `unknown slot "${slot}"`);
        if (s.model !== undefined) reference(s.model, models, `${sPath}.model`);
        if (s.finish !== undefined) reference(s.finish, finishes, `${sPath}.finish`);
      });
      if (v.swatch !== undefined) string(record(v.swatch, `${vPath}.swatch`).css, `${vPath}.swatch.css`);
    });
  });
}

/** Every model a slot can hold: its default plus every model an option value can set on it. */
export function possibleModels(p: Pick<Product, 'slots' | 'options'>, slotId: string): Set<string> {
  const result: Set<string> = new Set();
  const slot: SlotDef | undefined = p.slots.find(s => s.id === slotId);
  if (slot) result.add(slot.model);
  for (const option of p.options) {
    for (const value of option.values) {
      for (const set of value.sets) if (set.slot === slotId && set.model !== undefined) result.add(set.model);
    }
  }
  return result;
}

/** A child on a socket needs that socket on every model its parent slot can hold. */
function validateSockets(p: Product): void {
  p.slots.forEach((s, i) => {
    const path: string = `slots[${i}]`;
    if (s.parent === undefined) return;
    if (s.placement === 'asInCad') return;
    if (s.socket === undefined) throw new ProductError(`${path}.socket`, 'a child slot needs a socket or placement "asInCad"');
    for (const modelId of possibleModels(p, s.parent)) {
      if (!p.models[modelId].sockets?.[s.socket]) {
        throw new ProductError(`${path}.socket`, `model "${modelId}" (parent slot "${s.parent}") has no socket "${s.socket}"`);
      }
    }
  });
}

function validateDefaultSelection(p: Product, raw: unknown): void {
  const selection: Json = record(raw, 'defaultSelection');
  for (const option of p.options) {
    const path: string = `defaultSelection.${option.name}`;
    const value: string = string(selection[option.name], path);
    if (!option.values.some(v => v.name === value)) throw new ProductError(path, `unknown value "${value}"`);
  }
  for (const name of Object.keys(selection)) {
    if (!p.options.some(o => o.name === name)) throw new ProductError(`defaultSelection.${name}`, 'unknown option');
  }
}

function validateFraming(raw: unknown): void {
  const f: Json = record(raw, 'framing');
  for (const key of ['azimuthDeg', 'polarDeg', 'maxPolarDeg', 'fovDeg'] as const) number(f[key], `framing.${key}`);
  number(f.minZoom, 'framing.minZoom', 0);
  number(f.maxZoom, 'framing.maxZoom', 0);
}

/**
 * Checks the structure of a settings file and every cross-reference in it.
 * Returns the same object, typed. Extra fields (a BuiltProduct's `files`, for example) are kept.
 */
export function validateProduct(input: unknown): Product {
  const root: Json = record(input, '(root)');
  if (root.schemaVersion !== 1) throw new ProductError('schemaVersion', 'expected 1');
  string(root.id, 'id');
  string(root.name, 'name');
  const sources: Json = record(root.sources, 'sources');
  const models: Json = record(root.models, 'models');
  const finishes: Json = record(root.finishes, 'finishes');
  validateSources(sources);
  validateModels(models, sources);
  validateFinishes(finishes);
  const slots: unknown[] = array(root.slots, 'slots');
  validateSlots(slots, models, finishes);
  const slotIds: Set<string> = new Set((slots as SlotDef[]).map(s => s.id));
  validateOptions(array(root.options, 'options'), slotIds, models, finishes);
  const product: Product = input as Product;
  validateSockets(product);
  validateDefaultSelection(product, root.defaultSelection);
  validateFraming(root.framing);
  return product;
}
