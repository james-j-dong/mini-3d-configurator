// Turns a product folder (settings file + STEP sources) into a versioned static bundle.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import type { BuiltProduct, ModelDef, ModelFiles, Product, SourceDef, Vec3 } from '../schema/product.ts';
import { validateProduct } from '../schema/validate.ts';
import { configurationKey } from '../schema/configurations.ts';
import { readStepBodies, TESSELLATION_LEVELS, type StepBody, type TessellationLevel } from './occt.ts';
import { applyFaceRules, normaliseAxes } from './geometry.ts';
import { writeGlb } from './glb.ts';

export class ConvertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConvertError';
  }
}

/** Brotli sizes per model id at the default level. */
export interface SizeReport { version: string; brotliBytes: Record<string, number>; totalBrotliBytes: number }

/** One converted model, for the CLI's table. */
export interface ModelRow { model: string; triangles: number; droppedTriangles: number; brotliBytes: number; lightBrotliBytes: number }

/** OpenCascade returns millimetres for every source (see occt.ts). */
const METRES_PER_MM: number = 0.001;
const GROWTH_LIMIT: number = 0.10;
const STILL_SIZE_PX: number = 1000;

const formatMm = (n: number): string => String(Number(n.toFixed(1)));

/**
 * Every body in a source must be used by a model or listed in `dropBodies`, and the file must hold
 * exactly the number of bodies the settings file expects. Bodies are never dropped silently.
 */
export function checkBodyMapping(
  sourceKey: string,
  bodies: { index: number; sizeMm: Vec3 }[],
  expectedCount: number,
  referenced: number[],
  dropped: number[],
): void {
  const describe = (b: { index: number; sizeMm: Vec3 }): string => `body ${b.index} (${b.sizeMm.map(formatMm).join(' × ')} mm)`;
  if (bodies.length !== expectedCount) {
    throw new ConvertError(`${sourceKey}: expected ${expectedCount} bodies, found ${bodies.length}: ${bodies.map(describe).join(', ')}`);
  }
  for (const index of referenced) {
    if (index >= bodies.length) throw new ConvertError(`${sourceKey}: a model uses body ${index}, but the file has only ${bodies.length}`);
  }
  for (const body of bodies) {
    if (!referenced.includes(body.index) && !dropped.includes(body.index)) {
      throw new ConvertError(`${sourceKey}: ${describe(body)} is not used by any model and not listed in dropBodies`);
    }
  }
}

/** First 12 hex characters of a SHA-256 over the settings and every GLB, in model-id order. */
export function computeVersion(settingsJson: string, glbs: Array<[modelId: string, bytes: Uint8Array]>): string {
  const hash = createHash('sha256').update(settingsJson);
  for (const [modelId, bytes] of [...glbs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    hash.update(`\0${modelId}\0`).update(bytes);
  }
  return hash.digest('hex').slice(0, 12);
}

/** The render code that draws the stills (materials, studio, textures, framing…). */
export const LOOK_SOURCES_DIR: string = 'src/viewer/render';

/**
 * A hash of every source file in `dir`. It goes into the bundle version, so a look change gets a
 * new bundle path and its re-rendered stills never replace year-cached old ones in place.
 */
export function lookFingerprint(dir: string): string {
  const hash = createHash('sha256');
  for (const name of readdirSync(dir).filter(n => n.endsWith('.ts')).sort()) {
    hash.update(`\0${name}\0`).update(readFileSync(join(dir, name)));
  }
  return hash.digest('hex');
}

/** Growth against the stored baseline; flagged when the total grew by more than 10%. */
export function compareWithBaseline(report: SizeReport, baseline: SizeReport | null): { deltaRatio: number; flagged: boolean } {
  if (!baseline || baseline.totalBrotliBytes <= 0) return { deltaRatio: 0, flagged: false };
  const deltaRatio: number = (report.totalBrotliBytes - baseline.totalBrotliBytes) / baseline.totalBrotliBytes;
  return { deltaRatio, flagged: deltaRatio > GROWTH_LIMIT };
}

export function bodySizeMm(body: StepBody): Vec3 {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < body.positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], body.positions[i + a]);
      max[a] = Math.max(max[a], body.positions[i + a]);
    }
  }
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

export function readProduct(productDir: string): { product: Product; json: string } {
  const json: string = readFileSync(join(productDir, 'product.json'), 'utf8');
  return { product: validateProduct(JSON.parse(json)), json };
}

