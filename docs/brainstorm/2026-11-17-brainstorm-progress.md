# Brainstorm progress (2026-11-17)

Planning session for mini-3d-configurator. No code has been written yet. This note is the handoff for resuming the brainstorm in a new session.

## Where we are

1. ✅ Recon: measured both reference configurators, the Oldboy store and the CAD files. See `docs/research/2026-11-17-reference-configurators.md`.
2. ✅ Purpose and audience played back; no corrections given.
3. ✅ User chose how the 3D appears on the page.
4. ✅ User chose the build approach (A, below).
5. ✅ Speed targets settled, with the user's corrections (see Speed targets below).
6. ✅ Open questions settled. Page layout: v1 on its own page with C's layout. Look: the spike's carbon is the starting point, plus anodized grey aluminium.
7. ✅ **Design approved by the user** (2026-11-17): `docs/superpowers/specs/2026-11-17-mini3d-viewer-v1-design.md`.
8. ✅ **Implementation plan written:** `docs/superpowers/plans/2026-11-17-mini3d-viewer-v1.md` (14 tasks, 3 milestones). Commit steps were removed at the user's request: the user reviews and commits by hand.
9. ⏭ **Next session: build it.** The user will start the build in a new session.
   - Execution method is still to choose: native (Claude's recommendation) or subagent-driven.
   - Start by reading the plan, then the design.

## Brainstorm closed (2026-11-17)

Not blocking the start:
- the shifter body STEP file (stand-in box until then);
- the aluminium ball knob STEP file (stand-in sphere);
- a photo of the anodized grey plate, used in the Task 7 look checkpoint.

During the build:
- Task 13: the user runs `npx wrangler login` once.
- Task 14: the user does the iPhone and Firefox checks.
- The "Anodized Grey Aluminium" name is provisional.
- The user is creating the git repository and `.gitignore` by hand. The plan no longer sets up the repository.

## What it is and why

An embeddable 3D product configurator: a widget that drops onto any site, Shopify first. Shoppers spin the product and see their exact configuration instead of a photo swap.

- **First customer:** the user's own store, Oldboy Sim Racing (oldboysimracing.com, Shopify "Craft" theme).
- **Later:** other sim racing companies, e.g. Fanatec or Corsair, with rig-sized products (many parts, add-ons, possibly room scenes like SPEC). Not the focus now, but nothing may rule it out.
- **Long-term:** accounts, asset upload and embed codes for other companies.
- **The flaws to beat:** the reference sites (SPEC, Kona) perform poorly and are weak on mobile.

## Decided by the user

- **Performance comes first.** Swiping must move the configurator with no perceivable lag, even on lower-spec machines. Mobile must be good.
- **Assume worst-case, large source files.** Client CAD can be huge.
- **The 3D loads with the page,** taking the main photo's spot. A still image of the current configuration shows instantly, and the 3D takes over once ready and on screen. (Chosen over a "Customize in 3D" button.)
- **Approach A: our own lean Three.js widget.** Chosen over Google's model-viewer (can't swap shapes cleanly, hits a wall with rigs) and over pre-rendered image spins (one-axis spin only; 3,000+ images for the shifter; no rigs).
- **Name is generic:** project renamed to mini-3d-configurator. Oldboy is the first customer, not the product name.
- **Assets:** the user has STEP files for the three top plates and two knob shapes. A plain box stands in for the shifter body until its file arrives.

## Proposed by Claude, not contested so far (confirm when writing the design)

