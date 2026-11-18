# mini3d viewer v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 embeddable 3D viewer for the OB1 shifter, deployed as static files on Cloudflare. It has these parts:
- a STEP → web-bundle converter;
- the `<mini3d-viewer>` widget and its `loader.js`;
- a standalone picker page;
- still images;
- a lean set of tests.

**Architecture:** One TypeScript repository with no UI framework.
- A Node command-line tool reads a product's settings file and converts its STEP files into a versioned static bundle: settings, compressed GLBs and stills.
- A Three.js viewer, packaged as a custom element, loads that bundle through a tiny loader. It renders on a worker thread, with a main-thread fallback.
- The v1 page drives the viewer only through its public interface.
- Everything is served as static files from Cloudflare Workers Static Assets.

**Tech Stack:**
- TypeScript. Node 26 runs the tool scripts directly, with no build step.
- Vite.
- Three.js 0.187.0 on WebGL2.
- occt-import-js 0.0.23.
- glTF-Transform 4.5.1 with meshoptimizer 1.3.0.
- Vitest, Playwright and Wrangler.

**Spec:** `docs/superpowers/specs/2026-11-17-mini3d-viewer-v1-design.md`. Read it first.
- Measured numbers are in `docs/research/2026-11-17-reference-configurators.md`.
- `spikes/carbon-look/` is throwaway reference code. Port from it; don't import it.

## Global Constraints

**Toolchain**
- Node ≥ 26. Tool scripts are `.ts` files run with `node`, so they may use erasable TypeScript syntax only: no enums, namespaces or parameter properties. tsconfig sets `erasableSyntaxOnly`, and imports carry `.ts` extensions.
- Exact dependency pins (`npm install --save-exact`):
  - `three@0.187.0`
  - `occt-import-js@0.0.23`
  - `@gltf-transform/core|functions|extensions@4.5.1`
  - `meshoptimizer@1.3.0`
- The viewer's only runtime dependency is `three`, including its own addons (GLTFLoader, meshopt decoder). No UI framework anywhere.

**Code style**
- Use explicit types on exported functions, class members and non-obvious locals. Favour readability over cleverness (user preference).
- No "oldboy" in identifiers, file names, CSS tokens or paths. Store option names inside product data are fine.

**Files and git**
- **The user reviews the code and commits it themselves.** Leave all changes in the working tree, and end each task by summarising what changed.
- **The user created the git repository and its `.gitignore`.** Don't recreate them. These paths must stay out of git: `node_modules/`, `assets/source/` (source CAD), `public/bundles/`, `public/products/`, `dist/`, `test-results/`, `playwright-report/`, `.wrangler/`. If a task creates one the `.gitignore` doesn't cover yet, add that entry and mention it in the hand-over.

**Rendering**
- WebGL2 is required. Without it the viewer shows stills and keeps following picks.
- The render pixel ratio is capped at 1.5, and the quality governor may lower it.
- **No material ever uses anisotropy.** The fibre-sheen and clear-coat combination fell to 12 fps on a battery-throttled iGPU.
- **Warm-up means:** `compileAsync` all materials, then `initTexture` all textures, then draw every material × every geometry once into a 1-pixel scissor of the real canvas. Compiling alone left a 92 ms swap on the iPhone; with the warm-up draw the worst swap was 18 ms.
- Draw only when something changes. Pause off-screen and in hidden tabs.

**Speed targets** (spec §4)
- No frame over 33.4 ms (more than two refreshes at 60 Hz).
- Plugged in, the speed test averages ≥ 58 fps.
- On battery, after the governor settles, it averages ≥ 50 fps.
- A swap shows on the next frame.
- First spin within about 2 s on typical 4G, and within 5 s on slow 4G (1.6 Mbps down, 150 ms round trip).
- Bundle growth over 10% against the stored baseline is flagged.

**Product data**
- Store option names and value order are exact (spec §7.2):

  | Option | Values, in order |
  |---|---|
  | `Shift Knob` | `Aluminum \| Gunmetal`, `Aluminum \| Silver`, `Aluminum \| Blue`, `Carbon Weave \| Teardrop`, `Carbon Weave \| Round`, `Carbon Forged \| Teardrop`, `Carbon Forged \| Round` |
  | `Shift Plate Style` | `Carbon Weave`, `Forged Carbon`, `Anodized Grey Aluminium` |
  | `Shift Pattern` | `6+R Down`, `6+R Up`, `7+R` |

**Tests**
- A few dozen in total. No pixel-diff screenshot tests; the look is judged by eye on real devices.

## Review Focus

The five failure modes no ordinary test exercises that are most likely to bite, most likely first:

| # | Condition | Expected behaviour | Pinned in |
|---|---|---|---|
| 1 | Rapid picks, faster than parts load | The viewer ends on the **last** pick, with no flash of intermediate configurations. | Task 7 (`SwapScheduler`), Task 12 |
| 2 | An unknown option or value from the page | An `error` event (not fatal), with the current configuration kept. | Task 1 (`normaliseSelection`), Task 12 |
| 3 | The viewer hidden at 0×0, then shown, or the phone rotated | No crash, no drawing at zero size, and the camera refits once sized. | Task 12 |
| 4 | A part fails to download (offline or 404) | The old part stays, a non-fatal `error` is raised, and other picks still work. | Task 12 |
| 5 | The WebGL context is lost (iPhone backgrounding) | It restores, rebuilds and redraws, then raises `restored`. | Task 12 |

**Not built in v1** (the schema version leaves room for them):
- optional or repeated slots, and adjustable placements;
- the single-file claude.ai build (Cloudflare hosting replaces it);
- the Shopify connector.

## File Map

| Path | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `vite.config.ts`, `wrangler.jsonc` | Toolchain |
| `products/ob1/product.json` | OB1 settings file (source of truth, kept in git) |
| `products/ob1/size-baseline.json` | Size baseline (kept in git) |
| `src/schema/product.ts` | Settings-file types, including `BuiltProduct` |
| `src/schema/validate.ts` | `validateProduct`, `ProductError` |
| `src/schema/configurations.ts` | Selections: list, key, normalise, resolve |
| `src/convert/occt.ts` | STEP → bodies (mm) |
| `src/convert/geometry.ts` | Axis normalisation, face rules |
| `src/convert/glb.ts` | Body → compressed GLB |
| `src/convert/bundle.ts` | Body mapping, versioning, bundle writing, size baseline |
| `src/convert/cli.ts` | `npm run convert` |
| `src/convert/stills.ts`, `src/convert/stills-cli.ts` | Still rendering (`npm run stills`) |
| `src/viewer/protocol.ts` | Engine message types and shared result types |
| `src/viewer/render/assembly.ts` | Slot tree → world matrices |
| `src/viewer/render/orbit.ts` | Camera controller (pure, worker-safe) |
| `src/viewer/render/textures.ts` | Procedural weave and forged textures (OffscreenCanvas / ImageData only) |
| `src/viewer/render/materials.ts` | Finishes → materials, triplanar mapping |
| `src/viewer/render/studio.ts` | Environment, reflection card, contact shadow |
| `src/viewer/render/scheduler.ts` | `LoadPlanner`, `SwapScheduler` |
| `src/viewer/render/governor.ts` | `QualityGovernor` |
| `src/viewer/render/warmup.ts` | Warm-up draw |
| `src/viewer/render/engine.ts` | `Engine`: everything that touches WebGL |
| `src/viewer/render/worker.ts` | Worker entry |
| `src/viewer/host.ts` | Worker host with main-thread fallback |
| `src/viewer/products.ts` | Product ID → bundle URL (the only place paths are built) |
| `src/viewer/element.ts` | `<mini3d-viewer>` |
| `src/viewer/stats.ts` | Stats panel and speed-test button |
| `src/viewer/loader.ts` | `loader.js` |
| `index.html`, `src/site/main.ts`, `src/site/picker.ts`, `src/site/style.css` | The v1 page |
| `src/site/engine-dev.html`, `src/site/capture.html` | Dev harness and still capture page |
| `public/_headers` | Cache rules |
| `tests/unit/*.test.ts` | Vitest |
| `tests/e2e/smoke.spec.ts` | Playwright |

## Milestones

| Milestone | Tasks | Result |
|---|---|---|
| M1 | Tasks 1–3 | `npm run convert -- products/ob1` writes the OB1 bundle. |
| M2 | Tasks 4–10 | The OB1 spins in `<mini3d-viewer>` from `loader.js`, on a worker. |
| M3 | Tasks 11–14 | The v1 page, stills, smoke tests, deployment and device sign-off. |

---

