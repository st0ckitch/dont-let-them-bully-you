// Type surface for the vendored three.js example modules. They ship as plain
// JS with no declarations; these describe only what this project calls, so an
// unused method going missing on a version bump is a compile error, not a
// runtime one.
declare module '*/GLTFLoader.js' {
  import type { LoadingManager, Group, AnimationClip } from 'three';
  export interface GLTF {
    scene: Group;
    animations: AnimationClip[];
  }
  export class GLTFLoader {
    constructor(manager?: LoadingManager);
    setMeshoptDecoder(decoder: unknown): this;
    loadAsync(url: string): Promise<GLTF>;
  }
}

declare module '*/meshopt_decoder.module.js' {
  export const MeshoptDecoder: unknown;
}

declare module '*/SkeletonUtils.js' {
  import type { Object3D } from 'three';
  /** Deep-clones a skinned hierarchy, rebinding each SkinnedMesh to the copy's
   *  own skeleton. Object3D.clone() alone leaves every copy sharing one. */
  export function clone<T extends Object3D>(source: T): T;
}
