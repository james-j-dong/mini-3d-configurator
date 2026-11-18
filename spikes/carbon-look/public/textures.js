// Throwaway spike: carbon textures generated on the device (zero download).
import * as THREE from 'three';

/**
 * Seeded random so every device draws the same pattern.
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {HTMLCanvasElement | ImageData} source
 * @param {boolean} isColor
 * @param {number} repeat
 * @returns {THREE.Texture}
 */
function toTexture(source, isColor, repeat) {
  const tex = source instanceof ImageData
    ? new THREE.DataTexture(source.data, source.width, source.height, THREE.RGBAFormat)
    : new THREE.CanvasTexture(source);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 2x2 twill carbon weave. One tile = 4 x 4 tows.
 * @param {number} towMm  width of one tow in millimetres
 * @param {number} uvUnitMm  millimetres per UV unit (the converter uses 100)
 * @returns {{ map: THREE.Texture, normalMap: THREE.Texture, anisotropyMap: THREE.Texture, bytes: number }}
 */
export function makeWeave(towMm, uvUnitMm) {
  const size = 256;
  const cells = 4;
  const cellPx = size / cells;
  const rand = mulberry32(7);
  // Fine fibre striations: one random value per pixel column/row across a tow.
  const strand = new Float32Array(size).map(() => rand());

  const height = new Float32Array(size * size);
  const color = new ImageData(size, size);
  const aniso = new ImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ci = Math.floor(x / cellPx), cj = Math.floor(y / cellPx);
      const fx = (x % cellPx + 0.5) / cellPx, fy = (y % cellPx + 0.5) / cellPx;
      const warpOnTop = ((ci + cj) & 3) < 2; // twill: over 2, under 2, shifted by one each row
      const across = warpOnTop ? fx : fy;     // position across the tow's width
      const along = warpOnTop ? fy : fx;      // position along the fibres
      const bulge = Math.sin(Math.PI * across);
      const dip = 0.8 + 0.2 * Math.sin(Math.PI * along);
      const fibre = strand[warpOnTop ? x : y];
      height[y * size + x] = bulge * dip + 0.04 * fibre;

      const i = (y * size + x) * 4;
      const g = 14 + 10 * bulge * dip + 6 * fibre; // near-black with gentle tow shading
      color.data[i] = g; color.data[i + 1] = g; color.data[i + 2] = g + 1; color.data[i + 3] = 255;
      // Anisotropy direction in tangent space: warp fibres run along V, weft along U.
      aniso.data[i] = warpOnTop ? 128 : 255;
      aniso.data[i + 1] = warpOnTop ? 255 : 128;
      aniso.data[i + 2] = Math.round(255 * (0.55 + 0.45 * bulge)); // strength, weaker in the gaps
      aniso.data[i + 3] = 255;
    }
  }
  const normal = heightToNormal(height, size, 3.0);
  const repeat = uvUnitMm / (towMm * cells);
  return {
    map: toTexture(color, true, repeat),
    normalMap: toTexture(normal, false, repeat),
    anisotropyMap: toTexture(aniso, false, repeat),
    bytes: 3 * size * size * 4 * 4 / 3,
  };
}

/**
 * Forged carbon: overlapping chopped-fibre chips at random angles, tileable.
 * @param {number} tileMm  millimetres covered by one tile
 * @param {number} uvUnitMm
 * @returns {{ map: THREE.Texture, anisotropyMap: THREE.Texture, bytes: number }}
 */
export function makeForged(tileMm, uvUnitMm) {
  const size = 1024;
  const rand = mulberry32(42);
  const colorCanvas = document.createElement('canvas');
  const anisoCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = anisoCanvas.width = anisoCanvas.height = size;
  const c = colorCanvas.getContext('2d');
  const a = anisoCanvas.getContext('2d');
  c.fillStyle = '#0a0a0a'; c.fillRect(0, 0, size, size);
  a.fillStyle = 'rgb(255,128,60)'; a.fillRect(0, 0, size, size);

  const pxPerMm = size / tileMm;
  const chips = 1400;
  for (let n = 0; n < chips; n++) {
    const cx = rand() * size, cy = rand() * size;
    const len = (4 + rand() * 12) * pxPerMm;
    const wid = (1 + rand() * 3.5) * pxPerMm;
    const ang = rand() * Math.PI;
    const shade = rand();
    const grey = shade < 0.6 ? 10 + shade * 25 : 30 + (shade - 0.6) * 110; // mostly dark, some silver streaks
    const pts = chipOutline(len, wid, rand);
    const dirR = Math.round((Math.cos(ang) * 0.5 + 0.5) * 255);
    const dirG = Math.round((Math.sin(ang) * 0.5 + 0.5) * 255);
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const x = cx + ox, y = cy + oy;
      if (x < -len || x > size + len || y < -len || y > size + len) continue;
      drawChip(c, pts, x, y, ang, `rgb(${grey},${grey},${grey + 2})`);
      // Fibre streaks along the chip.
      c.save(); c.translate(x, y); c.rotate(ang); c.globalAlpha = 0.18;
      c.strokeStyle = `rgb(${grey + 30},${grey + 30},${grey + 32})`; c.lineWidth = 1;
      for (let s = -wid / 2 + 1; s < wid / 2; s += 2 + rand() * 2) { c.beginPath(); c.moveTo(-len / 2, s); c.lineTo(len / 2, s); c.stroke(); }
      c.restore();
      drawChip(a, pts, x, y, ang, `rgb(${dirR},${dirG},${Math.round(150 + shade * 105)})`);
    }
  }
  const repeat = uvUnitMm / tileMm;
  return {
    map: toTexture(colorCanvas, true, repeat),
    anisotropyMap: toTexture(anisoCanvas, false, repeat),
    bytes: 2 * size * size * 4 * 4 / 3,
  };
}

/** @returns {Array<[number, number]>} */
function chipOutline(len, wid, rand) {
  /** @type {Array<[number, number]>} */
  const pts = [];
  const steps = 10;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    pts.push([-len / 2 + t * len, -wid / 2 * (0.6 + 0.4 * rand())]);
  }
  for (let i = steps - 1; i >= 0; i--) {
    const t = i / (steps - 1);
    pts.push([-len / 2 + t * len, wid / 2 * (0.6 + 0.4 * rand())]);
  }
  return pts;
}

function drawChip(ctx, pts, x, y, ang, fill) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [px, py] of pts.slice(1)) ctx.lineTo(px, py);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  ctx.restore();
}

/**
 * @param {Float32Array} h  tileable height field, 0..1
 * @param {number} size
 * @param {number} strength
 * @returns {ImageData}
 */
function heightToNormal(h, size, strength) {
  const out = new ImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out.data[i] = (-dx / len * 0.5 + 0.5) * 255;
      out.data[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Soft contact shadow under the body, drawn once.
 * @returns {THREE.Texture}
 */
export function makeShadow() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
