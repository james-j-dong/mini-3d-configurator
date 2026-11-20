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

/** Picks bodies out of a source file. */
export interface PartSelection {
  /** A node name or mesh name anywhere in the file's tree, matched exactly. Omitted: the whole file as one part. */
  part?: string;
  /** Body positions within each matched instance (0-based, depth-first). Omitted: all of them. */
  bodies?: number[];
  /** Keep only instances whose bounding-box centre lies in this box (source millimetres, Y-up). */
  within?: { minMm: Vec3; maxMm: Vec3 };
}

/** Drops every B-rep face that lies entirely within `maxRadiusMm` of the model Y axis and below `maxHeightMm`. */
export interface FaceRule { kind: 'dropNearAxis'; maxRadiusMm: number; maxHeightMm: number }

export type ModelDef = ModelBase & (
  | {
      kind: 'converted';
      source: string;
      /** The bodies this model is made of, merged into one mesh. */
      parts: PartSelection[];
      faceRules?: FaceRule[];
      /** Simplify to this error (mm) at the default level; the light level uses twice as much. Omitted: no simplification. */
      simplifyErrorMm?: number;
    }
  | { kind: 'box'; sizeMm: Vec3 }                            // origin: bottom centre
  | { kind: 'cylinder'; radiusMm: number; heightMm: number } // origin: bottom centre
  | { kind: 'sphere'; radiusMm: number });                   // origin: centre

export interface SourceDef {
  file: string;
  units: 'mm' | 'm' | 'in';
  upAxis: 'y' | 'z';
  /** Geometry deliberately left out of the build. Everything else must belong to exactly one model. */
  leaveOut?: PartSelection[];
  /**
   * Where this file's own frame sits in the product frame (after up-axis normalisation). Omitted: the
   * file is already in the product frame, as an assembly is. Part selections and face rules stay in the file's frame.
   */
  placement?: Placement;
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
  /** Loads after the first view: neither the first view nor swaps wait for it. Never the root slot. */
  afterFirstView?: boolean;
}

export interface SlotSetting { slot: string; model?: string; finish?: string }
export interface OptionValue { name: string; sets: SlotSetting[]; swatch?: { css: string } }
export interface OptionGroup { name: string; values: OptionValue[] }

/** Option name → value name. */
export type Selection = Record<string, string>;

export interface Framing { azimuthDeg: number; polarDeg: number; maxPolarDeg: number; minZoom: number; maxZoom: number; fovDeg: number }

export interface Product {
  schemaVersion: 2;
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
