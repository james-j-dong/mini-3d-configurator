// Throwaway spike: build one self-contained HTML page (code + models inline) for claude.ai.
// Usage: node build-artifact.mts <out.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { build, type BuildResult } from 'esbuild';

const out: string = process.argv[2];
const MODELS: string[] = ['knob-round', 'plate-6r-down', 'plate-6r-down-second-body'];

const result: BuildResult & { outputFiles: { text: string }[] } = await build({
  entryPoints: ['public/spike.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  write: false,
  logLevel: 'warning',
});
// An inline script must never contain a closing script tag.
const bundle: string = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const models: Record<string, string> = {};
for (const name of MODELS) models[name] = readFileSync(`public/models/${name}.glb`).toString('base64');
const modelsJs: string = `globalThis.EMBEDDED_GLB = ${JSON.stringify(models)};`;

const template: string = readFileSync('artifact-template.html', 'utf8');
const html: string = template.replace('/*__MODELS__*/', () => modelsJs).replace('/*__BUNDLE__*/', () => bundle);
writeFileSync(out, html);
console.log(`wrote ${out}: ${(html.length / 1024).toFixed(0)} KB (bundle ${(bundle.length / 1024).toFixed(0)} KB, models ${(modelsJs.length / 1024).toFixed(0)} KB base64)`);
