// The render engine: everything that touches WebGL. It runs in a worker (OffscreenCanvas) or on the
// main thread, and talks to the viewer element only through ToEngine / FromEngine messages.
import {
  Box3, BoxGeometry, BufferGeometry, CylinderGeometry, Matrix4, Mesh, NeutralToneMapping, PerspectiveCamera, Scene,
  SphereGeometry, Vector2, WebGLRenderer, type DirectionalLight, type Material, type Texture,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { BuiltProduct, ModelDef, Product, ResolvedConfiguration, Selection } from '../../schema/product.ts';
import { validateProduct } from '../../schema/validate.ts';
import { normaliseSelection, resolveConfiguration } from '../../schema/configurations.ts';
import type { DebugInfo, FromEngine, QualityLevel, SpeedTestResult, ToEngine } from '../protocol.ts';
import { resolveAssembly } from './assembly.ts';
import { OrbitController } from './orbit.ts';
import { makeFinishTextures, type FinishTextures } from './textures.ts';
import { createMaterials, type QualityTier } from './materials.ts';
import { createStudio, ENVIRONMENT_INTENSITY, shadowPlacement, type Studio } from './studio.ts';
import { deferredModelsOf, LoadPlanner, requiredModelsOf, SwapScheduler, type PartState, type SwapStep } from './scheduler.ts';
import { DisplayInterval, FrameIntervals, QualityGovernor } from './governor.ts';
import { warmDraw, warmUp } from './warmup.ts';

type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;

interface ModelState {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  /** Drawn at least once with every material (warm-up); a swap never shows an unwarmed part. */
  warmed: boolean;
  geometry?: BufferGeometry;
  /** The GLB node's own transform (quantization scale and offset). */
  local: Matrix4;
  inFlight?: Promise<void>;
}

interface SpeedTestRun {
  id: number;
  startMs: number;
  lastMs: number;
  deltas: number[];
  swapFrames: number[];
  labels: string[];
  nextSwapMs: number;
  swaps: number;
  selection: Selection;
  original: Selection;
}

const METRES_PER_MM: number = 0.001;
const TONE_MAPPING_EXPOSURE: number = 1.15;
const PRIMITIVE_SEGMENTS: number = 64;
const SLOW_FRAME_MS: number = 33.4;
const SPEED_TEST_MS: number = 6000;
const SPEED_TEST_SWAP_EVERY_MS: number = 500;
const SPEED_TEST_TURN_RAD_PER_FRAME: number = 0.02;
const WHEEL_ZOOM_PER_PIXEL: number = 0.002;
const MAX_STEP_MS: number = 100;
const WEBP_QUALITY: number = 0.8;
/** After-first-view slots draw after the outside parts, so the depth test rejects their hidden pixels cheaply. */
const AFTER_FIRST_VIEW_RENDER_ORDER: number = 1;
/** The attributes Three.js would request itself for { antialias, alpha, powerPreference }. */
const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true, depth: true, stencil: false, antialias: true, premultipliedAlpha: true,
  preserveDrawingBuffer: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false,
};

const requestFrame: (callback: (t: number) => void) => void = typeof globalThis.requestAnimationFrame === 'function'
  ? (callback): void => { globalThis.requestAnimationFrame(callback); }
  : (callback): void => { setTimeout(() => callback(performance.now()), 16); };

function primitiveGeometry(model: ModelDef): BufferGeometry {
  switch (model.kind) {
    case 'box': {
      const [x, y, z] = model.sizeMm.map(v => v * METRES_PER_MM);
      return new BoxGeometry(x, y, z).translate(0, y / 2, 0); // origin: bottom centre
    }
    case 'cylinder': {
      const r: number = model.radiusMm * METRES_PER_MM;
      const h: number = model.heightMm * METRES_PER_MM;
      return new CylinderGeometry(r, r, h, PRIMITIVE_SEGMENTS).translate(0, h / 2, 0); // origin: bottom centre
    }
    case 'sphere':
      return new SphereGeometry(model.radiusMm * METRES_PER_MM, PRIMITIVE_SEGMENTS, PRIMITIVE_SEGMENTS / 2); // origin: centre
    case 'converted':
      throw new Error('converted models are downloaded, not generated');
  }
}

/** Every converted model must list its GLB files; otherwise the bundle is broken. */
function checkBuiltFiles(p: BuiltProduct): void {
  if (typeof p.version !== 'string' || typeof p.files !== 'object' || p.files === null) throw new Error('not a built bundle (no version or files)');
  for (const [id, model] of Object.entries(p.models)) {
    if (model.kind === 'converted' && !(p.files[id]?.default && p.files[id]?.light)) throw new Error(`files.${id} is missing`);
  }
}

