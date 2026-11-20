import type { OptionGroup, OptionValue, Product, ResolvedConfiguration, Selection } from './product.ts';
import { ProductError } from './validate.ts';

/** Every combination of option values, first option varying slowest. */
export function listConfigurations(p: Product): Selection[] {
  let result: Selection[] = [{}];
  for (const option of p.options) {
    const next: Selection[] = [];
    for (const partial of result) {
      for (const value of option.values) next.push({ ...partial, [option.name]: value.name });
    }
    result = next;
  }
  return result;
}

function findValueIndex(option: OptionGroup, valueName: string | undefined): number {
  const index: number = option.values.findIndex(v => v.name === valueName);
  if (index < 0) throw new ProductError(option.name, `unknown value "${valueName}"`);
  return index;
}

/** The value indices joined by `-`, in option order. The default OB1 selection is `4-0-0`. */
export function configurationKey(p: Product, s: Selection): string {
  return p.options.map(option => findValueIndex(option, s[option.name])).join('-');
}

/**
 * Merges a (possibly partial) request into the current selection.
 * Throws ProductError, with `path` set to the option name, for an unknown option or value.
 */
export function normaliseSelection(p: Product, requested: Partial<Selection>, current: Selection): Selection {
  const result: Selection = {};
  for (const option of p.options) result[option.name] = current[option.name];
  for (const [name, value] of Object.entries(requested)) {
    const option: OptionGroup | undefined = p.options.find(o => o.name === name);
    if (!option) throw new ProductError(name, 'unknown option');
    findValueIndex(option, value);
    result[name] = value as string;
  }
  for (const option of p.options) findValueIndex(option, result[option.name]);
  return result;
}

/** Applies each option value's slot settings, in option order, over the slots' defaults. */
export function resolveConfiguration(p: Product, s: Selection): ResolvedConfiguration {
  const resolved: ResolvedConfiguration = {};
  for (const slot of p.slots) resolved[slot.id] = { model: slot.model, finish: slot.finish };
  for (const option of p.options) {
    const value: OptionValue = option.values[findValueIndex(option, s[option.name])];
    for (const set of value.sets) {
      const target: { model: string; finish: string } = resolved[set.slot];
      if (set.model !== undefined) target.model = set.model;
      if (set.finish !== undefined) target.finish = set.finish;
    }
  }
  return resolved;
}
