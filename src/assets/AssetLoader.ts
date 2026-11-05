import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class AssetLoader {
  private gltfLoader: GLTFLoader;
  private cache: Map<string, GLTF> = new Map();

  constructor() {
    this.gltfLoader = new GLTFLoader();
  }

  /**
   * Loads a GLB/GLTF asset from URL via GLTFLoader with caching and safe fallback.
   */
  public async loadGLTF(url: string): Promise<GLTF | null> {
    if (this.cache.has(url)) {
      return this.cache.get(url)!;
    }
    try {
      const gltf = await this.gltfLoader.loadAsync(url);
      this.cache.set(url, gltf);
      return gltf;
    } catch {
      return null;
    }
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
