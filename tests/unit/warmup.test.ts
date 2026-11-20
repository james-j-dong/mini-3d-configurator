import { expect, test } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Scene, type WebGLRenderer } from 'three';
import { warmUp } from '../../src/viewer/render/warmup.ts';

const meshesIn = (root: Object3D): Mesh[] => {
  const found: Mesh[] = [];
  root.traverse(o => { if ((o as Mesh).isMesh) found.push(o as Mesh); });
  return found;
};

/** Stands in for the WebGL renderer: records what the scene held whenever it was compiled against or drawn. */
function recordingRenderer(scene: Scene): { renderer: WebGLRenderer; compiled: Mesh[]; meshesInSceneWhileCompiling: number[]; meshesDrawn: number[] } {
  const compiled: Mesh[] = [];
  const meshesInSceneWhileCompiling: number[] = [];
  const meshesDrawn: number[] = [];
  const renderer = {
    compileAsync: async (object: Object3D): Promise<void> => {
      compiled.push(...meshesIn(object));
      meshesInSceneWhileCompiling.push(meshesIn(scene).length);
      await new Promise(resolve => setTimeout(resolve, 0)); // shaders compile while other tasks (a frame, a capture) run
      meshesInSceneWhileCompiling.push(meshesIn(scene).length);
    },
    initTexture: (): void => {},
    setScissorTest: (): void => {},
    setScissor: (): void => {},
    render: (drawn: Scene): void => { meshesDrawn.push(meshesIn(drawn).length); },
  } as unknown as WebGLRenderer;
  return { renderer, compiled, meshesInSceneWhileCompiling, meshesDrawn };
}

test('warm-up meshes are in the scene only for the warm draw, never while shaders compile', async () => {
  const scene = new Scene();
  const own = new Mesh(new BoxGeometry(), new MeshBasicMaterial()); // the product as it is on screen
  scene.add(own);
  const materials = [new MeshBasicMaterial(), new MeshBasicMaterial(), new MeshBasicMaterial()];
  const geometries = [new BoxGeometry(), new BoxGeometry()];
  const { renderer, compiled, meshesInSceneWhileCompiling, meshesDrawn } = recordingRenderer(scene);

  await warmUp(renderer, scene, new PerspectiveCamera(), materials, geometries);

  expect(meshesInSceneWhileCompiling.every(count => count === 1)).toBe(true); // a frame drawn meanwhile shows only the product
  expect(meshesDrawn).toEqual([1 + 3 * 2]);                                   // the warm draw: the product and every material on every geometry
  expect(meshesIn(scene)).toEqual([own]);                                     // and nothing is left behind
  // Everything was still compiled: the scene's own mesh and each material on each geometry.
  expect(compiled).toContain(own);
  for (const geometry of geometries) {
    for (const material of materials) {
      expect(compiled.some(m => m.geometry === geometry && m.material === material)).toBe(true);
    }
  }
});
