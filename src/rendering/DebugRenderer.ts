import * as THREE from 'three';
import { DebugOptions } from '../config/GameConfig';
import { TitanEntity } from '../enemies/TitanEntity';
import { TitanZoneType } from '../enemies/TitanRigBuilder';
import { ODMSystem } from '../odm/ODMSystem';
import { PhysicsWorld } from '../physics/PhysicsWorld';

export class DebugRenderer {
  private debugGroup: THREE.Group = new THREE.Group();
  private velocityArrow: THREE.ArrowHelper;
  private hitboxSpheres: THREE.Mesh[] = [];
  private sphereGeo = new THREE.SphereGeometry(1, 10, 8);
  private hitboxMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    wireframe: true,
  });
  private weakPointMat = new THREE.MeshBasicMaterial({
    color: 0xff2e4c,
    wireframe: true,
  });

  constructor(private scene: THREE.Scene) {
    this.debugGroup.name = 'DebugVisualsGroup';
    this.scene.add(this.debugGroup);

    this.velocityArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(),
      1,
      0x22c55e
    );
    this.velocityArrow.visible = false;
    this.scene.add(this.velocityArrow);
  }

  public update(
    options: DebugOptions,
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    odm: ODMSystem,
    titans: TitanEntity[],
    physics: PhysicsWorld
  ): void {
    // 1. Velocity vector arrow
    if (options.showVelocityVectors && playerVel.lengthSq() > 0.2) {
      this.velocityArrow.visible = true;
      this.velocityArrow.position.set(
        playerPos.x,
        playerPos.y + 1.2,
        playerPos.z
      );
      this.velocityArrow.setDirection(playerVel.clone().normalize());
      this.velocityArrow.setLength(Math.min(8, playerVel.length() * 0.22));
    } else {
      this.velocityArrow.visible = false;
    }

    // 2. Titan Hitboxes & Weak Points
    let sphereIdx = 0;
    if (options.showTitanHitboxes || options.showWeakPoints) {
      for (const titan of titans) {
        if (titan.isDead()) continue;
        for (const zone of Object.keys(titan.hurtboxes) as TitanZoneType[]) {
          if (zone === 'Nape' && !options.showWeakPoints && !options.showTitanHitboxes) {
            continue;
          }
          if (zone !== 'Nape' && !options.showTitanHitboxes) {
            continue;
          }

          const hb = titan.hurtboxes[zone];
          const mesh = this.getOrCreateSphere(sphereIdx++);
          mesh.visible = true;
          mesh.position.copy(hb.worldPosition);
          mesh.scale.setScalar(hb.radius);
          mesh.material = zone === 'Nape' ? this.weakPointMat : this.hitboxMat;
        }
      }
    }

    // 3. Grapple anchors debug spheres
    if (options.showGrappleAnchors) {
      for (const hook of [odm.leftHook, odm.rightHook]) {
        if (!hook.active) continue;
        const mesh = this.getOrCreateSphere(sphereIdx++);
        mesh.visible = true;
        mesh.position.copy(hook.anchorPos);
        mesh.scale.setScalar(0.65);
        mesh.material = this.weakPointMat;
      }
    }

    // 4. Player Capsule Collider debug wireframe
    if (options.showColliders) {
      const mesh = this.getOrCreateSphere(sphereIdx++);
      mesh.visible = true;
      mesh.position.set(playerPos.x, playerPos.y + 0.9, playerPos.z);
      mesh.scale.set(0.4, 0.9, 0.4);
      mesh.material = this.hitboxMat;
    }

    for (let i = sphereIdx; i < this.hitboxSpheres.length; i++) {
      this.hitboxSpheres[i].visible = false;
    }
  }

  private getOrCreateSphere(index: number): THREE.Mesh {
    while (this.hitboxSpheres.length <= index) {
      const m = new THREE.Mesh(this.sphereGeo, this.hitboxMat);
      m.visible = false;
      this.debugGroup.add(m);
      this.hitboxSpheres.push(m);
    }
    return this.hitboxSpheres[index];
  }
}
