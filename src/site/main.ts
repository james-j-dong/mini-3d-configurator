// The v1 page. It drives the viewer only through its public interface: `product`, `configuration`,
// `requestedConfiguration`, setConfiguration() and events — the same path a store connector will use.
import type { BuiltProduct, Selection } from '../schema/product.ts';
import type { Mini3dViewer } from '../viewer/element.ts';
import { renderPicker, updatePicker } from './picker.ts';

const viewer: Mini3dViewer = document.querySelector('mini3d-viewer') as Mini3dViewer;
const picker: HTMLDivElement = document.getElementById('picker') as HTMLDivElement;
const summary: HTMLDListElement = document.getElementById('summary') as HTMLDListElement;

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

/** The buttons show what was asked for (pressed at once, even while its parts load); the summary shows what's on screen. */
function show(): void {
  if (!viewer.product) return;
  updatePicker(picker, viewer.requestedConfiguration);
  renderSummary(viewer.product, viewer.configuration);
}

viewer.addEventListener('productload', () => {
  renderPicker(picker, viewer.product!, viewer.requestedConfiguration, (option: string, value: string) => {
    viewer.setConfiguration({ [option]: value });
    show();
  });
  show();
});
viewer.addEventListener('configurationchange', show);
// A dropped pick puts requestedConfiguration back to what's on screen. Any other error leaves it alone.
viewer.addEventListener('error', show);
