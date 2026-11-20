// Dev harness: the Engine on the main thread with a full-window canvas, buttons that cycle each
// option, and a speed-test button. Open /src/site/engine-dev.html under `npm run dev`.
import type { BuiltProduct, Selection } from '../schema/product.ts';
import type { FromEngine, SpeedTestResult } from '../viewer/protocol.ts';
import { Engine } from '../viewer/render/engine.ts';

const canvas: HTMLCanvasElement = document.getElementById('view') as HTMLCanvasElement;
const optionsEl: HTMLDivElement = document.getElementById('options') as HTMLDivElement;
const out: HTMLPreElement = document.getElementById('out') as HTMLPreElement;
const statsEl: HTMLPreElement = document.getElementById('stats') as HTMLPreElement;

let product: BuiltProduct | null = null;
let selection: Selection = {};

function formatResult(r: SpeedTestResult): string {
  return [
    `frames ${r.frames} · avg ${r.avgFps.toFixed(1)} fps`,
    `frame ms p50 ${r.p50Ms.toFixed(1)} · p95 ${r.p95Ms.toFixed(1)} · max ${r.maxMs.toFixed(1)}`,
    `over 33.4 ms ${r.over33Ms} · worst swap ${r.worstSwapMs.toFixed(1)} ms`,
    `slow swaps ${r.slowSwaps.length ? `\n  ${r.slowSwaps.join('\n  ')}` : 'none'}`,
  ].join('\n');
}

function renderButtons(): void {
  if (!product) return;
  optionsEl.replaceChildren(...product.options.map(option => {
    const button: HTMLButtonElement = document.createElement('button');
    button.textContent = `${option.name}: ${selection[option.name]}`;
    button.addEventListener('click', () => {
      const index: number = option.values.findIndex(v => v.name === selection[option.name]);
      const next: string = option.values[(index + 1) % option.values.length].name;
      engine.handle({ type: 'configure', selection: { ...selection, [option.name]: next } });
    });
    return button;
  }));
}

const engine: Engine = new Engine(canvas, (m: FromEngine) => {
  switch (m.type) {
    case 'product': product = m.product; selection = { ...m.selection }; renderButtons(); break;
    case 'ready': out.textContent = 'ready'; break;
    case 'configured': selection = m.selection; renderButtons(); break;
    case 'progress': if (m.phase === 'background') out.textContent = `background ${m.loaded}/${m.total}`; break;
    case 'error': console.warn('engine error', m); out.textContent = `error: ${m.reason}`; break;
    case 'speedTestResult': out.textContent = formatResult(m.result); console.log(m.result); break;
    case 'stats': statsEl.textContent = m.text; break;
    default: break;
  }
}, 'main');

const pointer = (kind: 'down' | 'move' | 'up' | 'cancel') => (e: PointerEvent): void => {
  if (kind === 'down') canvas.setPointerCapture(e.pointerId);
  const box: DOMRect = canvas.getBoundingClientRect();
  engine.handle({ type: 'pointer', kind, id: e.pointerId, x: e.clientX - box.left, y: e.clientY - box.top, tMs: e.timeStamp });
};
canvas.addEventListener('pointerdown', pointer('down'));
canvas.addEventListener('pointermove', pointer('move'));
canvas.addEventListener('pointerup', pointer('up'));
canvas.addEventListener('pointercancel', pointer('cancel'));
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const box: DOMRect = canvas.getBoundingClientRect();
  engine.handle({ type: 'wheel', deltaY: e.deltaY, x: e.clientX - box.left, y: e.clientY - box.top });
}, { passive: false });
new ResizeObserver(() => engine.handle({ type: 'resize', widthCss: canvas.clientWidth, heightCss: canvas.clientHeight, dpr: devicePixelRatio })).observe(canvas);
document.addEventListener('visibilitychange', () => engine.handle({ type: 'visible', visible: !document.hidden }));
document.getElementById('speed')!.addEventListener('click', () => { out.textContent = 'running…'; engine.handle({ type: 'speedTest', id: 1 }); });

const pointerFile: { bundle: string } = await (await fetch('/products/ob1.json')).json() as { bundle: string };
engine.handle({
  type: 'init', productUrl: new URL(`/${pointerFile.bundle}product.json`, location.href).href, selection: null,
  widthCss: canvas.clientWidth, heightCss: canvas.clientHeight, dpr: devicePixelRatio, stats: true,
});
// Console handle for live checks.
(window as unknown as { engine: Engine }).engine = engine;