### Task 1: Toolchain, product schema and the OB1 settings file

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/schema/product.ts`, `src/schema/validate.ts`, `src/schema/configurations.ts`, `products/ob1/product.json`
- Test: `tests/unit/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`src/schema/product.ts`):
  ```ts
  export type Vec3 = [number, number, number];
  export interface Placement { positionMm: Vec3; rotationDeg?: Vec3 }            // XYZ Euler, degrees
  interface ModelBase { attachPointMm?: Vec3; sockets?: Record<string, Placement> }
  export interface FaceRule { kind: 'dropNearAxis'; maxRadiusMm: number; maxHeightMm: number } // axis = model Y
  export type ModelDef = ModelBase & (
    | { kind: 'converted'; source: string; bodyIndex: number; faceRules?: FaceRule[] }
    | { kind: 'box'; sizeMm: Vec3 }                      // origin: bottom centre
    | { kind: 'cylinder'; radiusMm: number; heightMm: number } // origin: bottom centre
    | { kind: 'sphere'; radiusMm: number });             // origin: centre
  export interface SourceDef { file: string; units: 'mm' | 'm' | 'in'; upAxis: 'y' | 'z'; bodyCount: number; dropBodies?: number[] }
  export type FinishDef =
    | { kind: 'carbonWeave'; towMm: number }
    | { kind: 'forgedCarbon'; tileMm: number }
    | { kind: 'metal'; color: string; roughness: number }
    | { kind: 'matte'; color: string; roughness: number };
  export interface SlotDef { id: string; parent?: string; socket?: string; placement?: 'socket' | 'asInCad'; model: string; finish: string }
  export interface SlotSetting { slot: string; model?: string; finish?: string }
  export interface OptionValue { name: string; sets: SlotSetting[]; swatch?: { css: string } }
  export interface OptionGroup { name: string; values: OptionValue[] }
  export type Selection = Record<string, string>;                               // option name → value name
  export interface Framing { azimuthDeg: number; polarDeg: number; maxPolarDeg: number; minZoom: number; maxZoom: number; fovDeg: number }
  export interface Product { schemaVersion: 1; id: string; name: string; sources: Record<string, SourceDef>; models: Record<string, ModelDef>;
    finishes: Record<string, FinishDef>; slots: SlotDef[]; options: OptionGroup[]; defaultSelection: Selection; framing: Framing }
  export interface ModelFiles { default: string; light: string }                // relative to product.json
  export interface BuiltProduct extends Product { version: string; files: Record<string, ModelFiles>; stills: { pattern: string; sizePx: number } }
  export type ResolvedConfiguration = Record<string, { model: string; finish: string }>; // slot id → model + finish
  ```
- Produces (`src/schema/validate.ts`):
  - `class ProductError extends Error { path: string }`
  - `validateProduct(input: unknown): Product`
- Produces (`src/schema/configurations.ts`):
  - `listConfigurations(p: Product): Selection[]`
  - `configurationKey(p: Product, s: Selection): string`. The value indices joined by `-`, in option order.
  - `normaliseSelection(p: Product, requested: Partial<Selection>, current: Selection): Selection`. Throws `ProductError` with `path` set to the option name.
  - `resolveConfiguration(p: Product, s: Selection): ResolvedConfiguration`

- [ ] **Step 1: Set up the toolchain.** The git repository already exists; the user created it.
  - `package.json`: `"type": "module"`, `"private": true`, `"engines": {"node": ">=26"}`. Scripts:
    - `convert`: `node src/convert/cli.ts`
    - `stills`: `node src/convert/stills-cli.ts`
    - `dev`: `vite`
    - `build`: `vite build`
    - `preview`: `vite preview --port 4173 --strictPort`
    - `test`: `vitest run`
    - `test:e2e`: `playwright test`
    - `typecheck`: `tsc --noEmit`
    - `deploy`: `npm run build && wrangler deploy`
  - Install the exact pins (Global Constraints) plus dev dependencies: `typescript`, `vite`, `vitest`, `@playwright/test`, `wrangler`, `@types/three@0.187.x`, `@types/node`.
  - `tsconfig.json`: `strict`, `target` ES2023, `module` preserve, `moduleResolution` bundler, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noEmit`, `lib` ES2023 + DOM + DOM.Iterable.

- [ ] **Step 2: Write `products/ob1/product.json`** from these values.

  **Sources** (paths relative to the repo root):

  | Key | File | Settings |
  |---|---|---|
  | `knob-round` | `assets/source/SHIFT_KNOB_ROUND (M12x1.25)_REV2 (1).STEP` | `bodyCount` 1 |
  | `knob-senna` | `assets/source/SHIFT_KNOB_SENNA (M12x1.25)_REV2 (2).STEP` | `bodyCount` 1 |
  | `plate-6r-down` | `assets/source/OB1-SHPL_6RDOWN_AL_REV5.STEP` | `bodyCount` 2 |
  | `plate-6r-up` | `assets/source/OB1-SHPL_6RUP_AL_REV5.STEP` | `bodyCount` 2 |
  | `plate-7r` | `assets/source/OB1-SHPL-7R_AL_REV5.STEP` | `bodyCount` 2 |

  All five are `units: "mm"`, `upAxis: "y"`.

  **Models:**

  | Model | Definition |
  |---|---|
  | `body` | box `[90,100,90]`; sockets `plateMount {positionMm:[0,100,0]}`, `stickPivot {positionMm:[0,100,0]}` |
  | `rod` | cylinder radius 6, height 81; socket `tip {positionMm:[0,81,0]}`. That puts the knob 78 mm above the plate top, provisional until the body file arrives. |
  | `knob-round`, `knob-senna` | converted, `bodyIndex` 0, `faceRules: [{kind:"dropNearAxis", maxRadiusMm:6.3, maxHeightMm:17}]` |
  | `knob-ball` | sphere radius 22, `attachPointMm [0,-18,0]` |
  | `plate-6r-down`, `plate-6r-up`, `plate-7r` | converted, `bodyIndex` 1, from the matching source |
  | `grommet-6r-down`, `grommet-6r-up`, `grommet-7r` | converted, `bodyIndex` 0, from the matching source |

  The plate and grommet `bodyIndex` values for 6+R Up and 7+R are provisional; Task 3 Step 3 checks them.

  **Finishes:**

  | Finish | Definition |
  |---|---|
  | `carbonWeave` | `{towMm 2.4}` |
  | `forgedCarbon` | `{tileMm 50}` |
  | `anodizedGrey` | metal `#8d9096`, roughness 0.45. Placeholder until the user's photo arrives. |
  | `gunmetal` | metal `#8c9097`, 0.18 |
  | `silver` | metal `#d2d6da`, 0.18 |
  | `blue` | metal `#2f62c9`, 0.28 |
  | `tpuGrey` | matte `#2b2b2d`, 0.85 |
  | `bodyBlack` | metal `#141414`, 0.55 |
  | `steel` | metal `#dddddd`, 0.12 |

  **Slots:**

  | Slot | Parent and placement | Default model | Default finish |
  |---|---|---|---|
  | `body` | (root) | `body` | `bodyBlack` |
  | `plate` | `body`, socket `plateMount` | `plate-6r-down` | `carbonWeave` |
  | `grommet` | `plate`, `asInCad` | `grommet-6r-down` | `tpuGrey` |
  | `rod` | `body`, socket `stickPivot` | `rod` | `steel` |
  | `knob` | `rod`, socket `tip` | `knob-round` | `carbonWeave` |

  **Options** (names and order exact, from Global Constraints):

  | Value | Sets |
  |---|---|
  | Aluminum \| Gunmetal / Silver / Blue | knob → `knob-ball` + `gunmetal` / `silver` / `blue` |
  | Carbon Weave \| Teardrop | knob → `knob-senna` + `carbonWeave` |
  | Carbon Weave \| Round | knob → `knob-round` + `carbonWeave` |
  | Carbon Forged \| Teardrop | knob → `knob-senna` + `forgedCarbon` |
  | Carbon Forged \| Round | knob → `knob-round` + `forgedCarbon` |
  | Shift Plate Style values | the plate finish: `carbonWeave` / `forgedCarbon` / `anodizedGrey` |
  | Each Shift Pattern value | the plate model and grommet model for that pattern |

  **Swatch CSS:**

  | Swatch | CSS |
  |---|---|
  | gunmetal | `radial-gradient(circle at 35% 30%,#9a9fa5,#3b3e42 55%,#1d1f21)` |
  | silver | `radial-gradient(circle at 35% 30%,#fff,#b9bec3 50%,#6d7378)` |
  | blue | `radial-gradient(circle at 35% 30%,#9cc2ff,#2f62c9 55%,#173270)` |
  | weave | `repeating-conic-gradient(#181818 0 25%,#3d3d3d 0 50%) 0 0/4px 4px` |
  | forged | `radial-gradient(circle at 30% 30%,#5a5a5a 0 13%,transparent 14%),radial-gradient(circle at 70% 58%,#4a4a4a 0 16%,transparent 17%),#1c1c1c` |
  | anodized | `linear-gradient(135deg,#a3a6ab,#6f7378)` |

  Pattern values have no swatch.

  **Default selection:** `Carbon Weave | Round` / `Carbon Weave` / `6+R Down`.

  **Framing:** `{azimuthDeg 35, polarDeg 71, maxPolarDeg 83, minZoom 0.35, maxZoom 1.6, fovDeg 30}`.

