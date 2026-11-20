import { expect, test } from 'vitest';
import { Box3, Vector3 } from 'three';
import { shadowPlacement } from '../../src/viewer/render/studio.ts';

test('the shadow covers the real base and sits under it', () => {
  const p = shadowPlacement(new Box3(new Vector3(-0.045, -0.004, -0.065), new Vector3(0.045, 0.2232, 0.065)));
  expect(p.footprintM).toBeCloseTo(0.13, 6);
  expect(p.floorYM).toBeCloseTo(-0.004, 6);
});
