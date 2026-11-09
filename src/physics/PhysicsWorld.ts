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

export interface PlayerPhysicsActor {
  id: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
}

export class PhysicsWorld {
  public world!: RAPIER.World;
  /**
   * Co-op Player-to-Player Collision Policy:
   * Default `false` (pass-through between squadmates) so high-speed aerial ODM swings
   * and close-range revives never snag or body-block teammates in narrow street corridors.
   * Can be toggled via `setPlayerToPlayerCollision(true)` for solid body-blocking tests.
   */
  public playerToPlayerCollision = false;

  private playerActors: Map<string, PlayerPhysicsActor> = new Map();
  private playerColliderHandles: Set<number> = new Set();
  private colliderMeta: Map<number, ColliderMetadata> = new Map();
  private staticBoxes: Array<{
    box: THREE.Box3;
    metadata: ColliderMetadata;
  }> = [];
  private disposed = false;

  public static async create(): Promise<PhysicsWorld> {
    const pw = new PhysicsWorld();
    await pw.init();
    return pw;
  }

  public async init(createDefaultLocalActor = true): Promise<void> {
    await RAPIER.init();
    this.disposed = false;
    this.world = new RAPIER.World({
      x: 0,
      y: GAME_CONFIG.physics.gravity,
      z: 0,
    });
    if (createDefaultLocalActor) {
      // Create default 'local' actor for single-player and client prediction
      this.ensurePlayerActor('local', new THREE.Vector3(0, 0.2, 0));
    }
  }

  public ensurePlayerActor(
    playerId = 'local',
    footPos?: THREE.Vector3
  ): PlayerPhysicsActor {
    const existing = this.playerActors.get(playerId);
    if (existing) {
      if (footPos) {
        this.setPlayerPosition(footPos, playerId);
      }
      return existing;
    }

    const controller = this.world.createCharacterController(0.06);
    controller.enableAutostep(0.45, 0.25, true);
    controller.enableSnapToGround(0.35);
    controller.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((58 * Math.PI) / 180);

    const offsetY =
      GAME_CONFIG.player.capsuleHalfHeight + GAME_CONFIG.player.capsuleRadius;
    const initX = footPos ? footPos.x : 0;
    const initY = (footPos ? footPos.y : 0.2) + offsetY;
    const initZ = footPos ? footPos.z : 0;

    const bodyDesc =
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        initX,
        initY,
        initZ
      );
    const body = this.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(
      GAME_CONFIG.player.capsuleHalfHeight,
      GAME_CONFIG.player.capsuleRadius
    ).setFriction(0.1);
    const collider = this.world.createCollider(colDesc, body);

