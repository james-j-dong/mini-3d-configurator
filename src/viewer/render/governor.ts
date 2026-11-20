// Watches frame times and steps quality down (most expensive effect first, then resolution)
// when frames run over budget, probing back up once things are quiet.
import type { QualityLevel } from '../protocol.ts';

export const QUALITY_LEVELS: QualityLevel[] = [
  { tier: 'full', dprCap: 1.5 },
  { tier: 'lean', dprCap: 1.5 },
  { tier: 'lean', dprCap: 1.0 },
  { tier: 'lean', dprCap: 0.75 },
];

const WINDOW_FRAMES: number = 60;
/** The thresholds below are for a 60 Hz display; a slower display stretches them in proportion. */
const REFERENCE_DISPLAY_MS: number = 1000 / 60;
const MEDIAN_LIMIT_MS: number = 18;
const SLOW_FRAME_MS: number = 33.4;
const SLOW_FRAMES_TO_TRIGGER: number = 2;
const PROBE_AFTER_MS: number = 10_000;
const FAILED_PROBE_WINDOW_FRAMES: number = 120;
const PROBE_BACKOFF_MS: number = 60_000;

const ascending = (a: number, b: number): number => a - b;

/**
 * Feed it only frames rendered back to back. Over the last 60 such frames, a median above 18 ms
 * or two frames over 33.4 ms steps down one level. Both limits are for a 60 Hz display and stretch
 * with `displayMs` on a slower one, so a 30 fps display is not mistaken for a slow GPU.
 *
 * After 10 s of rendering with no trigger it probes one level up (time spent idle proves nothing,
 * so it doesn't count). A trigger within 120 frames of a probe steps back down and blocks probing
 * for 60 s.
 */
export class QualityGovernor {
  /** The display's refresh interval as measured by DisplayInterval. Faster than 60 Hz changes nothing. */
  displayMs: number = REFERENCE_DISPLAY_MS;

  private index: number = 0;
  private frames: number[] = [];
  /** Reused for sorting the window, so judging a frame allocates nothing. */
  private readonly sorted: number[] = [];
  /** Rendered time since the last level change or trigger. */
  private quietMs: number = 0;
  /** Frames recorded since the last probe up; null when the last change was not a probe. */
  private framesSinceProbe: number | null = null;
  private probeBlockedUntilMs: number = -Infinity;

  get level(): QualityLevel {
    return QUALITY_LEVELS[this.index];
  }

  get levelIndex(): number {
    return this.index;
  }

  /** Records one frame; returns the new level if it changed, else null. */
  record(frameMs: number, nowMs: number): QualityLevel | null {
    this.frames.push(frameMs);
    if (this.frames.length > WINDOW_FRAMES) this.frames.shift();
    this.quietMs += frameMs;
    if (this.framesSinceProbe !== null) this.framesSinceProbe++;

    if (this.frames.length === WINDOW_FRAMES && this.triggered()) {
      const failedProbe: boolean = this.framesSinceProbe !== null && this.framesSinceProbe <= FAILED_PROBE_WINDOW_FRAMES;
      if (failedProbe) this.probeBlockedUntilMs = nowMs + PROBE_BACKOFF_MS;
      this.framesSinceProbe = null;
      if (this.index < QUALITY_LEVELS.length - 1) return this.change(this.index + 1);
      this.frames = [];
      this.quietMs = 0;
      return null;
    }

    if (this.index > 0 && this.quietMs >= PROBE_AFTER_MS && nowMs >= this.probeBlockedUntilMs) {
      const level: QualityLevel = this.change(this.index - 1);
      this.framesSinceProbe = 0;
      return level;
    }
    return null;
  }

  private triggered(): boolean {
    const stretch: number = Math.max(1, this.displayMs / REFERENCE_DISPLAY_MS);
    const slowLimitMs: number = SLOW_FRAME_MS * stretch;
    const sorted: number[] = this.sorted;
    sorted.length = 0;
    let slow: number = 0;
    for (const ms of this.frames) {
      sorted.push(ms);
      if (ms > slowLimitMs) slow++;
    }
    sorted.sort(ascending);
    const median: number = (sorted[WINDOW_FRAMES / 2 - 1] + sorted[WINDOW_FRAMES / 2]) / 2;
    return median > MEDIAN_LIMIT_MS * stretch || slow >= SLOW_FRAMES_TO_TRIGGER;
  }

  private change(index: number): QualityLevel {
    this.index = index;
    this.frames = [];
    this.quietMs = 0;
    return this.level;
  }
}

/**
 * Decides which frame intervals the governor may see: only frames drawn back to back, i.e. this
 * tick drew and the previous tick drew AND asked for this one. An idle gap before a pick, a wheel
 * step or the next drag is never timed as a slow frame.
 */
export class FrameIntervals {
  private previousDrawMs: number | null = null;

  /** Call once per animation tick; returns the interval to record, or null. */
  tick(nowMs: number, drew: boolean, continues: boolean): number | null {
    const interval: number | null = drew && this.previousDrawMs !== null ? nowMs - this.previousDrawMs : null;
    this.previousDrawMs = drew && continues ? nowMs : null;
    return interval;
  }

  /** Forget the chain (the tab was hidden or the context was lost). */
  reset(): void {
    this.previousDrawMs = null;
  }
}

const DISPLAY_SAMPLES: number = 8;
/** No display refreshes slower than 20 Hz; a longer gap is a stalled thread. */
const MAX_DISPLAY_MS: number = 50;

/**
 * Measures the display's refresh interval, which frame times alone cannot give: a steady 33 ms
 * between frames is a fast GPU on a 30 fps display (iOS Low Power Mode) or a slow GPU on a 60 Hz
 * one. Ticks that drew nothing arrive at the display's own pace, so it times the gap after each of
 * those and takes the median of the last 8.
 */
export class DisplayInterval {
  private previousQuietMs: number | null = null;
  private samples: number[] = [];
  /** Gaps still to time before the loop may stop; every drawn frame starts a fresh measurement. */
  private wanted: number = DISPLAY_SAMPLES;

  /** Null until 8 gaps have been measured. */
  get estimateMs(): number | null {
    if (this.samples.length < DISPLAY_SAMPLES) return null;
    const sorted: number[] = [...this.samples].sort((a, b) => a - b);
    return (sorted[DISPLAY_SAMPLES / 2 - 1] + sorted[DISPLAY_SAMPLES / 2]) / 2;
  }

  /** True while it needs another animation tick to finish measuring. */
  get wantsTick(): boolean {
    return this.wanted > 0;
  }

  /** Call once per animation tick, saying whether the tick drew anything. */
  tick(nowMs: number, drew: boolean): void {
    if (this.previousQuietMs !== null) {
      const gap: number = nowMs - this.previousQuietMs;
      if (gap <= MAX_DISPLAY_MS) {
        this.samples.push(gap);
        if (this.samples.length > DISPLAY_SAMPLES) this.samples.shift();
      }
      // A stall counts as an attempt too, so a throttled page never keeps the loop running.
      this.wanted = Math.max(0, this.wanted - 1);
    }
    if (drew) this.wanted = DISPLAY_SAMPLES;
    this.previousQuietMs = drew ? null : nowMs;
  }

  /** Forget the previous tick (the tab was hidden or the context was lost). */
  reset(): void {
    this.previousQuietMs = null;
  }
}
