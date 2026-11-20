// Finishes from the settings file → Three.js materials, for both quality tiers.
// Carbon uses world-space triplanar mapping, so converted parts need no UVs and curved knobs show no seams.
import { Color, MeshPhysicalMaterial, MeshStandardMaterial, type Material, type Texture, type WebGLProgramParametersWithUniforms } from 'three';
import type { FinishDef, Product } from '../../schema/product.ts';
import { WEAVE_TOWS_PER_TILE, type FinishTextures } from './textures.ts';

/** `full` adds clear coat and the weave normal map; `lean` drops both. Neither ever uses anisotropy. */
export type QualityTier = 'full' | 'lean';

const CARBON_METALNESS: number = 0.1;
const CLEARCOAT_ROUGHNESS: number = 0.04;
const WEAVE_NORMAL_SCALE: number = 0.5;

const TRIPLANAR_VERTEX_DECLARATIONS: string = /* glsl */ `
varying vec3 vTriWorldPos;
varying vec3 vTriWorldNormal;`;

const TRIPLANAR_VERTEX: string = /* glsl */ `
vTriWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTriWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`;

const TRIPLANAR_FRAGMENT_DECLARATIONS: string = /* glsl */ `
varying vec3 vTriWorldPos;
varying vec3 vTriWorldNormal;
uniform sampler2D triAlbedoMap;
uniform sampler2D triRoughnessMap;
uniform float triTilesPerMetre;
#ifdef TRI_NORMAL_MAP
uniform sampler2D triNormalMap;
uniform float triNormalScale;
#endif`;

// Replaces <map_fragment>: blend weights pow(|n|, 4), normalised, then three planar samples.
const TRIPLANAR_MAP: string = /* glsl */ `
vec3 triN = normalize(vTriWorldNormal);
vec3 triW = pow(abs(triN), vec3(4.0));
triW /= (triW.x + triW.y + triW.z);
vec2 triUvX = vTriWorldPos.zy * triTilesPerMetre;
vec2 triUvY = vTriWorldPos.xz * triTilesPerMetre;
vec2 triUvZ = vTriWorldPos.xy * triTilesPerMetre;
vec4 triAlbedo = texture2D(triAlbedoMap, triUvX) * triW.x + texture2D(triAlbedoMap, triUvY) * triW.y + texture2D(triAlbedoMap, triUvZ) * triW.z;
diffuseColor *= triAlbedo;`;

// Replaces <roughnessmap_fragment>.
const TRIPLANAR_ROUGHNESS: string = /* glsl */ `
float roughnessFactor = roughness * (
  texture2D(triRoughnessMap, triUvX).g * triW.x +
  texture2D(triRoughnessMap, triUvY).g * triW.y +
  texture2D(triRoughnessMap, triUvZ).g * triW.z);`;

// Replaces <normal_fragment_maps>: whiteout blend in world space, then into view space.
const TRIPLANAR_NORMAL: string = /* glsl */ `
vec3 triTnX = texture2D(triNormalMap, triUvX).xyz * 2.0 - 1.0;
vec3 triTnY = texture2D(triNormalMap, triUvY).xyz * 2.0 - 1.0;
vec3 triTnZ = texture2D(triNormalMap, triUvZ).xyz * 2.0 - 1.0;
triTnX.xy *= triNormalScale; triTnY.xy *= triNormalScale; triTnZ.xy *= triNormalScale;
triTnX = vec3(triTnX.xy + triN.zy, abs(triTnX.z) * triN.x);
triTnY = vec3(triTnY.xy + triN.xz, abs(triTnY.z) * triN.y);
triTnZ = vec3(triTnZ.xy + triN.xy, abs(triTnZ.z) * triN.z);
vec3 triWorldNormal = normalize(triTnX.zyx * triW.x + triTnY.xzy * triW.y + triTnZ.xyz * triW.z);
normal = normalize((viewMatrix * vec4(triWorldNormal, 0.0)).xyz);`;

