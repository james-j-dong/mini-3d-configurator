// npm run stills -- <productId>   (run `npm run convert` first; stills go into the current bundle version)
import { renderStills } from './stills.ts';

const productId: string | undefined = process.argv[2];
if (!productId) {
  console.error('usage: npm run stills -- <productId>');
  process.exit(2);
}
const started: number = performance.now();
const { count, totalBytes } = await renderStills(productId, 'public');
console.log(`${count} stills, ${(totalBytes / 1024).toFixed(0)} KB total, in ${((performance.now() - started) / 1000).toFixed(1)} s`);
