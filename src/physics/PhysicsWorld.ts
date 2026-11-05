import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';

export interface ColliderMetadata {
  type: 'ground' | 'building' | 'wall' | 'tower' | 'resupply' | 'tree' | 'titan';
  grappleable: boolean;
  label?: string;
  entityId?: string;
}

export interface RaycastHitResult {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  metadata: ColliderMetadata;
}

export class PhysicsWorld {
  public world!: RAPIER.World;
  private characterController!: RAPIER.KinematicCharacterController;
  private playerBody!: RAPIER.RigidBody;
  private playerCollider!: RAPIER.Collider;
  private colliderMeta: Map<number, ColliderMetadata> = new Map();
  private staticBoxes: Array<{
    box: THREE.Box3;
    metadata: ColliderMetadata;
  }> = [];

  public async init(): Promise<void> {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: GAME_CONFIG.physics.gravity, z: 0 });

    // Create KinematicCharacterController for smooth wall sliding and step climbing
    this.characterController = this.world.createCharacterController(0.06);
    this.characterController.enableAutostep(0.45, 0.25, true);
    this.characterController.enableSnapToGround(0.35);
    this.characterController.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.characterController.setMinSlopeSlideAngle((58 * Math.PI) / 180);

    // Create player kinematic body & capsule collider
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 2, 0);
    this.playerBody = this.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(
      GAME_CONFIG.player.capsuleHalfHeight,
      GAME_CONFIG.player.capsuleRadius
    ).setFriction(0.1);
    this.playerCollider = this.world.createCollider(colDesc, this.playerBody);
  }

  public clearStaticWorld(): void {
    // Recreate world and player collider cleanly when resetting/switching map
    const pos = this.playerBody
      ? this.playerBody.translation()
      : { x: 0, y: 2, z: 0 };

    this.colliderMeta.clear();
    this.staticBoxes = [];
    this.world = new RAPIER.World({ x: 0, y: GAME_CONFIG.physics.gravity, z: 0 });

    this.characterController = this.world.createCharacterController(0.06);
    this.characterController.enableAutostep(0.45, 0.25, true);
    this.characterController.enableSnapToGround(0.35);
    this.characterController.setMaxSlopeClimbAngle((52 * Math.PI) / 180);

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      pos.x,
      pos.y,
      pos.z
    );
    this.playerBody = this.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(
      GAME_CONFIG.player.capsuleHalfHeight,
      GAME_CONFIG.player.capsuleRadius
    );
    this.playerCollider = this.world.createCollider(colDesc, this.playerBody);
  }

  public addStaticBox(
    center: THREE.Vector3,
    halfExtents: THREE.Vector3,
    metadata: ColliderMetadata,
    rotationY = 0
  ): RAPIER.Collider {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
      center.x,
      center.y,
      center.z
    );
    if (rotationY !== 0) {
      const q = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        rotationY
      );
      bodyDesc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
    const body = this.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.cuboid(
      halfExtents.x,
      halfExtents.y,
      halfExtents.z
    );
    const collider = this.world.createCollider(colDesc, body);
    this.colliderMeta.set(collider.handle, metadata);

    if (rotationY === 0 && metadata.type !== 'ground') {
      const box = new THREE.Box3(
        new THREE.Vector3(
          center.x - halfExtents.x,
          center.y - halfExtents.y,
          center.z - halfExtents.z
        ),
        new THREE.Vector3(
          center.x + halfExtents.x,
          center.y + halfExtents.y,
          center.z + halfExtents.z
        )
      );
      this.staticBoxes.push({ box, metadata });
    }
    return collider;
  }

  public addStaticCylinder(
    center: THREE.Vector3,
    halfHeight: number,
    radius: number,
    metadata: ColliderMetadata
  ): RAPIER.Collider {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
      center.x,
      center.y,
      center.z
    );
    const body = this.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.cylinder(halfHeight, radius);
    const collider = this.world.createCollider(colDesc, body);
    this.colliderMeta.set(collider.handle, metadata);
    return collider;
  }

  public getStaticBoxes(): ReadonlyArray<{
    box: THREE.Box3;
    metadata: ColliderMetadata;
  }> {
    return this.staticBoxes;
  }

  public setPlayerPosition(pos: THREE.Vector3): void {
    const capsuleCenterY =
      pos.y + GAME_CONFIG.player.capsuleHalfHeight + GAME_CONFIG.player.capsuleRadius;
    this.playerBody.setNextKinematicTranslation({
      x: pos.x,
      y: capsuleCenterY,
      z: pos.z,
    });
    this.playerBody.setTranslation(
      { x: pos.x, y: capsuleCenterY, z: pos.z },
      true
    );
    this.world.step();
  }

  /**
   * Moves the player character capsule by desiredDelta, resolving world collisions via Rapier.
   * Returns corrected foot position, grounded state, and whether a wall was hit.
   */
  public moveCharacter(
    currentFootPos: THREE.Vector3,
    desiredDelta: THREE.Vector3,
    isAirborneOrSwinging: boolean
  ): {
    footPosition: THREE.Vector3;
    grounded: boolean;
    hitWall: boolean;
    wallNormal: THREE.Vector3 | null;
  } {
    const offsetY =
      GAME_CONFIG.player.capsuleHalfHeight + GAME_CONFIG.player.capsuleRadius;

    // Ensure body matches currentFootPos before computing movement
    this.playerBody.setTranslation(
      {
        x: currentFootPos.x,
        y: currentFootPos.y + offsetY,
        z: currentFootPos.z,
      },
      true
    );

    if (isAirborneOrSwinging) {
      this.characterController.disableSnapToGround();
    } else {
      this.characterController.enableSnapToGround(0.35);
    }

    this.characterController.computeColliderMovement(
      this.playerCollider,
      { x: desiredDelta.x, y: desiredDelta.y, z: desiredDelta.z },
      undefined,
      undefined,
      (collider) => collider.handle !== this.playerCollider.handle
    );

    const corrected = this.characterController.computedMovement();
    const grounded = this.characterController.computedGrounded();

    let hitWall = false;
    let wallNormal: THREE.Vector3 | null = null;
    const numCollisions = this.characterController.numComputedCollisions();
    for (let i = 0; i < numCollisions; i++) {
      const col = this.characterController.computedCollision(i);
      if (col && col.normal1) {
        if (Math.abs(col.normal1.y) < 0.45) {
          hitWall = true;
          wallNormal = new THREE.Vector3(
            col.normal1.x,
            col.normal1.y,
            col.normal1.z
          ).normalize();
          break;
        }
      }
    }

    const nextFootPos = new THREE.Vector3(
      currentFootPos.x + corrected.x,
      Math.max(0, currentFootPos.y + corrected.y),
      currentFootPos.z + corrected.z
    );

    this.playerBody.setNextKinematicTranslation({
      x: nextFootPos.x,
      y: nextFootPos.y + offsetY,
      z: nextFootPos.z,
    });

    return {
      footPosition: nextFootPos,
      grounded: grounded || nextFootPos.y <= 0.02,
      hitWall,
      wallNormal,
    };
  }

  public step(): void {
    this.world.step();
  }

  /**
   * Casts a ray in the Rapier world, ignoring the player capsule.
   */
  public castRay(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxToi: number,
    onlyGrappleable = false
  ): RaycastHitResult | null {
    const dir = direction.clone().normalize();
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z }
    );

    const hit = this.world.castRayAndGetNormal(
      ray,
      maxToi,
      true,
      undefined,
      undefined,
      this.playerCollider,
      undefined,
      (collider) => {
        if (collider.handle === this.playerCollider.handle) return false;
        const meta = this.colliderMeta.get(collider.handle);
        if (!meta) return false;
        if (onlyGrappleable && !meta.grappleable) return false;
        return true;
      }
    );

    if (!hit) return null;
    const meta = this.colliderMeta.get(hit.collider.handle) || {
      type: 'building',
      grappleable: true,
    };
    const point = new THREE.Vector3(
      origin.x + dir.x * hit.timeOfImpact,
      origin.y + dir.y * hit.timeOfImpact,
      origin.z + dir.z * hit.timeOfImpact
    );
    const normal = new THREE.Vector3(
      hit.normal.x,
      hit.normal.y,
      hit.normal.z
    ).normalize();

    return {
      point,
      normal,
      distance: hit.timeOfImpact,
      metadata: meta,
    };
  }
}
