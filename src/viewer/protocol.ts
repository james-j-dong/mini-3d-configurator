// Messages between the viewer element (main thread) and the render engine (worker or main thread),
// plus the result types they share. Everything here must survive structured cloning.
import type { BuiltProduct, Selection } from '../schema/product.ts';
import type { QualityTier } from './render/materials.ts';

export type { QualityTier } from './render/materials.ts';

export interface QualityLevel { tier: QualityTier; dprCap: number }

export interface SpeedTestResult {
  frames: number;
  avgFps: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  over33Ms: number;
  worstSwapMs: number;
  slowSwaps: string[];
}

export interface DebugInfo { programs: number; textures: number; level: QualityLevel; renderPath: 'worker' | 'main' }

export type ToEngine =
  | { type: 'init'; productUrl: string; selection: Selection | null; widthCss: number; heightCss: number; dpr: number; stats: boolean; canvas?: OffscreenCanvas }
  | { type: 'resize'; widthCss: number; heightCss: number; dpr: number }
  | { type: 'pointer'; kind: 'down' | 'move' | 'up' | 'cancel'; id: number; x: number; y: number } // CSS px within the box
  | { type: 'wheel'; deltaY: number; x: number; y: number }
  | { type: 'configure'; selection: Selection }
  | { type: 'visible'; visible: boolean }
  | { type: 'capture'; id: number; sizePx: number }
  | { type: 'speedTest'; id: number }
  | { type: 'debug'; id: number }
  | { type: 'loseContext' };

export type FromEngine =
  | { type: 'product'; product: BuiltProduct }
  | { type: 'progress'; loaded: number; total: number; phase: 'current' | 'deferred' | 'background' }
  | { type: 'ready' }
  | { type: 'configured'; selection: Selection }
  | { type: 'restored' }
  | { type: 'error'; reason: string; fatal: boolean }
  | { type: 'captured'; id: number; blob: Blob }
  | { type: 'speedTestResult'; id: number; result: SpeedTestResult }
  | { type: 'debugInfo'; id: number; info: DebugInfo }
  | { type: 'stats'; text: string };
