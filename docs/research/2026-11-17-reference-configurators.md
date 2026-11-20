# Reference configurator teardown (2026-11-17)

## Test setup

- Linux, Chrome 157, **Intel Arc integrated GPU** (Arrow Lake, Mesa via ANGLE), WebGPU available.
- 1920×1047 window at devicePixelRatio 2. A reasonable proxy for a typical mid/low-end laptop.
- Payloads from the Resource Timing API (decoded sizes; transfer sizes read 0 because of cache).
- Frame times from requestAnimationFrame interval sampling over 3–8 s windows; drags scripted through Claude in Chrome.
- Phone layouts checked with 390×740 iframes inside a plain page (layout only; still the desktop GPU, not a phone GPU).

## SPEC configurator: configurator.specsimulations.com

| Item | Finding |
|---|---|
| Stack | Three.js r170, Vite bundle (vendor-three 1.4 MB + app 0.9 MB decoded JS) |
| Payload | ~21.8 MB decoded: KTX2 textures 13.7 MB (35 files, all 2K: albedo/normal/roughness/AO per material, plus a 2K albedo per anodized colour); GLB 3.4 MB (6 files, room 1.6 MB, seat 0.6 MB); HDR env 1.4 MB; wasm 0.5 MB (Draco + Basis) |
| Load timing | 3D assets begin downloading ~7.5 s after navigation start |
| Render size | 3840×1970 backing store for 1920×985 CSS px: full DPR 2, ~7.6 M px per frame |
| Idle (auto-spin) | ~24 fps; p50 33 ms, p95 67 ms, max 182 ms |
| Dragging | ~24 fps; p95 133 ms, max 417 ms |
| Colour swap | No hitch beyond baseline: every colour's albedo is preloaded; only an `/api/inventory` call |
| Adding triple monitor stand | Lazy-loads `32-triple.glb` (1.5 MB, Draco) + Draco decoder + ~2 MB more 2K textures; frames of 150–333 ms |
| Features | Main + accent colour, priced add-ons, environments (living room / terrace / race track), measure mode, pause spin, scroll-driven copy, per-colour preorder dates, state persisted across reloads |
| Phone (390 px) | Bottom sheet covers ~70% of the screen; camera not reframed, so the visible strip shows a window rather than the rig; swatch rows overflow sideways with visible scrollbars |

## Kona Digital Studio: car-showroom-bice.vercel.app

| Item | Finding |
|---|---|
| Routing | `/worldpremiere/en` 404s on direct load (missing SPA rewrite); the root loads and client-routes there |
| Stack | Three.js r175, Vite |
| Payload | ~28 MB decoded across landing + configurator: car GLB 7.2 MB, wheel GLB 1.4 MB, MP3 8.7 MB (background music, 50 requests), MP4 6.4 MB (25 requests; `svm.mp4` fetched 3×), fonts 1.2 MB, HDR 0.95 MB |
| Render size | 2880×1486 for 1920×991 CSS px: DPR capped at 1.5, ~4.3 M px (44% fewer than SPEC) |
| Idle | ~30 fps; p50 19 ms, p95 83 ms, max 417 ms |
| Dragging | One short scripted sample: ~16 fps, p50 50 ms (noisy; user reports Kona feels smoother by hand) |
| Switch to Interior | No network, but frames of 467 / 606 / 1017 ms: first-use shader compile / material setup |
| Phone (390 px) | Camera not refit for portrait; car cropped off both sides |

## Takeaways

