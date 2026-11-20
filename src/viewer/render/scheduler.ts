// What to load next, and which pick to show next. Pure logic, no WebGL.
import type { Product, ResolvedConfiguration, Selection, SlotDef } from '../../schema/product.ts';
import { resolveConfiguration } from '../../schema/configurations.ts';

/** The converted (downloaded) models a selection shows in the slots `include` accepts, in slot order. */
function convertedModelsIn(p: Product, s: Selection, include: (slot: SlotDef) => boolean): string[] {
  const resolved: ResolvedConfiguration = resolveConfiguration(p, s);
  const result: string[] = [];
  for (const slot of p.slots) {
    if (!include(slot)) continue;
    const model: string = resolved[slot.id].model;
    if (p.models[model].kind === 'converted' && !result.includes(model)) result.push(model);
  }
  return result;
}

/** The converted (downloaded) models a selection shows, in slot order. */
export function convertedModelsOf(p: Product, s: Selection): string[] {
  return convertedModelsIn(p, s, () => true);
}

/** Converted models of slots without afterFirstView, in slot order: what the first view and swaps wait for. */
export function requiredModelsOf(p: Product, s: Selection): string[] {
  return convertedModelsIn(p, s, slot => slot.afterFirstView !== true);
}

/** Converted models of afterFirstView slots, in slot order. */
export function deferredModelsOf(p: Product, s: Selection): string[] {
  return convertedModelsIn(p, s, slot => slot.afterFirstView === true);
}

/**
 * Background-loading order, most likely needed first:
 * 1. the current configuration's required models (what the first view waits for), in slot order;
 * 2. its after-first-view models, in slot order;
 * 3. the required models of configurations one change away, option by option, each in value order;
 * 4. every remaining converted model.
 */
export class LoadPlanner {
  private readonly product: Product;

  constructor(p: Product) {
    this.product = p;
  }

  order(current: Selection): string[] {
    const p: Product = this.product;
    const order: string[] = [];
    const add = (models: string[]): void => {
      for (const m of models) if (!order.includes(m)) order.push(m);
    };
    add(requiredModelsOf(p, current));
    add(deferredModelsOf(p, current));
    for (const option of p.options) {
      for (const value of option.values) {
        if (value.name !== current[option.name]) add(requiredModelsOf(p, { ...current, [option.name]: value.name }));
      }
    }
    add(Object.keys(p.models).filter(id => p.models[id].kind === 'converted'));
    return order;
  }
}

/** A part as the swap logic sees it: not on the GPU yet, loaded but never drawn, or warmed. */
export type PartState = 'loading' | 'loaded' | 'warmed';
export type SwapStep = { kind: 'swap'; selection: Selection } | { kind: 'warm'; models: string[] };

/**
 * Holds the latest requested selection until its parts are ready. A newer request replaces an
 * older one, so rapid picks end on the last pick with no intermediate configuration shown.
 */
export class SwapScheduler {
  private latest: Selection | null = null;
  private readonly requiredModels: (s: Selection) => string[];

  /** `requiredModels` lists the parts a selection needs; by default each selected value counts as one. */
  constructor(requiredModels: (s: Selection) => string[] = (s: Selection): string[] => Object.values(s)) {
    this.requiredModels = requiredModels;
  }

  request(s: Selection): void {
    this.latest = s;
  }

  /** The pending selection if all its parts are ready (and clears it); otherwise null. */
  next(isReady: (modelId: string) => boolean): Selection | null {
    if (!this.latest || !this.requiredModels(this.latest).every(isReady)) return null;
    const s: Selection = this.latest;
    this.latest = null;
    return s;
  }

  /**
   * What the engine should do this frame for the pending pick: nothing yet (parts still loading),
   * warm the parts that are loaded but have never been drawn (then swap on a later frame), or swap.
   * A part's first draw is never the swap frame.
   */
  step(stateOf: (modelId: string) => PartState): SwapStep | null {
    if (!this.latest) return null;
    const models: string[] = this.requiredModels(this.latest);
    if (models.some(id => stateOf(id) === 'loading')) return null;
    const unwarmed: string[] = models.filter(id => stateOf(id) === 'loaded');
    if (unwarmed.length > 0) return { kind: 'warm', models: unwarmed };
    const selection: Selection = this.latest;
    this.latest = null;
    return { kind: 'swap', selection };
  }

  /** Drops the pending pick (after one of its parts failed to load). */
  clear(): void {
    this.latest = null;
  }

  get pending(): Selection | null {
    return this.latest;
  }
}
