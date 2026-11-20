import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { MeshPhysicalMaterial, Texture } from 'three';
import type { Product } from '../../src/schema/product.ts';
import { validateProduct } from '../../src/schema/validate.ts';
import { createMaterialTiers } from '../../src/viewer/render/materials.ts';
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
  const tiers = createMaterialTiers(ob1, stubTextures());
  for (const tier of ['full', 'lean'] as const) {
    expect([...tiers[tier].keys()].sort()).toEqual(Object.keys(ob1.finishes).sort());
    const weave = tiers[tier].get('carbonWeave') as MeshPhysicalMaterial;
    expect(weave.clearcoat).toBe(tier === 'full' ? 1 : 0);
  }
});

test('no material ever uses anisotropy', () => {
  const tiers = createMaterialTiers(ob1, stubTextures());
  for (const tier of ['full', 'lean'] as const)
    for (const m of tiers[tier].values()) expect((m as MeshPhysicalMaterial).anisotropy ?? 0).toBe(0);
});

test('a finish that looks the same in both tiers is one material, so every part is warmed with it once', () => {
  const { full, lean } = createMaterialTiers(ob1, stubTextures());
  expect(lean.get('steel')).toBe(full.get('steel'));                     // metal
  expect(lean.get('rubber')).toBe(full.get('rubber'));                   // matte
  expect(lean.get('carbonWeave')).not.toBe(full.get('carbonWeave'));     // carbon loses its clear coat at lean
  expect(lean.get('forgedCarbon')).not.toBe(full.get('forgedCarbon'));
  // OB1: 14 metal and matte finishes shared, 2 carbon finishes in two versions each.
  expect(new Set([...full.values(), ...lean.values()]).size).toBe(14 + 2 * 2);
});
