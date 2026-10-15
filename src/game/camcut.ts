import * as THREE from "three";

/**
 * Nahansicht der Kamera: was nahe an der Kamera oder zwischen Kamera und Champion steht (Bäume, Gebäude,
 * Ruinen), wird fein gerastert ausgeblendet, statt den Blick zu verdecken.
 * uCutB = Brusthöhe des Champions, uCutOn = 0 (aus, normale Ansicht) .. 1 (ganz nah). Gesetzt in Game.updateCamera.
 */
export const camCut = { uCutB: { value: new THREE.Vector3() }, uCutOn: { value: 0 } };

/** GLSL: Fragment verwerfen, wenn es die Sicht verdeckt. `pos` ist die Weltposition des Fragments. */
export function cutFragment(pos: string) {
  return `if (uCutOn > 0.001) {
      vec3 cutAB = uCutB - cameraPosition;
      float cutH = clamp(dot(${pos} - cameraPosition, cutAB) / max(dot(cutAB, cutAB), 1e-4), 0.0, 0.97);
      float cutLine = 1.0 - smoothstep(1.4, 2.8, distance(${pos}, cameraPosition + cutAB * cutH));
      float cutCam = 1.0 - smoothstep(2.0, 4.5, distance(${pos}, cameraPosition));
      float cutNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      if (max(cutLine, cutCam) * uCutOn > cutNoise) discard;
    }`;
}

/** Für Shader, die schon eine Weltposition `pos` als varying haben (Nebel-Patch: vFogW). */
export function addCutUniforms(shader: THREE.WebGLProgramParametersWithUniforms, pos: string) {
  shader.uniforms.uCutB = camCut.uCutB;
  shader.uniforms.uCutOn = camCut.uCutOn;
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nuniform vec3 uCutB;\nuniform float uCutOn;")
    .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${cutFragment(pos)}`);
}

const patched = new WeakSet<THREE.Material>();

/** Hängt das Ausblenden an alle normalen Materialien eines Modells (Gebäude, Startbasis). */
export function applyCameraCut(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      // Umrisse (Zielmarkierung) haben eigene Shader und bleiben, wie sie sind
      if (patched.has(mat) || mat.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) continue;
      if (!(mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshLambertMaterial || mat instanceof THREE.MeshBasicMaterial)) continue;
      patched.add(mat);
      const prevKey = mat.customProgramCacheKey.bind(mat);
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vCutW;").replace(
          "#include <project_vertex>",
          `#include <project_vertex>
          vec4 cutWP = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cutWP = instanceMatrix * cutWP;
          #endif
          vCutW = (modelMatrix * cutWP).xyz;`,
        );
        shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vCutW;");
        addCutUniforms(shader, "vCutW");
      };
      mat.customProgramCacheKey = () => `${prevKey()}|camcut`;
      mat.needsUpdate = true;
    }
  });
}
