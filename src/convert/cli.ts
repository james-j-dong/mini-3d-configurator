// npm run convert -- <productDir> [--inspect] [--update-baseline]
//   --inspect          print every part instance of every source (name, bodies, size, centre, triangles), then exit
//   --update-baseline  rewrite <productDir>/size-baseline.json with this run's sizes
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceDef } from '../schema/product.ts';
import { readStepFile, REFERENCE_TOLERANCE, type StepFile } from './occt.ts';
import { centreOf, combinedBox, describeBody, formatMm, indexParts, type BodyBox, type PartIndex } from './parts.ts';
import { compareWithBaseline, convertProduct, ConvertError, readProduct, type ModelGroup, type ModelRow, type SizeReport } from './bundle.ts';

const PUBLIC_DIR: string = 'public';
const kb = (bytes: number): string => (bytes / 1024).toFixed(1);

const sizeText = (box: BodyBox): string => [0, 1, 2].map(a => formatMm(box.maxMm[a] - box.minMm[a])).join(' × ');
const centreText = (box: BodyBox): string => `(${centreOf(box).map(formatMm).join(', ')})`;

/**
 * Every part instance of every source, from one coarse read, to write a settings file from:
 * name, occurrence, body count, size, centre and coarse triangle count. Bodies an instance owns
 * directly get a line each (picked with `bodies`); bodies under no named part are listed last.
 */
async function inspect(productDir: string): Promise<void> {
  const { product } = readProduct(productDir);
  for (const [key, source] of Object.entries(product.sources) as Array<[string, SourceDef]>) {
    console.log(`${key}  (${source.file})`);
    const file: StepFile = await readStepFile(source.file, REFERENCE_TOLERANCE);
    const index: PartIndex = indexParts(file, source.upAxis);
    const triangles = (bodies: number[]): number => bodies.reduce((sum, b) => sum + file.bodies[b].indices.length / 3, 0);
    index.instances.forEach((instance, i) => {
      const box: BodyBox = combinedBox(index, instance.bodies);
      const count: string = `${instance.bodies.length} ${instance.bodies.length === 1 ? 'body' : 'bodies'}`;
      console.log(`  "${instance.name}" #${instance.occurrence}  ${count}  size ${sizeText(box)} mm  centre ${centreText(box)}  ${triangles(instance.bodies)} triangles (coarse)`);
      if (instance.bodies.length < 2) return;
      instance.bodies.forEach((b, k) => {
        if (index.owner[b] === i) console.log(`    body ${k}  size ${sizeText(index.boxes[b])} mm  centre ${centreText(index.boxes[b])}`);
      });
    });
    index.owner.forEach((owner, b) => {
      if (owner < 0) console.log(`  ${describeBody(index, b)}  ${triangles([b])} triangles (coarse)`);
    });
  }
}

async function convert(productDir: string, updateBaseline: boolean): Promise<number> {
  const rows: ModelRow[] = [];
  const report: SizeReport = await convertProduct(productDir, PUBLIC_DIR, row => rows.push(row));

  console.table(rows.map(r => ({
    model: r.model,
    group: r.group,
    triangles: r.triangles,
    dropped: r.droppedTriangles,
    simplified: r.simplifiedTriangles,
    'brotli KB': kb(r.brotliBytes),
    'light brotli KB': kb(r.lightBrotliBytes),
  })));
  const groupKb = (group: ModelGroup): string => kb(rows.filter(r => r.group === group).reduce((sum, r) => sum + r.brotliBytes, 0));
  console.log(`always shown: ${groupKb('alwaysShown')} KB · variants: ${groupKb('variants')} KB · after first view: ${groupKb('afterFirstView')} KB (brotli, default level)`);

  const baselinePath: string = join(productDir, 'size-baseline.json');
  const baseline: SizeReport | null = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) as SizeReport : null;
  const { deltaRatio, flagged } = compareWithBaseline(report, baseline);
  const delta: string = baseline ? `${deltaRatio >= 0 ? '+' : ''}${(deltaRatio * 100).toFixed(1)}% against baseline ${baseline.version}` : 'no baseline yet';
  console.log(`version ${report.version}: ${rows.length} models, total ${kb(report.totalBrotliBytes)} KB brotli (default level), ${delta}`);

  if (updateBaseline) {
    writeFileSync(baselinePath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`baseline written to ${baselinePath}`);
    return 0;
  }
  if (flagged) {
    console.error(`FLAGGED: bundle grew by more than 10%. If this is intended, rerun with --update-baseline.`);
    return 1;
  }
  return 0;
}

const args: string[] = process.argv.slice(2);
const productDir: string | undefined = args.find(a => !a.startsWith('--'));
if (!productDir) {
  console.error('usage: npm run convert -- <productDir> [--inspect] [--update-baseline]');
  process.exit(2);
}
try {
  if (args.includes('--inspect')) await inspect(productDir);
  else process.exitCode = await convert(productDir, args.includes('--update-baseline'));
} catch (error) {
  if (error instanceof ConvertError) {
    console.error(`conversion failed: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
