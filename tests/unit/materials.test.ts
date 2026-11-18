import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { MeshPhysicalMaterial, Texture } from 'three';
import type { Product } from '../../src/schema/product.ts';
import { validateProduct } from '../../src/schema/validate.ts';
import { createMaterials } from '../../src/viewer/render/materials.ts';
import type { FinishTextures } from '../../src/viewer/render/textures.ts';

const ob1: Product = validateProduct(JSON.parse(readFileSync('products/ob1/product.json', 'utf8')));

const stubTextures = (): FinishTextures => ({
  weaveAlbedo: new Texture(),
  weaveNormal: new Texture(),
  weaveRoughness: new Texture(),
  forgedAlbedo: new Texture(),
  forgedRoughness: new Texture(),
});

test('every OB1 finish gets a material in both tiers', () => {
  for (const tier of ['full', 'lean'] as const) {
    const mats = createMaterials(ob1, stubTextures(), tier);
    expect([...mats.keys()].sort()).toEqual(Object.keys(ob1.finishes).sort());
    const weave = mats.get('carbonWeave') as MeshPhysicalMaterial;
    expect(weave.clearcoat).toBe(tier === 'full' ? 1 : 0);
  }
});

test('no material ever uses anisotropy', () => {
  for (const tier of ['full', 'lean'] as const)
    for (const m of createMaterials(ob1, stubTextures(), tier).values()) expect((m as MeshPhysicalMaterial).anisotropy ?? 0).toBe(0);
});