/**
 * Samples albedo, roughness and (optionally) a normal map in world space along the three axes,
 * via onBeforeCompile. Materials with the same maps share one shader program.
 */
export function applyTriplanar(m: MeshPhysicalMaterial, tilesPerMetre: number, maps: { albedo: Texture; roughness: Texture; normal?: Texture }): void {
  const withNormal: boolean = maps.normal !== undefined;
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
    shader.uniforms.triAlbedoMap = { value: maps.albedo };
    shader.uniforms.triRoughnessMap = { value: maps.roughness };
    shader.uniforms.triTilesPerMetre = { value: tilesPerMetre };
    if (withNormal) {
      shader.uniforms.triNormalMap = { value: maps.normal };
      shader.uniforms.triNormalScale = { value: WEAVE_NORMAL_SCALE };
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${TRIPLANAR_VERTEX_DECLARATIONS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>${TRIPLANAR_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `${withNormal ? '#define TRI_NORMAL_MAP\n' : ''}#include <common>${TRIPLANAR_FRAGMENT_DECLARATIONS}`)
      .replace('#include <map_fragment>', TRIPLANAR_MAP)
      .replace('#include <roughnessmap_fragment>', TRIPLANAR_ROUGHNESS);
    if (withNormal) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', TRIPLANAR_NORMAL);
  };
  m.customProgramCacheKey = (): string => `triplanar:${withNormal ? 'normal' : 'flat'}`;
}

function carbon(tier: QualityTier, tilesPerMetre: number, maps: { albedo: Texture; roughness: Texture; normal?: Texture }): MeshPhysicalMaterial {
  const full: boolean = tier === 'full';
  const m: MeshPhysicalMaterial = new MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: CARBON_METALNESS,
    roughness: 1, // the roughness map holds absolute values
    clearcoat: full ? 1 : 0,
    clearcoatRoughness: CLEARCOAT_ROUGHNESS,
  });
  applyTriplanar(m, tilesPerMetre, { albedo: maps.albedo, roughness: maps.roughness, normal: full ? maps.normal : undefined });
  return m;
}

function createMaterial(finish: FinishDef, t: FinishTextures, tier: QualityTier): Material {
  switch (finish.kind) {
    case 'carbonWeave':
      return carbon(tier, 1000 / (finish.towMm * WEAVE_TOWS_PER_TILE), { albedo: t.weaveAlbedo, roughness: t.weaveRoughness, normal: t.weaveNormal });
    case 'forgedCarbon':
      return carbon(tier, 1000 / finish.tileMm, { albedo: t.forgedAlbedo, roughness: t.forgedRoughness });
    case 'metal':
      return new MeshPhysicalMaterial({ color: new Color(finish.color), metalness: 1, roughness: finish.roughness });
    case 'matte':
      return new MeshStandardMaterial({ color: new Color(finish.color), metalness: 0, roughness: finish.roughness });
  }
}

/** Only the carbon finishes change with the tier (clear coat and weave normals). */
function differsByTier(finish: FinishDef): boolean {
  return finish.kind === 'carbonWeave' || finish.kind === 'forgedCarbon';
}

/**
 * One material per finish id in each tier. A finish that looks the same in both tiers is a single
 * material in both maps, so the warm-up draws each part with it once, not twice.
 */
export function createMaterialTiers(p: Product, t: FinishTextures): Record<QualityTier, Map<string, Material>> {
  const full: Map<string, Material> = new Map();
  const lean: Map<string, Material> = new Map();
  for (const [id, finish] of Object.entries(p.finishes)) {
    const fullMaterial: Material = createMaterial(finish, t, 'full');
    if (!differsByTier(finish)) {
      fullMaterial.name = id;
      full.set(id, fullMaterial);
      lean.set(id, fullMaterial);
      continue;
    }
    const leanMaterial: Material = createMaterial(finish, t, 'lean');
    fullMaterial.name = `${id}:full`;
    leanMaterial.name = `${id}:lean`;
    full.set(id, fullMaterial);
    lean.set(id, leanMaterial);
  }
  return { full, lean };
}
