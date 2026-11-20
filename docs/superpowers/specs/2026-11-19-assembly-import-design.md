# Assembly import: the real OB1 shifter from one CAD assembly

- **Date:** 2026-11-19
- **Status:** approved by the user (2026-11-19)
- **Builds on:** `docs/superpowers/specs/2026-11-17-mini3d-viewer-v1-design.md` (the v1 design). Everything in it still holds unless this document says otherwise.

## 1. Intent

v1 shows the OB1 with stand-ins: a 90 × 90 × 100 mm box for the body and a 12 mm cylinder for the stick. The user now has the real shifter as **one SolidWorks assembly STEP file**, `OB1-V2-ALL.STEP`. It holds the body, base, stick, all three shift plates, both knobs and the whole internal mechanism, each part already placed where it sits on the real product.

The goal is to replace the stand-ins with the real parts, **internals included**.
- The gate is an open slot, so the mechanism (springs, clips, bracket, bearings) shows through it when you look down at the shifter.
- **The user plans an exploded-view animation later.** Having every part converted, named and positioned now prepares for it.
- Spinning and option swaps must stay as fast as v1; performance is still the overriding priority. The user expects a round of speed testing and optimisation.

To do this, the converter must learn to pull individual parts out of an assembly file.

**Why the converter learns assemblies** (rather than a one-off split): every revision of this file, and every future client's product (rigs especially), will arrive as an assembly. Teaching the converter once means a new revision is "drop the file in, rerun".

The assembly also fixes a bug on the live site. 6+R Up is the same grommet as 6+R Down turned 180°, but v1 shows it unturned, so both patterns look the same (§3.3).

## 2. Goals, non-goals, anti-goals

**Goals**
1. The converter reads assembly STEP files. A model in the settings file is built from one or more named parts of a source file, which may be a single-part file or an assembly.
2. Every piece of geometry in a source file is either used by a model or explicitly left out. Anything else fails the build loudly, with a report of what was missed: name, size and position. This keeps v1's "never drop silently" rule.
3. Parts keep their positions from the CAD file.
4. By default, every part is tessellated at the same quality relative to its own size, whether it comes from its own file or from an assembly. **Each model can override its detail level**, because the internals at full detail are far too heavy (§3.4).
5. **Parts don't all have to hold up the first view.** The settings file can mark a slot as loading after the first view. Its part appears as soon as it's loaded and warmed, and nothing else waits for it.
6. The OB1 settings file uses the assembly for every part of the shifter: outside, plates and internals. The exceptions:
   - the knobs keep today's separate files;
   - the aluminium ball knob stays a stand-in sphere.
7. `npm run convert -- <productDir> --inspect` lists every part in every source, so a settings file can be written from its output. For each part it shows the name, instance count, bodies per instance, size, position and triangle count.
8. The speed sign-off on the user's devices is rerun with the real parts and passes v1's targets (v1 design §4). The size baseline is reset (§6).

**Non-goals**
- **The exploded-view animation itself.** This work only gets the parts in place for it (§5.8).
- Automatic detection of hidden parts or faces. Large client assemblies may need it later.
- Moving the stick through the gates.
- The aluminium ball knob. There's still no file for it, so the sphere stays.
- Fixing the live site serving `.glb` files without brotli. It's a separate open item that matters more now (§5.7).
- Deleting the old REV5 plate files from `assets/source/`. That's the user's call; the settings file just stops using them.

**Anti-goals (failure even if everything "works")**
- A part in the file that's neither used nor explicitly left out, and doesn't fail the build.
- Any of v1's speed targets lost (v1 design §4): a frame over 33 ms while spinning or swapping, or a first spin later than about 2 s on typical 4G (5 s on Lighthouse's slow 4G). Those targets are the bar. The before/after numbers are reported either way.
- **The internals delaying the first spin,** or shipping at a detail level nobody can see (§3.4).
- The logo flickering against the plate surface (z-fighting).
- Product names or CAD part names in code. They belong only in `products/ob1/product.json`.

## 3. What's in the file (measured 2026-11-19)

`~/Downloads/OB1-V2-ALL.STEP`: 23 MB, SolidWorks 2023, STEP AP214, millimetres, **Y-up** (the same frame as v1). It has 29 part types and 132 solid bodies.

### 3.1 How occt-import-js returns it