- [ ] **Step 3: Write the failing tests** in `tests/unit/schema.test.ts`:
  ```ts
  const ob1 = (): unknown => JSON.parse(readFileSync('products/ob1/product.json', 'utf8'));
  test('OB1 settings file validates', () => {
    const p = validateProduct(ob1());
    expect(p.options.map(o => o.values.length)).toEqual([7, 3, 3]);
  });
  test('lists 63 configurations with unique keys', () => {
    const p = validateProduct(ob1());
    const keys = listConfigurations(p).map(s => configurationKey(p, s));
    expect(keys).toHaveLength(63);
    expect(new Set(keys).size).toBe(63);
    expect(configurationKey(p, p.defaultSelection)).toBe('4-0-0');
  });
  test('resolves a selection to slot models and finishes', () => {
    const p = validateProduct(ob1());
    const r = resolveConfiguration(p, { 'Shift Knob': 'Carbon Forged | Teardrop', 'Shift Plate Style': 'Anodized Grey Aluminium', 'Shift Pattern': '7+R' });
    expect(r.knob).toEqual({ model: 'knob-senna', finish: 'forgedCarbon' });
    expect(r.plate).toEqual({ model: 'plate-7r', finish: 'anodizedGrey' });
    expect(r.grommet).toEqual({ model: 'grommet-7r', finish: 'tpuGrey' });
    expect(r.rod).toEqual({ model: 'rod', finish: 'steel' });
  });
  test.each([
    ['unknown finish on a slot', (p: any) => { p.slots[0].finish = 'nope'; }, 'slots[0].finish'],
    ['missing parent slot', (p: any) => { p.slots[1].parent = 'nope'; }, 'slots[1].parent'],
    ['parent cycle', (p: any) => { p.slots[0].parent = 'knob'; p.slots[0].socket = 'x'; }, 'slots'],
    ['option sets an unknown slot', (p: any) => { p.options[0].values[0].sets[0].slot = 'nope'; }, 'options[0].values[0].sets[0].slot'],
    ['socket missing on a parent model', (p: any) => { p.slots[1].socket = 'nope'; }, 'slots[1].socket'],
    ['converted model with unknown source', (p: any) => { p.models['knob-round'].source = 'nope'; }, 'models.knob-round.source'],
  ])('rejects a broken file: %s', (_n, breakIt, path) => {
    const p = ob1() as any; breakIt(p);
    try { validateProduct(p); throw new Error('accepted'); } catch (e) { expect(e).toBeInstanceOf(ProductError); expect((e as ProductError).path).toBe(path); }
  });
  test('normaliseSelection merges a partial pick and rejects unknown values', () => {
    const p = validateProduct(ob1());
    expect(normaliseSelection(p, { 'Shift Pattern': '7+R' }, p.defaultSelection)).toEqual({ ...p.defaultSelection, 'Shift Pattern': '7+R' });
    expect(() => normaliseSelection(p, { 'Shift Pattern': '8+R' }, p.defaultSelection)).toThrow(ProductError);
    expect(() => normaliseSelection(p, { 'Gear Lever': 'x' }, p.defaultSelection)).toThrow(ProductError);
  });
  ```

- [ ] **Step 4: Run the tests.** `npm test` → FAIL (modules missing).

- [ ] **Step 5: Implement the three schema modules.**
  - `validateProduct` checks structure and every cross-reference. It checks the slot tree (unknown parents, then cycles) **before** sockets, so a cycle reports the path `slots`. For each slot, the socket must exist on **every** model the parent slot can hold: its default model plus every model an option can set on it.
  - It throws `ProductError` carrying the dotted path shown in the tests.

- [ ] **Step 6: Run the checks.** `npm test` → PASS (10 tests). `npm run typecheck` → no errors.

- [ ] **Step 7: Hand over for review.** Summarise the changed files for the user.

---

### Task 2: STEP reading, face rules and GLB writing

**Files:**
- Create: `src/convert/occt.ts`, `src/convert/geometry.ts`, `src/convert/glb.ts`
- Test: `tests/unit/convert.test.ts`

**Interfaces:**
- Consumes: `FaceRule`, `SourceDef` (Task 1).
- Produces:
  ```ts
  export interface FaceRange { first: number; last: number }   // triangle indices, inclusive
  export interface StepBody { index: number; name: string; positions: Float32Array; normals: Float32Array; indices: Uint32Array; faces: FaceRange[] } // source units
  export interface TessellationLevel { linearRatio: number; angularRad: number }
  export const TESSELLATION_LEVELS: { default: TessellationLevel; light: TessellationLevel }; // {0.001, 0.35}, {0.002, 0.5}
  export function readStepBodies(path: string, level: TessellationLevel): Promise<StepBody[]>;              // occt.ts
  export function normaliseAxes(body: StepBody, upAxis: 'y' | 'z'): StepBody;                              // geometry.ts; z-up: rotate −90° about X
  export function applyFaceRules(body: StepBody, rules: FaceRule[]): { body: StepBody; droppedTriangles: number }; // geometry.ts; mm, model Y axis
  export function writeGlb(body: StepBody, metresPerUnit: number): Promise<Uint8Array>;                    // glb.ts
  ```

- [ ] **Step 1: Write the failing tests.** The real-file tests get a 60 s timeout.
  ```ts
  test('reads both bodies of the 6+R Down plate file', async () => {
    const bodies = await readStepBodies('assets/source/OB1-SHPL_6RDOWN_AL_REV5.STEP', TESSELLATION_LEVELS.default);
    expect(bodies).toHaveLength(2);
    expect(bodies.map(sizeMm).some(([x, y, z]) => near(x, 90, 0.1) && near(y, 3, 0.1) && near(z, 90, 0.1))).toBe(true);
  });
  test.each(['SHIFT_KNOB_ROUND (M12x1.25)_REV2 (1).STEP', 'SHIFT_KNOB_SENNA (M12x1.25)_REV2 (2).STEP'])('removes the M12 thread from %s', async (f) => {
    const [raw] = await readStepBodies(`assets/source/${f}`, TESSELLATION_LEVELS.default);
    const { body, droppedTriangles } = applyFaceRules(normaliseAxes(raw, 'y'), [{ kind: 'dropNearAxis', maxRadiusMm: 6.3, maxHeightMm: 17 }]);
    expect(droppedTriangles).toBeGreaterThan(0.15 * raw.indices.length / 3);
    expect(body.faces.every(face => !(faceMaxRadius(body, face) < 6.3 && faceMaxY(body, face) < 17))).toBe(true);
    expect(sizeMm(body)[1]).toBeCloseTo(sizeMm(raw)[1], 1);
  });
  test('writes a compact GLB that reads back in metres', async () => {
    const [raw] = await readStepBodies('assets/source/SHIFT_KNOB_ROUND (M12x1.25)_REV2 (1).STEP', TESSELLATION_LEVELS.default);
    const glb = await writeGlb(applyFaceRules(normaliseAxes(raw, 'y'), [{ kind: 'dropNearAxis', maxRadiusMm: 6.3, maxHeightMm: 17 }]).body, 0.001);
    expect(glb.byteLength).toBeLessThan(120_000);
    expect(maxYOfGlb(glb)).toBeCloseTo(0.050, 3); // read back with NodeIO + meshopt decoder
  });
  test('z-up sources are rotated to y-up', () => {
    const [x, y, z] = normaliseAxes(syntheticBody([[0, 0, 10]]), 'z').positions;
    expect(x).toBeCloseTo(0, 9); expect(y).toBeCloseTo(10, 9); expect(z).toBeCloseTo(0, 9);
  });
  ```
  The helpers (`sizeMm`, `near`, `faceMaxRadius`, `faceMaxY`, `maxYOfGlb`, `syntheticBody`) live in the test file.

- [ ] **Step 2: Run the tests.** `npm test -- convert` → FAIL.

- [ ] **Step 3: Implement.** Port `spikes/carbon-look/occt.mts` and the face logic in `convert.mts`.
  - `writeGlb` scales positions to metres, then runs `weld()`, `quantize({quantizePosition: 14, quantizeNormal: 10})` and `meshopt({encoder: MeshoptEncoder, level: 'high'})`.
  - **No UVs:** finishes use triplanar mapping (Task 6).
  - Register `EXTMeshoptCompression` and `KHRMeshQuantization`.

- [ ] **Step 4: Run the tests.** `npm test -- convert` → PASS (5 tests).

- [ ] **Step 5: Hand over for review.** Summarise the changed files for the user.

---

### Task 3: Bundle writer, size baseline and `npm run convert`

**Files:**
- Create: `src/convert/bundle.ts`, `src/convert/cli.ts`, `products/ob1/size-baseline.json` (generated)
- Modify: `products/ob1/product.json` (body indices)
- Test: `tests/unit/bundle.test.ts`

