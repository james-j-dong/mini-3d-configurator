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
  o.grab(0); o.drag(150, 0, 600, 16.7); expect(o.azimuth - a0).toBeCloseTo(-Math.PI / 2, 9);
});

test('coasting after release slows to a stop', () => {
  const o = new OrbitController(framing); o.fit(800, 600, bounds); o.grab(0); o.drag(20, 0, 600, 16.7); o.release(16.7);
  expect(o.step(16.7)).toBe(true);
  let n = 0; while (o.step(16.7) && n < 1000) n++;
  expect(n).toBeLessThan(300);
});

test('cannot orbit past maxPolarDeg', () => {
  const o = new OrbitController(framing); o.fit(800, 600, bounds); o.grab(0); o.drag(0, 5000, 600, 16.7);
  expect(o.polar).toBeLessThanOrEqual(MathUtils.degToRad(83) + 1e-9);
  o.drag(0, -5000, 600, 33.4);
  expect(o.polar).toBeLessThanOrEqual(MathUtils.degToRad(83) + 1e-9);
});

test('zoom stays within its limits', () => {
  const o = new OrbitController(framing); o.fit(800, 600, bounds);
  o.zoom(100, 0, 0); expect(o.distance).toBeCloseTo(0.35 * o.fitDistance, 9);
  o.zoom(0.0001, 0, 0); expect(o.distance).toBeCloseTo(1.6 * o.fitDistance, 9);
});

// ---------- coasting speed ----------
// A drag turns 2π per box height, so on a 600 px box 3 px is 0.0314159 rad and 10 px is 0.1047198 rad.

function newOrbit(): OrbitController {
  const o = new OrbitController(framing); o.fit(800, 600, bounds);
  return o;
}

/** Touches at t = 0, then drags `px` to the right at each of `times`. */
function dragAt(o: OrbitController, px: number, times: number[]): void {
  o.grab(0);
  for (const t of times) o.drag(px, 0, 600, t);
}

/** The angle turned in the first 16.7 ms of coasting. */
function firstCoastStep(o: OrbitController): number {
  const before: number = o.azimuth;
  o.step(16.7);
  return o.azimuth - before;
}

/** The whole angle turned while coasting to a stop. */
function coastAngle(o: OrbitController): number {
  const before: number = o.azimuth;
  let n = 0; while (o.step(16.7) && n < 2000) n++;
  return o.azimuth - before;
}

const EVERY_FRAME: number[] = [16.7, 33.4, 50.1, 66.8, 83.5, 100.2, 116.9, 133.6, 150.3, 167];

test('after a steady drag the model keeps turning at the drag\'s own speed', () => {
  const o = newOrbit();
  dragAt(o, 3, EVERY_FRAME); o.release(167);
  expect(firstCoastStep(o)).toBeCloseTo(-0.0314159, 5);
});

test('two moves stamped almost together do not multiply the coasting speed', () => {
  const steady = newOrbit();
  dragAt(steady, 3, EVERY_FRAME); steady.release(167);
  // The same drag, but the last two moves arrive 33 ms late and 0.2 ms apart (queued behind a slow frame).
  const bunched = newOrbit();
  dragAt(bunched, 3, [16.7, 33.4, 50.1, 66.8, 83.5, 100.2, 116.9, 133.6, 166.6, 166.8]); bunched.release(166.8);
  const ratio: number = coastAngle(bunched) / coastAngle(steady);
  expect(ratio).toBeGreaterThan(0.8);
  expect(ratio).toBeLessThan(1.25);
});

test('a pace is never judged over less than one frame', () => {
  const o = newOrbit();
  dragAt(o, 10, [0.2]); o.release(0.2); // 10 px in 0.2 ms is a timestamp glitch, not a 50 px/ms flick
  expect(firstCoastStep(o)).toBeCloseTo(-0.1047198, 5);
});

test('a single quick move coasts at its pace since the touch', () => {
  const o = newOrbit();
  dragAt(o, 10, [16.7]); o.release(20);
  expect(firstCoastStep(o)).toBeCloseTo(-0.1047198, 5);
});

test('a flick after a rest coasts at the flick\'s speed, not the rest\'s', () => {
  const o = newOrbit();
  dragAt(o, 1, [16.7]);          // a nudge, then the finger rests for half a second
  o.drag(10, 0, 600, 516.7);
  o.drag(10, 0, 600, 533.4);
  o.release(535);
  expect(firstCoastStep(o)).toBeCloseTo(-0.1047198, 5);
});

test('a finger that rested before lifting does not coast', () => {
  const o = newOrbit();
  dragAt(o, 3, EVERY_FRAME); o.release(267); // lifted 100 ms after the last move
  expect(o.isCoasting).toBe(false);
});

test('a second touch stops the coasting and forgets the old drag', () => {
  const o = newOrbit();
  dragAt(o, 10, EVERY_FRAME); o.release(167);
  o.grab(300);
  expect(o.isCoasting).toBe(false);
  o.release(310); // lifted again without moving
  expect(o.isCoasting).toBe(false);
});
