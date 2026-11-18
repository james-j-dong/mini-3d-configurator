// Camera controller: drag to spin with coasting, zoom towards the cursor, no panning.
// Pure math with no DOM, so it runs in the render worker as well as on the main thread.
import { Box3, MathUtils, PerspectiveCamera, Sphere, Vector3 } from 'three';
import type { Framing } from '../../schema/product.ts';

const FRAME_MS: number = 16.7;
const COAST_DECAY_PER_FRAME: number = 0.08;
const COAST_STOP_RAD_PER_FRAME: number = 0.0005;
const MIN_POLAR_RAD: number = MathUtils.degToRad(5);
const WORLD_UP: Vector3 = new Vector3(0, 1, 0);

/**
 * Distance at which the box's bounding sphere fits the view, times `margin`. A sphere keeps the
 * whole product in frame from every orbit angle, and in a portrait box the narrower horizontal
 * field of view sets the distance.
 */
export function fitDistance(fovDeg: number, aspect: number, bounds: Box3, margin: number = 1.18): number {
  const radius: number = bounds.getBoundingSphere(new Sphere()).radius;
  const tanHalfV: number = Math.tan(MathUtils.degToRad(fovDeg) / 2);
  const halfV: number = Math.atan(tanHalfV);
  const halfH: number = Math.atan(tanHalfV * aspect);
  return (margin * radius) / Math.sin(Math.min(halfV, halfH));
}

export class OrbitController {
  private readonly framing: Framing;
  private readonly maxPolar: number;
  private readonly target: Vector3 = new Vector3();
  private readonly bounds: Box3 = new Box3(new Vector3(-0.1, -0.1, -0.1), new Vector3(0.1, 0.1, 0.1));
  private aspect: number = 1;
  private fitDist: number = 1;
  private az: number;
  private pol: number;
  private dist: number = 1;
  /** Radians per 16.7 ms frame, from the latest drag. */
  private velocityAz: number = 0;
  private velocityPolar: number = 0;
  private coasting: boolean = false;

  constructor(framing: Framing) {
    this.framing = framing;
    this.maxPolar = MathUtils.degToRad(framing.maxPolarDeg);
    this.az = MathUtils.degToRad(framing.azimuthDeg);
    this.pol = MathUtils.clamp(MathUtils.degToRad(framing.polarDeg), MIN_POLAR_RAD, this.maxPolar);
  }

  get azimuth(): number { return this.az; }
  get polar(): number { return this.pol; }
  get distance(): number { return this.dist; }
  get fitDistance(): number { return this.fitDist; }

  /** Resets the target to the bounds centre and the distance to the fit for this box. Keeps the angles. */
  fit(boxWidthPx: number, boxHeightPx: number, bounds: Box3): void {
    this.aspect = boxWidthPx / boxHeightPx;
    this.bounds.copy(bounds);
    bounds.getCenter(this.target);
    this.fitDist = fitDistance(this.framing.fovDeg, this.aspect, bounds);
    this.dist = this.fitDist;
  }

  /**
   * Turns the camera by 2π per box height dragged. `dtMs` is the time since the previous drag
   * event; it scales the coasting velocity so coasting speed doesn't depend on the input rate.
   */
  drag(dxPx: number, dyPx: number, boxHeightPx: number, dtMs: number = FRAME_MS): void {
    const dAz: number = (-2 * Math.PI * dxPx) / boxHeightPx;
    const dPolar: number = (-2 * Math.PI * dyPx) / boxHeightPx;
    this.coasting = false;
    this.az += dAz;
    this.pol = MathUtils.clamp(this.pol + dPolar, MIN_POLAR_RAD, this.maxPolar);
    const perFrame: number = FRAME_MS / Math.max(dtMs, 1);
    this.velocityAz = dAz * perFrame;
    this.velocityPolar = dPolar * perFrame;
  }

  /** Starts coasting with the latest drag velocity. */
  release(): void {
    this.coasting = Math.max(Math.abs(this.velocityAz), Math.abs(this.velocityPolar)) >= COAST_STOP_RAD_PER_FRAME;
  }

  /** Stops any coasting at once (a new touch, for example). */
  hold(): void {
    this.coasting = false;
    this.velocityAz = 0;
    this.velocityPolar = 0;
  }

  /** Zooms by `factor` (>1 zooms in) towards the point under the cursor (NDC). */
  zoom(factor: number, ndcX: number, ndcY: number): void {
    const newDist: number = MathUtils.clamp(this.dist / factor, this.framing.minZoom * this.fitDist, this.framing.maxZoom * this.fitDist);
    const effective: number = this.dist / newDist;
    const tanHalfV: number = Math.tan(MathUtils.degToRad(this.framing.fovDeg) / 2);
    const { right, up } = this.basis();
    // The point under the cursor, on the plane through the target facing the camera.
    const offset: Vector3 = right.multiplyScalar(ndcX * tanHalfV * this.aspect * this.dist)
      .add(up.multiplyScalar(ndcY * tanHalfV * this.dist));
    this.target.addScaledVector(offset, 1 - 1 / effective);
    this.bounds.clampPoint(this.target, this.target);
    this.dist = newDist;
  }

  /** Advances coasting by `dtMs`; returns true if the camera moved. */
  step(dtMs: number): boolean {
    if (!this.coasting) return false;
    const frames: number = dtMs / FRAME_MS;
    this.az += this.velocityAz * frames;
    const polar: number = this.pol + this.velocityPolar * frames;
    this.pol = MathUtils.clamp(polar, MIN_POLAR_RAD, this.maxPolar);
    if (this.pol !== polar) this.velocityPolar = 0;
    const decay: number = Math.pow(1 - COAST_DECAY_PER_FRAME, frames);
    this.velocityAz *= decay;
    this.velocityPolar *= decay;
    if (Math.max(Math.abs(this.velocityAz), Math.abs(this.velocityPolar)) < COAST_STOP_RAD_PER_FRAME) this.coasting = false;
    return true;
  }

  get isCoasting(): boolean { return this.coasting; }

  apply(camera: PerspectiveCamera): void {
    camera.position.copy(this.target).add(this.offsetFromTarget());
    camera.up.copy(WORLD_UP);
    camera.lookAt(this.target);
    camera.fov = this.framing.fovDeg;
    camera.aspect = this.aspect;
    camera.near = this.dist / 50;
    camera.far = this.dist * 20;
    camera.updateProjectionMatrix();
  }

  private offsetFromTarget(): Vector3 {
    const s: number = Math.sin(this.pol);
    return new Vector3(s * Math.sin(this.az), Math.cos(this.pol), s * Math.cos(this.az)).multiplyScalar(this.dist);
  }

  /** The camera's right and up vectors in world space. */
  private basis(): { right: Vector3; up: Vector3 } {
    const forward: Vector3 = this.offsetFromTarget().negate().normalize();
    const right: Vector3 = new Vector3().crossVectors(forward, WORLD_UP).normalize();
    const up: Vector3 = new Vector3().crossVectors(right, forward).normalize();
    return { right, up };
  }
}