**Interfaces:**
- Consumes: Task 1 types and `configurationKey`; Task 2 functions.
- Produces:
  ```ts
  export class ConvertError extends Error {}
  export interface SizeReport { version: string; brotliBytes: Record<string, number>; totalBrotliBytes: number } // per model id, default level
  export function checkBodyMapping(sourceKey: string, bodies: { index: number; sizeMm: Vec3 }[], expectedCount: number, referenced: number[], dropped: number[]): void;
  export function computeVersion(settingsJson: string, glbs: Array<[modelId: string, bytes: Uint8Array]>): string; // first 12 hex of sha256, model ids sorted
  export function compareWithBaseline(report: SizeReport, baseline: SizeReport | null): { deltaRatio: number; flagged: boolean }; // flagged when > 0.10
  export function convertProduct(productDir: string, publicDir: string): Promise<SizeReport>;
  ```
- What `convertProduct` writes:
  - `public/bundles/<id>/<version>/product.json` as a `BuiltProduct`, with `files[model] = {default: 'parts/<model>.glb', light: 'parts/<model>.light.glb'}` and `stills = {pattern: 'stills/{key}.webp', sizePx: 1000}`.
  - The GLBs, under `parts/`.
  - `public/products/<id>.json`, containing `{ version, bundle: 'bundles/<id>/<version>/', defaultStill: 'bundles/<id>/<version>/stills/<defaultKey>.webp' }`.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  test('same inputs give the same version', () => {
    const a = computeVersion('{"x":1}', [['b', new Uint8Array([2])], ['a', new Uint8Array([1])]]);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(computeVersion('{"x":1}', [['a', new Uint8Array([1])], ['b', new Uint8Array([2])]])).toBe(a);
    expect(computeVersion('{"x":2}', [['a', new Uint8Array([1])], ['b', new Uint8Array([2])]])).not.toBe(a);
  });
  test('flags growth over 10%', () => {
    const r = (t: number): SizeReport => ({ version: 'v', brotliBytes: {}, totalBrotliBytes: t });
    expect(compareWithBaseline(r(1110), r(1000)).flagged).toBe(true);
    expect(compareWithBaseline(r(1090), r(1000)).flagged).toBe(false);
    expect(compareWithBaseline(r(5000), null).flagged).toBe(false);
  });
  test('a body the settings file does not mention fails the build', () => {
    expect(() => checkBodyMapping('plate-6r-down', [{ index: 0, sizeMm: [63, 3, 55] }, { index: 1, sizeMm: [90, 3, 90] }], 2, [0], []))
      .toThrow(/plate-6r-down.*body 1.*90 × 3 × 90/);
    expect(() => checkBodyMapping('knob-round', [{ index: 0, sizeMm: [50, 50, 50] }], 2, [0], [])).toThrow(/expected 2 bodies, found 1/);
  });
  ```

- [ ] **Step 2: Run the tests.** `npm test -- bundle` → FAIL.

- [ ] **Step 3: Implement `bundle.ts` and `cli.ts`.**
  - Usage: `npm run convert -- products/ob1 [--inspect] [--update-baseline]`.
  - `--inspect` prints every body of every source (index, name, size in mm), then exits.
  - A normal run reads each source once per tessellation level, maps the bodies, applies the face rules, and writes both levels and the bundle. It then prints a table (model, triangles, dropped triangles, brotli KB) and the total with its delta against `size-baseline.json`.
  - It exits 1 when the total is flagged, unless `--update-baseline` is given, which rewrites the baseline file.

- [ ] **Step 4: Run the tests.** `npm test -- bundle` → PASS (3 tests).

- [ ] **Step 5: Check the body indices against the real files.**
  - Run `npm run convert -- products/ob1 --inspect`.
  - In each plate file, the plate is the body measuring 90.0 × 3.0 × 90.0 mm, and the grommet is the other one.
  - Set `bodyIndex` for `plate-6r-up`, `grommet-6r-up`, `plate-7r` and `grommet-7r` to match. The 6+R Down file has the grommet at 0 and the plate at 1.

- [ ] **Step 6: Run the converter for real.**
  - Run `npm run convert -- products/ob1 --update-baseline`.
  - Expected: 8 converted models; `knob-round` around 11.6k triangles with about 24% dropped; a total of roughly 250 KB brotli for all models at the default level. The first view needs only one knob, one plate and one grommet: about 100 KB.
  - It writes `public/bundles/ob1/<version>/` and `public/products/ob1.json`.
  - Run it again without `--update-baseline`: same version, delta 0%, exit 0.

- [ ] **Step 7: Hand over for review.** Summarise the changed files for the user.

---

### Task 4: Assembly resolution

**Files:**
- Create: `src/viewer/render/assembly.ts`
- Test: `tests/unit/assembly.test.ts`

**Interfaces:**
- Consumes: `Product`, `ResolvedConfiguration`, `Placement`, `ModelDef` (Task 1).
- Produces:
  - `placementMatrix(p: Placement): Matrix4`. Millimetres → metres; XYZ Euler in degrees.
  - `resolveAssembly(p: Product, resolved: ResolvedConfiguration): Map<string, Matrix4>`. Slot id → world matrix, with parents before children.
  - The rule:
    - root: `world = identity`
    - `socket`: `world(child) = world(parent) × placementMatrix(parentModel.sockets[socket]) × translation(−attachPoint(childModel))`
    - `asInCad`: `world(child) = world(parent)`

- [ ] **Step 1: Write the failing tests.**
  ```ts
  test('the knob sits on the rod tip above the body', () => {
    const m = resolveAssembly(ob1, resolveConfiguration(ob1, ob1.defaultSelection));
    expect(new Vector3().setFromMatrixPosition(m.get('knob')!).y).toBeCloseTo(0.181, 6);
  });
  test('the ball stand-in attaches by its attach point', () => {
    const m = resolveAssembly(ob1, resolveConfiguration(ob1, { ...ob1.defaultSelection, 'Shift Knob': 'Aluminum | Gunmetal' }));
    expect(new Vector3().setFromMatrixPosition(m.get('knob')!).y).toBeCloseTo(0.199, 6);
  });
  test('as-in-CAD children share the parent frame', () => {
    const m = resolveAssembly(ob1, resolveConfiguration(ob1, ob1.defaultSelection));
    expect(m.get('grommet')!.equals(m.get('plate')!)).toBe(true);
  });
  test('a rotated socket rotates and moves its children', () => {
    // synthetic product: root box with socket {positionMm:[10,0,0], rotationDeg:[0,0,90]}, child sphere on it
    const childY = new Vector3(0, 1, 0).transformDirection(resolveAssembly(rotated, resolveConfiguration(rotated, rotated.defaultSelection)).get('child')!);
    expect(childY.x).toBeCloseTo(-1, 6);
  });
  test('swapping a parent model re-attaches its children', () => {
    // synthetic product: option swaps body between plateMount y=100 and y=150
    expect(yOf('plate', short)).toBeCloseTo(0.100, 6);
    expect(yOf('plate', tall)).toBeCloseTo(0.150, 6);
  });
  ```
  `ob1` is loaded with `validateProduct`. The synthetic products are built in the test file.

- [ ] **Step 2: Run the tests.** `npm test -- assembly` → FAIL.

- [ ] **Step 3: Implement `assembly.ts`.**

- [ ] **Step 4: Run the tests.** `npm test -- assembly` → PASS (5 tests).

- [ ] **Step 5: Hand over for review.** Summarise the changed files for the user.

---

### Task 5: Orbit controller

**Files:**
- Create: `src/viewer/render/orbit.ts`
- Test: `tests/unit/orbit.test.ts`

**Interfaces:**
- Consumes: `Framing` (Task 1).
- Produces:
  ```ts
  export function fitDistance(fovDeg: number, aspect: number, bounds: Box3, margin?: number): number; // margin default 1.18
  export class OrbitController {
    constructor(framing: Framing);
    fit(boxWidthPx: number, boxHeightPx: number, bounds: Box3): void; // resets target to bounds centre and distance to the fit
    drag(dxPx: number, dyPx: number, boxHeightPx: number): void;     // 2π radians per box height
    release(): void;                                                  // starts coasting
    zoom(factor: number, ndcX: number, ndcY: number): void;           // >1 zooms in, towards the cursor
    step(dtMs: number): boolean;                                      // advances coasting; true if the camera moved
    apply(camera: PerspectiveCamera): void;
    readonly azimuth: number; readonly polar: number; readonly distance: number; readonly fitDistance: number;
  }
  ```
- Behaviour:
  - **Coasting** keeps the last drag velocity. It decays by a factor of (1 − 0.08) per 16.7 ms and stops below 0.0005 rad per frame.
  - **Polar angle** is clamped to [5°, `maxPolarDeg`].
  - **Distance** is clamped to [`minZoom`, `maxZoom`] × the fit distance.
  - **Zoom towards the cursor** moves the target towards the point under the cursor, on the plane through the target facing the camera, by (1 − 1/factor) of the offset. The target stays clamped inside the bounds box.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  const bounds = new Box3(new Vector3(-0.045, -0.003, -0.045), new Vector3(0.045, 0.225, 0.045));
  test('a tall product sits farther away in a portrait box', () => {
    expect(fitDistance(30, 390 / 422, bounds)).toBeGreaterThan(fitDistance(30, 1.5, bounds));
  });
  test('a drag of a quarter box height turns a quarter circle', () => {
    const o = new OrbitController(framing); o.fit(800, 600, bounds); const a0 = o.azimuth;
    o.drag(150, 0, 600); expect(o.azimuth - a0).toBeCloseTo(-Math.PI / 2, 9);
  });
  test('coasting after release slows to a stop', () => {
    const o = new OrbitController(framing); o.fit(800, 600, bounds); o.drag(20, 0, 600); o.release();
    expect(o.step(16.7)).toBe(true);
    let n = 0; while (o.step(16.7) && n < 1000) n++;
    expect(n).toBeLessThan(300);
  });
  test('cannot orbit past maxPolarDeg', () => {
    const o = new OrbitController(framing); o.fit(800, 600, bounds); o.drag(0, 5000, 600);
    expect(o.polar).toBeLessThanOrEqual(MathUtils.degToRad(83) + 1e-9);
  });
  test('zoom stays within its limits', () => {
    const o = new OrbitController(framing); o.fit(800, 600, bounds);
    o.zoom(100, 0, 0); expect(o.distance).toBeCloseTo(0.35 * o.fitDistance, 9);
    o.zoom(0.0001, 0, 0); expect(o.distance).toBeCloseTo(1.6 * o.fitDistance, 9);
  });
  ```