type ConvertedModel = Extract<ModelDef, { kind: 'converted' }>;

function convertedModels(p: Product): Array<[string, ConvertedModel]> {
  return Object.entries(p.models).filter((e): e is [string, ConvertedModel] => e[1].kind === 'converted');
}

/** Reads every source once at this level, checks its body mapping, and returns its Y-up bodies. */
async function readSources(p: Product, level: TessellationLevel): Promise<Map<string, StepBody[]>> {
  const models: Array<[string, ConvertedModel]> = convertedModels(p);
  const result: Map<string, StepBody[]> = new Map();
  for (const [key, source] of Object.entries(p.sources) as Array<[string, SourceDef]>) {
    const bodies: StepBody[] = (await readStepBodies(source.file, level)).map(b => normaliseAxes(b, source.upAxis));
    const referenced: number[] = models.filter(([, m]) => m.source === key).map(([, m]) => m.bodyIndex);
    checkBodyMapping(key, bodies.map(b => ({ index: b.index, sizeMm: bodySizeMm(b) })), source.bodyCount, referenced, source.dropBodies ?? []);
    result.set(key, bodies);
  }
  return result;
}

const writeFile = (path: string, data: string | Uint8Array): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, data);
};

/**
 * Converts every model of the product in `productDir` at both quality levels and writes:
 * - `<publicDir>/bundles/<id>/<version>/product.json` (a BuiltProduct) and `parts/*.glb`;
 * - `<publicDir>/products/<id>.json`, the pointer to the current version.
 * Sources are converted one after another; parallel worker threads can come when inputs get large.
 */
export async function convertProduct(productDir: string, publicDir: string, onModel?: (row: ModelRow) => void): Promise<SizeReport> {
  const { product } = readProduct(productDir);
  const levels: Array<['default' | 'light', TessellationLevel]> = [['default', TESSELLATION_LEVELS.default], ['light', TESSELLATION_LEVELS.light]];
  const glbs: Map<string, Uint8Array> = new Map(); // file name (without .glb) → bytes
  const rows: Map<string, ModelRow> = new Map();

  for (const [levelName, level] of levels) {
    const sources: Map<string, StepBody[]> = await readSources(product, level);
    for (const [modelId, model] of convertedModels(product)) {
      const raw: StepBody = sources.get(model.source)![model.bodyIndex];
      const { body, droppedTriangles } = applyFaceRules(raw, model.faceRules ?? []);
      const glb: Uint8Array = await writeGlb(body, METRES_PER_MM);
      const brotli: number = brotliCompressSync(glb).length;
      if (levelName === 'default') {
        glbs.set(modelId, glb);
        rows.set(modelId, { model: modelId, triangles: body.indices.length / 3, droppedTriangles, brotliBytes: brotli, lightBrotliBytes: 0 });
      } else {
        glbs.set(`${modelId}.light`, glb);
        rows.get(modelId)!.lightBrotliBytes = brotli;
      }
    }
  }

  const settingsJson: string = JSON.stringify(product);
  const version: string = computeVersion(`${settingsJson}\nlook:${lookFingerprint(LOOK_SOURCES_DIR)}`, [...glbs.entries()]);
  const files: Record<string, ModelFiles> = {};
  for (const [modelId] of convertedModels(product)) files[modelId] = { default: `parts/${modelId}.glb`, light: `parts/${modelId}.light.glb` };
  const built: BuiltProduct = { ...product, version, files, stills: { pattern: 'stills/{key}.webp', sizePx: STILL_SIZE_PX } };

  const bundle: string = `bundles/${product.id}/${version}/`;
  for (const [name, bytes] of glbs) writeFile(join(publicDir, bundle, 'parts', `${name}.glb`), bytes);
  writeFile(join(publicDir, bundle, 'product.json'), JSON.stringify(built, null, 2));
  const pointer = { version, bundle, defaultStill: `${bundle}stills/${configurationKey(product, product.defaultSelection)}.webp` };
  writeFile(join(publicDir, 'products', `${product.id}.json`), JSON.stringify(pointer, null, 2));

  const brotliBytes: Record<string, number> = {};
  for (const row of rows.values()) {
    brotliBytes[row.model] = row.brotliBytes;
    onModel?.(row);
  }
  return { version, brotliBytes, totalBrotliBytes: Object.values(brotliBytes).reduce((a, b) => a + b, 0) };
}
