import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root: string = import.meta.dirname;
const hashed: string = 'v1/assets/[name]-[hash].js';

// Output layout:
//   dist/v1/loader.js        unhashed, short cache — the one URL embedding pages reference
//   dist/v1/assets/*         content-hashed viewer, worker and page files, cached for a year
//   dist/products, bundles   copied from public/
export default defineConfig({
  // Relative base: chunks, the worker and assets resolve against import.meta.url, so the viewer
  // works when its files are served from another origin than the embedding page.
  base: './',
  build: {
    // No <link rel=modulepreload> injection: it would touch the embedding page's <head>.
    modulePreload: false,
    rolldownOptions: {
      input: {
        index: resolve(root, 'index.html'),
        capture: resolve(root, 'src/site/capture.html'),
        loader: resolve(root, 'src/viewer/loader.ts'),
      },
      output: {
        entryFileNames: chunk => (chunk.name === 'loader' ? 'v1/loader.js' : hashed),
        chunkFileNames: hashed,
        assetFileNames: 'v1/assets/[name]-[hash][extname]',
      },
    },
  },
  worker: {
    format: 'es',
    rolldownOptions: {
      output: { entryFileNames: hashed, chunkFileNames: hashed, assetFileNames: 'v1/assets/[name]-[hash][extname]' },
    },
  },
});
