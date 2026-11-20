// A dark, low-key product studio generated in code (no HDR download), plus a soft contact shadow.
import {
  BackSide, Box3, BoxGeometry, Color, DataTexture, DirectionalLight, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry,
  PMREMGenerator, RGBAFormat, Scene, SRGBColorSpace, Vector3, type Texture, type WebGLRenderer,
} from 'three';

export interface Studio { environment: Texture; shadow: Mesh; keyLight: DirectionalLight }

/** The scene sets `environmentIntensity` to this. */
export const ENVIRONMENT_INTENSITY: number = 1.6;
const SHADOW_SIZE_PX: number = 128;
const SHADOW_SCALE: number = 2.2;
const FLOOR_BOUNCE: number = 0.3;
/** Just above the floor, so the shadow never z-fights the product's underside. */
const SHADOW_LIFT_M: number = 0.0002;

/** A near-black room with softboxes, like the store's product photos, plus a big reflection card so metals don't read black. */
function makeStudioScene(): Scene {
  const studio: Scene = new Scene();
  studio.add(new Mesh(new BoxGeometry(10, 10, 10), new MeshBasicMaterial({ color: new Color(0.025, 0.025, 0.025), side: BackSide })));
  const softbox = (w: number, h: number, power: number, position: Vector3): void => {
    const m: Mesh = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color().setScalar(power), side: DoubleSide }));
    m.position.copy(position);
    m.lookAt(0, 0, 0);
    studio.add(m);
  };
  softbox(4, 4, 3.5, new Vector3(0, 4.8, 0.5));      // overhead
  softbox(1.2, 5, 6.0, new Vector3(-4.8, 0.8, 1.5)); // key strip, left front
  softbox(1.0, 5, 3.0, new Vector3(4.8, 0.5, -2.0)); // rim strip, right back
  softbox(6, 1.2, 0.8, new Vector3(0, -1.5, 4.8));   // low front card
  softbox(8, 3, 2.0, new Vector3(0, 1.0, 4.8));      // reflection card in front, for the metals
  softbox(9, 9, FLOOR_BOUNCE, new Vector3(0, -4.8, 0)); // dim grey floor, so polished metal reads grey rather than black
  return studio;
}

function disposeScene(scene: Scene): void {
  scene.traverse(object => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      (object.material as MeshBasicMaterial).dispose();
    }
  });
}

/** A radial falloff, dark in the middle and clear at the edge, computed once. */
function makeShadowTexture(): Texture {
  const size: number = SHADOW_SIZE_PX;
  const data: Uint8Array = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r: number = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2); // 0 at centre, 1 at edge
      const t: number = Math.min(1, Math.max(0, (r - 0.18) / 0.82));
      const alpha: number = t < 0.45 ? 0.85 - (0.5 * t) / 0.45 : 0.35 * (1 - (t - 0.45) / 0.55);
      data[(y * size + x) * 4 + 3] = Math.round(Math.max(0, alpha) * 255);
    }
  }
  const texture: DataTexture = new DataTexture(data, size, size, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Where the contact shadow goes, in metres. */
export interface ShadowPlacement { footprintM: number; floorYM: number; centreXM: number; centreZM: number }

/**
 * Footprint = the larger of the bounds' x and z sizes; floor = the bounds' lowest y; centre = the
 * middle of the bounds seen from above. A product need not be centred on its CAD origin.
 */
export function shadowPlacement(bounds: Box3): ShadowPlacement {
  return {
    footprintM: Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z),
    floorYM: bounds.min.y,
    centreXM: (bounds.min.x + bounds.max.x) / 2,
    centreZM: (bounds.min.z + bounds.max.z) / 2,
  };
}

/** The contact shadow: a soft dark quad 2.2 × the footprint, under the product's centre and just above the floor so the product rests on it. */
export function createShadow(placement: ShadowPlacement): Mesh {
  const size: number = placement.footprintM * SHADOW_SCALE;
  const shadow: Mesh = new Mesh(
    new PlaneGeometry(size, size),
    new MeshBasicMaterial({ color: 0x000000, map: makeShadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(placement.centreXM, placement.floorYM + SHADOW_LIFT_M, placement.centreZM);
  shadow.renderOrder = -1;
  return shadow;
}

/** Builds the environment map (prefiltered once with PMREM), the key light and the contact shadow. */
export function createStudio(renderer: WebGLRenderer, placement: ShadowPlacement): Studio {
  const pmrem: PMREMGenerator = new PMREMGenerator(renderer);
  const studioScene: Scene = makeStudioScene();
  const environment: Texture = pmrem.fromScene(studioScene, 0.02).texture;
  pmrem.dispose();
  disposeScene(studioScene);

  const keyLight: DirectionalLight = new DirectionalLight(0xffffff, 0.8);
  keyLight.position.set(-0.4, 0.6, 0.5);

  return { environment, shadow: createShadow(placement), keyLight };
}