Worth copying:
- Load and pre-warm every variant up front so swaps cost nothing (SPEC's colour swaps).
- Cap render resolution (Kona). The biggest single win on integrated GPUs.

Worth avoiding:
- Uncapped devicePixelRatio and continuous full-resolution rendering.
- Loading/decoding on click: download, decode and GPU upload freeze the frame at the moment of interaction.
- First-use shader compilation.
- Media unrelated to the product (music, video, whole rooms) on the critical path; duplicate fetches.
- Desktop-first camera framing; UI sheets that cover the model on phones.

## Oldboy store: oldboysimracing.com

- Shopify, theme "Craft" (Online Store 2.0). 8 products, all small hardware. Prices in AUD.
- **OB1 H-Pattern Sim Shifter** (`usb-sim-racing-shifter-with-pre-assembled-upgrade-kit`), AUD 196–211, 42 variants:
  - Shift Knob ×7: Aluminum Gunmetal / Silver / Blue; Carbon Weave Teardrop / Round; Carbon Forged Teardrop / Round
  - Shift Plate Style ×2: Carbon Weave, Forged Carbon
  - Shift Pattern ×3: 6+R Down, 6+R Up, 7+R
  - 75 product images; every variant has its own photo. Options picked with dropdowns.
- Upgrade kit: 32 variants (pattern ×4, plate ×2, spring load ×4).
- Also: shift knobs (2–3 finishes each), headphone stand (4 colours), Simagic P2000 pedal shaker mounts, Stream Deck faceplate.
- Product page loads 405 requests, 83 of them scripts (Klaviyo, Loox reviews, Lucky Orange session recording, Shopify telemetry). An attempt to time main-thread frames was spoiled by the Klaviyo popup (rAF throttled to ~1 Hz with no script attribution), so that measurement is inconclusive.

## Source CAD files (`assets/source/`)

All STEP AP214, millimetres, exported from the user's CAD tool.

| File | Size | Bodies | Bounds (mm) | Surfaces |
|---|---|---|---|---|
| OB1-SHPL_6RDOWN_AL_REV5 | 1.2 MB | 2 (`Chamfer11`, `6R UP PLA`) | 90 × 96.6 × 90 | 147 planes, 177 cylinders, 48 cones, 76 B-spline |
| OB1-SHPL_6RUP_AL_REV5 | 1.2 MB | 2 (same names) | 90 × 96.6 × 90 | same as above |
| OB1-SHPL-7R_AL_REV5 | 1.3 MB | 2 (`PLA`, `Chamfer12`) | 90 × 3.4 × 90 | 155 planes, 159 cylinders, 78 cones, 76 B-spline |
| SHIFT_KNOB_ROUND (M12x1.25)_REV2 | 4.0 MB | 1 (`CirPattern5`) | 35.3 × 50.9 × 70.6 | 224 B-spline + a few analytic |
| SHIFT_KNOB_SENNA (M12x1.25)_REV2 | 4.2 MB | 1 (`Wrap3`) | 45.2 × 74.0 × 45.1 | 227 B-spline + a few analytic |

Notes:
- The plate is a 90 × 90 × 3.4 mm part. The 6+R files contain geometry about 93 mm off the plate, so the conversion step needs a rule for which bodies to keep.
- Knob files include the M12×1.25 thread, which is hidden when mounted and should be stripped.
- Files are named `_AL`, but the product sells carbon weave and forged carbon plates. Same geometry, material-only difference.
- No file yet for the aluminium ball knobs (Gunmetal / Silver / Blue) or the shifter body. A placeholder box is fine for the body for now.

## Store platforms of other brands (checked 2026-11-17)

Homepage HTML and headers fetched with curl and checked for platform fingerprints.

| Platform | Brands |
|---|---|
| Shopify | SPEC, Sim-Lab, Trak Racer, Moza, Simagic, Simucube, Playseat |
| Custom Next.js + Contentful | Corsair, Fanatec (Corsair owns Fanatec; same stack) |
| Custom Next.js | Next Level Racing |
| Salesforce Commerce Cloud | Logitech G |
| WordPress / WooCommerce | Heusinkveld; Asetek is on WordPress |
| Unknown | Thrustmaster (blocked the request) |

Takeaway: most mid-size sim racing brands use Shopify, but the biggest ones don't, so the widget core must not depend on Shopify.

## Oldboy theme details

- Craft **15.0.0** (Shopify-made, shares Dawn's code). Product section uses colour scheme 1: background rgb(75,75,75), white text, yellow (255,238,0) buttons.
- Layout classes: `product--large product--left product--thumbnail_slider product--mobile-show`. That means a large gallery on the left, a thumbnail strip under it, thumbnails shown on phones, and options as three dropdowns.
- The chosen variant lives in a hidden `input[name="id"]` in the product form (and in the `?variant=` URL). A widget can follow the theme's picker by watching it.
- Shopify requires Theme Store themes to support picture/colour swatches on option values (`swatch.image`, `swatch.color`). Craft 15's code includes swatch styles, so picture swatches should be a settings change, not custom code.
- The media gallery isn't a drag-and-drop block area. Putting our widget in the main photo's spot needs a small edit to the theme's code; app blocks and Custom Liquid blocks only go in the info column.

## Carbon look spike (2026-11-17, throwaway, `spikes/carbon-look/`)

Real round knob and 6+R Down plate from the STEP files, a stand-in box body and rod, carbon finishes generated on the device, and a dark softbox studio generated in code.

### Conversion (occt-import-js 0.0.23 + glTF-Transform 4.5 + meshopt)

- OpenCascade (wasm) reads each STEP file in 1–2 s. The models are Y-up and in mm. The knob's hole sits at local y = 0.
- **Thread stripping works with a simple rule:** drop any B-rep face that lies entirely within 6.3 mm of the axis and in the bottom 17 mm. It removes 24% of the knob's triangles.
- Sizes after quantize + meshopt (brotli in brackets):

| Part | Level | Triangles | GLB |
|---|---|---|---|
| Round knob | fine / **medium** / coarse | 19,540 / **11,641** / 7,193 | 140 / **94** / 67 KB (88 / **63** / 45) |
| 6+R Down plate | fine / **medium** / coarse | 10,658 / **7,252** / 5,494 | 87 / **65** / 52 KB (46 / **35** / 31) |
| Plate file's 2nd body | medium | 2,687 | 27 KB (16) |

- UVs had to be scaled into 0–1, or quantization skips them.
- **The plate file's second body is a TPU grommet** that fits between the shifter gates, lining the H-gate slot. **It should be dark matte grey** (user, 2026-11-17).
  - So the conversion step's rule is to keep every body and give each one its own material slot, not to pick one body. The "extra body ~93 mm away" noted earlier was this grommet, read with a different transform.

### Speed: Intel Arc iGPU, Chrome 157 (Mesa via ANGLE), 1920×991 window at DPR 2

- **60 fps locked**: 361 frames over 6 s of spinning, with 12 finish swaps along the way.
  - At 1.5× (2370×1486): p95 16.8 ms, max 16.8 ms.
  - At 2× (3160×1982): p95 16.8 ms, max 21.0 ms.
  - Zero frames over 33 ms. The worst swap frame was 16.7 ms, so swaps cost nothing.
- 5 draw calls, 19k triangles, 0.2–0.3 ms of JS per frame.
- Start-up (performance marks): studio environment 40 ms; weave texture 17 ms and forged texture 40 ms (warm); shader compile 33 ms warm and 115 ms with the shader cache forcibly missed. **First view 0.4–0.54 s** after script start.
- The very first load in this browser session took **3.3 s** to first view, unexplained. It's probably one-time GPU process or context start-up, since a forced shader-cache miss later cost only 115 ms. Recheck on the iPhone with a cold start.
- **Shipped code:** the spike bundled with esbuild is 666 KB minified, **140 KB brotli** (Three.js core, GLTFLoader, OrbitControls, meshopt decoder).
- **First-view payload:** about 255 KB brotli all in (code + knob + plate + liner), which is roughly 1.3 s on Lighthouse slow 4G.

### User's own runs (laptop, 2026-11-17)

| Browser | avg fps | p50 / p95 / max frame | Worst swap frame |
|---|---|---|---|
| Firefox | 60.2 | 17.0 / 17.0 / 18.0 ms | 17.0 ms |
| Chrome | 59.8 | 16.7 / 16.8 / 33.2 ms | **33.2 ms** (one dropped frame on a swap) |

- The user said the model "feels really smooth".
- Chrome's single 33 ms swap frame is a borderline miss of the "next frame, no hitch" target. Watch for it in the real build, for example a first-use texture upload or GC at swap time.
- Firefox coarsens `performance.now()`, so its JS-per-frame figure reads 0.00 ms.

### iPhone 12 Pro (Safari, via the private claude.ai page, 2026-11-17)

- 58.9 avg fps; frame p50 and p95 17 ms, so steady spinning is fine.
- **Max 92 ms, with 2 frames over 33 ms. The worst swap frame was 92 ms.** Swaps hitch on the iPhone, breaking the "next frame, no hitch" target.
- Hypothesis: `compileAsync` isn't enough on Safari (ANGLE on Metal), which finishes building a pipeline the first time a shader is drawn with each vertex layout. The fix was a warm-up draw of every material × geometry into a 1-pixel scissor of the real canvas before first view (`#nowarm` skips it).
- **Confirmed.** With the warm-up draw: 59.8 avg fps, p50 and p95 17 ms, max 21 ms, zero frames over 33 ms, 12 swaps with the worst at 18 ms, no slow swaps.
- **Design rule:** warm up by actually drawing every material on every geometry layout (scissored to 1 px), not just by compiling.

### Laptop on battery: a shader cliff (2026-11-17)

Unplugged, the GPU clock was 550 MHz and the same scene ran at **12 fps** (87 ms frames). An empty rAF loop ran at 60 Hz, so the browser isn't throttling.

| Carbon effects on | avg fps (battery, 1.5×) |
|---|---|
| fibre sheen (anisotropy) **and** clear coat | **12** (also 12 at 1×, so it isn't pixel count) |
| clear coat only | 55.8 |
| fibre sheen only | 55.3 |
| neither | 55.7 |

- Either effect alone is cheap. **The combination falls off a cliff** on a throttled Intel iGPU, likely register pressure in the combined shader.
- Plugged in, the same combination ran at a locked 60.
- Design implications:
  - Keep the carbon shader lean: one of the two effects, or a custom lighter carbon shader.
  - Have a runtime quality fallback that drops effects when frame times rise, since shoppers on unplugged laptops are common.

### Look

- **Carbon weave plate: convincing.** It uses a procedural 2×2 twill (2.4 mm tows) with a normal map, per-tow anisotropy direction (fibre sheen) and clear coat.
- **Weave on the curved knob: not convincing.** Box-projected UVs make blocky seams where the projection axis changes. Production needs proper wrapping, either a UV unwrap in the conversion step or triplanar mapping in the shader.
- **Forged carbon: reads as forged carbon.** The chips may be too sharp-edged and contrasty on the flat plate. The random pattern hides the knob's seams.
- **Metals look too dark in the low-key studio,** because they reflect a dark room. A large bright reflection card in the studio is likely needed.
- Device-generated textures cost 0 KB to download and ~12 MB of GPU memory. Forged at 1024² accounts for 11 MB; it could drop to 512².

## v1 sign-off (live URL, 2026-11-17)

Site: https://mini3d.jamesdong.workers.dev/?stats (bundle version `01e32fd6f01a`). Each run is the stats panel's speed test: 6 s of spinning with a swap through the knob, plate style and pattern every 500 ms.

Targets (spec §4):
- Plugged in: avg ≥ 58 fps, no frame over 33.4 ms, no slow swaps.
- On battery, after one run lets the quality governor settle: avg ≥ 50 fps, no frame over 33.4 ms.

| Device and browser | Power | Frames | Avg fps | p50 / p95 / max ms | Over 33.4 ms | Worst swap | Slow swaps | Verdict |
|---|---|---|---|---|---|---|---|---|
| Laptop (Intel Arc iGPU), Chrome | plugged in | 354 | 58.9 | 17.0 / 18.0 / 19.0 | 0 | 18.0 ms | none | **pass** |
| Laptop, Firefox (user's run) | plugged in | 361 | 60.0 | 17.0 / 17.2 / 17.3 | 0 | 17.2 ms | none | **pass** |
| Laptop, Chrome (user's run) | battery (AC off, 65%) | 360 | 60.0 | 16.7 / 16.8 / 16.8 | 0 | 16.8 ms | none | **pass**: the governor stayed on the full tier at DPR cap 1.5 |
| iPhone 12 Pro, Safari (user's run) | phone | 353 | 58.7 | 17.0 / 18.0 / 26.0 | 0 | 18.0 ms | none | **pass** |

| iPhone 12 Pro, Safari, first view ("3D shown … after page start") | Result | Verdict |
|---|---|---|
| Cold start (Safari force-quit, then the URL opened) | **757 ms** | pass |
| On mobile data (4G) | **550 ms** (target ~2 s) | pass |

Neither iPhone run cleared Safari's HTTP cache, so they likely measure a returning visitor with the year-cached code and parts. A true first visit is covered by the emulated slow-4G test below (3.0 s, nothing cached).

The laptop's stats panel at the battery run showed:
- `first view 776 ms after init`;
- `3D shown 1257 ms after page start`;
- `code 184 KB as served`. That is more than the 148 KB measured from the build with maximum-quality brotli, because Cloudflare compresses on the fly at a lower level.
- `3D files 342 KB`: all eight default parts, uncompressed (see the hosting notes).

The battery run held 60 fps on the **full** tier. The spike's battery cliff (12 fps) came from fibre sheen (anisotropy) combined with clear coat, and v1 never uses anisotropy.

Automated checks before deploy (headless, software rendering, so no frame budgets):
- Playwright smoke tests: Chromium 8/8, Firefox 7/7, WebKit 7/7, with the slow-4G test skipped outside Chromium.
- Emulated slow 4G (1.6 Mbps, 150 ms RTT): the loader, viewer code, `product.json` and the first view's three GLBs finished in **3.0 s** (target < 5 s).

Live hosting notes:
- JS and JSON are served brotli-compressed.
- `.glb` files are served **uncompressed**: Cloudflare doesn't compress `model/gltf-binary`. They are already meshopt-compressed, but brotli would still save 40%: the first view's three parts are 126 KB as served versus 75 KB with brotli, and all default-level parts 342 KB versus 205 KB. Worth fixing before the Shopify phase, either by serving them with an encoding Cloudflare compresses or by pre-compressing.
- The speed-test result doesn't say which quality tier it ran at; the stats panel's `render` line does (a deferred minor).

## Assembly import sign-off (live URL, 2026-11-20)

The OB1 now comes from the CAD assembly: 23 parts instead of v1's 8.
- **Outside:** housing, base, pad, USB-C port and plate screws.
- **Plates:** the REV5 plates and grommets, with the logo.
- **Stick and knobs.**
- **Seen through the gate:** the mechanism and the board.

Site: https://mini3d.jamesdong.workers.dev/?stats, bundle `f8c06edc5347`, deployed 2026-11-20. Plan: `docs/superpowers/plans/2026-11-19-assembly-import.md`. Same speed test and targets as the v1 sign-off above.

| Device and browser | Power | Build measured | Frames | Avg fps | p50 / p95 / max ms | Over 33.4 ms | Worst swap | First view | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| Laptop (Intel Arc iGPU), Chrome | plugged in | `c5ae3733c66c`, local preview | 361 | 60.0 | 16.7 / 16.8 / 16.8 | 0 | 16.8 ms | not recorded | **pass**: full tier, DPR cap 1.5 |
| Laptop, Chrome | battery | `c5ae3733c66c`, local preview | not recorded | 59.8 | not recorded / 16.8 / 19.0 | 0 | 16.7 ms | not recorded | **pass** on the second measured run (see below) |
| Laptop, Firefox (user's run) | plugged in | `ecc085ad1fc6`, live | 361 | 60.0 | 17.0 / 17.2 / 17.4 | 0 | 17.2 ms | 369 ms after init; 3D shown at 803 ms | **pass** |
| iPhone 12 Pro, Safari, Wi-Fi (user's run) | charging | `ecc085ad1fc6`, live | 353 | 58.8 | 17.0 / 18.0 / 18.0 | 0 | 18.0 ms | 205 ms after init; 3D shown at 531 ms | **pass** |
| iPhone 12 Pro, Safari, 5G, Safari force-quit first (user's run) | charging | `ecc085ad1fc6`, live | 351 | 58.5 | 17.0 / 18.0 / 19.0 | 0 | 18.0 ms | 217 ms after init; 3D shown at 455 ms | **pass** |

"3D shown" is measured from page start. No run had a slow swap.

Notes on the runs:
- **Builds measured.**
  - The laptop Chrome runs measured `c5ae3733c66c` (580.1 KB, 112,495 triangles in the default scene). That was before the final review simplified the stick and the USB-C port.
  - The phone and Firefox runs measured `ecc085ad1fc6` (541.4 KB, 86,503 triangles).
  - The live `f8c06edc5347` is 514.9 KB. It adds the REV5 plates and the 6+R Up stick fix. It wasn't speed-tested again; it has the automated checks and the user's look check below.
- **Background apps.** The first plugged-in runs (57.7 and 56.3 fps, max 35.9 ms) had Discord, Steam and other apps running. Live v1 did worse in the same minutes. The table's runs were made with those apps closed.
- **Battery.** The quality governor settled at lean / DPR 0.75 on this build, and on live v1 in the same minutes. v1 held the full tier on 2026-11-17, so the laptop's own state is what changed.
  - The first measured run had 3 frames of about 36 ms (55.0 fps). Those frames are the governor trying one level up and failing; it then waits 60 s before trying again.
  - v1 showed the same frames under the same conditions.
- **iPhone caching.** As in v1, the iPhone runs likely came from Safari's HTTP cache, since the bundles are cached for a year. The emulated slow-4G test below covers a true first visit. A first visit in a Private tab on 5G wasn't measured.
- **Firefox downloads.** Firefox downloaded 877 KB of 3D files. That is every part, because background loading also fetches the variants. `.glb` files are still served uncompressed (see the hosting notes above).

Sizes of `f8c06edc5347` (brotli, default level):

| Group | Parts | KB |
|---|---|---|
| Always shown: housing, base, pad, USB-C port, plate screws, logo, stick | 7 | 137.2 |
| Variants: 3 plates, 3 grommets, 2 knobs | 8 | 206.3 |
| After first view: board, bracket, springs, bearings, mechanism screws, base screws, 2 hardware sets | 8 | 171.4 |
| **Total** | **23** | **514.9** |

- **Total size.** v1 was 210.3 KB for 8 parts.
- **First view.** The default first view (always-shown parts, the 6+R Down plate and grommet, and the Round knob) is 212.8 KB, against v1's 76.5 KB.
- **After first view.** The internals load after the first view, and no swap waits for them.
- **Size baseline.** It is `ecc085ad1fc6` at 541.4 KB; the live build is 4.9% under it.

Automated checks on `f8c06edc5347`:
- Unit tests 65/65; typecheck clean.
- Playwright: Chromium and Firefox 23/23; WebKit 11 passed, 1 skipped (slow 4G runs only in Chromium).
- Emulated slow 4G (1.6 Mbps, 150 ms RTT): the first view's 10 parts finished in **4.28 s** over two runs (target < 5 s; v1 took 3.0 s with 3 parts).
- After the deploy, headless Chromium on the live site:
  - the pointer and product were `f8c06edc5347`;
  - the viewer reached `ready` and showed every after-first-view part;
  - there were no viewer or console errors.

Look check (the user, on the live site, 2026-11-20): **passed**.
- The stick rests in the right neutral on all three patterns. On 6+R Up, the stick and its mechanism turn 180° so it rests between gates 3 and 4.
- The logo shows on all three plates without flicker.
- The springs read as red, the board as black, and the USB-C port as a port.
- The screw heads sit flush.
- The internals appearing after the first view isn't noticeable.
