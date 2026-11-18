import { expect, test } from 'vitest';
import { Box3, MathUtils, Vector3 } from 'three';
import type { Framing } from '../../src/schema/product.ts';
import { fitDistance, OrbitController } from '../../src/viewer/render/orbit.ts';

const framing: Framing = { azimuthDeg: 35, polarDeg: 71, maxPolarDeg: 83, minZoom: 0.35, maxZoom: 1.6, fovDeg: 30 };
const bounds = new Box3(new Vector3(-0.045, -0.003, -0.045), new Vector3(0.045, 0.225, 0.045));

test('a tall product sits farther away in a portrait box', () => {
  expect(fitDistance(30, 390 / 422, bounds)).toBeGreaterThan(fitDistance(30, 1.5, bounds));
});

test('a drag of a quarter box height turns a quarter circle', () => {
  const o = new OrbitController(framing); o.fit(800, 600, bounds); const a0 = o.azimuth;
  o.drag(150, 0, 600); expect(o.azimuth - a0).toBeCloseTo(-Math.PI / 2, 9);
});

test('coasting after release slows to a stop', () => {
  const o = new OrbitController(framing); o.fit(800, 600, bounds); o.drag(20, 0, 600); o.release();
  expect(o.step(16.7)).toBe(true);
  let n = 0; while (o.step(16.7) && n < 1000) n++;
  expect(n).toBeLessThan(300);
});

test('cannot orbit past maxPolarDeg', () => {
  const o = new OrbitController(framing); o.fit(800, 600, bounds); o.drag(0, 5000, 600);
  expect(o.polar).toBeLessThanOrEqual(MathUtils.degToRad(83) + 1e-9);
  o.drag(0, -5000, 600);
  expect(o.polar).toBeLessThanOrEqual(MathUtils.degToRad(83) + 1e-9);
});

test('zoom stays within its limits', () => {
  const o = new OrbitController(framing); o.fit(800, 600, bounds);
  o.zoom(100, 0, 0); expect(o.distance).toBeCloseTo(0.35 * o.fitDistance, 9);
  o.zoom(0.0001, 0, 0); expect(o.distance).toBeCloseTo(1.6 * o.fitDistance, 9);
});
