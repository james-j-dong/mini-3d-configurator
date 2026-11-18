// Carbon textures generated on the device from fixed seeds, so they cost no download.
// Uses typed arrays and OffscreenCanvas only (never `document`), so it runs in the render worker.
import {
  DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, SRGBColorSpace,
  UnsignedByteType, type ColorSpace, type Texture,
} from 'three';

export interface FinishTextures {
  weaveAlbedo: Texture;
  weaveNormal: Texture;
  weaveRoughness: Texture;
  forgedAlbedo: Texture;
  forgedRoughness: Texture;
}

const WEAVE_SIZE_PX: number = 256;
/** One weave tile holds 4 × 4 tows (materials.ts relies on this for its tiling). */
export const WEAVE_TOWS_PER_TILE: number = 4;
const WEAVE_NORMAL_STRENGTH: number = 3.0;
const WARP_ROUGHNESS: number = 0.26;
const WEFT_ROUGHNESS: number = 0.36;

const FORGED_SIZE_PX: number = 512;
/** Chip sizes are drawn for a 50 mm tile; the finish's tileMm only sets how often it repeats. */
const FORGED_TILE_MM: number = 50;
const FORGED_CHIPS: number = 1400;
const FORGED_BACKGROUND_ROUGHNESS: number = 0.42;
const TEXTURE_ANISOTROPIC_FILTERING: number = 4;

