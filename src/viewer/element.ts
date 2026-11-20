// <mini3d-viewer product="ob1" [stats]>: the embeddable 3D viewer. It holds no product or store
// knowledge; a page drives it only through setConfiguration(), `product`, `configuration` and events.
import type { BuiltProduct, Selection, SlotDef } from '../schema/product.ts';
import { possibleModels, validateProduct, ProductError } from '../schema/validate.ts';
import { configurationKey, normaliseSelection } from '../schema/configurations.ts';
import type { DebugInfo, FromEngine, SpeedTestResult, ToEngine } from './protocol.ts';
import { createEngineHost, type EngineHost } from './host.ts';
import { resolveProductUrl } from './products.ts';
import { createStatsPanel, type StatsPanel } from './stats.ts';

const START_MARGIN: string = '200px';
const STILL_FADE_MS: number = 200;
const LINE_HEIGHT_PX: number = 16;

const STYLE: string = `
:host { display: block; position: relative; overflow: hidden; contain: content; }
.box, .box canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; outline: none; }
.still { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; transition: opacity ${STILL_FADE_MS}ms ease-out; }
.still.gone { opacity: 0; }
.hint { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); padding: 4px 10px; border-radius: 999px;
  font: 12px/1.4 system-ui, sans-serif; color: rgba(255,255,255,.8); background: rgba(0,0,0,.35); pointer-events: none; transition: opacity .4s; }
.hint.gone { opacity: 0; }
.stats { position: absolute; top: 8px; left: 8px; max-width: calc(100% - 16px); max-height: calc(100% - 16px); overflow: auto; padding: 6px 8px;
  border-radius: 6px; background: rgba(0,0,0,.65); color: #eee; font: 11px/1.35 ui-monospace, monospace; }
.stats pre { margin: 0 0 4px; white-space: pre-wrap; }
.stats button { font: inherit; margin: 2px 0 4px; padding: 3px 8px; }
`;

type Pending<T> = { resolve: (v: T) => void; reject: (e: Error) => void };

export class Mini3dViewer extends HTMLElement {
  static observedAttributes: string[] = ['product', 'stats'];

  private readonly root: ShadowRoot;
  private readonly box: HTMLDivElement;
  private readonly still: HTMLImageElement;
  private readonly hint: HTMLDivElement;
  private statsPanel: StatsPanel | null = null;

