// Types for a product's settings file (product.json). The settings file is the single
// source of truth for the converter, the viewer and the page picker.

export type Vec3 = [number, number, number];

/** A position plus an optional XYZ Euler rotation (degrees), in the owning model's frame. */
export interface Placement { positionMm: Vec3; rotationDeg?: Vec3 }

interface ModelBase {
  /** The point on this model that sits on its parent's socket. Defaults to the origin. */
  attachPointMm?: Vec3;
  sockets?: Record<string, Placement>;
}

/** Drops every B-rep face that lies entirely within `maxRadiusMm` of the model Y axis and below `maxHeightMm`. */
export interface FaceRule { kind: 'dropNearAxis'; maxRadiusMm: number; maxHeightMm: number }

export type ModelDef = ModelBase & (
  | { kind: 'converted'; source: string; bodyIndex: number; faceRules?: FaceRule[] }
  | { kind: 'box'; sizeMm: Vec3 }                            // origin: bottom centre
  | { kind: 'cylinder'; radiusMm: number; heightMm: number } // origin: bottom centre
  | { kind: 'sphere'; radiusMm: number });                   // origin: centre

export interface SourceDef {
  file: string;
  units: 'mm' | 'm' | 'in';
  upAxis: 'y' | 'z';
  bodyCount: number;
  /** Bodies deliberately left out of the build (hidden internals, for example). */
  dropBodies?: number[];
}

export type FinishDef =
  | { kind: 'carbonWeave'; towMm: number }
  | { kind: 'forgedCarbon'; tileMm: number }
  | { kind: 'metal'; color: string; roughness: number }
  | { kind: 'matte'; color: string; roughness: number };

export interface SlotDef {
  id: string;
  parent?: string;
  socket?: string;
  placement?: 'socket' | 'asInCad';
  model: string;
  finish: string;
}

export interface SlotSetting { slot: string; model?: string; finish?: string }
export interface OptionValue { name: string; sets: SlotSetting[]; swatch?: { css: string } }
export interface OptionGroup { name: string; values: OptionValue[] }

/** Option name → value name. */
export type Selection = Record<string, string>;

export interface Framing { azimuthDeg: number; polarDeg: number; maxPolarDeg: number; minZoom: number; maxZoom: number; fovDeg: number }

export interface Product {
  schemaVersion: 1;
  id: string;
  name: string;
  sources: Record<string, SourceDef>;
  models: Record<string, ModelDef>;
  finishes: Record<string, FinishDef>;
  slots: SlotDef[];
  options: OptionGroup[];
  defaultSelection: Selection;
  framing: Framing;
}

/** GLB paths, relative to the built product.json. */
export interface ModelFiles { default: string; light: string }

export interface BuiltProduct extends Product {
  version: string;
  files: Record<string, ModelFiles>;
  stills: { pattern: string; sizePx: number };
}

/** Slot id → the model and finish it holds. */
export type ResolvedConfiguration = Record<string, { model: string; finish: string }>;
