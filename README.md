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

- `npm run convert -- products/ob1 --inspect` lists every body in every source file (index, name, size in mm), to map bodies in the settings file.
- The converter compares the total size with `products/<id>/size-baseline.json` and exits 1 on growth over 10%. Rerun with `--update-baseline` when the growth is intended.
- Rerun `convert` and then `stills` whenever a STEP file, a model, a finish, an assembly dimension or the render code in `src/viewer/render/` changes. The bundle version hashes all of these, so a look change gets a new bundle path instead of overwriting year-cached stills.

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

The page drives the viewer through `viewer.product`, `viewer.configuration`, `viewer.setConfiguration({...})` and the events
`productload`, `progress`, `ready`, `configurationchange`, `error` and `restored`.
