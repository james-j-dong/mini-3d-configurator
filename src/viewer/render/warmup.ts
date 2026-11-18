// Warm-up: compile every material, upload every texture, then draw every material on every
// geometry once into a 1-pixel scissor of the real canvas. Compiling alone left a 92 ms swap on
// the iPhone (Safari finishes a shader the first time it's drawn with each mesh layout).
import { Group, Mesh, type BufferGeometry, type Camera, type Material, type Scene, type Texture, type WebGLRenderer } from 'three';

/**
 * Warms `materials` × `geometries` inside `scene` (which carries the environment and lights that
 * are part of every program's key). The caller must draw a full frame in the same task afterwards,
 * so the 1-pixel draw is never shown on its own.
 */
export async function warmUp(
  r: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  materials: Material[],
  geometries: BufferGeometry[],
  textures: Texture[] = [],
): Promise<void> {
  const group: Group = new Group();
  for (const geometry of geometries) {
    for (const material of materials) {
      const mesh: Mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      group.add(mesh);
    }
  }
  scene.add(group);
  try {
    await r.compileAsync(scene, camera); // the whole scene, so the shadow and the slot meshes are compiled too
    for (const texture of textures) r.initTexture(texture);
    warmDraw(r, scene, camera);
  } finally {
    scene.remove(group);
  }
}

/** Draws the scene into the bottom-left pixel only. */
export function warmDraw(r: WebGLRenderer, scene: Scene, camera: Camera): void {
  r.setScissorTest(true);
  r.setScissor(0, 0, 1, 1);
  r.render(scene, camera);
  r.setScissorTest(false);
}