const percentile = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;

export class Engine {
  private readonly canvas: RenderCanvas;
  private readonly emit: (m: FromEngine) => void;
  private readonly renderPath: 'worker' | 'main';

  private renderer: WebGLRenderer | null = null;
  private readonly scene: Scene = new Scene();
  private readonly camera: PerspectiveCamera = new PerspectiveCamera();
  private orbit: OrbitController | null = null;
  private readonly governor: QualityGovernor = new QualityGovernor();
  private scheduler: SwapScheduler = new SwapScheduler();
  private readonly loader: GLTFLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

  private product: BuiltProduct | null = null;
  private productUrl: string = '';
  private textures: FinishTextures | null = null;
  private materials: Record<QualityTier, Map<string, Material>> | null = null;
  private studio: Studio | null = null;
  private readonly models: Map<string, ModelState> = new Map();
  private readonly slotMeshes: Map<string, Mesh> = new Map();
  private readonly bounds: Box3 = new Box3();
  private current: Selection = {};
  private emitOnApply: boolean = true;
  private warmQueue: string[] = [];
  /** After-first-view models currently drawn by a slot. */
  private shownDeferred: Set<string> = new Set();
  /** An after-first-view part was warmed: show it on the next frame, never the frame that warmed it. */
  private revealPending: boolean = false;

  private widthCss: number = 0;
  private heightCss: number = 0;
  private dpr: number = 1;
  private ready: boolean = false;
  private visible: boolean = true;
  private contextLost: boolean = false;
  private simulatedLoss: boolean = false;
  private dirty: boolean = false;
  private tickQueued: boolean = false;
  private lastTickMs: number = 0;
  private readonly frameIntervals: FrameIntervals = new FrameIntervals();
  private readonly displayInterval: DisplayInterval = new DisplayInterval();
  /** This tick paid a part's one-off first-draw cost, so the time to the next frame says nothing about render load. */
  private warmedThisTick: boolean = false;

  private readonly pointers: Map<number, { x: number; y: number }> = new Map();
  private pinchDistance: number = 0;