- `ReadStepFile` returns a **node tree** (`root.children…`, each node with a `name` and the indices of its `meshes`) and a flat `meshes` array. The current converter (`src/convert/occt.ts`) reads only the flat array.
- **Mesh positions come already placed** in the assembly's frame (millimetres). No transforms need applying.
- **Each instance of a repeated part is its own node and its own meshes.** For example, the M3×10 countersunk screw appears as 8 nodes with the same name.
- **Naming:**
  - A single-body part's mesh carries the part name; its node name is the part name too.
  - A multi-body part's meshes are **unnamed**, so a body is identified by its index within the part's node. Example: `OB1-SHPL-6R_MP_6R-DOWN` has body 0, the grommet, and body 1, the plate. This is the same order as the REV5 files.
  - Sub-assemblies show up as nodes holding named meshes. `ALI_SHIFTER_PCB_HAL` holds `ALI_SHIFTER_PCB_HAL_USB-C` (the board) and `Same_Sky_UJ20-C-R-G-TH-3-P14` (the USB-C connector).
- **Tessellation tolerance is relative to the whole file, not to each part.** Read from the assembly at today's default level, the Senna knob comes out at 13.9k triangles. From its own file it's 23.2k.
  - Calibration: today's ratio 0.001 behaves like an absolute tolerance of 0.001 × the part's largest or average dimension. On the 50 mm REV2 Round knob, the ratio gives 15.3k triangles and an absolute 0.05 mm gives 16.1k.
- A full read takes about 11 s on the user's laptop.
- **The CAD colours are useless:** everything is SolidWorks' default blue-grey. Finishes come from the settings file, as in v1.

### 3.2 Part map

Positions are assembly millimetres.