- **v1 scope:** the OB1 H-Pattern Sim Shifter on its product page. 42 variants = 7 knobs × 2 plate materials × 3 shift patterns. This also covers knobs and plates, which are sold separately.
- **Shaped for other companies from day one:** each product is a bundle of optimised 3D files plus a small settings file. A later account and upload dashboard just produces those, so it's an add-on, not a rewrite.
- **Two-way sync with Shopify:** picking in 3D updates the theme's option menus and Add to Cart, and vice versa.
- **Automatic shrinking step:** every source file passes through it before shoppers download anything. It tessellates the CAD, strips hidden detail (e.g. the knob's M12 thread), compresses, and makes lighter versions for weaker devices. Source file size only affects build time. For v1 it's a command-line tool Claude runs; an upload page comes later.
- **Rig-scale loading:** likely next picks load in the background. If a pick isn't ready, that part appears a moment later, but the view never freezes or stutters.
- **Approach A details:**
  - A custom element (tag name like `<mini3d-configurator>`) loaded from one small script.
  - Rendering on its own worker thread (OffscreenCanvas, falling back to the main thread), so the store's ~83 third-party scripts can't stall it.
  - WebGL2 now; WebGPU later for rigs.
  - Capped pixel ratio, dropped further while dragging and restored on release.
  - Draw only when something changes; pause off-screen and in background tabs.
  - Pre-load every variant and pre-compile shaders (`renderer.compileAsync`) before the first view, so swaps take one frame.
  - The camera fits the product to whatever box it sits in, portrait or landscape.
- **Possible later:** AR "view on your desk", by exporting the current configuration as a file the phone opens.

## Speed targets: settled

### User corrections (resumed session, 2026-11-17)

- **The 1.5 MB download cap is arbitrary. Drop it.** Claude proposed replacing it with:
  - A time to first spin: about 2 s on typical 4G, and 5 s on Lighthouse's slow 4G.
  - Background loading of the other variants. If a variant isn't ready when picked, the old part stays on screen until the new one arrives.
  - A size baseline set by the first real conversion, with the automated test flagging growth over about 10%.
  - Phone GPU memory as the real hard limit (iOS reloads the tab when memory runs out), so textures stay compressed on the GPU.
- **The Intel Arc laptop is just the user's machine, not the target. Other browsers such as Firefox matter.** Claude proposed:
  - Support for current Chrome, Edge, Firefox, Samsung Internet and Safari (Mac and iPhone; all iOS browsers use WebKit).
  - Browsers that can't run the 3D keep the still images and the theme's option menus.
  - Automated tests in Chromium, Firefox and WebKit via Playwright.
  - Frame-rate numbers taken only on real hardware.
  - Device tiers: a weak-graphics laptop, a budget Android phone and an older iPhone.
- Answered: the user has an **iPhone 12 Pro** for real Safari checks and will do the **manual Firefox testing** themselves.
  - There is no Mac, so desktop Safari gets no manual checks. Claude's call: it's still supported, because it shares iPhone Safari's engine and the automated WebKit run covers it.
- Rig "first view under ~3 MB" dropped for the same reason. Rigs follow the same time targets instead.
- **Android: skipped for now (user's decision).** No budget Android test device. The risk on cheap Android phones is accepted for now; Claude had recommended buying one (~A$250, Galaxy A16 class).

### Original proposal

Ask the user what's wrong or missing before moving on.

- **Test devices:** this Intel Arc laptop, an Android phone around A$250 (Galaxy A16 class), an iPhone 12.
- **While spinning:** 60 fps; no single frame over 33 ms; aim for 120 fps on 120 Hz screens where the browser allows. The model moves on the next frame after the finger does; the coasting spin only starts after release.
- **Picking an option:** the change shows on the next frame, with no hitch.
- **Download:** everything for the shifter (code, models, materials, lighting) under 1.5 MB total.
- **The store page:**
  - The still image appears as fast as the current main photo.
  - 3D loading starts only after the page finishes its own loading, and only once the widget is near the screen.
  - Google page-speed scores don't change; the widget's box is reserved so nothing jumps.
- **Idle:** nothing drawn while nothing moves; fully paused off-screen or in a background tab.
- **Rigs later:** same frame rules; first view under ~3 MB; add-ons load in behind it.
- **Proving it:**
  - A hidden on-screen stats panel.
  - A repeatable automated test that runs a set spin-and-swap sequence and fails on any broken budget.
  - Real-phone checks before each release.

## Product page layout: in discussion (2026-11-17)

- Mockups shown: A (theme menus only), B (picker on the 3D), C (picture swatches in the menus' spot, with the 3D pinned at the top on phones). The user said **C makes sense**.
- **The user proposes re-scoping v1:** a standalone viewer with a few predetermined options, with Shopify integration coming later. They're unsure whether other brands use Shopify (recon: most mid-size brands do; Corsair/Fanatec, Logitech and Next Level Racing don't; see the research doc).
- Claude's points: the core should be platform-free either way, with Shopify as the first connector. Following the theme's picker one way is cheap. Craft 15's built-in swatches can give C's look with no code. Placing the widget in the gallery needs a small theme code edit.
- **Decided by the user: v1 lives on its own page**, not on the store. It has its own swatch picker in C's layout and no Shopify connection. Shopify (following the theme's picker, built-in swatches, gallery placement) comes after v1.
  - This moves the store-page speed targets (page-speed scores, loading after the store page) to the Shopify phase. The frame, swap, first-view and memory targets still apply to v1.

### v1 page: viewer and option picker are separate (user's call, 2026-11-17)

- **The widget is only the 3D viewer.** The option picker is part of the page. On Shopify later, the theme's own picker (built-in swatches) takes the page picker's place. On other brands' sites, their own selectors drive it.
- The viewer owns:
  - the 3D box
  - drag, spin and zoom
  - the still image while loading
  - the "drag to spin" hint
  - the hidden `?stats` panel
  - fitting the camera to whatever box it's given
- The page owns:
  - the swatches and the "Your build" summary
  - the layout, including the phone layout with the 3D pinned in the top half
  - brand colours for the UI
- Claude's proposal: the page talks to the viewer through a small public interface. In: "show this configuration". Out: loading progress, ready, and "couldn't load". The v1 picker uses only that interface, so v1 exercises the same path the Shopify connection will use.
- Claude's proposal: one product settings file lists the parts and options. The viewer reads it, and the v1 page can build its swatches from it too.
- Other v1 proposals were played back with no corrections: store option names and order, sphere and box stand-ins, Cloudflare-style static hosting, and the stats panel.

## After the builder check (2026-11-17)

- **The stand-in body is OK for v1** (user). Speed sign-off is rerun when the real file arrives.
- **The user has a Cloudflare account** and is open to other hosts.
- **The user doesn't want anything built yet,** and wants to discuss frameworks and how it will be built first.
- The user's previous widget (Harloop):
  - Stack: Next.js dashboard, Astro + Preact widget, FastAPI backend.
  - Embed: `<div class="harloop-embed" data-harloop-id=… data-harloop-height=…>` plus an async `loader.js`, cached aggressively on a CDN.
  - The user is open to something simpler here and unsure how far to take the loader.
- Claude checked the Cloudflare docs: **Workers Static Assets is recommended over Pages for new projects.** It supports `_headers` and allows 25 MiB per file.
- **Stack chosen by the user: plain TypeScript + Vite, static on Cloudflare.** The Harloop stack was only context.
- **Tests stay lean** (user): no sprawling suite, because the product is visual and doesn't handle critical data.
- **The user's main worry:** avoiding painting themselves into a corner when complex parts must be placed at varied positions and orientations. Addressed by the assembly model now in design §7.2.
- The design was updated with the stack, loader embed, assembly model and lean tests, then handed to the user for approval.
- The user asked how storing assets in the project scales, and is open to a database such as Supabase.
- Claude's answer, added as design §7.8, splits the data three ways:
  - Source CAD stays out of git and moves to private R2 later.
  - Built bundles are build outputs: versioned paths, deployed with the site in v1, moved to R2 later (no download fees).
  - Records (companies, products, versions) need a database only in the dashboard phase; Supabase or D1, decided then.
- The viewer resolves product ID to URL in one place, so moving costs a config change.

## Still open (roughly in order)

1. ~~Speed targets~~: settled.
2. **How it looks on the product page:** where the 3D sits, how the option picker looks, and what happens on phones. Does the widget draw its own swatches/buttons, or rely on the theme's existing dropdowns? This is a visual decision: offer to show mockups in a browser tab (its own message) before discussing it.
3. **Visual style and realism:** IN PROGRESS. Claude proposed a dark studio backdrop matching the product photos, a shadow drawn once, studio lighting generated in code, and real-looking carbon. The user approved a throwaway spike (`spikes/carbon-look/`); results are in the research doc. Waiting on:
   - ~~the user's iPhone 12 Pro run~~: done. Smooth spin; swap hitches (92 ms) were fixed by a warm-up draw, after which the worst swap was 18 ms. A battery shader cliff was also found (see the research doc).
   - Earlier note on the iPhone run: The laptop is on the "UHGuest" Wi-Fi, which blocks device-to-device traffic, so the phone couldn't reach the local server. The test is published as a private claude.ai page instead: https://claude.ai/artifact/71337QsNaCkWoDVxb3qAdX (built by `spikes/carbon-look/build-artifact.mts`, with code and models inline).
   - ~~the user's verdict on the look~~: the carbon is a good starting point. Context: today's plates are 3D-printed on a carbon-textured build plate, and the first manufactured batch is anodized grey aluminium. Carbon finishes stay; anodized grey is added as a third plate finish (Claude's call).
   - ~~what the plate file's second piece is~~: a **TPU grommet between the gates, dark matte grey** (user)
   - Firefox and Chrome on the laptop: done, 60 fps (see the research doc)
4. ~~Interactions~~: settled. **v1 is spin and zoom only** (user's decision). Nothing in the 3D files needs to move.
5. **Hosting and installation on Shopify** (Claude's call, to be stated in the design): where the script and 3D files are served from, and how the widget gets onto the theme.
6. **Conversion tooling** (Claude's call): STEP → optimised web models. Candidates: an OpenCascade-based tessellator (e.g. occt-import-js or CadQuery/OCP) followed by glTF-Transform (simplify, meshopt, KTX2). Nothing installed yet.
7. **Missing files:** shifter body (promised), aluminium ball knob (Gunmetal / Silver / Blue) if it's a separate shape.

## Key facts from recon (details in the research doc)

| | SPEC | Kona |
|---|---|---|
| Download | ~22 MB | ~28 MB |
| Rendering | full 2× resolution, ~24 fps | capped 1.5×, ~30 fps |
| Worst freeze | 333 ms (lazy-loaded add-on) | ~1 s (first-time shader compile) |

- Both fail on phones: the camera isn't refit for portrait, and SPEC's options sheet covers ~70% of the screen.
- SPEC's colour swaps are instant because every colour is preloaded. That's the feel to aim for.
- **Oldboy product page:** 405 requests, 83 scripts (Klaviyo, Loox, Lucky Orange); 75 product images, one photo per variant.
- **CAD:** STEP AP214 in mm.
  - Plates are 90 × 90 × 3.4 mm. The two 6+R files contain an extra body ~93 mm away, so the conversion step needs a body-selection rule.
  - Knobs are ~225 free-form surfaces each, plus a thread.