  private speedTest: SpeedTestRun | null = null;
  /** A speed test was asked for; it starts once the after-first-view parts are on screen, so it times the whole product. */
  private speedTestWaitingId: number | null = null;
  private statsOn: boolean = false;
  private readonly recentFrameMs: number[] = [];
  private initMs: number = 0;
  private firstViewMs: number = 0;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, emit: (m: FromEngine) => void, renderPath: 'worker' | 'main') {
    this.canvas = canvas;
    this.emit = emit;
    this.renderPath = renderPath;
  }

  handle(m: ToEngine): void {
    switch (m.type) {
      case 'init': void this.init(m); break;
      case 'resize': this.resize(m.widthCss, m.heightCss, m.dpr); break;
      case 'pointer': this.onPointer(m.kind, m.id, m.x, m.y, m.tMs); break;
      case 'wheel': this.onWheel(m.deltaY, m.x, m.y); break;
      case 'configure': this.request(m.selection, true); break;
      case 'visible': this.setVisible(m.visible); break;
      case 'capture': void this.capture(m.id, m.sizePx); break;
      case 'speedTest': this.startSpeedTest(m.id); break;
      case 'debug': this.emit({ type: 'debugInfo', id: m.id, info: this.debugInfo() }); break;
      case 'loseContext': this.loseContext(); break;
    }
  }

  // ---------- start-up ----------

  private async init(m: Extract<ToEngine, { type: 'init' }>): Promise<void> {
    this.initMs = performance.now();
    this.widthCss = m.widthCss;
    this.heightCss = m.heightCss;
    this.dpr = m.dpr;
    this.statsOn = m.stats;
    this.productUrl = m.productUrl;

    // Probe for WebGL2 ourselves: Three.js logs a console error before throwing, and "no WebGL2 on
    // an OffscreenCanvas" (WebKit) is an expected, handled case — the host falls back to the main thread.
    let renderer: WebGLRenderer;
    try {
      const context: WebGL2RenderingContext | null = (this.canvas as HTMLCanvasElement).getContext('webgl2', CONTEXT_ATTRIBUTES);
      if (!context) throw new Error('no WebGL2');
      renderer = new WebGLRenderer({ canvas: this.canvas, context, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      this.emit({ type: 'error', reason: 'webgl2-unavailable', fatal: true });
      return;
    }
    this.renderer = renderer;
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
    this.applySize();
    this.canvas.addEventListener('webglcontextlost', this.onContextLost as EventListener);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored as EventListener);

    let product: BuiltProduct;
    try {
      const response: Response = await fetch(this.productUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      product = validateProduct(await response.json()) as BuiltProduct;
      checkBuiltFiles(product);
    } catch (error) {
      this.emit({ type: 'error', reason: `invalid-product: ${(error as Error).message}`, fatal: true });
      return;
    }
    this.product = product;
    this.emit({ type: 'product', product });
    this.scheduler = new SwapScheduler(s => requiredModelsOf(product, s));
    this.orbit = new OrbitController(product.framing);
    for (const id of Object.keys(product.models)) this.models.set(id, { status: 'idle', warmed: false, local: new Matrix4() });

    let selection: Selection = product.defaultSelection;
    try {
      if (m.selection) selection = normaliseSelection(product, m.selection, product.defaultSelection);
    } catch {
      this.emit({ type: 'error', reason: 'invalid-selection: initial', fatal: false });
    }

    // The current configuration's parts first; after-first-view parts load once it's on screen.
    const currentModels: string[] = requiredModelsOf(product, selection);
    let loaded: number = 0;
    this.emit({ type: 'progress', loaded, total: currentModels.length, phase: 'current' });
    await Promise.all(currentModels.map(async id => {
      await this.loadModel(id);
      this.emit({ type: 'progress', loaded: ++loaded, total: currentModels.length, phase: 'current' });
    }));
    const failed: string | undefined = currentModels.find(id => this.models.get(id)!.status !== 'ready');
    if (failed) {
      this.emit({ type: 'error', reason: `model-load-failed: ${failed}`, fatal: true });
      return;
    }

    this.buildLook(product);
    this.buildSlots(product);
    this.applyConfiguration(selection);
    this.orbit.fit(this.widthCss, this.heightCss, this.bounds);
    this.orbit.apply(this.camera);
    this.installStudio(renderer); // sized from the shown parts; before the warm-up, so the shadow's shader is compiled in it
    await this.warmAll();
    if (this.contextLost) return;
    this.render();
    this.ready = true;
    this.firstViewMs = performance.now() - this.initMs;
    this.emit({ type: 'ready' });
    this.emitDeferredProgress();
    if (this.statsOn) setInterval(() => this.emitStats(), 1000);
    if (this.scheduler.pending) this.request(this.scheduler.pending, this.emitOnApply);
    void this.backgroundLoad();
    this.requestTick(); // nothing to draw yet: these first ticks time the display's refresh interval
  }

  /** Textures and both material tiers. */
  private buildLook(product: Product): void {
    this.textures = makeFinishTextures();
    this.materials = { full: createMaterials(product, this.textures, 'full'), lean: createMaterials(product, this.textures, 'lean') };
  }

  /** The environment, key light and contact shadow, the shadow sized and placed from the shown parts' bounds. */
  private installStudio(renderer: WebGLRenderer): void {
    if (this.studio) {
      this.scene.remove(this.studio.shadow, this.studio.keyLight);
      this.studio.environment.dispose();
    }
    const { footprintM, floorYM } = shadowPlacement(this.bounds);
    this.studio = createStudio(renderer, footprintM, floorYM);
    this.scene.environment = this.studio.environment;
    this.scene.environmentIntensity = ENVIRONMENT_INTENSITY;
    this.scene.add(this.studio.shadow, this.studio.keyLight as DirectionalLight);
  }

  private buildSlots(product: Product): void {
    for (const [id, model] of Object.entries(product.models)) {
      if (model.kind !== 'converted') {
        const geometry: BufferGeometry = primitiveGeometry(model);
        geometry.computeBoundingBox();
        this.models.set(id, { status: 'ready', warmed: false, geometry, local: new Matrix4() });
      }
    }
    for (const slot of product.slots) {
      const mesh: Mesh = new Mesh();
      mesh.name = slot.id;
      mesh.matrixAutoUpdate = false;
      if (slot.afterFirstView) mesh.renderOrder = AFTER_FIRST_VIEW_RENDER_ORDER;
      this.slotMeshes.set(slot.id, mesh);
      this.scene.add(mesh);
    }
  }

  private allMaterials(): Material[] {
    return [...this.materials!.full.values(), ...this.materials!.lean.values()];
  }

  private allTextures(): Texture[] {
    const t: FinishTextures = this.textures!;
    return [t.weaveAlbedo, t.weaveNormal, t.weaveRoughness, t.forgedAlbedo, t.forgedRoughness];
  }

  /** Warm-up with every material of both tiers on every loaded geometry, so no swap or tier change compiles. */
  private async warmAll(): Promise<void> {
    const ready: ModelState[] = [...this.models.values()].filter(s => s.status === 'ready');
    await warmUp(this.renderer!, this.scene, this.camera, this.allMaterials(), ready.map(s => s.geometry!), this.allTextures());
    for (const state of ready) state.warmed = true;
    this.warmQueue = this.warmQueue.filter(id => !this.models.get(id)!.warmed);
  }

  // ---------- loading ----------

  private loadModel(id: string): Promise<void> {
    const state: ModelState = this.models.get(id)!;
    if (state.status === 'ready') return Promise.resolve();
    if (state.inFlight) return state.inFlight;
    state.status = 'loading';
    const level: 'default' | 'light' = this.governor.levelIndex >= 2 ? 'light' : 'default';
    const url: string = new URL(this.product!.files[id][level], this.productUrl).href;
    state.inFlight = (async (): Promise<void> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response: Response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const gltf: GLTF = await this.loader.parseAsync(await response.arrayBuffer(), url);
          gltf.scene.updateMatrixWorld(true);
          let found: Mesh | null = null;
          gltf.scene.traverse(o => { if (!found && (o as Mesh).isMesh) found = o as Mesh; });
          if (!found) throw new Error('no mesh in GLB');
          const mesh: Mesh = found;
          mesh.geometry.computeBoundingBox();
          state.geometry = mesh.geometry;
          state.local = mesh.matrixWorld.clone();
          state.status = 'ready';
          state.warmed = false;
          this.warmQueue.push(id); // warmed on an idle frame, or just before a pick shows it
          this.requestTick();
          return;
        } catch {
          // retry once, then give up
        }
      }
      state.status = 'failed';
    })().finally(() => { state.inFlight = undefined; });
    return state.inFlight;
  }

  /** Loads the other parts one at a time, most likely next picks first, warming each on an idle frame. */
  private async backgroundLoad(): Promise<void> {
    const order: string[] = new LoadPlanner(this.product!).order(this.current);
    const settled = (): number => order.filter(id => ['ready', 'failed'].includes(this.models.get(id)!.status)).length;
    this.emit({ type: 'progress', loaded: settled(), total: order.length, phase: 'background' });
    for (const id of order) {
      const state: ModelState = this.models.get(id)!;
      if (state.status === 'ready' || state.status === 'failed') continue;
      await this.loadModel(id);
      const status: ModelState['status'] = this.models.get(id)!.status;
      if (status === 'failed') {
        if (deferredModelsOf(this.product!, this.current).includes(id)) this.reportDeferredFailure(id);
        else this.failPendingPickIfItNeeds(id);
      }
      this.emit({ type: 'progress', loaded: settled(), total: order.length, phase: 'background' });
    }
  }

  /** An after-first-view part failed twice: report it; no pick waits for it. */
  private reportDeferredFailure(id: string): void {
    this.emit({ type: 'error', reason: `model-load-failed: ${id}`, fatal: false });
    this.emitDeferredProgress();
    this.requestTick(); // a waiting speed test may start now
  }

  /** `loaded` counts the current configuration's after-first-view models that are shown or failed. */
  private emitDeferredProgress(): void {
    const deferred: string[] = deferredModelsOf(this.product!, this.current);
    const loaded: number = deferred.filter(id => this.shownDeferred.has(id) || this.models.get(id)!.status === 'failed').length;
    this.emit({ type: 'progress', loaded, total: deferred.length, phase: 'deferred' });
  }

  /** Every after-first-view part of the current configuration is shown or has failed: nothing more will appear. */
  private deferredSettled(): boolean {
    return deferredModelsOf(this.product!, this.current).every(id => this.shownDeferred.has(id) || this.models.get(id)!.status === 'failed');
  }

  /** Some after-first-view part of the current configuration is loaded and warmed but not shown yet. */
  private deferredAwaitingReveal(): boolean {
    return deferredModelsOf(this.product!, this.current).some(id => !this.shownDeferred.has(id) && this.partState(id) === 'warmed');
  }

  // ---------- picks ----------

  private request(selection: Selection, emitOnApply: boolean): void {
    this.scheduler.request(selection);
    this.emitOnApply = emitOnApply;
    if (!this.ready) return;
    for (const id of requiredModelsOf(this.product!, selection)) {
      const state: ModelState = this.models.get(id)!;
      if (state.status === 'failed') {
        this.failPendingPickIfItNeeds(id);
        return;
      }
      if (state.status === 'idle') {
        void this.loadModel(id).then(() => {
          if (state.status === 'failed') this.failPendingPickIfItNeeds(id);
          else this.requestTick();
        });
      }
    }
    this.requestTick();
  }

  /** A part the pending pick needs failed twice: drop the pick, report it, and allow a later retry. */
  private failPendingPickIfItNeeds(id: string): void {
    const pending: Selection | null = this.scheduler.pending;
    if (!pending || !requiredModelsOf(this.product!, pending).includes(id)) return;
    this.scheduler.clear();
    this.models.get(id)!.status = 'idle';
    this.emit({ type: 'error', reason: `model-load-failed: ${id}`, fatal: false });
  }

  private applyConfiguration(selection: Selection): void {
    const product: BuiltProduct = this.product!;
    const resolved: ResolvedConfiguration = resolveConfiguration(product, selection);
    const world: Map<string, Matrix4> = resolveAssembly(product, resolved);
    const tier: QualityTier = this.governor.level.tier;
    this.bounds.makeEmpty();
    this.shownDeferred = new Set();
    for (const slot of product.slots) {
      const mesh: Mesh = this.slotMeshes.get(slot.id)!;
      const { model, finish } = resolved[slot.id];
      const state: ModelState = this.models.get(model)!;
      // The finish material is set even on a hidden slot: three compiles hidden meshes' materials too.
      mesh.material = this.materials![tier].get(finish)!;
      mesh.userData.finish = finish;
      // Required parts are always loaded and warmed by now; an after-first-view part waits until both.
      const shown: boolean = state.status === 'ready' && (slot.afterFirstView !== true || state.warmed);
      mesh.visible = shown;
      if (!shown) continue;
      if (slot.afterFirstView) this.shownDeferred.add(model);
      mesh.geometry = state.geometry!;
      mesh.matrix.multiplyMatrices(world.get(slot.id)!, state.local);
      mesh.matrixWorldNeedsUpdate = true;
      this.bounds.union(state.geometry!.boundingBox!.clone().applyMatrix4(mesh.matrix));
    }
    this.current = selection;
  }

  private partState(id: string): PartState {
    const state: ModelState = this.models.get(id)!;
    if (state.status !== 'ready') return 'loading';
    return state.warmed ? 'warmed' : 'loaded';
  }

  /**
   * Shows the latest pick once its parts are loaded and warmed. Parts that are loaded but never
   * drawn are warmed in this frame and the swap happens on the next one, so the swap frame never
   * pays a part's first-draw cost.
   */
  private trySwap(): boolean {
    const step: SwapStep | null = this.scheduler.step(id => this.partState(id));
    if (!step) return false;
    if (step.kind === 'warm') {
      for (const id of step.models) this.warmOne(id);
      this.dirty = true; // swap on the next frame
      return true;
    }
    this.applyConfiguration(step.selection);
    if (this.emitOnApply) this.emit({ type: 'configured', selection: step.selection });
    return true;
  }

  // ---------- drawing ----------

  private requestTick(): void {
    if (this.tickQueued || !this.visible || !this.renderer) return;
    this.tickQueued = true;
    requestFrame(this.tick);
  }

  private readonly tick = (t: number): void => {
    this.tickQueued = false;
    if (!this.visible || this.contextLost || !this.ready) {
      this.frameIntervals.reset();
      this.displayInterval.reset();
      return;
    }
    const stepMs: number = Math.min(MAX_STEP_MS, this.lastTickMs ? t - this.lastTickMs : 16.7);
    this.lastTickMs = t;

    let draw: boolean = this.dirty;
    this.dirty = false;
    this.warmedThisTick = false;
    if (this.orbit!.step(stepMs)) draw = true;
    if (this.speedTest) {
      this.speedTestTick(t);
      draw = true;
    }
    if (this.trySwap()) draw = true;
    let revealed: boolean = false;
    if (this.revealPending) {
      // Warmed on an earlier frame; showing it now costs no first draw.
      this.revealPending = false;
      this.applyConfiguration(this.current);
      revealed = true;
      draw = true;
    }
    while (!draw && this.warmQueue.length > 0) {
      const id: string = this.warmQueue.shift()!;
      if (this.models.get(id)!.warmed) continue;
      this.warmOne(id);
      if (this.deferredAwaitingReveal()) this.revealPending = true;
      draw = true; // the full frame below hides the 1-pixel warm draw
    }

    if (draw) this.render();
    if (revealed) this.emitDeferredProgress();
    this.startWaitingSpeedTest();
    const continues: boolean = this.pointers.size > 0 || this.orbit!.isCoasting || this.speedTest !== null || this.dirty
      || this.warmQueue.length > 0 || this.revealPending;
    // A warm-up's cost lands in the gap to the next frame; lower quality wouldn't shrink it, so that gap isn't timed.
    const interval: number | null = this.frameIntervals.tick(t, draw, continues && !this.warmedThisTick);
    if (interval !== null) this.recordFrame(interval, t);
    // Once drawing stops, a few more ticks that draw nothing time the display's own refresh interval.
    this.displayInterval.tick(t, draw);
    this.governor.displayMs = this.displayInterval.estimateMs ?? this.governor.displayMs;
    if (continues || this.displayInterval.wantsTick) this.requestTick();
  };

  private render(): void {
    this.orbit!.apply(this.camera);
    this.renderer!.render(this.scene, this.camera);
  }

  /** Draws one newly loaded geometry with every material into one pixel. */
  private warmOne(id: string): void {
    const state: ModelState | undefined = this.models.get(id);
    const geometry: BufferGeometry | undefined = state?.geometry;
    if (!state || !geometry || state.warmed) return;
    state.warmed = true;
    this.warmedThisTick = true;
    const meshes: Mesh[] = this.allMaterials().map(m => {
      const mesh: Mesh = new Mesh(geometry, m);
      mesh.frustumCulled = false;
      return mesh;
    });
    this.scene.add(...meshes);
    warmDraw(this.renderer!, this.scene, this.camera);
    this.scene.remove(...meshes);
  }

  private recordFrame(frameMs: number, nowMs: number): void {
    if (this.statsOn) this.recentFrameMs.push(frameMs);
    const changed: QualityLevel | null = this.governor.record(frameMs, nowMs);
    if (changed) this.applyLevel();
  }

  /** Switches material tier and pixel ratio to the governor's level. Both tiers are already warm. */
  private applyLevel(): void {
    const tier: QualityTier = this.governor.level.tier;
    for (const mesh of this.slotMeshes.values()) mesh.material = this.materials![tier].get(mesh.userData.finish as string)!;
    this.applySize();
    this.dirty = true;
  }

  private applySize(): void {
    const r: WebGLRenderer | null = this.renderer;
    if (!r || this.widthCss <= 0 || this.heightCss <= 0) return;
    r.setPixelRatio(Math.min(this.dpr, this.governor.level.dprCap));
    r.setSize(this.widthCss, this.heightCss, false);
  }

  private resize(widthCss: number, heightCss: number, dpr: number): void {
    if (widthCss <= 0 || heightCss <= 0) return; // hidden: keep the old size, never draw at zero
    this.widthCss = widthCss;
    this.heightCss = heightCss;
    this.dpr = dpr;
    this.applySize();
    if (this.ready) {
      this.orbit!.fit(widthCss, heightCss, this.bounds);
      this.dirty = true;
      this.requestTick();
    }
  }

  private setVisible(visible: boolean): void {
    this.visible = visible;
    this.frameIntervals.reset();
    this.displayInterval.reset();
    if (visible) {
      this.dirty = true;
      this.requestTick();
    }
  }

  // ---------- input ----------

  /** `tMs` is the pointer event's own time (the page's clock, not this thread's): only compare it with other events'. */
  private onPointer(kind: 'down' | 'move' | 'up' | 'cancel', id: number, x: number, y: number, tMs: number): void {
    if (!this.orbit) return;
    if (kind === 'down') {
      this.pointers.set(id, { x, y });
      this.orbit.grab(tMs);
      if (this.pointers.size === 2) this.pinchDistance = this.currentPinchDistance();
      this.requestTick();
      return;
    }
    if (kind === 'move') {
      const previous = this.pointers.get(id);
      if (!previous) return;
      this.pointers.set(id, { x, y });
      if (this.pointers.size === 1) {
        this.orbit.drag(x - previous.x, y - previous.y, this.heightCss, tMs);
      } else if (this.pointers.size === 2) {
        const distance: number = this.currentPinchDistance();
        if (this.pinchDistance > 0 && distance > 0) {
          const [a, b] = [...this.pointers.values()];
          this.orbit.zoom(distance / this.pinchDistance, ...this.toNdc((a.x + b.x) / 2, (a.y + b.y) / 2));
        }
        this.pinchDistance = distance;
      }
      this.dirty = true;
      this.requestTick();
      return;
    }
    // up or cancel
    if (!this.pointers.delete(id)) return;
    if (this.pointers.size === 0) this.orbit.release(tMs);
    else this.orbit.grab(tMs); // one finger of a pinch lifted: the other starts a new drag from here
    this.requestTick();
  }

  private currentPinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private toNdc(x: number, y: number): [number, number] {
    return [(x / this.widthCss) * 2 - 1, 1 - (y / this.heightCss) * 2];
  }

  private onWheel(deltaY: number, x: number, y: number): void {
    if (!this.orbit) return;
    this.orbit.zoom(Math.exp(-deltaY * WHEEL_ZOOM_PER_PIXEL), ...this.toNdc(x, y));
    this.dirty = true;
    this.requestTick();
  }

  // ---------- capture, speed test, diagnostics ----------

  /** One frame at sizePx², transparent background, framed for a square, as WebP. */
  private async capture(id: number, sizePx: number): Promise<void> {
    const r: WebGLRenderer | null = this.renderer;
    if (!r || !this.ready) {
      this.emit({ type: 'error', reason: 'capture-not-ready', fatal: false });
      return;
    }
    const ratio: number = r.getPixelRatio();
    const size: Vector2 = r.getSize(new Vector2());
    r.setPixelRatio(1);
    r.setSize(sizePx, sizePx, false);
    const camera: PerspectiveCamera = new PerspectiveCamera();
    const framing: OrbitController = new OrbitController(this.product!.framing);
    framing.fit(sizePx, sizePx, this.bounds);
    framing.apply(camera);
    r.render(this.scene, camera);
    const blob: Promise<Blob | null> = 'convertToBlob' in this.canvas
      ? this.canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY })
      : new Promise(resolve => (this.canvas as HTMLCanvasElement).toBlob(resolve, 'image/webp', WEBP_QUALITY));
    r.setPixelRatio(ratio);
    r.setSize(size.x, size.y, false);
    this.dirty = true;
    this.requestTick();
    const result: Blob | null = await blob;
    if (result) this.emit({ type: 'captured', id, blob: result });
    else this.emit({ type: 'error', reason: 'capture-failed', fatal: false });
  }

  private startSpeedTest(id: number): void {
    if (!this.ready || this.speedTest || this.speedTestWaitingId !== null) return;
    this.speedTestWaitingId = id;
    this.requestTick();
  }

  /**
   * Starts the speed test that was asked for, once the after-first-view parts are on screen. They
   * only appear on idle frames and the test draws every frame, so started sooner it would run
   * without them and time a lighter scene than visitors see.
   */
  private startWaitingSpeedTest(): void {
    if (this.speedTestWaitingId === null || !this.deferredSettled()) return;
    this.speedTest = {
      id: this.speedTestWaitingId, startMs: 0, lastMs: 0, deltas: [], swapFrames: [], labels: [], nextSwapMs: SPEED_TEST_SWAP_EVERY_MS, swaps: 0,
      selection: { ...this.current }, original: { ...this.current },
    };
    this.speedTestWaitingId = null;
    this.orbit!.hold();
  }

  /** 6 s of spinning, with a swap through the options every 500 ms (knob, plate style, pattern in turn). */
  private speedTestTick(t: number): void {
    const run: SpeedTestRun = this.speedTest!;
    if (!run.startMs) {
      run.startMs = run.lastMs = t;
      return;
    }
    run.deltas.push(t - run.lastMs);
    run.lastMs = t;
    this.orbit!.drag((-SPEED_TEST_TURN_RAD_PER_FRAME * this.heightCss) / (2 * Math.PI), 0, this.heightCss, t);
    this.orbit!.hold();
    const elapsed: number = t - run.startMs;
    if (elapsed > run.nextSwapMs) {
      const options = this.product!.options;
      const option = options[run.swaps % options.length];
      const index: number = option.values.findIndex(v => v.name === run.selection[option.name]);
      const value: string = option.values[(index + 1) % option.values.length].name;
      run.selection = { ...run.selection, [option.name]: value };
      run.swaps++;
      this.request(run.selection, false);
      run.swapFrames.push(run.deltas.length); // the next delta measures the swap frame
      run.labels.push(`${option.name}: ${value}`);
      run.nextSwapMs += SPEED_TEST_SWAP_EVERY_MS;
    }
    if (elapsed > SPEED_TEST_MS) {
      this.speedTest = null;
      this.emit({ type: 'speedTestResult', id: run.id, result: this.summarise(run) });
      this.request(run.original, false);
    }
  }

  private summarise(run: SpeedTestRun): SpeedTestResult {
    const sorted: number[] = [...run.deltas].sort((a, b) => a - b);
    const swapMs: number[] = run.swapFrames.map(i => run.deltas[i] ?? 0);
    return {
      frames: run.deltas.length,
      avgFps: 1000 / (run.deltas.reduce((a, b) => a + b, 0) / Math.max(1, run.deltas.length)),
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      maxMs: sorted[sorted.length - 1] ?? 0,
      over33Ms: run.deltas.filter(d => d > SLOW_FRAME_MS).length,
      worstSwapMs: Math.max(0, ...swapMs),
      slowSwaps: swapMs.flatMap((ms, n) => (ms > SLOW_FRAME_MS ? [`${ms.toFixed(1)} ms → ${run.labels[n]}`] : [])),
    };
  }

  private debugInfo(): DebugInfo {
    const r: WebGLRenderer | null = this.renderer;
    return {
      programs: r?.info.programs?.length ?? 0,
      textures: r?.info.memory.textures ?? 0,
      level: this.governor.level,
      renderPath: this.renderPath,
      displayMs: this.displayInterval.estimateMs,
      azimuthRad: this.orbit?.azimuth ?? null,
    };
  }

  private gpuName(): string {
    const gl: WebGL2RenderingContext = this.renderer!.getContext() as WebGL2RenderingContext;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  }

  private emitStats(): void {
    const r: WebGLRenderer | null = this.renderer;
    if (!r || this.contextLost) return;
    const size: Vector2 = r.getDrawingBufferSize(new Vector2());
    const frames: number[] = this.recentFrameMs.splice(0);
    const avg: number = frames.length ? frames.reduce((a, b) => a + b, 0) / frames.length : 0;
    const glbBytes: number = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter(e => e.name.includes('.glb'))
      .reduce((sum, e) => sum + (e.encodedBodySize || e.decodedBodySize || 0), 0);
    const level: QualityLevel = this.governor.level;
    const displayMs: number | null = this.displayInterval.estimateMs;
    this.emit({
      type: 'stats',
      text: [
        `gpu        ${this.gpuName()}`,
        `render     ${this.renderPath} thread · ${level.tier} tier · dpr cap ${level.dprCap}`,
        `display    ${displayMs === null ? 'not measured yet' : `${displayMs.toFixed(1)} ms between refreshes (${(1000 / displayMs).toFixed(0)} Hz)`}`,
        `canvas     ${size.x}×${size.y} px (${r.getPixelRatio()}× of ${this.dpr})`,
        `draws      ${r.info.render.calls} · ${r.info.render.triangles.toLocaleString()} triangles`,
        `frames     ${frames.length ? `${frames.length} back-to-back last second, avg ${avg.toFixed(1)} ms, max ${Math.max(...frames).toFixed(1)} ms` : 'idle'}`,
        `3D files   ${(glbBytes / 1024).toFixed(0)} KB downloaded`,
        `first view ${this.firstViewMs.toFixed(0)} ms after init`,
      ].join('\n'),
    });
  }

  // ---------- context loss ----------

  private loseContext(): void {
    if (!this.renderer || this.contextLost) return;
    this.simulatedLoss = true;
    this.renderer.forceContextLoss();
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    if (this.simulatedLoss) {
      this.simulatedLoss = false;
      setTimeout(() => this.renderer?.forceContextRestore(), 50);
    }
  };

  /** Three.js re-creates its GL state; the environment map (a render target) is redrawn, then everything is warmed again. */
  private readonly onContextRestored = (): void => {
    void (async (): Promise<void> => {
      if (!this.renderer || !this.product || !this.ready) {
        this.contextLost = false;
        return;
      }
      this.installStudio(this.renderer);
      for (const texture of this.allTextures()) texture.needsUpdate = true;
      for (const state of this.models.values()) state.warmed = false;
      this.contextLost = false;
      this.applySize();
      await this.warmAll();
      this.render();
      this.frameIntervals.reset();
      this.displayInterval.reset();
      this.emit({ type: 'restored' });
      // The re-warm may have warmed after-first-view parts that were still hidden.
      if (this.deferredAwaitingReveal()) {
        this.revealPending = true;
        this.requestTick();
      }
    })();
  };
}
