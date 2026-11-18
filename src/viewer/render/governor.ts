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
const MEDIAN_LIMIT_MS: number = 18;
const SLOW_FRAME_MS: number = 33.4;
const SLOW_FRAMES_TO_TRIGGER: number = 2;
const PROBE_AFTER_MS: number = 10_000;
const FAILED_PROBE_WINDOW_MS: number = 2_000;
const PROBE_BACKOFF_MS: number = 60_000;

/**
 * Feed it only frames rendered back to back. Over the last 60 such frames, a median above 18 ms
 * or two frames over 33.4 ms steps down one level. After 10 s with no trigger it probes one level
 * up; a trigger within 2 s of a probe steps back down and blocks probing for 60 s.
 */
export class QualityGovernor {
  private index: number = 0;
  private frames: number[] = [];
  private lastChangeMs: number | null = null;
  private lastProbeMs: number | null = null;
  private probeBlockedUntilMs: number = -Infinity;

  get level(): QualityLevel {
    return QUALITY_LEVELS[this.index];
  }

  get levelIndex(): number {
    return this.index;
  }

  /** Records one frame; returns the new level if it changed, else null. */
  record(frameMs: number, nowMs: number): QualityLevel | null {
    this.lastChangeMs ??= nowMs;
    this.frames.push(frameMs);
    if (this.frames.length > WINDOW_FRAMES) this.frames.shift();

    if (this.frames.length === WINDOW_FRAMES && this.triggered()) {
      const failedProbe: boolean = this.lastProbeMs !== null && nowMs - this.lastProbeMs <= FAILED_PROBE_WINDOW_MS;
      if (failedProbe) this.probeBlockedUntilMs = nowMs + PROBE_BACKOFF_MS;
      this.lastProbeMs = null;
      if (this.index < QUALITY_LEVELS.length - 1) return this.change(this.index + 1, nowMs);
      this.frames = [];
      this.lastChangeMs = nowMs;
      return null;
    }

    if (this.index > 0 && nowMs - this.lastChangeMs >= PROBE_AFTER_MS && nowMs >= this.probeBlockedUntilMs) {
      this.lastProbeMs = nowMs;
      return this.change(this.index - 1, nowMs);
    }
    return null;
  }

  private triggered(): boolean {
    const sorted: number[] = [...this.frames].sort((a, b) => a - b);
    const median: number = (sorted[WINDOW_FRAMES / 2 - 1] + sorted[WINDOW_FRAMES / 2]) / 2;
    const slow: number = this.frames.filter(ms => ms > SLOW_FRAME_MS).length;
    return median > MEDIAN_LIMIT_MS || slow >= SLOW_FRAMES_TO_TRIGGER;
  }

  private change(index: number, nowMs: number): QualityLevel {
    this.index = index;
    this.frames = [];
    this.lastChangeMs = nowMs;
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