- [ ] **Step 2: Run the tests.** `npm test -- orbit` → FAIL.

- [ ] **Step 3: Implement `orbit.ts`.** Pure math with no DOM, so the worker can use it.

- [ ] **Step 4: Run the tests.** `npm test -- orbit` → PASS (5 tests).

- [ ] **Step 5: Hand over for review.** Summarise the changed files for the user.

---

### Task 6: Look: textures, finishes and studio

**Files:**
- Create: `src/viewer/render/textures.ts`, `src/viewer/render/materials.ts`, `src/viewer/render/studio.ts`
- Test: `tests/unit/materials.test.ts`

**Interfaces:**
- Consumes: `Product`, `FinishDef` (Task 1).
- Produces:
  ```ts
  export interface FinishTextures { weaveAlbedo: Texture; weaveNormal: Texture; weaveRoughness: Texture; forgedAlbedo: Texture; forgedRoughness: Texture }
  export function makeFinishTextures(): FinishTextures;                         // textures.ts; ImageData / OffscreenCanvas only, seeded, repeat-wrapped, mipmapped
  export type QualityTier = 'full' | 'lean';                                    // re-exported from protocol.ts in Task 7
  export function createMaterials(p: Product, t: FinishTextures, tier: QualityTier): Map<string, Material>; // keyed by finish id
  export function applyTriplanar(m: MeshPhysicalMaterial, tilesPerMetre: number, maps: { albedo: Texture; roughness: Texture; normal?: Texture }): void;
  export interface Studio { environment: Texture; shadow: Mesh; keyLight: DirectionalLight }
  export function createStudio(renderer: WebGLRenderer, bodyFootprintM: number): Studio;
  ```

- [ ] **Step 1: Write the failing tests.** These run in Node with stub `Texture`s.
  ```ts
  test('every OB1 finish gets a material in both tiers', () => {
    for (const tier of ['full', 'lean'] as const) {
      const mats = createMaterials(ob1, stubTextures(), tier);
      expect([...mats.keys()].sort()).toEqual(Object.keys(ob1.finishes).sort());
      const weave = mats.get('carbonWeave') as MeshPhysicalMaterial;
      expect(weave.clearcoat).toBe(tier === 'full' ? 1 : 0);
    }
  });
  test('no material ever uses anisotropy', () => {
    for (const tier of ['full', 'lean'] as const)
      for (const m of createMaterials(ob1, stubTextures(), tier).values()) expect((m as MeshPhysicalMaterial).anisotropy ?? 0).toBe(0);
  });
  ```

- [ ] **Step 2: Run the tests.** `npm test -- materials` → FAIL.

- [ ] **Step 3: Implement the textures.** Port `makeWeave` / `makeForged` from `spikes/carbon-look/public/textures.js`, with these changes:
  - **No anisotropy maps.**
  - The weave height field becomes `weaveNormal` (strength 3.0). Warp and weft get different roughness (0.26 vs 0.36), so the tows glint differently as the shifter turns. That's the cheap stand-in for fibre sheen.
  - The forged texture is **512²** (down from 1024²). Feather the chip edges: draw each chip once 1.5 px larger at 35% alpha, then its core.
  - Use `OffscreenCanvas`, never `document`, so the same code runs in the worker.

- [ ] **Step 4: Implement the materials.**
  - Carbon finishes are `MeshPhysicalMaterial` with world-space triplanar sampling via `onBeforeCompile`:
    - It replaces `#include <map_fragment>`, `#include <roughnessmap_fragment>` and, for the weave in the full tier only, `#include <normal_fragment_maps>`.
    - Blend weights are `pow(abs(worldNormal), 4)`, normalised. Normals use a whiteout blend.
    - Set `customProgramCacheKey` per finish and tier.
    - `tilesPerMetre` = 1000 / (towMm × 4) for the weave (one tile holds 4 tows), and 1000 / `tileMm` for forged.
  - In the full tier, carbon gets clear coat 1 and clear-coat roughness 0.04. In the lean tier, carbon has no clear coat and no normal map.
  - `metal` → `MeshPhysicalMaterial` with metalness 1.
  - `matte` → `MeshStandardMaterial` with metalness 0.

- [ ] **Step 5: Implement the studio.** Port `makeStudio` and `makeShadow` from `spikes/carbon-look/public/spike.js`:
  - Environment intensity 1.6.
  - Add a **reflection card**: an 8 × 3 plane at (0, 1.0, 4.8) facing the origin, power 2.0.
  - Key light: intensity 0.8 at (−0.4, 0.6, 0.5).
  - The contact shadow is drawn once, 2.2 × the body footprint.
  - The renderer uses `NeutralToneMapping` at exposure 1.15; Task 7 sets it.

- [ ] **Step 6: Run the tests.** `npm test -- materials` → PASS (2 tests).

- [ ] **Step 7: Hand over for review.** Summarise the changed files for the user.

---

### Task 7: Engine: loading, warm-up, swaps, governor, speed test

