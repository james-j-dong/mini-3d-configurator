// Runs the render engine and relays its messages: in a worker on an OffscreenCanvas where the
// browser allows it, otherwise on the main thread. The engine code is imported on the main thread
// only when it runs there, so the worker path doesn't download it twice.
import type { FromEngine, ToEngine } from './protocol.ts';
import workerUrl from './render/worker.ts?worker&url';
import { FallbackRelay } from './relay.ts';

/** The message for an engine that could not be loaded at all (its code failed to download, for example). */
export function engineLoadFailed(error: unknown): FromEngine {
  return { type: 'error', reason: `engine-load-failed: ${error instanceof Error ? error.message : String(error)}`, fatal: true };
}

export interface EngineHost {
  send(m: ToEngine, transfer?: Transferable[]): void;
  readonly path: 'worker' | 'main';
  dispose(): void;
}

/** Puts a fresh canvas in `container` and runs the engine on the main thread. */
async function createMainThreadHost(container: HTMLElement, onMessage: (m: FromEngine) => void): Promise<EngineHost> {
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  container.append(canvas);
  const { Engine } = await import('./render/engine.ts');
  const engine = new Engine(canvas, onMessage, 'main');
  return {
    path: 'main',
    send: (m: ToEngine): void => engine.handle(m),
    dispose: (): void => {
      engine.dispose(); // releases the WebGL context now, not whenever the browser collects the canvas
      canvas.remove();
    },
  };
}

function workerAllowed(): boolean {
  return typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function'
    && typeof Worker === 'function'
    && new URLSearchParams(location.search).get('render') !== 'main';
}

/**
 * Browsers only start workers from the page's own origin. When the viewer code is served from
 * another origin (embedded on a store), a same-origin blob module imports the real worker script,
 * which then loads its own imports from where it lives (CORS headers in public/_headers).
 */
function spawnWorker(): { worker: Worker; releaseUrl: () => void } {
  const url: string = new URL(workerUrl, import.meta.url).href;
  if (new URL(url).origin === location.origin) return { worker: new Worker(url, { type: 'module' }), releaseUrl: (): void => {} };
  const trampoline: string = URL.createObjectURL(new Blob([`import ${JSON.stringify(url)};`], { type: 'text/javascript' }));
  // The blob is only needed until the worker has loaded it; the caller releases it after that.
  return { worker: new Worker(trampoline, { type: 'module' }), releaseUrl: (): void => URL.revokeObjectURL(trampoline) };
}

/**
 * Tries the worker first. If the worker reports `webgl2-unavailable` (no WebGL2 on an
 * OffscreenCanvas) or fails to start, it is terminated, the canvas is replaced with a fresh one,
 * and the engine starts on the main thread with every message sent so far replayed in order.
 *
 * Rejects if the main-thread engine is wanted first and cannot be loaded. Every later failure
 * arrives through `onMessage` as a fatal `error`.
 */
export async function createEngineHost(container: HTMLElement, onMessage: (m: FromEngine) => void): Promise<EngineHost> {
  if (!workerAllowed()) return createMainThreadHost(container, onMessage);

  const canvas: HTMLCanvasElement = document.createElement('canvas');
  container.append(canvas);
  const offscreen: OffscreenCanvas = canvas.transferControlToOffscreen();
  let worker: Worker;
  let releaseWorkerUrl: () => void;
  try {
    ({ worker, releaseUrl: releaseWorkerUrl } = spawnWorker());
  } catch {
    canvas.remove();
    return createMainThreadHost(container, onMessage);
  }

  let path: 'worker' | 'main' = 'worker';
  let decided: boolean = false;          // the worker either rendered or was replaced
  let fallback: EngineHost | null = null;
  const relay: FallbackRelay<ToEngine> = new FallbackRelay<ToEngine>(m => {
    if (m.type === 'init') worker.postMessage({ ...m, canvas: offscreen }, [offscreen]);
    else worker.postMessage(m);
  });

  const fallBack = (): void => {
    if (decided) return;
    decided = true;
    worker.terminate();
    releaseWorkerUrl();
    canvas.remove();
    path = 'main';
    // Messages sent while the main-thread engine downloads are held by the relay and replayed.
    relay.switchTo(createMainThreadHost(container, onMessage).then(host => {
      fallback = host;
      return (m: ToEngine): void => host.send(m);
    })).catch((error: unknown) => onMessage(engineLoadFailed(error)));
  };

  worker.onmessage = (event: MessageEvent<FromEngine>): void => {
    releaseWorkerUrl(); // it is running, so it has loaded its script
    const m: FromEngine = event.data;
    if (!decided && m.type === 'error' && m.reason === 'webgl2-unavailable') {
      fallBack();
      return;
    }
    if (!decided) {
      decided = true;
      relay.confirmPrimary();
    }
    onMessage(m);
  };
  worker.onerror = (event: ErrorEvent): void => {
    if (!decided) fallBack(); // it never got going: try the main thread
    else if (path === 'worker') onMessage({ type: 'error', reason: `engine-failed: ${event.message}`, fatal: true });
  };

  return {
    get path(): 'worker' | 'main' { return path; },
    send: (m: ToEngine): void => relay.send(m),
    dispose: (): void => {
      if (fallback) fallback.dispose();
      else {
        worker.terminate();
        releaseWorkerUrl();
        canvas.remove();
      }
    },
  };
}
