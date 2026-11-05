import * as THREE from 'three';
import { ObjectPool } from '../utils/ObjectPool';

interface ParticleItem {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  age: number;
  maxAge: number;
  startScale: number;
  endScale: number;
}

interface SlashArcItem {
  mesh: THREE.Mesh;
  age: number;
  maxAge: number;
}

export class VFXManager {
  private particlePool: ObjectPool<ParticleItem>;
  private slashArcPool: ObjectPool<SlashArcItem>;

  constructor(private scene: THREE.Scene) {
    const sphereGeo = new THREE.IcosahedronGeometry(0.22, 1);

    this.particlePool = new ObjectPool<ParticleItem>(
      () => {
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.8,
        });
        const mesh = new THREE.Mesh(sphereGeo, mat);
        mesh.visible = false;
        this.scene.add(mesh);
        return {
          mesh,
          velocity: new THREE.Vector3(),
          age: 0,
          maxAge: 0.5,
          startScale: 1,
          endScale: 2,
        };
      },
      (item) => {
        item.mesh.visible = false;
      },
      64
    );

    const arcGeo = new THREE.RingGeometry(1.1, 2.25, 20, 1, 0, Math.PI * 1.35);
    arcGeo.rotateX(-Math.PI / 2);

    this.slashArcPool = new ObjectPool<SlashArcItem>(
      () => {
        const mat = new THREE.MeshBasicMaterial({
          color: 0x7dd3fc,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(arcGeo, mat);
        mesh.visible = false;
        this.scene.add(mesh);
        return {
          mesh,
          age: 0,
          maxAge: 0.24,
        };
      },
      (item) => {
        item.mesh.visible = false;
      },
      8
    );
  }

  public spawnGasJetPuff(worldPos: THREE.Vector3, playerVel: THREE.Vector3): void {
    const p = this.particlePool.acquire();
    p.mesh.visible = true;
    p.mesh.position.copy(worldPos);
    const mat = p.mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(0xe0f2fe);
    mat.opacity = 0.65;

    p.velocity
      .copy(playerVel)
      .multiplyScalar(-0.18)
      .add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 2.5,
          (Math.random() - 0.3) * 2.0,
          (Math.random() - 0.5) * 2.5
        )
      );
    p.age = 0;
    p.maxAge = 0.36;
    p.startScale = 0.7;
    p.endScale = 2.6;
    p.mesh.scale.setScalar(p.startScale);
  }

  public spawnSlashArc(
    centerPos: THREE.Vector3,
    yaw: number,
    isHeavy: boolean
  ): void {
    const arc = this.slashArcPool.acquire();
    arc.mesh.visible = true;
    arc.mesh.position.copy(centerPos);
    arc.mesh.position.y += 1.15;
    arc.mesh.rotation.set(
      (Math.random() - 0.5) * 0.45,
      yaw,
      isHeavy ? 0.15 : -0.35
    );
    const mat = arc.mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(isHeavy ? 0xfbbf24 : 0x38bdf8);
    mat.opacity = 0.9;
    arc.age = 0;
    arc.maxAge = isHeavy ? 0.32 : 0.2;
  }

  public spawnImpactBurst(
    worldPos: THREE.Vector3,
    isCriticalNape: boolean,
    glanced = false
  ): void {
    const count = isCriticalNape ? 18 : 10;
    const colorHex = glanced
      ? 0xfde047
      : isCriticalNape
        ? 0xef4444
        : 0xdc2626;

    for (let i = 0; i < count; i++) {
      const p = this.particlePool.acquire();
      p.mesh.visible = true;
      p.mesh.position.copy(worldPos);
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(colorHex);
      mat.opacity = 0.9;

      p.velocity.set(
        (Math.random() - 0.5) * 14,
        Math.random() * 9 + 2,
        (Math.random() - 0.5) * 14
      );
      p.age = 0;
      p.maxAge = isCriticalNape ? 0.65 : 0.42;
      p.startScale = isCriticalNape ? 1.3 : 0.9;
      p.endScale = 0.2;
      p.mesh.scale.setScalar(p.startScale);
    }

    // Also spawn hot white Titan regeneration/evaporation steam puffs
    if (!glanced) {
      for (let i = 0; i < 6; i++) {
        const s = this.particlePool.acquire();
        s.mesh.visible = true;
        s.mesh.position.copy(worldPos);
        const mat = s.mesh.material as THREE.MeshBasicMaterial;
        mat.color.setHex(0xf8fafc);
        mat.opacity = 0.55;
        s.velocity.set(
          (Math.random() - 0.5) * 4,
          4 + Math.random() * 5,
          (Math.random() - 0.5) * 4
        );
        s.age = 0;
        s.maxAge = 0.85;
        s.startScale = 1.2;
        s.endScale = 4.2;
      }
    }
  }

  public update(dt: number): void {
    const activeParticles = Array.from(this.particlePool.getActiveItems());
    for (const p of activeParticles) {
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.particlePool.release(p);
        continue;
      }
      const t = p.age / p.maxAge;
      p.mesh.position.addScaledVector(p.velocity, dt);
      const scale = p.startScale + (p.endScale - p.startScale) * t;
      p.mesh.scale.setScalar(scale);
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - t) * 0.75;
    }

    const activeArcs = Array.from(this.slashArcPool.getActiveItems());
    for (const arc of activeArcs) {
      arc.age += dt;
      if (arc.age >= arc.maxAge) {
        this.slashArcPool.release(arc);
        continue;
      }
      const t = arc.age / arc.maxAge;
      arc.mesh.rotation.y += dt * 16;
      arc.mesh.scale.setScalar(1 + t * 0.35);
      const mat = arc.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - t) * 0.85;
    }
  }

  public clearAll(): void {
    this.particlePool.releaseAll();
    this.slashArcPool.releaseAll();
  }
}