**Files:**
- Create: `src/viewer/protocol.ts`, `src/viewer/render/scheduler.ts`, `src/viewer/render/governor.ts`, `src/viewer/render/warmup.ts`, `src/viewer/render/engine.ts`, `src/site/engine-dev.html`, `src/site/engine-dev.ts`
- Test: `tests/unit/scheduler.test.ts`, `tests/unit/governor.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4, 5 and 6.
- Produces (`protocol.ts`):
  ```ts
  export type { QualityTier } from './render/materials.ts';   // defined in Task 6
  export interface QualityLevel { tier: QualityTier; dprCap: number }
  export interface SpeedTestResult { frames: number; avgFps: number; p50Ms: number; p95Ms: number; maxMs: number; over33Ms: number; worstSwapMs: number; slowSwaps: string[] }
  export interface DebugInfo { programs: number; textures: number; level: QualityLevel; renderPath: 'worker' | 'main' }
  export type ToEngine =
    | { type: 'init'; productUrl: string; selection: Selection | null; widthCss: number; heightCss: number; dpr: number; stats: boolean; canvas?: OffscreenCanvas }
    | { type: 'resize'; widthCss: number; heightCss: number; dpr: number }
    | { type: 'pointer'; kind: 'down' | 'move' | 'up' | 'cancel'; id: number; x: number; y: number }   // CSS px within the box
    | { type: 'wheel'; deltaY: number; x: number; y: number }
    | { type: 'configure'; selection: Selection }
    | { type: 'visible'; visible: boolean }
    | { type: 'capture'; id: number; sizePx: number }
    | { type: 'speedTest'; id: number } | { type: 'debug'; id: number } | { type: 'loseContext' };
  export type FromEngine =
    | { type: 'product'; product: BuiltProduct } | { type: 'progress'; loaded: number; total: number; phase: 'current' | 'background' }
    | { type: 'ready' } | { type: 'configured'; selection: Selection } | { type: 'restored' }
    | { type: 'error'; reason: string; fatal: boolean }
    | { type: 'captured'; id: number; blob: Blob } | { type: 'speedTestResult'; id: number; result: SpeedTestResult }
    | { type: 'debugInfo'; id: number; info: DebugInfo } | { type: 'stats'; text: string };
  ```
- Produces (`scheduler.ts`, `governor.ts`, `warmup.ts`, `engine.ts`):
  ```ts
  export class LoadPlanner { constructor(p: Product); order(current: Selection): string[] }  // converted model ids only
  export class SwapScheduler { request(s: Selection): void; next(isReady: (modelId: string) => boolean): Selection | null; get pending(): Selection | null }
  export const QUALITY_LEVELS: QualityLevel[]; // [{full,1.5},{lean,1.5},{lean,1.0},{lean,0.75}]
  export class QualityGovernor { record(frameMs: number, nowMs: number): QualityLevel | null; get level(): QualityLevel }
  export function warmUp(r: WebGLRenderer, camera: Camera, materials: Material[], geometries: BufferGeometry[]): Promise<void>;
  export class Engine { constructor(canvas: HTMLCanvasElement | OffscreenCanvas, emit: (m: FromEngine) => void, renderPath: 'worker' | 'main'); handle(m: ToEngine): void }
  ```

**LoadPlanner order:**
1. The current configuration's converted models, in slot order.
2. The models of the configurations one change away: Shift Knob values first, then Plate Style, then Pattern, each in value order.
3. Every remaining model.

No model appears twice.

**QualityGovernor rule:**
- Only frames rendered back to back count.
- **Step down** when, over the last 60 such frames, the median exceeds 18 ms or two frames exceed 33.4 ms. Clear the history after any step.
- **Probe one level up** after 10 s with no trigger.
- If a trigger comes within 2 s of a probe, step back down and don't probe again for 60 s.
- The engine switches its material tier when the level's tier changes and the pixel ratio when its cap changes, and loads `light` GLBs for parts still to load once at level index 2 or above.

**Engine behaviour**, in order:
1. Fetch and validate `product.json`. If it's invalid, emit `error` with `fatal: true`.
2. Emit `product`.
3. Load the current configuration's parts, emitting `progress` with phase `current`.
4. Build the materials for **both** tiers and the assembly, fit the orbit controller, then `warmUp` with every material of both tiers. A governor step then never compiles a shader at runtime.
5. Draw the first frame and emit `ready`.
6. Background-load in `LoadPlanner` order, one model at a time, with phase `background`. Warm each new geometry with all materials, at most one per idle frame.
7. Picks go through `SwapScheduler`, so the latest wins. A pick whose parts aren't ready keeps the current parts. When a part fails: retry once, then emit `error` with `fatal: false` and reason `model-load-failed: <id>`, and drop that pick.
8. Draw on demand. Frame pacing follows `requestAnimationFrame` with no 60 fps cap, so 120 Hz screens get 120. Feed frame intervals to the governor while frames run back to back.
9. On `visible:false`, stop requesting frames.
10. On `webglcontextlost`, `preventDefault`. On `webglcontextrestored`, rebuild the textures and materials, re-upload, warm up, redraw and emit `restored`.
11. `capture` renders one frame at `sizePx`² with a transparent background and returns WebP at quality 0.8 (`convertToBlob` / `toBlob`).
12. `speedTest` ports the spike's benchmark: 6 s of spinning, with a swap through the knob, plate and pattern values every 500 ms, returning `SpeedTestResult`.
13. With `stats` on, emit a `stats` text line every second, and answer `debug` with `renderer.info.programs.length` and `renderer.info.memory.textures`.

**Renderer settings:** WebGL2; antialias; alpha; `NeutralToneMapping` at exposure 1.15; `setPixelRatio(min(dpr, level.dprCap))`.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  test('latest request wins when picks arrive faster than parts load', () => {
    const s = new SwapScheduler(); s.request(A); s.request(B); s.request(C);
    expect(s.next(() => false)).toBeNull();
    expect(s.next(() => true)).toEqual(C);
    expect(s.pending).toBeNull();
  });
  test('current models load first, then one-change-away models, each once', () => {
    const order = new LoadPlanner(ob1).order(ob1.defaultSelection);
    expect(order.slice(0, 3)).toEqual(['plate-6r-down', 'grommet-6r-down', 'knob-round']);
    expect(order[3]).toBe('knob-senna');
    expect(new Set(order).size).toBe(order.length);
    expect(order).toHaveLength(8);
  });
  test('steps down after slow frames and probes back up after a quiet spell', () => {
    const g = new QualityGovernor(); let t = 0;
    for (let i = 0; i < 60; i++) g.record(40, (t += 40));
    expect(g.level).toEqual(QUALITY_LEVELS[1]);
    for (let i = 0; i < 700; i++) g.record(16.7, (t += 16.7));
    expect(g.level).toEqual(QUALITY_LEVELS[0]);
  });
  test('a single dropped frame does not change quality', () => {
    const g = new QualityGovernor(); let t = 0;
    for (let i = 0; i < 59; i++) g.record(16.7, (t += 16.7));
    g.record(33.3, (t += 33.3));
    expect(g.level).toEqual(QUALITY_LEVELS[0]);
  });
  ```
  The `slice(0, 3)` order follows slot order: plate, grommet, knob.

- [ ] **Step 2: Run the tests.** `npm test -- scheduler governor` → FAIL.

- [ ] **Step 3: Implement `scheduler.ts`, `governor.ts` and `warmup.ts`.** Then run `npm test -- scheduler governor` → PASS (4 tests).

- [ ] **Step 4: Implement `engine.ts`** with the behaviour above.
  - Primitive geometries: box and cylinder use a bottom-centre origin, the sphere a centre origin, with 64 segments.
  - Load GLBs with `GLTFLoader` + `MeshoptDecoder`.
  - Pinch: two active pointers turn their distance change into `zoom(factor)` about their midpoint.

- [ ] **Step 5: Build the dev harness.** `src/site/engine-dev.html` + `engine-dev.ts`:
  - a full-window canvas;
  - an `Engine` on the main thread at `/bundles/ob1/<version>/product.json`, read from `/products/ob1.json`;
  - buttons that cycle each option;
  - a "Speed test" button that prints the result.

- [ ] **Step 6: Check it by eye** with `npm run dev`, then `/src/site/engine-dev.html`:
  - The weave on both knobs shows **no blocky seams**.
  - The anodized plate reads as satin grey metal.
  - The gunmetal ball reads as grey metal, not black.
  - The grommet is dark matte grey.
  - The camera fits the whole shifter.
  - The console is clean.

  Then the speed test, plugged in: average ≥ 58 fps, max ≤ 33.4 ms, no slow swaps.

  Then on battery, after a first run lets the governor settle: average ≥ 50 fps and max ≤ 33.4 ms.

- [ ] **Step 7: User checkpoint.** Show the user screenshots of the weave, forged, anodized and gunmetal finishes, plus the speed-test results. Apply their look corrections before moving on.

- [ ] **Step 8: Hand over for review.** Summarise the changed files for the user.

---

### Task 8: `<mini3d-viewer>` on the main thread

**Files:**
- Create: `src/viewer/element.ts`, `src/viewer/host.ts`, `src/viewer/stats.ts`, `src/viewer/products.ts`
- Test: `tests/unit/products.test.ts`

**Interfaces:**
- Consumes: `Engine`, the protocol (Task 7); `normaliseSelection`, `configurationKey` (Task 1).
- Produces:
  ```ts
  export function resolveProductUrl(id: string, origin: string): Promise<{ productUrl: string; defaultStillUrl: string }>; // products.ts — fetches `${origin}/products/${id}.json`
  export interface EngineHost { send(m: ToEngine, transfer?: Transferable[]): void; readonly path: 'worker' | 'main'; dispose(): void }
  export function createEngineHost(container: HTMLElement, onMessage: (m: FromEngine) => void): Promise<EngineHost>; // main thread only in this task
  export class Mini3dViewer extends HTMLElement {           // customElements.define('mini3d-viewer', Mini3dViewer)
    static observedAttributes: string[];                      // ['product', 'stats']
    get product(): BuiltProduct | null; get configuration(): Selection;
    setConfiguration(partial: Partial<Selection>): void;
    captureStill(sizePx: number): Promise<Blob>;
    runSpeedTest(): Promise<SpeedTestResult>;
    debugInfo(): Promise<DebugInfo>;        // rejects unless the stats attribute is present
    debugLoseContext(): void;               // no-op unless the stats attribute is present
  }
  // Events (CustomEvent, bubbles + composed): productload {product}, progress {loaded,total,phase}, ready, configurationchange {selection}, error {reason,fatal}, restored
  ```

**Element behaviour:**
- **Shadow root:** `<img class="still">` (`object-fit: contain`), a `<canvas>`, a "Drag to spin" hint and, with `stats`, the stats panel with a "Run speed test" button.
- **The still** shows at once from `defaultStillUrl`. Its `src` follows `configurationKey` on every pick until `ready`, and it crossfades out over 200 ms on `ready`.
- **Origin:** taken from the `data-origin` attribute if set; otherwise the loader passes it (Task 10). Fallback: `location.origin`.
- **Starting:**
  - Start when an `IntersectionObserver` with rootMargin `200px` fires.
  - `ResizeObserver` sends `resize`, ignoring 0×0. The engine isn't initialised until the box has a non-zero size.
  - `document.visibilitychange` and intersection changes send `visible`.
- **Input:** pointer events with `setPointerCapture`, and `touch-action: none` on the canvas. Wheel listens with `passive: false` and calls `preventDefault`.
- **Picks:** `setConfiguration` runs through `normaliseSelection`. A `ProductError` emits `error` with `fatal: false` and reason `invalid-selection: <option>`, and the configuration is unchanged.
- **No WebGL2:** detected by trying `getContext('webgl2')` on a scratch canvas. Emit `error` with `fatal: true` and reason `webgl2-unavailable`, and keep following picks with stills only.

- [ ] **Step 1: Write the failing test.**
  ```ts
  test('resolves a product id through its pointer file', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ version: 'abc123', bundle: 'bundles/ob1/abc123/', defaultStill: 'bundles/ob1/abc123/stills/4-0-0.webp' })));
    expect(await resolveProductUrl('ob1', 'https://x.test')).toEqual({ productUrl: 'https://x.test/bundles/ob1/abc123/product.json', defaultStillUrl: 'https://x.test/bundles/ob1/abc123/stills/4-0-0.webp' });
    expect(fetch).toHaveBeenCalledWith('https://x.test/products/ob1.json');
  });
  ```

- [ ] **Step 2: Run the test.** `npm test -- products` → FAIL. Implement `products.ts`, then `npm test -- products` → PASS.

- [ ] **Step 3: Implement `host.ts`, `element.ts` and `stats.ts`** with the behaviour above.

- [ ] **Step 4: Check it by eye.**
  - Add `src/site/element-dev.html` containing `<mini3d-viewer product="ob1" stats style="display:block;aspect-ratio:3/2">` and a module script that imports `element.ts`.
  - Check:
    - The still appears before the 3D, then crossfades out.
    - Drag, coasting, wheel and pinch work (pinch via Chrome DevTools touch emulation).
    - `setConfiguration` from the console swaps on the next frame.
    - The stats panel's speed test works.

- [ ] **Step 5: Hand over for review.** Summarise the changed files for the user.

---

### Task 9: Worker rendering with main-thread fallback

**Files:**
- Create: `src/viewer/render/worker.ts`
- Modify: `src/viewer/host.ts`

**Interfaces:**
- Consumes: `Engine`, `ToEngine`, `FromEngine` (Task 7); `createEngineHost` (Task 8).
- Produces: the same `createEngineHost` signature, now trying the worker first. `EngineHost.path` reports which path won.

**Host logic:**
1. If `HTMLCanvasElement.prototype.transferControlToOffscreen` exists, and the URL has no `render=main` flag:
   - `transferControlToOffscreen()`;
   - `new Worker(new URL('./render/worker.ts', import.meta.url), { type: 'module' })`;
   - send `init` with `canvas` in the transfer list.
2. If the worker emits `error` with reason `webgl2-unavailable` (no WebGL2 on an OffscreenCanvas): terminate the worker, replace the canvas element with a fresh one, and construct `Engine` on the main thread.
3. Otherwise go straight to the main thread.

`worker.ts` constructs `new Engine(msg.canvas, m => postMessage(m), 'worker')` on `init` and forwards every later message to `handle`.

- [ ] **Step 1: Implement the worker and the host fallback.**

- [ ] **Step 2: Check it by eye** on the element dev page with `stats`:
  - The stats panel reports `worker` in Chrome and Firefox.
  - With `?render=main` it reports `main`.
  - The speed test passes the plugged-in thresholds on both paths.
  - Picks, capture and the speed test work on both.

- [ ] **Step 3: Hand over for review.** Summarise the changed files for the user.

---

### Task 10: `loader.js`, build output and cache rules

**Files:**
- Create: `src/viewer/loader.ts`, `vite.config.ts`, `public/_headers`, `wrangler.jsonc`

**Interfaces:**
- Consumes: `resolveProductUrl` (Task 8); `element.ts` (dynamic import).
- Produces:
  - `dist/v1/loader.js`, with an unhashed name;
  - hashed `dist/v1/assets/*`;
  - `dist/products/*.json` and `dist/bundles/**`, copied from `public/`.

**Loader behaviour:**
1. Find the `mini3d-viewer` elements, now and later through a `MutationObserver`.
2. For each one, fetch the pointer file and set the still as the element's `background-image` (`contain`, centred), so a still shows even before the viewer code arrives.
3. Set `data-origin` from `new URL(import.meta.url).origin`.
4. On the first element within 200 px of the viewport, `import('./element.ts')`. It defines `mini3d-viewer`, and the existing elements upgrade.

**Build and hosting configuration:**
- **`vite.config.ts`:** a multi-page build with inputs `index.html`, `src/site/capture.html` and `src/viewer/loader.ts`:
  - `entryFileNames`: `v1/loader.js` for the loader and `v1/assets/[name]-[hash].js` for everything else;
  - `chunkFileNames` / `assetFileNames`: `v1/assets/[name]-[hash][extname]`;
  - `worker.format`: `'es'`.
- **`public/_headers`:**
  ```
  /v1/loader.js
    Cache-Control: public, max-age=300
  /v1/assets/*
    Cache-Control: public, max-age=31536000, immutable
  /products/*
    Cache-Control: public, max-age=60
  /bundles/*
    Cache-Control: public, max-age=31536000, immutable
  ```
  The four path patterns never overlap. That matters because Cloudflare joins the values when two rules set the same header.
- **`wrangler.jsonc`:** `{ "name": "mini3d", "compatibility_date": "2026-11-01", "assets": { "directory": "./dist" } }`. No Worker script.

- [ ] **Step 1: Implement the loader and the configuration files.**

- [ ] **Step 2: Build and check the output.** Run `npm run build`, then confirm:
  - `ls dist/v1/loader.js dist/v1/assets dist/products/ob1.json dist/_headers` all exist;
  - `gzip -c dist/v1/loader.js | wc -c` < 2048;
  - the brotli size of all viewer JS and worker chunks is about 140 KB (the spike) and flagged if over 200 KB.

- [ ] **Step 3: Hand over for review.** Summarise the changed files for the user.

---

### Task 11: The v1 page

**Files:**
- Create: `index.html`, `src/site/main.ts`, `src/site/picker.ts`, `src/site/style.css`

**Interfaces:**
- Consumes: the `Mini3dViewer` public API and events (Task 8); `loader.js` (Task 10).
- Produces: `renderPicker(container: HTMLElement, product: BuiltProduct, selection: Selection, onPick: (option: string, value: string) => void): void`.

**`index.html`:**
- The embed snippet (`<mini3d-viewer product="ob1">` plus `<script type="module" src="/src/viewer/loader.ts">`, which Vite rewrites to `/v1/loader.js`).
- A panel with the title "OB1 H-Pattern Sim Shifter", the picker and a "Your build" summary.
- `main.ts` adds the `stats` attribute when the page URL has `?stats`.

**`main.ts`:**
- On `productload`, render the picker from `viewer.product`.
- On a pick, call `viewer.setConfiguration`.
- On `configurationchange`, update the picker state and the summary.
- It uses only the public API.

**Picker:** one group per option, with values in settings order.
- Buttons use `aria-pressed`, with the swatch CSS as a 22 px chip.
- Pattern values are text buttons.
- Focus is visible.

**Layout, `style.css`** (tokens: `--page-bg #4b4b4b`, `--panel-bg #3f3f40`, `--text #fff`, `--muted rgba(255,255,255,.66)`, `--accent #ffee00`, `--on-accent #252525`):
- **Desktop (≥ 761 px):** a grid with the viewer on the left and a 360 px panel on the right, `height: 100svh`.
- **Phone (≤ 760 px):** rows `50svh 1fr`. The viewer fills the top half and never scrolls away; the panel scrolls (`overflow-y: auto`).
- Side gutters are at least 16 px. No price, cart or store link.

- [ ] **Step 1: Implement the page.**

- [ ] **Step 2: Check it by eye** with `npm run dev`:
  - Desktop, and a phone-width screenshot (`google-chrome --headless=new --window-size=390,844 --screenshot ...`): no horizontal scroll; the 3D is in the top half on the phone.
  - Every swatch changes the 3D on the next frame, and the summary follows.
  - `?stats` shows the panel.

- [ ] **Step 3: Hand over for review.** Summarise the changed files for the user.

---

### Task 12: Stills, browser smoke tests and the Review Focus cases

**Files:**
- Create: `src/site/capture.html`, `src/convert/stills.ts`, `src/convert/stills-cli.ts`, `playwright.config.ts`
- Test: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: `listConfigurations`, `configurationKey` (Task 1); `captureStill` and the events (Task 8); the build (Task 10).
- Produces: `renderStills(productId: string, publicDir: string): Promise<{ count: number; totalBytes: number }>`. Each still is written to `public/bundles/<id>/<version>/stills/<key>.webp`.

