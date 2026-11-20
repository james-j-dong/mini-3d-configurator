import { expect, test } from 'vitest';
import { DisplayInterval, FrameIntervals, QUALITY_LEVELS, QualityGovernor } from '../../src/viewer/render/governor.ts';

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

// ---------- displays slower than 60 Hz ----------

test('a 30 fps display with a fast GPU keeps full quality', () => {
  const g = new QualityGovernor(); let t = 0;
  g.displayMs = 33.3; // iOS Low Power Mode: every frame arrives on time, 33.3 ms apart
  for (let i = 0; i < 300; i++) g.record(33.3, (t += 33.3));
  expect(g.level).toEqual(QUALITY_LEVELS[0]);
});

test('a 48 Hz display with a fast GPU keeps full quality', () => {
  const g = new QualityGovernor(); let t = 0;
  g.displayMs = 20.8;
  for (let i = 0; i < 300; i++) g.record(20.8, (t += 20.8));
  expect(g.level).toEqual(QUALITY_LEVELS[0]);
});

test('on a 30 fps display, frames that keep missing refreshes still step quality down', () => {
  const g = new QualityGovernor(); let t = 0;
  g.displayMs = 33.3;
  for (let i = 0; i < 60; i++) g.record(66.7, (t += 66.7));
  expect(g.level).toEqual(QUALITY_LEVELS[1]);
});

test('a display faster than 60 Hz is still held to the 60 fps budget, no tighter', () => {
  const fast = new QualityGovernor(); let t = 0;
  fast.displayMs = 8.3; // 120 Hz
  for (let i = 0; i < 300; i++) fast.record(16.7, (t += 16.7)); // every other refresh missed: still 60 fps
  expect(fast.level).toEqual(QUALITY_LEVELS[0]);
});

// ---------- probing back up ----------

/** A device that takes `fullMs` per frame at the full tier and `leanMs` at every lower level. */
function simulate(g: QualityGovernor, fullMs: number, leanMs: number, forMs: number, startMs: number = 0): { t: number; stepsUp: number } {
  let t: number = startMs;
  let stepsUp: number = 0;
  while (t - startMs < forMs) {
    const before: number = g.levelIndex;
    const frameMs: number = before === 0 ? fullMs : leanMs;
    g.record(frameMs, (t += frameMs));
    if (g.levelIndex < before) stepsUp++;
  }
  return { t, stepsUp };
}

test('a failed step back up is recognised even when the full tier runs slower than 30 fps', () => {
  const g = new QualityGovernor();
  // 36 ms at full, 16 ms at lean: one probe may fail, then probing must stay blocked for a minute.
  const { stepsUp } = simulate(g, 36, 16, 60_000);
  expect(stepsUp).toBe(1);
  expect(g.levelIndex).toBe(1);
});

test('time spent idle does not count as a quiet spell', () => {
  const g = new QualityGovernor(); let t = 0;
  for (let i = 0; i < 60; i++) g.record(40, (t += 40));     // steps down
  for (let i = 0; i < 60; i++) g.record(16.7, (t += 16.7)); // one good second
  t += 15_000;                                               // the visitor reads the page
  g.record(16.7, (t += 16.7));                               // first frame of the next drag
  expect(g.level).toEqual(QUALITY_LEVELS[1]);
});

// ---------- measuring the display ----------

test('the display interval is the usual gap between ticks that drew nothing', () => {
  const d = new DisplayInterval(); let t = 1000;
  expect(d.estimateMs).toBeNull();
  d.tick(t, true);                                       // the last drawn frame
  for (let i = 0; i < 9; i++) d.tick((t += 33.3), false); // 9 quiet ticks: 8 gaps between quiet ticks
  expect(d.estimateMs).toBeCloseTo(33.3, 6);
});

test('asks for more ticks after a draw until it has measured, then stops', () => {
  const d = new DisplayInterval(); let t = 1000;
  d.tick(t, true);
  let ticks: number = 0;
  while (d.wantsTick && ticks < 100) { d.tick((t += 16.7), false); ticks++; }
  expect(ticks).toBe(9);
  d.tick((t += 16.7), true); // drawing again starts a fresh measurement
  expect(d.wantsTick).toBe(true);
});

test('the gap after a drawn frame is never taken as the display interval', () => {
  const d = new DisplayInterval(); let t = 1000;
  for (let i = 0; i < 8; i++) {
    d.tick(t, true);            // a slow frame: the next tick comes 50 ms later
    d.tick((t += 50), false);
    t += 16.7;                  // …and the tick after a quiet one comes on time
  }
  d.tick(t, false);
  expect(d.estimateMs).toBeCloseTo(16.7, 6);
});

test('a stalled thread is not mistaken for a slow display', () => {
  const d = new DisplayInterval(); let t = 1000;
  d.tick(t, false);
  for (let i = 0; i < 5; i++) d.tick((t += 200), false);  // five stalls: ignored
  for (let i = 0; i < 3; i++) d.tick((t += 16.7), false);
  expect(d.estimateMs).toBeNull();                        // only 3 real gaps so far
  for (let i = 0; i < 5; i++) d.tick((t += 16.7), false);
  expect(d.estimateMs).toBeCloseTo(16.7, 6);
});

test('a gap across a pause (hidden tab, lost context) is not measured', () => {
  const d = new DisplayInterval(); let t = 1000;
  d.tick(t, false);
  d.reset();
  d.tick((t += 30), false); // 30 ms would pass as a display interval if the chain were kept
  for (let i = 0; i < 7; i++) d.tick((t += 16.7), false);
  expect(d.estimateMs).toBeNull(); // 7 gaps, not 8
});

test('stops asking for ticks after 8 gaps even when every one was a stall', () => {
  const d = new DisplayInterval(); let t = 1000;
  d.tick(t, true);
  let ticks: number = 0;
  while (d.wantsTick && ticks < 100) { d.tick((t += 200), false); ticks++; } // a throttled page: 5 ticks a second
  expect(ticks).toBe(9);
  expect(d.estimateMs).toBeNull();
});
