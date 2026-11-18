# mini-3d-configurator v1: design

- **Date:** 2026-11-17
- **Status:** approved by the user (2026-11-17)

Supporting material:
- `docs/research/2026-11-17-reference-configurators.md`: measured teardown of the reference configurators, the store, the CAD files, and the results of the carbon-look spike.
- `docs/brainstorm/2026-11-17-brainstorm-progress.md`: the decision log.

## 1. Intent

mini-3d-configurator is an embeddable 3D product viewer. A shopper spins the product and sees their exact configuration, instead of a photo swap. The first customer is Oldboy Sim Racing (oldboysimracing.com, Shopify, Craft theme), starting with the **OB1 H-Pattern Sim Shifter**. Later it should serve other sim racing brands, including ones that sell rig-sized products made of many parts. Some of those brands are on Shopify (SPEC, Sim-Lab, Trak Racer, Moza, Simagic, Simucube, Playseat); some aren't (Corsair/Fanatec, Logitech G, Next Level Racing).

**Why it exists:** the configurators the user admires (SPEC's rig configurator, the Kona car showroom) are slow and weak on phones. Measured on the user's laptop:
- SPEC downloads ~22 MB and runs at ~24 fps.
- Kona downloads ~28 MB, runs at ~30 fps, and freezes for up to 1 s on first use.
- Both mis-frame the product on portrait phones.

**Performance is the overriding priority.** Spinning and switching options must feel instant on low-spec laptops and phones.

**v1 proves the core on its own page,** with no store connection. It must show that the viewer meets the speed targets on real devices with models converted from the user's real CAD files, through an architecture that drops into Shopify (or any site) next without a rewrite.

## 2. Goals, non-goals, anti-goals

**Goals (v1)**
1. A viewer widget that shows any OB1 configuration in 3D, spins and zooms smoothly, and switches options with no visible hitch, on the test devices in §4.
2. A conversion step that turns the user's STEP files into small web models automatically. Source file size affects only build time.
3. One settings file per product that describes its parts, options and finishes. Adding or retiring a finish is a settings edit, not code.
4. A standalone v1 page with an option picker, which the user can open on a laptop and on an iPhone.
5. Automated and real-device checks that prove the speed targets.

**Non-goals (v1)**
- Any Shopify connection: following the theme's picker, placement in the product gallery, store-page speed targets. These are the next phase.
- Price, cart or checkout on the v1 page.
- Accounts, an upload dashboard, or other companies' products.
- Interactions beyond spin and zoom (user's decision). No moving the stick through the gates, no AR, no measuring.
- Room scenes or swappable environments.
- WebGPU (later, for rigs).
- Android device testing (user's decision; the risk is accepted).

**Anti-goals (failure even if everything "works")**
- A perceivable lag or stutter while spinning, or a hitch when an option changes.
- Downloading, decoding or compiling anything at the moment a shopper clicks.
- On phones, UI covering the model, or the camera cropping the product in a portrait box.
- Payload bloat: media unrelated to the product, uncapped render resolution, duplicate fetches.
- Oldboy, the OB1 or Shopify assumptions baked into the viewer's code. "Oldboy" must not appear in code names.

## 3. Constraints

- **Browsers:** current Chrome, Edge, Firefox, Samsung Internet and Safari (Mac and iPhone; every iPhone browser uses Safari's engine). WebGL2 is required. Without it, or if the 3D fails, shoppers see still images that still change with their picks.
- **CAD input:** STEP AP214 files in millimetres. Assume very large files from future clients. The current files are all in `assets/source/`:

  | File | Contents |
  |---|---|
  | `OB1-SHPL_6RDOWN_AL_REV5.STEP` | plate (90 × 90 × 3 mm) + TPU grommet |
  | `OB1-SHPL_6RUP_AL_REV5.STEP` | plate + TPU grommet |
  | `OB1-SHPL-7R_AL_REV5.STEP` | plate + grommet (two bodies; confirm at conversion) |
  | `SHIFT_KNOB_ROUND (M12x1.25)_REV2 (1).STEP` | round knob, with M12×1.25 thread |
  | `SHIFT_KNOB_SENNA (M12x1.25)_REV2 (2).STEP` | teardrop ("Senna") knob, with thread |

- **Missing files:** the shifter body and the aluminium ball knob. Until they arrive, the settings file declares stand-ins: a 90 × 90 × 100 mm box for the body and a 44 mm sphere for the ball knob. When the files arrive, they replace the stand-ins with no code change.
- **Product context (user, 2026-11-17):**
  - The plates Oldboy sells today are 3D-printed with a carbon-fibre-textured build plate.
  - Manufacturing has just started, and the first batch is **anodized grey aluminium** (hence `_AL` in the file names).
  - Real carbon fibre comes later.
  - The carbon finishes stay in the app; the user accepted the spike's carbon as a starting point.
- **Testing:** the user's laptop has an Intel Arc integrated GPU. The user runs Chrome on it and tests Firefox by hand. The user also has an iPhone 12 Pro. There is no Mac (desktop Safari is covered only by the automated WebKit run) and no Android device.
- **Network:** the laptop's usual Wi-Fi is a guest network that blocks device-to-device traffic, so phone testing can't rely on a local server. A private claude.ai page with code and models inlined worked in the spike.
- **Repository:** the project folder isn't a git repository yet.

## 4. Speed targets (v1)

| Area | Target |
|---|---|
| Spinning | 60 fps with no frame over 33 ms. 120 fps on 120 Hz screens where the browser allows. The model moves on the next frame after the finger; coasting starts only after release. |
| Picking an option | The change shows on the next frame, with no hitch (no swap frame over 33 ms). |
| First spin | About 2 s after the viewer starts loading on typical 4G; 5 s on Lighthouse's slow 4G. The still image covers the wait. |
| Other variants | Load in the background, most likely picks first. A pick that hasn't arrived keeps the old part on screen until the new one is ready. Nothing blanks or freezes. |
| Size | No fixed cap. The first real conversion sets the baseline; the automated check flags growth over 10%. |
| Memory | No iPhone tab reloads. Textures stay small and are generated on the device (§7.4). |
| Idle | Nothing is drawn while nothing moves. Drawing stops entirely when off-screen or in a background tab. |
| Weak conditions | On a laptop running on battery, the viewer steps its quality down automatically to hold 60 fps (§7.3). |

**How these are judged (Claude's call):**
- "Over 33 ms" means longer than two screen refreshes (over 33.4 ms at 60 Hz). A single dropped frame passes; a stall of two or more refreshes fails.
- Plugged in, the spin-and-swap test must also average at least 58 fps.
- On battery, after the quality governor settles, every frame must stay within 33.4 ms and the average must be at least 50 fps. The spike's leanest carbon averaged ~56 fps on the throttled laptop, so a hard 60 isn't a fair bar there.

Deferred to the Shopify phase: unchanged page-speed scores, a still image as fast as today's main photo, and loading only after the store page finishes and the viewer is near the screen.

Evidence from the spike (OB1 round knob, 6+R Down plate and grommet, stand-in body):
- 60 fps locked with no hitch on the laptop in Chrome and Firefox (plugged in) and on the iPhone 12 Pro.
- 255 KB for the first view (140 KB of code plus about 115 KB of models, brotli).
- First view 0.4–0.55 s after the script starts.

## 5. Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| **A. Our own lean Three.js widget** | We build and maintain more ourselves, but control every byte, frame and loading step, and it scales to rigs. | **Chosen by the user.** |
| B. Google's `<model-viewer>` | Quick to adopt, but it can't swap shapes inside one model cleanly and hits a wall with multi-part rigs. | Rejected. |
| C. Pre-rendered image spins | Fast and simple to show, but spins on one axis only, needs 3,000+ images for the shifter, and can't do rigs. | Rejected. |

For where the option picker lives, three layouts were mocked up:

| Layout | Verdict |
|---|---|
| Theme menus only | — |
| Picker overlaid on the 3D | — |
| **C: picture swatches in the menus' place, with the 3D pinned at the top on phones** | The user said C makes sense. |

The user then decided:
- v1 lives on a page of its own, using C's layout.
- The widget is **only the 3D viewer**; the page owns the picker.

**Stack** (chosen by the user after weighing these):

| Option | Verdict |
|---|---|
| **Plain TypeScript + Vite, static files on Cloudflare.** One language across the converter, viewer and page, with shared settings-file types and no UI framework. | **Chosen.** |
| The same viewer, with Astro + Preact for the page | Not needed for one page. It can be added later for marketing or docs pages without touching the viewer. |
| Iframe embed (a loader inserts an iframe to a hosted viewer page) | Rejected, for four reasons: a second page load before the first view; the host can't pin it at the top on phones; the Shopify link would have to talk across frames; and dragging inside iframes is fiddlier on iPhones. Worker rendering already protects the frame rate. |

Why the viewer has no UI framework:
- It's one canvas redrawn by Three.js.
- Frameworks manage page elements, which the viewer barely has.
- They would add bytes to every host page, and a second update loop that can run on the main thread during a drag.
- They make worker rendering harder (React Three Fiber, for example).

A framework fits the future dashboard, which will be a separate app.

## 6. Decided by the user

- Performance first; mobile must be good.
- Approach A: our own Three.js widget.
- In the store, eventually: the 3D takes the main photo's spot, with an instant still image first. Not part of v1.
- v1 lives on its own page, with Shopify later.
- The viewer is separate from the option picker. The page draws the picker in C's layout. On Shopify, the theme's own picker will drive the viewer instead.
- v1 interactions are spin and zoom only.
- The speed targets in §4 (the user replaced a fixed 1.5 MB cap with time-based targets).
- Test devices and browsers (§3), with Android skipped for now.
- The plate file's second body is a TPU grommet between the gates, finished in dark matte grey.
- The spike's carbon is a good starting point. Carbon finishes stay; anodized grey aluminium is the first manufactured finish.
- A stand-in body is fine for v1.
- Stack: plain TypeScript + Vite, static on Cloudflare (the user already has an account).
- Tests stay lean: no sprawling suite. This is a visual product that doesn't handle critical data.
- The design must not paint itself into a corner when complex parts need placing at varied positions and orientations (rigs). That's the job of §7.2's assembly model.

## 7. Design

### 7.1 Overview

```
assets/source/*.STEP ──► conversion CLI ──► product bundle (static files)
                         (Node + OpenCascade      ├─ product.json  (parts, options, finishes, framing)
                          wasm + glTF-Transform)  ├─ parts/*.glb   (one per part model, per quality level)
                                                  └─ stills/*      (one image per configuration)

v1 page ──► <mini3d-viewer product="ob1">  ──────► still → current parts → warm-up → live 3D
   ▲                │                                      └► background-loads the other variants
   └── picker ◄─────┘  viewer interface: setConfiguration() in; progress / ready / error events out
```

### 7.2 The product bundle and settings file

There is one folder per product. `product.json` is the single source of truth for the viewer, the conversion step and the page picker. Its contents:

- **Parts (slots):** named slots that each hold one model at a time, arranged as a tree (see "Assembly and placement" below). For the OB1 these are `body`, `rod`, `plate`, `grommet` and `knob`. A slot's model is a converted GLB, a declared stand-in primitive (box, sphere, cylinder), or a generated part. The rod is a 12 mm steel cylinder from the plate to the knob.
- **Finishes:** named material definitions (§7.4), referenced by option values.
- **Options:** groups with ordered values, using the store's exact names and order so the Shopify connector can later map variants one-to-one. Each value says which slot models and finishes it sets.

  | Option | Values | What each value sets |
  |---|---|---|
  | Shift Knob | Aluminum \| Gunmetal, Aluminum \| Silver, Aluminum \| Blue, Carbon Weave \| Teardrop, Carbon Weave \| Round, Carbon Forged \| Teardrop, Carbon Forged \| Round | knob model (ball stand-in, Senna, Round) + knob finish |
  | Shift Plate Style | Carbon Weave, Forged Carbon, **Anodized Grey Aluminium** (new; not on the store yet; name provisional) | plate finish |
  | Shift Pattern | 6+R Down, 6+R Up, 7+R | plate model + grommet model |

  That makes 7 × 3 × 3 = 63 configurations, against 42 on the store today. The grommet's finish is fixed (dark matte grey TPU).
- **Conversion rules per source file:** which bodies map to which slot, face-removal rules (§7.5), and the quality levels to produce.
- **Framing:** the default camera angle, zoom limits and the vertical angle limit. The viewer fits the camera to any box (§7.3).
- **Default configuration:** used until the page sets one.

Field names and the exact schema are left to the builder. It should be versioned, validated when loaded, and leave room for rigs: many slots, optional add-on slots, and many options.

**Assembly and placement (built to scale to rigs).** Every placement is data in the settings file; no part position lives in code.

- **The converter normalises units and axes.** Every model leaves the converter in metres and Y-up, whatever its CAD units and up-axis (declared per source file). The OB1 files are already millimetres and Y-up.
- **Each model has an origin and named sockets.**
  - The model's origin is its CAD origin. The OB1 knob's origin is already its mount point: the bottom of its hole, on its axis.
  - A socket is a position plus a rotation in the model's own frame, where something attaches; for example, the body's `plate_mount` or the rod's `knob_mount`.
  - Sockets are declared per model in the settings file.
- **Slots form a tree.** Each slot attaches to a socket on its parent slot's current model. When an option swaps a parent's model, its children re-attach to the new model's sockets automatically. A taller body or a longer stick moves the knob with no extra rules.
- **Parts designed together can keep their CAD positions.** The STEP reader returns every part already placed in its file's coordinates (the plate and its grommet, for instance). A client's assembly file can therefore be converted with every part in place ("as in CAD" placement), while swappable parts use sockets.
- **Rotations are explicit.** Sockets and placements carry a rotation, written in degrees in the settings file and stored as a quaternion. Parts at odd angles, like an angled monitor arm or a tilted shifter mount, are data, not code.
- **Optional and repeated parts.** A slot can be optional (an add-on that stays empty unless chosen). It can also repeat across several sockets (three monitors, say), drawn with instancing so the repeats cost one draw.
- **Options can set placement values.** For example, a "mount height" option could move a socket along a rail within declared limits, for rig-style adjustable parts. The OB1 doesn't need this; the format leaves room for it.
- **The viewer resolves the tree** into world positions on each configuration change, which is cheap even for a few hundred slots. The camera fit uses the resolved bounds.

The OB1 in v1:

```
body (stand-in box)
├── plate        on the body's top socket
│   └── grommet  in place (same CAD frame as the plate)
└── rod          on the body's stick socket
    └── knob     on the rod's tip socket
```

The rod height above the plate is 78 mm, provisional until the body file arrives.

### 7.3 The viewer widget

**Packaging and embedding:**

```html
<mini3d-viewer product="ob1" style="aspect-ratio: 3/2"></mini3d-viewer>
<script type="module" async src="https://<embed host>/v1/loader.js"></script>
```

- **`loader.js`** is tiny (about 1–2 KB) and cached for a few minutes, so updates roll out quickly. It registers the element. It fetches the viewer's content-hashed files only when a viewer is near the screen; those files are cached for a year as immutable. This is the same caching split as the user's earlier Harloop embed.
- **Product IDs:** in v1 a product ID maps straight to its static bundle path (`/products/<id>/product.json`). A backend can resolve IDs later without changing the snippet.
- **Isolation:** the viewer holds no product or store knowledge. Its small amount of UI (still image, hint, stats panel) sits in a shadow root, so host page styles can't leak in.

**Public interface** (the only path the page uses, and the same one a Shopify connector will use later):
- `setConfiguration({ "Shift Knob": "…", "Shift Plate Style": "…", "Shift Pattern": "…" })`, plus a matching attribute or property.
- A read-only `product`: the options and values from the settings file, so a page can build its picker from it.
- Events:
  - `progress`
  - `ready`, when the 3D is live
  - `configurationchange`, when the model on screen matches the requested configuration
  - `error`, with a reason; the still image stays up

**Rendering:**
- Three.js on WebGL2, with the version pinned. WebGPU comes later.
- Rendering runs on a worker thread via OffscreenCanvas, falling back to the main thread where WebGL in a worker isn't available. This protects the frame rate from a store page's third-party scripts later; on the v1 page it proves the path. Pointer and wheel input are forwarded to the worker.
- It draws only when something changes (input, coasting, a swap, a resize). It pauses entirely when off-screen (IntersectionObserver) or when the tab is hidden.
- Pixel ratio is capped at 1.5.
- **Quality governor:** watches frame times, and when they exceed budget it steps down. The spike showed that resolution barely helped on a battery-throttled GPU, while removing an effect did. So the first step is the most expensive shading effect, then resolution. It steps back up when frames are stable again.
- Controls: drag to spin with damping and coasting after release; pinch or wheel to zoom (towards the cursor); no panning; a limited vertical angle so the camera can't go under the floor.
- The camera fits the whole product into whatever box it's given, portrait or landscape. The spike's fitting approach worked on desktop and on a 390 px phone.

**Loading order** (nothing is fetched, decoded or compiled at click time):
1. Show the still image for the current configuration immediately.
2. Fetch `product.json` and the current configuration's parts.
3. Compile every material, upload every texture, then **draw every material once on every geometry layout into a 1-pixel scissor of the real canvas**.
   - Compiling alone left a 92 ms hitch on the iPhone's first swap. With the warm-up draw, the worst swap was 18 ms.
   - Safari finishes preparing a shader only the first time it is drawn with each mesh layout.
4. Reveal the 3D with a short crossfade from the still.
5. Background-load the remaining part models, most likely next picks first. Warm each one up as above, spread over idle frames so warming never costs a visible frame.
6. A pick whose parts aren't ready keeps the old part on screen until they are. The builder decides whether to show a subtle loading cue.

**Failure handling:**
- If WebGL2 is missing or context creation fails, the viewer keeps the still image and still swaps stills when the configuration changes. There is a still for every configuration.
- Lost WebGL contexts are restored.

**Diagnostics:** adding `?stats` to the page address shows a panel with frame times, draw calls, triangles, canvas size, GPU name, sizes and first-view time. It's the spike's panel, kept.

### 7.4 Look

- **Studio:**
  - A dark, low-key studio generated in code (a near-black room with softboxes), matching the product photos. No HDR download.
  - Add a large bright reflection card: in the spike, metals reflected the dark room and looked too dark.
  - Backdrop: a dark radial gradient behind a transparent canvas.
- **Shadow:** a soft contact shadow under the body, drawn once, not per frame.
- **Finishes:**
  - Textures are generated on the device from a fixed seed, so they cost no download.
  - Knob weave and plate weave share one physical scale (2.4 mm tows).

  | Finish | Starting point (spike) | Must change |
  |---|---|---|
  | Carbon Weave | 2×2 twill, normal map, clear coat, per-tow fibre sheen | **Never ship fibre sheen and clear coat together as the default tier.** Together they dropped to 12 fps on the battery-throttled laptop; either alone held ~56. Find a lighter shader that keeps the look. **Wrap the weave properly on curved knobs**: box projection showed blocky seams. |
  | Forged Carbon | random chips with per-chip sheen, clear coat | Soften the chip edges on flat plates. Reduce the texture from 1024² to keep GPU memory low. |
  | Anodized Grey Aluminium (plate) | — (new) | Satin anodized metal. Tune against a photo of the first batch (the user to supply one). |
  | Aluminum Gunmetal / Silver / Blue (knob) | polished metal on a sphere stand-in | Needs the reflection card. The real file replaces the sphere. |
  | TPU grommet | dark matte grey (`#2b2b2d`, rough) | — |
  | Body (stand-in) | black anodized | — |
  | Rod | polished steel | — |

### 7.5 Conversion step (command-line tool)

Node + TypeScript, run by Claude for v1, shaped so an upload page can call it later. The spike validated this pipeline:

1. **Read and tessellate** the STEP files with occt-import-js (OpenCascade compiled to wasm). Tessellation quality is set relative to each part's size. Run files in parallel worker threads so large inputs only cost build time.
2. **Apply face rules from the settings file.** The OB1 knob rule drops any B-rep face that lies entirely within 6.3 mm of the knob's axis and in its bottom 17 mm. That removes the hidden M12 thread, about 24% of the knob's triangles.
3. **Map every body.** The settings file maps each body to a slot and finish, or explicitly drops it, for example internal mechanism parts hidden inside a housing. A body the settings file doesn't mention, or one it expects but can't find, fails the build loudly, with a report. If the body file includes the shift stick, the `rod` slot takes that model and the generated cylinder goes away, as a settings edit. The spike showed why bodies must not be dropped silently: the plate files' second body turned out to be the TPU grommet.
4. **Make texture coordinates.** Curved parts need real wrapping (§7.4). The builder chooses between a UV unwrap in this step and triplanar mapping in the shader. Because the finishes are procedural and tileable, triplanar is the first thing to try.
5. **Weld, quantize and meshopt-compress** into one GLB per part model, at a default and a lighter quality level. Spike sizes at the default level (brotli): round knob 63 KB (11.6k triangles), 6+R Down plate 35 KB (7.3k), grommet 16 KB (2.7k).
6. **Render the stills:** one image per configuration, using the viewer itself in headless Chrome, so stills match the 3D exactly. Small modern-format images, sized for the viewer box; the builder decides format and sizes. Stills are build outputs: they're regenerated whenever a model or an assembly dimension changes, so a stand-in being swapped for a real file costs only a rebuild.
7. **Write a size report** and compare it with the stored baseline. Growth over 10% is flagged.

### 7.6 The v1 page

- A standalone page that hosts the viewer and a picker built from `product.json`.
- **Layout:** C's layout, self-contained.
  - Desktop: the 3D on the left, with options and a "Your build" summary on the right.
  - Phone: the 3D fills the top half and never scrolls away, and the options scroll below it.
- **Picker:** picture swatches using the store's option names, in Oldboy's colours (dark grey, yellow buttons). Page styling only; the viewer stays unbranded.
- No price, cart or store link.
- **Hosting:** Cloudflare Workers Static Assets.
  - Cloudflare recommends it over Pages for new projects. It supports a `_headers` file for the cache rules and allows 25 MiB per file.
  - Static files only, with no Worker script in v1.
  - The user has an account; deploying needs one `wrangler login` by the user. A `workers.dev` address works until a custom domain is set up.
  - For private phone checks, the page can also be built as one self-contained file and published as a private claude.ai page; the spike's build script does this.
  - The single-file build starts its worker from a `blob:` URL, which claude.ai pages allow, so it exercises the worker path too.
  - It can't test network loading (first spin on 4G, background loading, compressed sizes), which is only proven on real hosting.

### 7.7 Proving it

Tests stay few and must earn their keep (user's direction): a few dozen at most, not a sprawling suite.

- **Conversion:**
  - the real OB1 files convert;
  - the thread rule removes the thread;
  - a body the settings file doesn't mention fails the build;
  - sizes are compared with the baseline.
- **Settings file:** the OB1 file validates, and a handful of broken files fail with clear messages.
- **Assembly:** children follow their parent's sockets when a model swaps, and units and axes are normalised.
- **No pixel-by-pixel screenshot tests.** They break with every GPU and driver; the look is judged by eye on real devices.
- **One browser smoke test per engine (Chromium, Firefox, WebKit, via Playwright),** run on every change. Each loads the page and runs a scripted spin-and-swap sequence, like the spike's speed test. Then it checks:
  - no console errors;
  - the first view arrives;
  - **no new shader program is created and no texture is uploaded during swaps after the first view.** This is a deterministic stand-in for "no hitch" that works even under software rendering;
  - sizes against the baseline.
- **Frame-time budgets are checked only on real hardware,** since headless runs use software graphics. The page's speed test reports p50, p95 and max frame times, slow swaps by name, and first-view time.
- **Real-device checks before each release:**
  - the user's laptop in Chrome and Firefox, plugged in **and on battery**;
  - the user's iPhone 12 Pro, including one cold start after force-quitting the browser. The spike's very first laptop load took 3.3 s, cause unknown.

### 7.8 Where files live, and how it scales

The system has three kinds of data. Each has its own home, so growing from one product to many companies doesn't mean moving everything at once.

| Kind | Examples | v1 | Later (many products and companies) |
|---|---|---|---|
| **Source CAD** | the STEP files (MBs to GBs per client) | On the user's machine in `assets/source/`. **Never committed to git:** big binaries bloat a repository for good. Backed up wherever the user keeps files (a private R2 bucket is an option). | Uploaded through the dashboard into private object storage (R2). |
| **Built product bundles** | `product.json`, GLBs, stills (~2 MB per product) | **Build outputs, not source.** The converter regenerates them, they aren't committed, and they deploy with the static site. | Public object storage (R2) behind Cloudflare's cache, on a custom domain. R2 charges nothing for downloads, which matters when every shopper downloads 3D files. |
| **Records** | companies, accounts, products, versions, upload status | None needed: one product, defined by its settings file. | A database. Supabase (Postgres, sign-in and storage together) or Cloudflare's D1 both fit; choose in the dashboard phase. Either way, the 3D files themselves stay in object storage, not the database. |

**What v1 does to keep the move cheap:**
- **The viewer never builds file paths itself.** A product ID resolves to a bundle URL in one place, the loader's configuration. Moving bundles from the static site to R2 changes that setting, not the viewer.
- **Each built bundle sits under a content-versioned path,** for example `/products/ob1/<version>/`. It can be cached forever, and a new version switches over in one step, with no shopper ever getting a half-updated mix.
- **Static hosting limits are fine for v1 but not for the long run.** Workers Static Assets allows 20,000 files per deploy on the free plan, and every asset change means redeploying the whole site. That's when bundles move to R2.

## 8. After v1 (context only, not in scope)

1. **Shopify connector:**
   - The viewer follows the theme's picker. The chosen variant is in the hidden `input[name="id"]` and in the `?variant=` URL.
   - Craft 15's built-in picture swatches replace the dropdowns.
   - A small theme code edit puts the viewer in the gallery's main slot.
   - The store-page speed targets apply.
2. Other platforms (custom sites, WordPress, Salesforce) through the same viewer interface.
3. Accounts, asset upload and embed codes, all driving the same conversion step.
4. Rigs: many slots, add-ons, WebGPU. Then AR.

## 9. Left to the builder

- The `product.json` schema details and field names.
- Repository layout and package manager. The tooling is decided: TypeScript, Vite, Vitest and Playwright.
- The Three.js version to pin.
- The lighter carbon shader approach, and the quality governor's thresholds and steps.
- Triplanar mapping vs UV unwrap for curved parts.
- The background-loading order heuristic, and whether to show a loading cue for not-yet-ready picks.
- Still image format and sizes.
- How input is forwarded to the worker, and the main-thread fallback detection.

## 10. Calls Claude made (for the user to check)

- **Anodized Grey Aluminium is a third plate finish in v1,** before it's on the store. Its name is provisional.
- **The widget's tag is `<mini3d-viewer>`.** It's a viewer only, so the earlier working name `<mini3d-configurator>` no longer fits.
- **Stills are rendered at build time for all 63 configurations,** and also act as the no-WebGL fallback.
- **A quality governor steps effects down before resolution,** based on the battery finding.
- **Hosting is Cloudflare Workers Static Assets** (not Pages, following Cloudflare's current advice), with a private claude.ai page as an extra route for phone checks.
- **The embed is a custom element plus a tiny `loader.js`.** The loader has a short cache; the viewer files are content-hashed and cached for a year. Product IDs map to static paths in v1.
- **The assembly model** (§7.2): sockets, a slot tree, explicit rotations, "as in CAD" placement, and optional and repeated slots.
- **What the lean test set covers** (§7.7), including no screenshot-diff tests.
- **Where files live** (§7.8):
  - Source CAD and build outputs stay out of git.
  - Bundles sit under versioned paths, behind one product-ID-to-URL lookup.
  - R2 for bundles once there's more than one product.
  - The database choice (Supabase or D1) is deferred to the dashboard phase.
- **The conversion tool is Node + occt-import-js + glTF-Transform + meshopt,** as validated by the spike.
- **How frame targets are judged** (§4): a single dropped frame passes. On battery, the bar is "no stall, at least 50 fps average".
- **Bodies in a CAD file are mapped or explicitly dropped,** never dropped silently (§7.5).
- **Stills are regenerated on every model or dimension change** (§7.5).

## 11. Needed from the user (not blocking the start)

- The shifter body STEP file. **The user confirmed the stand-in box is fine for v1** (2026-11-17). Speed sign-off and the size baseline are rerun when the file arrives.
- The aluminium ball knob STEP file. Until then, the stand-in sphere.
- A photo of an anodized grey aluminium plate from the first batch, for tuning its finish.
- ~~A Cloudflare account~~: **the user already has one** and is open to other hosts. Deploying needs a one-time `wrangler login` by the user.
