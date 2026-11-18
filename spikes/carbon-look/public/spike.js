// Throwaway spike: does device-generated carbon look real enough, and how fast is it?
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { makeWeave, makeForged, makeShadow } from './textures.js';

const t0 = performance.now();
const UV_UNIT_MM = 100; // must match convert.mts
const MM = 0.001;

// Layout of the stand-in shifter, in metres. Plate top surface sits at y = 0.
const BODY = { w: 90 * MM, h: 100 * MM };
const ROD = { radius: 6 * MM, top: 78 * MM };
const KNOB_Y = ROD.top;     // the converted knob's hole starts at its local y = 0
const BALL_RADIUS = 22 * MM;

/** @type {HTMLDivElement} */ const host = document.getElementById('viewer');
const statsEl = document.getElementById('stats');
const benchEl = document.getElementById('benchOut');

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.15;
host.prepend(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
performance.mark('env-start');
scene.environment = pmrem.fromScene(makeStudio(), 0.02).texture;
performance.mark('env-done');
scene.environmentIntensity = 1.6;
// A weak key light keeps the dark body's edges readable.
const key = new THREE.DirectionalLight(0xffffff, 0.8);
key.position.set(-0.4, 0.6, 0.5);
scene.add(key);

/**
 * Low-key product studio generated in code (no HDR download): a near-black room
 * with three softboxes, like the lighting in the store's product photos.
 * @returns {THREE.Scene}
 */
function makeStudio() {
  const studio = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.025, 0.025, 0.025), side: THREE.BackSide }));
  studio.add(room);
  /** @param {number} w @param {number} h @param {number} power @param {THREE.Vector3} pos */
  const softbox = (w, h, power, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(power), side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.lookAt(0, 0, 0);
    studio.add(m);
  };
  softbox(4, 4, 3.5, new THREE.Vector3(0, 4.8, 0.5));     // overhead
  softbox(1.2, 5, 6.0, new THREE.Vector3(-4.8, 0.8, 1.5)); // key strip, left front
  softbox(1.0, 5, 3.0, new THREE.Vector3(4.8, 0.5, -2.0)); // rim strip, right back
  softbox(6, 1.2, 0.8, new THREE.Vector3(0, -1.5, 4.8));   // low front card
  return studio;
}

const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.zoomToCursor = true;
controls.maxPolarAngle = 1.45;
controls.target.set(0, -0.005, 0);

// ---------- materials (all made up front so swaps never compile) ----------
const maxAniso = renderer.capabilities.getMaxAnisotropy();
performance.mark('tex-start');
const weaveTex = makeWeave(2.4, UV_UNIT_MM);
const forgedTex = makeForged(50, UV_UNIT_MM);
for (const t of [weaveTex.map, weaveTex.normalMap, weaveTex.anisotropyMap, forgedTex.map, forgedTex.anisotropyMap]) t.anisotropy = maxAniso;
performance.mark('tex-done');

const carbonCommon = { clearcoat: 1, clearcoatRoughness: 0.04, metalness: 0.1, anisotropy: 0.8 };
const materials = {
  weave: new THREE.MeshPhysicalMaterial({ ...carbonCommon, map: weaveTex.map, normalMap: weaveTex.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), anisotropyMap: weaveTex.anisotropyMap, roughness: 0.3 }),
  forged: new THREE.MeshPhysicalMaterial({ ...carbonCommon, map: forgedTex.map, anisotropyMap: forgedTex.anisotropyMap, roughness: 0.32 }),
  gunmetal: new THREE.MeshPhysicalMaterial({ color: 0x8c9097, metalness: 1, roughness: 0.18 }),
  silver: new THREE.MeshPhysicalMaterial({ color: 0xd2d6da, metalness: 1, roughness: 0.18 }),
  blue: new THREE.MeshPhysicalMaterial({ color: 0x2f62c9, metalness: 1, roughness: 0.28 }),
  body: new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0.5, roughness: 0.55 }),
  rod: new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.12 }),
  secondBody: new THREE.MeshStandardMaterial({ color: 0x2b2b2d, metalness: 0, roughness: 0.85 }), // TPU grommet, dark matte grey
};

