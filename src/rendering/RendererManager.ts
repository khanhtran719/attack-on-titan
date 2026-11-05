import * as THREE from 'three';
import { GraphicsQuality } from '../config/GameConfig';

export class RendererManager {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x88a9c3);
    this.scene.fog = new THREE.FogExp2(0x9cb4c9, 0.0034);

    // Cinematic Hemisphere Fill Light
    this.hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x4b4237, 0.85);
    this.scene.add(this.hemiLight);

    // Dramatic Golden-Hour Sun Light with Shadows
    this.sunLight = new THREE.DirectionalLight(0xfff0d4, 2.3);
    this.sunLight.position.set(85, 130, 65);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const d = 145;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 340;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    this.buildSkyDome();

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  private buildSkyDome(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#2b4c7e');
    grad.addColorStop(0.52, '#6991b8');
    grad.addColorStop(0.84, '#d9b89c');
    grad.addColorStop(1.0, '#c29979');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);

    // Stylized anime cloud bands
    ctx.fillStyle = 'rgba(255, 245, 232, 0.25)';
    for (let i = 0; i < 28; i++) {
      const cx = (i * 73) % 512;
      const cy = 95 + ((i * 29) % 75);
      const rw = 40 + ((i * 19) % 60);
      const rh = 8 + ((i * 11) % 14);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const skyTex = new THREE.CanvasTexture(canvas);
    const skyGeo = new THREE.SphereGeometry(420, 24, 16);
    const skyMat = new THREE.MeshBasicMaterial({
      map: skyTex,
      side: THREE.BackSide,
      fog: false,
    });
    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(skyDome);
  }

  public applyQualityPreset(quality: GraphicsQuality): void {
    if (quality === 'low') {
      this.renderer.setPixelRatio(1.0);
      this.renderer.shadowMap.enabled = false;
    } else if (quality === 'medium') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      this.renderer.shadowMap.enabled = true;
      this.sunLight.shadow.mapSize.set(1024, 1024);
    } else {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
      this.renderer.shadowMap.enabled = true;
      this.sunLight.shadow.mapSize.set(2048, 2048);
    }
    this.sunLight.shadow.map?.dispose();
    this.sunLight.shadow.map = null;
  }

  public getRenderStats(): { drawCalls: number; triangles: number } {
    return {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }
}
