# Carbon look spike (throwaway)

A quick test, not product code. Nothing here is kept. What it taught us is in `docs/research/2026-11-17-reference-configurators.md`.

- `convert.mts`: STEP → GLB (OpenCascade wasm, thread stripping, box UVs, quantize + meshopt). Run it with `node convert.mts`.
- `public/`: the test page. The carbon textures are generated on the device, and the studio lighting is generated in code.

To run it again, first run `npm install` and `node convert.mts` here. `node_modules/` and the generated `public/models/` were removed to keep the folder small.

To serve it on the local network, run `python3 -m http.server 8123 --bind 0.0.0.0` from this folder, then open `/public/`. Add `?cold` to the address to force a shader-cache miss.