/** Seeded random so every device draws the same pattern. */
function mulberry32(seed: number): () => number {
  return (): number => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t: number = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toTexture(data: Uint8Array, size: number, colorSpace: ColorSpace): Texture {
  const texture: DataTexture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = colorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = TEXTURE_ANISOTROPIC_FILTERING;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/** A tileable height field (0..1) → tangent-space normal map. */
function heightToNormal(height: Float32Array, size: number, strength: number): Uint8Array {
  const out: Uint8Array = new Uint8Array(size * size * 4);
  const at = (x: number, y: number): number => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx: number = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy: number = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len: number = Math.hypot(dx, dy, 1);
      const i: number = (y * size + x) * 4;
      out[i] = (-dx / len * 0.5 + 0.5) * 255;
      out[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
      out[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * 2×2 twill weave. Warp and weft tows get different roughness, so they glint differently as
 * the part turns: the cheap stand-in for per-fibre sheen (no anisotropy).
 */
function makeWeave(): Pick<FinishTextures, 'weaveAlbedo' | 'weaveNormal' | 'weaveRoughness'> {
  const size: number = WEAVE_SIZE_PX;
  const cellPx: number = size / WEAVE_TOWS_PER_TILE;
  const rand: () => number = mulberry32(7);
  const strand: Float32Array = new Float32Array(size).map(() => rand()); // fine fibre striations

  const height: Float32Array = new Float32Array(size * size);
  const albedo: Uint8Array = new Uint8Array(size * size * 4);
  const roughness: Uint8Array = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ci: number = Math.floor(x / cellPx);
      const cj: number = Math.floor(y / cellPx);
      const fx: number = ((x % cellPx) + 0.5) / cellPx;
      const fy: number = ((y % cellPx) + 0.5) / cellPx;
      const warpOnTop: boolean = ((ci + cj) & 3) < 2; // twill: over 2, under 2, shifted by one each row
      const across: number = warpOnTop ? fx : fy;
      const along: number = warpOnTop ? fy : fx;
      const bulge: number = Math.sin(Math.PI * across);
      const dip: number = 0.8 + 0.2 * Math.sin(Math.PI * along);
      const fibre: number = strand[warpOnTop ? x : y];
      height[y * size + x] = bulge * dip + 0.04 * fibre;

      const i: number = (y * size + x) * 4;
      const grey: number = 14 + 10 * bulge * dip + 6 * fibre; // near-black with gentle tow shading
      albedo[i] = grey; albedo[i + 1] = grey; albedo[i + 2] = grey + 1; albedo[i + 3] = 255;
      // Rougher in the gaps between tows, where resin pools.
      const r: number = (warpOnTop ? WARP_ROUGHNESS : WEFT_ROUGHNESS) + 0.12 * (1 - bulge) + 0.03 * fibre;
      roughness[i] = roughness[i + 1] = roughness[i + 2] = Math.round(Math.min(1, r) * 255);
      roughness[i + 3] = 255;
    }
  }
  return {
    weaveAlbedo: toTexture(albedo, size, SRGBColorSpace),
    weaveNormal: toTexture(heightToNormal(height, size, WEAVE_NORMAL_STRENGTH), size, NoColorSpace),
    weaveRoughness: toTexture(roughness, size, NoColorSpace),
  };
}

type Point = [number, number];

function chipOutline(len: number, wid: number, rand: () => number): Point[] {
  const steps: number = 10;
  const points: Point[] = [];
  for (let i = 0; i < steps; i++) points.push([-len / 2 + (i / (steps - 1)) * len, (-wid / 2) * (0.6 + 0.4 * rand())]);
  for (let i = steps - 1; i >= 0; i--) points.push([-len / 2 + (i / (steps - 1)) * len, (wid / 2) * (0.6 + 0.4 * rand())]);
  return points;
}

/** Draws a chip with a feathered edge: once 1.5 px larger at 35% alpha, then its core. */
function drawChip(ctx: OffscreenCanvasRenderingContext2D, points: Point[], x: number, y: number, angle: number, fill: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [px, py] of points.slice(1)) ctx.lineTo(px, py);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.35;
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fill();
  ctx.restore();
}

/** Forged carbon: overlapping chopped-fibre chips at random angles, tileable, 512². */
function makeForged(): Pick<FinishTextures, 'forgedAlbedo' | 'forgedRoughness'> {
  const size: number = FORGED_SIZE_PX;
  const rand: () => number = mulberry32(42);
  const albedoCanvas: OffscreenCanvas = new OffscreenCanvas(size, size);
  const roughCanvas: OffscreenCanvas = new OffscreenCanvas(size, size);
  const c: OffscreenCanvasRenderingContext2D = albedoCanvas.getContext('2d')!;
  const r: OffscreenCanvasRenderingContext2D = roughCanvas.getContext('2d')!;
  c.fillStyle = '#0a0a0a';
  c.fillRect(0, 0, size, size);
  const background: number = Math.round(FORGED_BACKGROUND_ROUGHNESS * 255);
  r.fillStyle = `rgb(${background},${background},${background})`;
  r.fillRect(0, 0, size, size);

  const pxPerMm: number = size / FORGED_TILE_MM;
  for (let n = 0; n < FORGED_CHIPS; n++) {
    const cx: number = rand() * size;
    const cy: number = rand() * size;
    const len: number = (4 + rand() * 12) * pxPerMm;
    const wid: number = (1 + rand() * 3.5) * pxPerMm;
    const angle: number = rand() * Math.PI;
    const shade: number = rand();
    const grey: number = Math.round(shade < 0.6 ? 10 + shade * 25 : 30 + (shade - 0.6) * 110); // mostly dark, some silver streaks
    const rough: number = Math.round((0.22 + 0.18 * (1 - shade)) * 255); // brighter chips are glossier
    const outline: Point[] = chipOutline(len, wid, rand);
    const streakGaps: number[] = [];
    for (let s = -wid / 2 + 1; s < wid / 2; s += 2 + rand() * 2) streakGaps.push(s);
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const x: number = cx + ox;
        const y: number = cy + oy;
        if (x < -len || x > size + len || y < -len || y > size + len) continue;
        drawChip(c, outline, x, y, angle, `rgb(${grey},${grey},${grey + 2})`);
        // Fibre streaks along the chip.
        c.save();
        c.translate(x, y);
        c.rotate(angle);
        c.globalAlpha = 0.18;
        c.strokeStyle = `rgb(${grey + 30},${grey + 30},${grey + 32})`;
        c.lineWidth = 1;
        for (const s of streakGaps) {
          c.beginPath();
          c.moveTo(-len / 2, s);
          c.lineTo(len / 2, s);
          c.stroke();
        }
        c.restore();
        drawChip(r, outline, x, y, angle, `rgb(${rough},${rough},${rough})`);
      }
    }
  }
  const pixels = (ctx: OffscreenCanvasRenderingContext2D): Uint8Array => new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer);
  return {
    forgedAlbedo: toTexture(pixels(c), size, SRGBColorSpace),
    forgedRoughness: toTexture(pixels(r), size, NoColorSpace),
  };
}

/** Seeded, repeat-wrapped, mipmapped textures for every procedural finish. */
export function makeFinishTextures(): FinishTextures {
  return { ...makeWeave(), ...makeForged() };
}
