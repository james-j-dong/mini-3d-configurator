// Product id → bundle URLs. The only place the viewer builds file paths, so moving bundles
// (to R2, or behind a backend) changes this file, not the viewer.

/** `/products/<id>.json`: which bundle version is current. */
interface ProductPointer { version: string; bundle: string; defaultStill: string }

export async function resolveProductUrl(id: string, origin: string): Promise<{ productUrl: string; defaultStillUrl: string }> {
  const response: Response = await fetch(`${origin}/products/${encodeURIComponent(id)}.json`);
  if (!response.ok) throw new Error(`product "${id}" not found (HTTP ${response.status})`);
  const pointer: ProductPointer = await response.json() as ProductPointer;
  const base: string = `${origin}/`;
  return {
    productUrl: new URL(`${pointer.bundle}product.json`, base).href,
    defaultStillUrl: new URL(pointer.defaultStill, base).href,
  };
}
