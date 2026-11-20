# Assembly Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the OB1 stand-ins with the real shifter, internals included, by teaching the converter to read one CAD assembly and the viewer to show parts that arrive after the first view.

**Architecture:**
- **Converter.** It reads a STEP file's assembly tree once at a coarse tolerance to learn its structure and part sizes. It then re-reads at each part's own tolerance bucket, so every part gets today's quality relative to its own size.
- **Settings.** Models pick parts by CAD name, body position or instance location. Every body must be claimed exactly once.
- **Geometry.** Merged models can be simplified to an error limit in millimetres.
- **Viewer.** Slots marked `afterFirstView` stop gating the first view and swaps. They appear on the frame after their part is warmed.
- **Studio.** The shadow and floor come from the real product's bounds.

**Tech Stack:** TypeScript on Node 26, occt-import-js 0.0.23, glTF-Transform 4.5.1, meshoptimizer 1.3.0 (`MeshoptSimplifier`), Three.js 0.187.0, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-19-assembly-import-design.md`. Read it first, together with the v1 spec it builds on, `docs/superpowers/specs/2026-11-17-mini3d-viewer-v1-design.md`.

## Global Constraints

**Code**
- Node ≥ 26. Tool scripts are `.ts` run directly by `node`, so use erasable syntax only (no enums, namespaces or parameter properties). Imports carry `.ts` extensions.
- Explicit types on exported functions, class members and non-obvious locals. Favour readability over cleverness.
- No new dependencies. Versions stay pinned as they are.
- **Product and CAD part names stay out of `src/`.** They belong in `products/ob1/product.json` and in tests about the real files. No "oldboy" in identifiers.
- `schemaVersion` becomes `2`.

**Files and git**
- **The user reviews and commits by hand.** Never commit or push. Each task ends with a hand-over summary of what changed.
- CAD files live in `assets/source/`, which is git-ignored. Never commit them.

**Speed targets** (v1 spec §4, unchanged)
- No frame over 33.4 ms while spinning or swapping.
- Plugged in, the speed test averages ≥ 58 fps.
- On battery, after the governor settles, it averages ≥ 50 fps.
- First spin about 2 s after load on typical 4G, and within 5 s on Lighthouse's slow 4G.
- No swap hitch.

**Hard stops: ask the user first**
- **Deploying publishes.** Confirm with the user right before `npm run deploy`. Never run `wrangler whoami`.
- **Fixing brotli for `.glb` files** needs the user's go-ahead.
- **Resetting the size baseline** waits until the user has seen the new size table.

**Browser checks**
- Use the Linux Chrome only. If more than one browser is connected, check with `list_connected_browsers` and pick the Linux one.
- Before trusting any fps number, make sure the laptop is plugged in (`cat /sys/class/power_supply/*/status`) and the Chrome window is in front.

## Review Focus

1. **Picks made while after-first-view parts are still downloading** must swap without waiting for them, and the last pick wins. *(Task 5, e2e)*
2. **An after-first-view part that fails to download** gives a non-fatal error naming it, and everything else keeps working. *(Task 5, e2e)*
3. **A lost graphics context while after-first-view parts are still hidden:** they still appear once loaded. *(Task 5, e2e)*
4. **Zooming in on the logo on a 6+R plate** shows no flicker: the logo sits 0.05 mm above every plate. *(Task 3, unit)*
5. **A client file with bodies under no named part** still gets error reports that describe each body by size and position. *(Task 1, unit)*

---

### Task 1: Read the assembly tree and pick parts by name

**Files:**
- Copy: `~/Downloads/OB1-V2-ALL.STEP` → `assets/source/OB1-V2-ALL.STEP`
- Modify: `src/schema/product.ts` (add `PartSelection` only; nothing uses it yet)
- Modify: `src/convert/occt.ts` (add the tree reader; `readStepBodies` and `TESSELLATION_LEVELS` stay until Task 4)
- Create: `src/convert/parts.ts`
- Modify: `src/convert/bundle.ts` (move `ConvertError` to `parts.ts` and re-export it from `bundle.ts`)
- Test: `tests/unit/parts.test.ts` (new), `tests/unit/convert.test.ts`

**Interfaces:**
- Produces, `src/schema/product.ts`:
  ```ts
  /** Picks bodies out of a source file. */
  export interface PartSelection {
    /** A node name or mesh name anywhere in the file's tree, matched exactly. Omitted: the whole file as one part. */
    part?: string;
    /** Body positions within each matched instance (0-based, depth-first). Omitted: all of them. */
    bodies?: number[];
    /** Keep only instances whose bounding-box centre lies in this box (source millimetres, Y-up). */
    within?: { minMm: Vec3; maxMm: Vec3 };
  }
  ```
- Produces, `src/convert/occt.ts`:
  ```ts
  export interface Tolerance { linearMm: number; angularRad: number }
  /** A coarse, fast read for structure and sizes only. */
  export const REFERENCE_TOLERANCE: Tolerance = { linearMm: 0.32, angularRad: 0.5 };
  /** A node of the file's assembly tree; `bodies` are flat indices of the meshes directly in this node. */
  export interface StepNode { name: string; bodies: number[]; children: StepNode[] }
  export interface StepFile { bodies: StepBody[]; root: StepNode }
  /** Reads with linearDeflectionType 'absolute_value'. StepBody is unchanged; `name` is the mesh name ('' if unnamed). */
  export async function readStepFile(path: string, tolerance: Tolerance): Promise<StepFile>;
  ```
- Produces, `src/convert/parts.ts`:
  ```ts
  export class ConvertError extends Error {}           // moved from bundle.ts unchanged
  export interface BodyBox { minMm: Vec3; maxMm: Vec3 }
  /** One occurrence of a named node or named mesh. `bodies`: flat indices of every mesh in its subtree, depth-first. */
  export interface PartInstance { name: string; occurrence: number; bodies: number[] }
  /** `owner[b]` is the index into `instances` of the innermost instance containing body b, or -1. */
  export interface PartIndex { instances: PartInstance[]; boxes: BodyBox[]; owner: number[] }
  export function boxOf(body: StepBody): BodyBox;
  /** Boxes are taken after normaliseAxes(body, upAxis). */
  export function indexParts(file: StepFile, upAxis: 'y' | 'z'): PartIndex;
  /** Sorted, unique flat body indices. Throws ConvertError for a body position past the end of an instance. */
  export function selectBodies(index: PartIndex, sel: PartSelection): number[];
  /** e.g. `"Plate" #0 body 1 (60.0 × 3.0 × 50.0 mm at 0.0, 101.5, 0.0)`, or `(unnamed) body 6 (…)`. */
  export function describeBody(index: PartIndex, body: number): string;
  /** Model id → its sorted body indices. Throws ConvertError on unclaimed, doubly claimed, or empty selections. */
  export function claimBodies(sourceKey: string, index: PartIndex, models: Array<{ id: string; parts: PartSelection[] }>, leaveOut: PartSelection[]): Map<string, number[]>;
  ```
- **Rules `indexParts` follows:**
  - Instances are every named node, plus every named mesh, in depth-first order.
  - A mesh whose name equals its own node's name is not a separate instance. Single-body parts carry the same name twice.
  - `occurrence` counts instances that share a name.
- **Rules `selectBodies` follows:**
  - With `part` omitted, the whole file is one instance holding every body in flat order.
  - `within` tests the centre of the instance's combined box.
- **Rules `claimBodies` follows:**
  - Overlapping selections within one model are merged.
  - The left-out list claims as the owner `"leaveOut"`.

- [ ] **Step 1: Copy the assembly.** Run `cp ~/Downloads/OB1-V2-ALL.STEP assets/source/`. Then confirm `git status --short` doesn't list it.

- [ ] **Step 2: Write the failing synthetic tests** in `tests/unit/parts.test.ts`.
  - Build a `StepFile` from box-shaped fake bodies, using a helper `boxBody(index, name, minMm, maxMm)` that returns 8 corner vertices and no triangles.
  - The tree:
    - root `''` holds `Asm`, plus an unnamed node with body 6;
    - `Asm` holds:
      - `Screw` (body 0, mesh named `Screw`, y 96–100);
      - `Screw` (body 1, mesh named `Screw`, y −1–3);
      - `Plate` (body 2, −45…45 × 100–103 × −45…45, and body 3, −30…30 × 100–103 × −25…25, both unnamed);
      - `Board` (body 4, mesh `PCB`, and body 5, mesh `USB`).

  ```ts
  test('picks a part by name, its bodies by position, and repeated instances by where they sit', () => {
    expect(selectBodies(index, { part: 'Screw', within: { minMm: [-100, 50, -100], maxMm: [100, 200, 100] } })).toEqual([0]);
    expect(selectBodies(index, { part: 'Screw' })).toEqual([0, 1]);
    expect(selectBodies(index, { part: 'Plate', bodies: [1] })).toEqual([3]);
    expect(selectBodies(index, {})).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(selectBodies(index, { bodies: [6] })).toEqual([6]);
  });
  test('a named mesh inside a named part can be picked on its own', () => {
    expect(selectBodies(index, { part: 'USB' })).toEqual([5]);
    expect(selectBodies(index, { part: 'Board' })).toEqual([4, 5]);
  });
  test('a body position past the end of a part fails', () => {
    expect(() => selectBodies(index, { part: 'Plate', bodies: [2] })).toThrow(/"Plate" #0 has only 2 bodies/);
  });
  test('every body must be claimed exactly once', () => {
    const models = [{ id: 'screws', parts: [{ part: 'Screw' }] }, { id: 'rest', parts: [{ part: 'Plate' }, { part: 'Board' }] }];
    expect(() => claimBodies('asm', index, models, [])).toThrow(/asm: not used by any model and not left out:[\s\S]*\(unnamed\) body 6/);
    expect(() => claimBodies('asm', index, models, [{ part: 'Screw' }, { bodies: [6] }])).toThrow(/claimed by both "screws" and "leaveOut"/);
    expect(() => claimBodies('asm', index, [{ id: 'x', parts: [{ part: 'Nut' }] }], [])).toThrow(/model "x" selects nothing/);
    expect(claimBodies('asm', index, [...models, { id: 'misc', parts: [{ bodies: [6] }] }], []))
      .toEqual(new Map([['screws', [0, 1]], ['rest', [2, 3, 4, 5]], ['misc', [6]]]));
  });
  test('error reports describe bodies that sit under no named part', () => {   // Review Focus 5
    expect(describeBody(index, 6)).toBe('(unnamed) body 6 (1.0 × 1.0 × 1.0 mm at 0.5, 0.5, 0.5)');
    expect(describeBody(index, 3)).toBe('"Plate" #0 body 1 (60.0 × 3.0 × 50.0 mm at 0.0, 101.5, 0.0)');
  });
  ```
  Body 6's box is 0–1 on every axis.

- [ ] **Step 3: Write the failing real-file tests** in `tests/unit/convert.test.ts`.
  - Add `const ASSEMBLY: string = 'assets/source/OB1-V2-ALL.STEP'`. Share one read through a lazy `readAssembly()`, which calls `readStepFile(ASSEMBLY, REFERENCE_TOLERANCE)` once.
  - Set the timeout to 120 s.

  ```ts
  test('reads the assembly as a tree of named parts', async () => {
    const index = indexParts(await readAssembly(), 'y');
    expect(index.boxes).toHaveLength(132);
    const [housing] = selectBodies(index, { part: 'ALI_SHIFTER_BODY_USB-C' });
    const { minMm, maxMm } = index.boxes[housing];
    expect([0, 1, 2].every(a => near(maxMm[a] - minMm[a], [90, 100.25, 90][a], 0.2))).toBe(true);
    expect(index.instances.filter(i => i.name === 'socket countersunk head screw_iso_ISO 10642 - M3 x 10 - 10S')).toHaveLength(8);
  });
  test('6+R Up is mounted as the 6+R Down grommet turned 180°', async () => {
    const index = indexParts(await readAssembly(), 'y');
    const centreX = (part: string): number => { const [b] = selectBodies(index, { part, bodies: [0] }); return (index.boxes[b].minMm[0] + index.boxes[b].maxMm[0]) / 2; };
    expect(near(centreX('OB1-SHPL-6R_MP_6R-DOWN'), -1.4, 0.2)).toBe(true);
    expect(near(centreX('OB1-SHPL-6R_MP_6R-UP'), 1.4, 0.2)).toBe(true);
  });
  ```

- [ ] **Step 4: Run the tests and check they fail.** Run `npx vitest run tests/unit/parts.test.ts tests/unit/convert.test.ts`. Expected: FAIL, because the imports aren't defined.

- [ ] **Step 5: Implement** `readStepFile` in `occt.ts`, then `parts.ts`, to the interfaces above.
  - `readStepFile` maps occt-import-js's `root` node tree (`name`, `meshes`, `children`) onto `StepNode`.
  - `claimBodies` lists up to 20 unclaimed bodies, one per line, then `…and N more`.

- [ ] **Step 6: Run the tests and check they pass.** Run `npx vitest run tests/unit/parts.test.ts tests/unit/convert.test.ts && npm run typecheck`. Expected: all pass.

- [ ] **Step 7: Hand over for review.** Summarise the changed files for the user.

---

### Task 2: Per-part quality, merging and simplification

**Files:**
- Create: `src/convert/tessellate.ts`
- Modify: `src/convert/geometry.ts`
- Test: `tests/unit/convert.test.ts`

**Interfaces:**
- Consumes: `readStepFile`, `REFERENCE_TOLERANCE`, `StepFile` (Task 1); `boxOf`, `BodyBox` (Task 1).
- Produces, `src/convert/tessellate.ts`:
  ```ts
  export type DetailLevel = 'default' | 'light';
  export const DETAIL_LEVELS: Record<DetailLevel, { ratio: number; angularRad: number }> =
    { default: { ratio: 0.001, angularRad: 0.35 }, light: { ratio: 0.002, angularRad: 0.5 } };
  export const MIN_TOLERANCE_MM: number = 0.01;
  /** ratio × the average of the box's three dimensions (what occt-import-js's bounding_box_ratio measures). */
  export function targetToleranceMm(box: BodyBox, level: DetailLevel): number;
  /** Nearest point, in log space, on the grid MIN_TOLERANCE_MM × √2^k (k ≥ 0). Never below MIN_TOLERANCE_MM. */
  export function bucketMm(targetMm: number): number;
  /**
   * One readStepFile pass per distinct bucket that the bodies in `only` need (default: all bodies), at the
   * level's angular tolerance. Each body comes from its own bucket's pass; bodies not in `only` keep the
   * reference tessellation, so flat indices stay aligned. Throws if a pass's body count differs from the reference.
   */
  export async function readAtDetail(path: string, reference: StepFile, level: DetailLevel, only?: number[]): Promise<StepFile>;
  ```
- Produces, `src/convert/geometry.ts`:
  ```ts
  /** Concatenates bodies into one (index 0, the given name). Faces are kept, with offset ranges. */
  export function mergeBodies(name: string, bodies: StepBody[]): StepBody;
  /**
   * MeshoptSimplifier.simplify(indices, positions, 3, 0, maxErrorMm, ['LockBorder', 'ErrorAbsolute']), then drops
   * unused vertices. Face ranges are lost (faces = []), so run face rules first. Awaits MeshoptSimplifier.ready.
   */
  export async function simplifyBody(body: StepBody, maxErrorMm: number): Promise<{ body: StepBody; removedTriangles: number }>;
  ```
- **Why `LockBorder`:** occt-import-js gives every B-rep face its own vertices. Locking borders keeps neighbouring faces sealed, so simplification opens no cracks.

- [ ] **Step 1: Write the failing tests** in `tests/unit/convert.test.ts`. Here `triangles(b)` is `b.indices.length / 3`, and `sizeMm` is the existing helper.
  ```ts
  test('tolerance buckets sit on a √2 grid and never go below 0.01 mm', () => {
    expect(targetToleranceMm({ minMm: [0, 0, 0], maxMm: [43.4, 72, 43.4] }, 'default')).toBeCloseTo(0.0529, 4);
    expect(bucketMm(0.0529)).toBeCloseTo(0.0566, 4);
    expect(bucketMm(0.04)).toBeCloseTo(0.04, 6);
    expect(bucketMm(0.0018)).toBe(0.01);
  });
  test('a part read from the assembly gets the same quality as from its own file', async () => {
    const ref = await readAssembly();
    const [senna] = selectBodies(indexParts(ref, 'y'), { part: 'SHIFT_KNOB_SENNA (M12x1.25)_PRODUCTION' });
    const fromAssembly = (await readAtDetail(ASSEMBLY, ref, 'default', [senna])).bodies[senna];
    const SENNA = 'assets/source/SHIFT_KNOB_SENNA (M12x1.25)_REV2 (2).STEP';
    const fromOwnFile = (await readAtDetail(SENNA, await readStepFile(SENNA, REFERENCE_TOLERANCE), 'default')).bodies[0];
    expect(triangles(fromOwnFile)).toBeGreaterThan(20_000);              // today's quality, not the coarse reference read
    expect(triangles(fromAssembly) / triangles(fromOwnFile)).toBeGreaterThan(0.9);
    expect(triangles(fromAssembly) / triangles(fromOwnFile)).toBeLessThan(1.1);
  });
  test('simplifying the bearings removes most triangles without changing their size', async () => {
    const ref = await readAssembly();
    const ids = selectBodies(indexParts(ref, 'y'), { part: '7804K126_Stainless Steel Ball Bearing_7804K126' });
    const file = await readAtDetail(ASSEMBLY, ref, 'default', ids);
    const merged = mergeBodies('bearings', ids.map(i => file.bodies[i]));
    const { body, removedTriangles } = await simplifyBody(merged, 0.05);
    expect(removedTriangles).toBeGreaterThan(0.5 * triangles(merged));
    expect(triangles(body) + removedTriangles).toBe(triangles(merged));
    sizeMm(body).forEach((s, a) => expect(near(s, sizeMm(merged)[a], 0.05)).toBe(true));
  });
  test('merging keeps every triangle pointing at its own vertices', () => {
    // two one-triangle bodies (z = 0 and z = 10), each with faces [{ first: 0, last: 0 }]
    const merged = mergeBodies('pair', [oneTriangle(0), oneTriangle(10)]);
    expect([...merged.indices]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(merged.positions[3 * 3 + 2]).toBe(10);
    expect(merged.faces).toEqual([{ first: 0, last: 0 }, { first: 1, last: 1 }]);
  });
  ```

- [ ] **Step 2: Run the tests and check they fail.** Run `npx vitest run tests/unit/convert.test.ts`. Expected: FAIL, because the imports aren't defined.

- [ ] **Step 3: Implement** `tessellate.ts`, then `mergeBodies` and `simplifyBody` in `geometry.ts`, to the interfaces above.

- [ ] **Step 4: Run the tests and check they pass.** Run `npx vitest run tests/unit/convert.test.ts && npm run typecheck`. Expected: all pass. The two assembly tests take about 10–20 s each.

- [ ] **Step 5: Hand over for review.** Summarise the changed files for the user.

---

### Task 3: Settings format v2 and the new OB1 settings file

**Files:**
- Modify: `src/schema/product.ts`, `src/schema/validate.ts`
- Rewrite: `products/ob1/product.json`
- Test: `tests/unit/schema.test.ts`, `tests/unit/assembly.test.ts`, `tests/unit/scheduler.test.ts`

**Interfaces:**
- Consumes: `PartSelection` (Task 1).
- Produces, in `src/schema/product.ts` (replacing the old fields):
  ```ts
  export interface SourceDef {
    file: string;
    units: 'mm' | 'm' | 'in';
    upAxis: 'y' | 'z';
    /** Geometry deliberately left out of the build. Everything else must belong to exactly one model. */
    leaveOut?: PartSelection[];
  }                                                              // bodyCount and dropBodies are gone
  // converted model:
  { kind: 'converted'; source: string; parts: PartSelection[]; faceRules?: FaceRule[]; /** default level; light uses 2× */ simplifyErrorMm?: number }
  export interface SlotDef { /* …existing… */ afterFirstView?: boolean }
  export interface Product { schemaVersion: 2; /* …existing… */ }
  ```
- **Validator rules** (each failure is a `ProductError` with the path shown):

  | Rule | Path |
  |---|---|
  | `schemaVersion` must be 2 | `schemaVersion` |
  | A converted model's `parts` must be a non-empty array | `models.<id>.parts` |
  | `part` is a non-empty string; `bodies` is a non-empty array of integers ≥ 0 | `…parts[i].part`, `…parts[i].bodies` |
  | Every `within.minMm[a]` must be ≤ `maxMm[a]` | `…parts[i].within` |
  | `simplifyErrorMm` must be > 0 | `models.<id>.simplifyErrorMm` |
  | The same selection rules apply to `sources.<key>.leaveOut[i]` | `sources.<key>.leaveOut[i]…` |
  | `afterFirstView` must be a boolean | `slots[i].afterFirstView` |
  | The root slot can't be `afterFirstView` | `slots[i].afterFirstView` |

- **The OB1 settings file.** Rewrite it with the values below.
  - Keep `id`, `name`, `options`, `defaultSelection` and `framing` exactly as they are today. The options still set the slots `knob`, `plate` and `grommet`, with the same model ids.
  - Mount values (spec §3.2): the stick tip is at (−7.5, 151.25, 0), the logo lift is 0.05 mm, and the 7+R logo is bodies 0–3, grommet 4, plate 5.
  - **One deviation from the spec:** the USB-C connector is its own `usb-port` model with a `steel` finish, shown in the first view. The spec's §5.5 lets the builder split it from the board. It's visible from outside, and a black port would look wrong.
  - Simplification values are starting points for Task 7.

  ```jsonc
  "schemaVersion": 2,
  "sources": {
    "ob1": { "file": "assets/source/OB1-V2-ALL.STEP", "units": "mm", "upAxis": "y",
             "leaveOut": [{ "part": "SHIFT_KNOB_ROUND (M12x1.25)_H" }, { "part": "SHIFT_KNOB_SENNA (M12x1.25)_PRODUCTION" }] },
    "knob-round": { "file": "assets/source/SHIFT_KNOB_ROUND (M12x1.25)_REV2 (1).STEP", "units": "mm", "upAxis": "y" },
    "knob-senna": { "file": "assets/source/SHIFT_KNOB_SENNA (M12x1.25)_REV2 (2).STEP", "units": "mm", "upAxis": "y" }
  },
  "models": {   // every model below is { "kind": "converted", "source": "ob1", "parts": [...] } unless stated
    "housing":  parts [{ "part": "ALI_SHIFTER_BODY_USB-C" }], "sockets": { "logoLift": { "positionMm": [0, 0.05, 0] } },
    "base":     [{ "part": "ALI_SHIFTER_BASE" }],
    "pad":      [{ "part": "OB1-SHFT-PAD" }],
    "usb-port": [{ "part": "Same_Sky_UJ20-C-R-G-TH-3-P14" }],
    "plate-screws": [{ "part": "socket countersunk head screw_iso_ISO 10642 - M3 x 10 - 10S", "within": { "minMm": [-100, 50, -100], "maxMm": [100, 200, 100] } },
                     { "part": "socket countersunk head screw_iso_ISO 10642 - M3 x 12 - 12S" }], "simplifyErrorMm": 0.02,
    "logo":            [{ "part": "OB1-SHPL-7R_V15_7R", "bodies": [0, 1, 2, 3] }],
    "plate-6r-down":   [{ "part": "OB1-SHPL-6R_MP_6R-DOWN", "bodies": [1] }],
    "grommet-6r-down": [{ "part": "OB1-SHPL-6R_MP_6R-DOWN", "bodies": [0] }],
    "plate-6r-up":     [{ "part": "OB1-SHPL-6R_MP_6R-UP", "bodies": [1] }],
    "grommet-6r-up":   [{ "part": "OB1-SHPL-6R_MP_6R-UP", "bodies": [0] }],
    "plate-7r":        [{ "part": "OB1-SHPL-7R_V15_7R", "bodies": [5] }],
    "grommet-7r":      [{ "part": "OB1-SHPL-7R_V15_7R", "bodies": [4] }],
    "stick": [{ "part": "ROD, M8" }, { "part": "hex flange nut gradea_iso_ISO - 4161 - M8 - N" }, { "part": "THREAD COUPLER_M8x1.25" }],
             "sockets": { "tip": { "positionMm": [-7.5, 151.25, 0] } },
    "knob-round": { "kind": "converted", "source": "knob-round", "parts": [{}], "faceRules": [{ "kind": "dropNearAxis", "maxRadiusMm": 6.3, "maxHeightMm": 17 }] },
    "knob-senna": { "kind": "converted", "source": "knob-senna", "parts": [{}], "faceRules": [{ "kind": "dropNearAxis", "maxRadiusMm": 6.3, "maxHeightMm": 17 }] },
    "knob-ball": { "kind": "sphere", "radiusMm": 22, "attachPointMm": [0, -18, 0] },
    "board":    [{ "part": "ALI_SHIFTER_PCB_HAL_USB-C" }], "simplifyErrorMm": 0.03,
    "bracket":  [{ "part": "ALI_SHIFTER_BRACKET" }],
    "springs":  [{ "part": "1804N221_Yellow Die Spring for 10 mm Hole Diameter_8mm OD" }, { "part": "1804N221_Yellow Die Spring for 10 mm Hole Diameter_6mm OD" }], "simplifyErrorMm": 0.05,
    "bearings": [{ "part": "7804K126_Stainless Steel Ball Bearing_7804K126" }], "simplifyErrorMm": 0.05,
    "hidden-screws": [{ "part": "socket countersunk head screw_iso_ISO 10642 - M3 x 10 - 10S", "within": { "minMm": [-100, -50, -100], "maxMm": [100, 50, 100] } },
                      { "part": "hexagon socket button head screws gb_MODIFIED2_GB_SOCKET_TYPE7 M3X6-S" },
                      { "part": "hexagon socket button head screws gb_MODIFIED2_GB_SOCKET_TYPE7 M3X10-S" },
                      { "part": "socket countersunk head screw_iso_ISO 10642 - M4 x 35 - 20N" }], "simplifyErrorMm": 0.05,
    "zinc-hardware": [{ "part": "torque nut 01_iso_ISO 7040-M3-N" }, { "part": "torque nut 01_iso_ISO 7040-M4-N" },
                      { "part": "hex nuts, style 1-grades ab gb_GB_FASTENER_NUT_SNAB1 M3-N" }, { "part": "plain washer 10669 type nl_iso_ISO 10669-4-N" },
                      { "part": "PCB-BUSHING" }, { "part": "Top Spring Clip" }], "simplifyErrorMm": 0.03
  },
  "finishes": {  // keep the nine existing finishes; add:
    "rubber":          { "kind": "matte", "color": "#1a1a1a", "roughness": 0.9 },
    "blackOxide":      { "kind": "metal", "color": "#1c1c1c", "roughness": 0.4 },
    "etchedAluminium": { "kind": "metal", "color": "#c4c8cc", "roughness": 0.35 },
    "springRed":       { "kind": "metal", "color": "#a8231d", "roughness": 0.45 },
    "stainless":       { "kind": "metal", "color": "#c8ccd0", "roughness": 0.25 },
    "pcbBlack":        { "kind": "matte", "color": "#161616", "roughness": 0.6 },
    "zinc":            { "kind": "metal", "color": "#b5b9bd", "roughness": 0.35 }
  },
  "slots": [   // in this order; every child of housing is "placement": "asInCad" unless stated
    { "id": "housing", "model": "housing", "finish": "bodyBlack" },
    { "id": "base", "parent": "housing", "model": "base", "finish": "bodyBlack" },
    { "id": "pad", "parent": "housing", "model": "pad", "finish": "rubber" },
    { "id": "usb-port", "parent": "housing", "model": "usb-port", "finish": "steel" },
    { "id": "plate-screws", "parent": "housing", "model": "plate-screws", "finish": "blackOxide" },
    { "id": "logo", "parent": "housing", "socket": "logoLift", "placement": "socket", "model": "logo", "finish": "etchedAluminium" },
    { "id": "plate", "parent": "housing", "model": "plate-6r-down", "finish": "carbonWeave" },
    { "id": "grommet", "parent": "plate", "model": "grommet-6r-down", "finish": "tpuGrey" },
    { "id": "stick", "parent": "housing", "model": "stick", "finish": "steel" },
    { "id": "knob", "parent": "stick", "socket": "tip", "placement": "socket", "model": "knob-round", "finish": "carbonWeave" },
    { "id": "board", "parent": "housing", "model": "board", "finish": "pcbBlack", "afterFirstView": true },
    { "id": "bracket", "parent": "housing", "model": "bracket", "finish": "bodyBlack", "afterFirstView": true },
    { "id": "springs", "parent": "housing", "model": "springs", "finish": "springRed", "afterFirstView": true },
    { "id": "bearings", "parent": "housing", "model": "bearings", "finish": "stainless", "afterFirstView": true },
    { "id": "hidden-screws", "parent": "housing", "model": "hidden-screws", "finish": "blackOxide", "afterFirstView": true },
    { "id": "zinc-hardware", "parent": "housing", "model": "zinc-hardware", "finish": "zinc", "afterFirstView": true }
  ]
  ```
  Model key order in the file is the order listed above. Task 4's `groupModels` test depends on it.

- [ ] **Step 1: Write the failing tests.**
  - **`tests/unit/schema.test.ts`:**
    - In `resolves a selection…`, replace the `rod` line with `expect(r.stick).toEqual({ model: 'stick', finish: 'steel' })`.
    - The `socket missing` case becomes `p.slots[9].socket = 'nope'` → path `slots[9].socket`.
    - Add these `rejects a broken file` cases:
      ```ts
      ['old settings format', (p: any) => { p.schemaVersion = 1; }, 'schemaVersion'],
      ['model with no parts', (p: any) => { p.models.housing.parts = []; }, 'models.housing.parts'],
      ['selection box inside out', (p: any) => { p.models['plate-screws'].parts[0].within.minMm[1] = 300; }, 'models.plate-screws.parts[0].within'],
      ['root slot after the first view', (p: any) => { p.slots[0].afterFirstView = true; }, 'slots[0].afterFirstView'],
      ['left-out selection with a bad body', (p: any) => { p.sources.ob1.leaveOut[0].bodies = [-1]; }, 'sources.ob1.leaveOut[0].bodies'],
      ```
  - **`tests/unit/assembly.test.ts`:**
    - `synthetic()` uses `schemaVersion: 2`.
    - Replace `the knob sits on the rod tip above the body` and `the ball stand-in attaches by its attach point` with:
      ```ts
      test('each knob sits on the stick tip, where the assembly\'s knobs sat', () => {
        for (const [knob, liftMm] of [['Carbon Weave | Round', 0], ['Carbon Weave | Teardrop', 0], ['Aluminum | Silver', 18]] as const) {
          const p = new Vector3().setFromMatrixPosition(resolveAssembly(ob1, resolveConfiguration(ob1, { ...ob1.defaultSelection, 'Shift Knob': knob })).get('knob')!);
          expect(p.x).toBeCloseTo(-0.0075, 6); expect(p.y).toBeCloseTo(0.15125 + liftMm / 1000, 6); expect(p.z).toBeCloseTo(0, 6);
        }
      });
      test('the logo sits 0.05 mm above every plate, so it never flickers against it', () => {   // Review Focus 4
        for (const pattern of ['6+R Down', '6+R Up', '7+R']) {
          const world = resolveAssembly(ob1, resolveConfiguration(ob1, { ...ob1.defaultSelection, 'Shift Pattern': pattern }));
          expect(new Vector3().setFromMatrixPosition(world.get('logo')!).y).toBeCloseTo(0.00005, 8);
          expect(new Vector3().setFromMatrixPosition(world.get('plate')!).y).toBe(0);
        }
      });
      ```
    - Update any other test there that names the old `body` or `rod` slots, so it uses `housing` and `stick`.
  - **`tests/unit/scheduler.test.ts`:** `current models load first…` now expects:
    - `order.slice(0, 16)` to be the 16 converted models in slot order: `housing, base, pad, usb-port, plate-screws, logo, plate-6r-down, grommet-6r-down, stick, knob-round, board, bracket, springs, bearings, hidden-screws, zinc-hardware`;
    - `order[16]` to be `'knob-senna'`;
    - a length of 21.

- [ ] **Step 2: Run the tests and check they fail.** Run `npx vitest run tests/unit/schema.test.ts tests/unit/assembly.test.ts tests/unit/scheduler.test.ts`. Expected: FAIL, because the old file doesn't validate as v2.

- [ ] **Step 3: Implement** the types, the validator rules and the new `products/ob1/product.json`.
  - `validateSockets` already skips `asInCad` children. No other assembly code changes.
  - Read the fatal-error path in `src/viewer/element.ts` and confirm that a fatal `invalid-product` error keeps the still image on screen. That's what a stale v1 viewer will hit when it meets a v2 bundle. Report what you found in the hand-over.

- [ ] **Step 4: Run the tests and check they pass.** Run `npx vitest run tests/unit/schema.test.ts tests/unit/assembly.test.ts tests/unit/scheduler.test.ts && npm run typecheck`.
  - Expected: those pass.
  - `npm run typecheck` still fails in `bundle.ts` and `cli.ts`, on `bodyIndex` and `bodyCount`. Task 4 fixes those. List the errors in the hand-over.

- [ ] **Step 5: Hand over for review.** Summarise the changed files for the user, and note that `npm run convert` is broken until Task 4.

---

### Task 4: Converter wiring, `--inspect` and the size table

**Files:**
- Modify: `src/convert/bundle.ts`, `src/convert/cli.ts`
- Modify: `src/convert/occt.ts` (delete `readStepBodies`, `TessellationLevel` and `TESSELLATION_LEVELS`)
- Modify: `tests/unit/convert.test.ts`, `tests/unit/bundle.test.ts`, `tests/e2e/smoke.spec.ts`, `README.md`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces, `src/convert/bundle.ts`:
  ```ts
  export interface ModelRow { model: string; group: 'alwaysShown' | 'variants' | 'afterFirstView'; triangles: number; droppedTriangles: number; simplifiedTriangles: number; brotliBytes: number; lightBrotliBytes: number }
  /**
   * Converted models only, each list in product.models key order:
   * - afterFirstView: every slot that can hold the model is afterFirstView;
   * - variants: otherwise, some slot that can hold it can hold more than one model;
   * - alwaysShown: the rest.
   */
  export function groupModels(p: Product): Record<'alwaysShown' | 'variants' | 'afterFirstView', string[]>;
  ```
  `checkBodyMapping` and `bodySizeMm` are deleted. `ConvertError` is still re-exported.
- **Conversion flow in `convertProduct`:**
  1. Per source, once: `ref = readStepFile(file, REFERENCE_TOLERANCE)`, then `claims = claimBodies(key, indexParts(ref, upAxis), <the source's converted models>, leaveOut ?? [])`.
  2. Per level: `readAtDetail(file, ref, level, <all claimed body indices>)`. Left-out bodies are never tessellated finely.
  3. Per model: `normaliseAxes` each claimed body, then `mergeBodies`, then `applyFaceRules`, then `simplifyBody` (at `simplifyErrorMm`, ×2 on the light level), then `writeGlb`.

  Versioning, the pointer file and the baseline comparison are unchanged.
- **CLI output:**
  - **`--inspect`**, per source: the header `key (file)`, then one line per instance: `"name" #occurrence  N bodies  size … mm  centre (x, y, z)  T triangles (coarse)`. Multi-body instances add an indented `body k  size …  centre …` line per body.
  - **The table** gets two new columns, `group` and `simplified`.
  - **After the table**, one line: `always shown: X KB · variants: Y KB · after first view: Z KB (brotli, default level)`.

- [ ] **Step 1: Write the failing tests and test edits.**
  - **`tests/unit/bundle.test.ts`:** delete the `checkBodyMapping` test, and add:
    ```ts
    test('groups models into always shown, variants and after the first view', () => {
      expect(groupModels(ob1)).toEqual({
        alwaysShown: ['housing', 'base', 'pad', 'usb-port', 'plate-screws', 'logo', 'stick'],
        variants: ['plate-6r-down', 'grommet-6r-down', 'plate-6r-up', 'grommet-6r-up', 'plate-7r', 'grommet-7r', 'knob-round', 'knob-senna'],
        afterFirstView: ['board', 'bracket', 'springs', 'bearings', 'hidden-screws', 'zinc-hardware'],
      });
    });
    ```
  - **`tests/unit/convert.test.ts`:**
    - Delete `reads both bodies of the 6+R Down plate file`; Task 1's assembly test replaces it.
    - In the thread and GLB tests, replace `readStepBodies(path, TESSELLATION_LEVELS.default)` with `(await readAtDetail(path, await readStepFile(path, REFERENCE_TOLERANCE), 'default')).bodies`.
  - **`tests/e2e/smoke.spec.ts`:**
    - The critical regex becomes `/\/parts\/(housing|base|pad|usb-port|plate-screws|logo|stick|plate-6r-down|grommet-6r-down|knob-round)\.glb$/`.
    - The `arrayContaining` list in the slow-4G test names those ten `.glb` files.

- [ ] **Step 2: Run the tests and check they fail.** Run `npx vitest run tests/unit/bundle.test.ts`. Expected: FAIL, because `groupModels` isn't defined.

- [ ] **Step 3: Implement** `bundle.ts` and `cli.ts`, then delete the old reader from `occt.ts`.

- [ ] **Step 4: Run the unit tests and typecheck.** Run `npm test && npm run typecheck`. Expected: all pass, with no type errors.

- [ ] **Step 5: Check the knob mount against the file.**
  - Run `npm run convert -- products/ob1 --inspect`.
  - In the rows for `SHIFT_KNOB_ROUND (M12x1.25)_H` and `SHIFT_KNOB_SENNA (M12x1.25)_PRODUCTION`, the mount point is (centre x, centre y − height/2, centre z).
  - If it differs from (−7.5, 151.25, 0) by more than 0.01 mm, update the `stick` model's `tip` socket and the Task 3 assembly test to match, and say so in the hand-over.

- [ ] **Step 6: Convert.**
  - Run `npm run convert -- products/ob1`.
  - Expected: the table lists 21 converted models, and the run takes under 4 minutes.
  - It exits 1 with `FLAGGED` for growth over 10%. That's expected; the baseline is reset in Task 7.
  - Paste the table into the hand-over.

- [ ] **Step 7: Run the browser smoke tests.**
  - Run `npm run test:e2e` (Chromium and Firefox), plus WebKit in the container as `README.md` describes.
  - Expected: all pass. Until Task 5, the first view waits for every part, which is slower but correct.
  - **Exception:** the slow-4G test may miss its 5 s bound for now, because the internals download alongside the first-view parts until Task 5. If that's the only failure, record the number in the hand-over and move on; Task 5 removes the contention.

- [ ] **Step 8: Update `README.md`.** Cover what `--inspect` now prints, and the part-selection fields (`part`, `bodies`, `within`, `leaveOut`, `simplifyErrorMm`, `afterFirstView`).

- [ ] **Step 9: Hand over for review.** Summarise the changed files and include the size table.

---

### Task 5: Parts that appear after the first view

**Files:**
- Modify: `src/viewer/render/scheduler.ts`, `src/viewer/render/engine.ts`, `src/viewer/protocol.ts`, `src/convert/stills.ts`
- Test: `tests/unit/scheduler.test.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: `SlotDef.afterFirstView` (Task 3).
- Produces, `src/viewer/render/scheduler.ts`:
  ```ts
  /** Converted models of slots without afterFirstView, in slot order: what the first view and swaps wait for. */
  export function requiredModelsOf(p: Product, s: Selection): string[];
  /** Converted models of afterFirstView slots, in slot order. */
  export function deferredModelsOf(p: Product, s: Selection): string[];
  ```
  `LoadPlanner.order(current)` becomes:
  1. `requiredModelsOf(current)`;
  2. then `deferredModelsOf(current)`;
  3. then the required models of each one-change-away selection, option by option, in value order;
  4. then every remaining converted model.

  `convertedModelsOf` stays.
- Produces, `src/viewer/protocol.ts`: the progress `phase` becomes `'current' | 'deferred' | 'background'`.
- **Engine behaviour:**
  - **First view and swaps:** the first view, `SwapScheduler` and `failPendingPickIfItNeeds` use `requiredModelsOf` instead of `convertedModelsOf`.
  - **Draw order:** in `buildSlots`, an `afterFirstView` slot's mesh gets `renderOrder = 1` (others 0), so internals draw after the outside parts.
  - **Hidden until warmed:** in `applyConfiguration`, an `afterFirstView` slot is shown only when its model is `ready` and `warmed`. Otherwise its mesh has `visible = false` and doesn't count towards `bounds`.
  - **Reveal on the next frame:** when the tick's idle warm loop warms a model that an `afterFirstView` slot of the current selection holds, set `revealPending`. The next tick calls `applyConfiguration(this.current)`, draws, and emits deferred progress. A part is never revealed in the frame that warmed it.
  - **Deferred progress:**
    - Emit `{ type: 'progress', phase: 'deferred', total: deferredModelsOf(current).length, loaded }`, where `loaded` counts deferred models that are shown or `failed`.
    - Emit it right after `ready`, and again after each reveal or failure.
  - **Failed downloads:** a deferred model that fails emits `{ type: 'error', reason: 'model-load-failed: <id>', fatal: false }` and never blocks anything.
  - **Stills:** in `renderStills`, after `ready`, wait for a recorded `progress` event with `phase === 'deferred'` and `loaded === total` before the first capture.

- [ ] **Step 1: Write the failing unit tests** in `tests/unit/scheduler.test.ts`. Replace the Task 3 version of `current models load first…` with:
  ```ts
  const REQUIRED = ['housing', 'base', 'pad', 'usb-port', 'plate-screws', 'logo', 'plate-6r-down', 'grommet-6r-down', 'stick', 'knob-round'];
  const DEFERRED = ['board', 'bracket', 'springs', 'bearings', 'hidden-screws', 'zinc-hardware'];
  test('the first view and swaps wait only for parts not marked after-first-view', () => {
    expect(requiredModelsOf(ob1, ob1.defaultSelection)).toEqual(REQUIRED);
    expect(deferredModelsOf(ob1, ob1.defaultSelection)).toEqual(DEFERRED);
  });
  test('after-first-view parts load right after the first view, before other variants', () => {
    const order = new LoadPlanner(ob1).order(ob1.defaultSelection);
    expect(order.slice(0, 16)).toEqual([...REQUIRED, ...DEFERRED]);
    expect(order[16]).toBe('knob-senna');
    expect(new Set(order).size).toBe(21);
  });
  ```

- [ ] **Step 2: Write the failing e2e tests** in `tests/e2e/smoke.spec.ts`.
  - Add a helper `holdRequests(page: Page, url: RegExp): Promise<() => void>`. It routes matching requests and continues them only after the returned function is called.
  - Widen the phase union of `waitForProgressComplete` to include `'deferred'`.
  ```ts
  const AFTER_FIRST_VIEW = /\/parts\/(board|bracket|springs|bearings|hidden-screws|zinc-hardware)(\.light)?\.glb$/;
  test('after-first-view parts neither delay the first view or picks nor compile new shaders', async ({ page }) => {   // Review Focus 1
    const release = await holdRequests(page, AFTER_FIRST_VIEW);
    await page.goto('/?stats'); await waitFor(page, 'ready');                 // every internal part is still held
    const before = await debugInfo(page);
    await pick(page, 'Shift Pattern', '7+R'); await waitFor(page, 'configurationchange');
    await pick(page, 'Shift Knob', 'Carbon Forged | Teardrop'); await waitFor(page, 'configurationchange');
    release();
    await waitForProgressComplete(page, 'deferred');
    expect((await debugInfo(page)).programs).toBe(before.programs);
  });
  test('an after-first-view part that fails is reported and blocks nothing', async ({ page }) => {   // Review Focus 2
    allowedConsole = /bearings|Failed to load resource|net::ERR_FAILED|NS_ERROR|Load failed/i;
    await page.route('**/parts/bearings*.glb', r => r.abort());
    await page.goto('/'); await waitFor(page, 'ready');
    expect(await nextError(page)).toEqual(expect.objectContaining({ fatal: false, reason: expect.stringContaining('bearings') }));
    await waitForProgressComplete(page, 'deferred');
    await pick(page, 'Shift Knob', 'Carbon Forged | Round'); await waitFor(page, 'configurationchange');
  });
  test('after-first-view parts still appear after a lost graphics context', async ({ page }) => {   // Review Focus 3
    const release = await holdRequests(page, AFTER_FIRST_VIEW);
    await page.goto('/?stats'); await waitFor(page, 'ready');
    await page.evaluate(() => (document.querySelector('mini3d-viewer') as unknown as { debugLoseContext(): void }).debugLoseContext());
    await waitFor(page, 'restored');
    release();
    await waitForProgressComplete(page, 'deferred');
  });
  ```

- [ ] **Step 3: Run the tests and check they fail.** Run `npx vitest run tests/unit/scheduler.test.ts`, then `npx playwright test --project=chromium -g "after-first-view"`. Expected: FAIL.

- [ ] **Step 4: Implement** the scheduler, protocol, engine and stills changes described above.

- [ ] **Step 5: Run everything and check it passes.** Run `npm test && npm run typecheck && npm run test:e2e`, plus WebKit in the container. Expected: all pass.

- [ ] **Step 6: Hand over for review.** Summarise the changed files for the user.

---

### Task 6: Shadow and floor from the real product

**Files:**
- Modify: `src/viewer/render/studio.ts`, `src/viewer/render/engine.ts`
- Test: `tests/unit/studio.test.ts` (new)

**Interfaces:**
- Produces, `src/viewer/render/studio.ts`:
  ```ts
  /** Footprint = the larger of the bounds' x and z sizes; floor = the bounds' lowest y (both in metres). */
  export function shadowPlacement(bounds: Box3): { footprintM: number; floorYM: number };
  /** The shadow quad is sized 2.2 × footprintM and placed at y = floorYM + 0.0002. */
  export function createStudio(renderer: WebGLRenderer, footprintM: number, floorYM: number): Studio;
  ```
- **Engine changes:**
  - `buildLook` no longer installs the studio.
  - `init` calls `installStudio` after the first `applyConfiguration`, using `shadowPlacement(this.bounds)`, and before `warmAll`, so the shadow's shader is compiled in the warm-up.
  - The context-restore path does the same.
  - The `root.kind === 'box'` footprint fallback is deleted.

- [ ] **Step 1: Write the failing test.**
  ```ts
  test('the shadow covers the real base and sits under it', () => {
    const p = shadowPlacement(new Box3(new Vector3(-0.045, -0.004, -0.065), new Vector3(0.045, 0.2232, 0.065)));
    expect(p.footprintM).toBeCloseTo(0.13, 6);
    expect(p.floorYM).toBeCloseTo(-0.004, 6);
  });
  ```

- [ ] **Step 2: Run the test and check it fails.** Run `npx vitest run tests/unit/studio.test.ts`. Expected: FAIL, because `shadowPlacement` isn't defined.

- [ ] **Step 3: Implement** the studio and engine changes described above.

- [ ] **Step 4: Run everything and check it passes.** Run `npm test && npm run typecheck && npx playwright test --project=chromium`. Expected: all pass.

- [ ] **Step 5: Look.**
  - Open the dev page (`npm run dev`, then `/?stats`) in the Linux Chrome. Screenshot the default view, and a low side view at the vertical limit.
  - Expected: the base sits on the shadow, with no gap and no part sinking into it.
  - Include both screenshots in the hand-over.

- [ ] **Step 6: Hand over for review.** Summarise the changed files for the user.

---

### Task 7: Tune detail, reset the baseline and re-render the stills

**Files:**
- Modify: `products/ob1/product.json` (only the `simplifyErrorMm` values, unless a step says otherwise)
- Modify: `products/ob1/size-baseline.json` (only through `--update-baseline`)

- [ ] **Step 1: Measure.** Run `npm run convert -- products/ob1`, and note the three group totals and each model's triangle count.

- [ ] **Step 2: Tune the internals.** Adjust `simplifyErrorMm` on the after-first-view models, heaviest first, until all three conditions hold:
  - the after-first-view total ≤ the always-shown total;
  - no value is above 0.2 mm;
  - in the dev page, looking down through the gate at about 45°, the springs still read as coils and the bearings as rings, with no visible cracks or holes.

  Re-convert after each change. Screenshot the final gate view.

- [ ] **Step 3: Check the first view on slow 4G.**
  - Run `npx playwright test --project=chromium -g "slow 4G"`. Expected: PASS, with the critical-path annotation under 5000 ms. Record the number.
  - If it fails, lower `plate-screws`' detail first (`simplifyErrorMm` up to 0.1). Then move parts to `afterFirstView`, in this order: `usb-port`, then `plate-screws`.
  - **Don't touch brotli** without the user's go-ahead.

- [ ] **Step 4: Laptop speed test.**
  - Run `npm run build && npm run preview`, and open `http://localhost:4173/?stats` in the Linux Chrome, with the window in front.
  - Check the power status, then run the speed test.
    - **Plugged in:** average ≥ 58 fps, max ≤ 33.4 ms, no slow swaps.
    - **On battery** (ask the user to unplug): one run to let the governor settle, then one run averaging ≥ 50 fps with max ≤ 33.4 ms.
  - If either misses, lower detail on the heaviest after-first-view models (Step 2's limits still apply) and repeat.

- [ ] **Step 5: Show the user the size table.**
  - Show the before (current baseline) and after totals per group.
  - Ask the user to approve the new baseline, and wait for a yes.
  - Then run `npm run convert -- products/ob1 --update-baseline`.

- [ ] **Step 6: Re-render the stills.** Run `npm run stills -- ob1`. Expected: `63 stills`. Open three of them (6+R Down, 6+R Up, 7+R) and check each shows the logo, the internals through the gate, and the right reverse-gate corner.

- [ ] **Step 7: Full test run.** Run `npm test && npm run typecheck && npm run test:e2e`, plus WebKit in the container. Expected: all pass.

- [ ] **Step 8: Hand over for review.** Summarise:
  - the final `simplifyErrorMm` values;
  - the before/after size table;
  - the slow-4G number;
  - the laptop fps results;
  - the gate screenshot.

---

### Task 8: Deploy and sign off with the user

**Files:**
- Modify: `docs/research/2026-11-17-reference-configurators.md` (append a dated "assembly import sign-off" section with a results table)

- [ ] **Step 1: Ask before deploying.**
  - Tell the user the new build will replace v1 at https://mini3d.jamesdong.workers.dev. v1 shows 6+R Up wrong, and nothing links to it.
  - Wait for an explicit yes.
  - If wrangler isn't logged in, ask the user to run `! npx wrangler login`.

- [ ] **Step 2: Deploy.** Run `npm run deploy`. Expected: Wrangler prints the workers.dev URL. Open it with `?stats` and confirm the viewer comes up.

- [ ] **Step 3: Device checks.** The user runs these on the live URL with `?stats`. Record every number.
  - **iPhone 12 Pro:**
    - the speed test, with the same thresholds as plugged in;
    - a cold start (force-quit Safari), recording the first-view time;
    - on 4G, a first spin within about 2 s.
  - **Laptop Firefox:** the speed test, with the plugged-in thresholds.

- [ ] **Step 4: Look check with the user.** Go through these together:
  - all three plates show the logo under the 3rd-gear gate, with no flicker close up;
  - 6+R Up has its reverse gate at the top left, and 6+R Down at the bottom right;
  - the mechanism reads well through the gate, with red springs and a black board;
  - the USB-C port reads as a port;
  - the screw heads sit flush;
  - internals popping in a moment after the reveal isn't noticeable.

- [ ] **Step 5: Fix what the look check finds.**
  - **Pop-in noticed:** remove `afterFirstView` from the slots seen through the gate (likely `springs` and `bracket`).
  - **Finish wrong:** adjust its colour or roughness.
  - **A device number missed:** go back to Task 7's levers.

  Then re-convert, re-render the stills, re-run the tests, and **ask again** before redeploying.

- [ ] **Step 6: Record.** Append the results table (device, browser, power, avg fps, max ms, first view ms, worst swap ms), plus the size totals, to the research doc.

- [ ] **Step 7: Hand over for review.** Summarise the changed files and the sign-off results for the user.