| Part name in the file | Instances × bodies | Where | Model |
|---|---|---|---|
| `ALI_SHIFTER_BODY_USB-C` | 1 × 1 | x, z ±45; y 0 to 100.25. An open-ended tube (no top or bottom) with a USB-C hole. | **housing** |
| `ALI_SHIFTER_BASE` | 1 × 1 | x ±45, z ±65, y −4 to −1 | **base** |
| `OB1-SHFT-PAD` | 1 × 1 | 90 × 90 × 1, y −1 to 0, between the base and the housing | **pad** |
| `ROD, M8` | 1 × 2 | body 0: the 8 mm stick, 171 mm long, axis at x −7.5, z 0, y 4 to 175. Body 1: a 5 × 4 × 8 pin at y 96. | **stick** |
| `hex flange nut gradea_iso_ISO - 4161 - M8 - N` | 1 × 1 | on the stick, y 143.3 to 151.3, just under the knob | **stick** (same model) |
| `THREAD COUPLER_M8x1.25` | 1 × 1 | on the stick's tip, inside the knob | **stick** (same model) |
| `socket countersunk head screw_iso_ISO 10642 - M3 x 10 - 10S` | 8 × 1 | 4 at the plate corners, heads flush with the plate top (centre y 98.1). 4 under the base (centre y 1.3). | top 4 → **plate-screws**; bottom 4 → **base-screws** |
| `socket countersunk head screw_iso_ISO 10642 - M3 x 12 - 12S` | 4 × 1 | inner plate screws, heads flush with the plate top (centre y 97.1) | **plate-screws** |
| `OB1-SHPL-6R_MP_6R-DOWN` | 1 × 2 | body 0 grommet, body 1 plate; plate y 100.25 to 103.25 | **grommet-6r-down**, **plate-6r-down** |
| `OB1-SHPL-6R_MP_6R-UP` | 1 × 2 | the same, **mounted turned 180° about Y** | **grommet-6r-up**, **plate-6r-up** |
| `OB1-SHPL-7R_V15_7R` | 1 × 6 | bodies 0–3: the OBSR logo letters (0.3 mm thick, y 102.95 to 103.25, x −5.7 to 5.4, z 29.9 to 40.5). Body 4: grommet. Body 5: plate (6.5 mm thick, y 96.75 to 103.25). | bodies 0–3 → **logo**; 4 → **grommet-7r**; 5 → **plate-7r** |
| `SHIFT_KNOB_ROUND (M12x1.25)_H`, `SHIFT_KNOB_SENNA (M12x1.25)_PRODUCTION` | 1 × 1 each | on the stick, bottom at y 151.25, axis x −7.5, z 0 | **left out** (older versions; today's REV2 files are used, §3.3) |
| Internals, all inside the housing: `ALI_SHIFTER_PCB_HAL` (board + USB-C connector), `ALI_SHIFTER_BRACKET`, the 4 die springs (2 × 8 mm OD, 2 × 6 mm OD; named "Yellow" in CAD but red on the real product), 4 ball bearings (16 bodies each: races, shields, 12 balls), 4 top spring clips, 8 button-head screws (M3×6, M3×10), 6 torque nuts (M3, M4), 2 M4×35 screws, 2 washers, 4 PCB bushings, 4 M3 hex nuts | see §3.4 | inside the housing; parts of the mechanism show through the gate | **one model per part type** (§5.4) |

The stick passes cleanly through all three gates at its CAD position, so one stick position works for every pattern.

**Every part is shown except the assembly's two old knobs.** Underside screws, the pin and the coupler are included even though they're rarely or never visible, because the exploded view will show them.

### 3.3 Checks against today's files

- **6+R plates and grommets:** the assembly's geometry is identical to the REV5 files (to within 0.05 mm). But the assembly mounts 6+R Up **turned 180° about Y**, which v1 doesn't do. Taking every plate from the assembly fixes this with no special rule.
- **7+R:** the assembly's V15 is a different design from REV5. **The user confirmed V15 is what ships**, so it replaces REV5.
- **Knobs: keep today's REV2 files.**
  - The REV2 Round knob has "OLDBOY" engraved three times around the shaft hole, and the assembly's Round knob doesn't. The user confirmed the engraved one is current.
  - The two Sennas differ only in where the hidden thread starts.
  - The REV2 knobs, placed with their origin at the assembly knobs' mount point (−7.5, 151.25, 0), coincide with the assembly knobs to within 0.03 mm (median), apart from the thread.
- **Logo:**
  - Only the V15 7+R has the OBSR logo in CAD, as four separate letter bodies. The 6+R plates have it in neither the assembly nor the REV5 files: no letter bodies, and no engraving on the plate surface.
  - **The user decided:**
    - the logo is on every plate, in the 7+R's spot: at the bottom (the side facing the driver), under the 3rd-gear gate;
    - it's laser-etched, so it shows as silver aluminium, the same on every plate finish.
  - So the 7+R's letters are reused on all three plates at the same position. They're not turned with the 6+R Up plate.
  - Rays through the logo's footprint (plus a 2 mm margin) hit solid plate on all three plates, clear of the gate and the screw holes.

### 3.4 Detail budget: why the internals need their own detail level

The table estimates triangles per part type when each part is tessellated at today's default quality relative to its own size. It comes from passes at several absolute tolerances, taking for each body the pass nearest 0.001 × its diagonal.

| Part type | Triangles |
|---|---|
| Ball bearings (4 × 16 bodies) | 208k |
| Die springs, 8 mm OD (2) | 63k |
| Die springs, 6 mm OD (2) | 54k |
| M3×10 countersunk screws (8) | 36k |
| M3×10 button-head screws (4) | 27k |
| V15 7+R plate, grommet and logo | 22k |
| M3×12 countersunk screws (4) | 20k |
| M3×6 button-head screws (4) | 19k |
| Circuit board + USB-C connector | 16k |
| Thread coupler | 12k |
| M3 torque nuts (4) | 10k |
| each 6+R plate + grommet | ~9k |
| everything else | under 6k each |
| **Whole file** | **~560k** |

v1's whole first view was ~22k triangles (~115 KB brotli). At that rate (about 5 bytes per triangle), full-detail internals alone would be over 2 MB.
- Most of it is detail that's never readable: bearing balls tessellated as finely as a knob, and helical threads on hidden screws.
- **So the internal models start at reduced detail** (§5.3). The aim is for the internals together to land near the size of the outside parts. The builder measures and tunes from there.

## 4. Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| **A. Teach the converter to read assembly files.** Parts are picked by CAD name, keep their positions, and every part must be used or explicitly left out. | The most code (settings format, converter, tests). A new revision is just "rerun", and it scales to other companies' assemblies. | **Chosen by the user (2026-11-19).** |
| B. Split the file once into separate STEP files, then keep today's converter | Needs a new tool that can write STEP (occt-import-js only reads), for example FreeCAD or CadQuery. Every revision means re-splitting by hand, and it does nothing for the next client. | Rejected. |
| C. The user exports each part separately from SolidWorks | No splitting code, but it costs the user's time on every revision. Parts must be exported in assembly positions, or the 6+R Up turn gets lost again. | Rejected. |

## 5. Design

### 5.1 Settings file: picking parts from a source

One form serves both single-part files and assemblies.

- **A source** is a STEP file with its units and up axis, as today.
  - It also lists what's deliberately left out: part names, optionally narrowed to particular instances or bodies. For the OB1, that's just the assembly's two knobs.
  - `bodyCount` goes away. The "every body is accounted for" rule below catches the same mistakes (an extra or missing body) with a better report.
- **A converted model** names its source and lists one or more **part selections**, which are merged into one mesh. A selection is:
  - **a part name**, matched against node names and mesh names at any depth in the tree. A single-part file can omit the name and mean "the whole file";
  - optionally **which bodies** of that part, by index within the part's node;
  - optionally **which instances**, when a name repeats. Instances are told apart by position, for example a box their centre must lie in. The M3×10 screw needs this (top four versus bottom four).
- **Every instance and body must be claimed exactly once**, either by one model or by the source's left-out list.
  - Unclaimed or doubly claimed geometry fails the build.
  - The report gives the part name, instance, body index, size and position, like `checkBodyMapping` does today.
  - A selection that matches nothing also fails. A renamed part in a new revision must not just vanish.
  - The rule applies per quality level, since both levels read the same file.
- **Parts are converted whole.** No hidden-face trimming beyond the knob-thread rule that already exists (`dropNearAxis`), because the exploded view will show whole parts. Detail level is the lever for size instead (§5.3).
- **Exact field names, and whether `schemaVersion` changes, are the builder's call.**
  - The viewer validates the built `product.json` too (`validateProduct` runs on load), so the validator and its types change on both sides.
  - A viewer from before this change that meets a new bundle (a stale cached `loader.js`, say) must fail gracefully to the still image, never crash. The v1 error path should already do this; the builder confirms it.

Illustrative only (not the final field names):

```jsonc
"sources": {
  "ob1": { "file": "assets/source/OB1-V2-ALL.STEP", "units": "mm", "upAxis": "y",
           "leaveOut": ["SHIFT_KNOB_ROUND (M12x1.25)_H", "SHIFT_KNOB_SENNA (M12x1.25)_PRODUCTION"] },
  "knob-round": { "file": "assets/source/SHIFT_KNOB_ROUND (M12x1.25)_REV2 (1).STEP", "units": "mm", "upAxis": "y" }
},
"models": {
  "plate-screws": { "kind": "converted", "source": "ob1",
                    "parts": [{ "part": "socket countersunk head screw_iso_ISO 10642 - M3 x 10 - 10S", "within": { "minMm": [-999, 50, -999], "maxMm": [999, 999, 999] } },
                              { "part": "socket countersunk head screw_iso_ISO 10642 - M3 x 12 - 12S" }] },
  "bearings": { "kind": "converted", "source": "ob1", "parts": [{ "part": "7804K126_Stainless Steel Ball Bearing_7804K126" }],
                "detail": { "linearMm": 0.05 } },
  "knob-round": { "kind": "converted", "source": "knob-round", "parts": [{}], "faceRules": [{ "kind": "dropNearAxis", "maxRadiusMm": 6.3, "maxHeightMm": 17 }] }
}
```

### 5.2 Reading the tree

`readStepBodies` (or its replacement) walks `root` and returns each body with:
- its part name: the mesh name if set, otherwise the nearest named node;
- its instance (node) identity and its body index within that node;
- its position and B-rep face ranges, as today.

Positions are already in the assembly frame. Axis normalisation (`normaliseAxes`) still applies per source.

### 5.3 Detail: per-part quality by default, overridable per model

- **Default:** today's levels relative to **each part's own size**, whatever kind of file it came from:
  - `default`: linear 0.001 of the part's size, angular 0.35 rad;
  - `light`: 0.002 and 0.5.

  The acceptance check: a part read from the assembly gives about the same triangle count as the same part read from its own file. The Senna and the 6+R Down plate are good test pairs.
- **Per-model override:** a model can set coarser detail. The `light` level stays coarser than the model's `default`.
  - The internal models start with overrides chosen so the internals together come to roughly the size of the outside parts (§3.4).
  - Likely candidates: the bearings (mostly balls), the die springs (helices), and the internal screws (threads).
- **How is the builder's call.** First check what occt-import-js's `bounding_box_ratio` actually measures and whether any option makes it per part. If none does, options are:
  - several read passes at absolute tolerances, with parts bucketed by tolerance;
  - one fine pass followed by per-model simplification (meshoptimizer, already a dependency).

  The override might be expressed as an absolute tolerance, a simplification error, or a triangle target. Build time matters little, but keep a full `npm run convert` of the OB1 under a few minutes.

### 5.4 The OB1 slot tree

```
housing (root, identity)                      — housing
├── base, pad          as in CAD
├── plate-screws       as in CAD              — the 8 countersunk heads in the plate top
├── base-screws        as in CAD              — the 4 under the base         (after first view)
├── logo               as in CAD (lifted)     — OBSR letters, on every plate
├── internals…         as in CAD              — one slot per internal part type (after first view)
├── plate              as in CAD              — plate-6r-down | plate-6r-up | plate-7r  (Shift Pattern)
│   └── grommet        as in CAD              — grommet-6r-down | grommet-6r-up | grommet-7r
└── stick              as in CAD              — rod + pin + flange nut + thread coupler
    └── knob           on the stick's "tip" socket — knob-round | knob-senna (REV2 files) | knob-ball (stand-in)
```

- **Internal slots:** one per part type, for example `board` (board + USB-C connector), `bracket`, `springs-8mm`, `springs-6mm`, `bearings`, `spring-clips`, `button-screws`, `nuts`, `m4-screws`, `washers`, `bushings`. That's about a dozen. The builder may merge part types that share a finish to cut requests and draws.
- **Repeated instances merge into one model** (one mesh, one draw, one request). The exploded view will need them separable again, which is a converter change at that point (§5.8).
- **"After first view" slots** are the internals and the base screws. The first view and option swaps don't wait for them (§5.6).
  - Most are hidden by the housing, so loading them late is invisible.
  - The ones visible through the gate appear a moment after the reveal. If that pop-in is noticeable in the look check, the builder moves those few into the first view.
- **The stick's `tip` socket** is at (−7.5, 151.25, 0) mm in the stick's frame, which is the assembly frame, with no rotation. That's where the assembly's knobs sit.
  - The REV2 knobs attach by their origin (bottom centre).
  - The ball stand-in keeps its `attachPointMm`.
  - The builder re-measures the point from the assembly's knob before leaving it out, to the nearest 0.01 mm.
- **The plate is placed as in CAD,** not on a socket. The body box's `plateMount` and `stickPivot` sockets, the `rod` cylinder and the `body` box go away.
- **Options are unchanged** (7 × 3 × 3 = 63 configurations). "Shift Pattern" swaps the plate and grommet models as before; "Shift Plate Style" sets the plate finish. Everything else is always on.
- **The logo must not z-fight.**
  - On the 6+R plates its top face is coplanar with the plate top, because those plates have no pocket for it.
  - Lift it slightly (for example 0.05 mm, through a socket on the housing instead of "as in CAD") or use a polygon offset on its material.
  - The builder chooses, and checks it by eye on all three plates, close up.

### 5.5 Finishes

New finishes use the existing `metal` and `matte` kinds, so no new material code is needed. Colours are starting values, to tune by eye in the look check. The user confirmed the list on 2026-11-19, correcting the springs to red and the board to black.

| Model | Finish | Value |
|---|---|---|
| housing, base | `bodyBlack` (existing) | metal `#141414`, roughness 0.55: black anodised |
| pad | new `rubber` | matte `#1a1a1a`, roughness 0.9 |
| stick (rod, nut, coupler) | `steel` (existing) | metal `#dddddd`, roughness 0.12 |
| plate-screws, base-screws, button-head screws, M4 screws | new `blackOxide` | metal `#1c1c1c`, roughness 0.4 |
| logo | new `etchedAluminium` | metal `#c4c8cc`, roughness 0.35: bare aluminium where the laser removed the coating |
| die springs | new `springRed` | metal `#a8231d`, roughness 0.45 (painted die springs) |
| bearings | new `stainless` | metal `#c8ccd0`, roughness 0.25 |
| board | new `pcbBlack` | matte `#161616`, roughness 0.6 (the USB-C connector shares it; the builder can split it out if it looks wrong) |
| bracket | `bodyBlack` | |
| spring clips, nuts, washers, bushings | new `zinc` | metal `#b5b9bd`, roughness 0.35 |
| plate, grommet, knobs | unchanged | |

### 5.6 Viewer changes

- **Slots that load after the first view.**
  - Today the first view waits for every converted model of the configuration (`convertedModelsOf` in `engine.ts`, `init`). Swaps do too, through `SwapScheduler`.
  - `applyConfiguration` assumes every slot's geometry is loaded.
  - Slots marked "after first view" must instead:
    - be left out of the first view's and swaps' wait lists;
    - load right after the first view, before the other option variants;
    - stay hidden until their model is loaded and warmed, then appear on an idle frame. Warm first, as for any part, so no frame pays a shader compile.
  - A failed load of such a part is reported as a non-fatal error and never blocks anything.
  - Stills (`src/convert/stills.ts`) must be captured with every slot shown, so the still renderer waits for these too.
- **The contact shadow's size** is taken from the root model's box when it's a primitive. Today any other root falls back to 0.1 m (`engine.ts`, `installStudio`). Size it from the real footprint instead: the base is 90 × 130 mm. The current root's geometry bounds aren't loaded yet when the studio is built, so either:
  - wait for them, or
  - have the converter record each model's bounds in the built `product.json`.
  The builder chooses.
- **The product must rest on the floor.** The base's bottom is at y −4 mm, below y = 0 where the shadow is drawn. The builder chooses how, for example by putting the floor and shadow at the resolved bounds' lowest point.
- **Draw order:** draw the outside parts before the internals (for example with `renderOrder`). That way the GPU's depth test rejects hidden internal pixels cheaply.
  - Every "as in CAD" mesh shares the same identity transform, so Three.js's default front-to-back sort by object position can't do this on its own.
- **Everything else is already generic:** slots, "as in CAD" placement, sockets, swaps, warm-up and the camera fit.
  - The scene goes from 5 slots to about 25.
  - Warm-up draws grow with models × finishes. Watch first-view time on the iPhone.

### 5.7 Size and speed

- **First view.** v1's was ~22k triangles and ~115 KB of models (brotli). The new first view adds the outside parts at roughly:
  - housing 1.4k, base 2.3k, pad 1.4k;
  - stick ~10k (with nut and coupler);
  - plate screws ~20–55k at full detail (they have threads, so a detail override applies here too);
  - logo ~1k.
- **The internals** load after the first view, at reduced detail (§3.4, §5.3).
- **No byte cap** (the user's v1 decision). The time-based targets apply:
  - first spin about 2 s after load on typical 4G, 5 s on Lighthouse's slow 4G;
  - 60 fps spin with no frame over 33 ms, plugged in and on battery;
  - no swap hitch.
- **The internals count against frame rate, not first spin.** Spinning with every part shown must hold 60 fps on the battery-throttled laptop and the iPhone.

If a target is missed, these are the levers, in order:
1. lower detail on the heaviest models;
2. move more parts to "after first view";
3. bring the `light` level forward;
4. fix brotli on the live site (the open item).

The builder measures, reports the numbers, and uses levers 1–3 as needed. **Lever 4 needs the user's go-ahead first**: brotli is an open item they haven't chosen a fix for.

### 5.8 Keeping the door open for the exploded view (later, not built now)

The exploded view will move parts (or groups of parts) apart along set directions. Nothing in this design blocks it:
- **Every part is converted whole** and stays named in the settings file.
- **Bundles are build outputs.** When the exploded view is built, the converter can keep instances separable, for example as separate meshes or a per-vertex instance id, with no change to the CAD or the settings format for existing parts.
- **Slots already carry their own transforms,** so animating a slot (or an instance within one) fits the existing resolve-then-draw path.

## 6. Proving it

Following v1's lean-test rule:
- **Converter, on the real assembly:**
  - parts are found by name, with instances picked by position;
  - an unclaimed part fails the build with a useful report;
  - a selection that matches nothing fails;
  - a doubly claimed part fails;
  - default per-part quality matches the same part from its own file (§5.3);
  - a detail override lowers the triangle count;
  - the 6+R Up grommet is the 6+R Down grommet turned 180°: its bounds mirror (centre x +1.4 versus −1.4).
- **Settings file:** the new OB1 file validates, and the broken-file cases cover the new fields.
- **Placement:** the knob sits on the stick's tip at (−7.5, 151.25, 0) for all three knob models.
- **"After first view" slots:**
  - the first view arrives without waiting for them;
  - they appear once loaded;
  - their appearance creates no new shader program.
- **Browser smoke tests (all three engines):** update the first-view list of critical GLBs (`tests/e2e/smoke.spec.ts` lists `knob-round`, `plate-6r-down` and `grommet-6r-down` today). Every other check stays: no console errors, no new shader programs or texture uploads during swaps.
- **Stills:** all 63 re-rendered with every slot shown.
- **Size baseline:** the converter will flag growth far over 10%. Reset it with `--update-baseline` only after the user sees the new size table.
- **On the user's devices,** as v1 §7.7 requires:
  - the laptop in Chrome and Firefox, plugged in and on battery;
  - the iPhone 12 Pro, including a cold start.

  The phone can only reach a deployed build, because the guest Wi-Fi blocks the laptop. **The plan is to deploy over v1 at the workers.dev address**, since v1 shows 6+R Up wrong and nothing links to it. Deploying publishes, so the builder confirms with the user right before running it.
- **Look check by eye:**
  - all three plates show the logo with no flicker;
  - 6+R Up shows its reverse gate at the opposite corner from 6+R Down;
  - the mechanism reads well through the gate;
  - the USB-C port reads as a port;
  - the screw heads sit flush.

## 7. Decided by the user

- Approach A (2026-11-19).
- The assembly is the current product for everything except the knobs; V15 7+R replaces REV5.
- Knobs stay on today's REV2 files (the Round has the engraved lettering).
- **The internals are shown,** accepting more to load, because an exploded-view animation is planned later. Speed testing and optimisation are expected as part of the work.
- The OBSR logo is on every plate, in the 7+R's spot (bottom, under the 3rd-gear gate). It's laser-etched silver aluminium, the same on every plate finish.
- The ball knob remains a stand-in until its file arrives.

## 8. Calls Claude made (for the user to check)

- **Every part is shown** except the assembly's two old knobs, including the underside screws, pin and coupler, which are never or rarely visible, for the exploded view.
- **Internals load after the first view,** so they never delay the first spin. Gate-visible ones may pop in a moment after the reveal.
- **The internals start at reduced detail,** aiming for about the size of the outside parts, then are tuned by measurement.
- **No hidden-face trimming;** detail level is the size lever, so the exploded view gets whole parts.
- **One model per part type,** with repeated instances merged. The exploded view will split them in the converter when it's built.
- **The internal finishes in §5.5:** the user confirmed them, with the springs red and the board black.
- **The other finishes in §5.5:** black anodised housing and base, dark rubber pad, polished steel stick, black screws, and etched silver aluminium for the logo.
- **Parts are picked by name,** with bodies picked by index and repeated instances picked by position. Every piece must be accounted for, and `bodyCount` goes away.
- **The knob socket is on the stick** at the assembly knobs' mount point. Everything else from the assembly is placed as in CAD.
- **The shadow is sized from the real footprint,** and the product rests on the floor at the base's bottom (y −4 mm).
- **Speed is judged against v1's time-based targets,** not a byte cap. Fixing brotli waits for the user's go-ahead.
- **The new build replaces v1** at the workers.dev address for the device sign-off, confirmed with the user before deploying.

## 9. Left to the builder

- Settings-file field names, the `schemaVersion` decision, and how instances are selected by position.
- How per-part quality and per-model detail overrides are achieved (§5.3), and the starting override values.
- How "after first view" slots are marked and scheduled (§5.6), and whether gate-visible internals join the first view.
- How the logo avoids z-fighting (§5.4).
- How the shadow learns the root's footprint, and how the product is put on the floor (§5.6).
- Whether internal part types that share a finish merge into fewer models.
- Where the assembly file lives: copy it into `assets/source/` (git-ignored) so builds don't depend on `~/Downloads`.

## 10. Needed from the user

- A photo of a first-batch anodised grey plate, still open from v1, for tuning that finish and the etched logo against it.
