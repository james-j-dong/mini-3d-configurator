import { expect, test } from 'vitest';
import { Box3, Vector3, type PlaneGeometry } from 'three';
import { createShadow, shadowPlacement } from '../../src/viewer/render/studio.ts';

test('the shadow covers the real base and sits under it', () => {
  const p = shadowPlacement(new Box3(new Vector3(-0.045, -0.004, -0.065), new Vector3(0.045, 0.2232, 0.065)));
  expect(p.footprintM).toBeCloseTo(0.13, 6);
  expect(p.floorYM).toBeCloseTo(-0.004, 6);
});

test('the shadow sits under a product whose CAD origin is at one corner', () => {
  // 90 mm wide and 130 mm deep, starting at the origin rather than centred on it; its underside is 10 mm up.
  const shadow = createShadow(shadowPlacement(new Box3(new Vector3(0, 0.01, 0), new Vector3(0.09, 0.2, 0.13))));
  expect(shadow.position.x).toBeCloseTo(0.045, 6);
  expect(shadow.position.z).toBeCloseTo(0.065, 6);
  expect(shadow.position.y).toBeGreaterThan(0.01);   // on the floor the product stands on, a hair above it
  expect(shadow.position.y).toBeLessThan(0.011);
  const size = (shadow.geometry as PlaneGeometry).parameters;
  expect(size.width).toBeGreaterThan(0.13);          // wider than the base, so the soft edge shows all round
  expect(size.height).toBe(size.width);
});

test('a product centred on the origin keeps its shadow at the origin', () => {
  const shadow = createShadow(shadowPlacement(new Box3(new Vector3(-0.045, -0.004, -0.065), new Vector3(0.045, 0.2232, 0.065))));
  expect(shadow.position.x).toBeCloseTo(0, 9);
  expect(shadow.position.z).toBeCloseTo(0, 9);
});
