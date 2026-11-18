// Worker entry: the engine renders into an OffscreenCanvas, off the page's main thread.
import type { FromEngine, ToEngine } from '../protocol.ts';
import { Engine } from './engine.ts';

interface WorkerScope {
  onmessage: ((event: MessageEvent<ToEngine>) => void) | null;
  postMessage(message: FromEngine): void;
}

const scope: WorkerScope = self as unknown as WorkerScope;
let engine: Engine | null = null;

scope.onmessage = (event: MessageEvent<ToEngine>): void => {
  const message: ToEngine = event.data;
  if (message.type === 'init') {
    if (!message.canvas) {
      scope.postMessage({ type: 'error', reason: 'webgl2-unavailable', fatal: true });
      return;
    }
    engine = new Engine(message.canvas, (out: FromEngine) => scope.postMessage(out), 'worker');
  }
  engine?.handle(message);
};
