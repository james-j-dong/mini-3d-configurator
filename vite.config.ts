import { posix, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const root: string = import.meta.dirname;
const hashed: string = 'v1/assets/[name]-[hash].js';
const LOADER_FILE: string = 'v1/loader.js';
/** How loader.ts names the viewer module (its VIEWER_MODULE constant). */
const VIEWER_MODULE_IN_LOADER: string = './element.ts';

/**
 * loader.ts names the viewer module by its source path, so Vite leaves that import alone. This
 * points the built loader.js at the built viewer chunk instead, and fails the build if loader.js
 * ends up with a static import: it must run on its own, whatever chunks a deploy has renamed.
 */
function pointLoaderAtViewerChunk(): Plugin {
  return {
    name: 'mini3d:point-loader-at-viewer-chunk',
    generateBundle(_options, bundle): void {
      const loader = bundle[LOADER_FILE];
      if (!loader || loader.type !== 'chunk') return; // not the build that makes loader.js (the worker's, for example)
      const viewer = Object.values(bundle).find(file => file.type === 'chunk' && file.isEntry && file.name === 'element');
      if (!viewer) throw new Error('loader.js: the viewer chunk (entry "element") is missing from the build');
      if (!loader.code.includes(VIEWER_MODULE_IN_LOADER)) throw new Error(`loader.js: expected it to name ${VIEWER_MODULE_IN_LOADER}`);
      if (loader.imports.length > 0) throw new Error(`loader.js must not import other chunks statically: ${loader.imports.join(', ')}`);
      const relative: string = posix.relative(posix.dirname(LOADER_FILE), viewer.fileName);
      loader.code = loader.code.replaceAll(VIEWER_MODULE_IN_LOADER, `./${relative}`);
    },
  };
}

// Output layout:
//   dist/v1/loader.js        unhashed, short cache — the one URL embedding pages reference
//   dist/v1/assets/*         content-hashed viewer, worker and page files, cached for a year
//   dist/products, bundles   copied from public/
export default defineConfig({
  plugins: [pointLoaderAtViewerChunk()],
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
        // An entry of its own so it gets built: loader.ts no longer imports it in a way the bundler follows.
        element: resolve(root, 'src/viewer/element.ts'),
      },
      output: {
        entryFileNames: chunk => (chunk.name === 'loader' ? LOADER_FILE : hashed),
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
