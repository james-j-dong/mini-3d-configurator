// The option picker: one group per option, values in settings-file order, each a plain text button.
// It stands in for a store's own picker, so it ignores the values' swatch colours.
import type { BuiltProduct, Selection } from '../schema/product.ts';

export function renderPicker(container: HTMLElement, product: BuiltProduct, selection: Selection, onPick: (option: string, value: string) => void): void {
  container.replaceChildren(...product.options.map(option => {
    const group: HTMLFieldSetElement = document.createElement('fieldset');
    group.className = 'group';
    const legend: HTMLLegendElement = document.createElement('legend');
    legend.textContent = option.name;
    const current: HTMLSpanElement = document.createElement('span');
    current.className = 'current';
    legend.append(current);
    const values: HTMLDivElement = document.createElement('div');
    values.className = 'values';
    for (const value of option.values) {
      const button: HTMLButtonElement = document.createElement('button');
      button.type = 'button';
      button.dataset.option = option.name;
      button.dataset.value = value.name;
      button.textContent = value.name;
      button.addEventListener('click', () => onPick(option.name, value.name));
      values.append(button);
    }
    group.append(legend, values);
    return group;
  }));
  updatePicker(container, selection);
}

/** Marks the selected value in each group without rebuilding, so keyboard focus stays put. */
export function updatePicker(container: HTMLElement, selection: Selection): void {
  for (const button of container.querySelectorAll<HTMLButtonElement>('button[data-option]')) {
    button.setAttribute('aria-pressed', String(selection[button.dataset.option!] === button.dataset.value));
  }
  for (const group of container.querySelectorAll<HTMLFieldSetElement>('fieldset')) {
    const option: string | undefined = group.querySelector<HTMLButtonElement>('button[data-option]')?.dataset.option;
    const current: HTMLSpanElement | null = group.querySelector('.current');
    if (option && current) current.textContent = selection[option] ?? '';
  }
}
