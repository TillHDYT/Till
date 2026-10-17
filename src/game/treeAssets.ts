import type * as THREE from "three";

/** Bäume aus den Modellen (assets-src/trees): einzelner Baum und Dreiergruppe. Lädt models.ts, baut terrain.ts. */
export const TREE_ASSETS: { list: { geo: THREE.BufferGeometry; map: THREE.Texture | null; normalMap: THREE.Texture | null; height: number }[] | null } = { list: null };

/** Mauerstück für die Dschungelwände (assets-src/wall), siehe walls.ts. */
export const WALL_ASSET: { asset: import("./walls").WallAsset | null } = { asset: null };