    const actor: PlayerPhysicsActor = {
      id: playerId,
      body,
      collider,
      controller,
    };
    this.playerActors.set(playerId, actor);
    this.playerColliderHandles.add(collider.handle);
    return actor;
  }

  public removePlayerActor(playerId: string): void {
    const actor = this.playerActors.get(playerId);
    if (!actor) return;
    this.playerColliderHandles.delete(actor.collider.handle);
    this.playerActors.delete(playerId);
    if (!this.disposed && this.world) {
      try {
        this.world.removeCharacterController(actor.controller);
        this.world.removeRigidBody(actor.body);
      } catch {
        // Ignore if world is already being torn down
      }
    }
  }

  public getPlayerActorCount(): number {
    return this.playerActors.size;
  }

  public hasPlayerActor(playerId: string): boolean {
    return this.playerActors.has(playerId);
  }

  public getPlayerCapsuleCenter(playerId = 'local'): THREE.Vector3 | null {
    const actor = this.playerActors.get(playerId);
    if (!actor) return null;
    const t = actor.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  public clearStaticWorld(): void {
    const savedPositions = new Map<string, THREE.Vector3>();
    const offsetY =
      GAME_CONFIG.player.capsuleHalfHeight + GAME_CONFIG.player.capsuleRadius;

    for (const [id, actor] of this.playerActors.entries()) {
      const t = actor.body.translation();
      savedPositions.set(
        id,
        new THREE.Vector3(t.x, Math.max(0, t.y - offsetY), t.z)
      );
    }

    this.freeRapierWorld();

    this.colliderMeta.clear();
    this.staticBoxes = [];
    this.disposed = false;
    this.world = new RAPIER.World({
      x: 0,
      y: GAME_CONFIG.physics.gravity,
      z: 0,
    });

    if (savedPositions.size === 0) {
      this.ensurePlayerActor('local', new THREE.Vector3(0, 0.2, 0));
    } else {
      for (const [id, pos] of savedPositions.entries()) {
        this.ensurePlayerActor(id, pos);
      }
    }
  }

  public dispose(): void {
    this.freeRapierWorld();
    this.colliderMeta.clear();
    this.staticBoxes = [];
  }

  private freeRapierWorld(): void {
    if (this.disposed || !this.world) return;
    for (const actor of this.playerActors.values()) {
      try {
        this.world.removeCharacterController(actor.controller);
      } catch {
        // Ignore
      }
    }
    this.playerActors.clear();
    this.playerColliderHandles.clear();
    try {
      this.world.free();
    } catch {
      // Ignore if already freed
    }
    this.disposed = true;
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

  public setPlayerPosition(pos: THREE.Vector3, playerId = 'local'): void {
    const actor = this.ensurePlayerActor(playerId);
    const capsuleCenterY =
      pos.y +
      GAME_CONFIG.player.capsuleHalfHeight +
      GAME_CONFIG.player.capsuleRadius;
    actor.body.setNextKinematicTranslation({
      x: pos.x,
      y: capsuleCenterY,
      z: pos.z,
    });
    actor.body.setTranslation(
      { x: pos.x, y: capsuleCenterY, z: pos.z },
      true
    );
    this.world.step();
  }

  /**
   * Moves the specified player's character capsule by desiredDelta, resolving world collisions
   * via that player's isolated Rapier KinematicCharacterController & Collider.
   */
  public moveCharacter(
    currentFootPos: THREE.Vector3,
    desiredDelta: THREE.Vector3,
    isAirborneOrSwinging: boolean,
    playerId = 'local'
  ): {
    footPosition: THREE.Vector3;
    grounded: boolean;
    hitWall: boolean;
    wallNormal: THREE.Vector3 | null;
  } {
    const actor = this.ensurePlayerActor(playerId);
    const offsetY =
      GAME_CONFIG.player.capsuleHalfHeight + GAME_CONFIG.player.capsuleRadius;

    // Ensure this player's body matches currentFootPos before computing movement
    actor.body.setTranslation(
      {
        x: currentFootPos.x,
        y: currentFootPos.y + offsetY,
        z: currentFootPos.z,
      },
      true
    );

    if (isAirborneOrSwinging) {
      actor.controller.disableSnapToGround();
    } else {
      actor.controller.enableSnapToGround(0.35);
    }

    actor.controller.computeColliderMovement(
      actor.collider,
      { x: desiredDelta.x, y: desiredDelta.y, z: desiredDelta.z },
      undefined,
      undefined,
      (collider) => {
        if (collider.handle === actor.collider.handle) return false;
        if (
          !this.playerToPlayerCollision &&
          this.playerColliderHandles.has(collider.handle)
        ) {
          return false;
        }
        return true;
      }
    );

    const corrected = actor.controller.computedMovement();
    const grounded = actor.controller.computedGrounded();

    let hitWall = false;
    let wallNormal: THREE.Vector3 | null = null;
    const numCollisions = actor.controller.numComputedCollisions();
    for (let i = 0; i < numCollisions; i++) {
      const col = actor.controller.computedCollision(i);
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

    actor.body.setNextKinematicTranslation({
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
    if (!this.disposed && this.world) {
      this.world.step();
    }
  }

  /**
   * Casts a ray in the Rapier world, ignoring all player character capsules.
   */
  public castRay(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxToi: number,
    onlyGrappleable = false
  ): RaycastHitResult | null {
    if (this.disposed || !this.world) return null;
    const lenSq = direction.lengthSq();
    if (lenSq < 1e-8) return null;
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
      undefined,
      undefined,
      (collider) => {
        if (this.playerColliderHandles.has(collider.handle)) return false;
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

  /**
   * Checks whether there is an unobstructed line of sight between `origin` and `target`
   * (no solid world building, wall, tower, or ground blocking the segment).
   */
  public hasLineOfSight(
    origin: THREE.Vector3,
    target: THREE.Vector3,
    tolerance = 0.9
  ): boolean {
    const toTarget = target.clone().sub(origin);
    const totalDist = toTarget.length();
    if (totalDist <= tolerance) return true;

    const hit = this.castRay(origin, toTarget.divideScalar(totalDist), totalDist, false);
    if (!hit) return true;
    // Allow minor grazing near the target surface itself within `tolerance`
    return hit.distance >= totalDist - tolerance;
  }
}