**Stills:**
- `capture.html` holds one `<mini3d-viewer product="…">` at 1000 × 1000 CSS px, with the product taken from the query string.
- `renderStills` starts Vite's dev server (`createServer`) and opens the page in Playwright Chromium (device scale factor 1).
- For every configuration it runs `setConfiguration`, waits for `configurationchange`, then `captureStill(1000)`, and writes the file.
- `npm run stills -- ob1` prints the count and the total KB.

**Playwright:**
- `webServer` is `npm run build && npm run preview`, with base URL `http://localhost:4173`.
- Projects: `chromium`, `firefox`, `webkit`.
- If WebKit's system dependencies aren't available on Fedora, run that project in the official container:
  ```
  podman run --rm --network host -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v<installed @playwright/test version>-noble npx playwright test --project=webkit
  ```
- Every test fails on any `pageerror` or `console.error`.
- An `addInitScript` records every viewer event (they bubble and are `composed`) into `window.__events` from page start, so no event is missed.
- Helpers in the spec file:

  | Helper | What it does |
  |---|---|
  | `waitFor(page, name)` | polls `__events` for a new event of that name |
  | `pick(page, option, value)` | clicks the picker button |
  | `debugInfo(page)` / `configuration(page)` | call the element API |
  | `dragAcross(page, px, steps)` | a mouse drag over the viewer |
  | `nextError(page)` | the next `error` detail |
  | `setAndCatchError(page, sel)` | calls `setConfiguration`, returns the next `error` detail |
  | `waitForSettled(page)` | all `configurationchange` selections, once 1 s passes with no new one |
  | `waitForBackgroundLoad(page)` / `waitForCurrentPartsLoaded(page)` | wait until `progress` of that phase has `loaded === total` |
  | `canvasSize(page)` | the shadow-root canvas's `getBoundingClientRect()` |
  | `lastCriticalResponseEndMs(page)` | the latest `responseEnd` among the loader, viewer chunks, `product.json` and the current GLBs |

- `SWAPS` = `[['Shift Knob','Carbon Forged | Teardrop'], ['Shift Plate Style','Anodized Grey Aluminium'], ['Shift Pattern','7+R'], ['Shift Knob','Aluminum | Blue'], ['Shift Plate Style','Forged Carbon'], ['Shift Pattern','6+R Up']]`. `DEFAULT` is the OB1 default selection.

- [ ] **Step 1: Implement and run the stills.** Implement `capture.html`, `stills.ts` and `stills-cli.ts`, then run `npm run stills -- ob1`. Expected: `63 stills`, with a total under 4 MB.

- [ ] **Step 2: Check the stills by eye.** Open three random stills, then load the v1 page with DevTools throttling on "Slow 4G": the still shows at once and the 3D takes over with a crossfade.

- [ ] **Step 3: Write the smoke tests** in `tests/e2e/smoke.spec.ts`:
  ```ts
  test('loads, spins and swaps without new shaders or textures', async ({ page, browserName }) => {
    await page.goto('/?stats'); await waitFor(page, 'ready');
    await waitForBackgroundLoad(page);                       // progress phase 'background' reaches total
    const before = await debugInfo(page);
    await dragAcross(page, 300, 20);
    for (const [o, v] of SWAPS) { await pick(page, o, v); await waitFor(page, 'configurationchange'); }  // 6 picks across all options
    const after = await debugInfo(page);
    expect(after.programs).toBe(before.programs);
    expect(after.textures).toBe(before.textures);
    if (browserName !== 'webkit') expect(after.renderPath).toBe('worker');
  });
  test('rapid picks end on the last pick', async ({ page }) => {      // Review Focus 1
    await page.goto('/?stats'); await waitFor(page, 'ready');
    await page.evaluate(() => { const v = document.querySelector('mini3d-viewer') as any;
      v.setConfiguration({ 'Shift Pattern': '6+R Up' }); v.setConfiguration({ 'Shift Pattern': '7+R' }); v.setConfiguration({ 'Shift Pattern': '6+R Down' }); });
    const changes = await waitForSettled(page);
    expect(changes.every(s => s['Shift Pattern'] === '6+R Down')).toBe(true);   // no intermediate flash
  });
  test('rejects an unknown option value and keeps the current build', async ({ page }) => {  // Review Focus 2
    await page.goto('/'); await waitFor(page, 'ready');
    const err = await setAndCatchError(page, { 'Shift Pattern': '8+R' });
    expect(err).toEqual({ reason: 'invalid-selection: Shift Pattern', fatal: false });
    expect(await configuration(page)).toEqual(DEFAULT);
  });
  test('shows the viewer after being hidden, then rotated', async ({ page }) => {     // Review Focus 3
    await page.route('/', async route => {
      const res = await route.fetch();
      const html = (await res.text()).replace('</head>', '<style id="hide">mini3d-viewer{display:none}</style></head>');
      await route.fulfill({ response: res, body: html });
    });
    await page.goto('/'); await page.waitForTimeout(1000);
    await page.evaluate(() => document.getElementById('hide')!.remove());
    await waitFor(page, 'ready');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(300);
    expect((await canvasSize(page)).width).toBeGreaterThan(0);
  });
  test('keeps working when a part fails to download', async ({ page }) => {           // Review Focus 4
    await page.route('**/parts/knob-senna*.glb', r => r.abort());
    await page.goto('/'); await waitFor(page, 'ready');
    await pick(page, 'Shift Knob', 'Carbon Weave | Teardrop');
    expect(await nextError(page)).toEqual(expect.objectContaining({ fatal: false, reason: expect.stringContaining('knob-senna') }));
    expect((await configuration(page))['Shift Knob']).toBe('Carbon Weave | Round');
    await pick(page, 'Shift Knob', 'Carbon Forged | Round'); await waitFor(page, 'configurationchange');
  });
  test('recovers from a lost graphics context', async ({ page }) => {                 // Review Focus 5
    await page.goto('/?stats'); await waitFor(page, 'ready');
    await page.evaluate(() => (document.querySelector('mini3d-viewer') as any).debugLoseContext());
    await waitFor(page, 'restored');
    await pick(page, 'Shift Plate Style', 'Forged Carbon'); await waitFor(page, 'configurationchange');
  });
  test('first parts arrive within 5 s on slow 4G', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'network emulation is Chromium-only');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 93_750 });
    await page.goto('/'); await waitForCurrentPartsLoaded(page);                     // progress phase 'current' reaches total
    expect(await lastCriticalResponseEndMs(page)).toBeLessThan(5000);               // loader, viewer chunks, product.json, current GLBs
  });
  ```
- [ ] **Step 4: Run the tests.** `npm run test:e2e`. Expected: 7 tests × 3 projects pass, with the slow-4G test skipped on Firefox and WebKit. Fix the code, not the tests, for any failure that reflects the Review Focus behaviour.

- [ ] **Step 5: Hand over for review.** Summarise the changed files for the user.

---

### Task 13: Deploy to Cloudflare

**Files:**
- Modify: `README.md` (the build and deploy commands, plus the product build order: `convert`, then `stills`, then `build`)

- [ ] **Step 1: Log in.** Ask the user to run `! npx wrangler login` once, in the session.

- [ ] **Step 2: Deploy.** Run `npm run convert -- products/ob1 && npm run stills -- ob1 && npm run deploy`. Expected: Wrangler prints a `https://mini3d.<account>.workers.dev` URL.

- [ ] **Step 3: Check the cache headers.** Run `curl -sI` against the live URL. Expected:
  - `/v1/loader.js` → `max-age=300`
  - one `/v1/assets/…js` → `immutable`
  - `/products/ob1.json` → `max-age=60`
  - `/bundles/ob1/<v>/parts/knob-round.glb` → `immutable`

  Also record whether the `.glb` comes back with `content-encoding: br` for `Accept-Encoding: br`. Either result is acceptable; write it down.

- [ ] **Step 4: Hand over for review.** Summarise the changed files for the user.

---

### Task 14: Real-device sign-off

**Files:**
- Modify: `docs/research/2026-11-17-reference-configurators.md`. Append a "v1 sign-off" section with a results table.

- [ ] **Step 1: Laptop.**
  - Chrome on the live URL with `?stats`, plugged in: the speed test averages ≥ 58 fps, max ≤ 33.4 ms, no slow swaps.
  - Firefox, the same thresholds. The user runs this one.
  - On battery: one speed test to let the governor settle, then another averaging ≥ 50 fps with max ≤ 33.4 ms.

- [ ] **Step 2: iPhone 12 Pro.** The user runs these on the live URL with `?stats`:
  - the speed test, with the same plugged-in thresholds;
  - a cold start: force-quit Safari, open the URL, and record the first-view time;
  - on mobile data (4G), first spin within about 2 s.

- [ ] **Step 3: Record and fix.** Record every number. Any miss goes back to the owning task, gets fixed, and is re-run before sign-off.

- [ ] **Step 4: Hand over for review.** Summarise the changed files for the user.