  private host: EngineHost | null = null;
  private builtProduct: BuiltProduct | null = null;
  private productUrl: string = '';
  private shown: Selection = {};
  private requested: Selection = {};
  private earlyPicks: Partial<Selection> = {};
  private flushQueued: boolean = false;
  private started: boolean = false;
  private engineInitialised: boolean = false;
  private engineAlive: boolean = false;
  private isReady: boolean = false;
  private intersecting: boolean = false;
  private widthCss: number = 0;
  private heightCss: number = 0;
  private dragRect: DOMRect | null = null;
  private nextId: number = 1;
  private readonly pending: Map<number, Pending<unknown>> = new Map();
  private intersection: IntersectionObserver | null = null;
  private resize: ResizeObserver | null = null;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    const style: HTMLStyleElement = document.createElement('style');
    style.textContent = STYLE;
    this.box = document.createElement('div');
    this.box.className = 'box';
    this.still = document.createElement('img');
    this.still.className = 'still';
    this.still.alt = '';
    this.still.decoding = 'async';
    this.still.addEventListener('error', () => { this.still.style.visibility = 'hidden'; });
    this.still.addEventListener('load', () => { this.still.style.visibility = ''; });
    this.hint = document.createElement('div');
    this.hint.className = 'hint';
    this.hint.textContent = 'Drag to spin';
    this.root.append(style, this.box, this.still, this.hint);
    this.bindInput();
  }

  // ---------- public interface ----------

  get product(): BuiltProduct | null {
    return this.builtProduct;
  }

  /** The configuration on screen. */
  get configuration(): Selection {
    return { ...this.shown };
  }

  setConfiguration(partial: Partial<Selection>): void {
    if (!this.builtProduct) {
      this.earlyPicks = { ...this.earlyPicks, ...partial };
      return;
    }
    let next: Selection;
    try {
      next = normaliseSelection(this.builtProduct, partial, this.requested);
    } catch (error) {
      if (!(error instanceof ProductError)) throw error;
      this.fire('error', { reason: `invalid-selection: ${error.path}`, fatal: false });
      return;
    }
    this.requested = next;
    if (!this.isReady) this.showStill(next);
    if (!this.engineAlive) {
      // Stills only (no WebGL2, or the 3D failed): the still is the configuration on screen.
      this.shown = next;
      this.fire('configurationchange', { selection: { ...next } });
      return;
    }
    // Picks made in the same task collapse into one message: the last one wins.
    if (!this.flushQueued) {
      this.flushQueued = true;
      queueMicrotask(() => {
        this.flushQueued = false;
        this.send({ type: 'configure', selection: this.requested });
      });
    }
  }

  captureStill(sizePx: number): Promise<Blob> {
    return this.ask<Blob>(id => ({ type: 'capture', id, sizePx }));
  }

  runSpeedTest(): Promise<SpeedTestResult> {
    return this.ask<SpeedTestResult>(id => ({ type: 'speedTest', id }));
  }

  /** Programs and textures on the GPU; only with the `stats` attribute. */
  debugInfo(): Promise<DebugInfo> {
    if (!this.hasAttribute('stats')) return Promise.reject(new Error('debugInfo needs the stats attribute'));
    return this.ask<DebugInfo>(id => ({ type: 'debug', id }));
  }

  /** Simulates a lost WebGL context; only with the `stats` attribute. */
  debugLoseContext(): void {
    if (this.hasAttribute('stats')) this.send({ type: 'loseContext' });
  }

  // ---------- lifecycle ----------

  connectedCallback(): void {
    this.intersection = new IntersectionObserver(entries => {
      this.intersecting = entries.some(e => e.isIntersecting);
      if (this.intersecting) void this.start();
      this.sendVisibility();
    }, { rootMargin: START_MARGIN });
    this.intersection.observe(this);
    this.resize = new ResizeObserver(entries => {
      const box = entries[entries.length - 1].contentRect;
      this.onResize(box.width, box.height);
    });
    this.resize.observe(this);
    document.addEventListener('visibilitychange', this.sendVisibility);
  }

  disconnectedCallback(): void {
    this.intersection?.disconnect();
    this.resize?.disconnect();
    document.removeEventListener('visibilitychange', this.sendVisibility);
    this.send({ type: 'visible', visible: false });
  }

  attributeChangedCallback(name: string): void {
    if (name === 'stats') this.updateStatsPanel();
  }

  private async start(): Promise<void> {
    if (this.started) return;
    const id: string | null = this.getAttribute('product');
    if (!id) return;
    this.started = true;
    this.updateStatsPanel();
    const origin: string = this.dataset.origin ?? location.origin;
    let defaultStillUrl: string;
    try {
      ({ productUrl: this.productUrl, defaultStillUrl } = await resolveProductUrl(id, origin));
    } catch (error) {
      this.fire('error', { reason: `product-not-found: ${(error as Error).message}`, fatal: true });
      return;
    }
    this.still.src = defaultStillUrl;

    if (!hasWebGL2()) {
      this.fire('error', { reason: 'webgl2-unavailable', fatal: true });
      await this.loadProductForStills();
      return;
    }
    this.engineAlive = true;
    this.host = await createEngineHost(this.box, m => this.onEngineMessage(m));
    this.initEngineIfSized();
  }

  /** Without 3D, the element still reads the product so pages can build pickers and stills follow picks. */
  private async loadProductForStills(): Promise<void> {
    try {
      const response: Response = await fetch(this.productUrl);
      const product: BuiltProduct = validateProduct(await response.json()) as BuiltProduct;
      this.onEngineMessage({ type: 'product', product });
    } catch (error) {
      this.fire('error', { reason: `invalid-product: ${(error as Error).message}`, fatal: true });
    }
  }

  private onResize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return; // hidden: never initialise or draw at zero size
    this.widthCss = width;
    this.heightCss = height;
    if (this.engineInitialised) this.send({ type: 'resize', widthCss: width, heightCss: height, dpr: devicePixelRatio });
    else this.initEngineIfSized();
  }

  private initEngineIfSized(): void {
    if (!this.host || this.engineInitialised || this.widthCss <= 0 || this.heightCss <= 0) return;
    this.engineInitialised = true;
    this.send({
      type: 'init', productUrl: this.productUrl, selection: null,
      widthCss: this.widthCss, heightCss: this.heightCss, dpr: devicePixelRatio, stats: this.hasAttribute('stats'),
    });
    this.sendVisibility();
  }

  private readonly sendVisibility = (): void => {
    if (this.engineInitialised) this.send({ type: 'visible', visible: this.intersecting && !document.hidden });
  };

  // ---------- engine messages ----------

  private onEngineMessage(m: FromEngine): void {
    switch (m.type) {
      case 'product': {
        this.builtProduct = m.product;
        this.shown = { ...m.product.defaultSelection };
        this.requested = { ...this.shown };
        this.fire('productload', { product: m.product });
        const early: Partial<Selection> = this.earlyPicks;
        this.earlyPicks = {};
        if (Object.keys(early).length > 0) this.setConfiguration(early);
        break;
      }
      case 'progress':
        this.fire('progress', { loaded: m.loaded, total: m.total, phase: m.phase });
        break;
      case 'ready':
        this.isReady = true;
        this.still.classList.add('gone');
        this.clearLoaderStill();
        this.statsPanel?.setFirstView(performance.now());
        this.fire('ready', {});
        break;
      case 'configured':
        this.shown = { ...m.selection };
        this.fire('configurationchange', { selection: { ...m.selection } });
        break;
      case 'restored':
        this.fire('restored', {});
        break;
      case 'error':
        // A failed pick falls back to what's shown; a failed after-first-view part leaves any pick in flight alone.
        if (m.reason.startsWith('model-load-failed') && !this.isAfterFirstViewModel(m.reason.slice(m.reason.indexOf(':') + 1).trim())) {
          this.requested = { ...this.shown };
        }
        if (m.fatal) this.onFatal();
        this.fire('error', { reason: m.reason, fatal: m.fatal });
        break;
      case 'captured':
        this.settle(m.id, m.blob);
        break;
      case 'speedTestResult':
        this.settle(m.id, m.result);
        break;
      case 'debugInfo':
        this.settle(m.id, m.info);
        break;
      case 'stats':
        this.statsPanel?.setEngineText(m.text);
        break;
    }
  }

  /** The 3D is gone: show the still for what's on screen and keep following picks with stills. */
  private onFatal(): void {
    this.engineAlive = false;
    this.isReady = false;
    this.host?.dispose();
    this.host = null;
    this.still.classList.remove('gone');
    if (this.builtProduct) this.showStill(this.requested);
    else if (this.productUrl) void this.loadProductForStills();
    for (const [id, p] of this.pending) {
      p.reject(new Error('the 3D view is not available'));
      this.pending.delete(id);
    }
  }

  // ---------- helpers ----------

  /** Only after-first-view slots can hold this model, so no pick ever waits for it. */
  private isAfterFirstViewModel(modelId: string): boolean {
    const product: BuiltProduct | null = this.builtProduct;
    if (!product) return false;
    const holders: SlotDef[] = product.slots.filter(s => possibleModels(product, s.id).has(modelId));
    return holders.length > 0 && holders.every(s => s.afterFirstView === true);
  }

  private showStill(selection: Selection): void {
    const product: BuiltProduct | null = this.builtProduct;
    if (!product || !this.productUrl) return;
    const file: string = product.stills.pattern.replace('{key}', configurationKey(product, selection));
    this.still.src = new URL(file, this.productUrl).href;
  }

  /** loader.js paints the still as this element's background before the viewer code arrives; the canvas is transparent, so remove it once the 3D shows. */
  private clearLoaderStill(): void {
    if (this.dataset.loaderStill === undefined) return;
    this.style.removeProperty('background');
    delete this.dataset.loaderStill;
  }

  private send(m: ToEngine): void {
    this.host?.send(m);
  }

  private ask<T>(message: (id: number) => ToEngine): Promise<T> {
    if (!this.host || !this.isReady) return Promise.reject(new Error('the 3D view is not ready'));
    const id: number = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.send(message(id));
    });
  }

  private settle(id: number, value: unknown): void {
    this.pending.get(id)?.resolve(value);
    this.pending.delete(id);
  }

  private fire(name: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private updateStatsPanel(): void {
    const wanted: boolean = this.hasAttribute('stats');
    if (wanted && !this.statsPanel) {
      this.statsPanel = createStatsPanel(() => this.runSpeedTest());
      this.root.append(this.statsPanel.element);
    } else if (!wanted && this.statsPanel) {
      this.statsPanel.element.remove();
      this.statsPanel = null;
    }
  }

  private bindInput(): void {
    const box: HTMLDivElement = this.box;
    const pointer = (kind: 'down' | 'move' | 'up' | 'cancel') => (e: PointerEvent): void => {
      if (kind === 'down') {
        box.setPointerCapture(e.pointerId);
        this.dragRect = box.getBoundingClientRect();
        this.hint.classList.add('gone');
      }
      const rect: DOMRect = this.dragRect ?? box.getBoundingClientRect();
      this.send({ type: 'pointer', kind, id: e.pointerId, x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    box.addEventListener('pointerdown', pointer('down'));
    box.addEventListener('pointermove', e => { if (box.hasPointerCapture(e.pointerId)) pointer('move')(e); });
    box.addEventListener('pointerup', pointer('up'));
    box.addEventListener('pointercancel', pointer('cancel'));
    box.addEventListener('wheel', e => {
      e.preventDefault();
      const rect: DOMRect = box.getBoundingClientRect();
      const scale: number = e.deltaMode === 1 ? LINE_HEIGHT_PX : e.deltaMode === 2 ? rect.height : 1;
      this.send({ type: 'wheel', deltaY: e.deltaY * scale, x: e.clientX - rect.left, y: e.clientY - rect.top });
    }, { passive: false });
  }
}

/** Tries a WebGL2 context on a scratch canvas, then releases it. */
function hasWebGL2(): boolean {
  try {
    const gl: WebGL2RenderingContext | null = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

if (!customElements.get('mini3d-viewer')) customElements.define('mini3d-viewer', Mini3dViewer);