// ?cold adds a random define to every material, so the browser's shader cache misses and
// we can measure a first-ever visit's shader compile time.
if (new URLSearchParams(location.search).has('cold')) {
  const bust = String(Math.floor(Math.random() * 1e9));
  for (const m of Object.values(materials)) m.defines = { ...(m.defines ?? {}), COLD_BUST: bust };
}

// ---------- static stand-in parts ----------
const body = new THREE.Mesh(new THREE.BoxGeometry(BODY.w, BODY.h, BODY.w), materials.body);
body.position.y = -3 * MM - BODY.h / 2;
const rod = new THREE.Mesh(new THREE.CylinderGeometry(ROD.radius, ROD.radius, ROD.top, 32), materials.rod);
rod.position.y = ROD.top / 2;
const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 64, 48), materials.gunmetal);
ball.position.y = KNOB_Y + BALL_RADIUS - 4 * MM;
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(BODY.w * 2.2, BODY.w * 2.2), new THREE.MeshBasicMaterial({ map: makeShadow(), transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = body.position.y - BODY.h / 2 + 0.0005;
scene.add(body, rod, ball, shadow);

// ---------- load converted parts ----------
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
/** Models embedded as base64 (the claude.ai build) are decoded locally; otherwise fetched. */
const EMBEDDED = globalThis.EMBEDDED_GLB ?? null;
let embeddedBytes = 0;
/** @param {string} url @returns {Promise<THREE.Object3D>} */
const load = (url) => {
  const name = url.split('/').pop().replace('.glb', '');
  if (EMBEDDED?.[name]) {
    const bin = atob(EMBEDDED[name]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    embeddedBytes += bytes.length;
    return loader.parseAsync(bytes.buffer, '').then((g) => g.scene);
  }
  return loader.loadAsync(url).then((g) => g.scene);
};
performance.mark('load-start');
const [knobRound, plate, plateSecond] = await Promise.all([
  load('./models/knob-round.glb'), load('./models/plate-6r-down.glb'), load('./models/plate-6r-down-second-body.glb'),
]);
performance.mark('load-done');
knobRound.position.y = KNOB_Y;
// The STEP plate sits at y 0..3 mm; drop it so its top surface is y = 0, on top of the body.
plate.position.y = -3 * MM;
plateSecond.position.y = -3 * MM;
plateSecond.visible = true;
scene.add(knobRound, plate, plateSecond);

/** @param {THREE.Object3D} obj @param {THREE.Material} mat */
function setMaterial(obj, mat) { obj.traverse((o) => { if (o.isMesh) o.material = mat; }); }
setMaterial(plateSecond, materials.secondBody);

// ---------- state + UI ----------
const state = { knob: 'round-weave', plate: 'weave', dpr: '1.5', anisotropy: true, clearcoat: true, secondBody: true };

function applyState() {
  const [shape, finish] = state.knob.split('-');
  knobRound.visible = shape === 'round';
  ball.visible = shape === 'ball';
  if (shape === 'round') setMaterial(knobRound, materials[finish]);
  else ball.material = materials[finish];
  setMaterial(plate, materials[state.plate]);
  for (const m of [materials.weave, materials.forged]) {
    m.anisotropy = state.anisotropy ? 0.8 : 0;
    m.clearcoat = state.clearcoat ? 1 : 0;
  }
  plateSecond.visible = state.secondBody;
  const dpr = Math.min(window.devicePixelRatio, Number(state.dpr));
  if (renderer.getPixelRatio() !== dpr) { renderer.setPixelRatio(dpr); resize(); }
  for (const btn of document.querySelectorAll('[data-group] button')) {
    const group = btn.parentElement.dataset.group;
    btn.classList.toggle('on', group === 'toggles' ? state[btn.dataset.toggle] : state[group] === btn.dataset.value);
  }
  requestRender();
}

document.querySelectorAll('[data-group] button').forEach((btn) => btn.addEventListener('click', () => {
  const group = btn.parentElement.dataset.group;
  if (group === 'toggles') state[btn.dataset.toggle] = !state[btn.dataset.toggle];
  else state[group] = btn.dataset.value;
  applyState();
}));

// ---------- sizing: fit the whole shifter in whatever box we get ----------
function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  requestRender();
}
function fitCamera() {
  const height = (ROD.top + 2 * BALL_RADIUS) + BODY.h + 3 * MM;
  const width = BODY.w * 1.45; // diagonal-ish when seen from an angle
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
  const dist = Math.max(height / 2 / Math.tan(vHalf), width / 2 / (Math.tan(vHalf) * camera.aspect)) * 1.18;
  controls.target.set(0, (ROD.top + 2 * BALL_RADIUS - BODY.h) / 2, 0);
  camera.position.copy(controls.target).add(new THREE.Vector3(0.55, 0.32, 0.77).normalize().multiplyScalar(dist));
  controls.minDistance = dist * 0.35;
  controls.maxDistance = dist * 1.6;
  controls.update();
}
new ResizeObserver(resize).observe(host);

// ---------- draw only when something changes ----------
let frameQueued = false;
let ready = false; // nothing is drawn until every material is compiled
let firstFrameMs = 0;
/** @type {null | ((t: number) => void)} */
let benchHook = null;
function requestRender() {
  if (frameQueued || !ready) return;
  frameQueued = true;
  requestAnimationFrame(frame);
}
/** @param {number} t */
function frame(t) {
  frameQueued = false;
  const moving = controls.update();
  if (benchHook) benchHook(t);
  const c0 = performance.now();
  renderer.render(scene, camera);
  cpuMs.push(performance.now() - c0);
  if (!firstFrameMs) { firstFrameMs = performance.now(); document.getElementById('loading').remove(); }
  if (moving || benchHook) requestRender();
}
controls.addEventListener('change', requestRender);
/** @type {number[]} */ let cpuMs = [];

// ---------- warm up: compile every material and upload every texture before first view ----------
// Hypothesis under test (iPhone showed a 92 ms swap frame): compiling isn't enough on Safari, which
// finishes preparing a shader the first time it is drawn with each mesh layout. So every material is
// also drawn once on every geometry, into one pixel of the real canvas. Open the page with #nowarm to skip that.
const WARM_DRAW = location.hash !== '#nowarm';
/** @param {THREE.Object3D} root @returns {THREE.BufferGeometry} */
const firstGeometry = (root) => { let g = null; root.traverse((o) => { if (!g && o.isMesh) g = o.geometry; }); return g; };
const warmGeometries = [firstGeometry(knobRound), firstGeometry(plate), firstGeometry(plateSecond), ball.geometry, body.geometry, rod.geometry];
const warm = new THREE.Group();
for (const g of warmGeometries) for (const m of Object.values(materials)) {
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  warm.add(mesh);
}
scene.add(warm);
resize();
fitCamera();
performance.mark('compile-start');
await renderer.compileAsync(scene, camera);
performance.mark('compile-done');
for (const t of [weaveTex.map, weaveTex.normalMap, weaveTex.anisotropyMap, forgedTex.map, forgedTex.anisotropyMap]) renderer.initTexture(t);
performance.mark('upload-done');
if (WARM_DRAW) {
  renderer.setScissorTest(true);
  renderer.setScissor(0, 0, 1, 1);
  renderer.render(scene, camera);
  renderer.setScissorTest(false);
  renderer.getContext().finish();
}
performance.mark('warm-draw-done');
scene.remove(warm);
ready = true;
applyState();

// ---------- speed test ----------
document.getElementById('bench').addEventListener('click', () => {
  if (benchHook) return;
  benchEl.textContent = 'running…';
  const deltas = [];
  const swapFrames = [];
  swapLabels = [];
  let last = 0, start = 0, nextSwap = 500, swapCount = 0;
  const knobCycle = ['round-weave', 'round-forged', 'ball-gunmetal', 'round-forged', 'ball-silver', 'round-weave', 'ball-blue'];
  const plateCycle = ['weave', 'forged'];
  cpuMs = [];
  controls.enabled = false;
  benchHook = (t) => {
    if (!start) { start = last = t; return; }
    deltas.push(t - last);
    last = t;
    const elapsed = t - start;
    // Rotate the camera around the target as a drag would.
    const offset = camera.position.clone().sub(controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.02);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
    if (elapsed > nextSwap) {
      swapCount++;
      state.knob = knobCycle[swapCount % knobCycle.length];
      if (swapCount % 3 === 0) state.plate = plateCycle[(swapCount / 3) % 2];
      applyState();
      swapFrames.push(deltas.length); // the next delta measures the swap frame
      swapLabels.push(`${state.knob} + ${state.plate} plate`);
      nextSwap += 500;
    }
    if (elapsed > 6000) {
      benchHook = null;
      controls.enabled = true;
      benchEl.textContent = summarise(deltas, swapFrames);
    }
  };
  requestRender();
});

/** @type {string[]} */ let swapLabels = [];

/** @param {number[]} deltas @param {number[]} swapFrames */
function summarise(deltas, swapFrames) {
  const slow = swapFrames
    .map((i, n) => ({ ms: deltas[i] ?? 0, label: swapLabels[n] }))
    .filter((s) => s.ms > 20)
    .map((s) => `  ${s.ms.toFixed(0)} ms → ${s.label}`);
  const slowOther = deltas.filter((d, i) => d > 33.4 && !swapFrames.includes(i)).length;
  const sorted = [...deltas].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const fps = 1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length);
  const swapWorst = Math.max(0, ...swapFrames.map((i) => deltas[i] ?? 0));
  const cpuSorted = [...cpuMs].sort((a, b) => a - b);
  return [
    `frames     ${deltas.length}`,
    `avg fps    ${fps.toFixed(1)}`,
    `frame ms   p50 ${pct(0.5).toFixed(1)} · p95 ${pct(0.95).toFixed(1)} · max ${sorted[sorted.length - 1].toFixed(1)}`,
    `over 33 ms ${deltas.filter((d) => d > 33.4).length}`,
    `swaps      ${swapFrames.length}, worst swap frame ${swapWorst.toFixed(1)} ms`,
    `js per frame p50 ${cpuSorted[Math.floor(cpuSorted.length / 2)].toFixed(2)} ms`,
    `slow swaps  ${slow.length ? '\n' + slow.join('\n') : 'none'}`,
    `slow non-swap frames ${slowOther}`,
    `warm-up draw ${WARM_DRAW ? 'on' : 'off (#nowarm)'}`,
  ].join('\n');
}

// ---------- stats ----------
function gpuName() {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
}
function updateStats() {
  const res = performance.getEntriesByType('resource');
  const sum = (filter) => res.filter(filter).reduce((a, r) => a + (r.encodedBodySize || r.decodedBodySize || 0), 0);
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const info = renderer.info;
  statsEl.textContent = [
    `gpu        ${gpuName()}`,
    `browser    ${navigator.userAgent.match(/(Firefox|Edg|Chrome|Version)\/[\d.]+/g)?.join(' ') ?? navigator.userAgent}`,
    `canvas     ${size.x}×${size.y} px (${renderer.getPixelRatio()}× of ${window.devicePixelRatio})`,
    `draws      ${info.render.calls} · ${info.render.triangles.toLocaleString()} triangles`,
    EMBEDDED ? `3D files   ${kb(embeddedBytes)} (embedded in this page; ~115 KB brotli)` : `3D files   ${kb(sum((r) => r.name.endsWith('.glb')))} (as served; brotli would shrink further)`,
    EMBEDDED ? `code       bundled into this page (~140 KB brotli)` : `code       ${kb(sum((r) => r.name.endsWith('.js')))} (unbundled spike)`,
    `textures   ${kb(weaveTex.bytes + forgedTex.bytes)} on the GPU, 0 KB downloaded`,
    `first view ${firstFrameMs ? (firstFrameMs - t0).toFixed(0) + ' ms after script start' : '…'}`,
  ].join('\n');
}
setInterval(updateStats, 1000);
// Handle for live tuning from the console.
window.spike = { scene, materials, renderer, key, requestRender, weaveTex, forgedTex };
updateStats();
