// Turns a product folder (settings file + STEP sources) into a versioned static bundle.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import type { BuiltProduct, ModelDef, ModelFiles, Product, SlotDef, SourceDef } from '../schema/product.ts';
import { possibleModels, validateProduct } from '../schema/validate.ts';
import { configurationKey } from '../schema/configurations.ts';
import { readStepFile, REFERENCE_TOLERANCE, type StepBody, type StepFile } from './occt.ts';
import { applyFaceRules, mergeBodies, normaliseAxes, placeBody, simplifyBody } from './geometry.ts';
import { writeGlb } from './glb.ts';
import { claimBodies, indexParts } from './parts.ts';
import { readAtDetail, type DetailLevel } from './tessellate.ts';

export { ConvertError } from './parts.ts';

/** Brotli sizes per model id at the default level. */
export interface SizeReport { version: string; brotliBytes: Record<string, number>; totalBrotliBytes: number }

/** When a model is needed: in every configuration's first view, only in some configurations, or after the first view. */
export type ModelGroup = 'alwaysShown' | 'variants' | 'afterFirstView';

/** One converted model, for the CLI's table. Triangle counts are at the default level. */
export interface ModelRow {
  model: string;
  group: ModelGroup;
  triangles: number;
  droppedTriangles: number;
  simplifiedTriangles: number;
  brotliBytes: number;
  lightBrotliBytes: number;
}

/** OpenCascade returns millimetres for every source (see occt.ts). */
const METRES_PER_MM: number = 0.001;
const GROWTH_LIMIT: number = 0.10;
const STILL_SIZE_PX: number = 1000;

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

export function readProduct(productDir: string): { product: Product; json: string } {
  const json: string = readFileSync(join(productDir, 'product.json'), 'utf8');
  return { product: validateProduct(JSON.parse(json)), json };
}

type ConvertedModel = Extract<ModelDef, { kind: 'converted' }>;

function convertedModels(p: Product): Array<[string, ConvertedModel]> {
  return Object.entries(p.models).filter((e): e is [string, ConvertedModel] => e[1].kind === 'converted');
}

/**
 * Converted models only, each list in product.models key order:
 * - afterFirstView: every slot that can hold the model is afterFirstView;
 * - variants: otherwise, some slot that can hold it can hold more than one model;
 * - alwaysShown: the rest.
 */
export function groupModels(p: Product): Record<ModelGroup, string[]> {
  const groups: Record<ModelGroup, string[]> = { alwaysShown: [], variants: [], afterFirstView: [] };
  const slotModels: Map<string, Set<string>> = new Map(p.slots.map(s => [s.id, possibleModels(p, s.id)]));
  for (const [id] of convertedModels(p)) {
    const holders: SlotDef[] = p.slots.filter(s => slotModels.get(s.id)!.has(id));
    if (holders.length > 0 && holders.every(s => s.afterFirstView === true)) groups.afterFirstView.push(id);
    else if (holders.some(s => slotModels.get(s.id)!.size > 1)) groups.variants.push(id);
    else groups.alwaysShown.push(id);
  }
  return groups;
}

/** One model's Y-up body at one level: its claimed bodies merged, face rules applied, then simplified. */
async function buildModelBody(
  modelId: string,
  model: ConvertedModel,
  bodies: StepBody[],
  level: DetailLevel,
): Promise<{ body: StepBody; droppedTriangles: number; simplifiedTriangles: number }> {
  const { body: trimmed, droppedTriangles } = applyFaceRules(mergeBodies(modelId, bodies), model.faceRules ?? []);
  if (model.simplifyErrorMm === undefined) return { body: trimmed, droppedTriangles, simplifiedTriangles: 0 };
  const errorMm: number = level === 'light' ? 2 * model.simplifyErrorMm : model.simplifyErrorMm;
  const { body, removedTriangles } = await simplifyBody(trimmed, errorMm);
  return { body, droppedTriangles, simplifiedTriangles: removedTriangles };
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
  const glbs: Map<string, Uint8Array> = new Map(); // file name (without .glb) → bytes
  const rows: Map<string, ModelRow> = new Map();   // in product.models key order
  const groups: Record<ModelGroup, string[]> = groupModels(product);
  const groupOf = (id: string): ModelGroup => (Object.keys(groups) as ModelGroup[]).find(g => groups[g].includes(id))!;
  for (const [modelId] of convertedModels(product)) {
    rows.set(modelId, { model: modelId, group: groupOf(modelId), triangles: 0, droppedTriangles: 0, simplifiedTriangles: 0, brotliBytes: 0, lightBrotliBytes: 0 });
  }

  for (const [key, source] of Object.entries(product.sources) as Array<[string, SourceDef]>) {
    // One coarse read finds the parts and their sizes; every body must be claimed exactly once.
    const reference: StepFile = await readStepFile(source.file, REFERENCE_TOLERANCE);
    const models: Array<[string, ConvertedModel]> = convertedModels(product).filter(([, m]) => m.source === key);
    const claims: Map<string, number[]> = claimBodies(key, indexParts(reference, source.upAxis), models.map(([id, m]) => ({ id, parts: m.parts })), source.leaveOut ?? []);
    const claimed: number[] = [...claims.values()].flat().sort((a, b) => a - b);

    for (const level of ['default', 'light'] as const) {
      // Left-out bodies are never read at their own fine tolerance.
      const file: StepFile = await readAtDetail(source.file, reference, level, claimed);
      for (const [modelId, model] of models) {
        const bodies: StepBody[] = claims.get(modelId)!.map(b => normaliseAxes(file.bodies[b], source.upAxis));
        const { body, droppedTriangles, simplifiedTriangles } = await buildModelBody(modelId, model, bodies, level);
        // Face rules and simplification work in the file's frame; the placement comes last.
        const placed: StepBody = source.placement ? placeBody(body, source.placement) : body;
        const glb: Uint8Array = await writeGlb(placed, METRES_PER_MM);
        const brotli: number = brotliCompressSync(glb).length;
        const row: ModelRow = rows.get(modelId)!;
        if (level === 'default') {
          glbs.set(modelId, glb);
          Object.assign(row, { triangles: body.indices.length / 3, droppedTriangles, simplifiedTriangles, brotliBytes: brotli });
        } else {
          glbs.set(`${modelId}.light`, glb);
          row.lightBrotliBytes = brotli;
        }
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
