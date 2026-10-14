import * as THREE from "three";
import { MAP } from "./mapdata";

// Nebel des Krieges: eine kleine Textur über die Karte, 1 = sichtbar.
export const FOG_RES = 128;

export class FogOfWar {
  readonly data = new Uint8Array(FOG_RES * FOG_RES);
  private target = new Float32Array(FOG_RES * FOG_RES);
  private cur = new Float32Array(FOG_RES * FOG_RES).fill(0.3);
  readonly texture: THREE.DataTexture;
  readonly uniforms = {
    uFogTex: { value: null as unknown as THREE.DataTexture },
    uFogOn: { value: 1 },
  };

  constructor() {
    this.texture = new THREE.DataTexture(this.data, FOG_RES, FOG_RES, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
    this.uniforms.uFogTex.value = this.texture;
  }

  setObservers(list: { x: number; z: number; r: number }[]) {
    const t = this.target;
    t.fill(0);
    const k = FOG_RES / MAP;
    for (const o of list) {
      const cx = o.x * k;
      const cz = o.z * k;
      const r = o.r * k;
      const r2 = r * r;
      const x0 = Math.max(0, Math.floor(cx - r - 1));
      const x1 = Math.min(FOG_RES - 1, Math.ceil(cx + r + 1));
      const z0 = Math.max(0, Math.floor(cz - r - 1));
      const z1 = Math.min(FOG_RES - 1, Math.ceil(cz + r + 1));
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx;
          const dz = z + 0.5 - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > r2) continue;
          const v = Math.min(1, (r - Math.sqrt(d2)) / 2.2);
          const i = z * FOG_RES + x;
          if (v > t[i]) t[i] = v;
        }
      }
    }
  }

  update(dt: number) {
    const a = Math.min(1, dt * 6);
    const c = this.cur;
    const t = this.target;
    const d = this.data;
    for (let i = 0; i < c.length; i++) {
      c[i] += (t[i] - c[i]) * a;
      d[i] = (c[i] * 255) | 0;
    }
    this.texture.needsUpdate = true;
  }

  /** Hängt die Nebel-Abdunklung an ein Standard-Material. */
  patch(mat: THREE.Material) {
    const uniforms = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFogTex = uniforms.uFogTex;
      shader.uniforms.uFogOn = uniforms.uFogOn;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vFogW;")
        .replace(
          "#include <project_vertex>",
          `#include <project_vertex>
          vec4 fogWP = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            fogWP = instanceMatrix * fogWP;
          #endif
          fogWP = modelMatrix * fogWP;
          vFogW = fogWP.xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vFogW;\nuniform sampler2D uFogTex;\nuniform float uFogOn;")
        .replace(
          "#include <dithering_fragment>",
          `#include <dithering_fragment>
          float fogV = texture2D(uFogTex, vFogW.xz / ${MAP.toFixed(1)}).r;
          vec3 fogGray = vec3(dot(gl_FragColor.rgb, vec3(0.3, 0.55, 0.15)));
          vec3 fogged = mix(fogGray, gl_FragColor.rgb, 0.45) * vec3(0.42, 0.46, 0.58);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fogged, gl_FragColor.rgb, fogV), uFogOn);`,
        );
    };
    mat.customProgramCacheKey = () => "fogpatch";
  }
}
