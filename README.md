# mini-3d-configurator

An embeddable 3D product viewer (`<mini3d-viewer>`), built for speed on low-spec laptops and phones.
v1 shows the OB1 H-Pattern Sim Shifter on a standalone page. Design: `docs/superpowers/specs/2026-11-17-mini3d-viewer-v1-design.md`.

Requires Node ≥ 26 (tool scripts are TypeScript run directly by `node`).

```sh
npm install
```

## Building a product

A product is one settings file, `products/<id>/product.json`, plus its STEP files in `assets/source/` (never committed).
Build its bundle in this order:

```sh
npm run convert -- products/ob1   # STEP → versioned bundle in public/bundles/ob1/<version>/ + public/products/ob1.json
npm run stills -- ob1             # one WebP still per configuration, rendered by the viewer in headless Chromium
npm run build                     # the site into dist/ (copies public/)
```

- `npm run convert -- products/ob1 --inspect` lists every part in every source file, from one quick coarse read, to write the settings file from. One line per part instance: `"name" #occurrence`, its body count, size and centre (mm), and a coarse triangle count. A part made of several unnamed bodies gets an indented `body k` line per body (size and centre), and bodies under no named part are listed last as `(unnamed) body k`.
- The converter compares the total size with `products/<id>/size-baseline.json` and exits 1 on growth over 10%. Rerun with `--update-baseline` when the growth is intended.
- The table it prints has each model's group (`alwaysShown`, `variants`, `afterFirstView`), how many of the file's bodies it merges, its triangles at the default level, the triangles face rules dropped and simplification removed, and its download size at both levels. A line after it totals each group.
- Every part is written twice: `parts/<model>.glb` and a gzip copy `parts/<model>.glb.gz`. The viewer downloads the gzip copy (about a third smaller) and unpacks it in the browser; browsers that cannot (Safari before 16.4) download the plain file. The sizes the converter prints are the gzip copies, which is what a visitor downloads.
- Rerun `convert` and then `stills` whenever a STEP file, a model, a finish, an assembly dimension or the render code in `src/viewer/render/` changes. The bundle version hashes all of these, so a look change gets a new bundle path instead of overwriting year-cached stills.

### Picking parts out of a source

A source can be a single-part STEP file or a whole assembly; parts keep their positions from the CAD file. A converted model lists one or more part selections in `parts`, merged into one mesh:

```jsonc
"plate-screws": { "kind": "converted", "source": "ob1", "simplifyErrorMm": 0.02, "parts": [
  { "part": "M3 x 10 screw", "within": { "minMm": [-100, 50, -100], "maxMm": [100, 200, 100] } },  // only the instances up top
  { "part": "M3 x 12 screw" }
] },
"logo":      { "kind": "converted", "source": "ob1", "parts": [{ "part": "7R plate", "bodies": [0, 1, 2, 3] }] },
"knob-round": { "kind": "converted", "source": "knob-round", "parts": [{}] }   // {} = the whole file
```

- `part`: a node or mesh name anywhere in the file's tree, matched exactly (copy it from `--inspect`). A name that repeats matches every instance.
- `bodies`: body positions within each matched instance, 0-based, as `--inspect` numbers them.
- `within`: keeps only instances whose box centre lies inside this box (source millimetres, Y-up).
- `leaveOut` (on a source): selections deliberately left out of the build.
- `bodyCount` (on a source, optional): how many bodies the file has, as `--inspect` prints. With it set, the build fails when a new revision of the file has more or fewer, instead of quietly merging an added body into whichever model selects the whole file or that part name.
- `placement` (on a source): where a separate part file's own frame sits in the product, as `{ "positionMm": [x, y, z], "rotationDeg": [x, y, z] }` (rotation first, XYZ order). The converter bakes it into the GLBs, so the parts load as in CAD. An assembly needs none. `parts`, `within`, face rules and `--inspect` all use the file's own frame.
- **Every body of a source must belong to exactly one model or to `leaveOut`.** A body nobody claims, a body claimed twice, or a selection that matches nothing fails the build with a report of each body's part, size and position.
- `simplifyErrorMm` (on a model): simplifies the merged mesh to this error in millimetres (the light level uses twice as much). Each part is otherwise tessellated at the same quality relative to its own size, whatever file it came from.
- `afterFirstView` (on a slot): the slot's part loads after the first view, and neither the first view nor swaps wait for it. It needs a converted model that no option swaps and no other slot without `afterFirstView` can hold, and the root slot can't use it.

## Developing

```sh
npm run dev          # http://localhost:5173/ (the v1 page; add ?stats for the stats panel and speed test)
npm test             # unit tests (Vitest)
npm run typecheck
npm run test:e2e     # browser smoke tests (Playwright; builds and previews the site first)
```

Dev pages: `/src/site/engine-dev.html` (the engine on the main thread with option buttons) and `/src/site/element-dev.html` (the element with `stats`).
Add `?render=main` to any page to force main-thread rendering instead of the worker.

WebKit's system libraries aren't packaged for Fedora; run that project in the official container:

```sh
podman run --rm --network host --security-opt label=disable -v "$PWD":/work -w /work \
  mcr.microsoft.com/playwright:v1.65.1-noble npx playwright test --project=webkit
```

## Deploying (Cloudflare Workers Static Assets)

Once per machine: `npx wrangler login`. Then:

```sh
npm run convert -- products/ob1 && npm run stills -- ob1 && npm run deploy
```

`npm run deploy` builds and runs `wrangler deploy` (static files from `dist/`, no Worker script). Cache rules live in `public/_headers`:
`/v1/loader.js` 5 minutes, `/products/*` 1 minute, hashed `/v1/assets/*` and versioned `/bundles/*` a year (immutable).

## Embedding

```html
<mini3d-viewer product="ob1" style="display:block;aspect-ratio:3/2"></mini3d-viewer>
<script type="module" async src="https://<host>/v1/loader.js"></script>
```

The page drives the viewer through `viewer.product`, `viewer.configuration` (what is on screen), `viewer.requestedConfiguration`
(what was last asked for: ahead of `configuration` while a pick loads, back to it if the pick is dropped), `viewer.setConfiguration({...})` and the events
`productload`, `progress`, `ready`, `configurationchange`, `error` and `restored`.

A configuration set before the 3D has started (right after the element exists, for example) is what the 3D opens with.

Removing the element from the page shuts its 3D down and frees the worker and the graphics memory; moving it within the page does not.
The same element put back later starts again with the configuration it had, and fires `productload` and `ready` again.

`progress` carries `{ loaded, total, phase }`, one phase at a time:
- `current`: the parts the first view waits for;
- `deferred`: after `ready`, the configuration's after-first-view parts; `loaded` counts parts shown or failed, so `loaded === total` means nothing more will appear;
- `background`: every other part, loaded ahead of the next picks.

A part that fails to download sends a non-fatal `error` with reason `model-load-failed: <model id>`. If it was an after-first-view part, nothing else changes.

A fatal `error` means there is no 3D. Unless the product itself could not be read, the viewer shows the still for the current configuration and keeps following picks with stills.
Its reasons are `webgl2-unavailable`, `product-not-found: …`, `invalid-product: …`, `model-load-failed: <model id>` (a part of the first view),
`engine-load-failed: …` (the viewer code did not download) and `engine-failed: …` (anything unexpected inside the 3D engine).
