import { expect, test } from 'vitest';
import { FrameIntervals, QUALITY_LEVELS, QualityGovernor } from '../../src/viewer/render/governor.ts';

test('steps down after slow frames and probes back up after a quiet spell', () => {
  const g = new QualityGovernor(); let t = 0;
  for (let i = 0; i < 60; i++) g.record(40, (t += 40));
  expect(g.level).toEqual(QUALITY_LEVELS[1]);
  for (let i = 0; i < 700; i++) g.record(16.7, (t += 16.7));
  expect(g.level).toEqual(QUALITY_LEVELS[0]);
});

test('a single dropped frame does not change quality', () => {
  const g = new QualityGovernor(); let t = 0;
  for (let i = 0; i < 59; i++) g.record(16.7, (t += 16.7));
  g.record(33.3, (t += 33.3));
  expect(g.level).toEqual(QUALITY_LEVELS[0]);
});

test('only frames drawn back to back are timed; idle gaps never count', () => {
  const f = new FrameIntervals();
  expect(f.tick(1000, true, true)).toBeNull();          // first frame of a spin: nothing to compare with
  expect(f.tick(1016.7, true, true)).toBeCloseTo(16.7, 9);
  expect(f.tick(1033.4, true, false)).toBeCloseTo(16.7, 9); // last frame: the loop stops after it
  expect(f.tick(4000, true, true)).toBeNull();          // a pick 3 s later is not a 2967 ms frame
  expect(f.tick(4016.7, false, true)).toBeNull();       // a tick that drew nothing breaks the chain
  expect(f.tick(4033.4, true, true)).toBeNull();
  f.reset();                                             // hidden tab, lost context
  expect(f.tick(9000, true, true)).toBeNull();
});
