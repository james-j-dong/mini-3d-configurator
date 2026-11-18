// loader.js — the only file an embedding page references. Tiny and cached for minutes: it shows
// each viewer's still at once and fetches the viewer code (content-hashed, cached for a year) only
// when a viewer comes within 200 px of the screen.
//
// It deliberately imports nothing from the viewer: a module shared with the hashed chunks would be
// bundled into this unhashed file, and an old chunk could then import from a newer loader.js after
// a deploy. So the pointer-file lookup below mirrors products.ts in a few lines.

const ORIGIN: string = new URL(import.meta.url).origin;
const prepared: WeakSet<Element> = new WeakSet();

const nearScreen: IntersectionObserver = new IntersectionObserver(entries => {
  if (!entries.some(e => e.isIntersecting)) return;
  nearScreen.disconnect();
  import('./element.ts') // defines <mini3d-viewer>; existing elements upgrade
    .catch(loadCurrentLoader);
}, { rootMargin: '200px' });

/**
 * This loader.js may be a copy cached from before a deploy, pointing at viewer chunks the new
 * deploy no longer has. Fetch the current loader once (a fresh URL skips the cache); it takes over.
 */
function loadCurrentLoader(): void {
  const self: URL = new URL(import.meta.url);
  if (self.searchParams.has('fresh')) return; // already the current one: leave the stills up
  self.searchParams.set('fresh', String(Date.now()));
  void import(/* @vite-ignore */ self.href);
}

async function showStill(el: HTMLElement, productId: string): Promise<void> {
  try {
    const response: Response = await fetch(`${ORIGIN}/products/${encodeURIComponent(productId)}.json`);
    if (!response.ok) return;
    const pointer: { defaultStill: string } = await response.json() as { defaultStill: string };
    el.style.background = `url("${new URL(pointer.defaultStill, `${ORIGIN}/`).href}") center / contain no-repeat`;
    el.dataset.loaderStill = '';
  } catch {
    // The viewer shows its own still once it loads.
  }
}

function prepare(el: HTMLElement): void {
  if (prepared.has(el)) return;
  prepared.add(el);
  el.dataset.origin ??= ORIGIN;
  const productId: string | null = el.getAttribute('product');
  if (productId) void showStill(el, productId);
  nearScreen.observe(el);
}

function scan(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('mini3d-viewer').forEach(prepare);
}

scan(document);
new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.localName === 'mini3d-viewer') prepare(node);
      else scan(node);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });
