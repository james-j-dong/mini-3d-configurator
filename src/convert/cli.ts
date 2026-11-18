// npm run convert -- <productDir> [--inspect] [--update-baseline]
//   --inspect          print every body of every source (index, name, size in mm), then exit
//   --update-baseline  rewrite <productDir>/size-baseline.json with this run's sizes
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceDef } from '../schema/product.ts';
import { readStepBodies, TESSELLATION_LEVELS, type StepBody } from './occt.ts';
import { normaliseAxes } from './geometry.ts';
import { bodySizeMm, compareWithBaseline, convertProduct, ConvertError, readProduct, type ModelRow, type SizeReport } from './bundle.ts';

const PUBLIC_DIR: string = 'public';
const kb = (bytes: number): string => (bytes / 1024).toFixed(1);

async function inspect(productDir: string): Promise<void> {
  const { product } = readProduct(productDir);
  for (const [key, source] of Object.entries(product.sources) as Array<[string, SourceDef]>) {
    console.log(`${key}  (${source.file})`);
    const bodies: StepBody[] = await readStepBodies(source.file, TESSELLATION_LEVELS.default);
    for (const body of bodies.map(b => normaliseAxes(b, source.upAxis))) {
      const size: string = bodySizeMm(body).map(n => n.toFixed(1)).join(' × ');
      console.log(`  body ${body.index}  "${body.name}"  ${size} mm  ${body.indices.length / 3} triangles`);
    }
  }
}

async function convert(productDir: string, updateBaseline: boolean): Promise<number> {
  const rows: ModelRow[] = [];
  const report: SizeReport = await convertProduct(productDir, PUBLIC_DIR, row => rows.push(row));

  console.table(rows.map(r => ({
    model: r.model,
    triangles: r.triangles,
    dropped: r.droppedTriangles,
    'brotli KB': kb(r.brotliBytes),
    'light brotli KB': kb(r.lightBrotliBytes),
  })));

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
