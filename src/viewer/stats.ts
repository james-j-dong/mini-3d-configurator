// The `stats` panel: the engine's live numbers, page-side sizes, and a speed-test button.
import type { SpeedTestResult } from './protocol.ts';

export interface StatsPanel {
  readonly element: HTMLElement;
  setEngineText(text: string): void;
  setFirstView(msSincePageStart: number): void;
}

export function formatSpeedTest(r: SpeedTestResult): string {
  return [
    `frames     ${r.frames} · avg ${r.avgFps.toFixed(1)} fps`,
    `frame ms   p50 ${r.p50Ms.toFixed(1)} · p95 ${r.p95Ms.toFixed(1)} · max ${r.maxMs.toFixed(1)}`,
    `over 33 ms ${r.over33Ms} · worst swap ${r.worstSwapMs.toFixed(1)} ms`,
    `slow swaps ${r.slowSwaps.length ? `\n  ${r.slowSwaps.join('\n  ')}` : 'none'}`,
  ].join('\n');
}

function pageSizes(): string {
  const entries: PerformanceResourceTiming[] = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const bytes = (match: (name: string) => boolean): number =>
    entries.filter(e => match(new URL(e.name).pathname)).reduce((sum, e) => sum + (e.encodedBodySize || e.decodedBodySize || 0), 0);
  const kb = (n: number): string => `${(n / 1024).toFixed(0)} KB`;
  return `code       ${kb(bytes(p => p.endsWith('.js') || p.endsWith('.ts')))} as served (main thread)\nstills     ${kb(bytes(p => p.endsWith('.webp')))}`;
}

export function createStatsPanel(runSpeedTest: () => Promise<SpeedTestResult>): StatsPanel {
  const element: HTMLDivElement = document.createElement('div');
  element.className = 'stats';
  const text: HTMLPreElement = document.createElement('pre');
  const page: HTMLPreElement = document.createElement('pre');
  const button: HTMLButtonElement = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Run speed test';
  const result: HTMLPreElement = document.createElement('pre');
  element.append(text, page, button, result);
  let firstView: string = 'first paint …';

  button.addEventListener('click', () => {
    button.disabled = true;
    result.textContent = 'running… (6 s)';
    runSpeedTest()
      .then(r => { result.textContent = formatSpeedTest(r); })
      .catch((e: unknown) => { result.textContent = `speed test failed: ${(e as Error).message}`; })
      .finally(() => { button.disabled = false; });
  });
  for (const type of ['pointerdown', 'wheel'] as const) element.addEventListener(type, e => e.stopPropagation());

  return {
    element,
    setEngineText: (t: string): void => {
      text.textContent = t;
      page.textContent = `${pageSizes()}\n${firstView}`;
    },
    setFirstView: (ms: number): void => {
      firstView = `3D shown   ${ms.toFixed(0)} ms after page start`;
    },
  };
}
