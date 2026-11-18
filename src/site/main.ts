// The v1 page. It drives the viewer only through its public interface: `product`,
// `configuration`, setConfiguration() and events — the same path a store connector will use.
import type { BuiltProduct, Selection } from '../schema/product.ts';
import type { Mini3dViewer } from '../viewer/element.ts';
import { renderPicker, updatePicker } from './picker.ts';

const viewer = document.querySelector('mini3d-viewer') as Mini3dViewer;
const picker = document.getElementById('picker') as HTMLDivElement;
const summary = document.getElementById('summary') as HTMLDListElement;

if (new URLSearchParams(location.search).has('stats')) viewer.setAttribute('stats', '');

function renderSummary(product: BuiltProduct, selection: Selection): void {
  summary.replaceChildren(...product.options.flatMap(option => {
    const term: HTMLElement = document.createElement('dt');
    term.textContent = option.name;
    const detail: HTMLElement = document.createElement('dd');
    detail.textContent = selection[option.name] ?? '';
    return [term, detail];
  }));
}

function show(selection: Selection): void {
  if (!viewer.product) return;
  updatePicker(picker, selection);
  renderSummary(viewer.product, selection);
}

viewer.addEventListener('productload', () => {
  const product: BuiltProduct = viewer.product!;
  renderPicker(picker, product, viewer.configuration, (option: string, value: string) => {
    updatePicker(picker, { ...viewer.configuration, [option]: value }); // pressed at once; the 3D follows on its next frame
    viewer.setConfiguration({ [option]: value });
  });
  renderSummary(product, viewer.configuration);
});
viewer.addEventListener('configurationchange', () => show(viewer.configuration));
viewer.addEventListener('error', () => show(viewer.configuration)); // a dropped pick: back to what's on screen
