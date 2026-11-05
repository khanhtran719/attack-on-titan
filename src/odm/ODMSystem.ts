import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';
import { TitanEntity } from '../enemies/TitanEntity';
import { TitanZoneType } from '../enemies/TitanRigBuilder';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { NetHookState } from '../shared/Protocol';
import {
  findBestWorldGrapplePoint,
  HookFireDebugInfo,
  HookFireResultReason,
} from '../shared/WorldGrappleSolver';
import {
  RopeAnchorConstraintInput,
  solveODMRopeConstraints,
} from '../utils/MathUtils';

export interface GrappleHookState {
  side: 'left' | 'right';
  active: boolean;
  anchorPos: THREE.Vector3;
  restLength: number;
  isTaut: boolean;
  deployProgress: number; // 0 -> 1 visual wire extension
  attachedTitanId: string | null;
  attachedZone: TitanZoneType | null;
}

export interface ReticleGrapplePreview {
  canGrapple: boolean;
  point: THREE.Vector3 | null;
  distance: number;
  isTitan: boolean;
}

export class ODMSystem {
  public readonly leftHook: GrappleHookState = {
    side: 'left',
    active: false,
    anchorPos: new THREE.Vector3(),
    restLength: 0,
    isTaut: false,
    deployProgress: 0,
    attachedTitanId: null,
    attachedZone: null,
  };

  public readonly rightHook: GrappleHookState = {
    side: 'right',
    active: false,
    anchorPos: new THREE.Vector3(),
    restLength: 0,
    isTaut: false,
    deployProgress: 0,
    attachedTitanId: null,
    attachedZone: null,
  };

  public lastLeftDebug: HookFireDebugInfo | null = null;
  public lastRightDebug: HookFireDebugInfo | null = null;
  public readonly debugHistory: HookFireDebugInfo[] = [];

  private leftWireMesh: THREE.Mesh;
  private rightWireMesh: THREE.Mesh;
  private leftAnchorMesh: THREE.Mesh;
  private rightAnchorMesh: THREE.Mesh;

  constructor(
    private scene: THREE.Scene,
    private physics: PhysicsWorld
  ) {
    // Use unit-height cylinder oriented along +Z for crisp visible 3D steel cables
    const wireGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 6, 1);
    wireGeo.rotateX(Math.PI / 2);
    wireGeo.translate(0, 0, 0.5);

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xdbeafe,
    });

    this.leftWireMesh = new THREE.Mesh(wireGeo, wireMat);
    this.rightWireMesh = new THREE.Mesh(wireGeo, wireMat);
    this.leftWireMesh.visible = false;
    this.rightWireMesh.visible = false;
    this.leftWireMesh.frustumCulled = false;
    this.rightWireMesh.frustumCulled = false;

    const anchorGeo = new THREE.OctahedronGeometry(0.24, 0);
    const anchorMatL = new THREE.MeshBasicMaterial({ color: 0x38d9c0 });
    const anchorMatR = new THREE.MeshBasicMaterial({ color: 0xf5a623 });

    this.leftAnchorMesh = new THREE.Mesh(anchorGeo, anchorMatL);
    this.rightAnchorMesh = new THREE.Mesh(anchorGeo, anchorMatR);
    this.leftAnchorMesh.visible = false;
    this.rightAnchorMesh.visible = false;

    this.scene.add(
      this.leftWireMesh,
      this.rightWireMesh,
      this.leftAnchorMesh,
      this.rightAnchorMesh
    );
  }

  public releaseHook(side: 'left' | 'right'): void {
    const hook = side === 'left' ? this.leftHook : this.rightHook;
    hook.active = false;
    hook.isTaut = false;
    hook.attachedTitanId = null;
    hook.attachedZone = null;

    if (side === 'left') {
      this.leftWireMesh.visible = false;
      this.leftAnchorMesh.visible = false;
    } else {
      this.rightWireMesh.visible = false;
      this.rightAnchorMesh.visible = false;
    }
  }

  public releaseAll(): void {
    this.releaseHook('left');
    this.releaseHook('right');
  }

  public isAnyHookActive(): boolean {
    return this.leftHook.active || this.rightHook.active;
  }

  private recordHookDebug(
    side: 'left' | 'right',
    success: boolean,
    reason: HookFireResultReason,
    anchor: THREE.Vector3 | null,
    distance: number,
    surfaceLabel?: string
  ): void {
    const info: HookFireDebugInfo = {
      side,
      seq: 0,
      timestampMs: Date.now(),
      success,
      reason,
      anchor: anchor ? [anchor.x, anchor.y, anchor.z] : null,
      distance,
      surfaceLabel,
    };
    if (side === 'left') {
      this.lastLeftDebug = info;
    } else {
      this.lastRightDebug = info;
    }
    this.debugHistory.push(info);
    if (this.debugHistory.length > 32) {
      this.debugHistory.shift();
    }
  }

  /**
   * Synchronizes local Left or Right hook state with an authoritative server snapshot
   * once `snapshot.lastAckedSeq >= lastClientHookActionSeq`.
   * - Restores hook if server is active and client is inactive.
   * - Aligns anchorPos, attachedTitanId/zone, and restLength if both are active.
   * - Releases hook if server rejected/detached it.
   */
  public syncHookFromServer(
    side: 'left' | 'right',
    netHook: NetHookState,
    titans: TitanEntity[]
  ): void {
    const hook = side === 'left' ? this.leftHook : this.rightHook;

    if (!netHook.active) {
      if (hook.active) {
        this.releaseHook(side);
      }
      return;
    }

    const wasActive = hook.active;
    hook.active = true;
    hook.attachedTitanId = netHook.attachedTitanId;
    hook.attachedZone = netHook.attachedZone;
    hook.isTaut = netHook.isTaut;

    if (!wasActive) {
      hook.deployProgress = 1.0;
      hook.restLength = netHook.restLength;
    } else if (Math.abs(hook.restLength - netHook.restLength) > 0.6) {
      hook.restLength =
        hook.restLength * 0.4 + netHook.restLength * 0.6;
    }

    if (hook.attachedTitanId && hook.attachedZone) {
      const titan = titans.find((t) => t.id === hook.attachedTitanId);
      if (titan && !titan.isDead()) {
        hook.anchorPos.copy(titan.hurtboxes[hook.attachedZone].worldPosition);
        return;
      }
    }

    hook.anchorPos.set(
      netHook.anchor[0],
      netHook.anchor[1],
      netHook.anchor[2]
    );
  }

  /**
   * Probes whether the camera reticle is currently pointing at a valid grapple surface or Titan.
   */
  public probeReticleTarget(
    cameraOrigin: THREE.Vector3,
    cameraForward: THREE.Vector3,
    playerPos: THREE.Vector3,
    titans: TitanEntity[],
    lockedTitan: TitanEntity | null,
    lockedZone: TitanZoneType
  ): ReticleGrapplePreview {
    // 1. Check locked Titan zone if in range and roughly in front of camera
    if (lockedTitan && !lockedTitan.isDead()) {
      const zonePos = lockedTitan.hurtboxes[lockedZone].worldPosition;
      const dist = playerPos.distanceTo(zonePos);
      const toZone = zonePos.clone().sub(cameraOrigin).normalize();
      if (
        dist <= GAME_CONFIG.odm.maxGrappleRange &&
        toZone.dot(cameraForward) > 0.35
      ) {
        return {
          canGrapple: true,
          point: zonePos.clone(),
          distance: dist,
          isTitan: true,
        };
      }
    }

    // 2. Check any Titan hurtbox near camera aim ray
    const titanHit = this.findTitanAlongRay(
      cameraOrigin,
      cameraForward,
      playerPos,
      titans
    );
    if (titanHit) {
      return {
        canGrapple: true,
        point: titanHit.point,
        distance: titanHit.distance,
        isTitan: true,
      };
    }

    // 3. Check static world geometry via shared multi-stage world grapple solver
    const worldHit = findBestWorldGrapplePoint(
      this.physics,
      cameraOrigin,
      cameraForward,
      playerPos,
      0
    );
    if (worldHit) {
      return {
        canGrapple: true,
        point: worldHit.point,
        distance: worldHit.distance,
        isTitan: false,
      };
    }

    return {
      canGrapple: false,
      point: null,
      distance: GAME_CONFIG.odm.maxGrappleRange,
      isTitan: false,
    };
  }

  /**
   * Attempts to fire and latch the Left or Right grappling hook.
   */
  public tryFireHook(
    side: 'left' | 'right',
    cameraOrigin: THREE.Vector3,
    cameraForward: THREE.Vector3,
    _cameraRight: THREE.Vector3,
    playerPos: THREE.Vector3,
    titans: TitanEntity[],
    lockedTitan: TitanEntity | null,
    lockedZone: TitanZoneType
  ): boolean {
    const hook = side === 'left' ? this.leftHook : this.rightHook;
    const sideSign: -1 | 1 = side === 'left' ? -1 : 1;

    // 1. Priority: Locked Titan zone if within range and forward cone
    if (lockedTitan && !lockedTitan.isDead()) {
      const zonePos = lockedTitan.hurtboxes[lockedZone].worldPosition;
      const dist = playerPos.distanceTo(zonePos);
      const toZone = zonePos.clone().sub(cameraOrigin).normalize();
      if (
        dist <= GAME_CONFIG.odm.maxGrappleRange &&
        toZone.dot(cameraForward) > 0.35
      ) {
        hook.active = true;
        hook.anchorPos.copy(zonePos);
        hook.restLength = Math.max(GAME_CONFIG.odm.minRopeLength, dist);
        hook.deployProgress = 0.25;
        hook.attachedTitanId = lockedTitan.id;
        hook.attachedZone = lockedZone;
        this.recordHookDebug(
          side,
          true,
          'LOCKED_TITAN_LATCH',
          zonePos,
          dist,
          `Titan ${lockedTitan.id} [${lockedZone}]`
        );
        return true;
      }
    }

    // 2. Check Titan hurtboxes along aim ray
    const titanHit = this.findTitanAlongRay(
      cameraOrigin,
      cameraForward,
      playerPos,
      titans
    );
    if (titanHit) {
      hook.active = true;
      hook.anchorPos.copy(titanHit.point);
      hook.restLength = Math.max(
        GAME_CONFIG.odm.minRopeLength,
        titanHit.distance
      );
      hook.deployProgress = 0.25;
      hook.attachedTitanId = titanHit.titan.id;
      hook.attachedZone = titanHit.zone;
      this.recordHookDebug(
        side,
        true,
        'RAY_TITAN_LATCH',
        titanHit.point,
        titanHit.distance,
        `Titan ${titanHit.titan.id} [${titanHit.zone}]`
      );
      return true;
    }

    // 3. Check world buildings/walls/towers using the shared multi-stage world grapple solver
    const worldHit = findBestWorldGrapplePoint(
      this.physics,
      cameraOrigin,
      cameraForward,
      playerPos,
      sideSign
    );
    if (worldHit) {
      hook.active = true;
      hook.anchorPos.copy(worldHit.point);
      hook.restLength = Math.max(
        GAME_CONFIG.odm.minRopeLength,
        playerPos.distanceTo(worldHit.point)
      );
      hook.deployProgress = 0.25;
      hook.attachedTitanId = null;
      hook.attachedZone = null;
      this.recordHookDebug(
        side,
        true,
        worldHit.reason,
        worldHit.point,
        worldHit.distance,
        worldHit.surfaceLabel
      );
      return true;
    }

    this.recordHookDebug(
      side,
      false,
      'REJECT_NO_SURFACE_IN_CONE',
      null,
      GAME_CONFIG.odm.maxGrappleRange
    );
    return false;
  }

  private findTitanAlongRay(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    playerPos: THREE.Vector3,
    titans: TitanEntity[]
  ): {
    titan: TitanEntity;
    zone: TitanZoneType;
    point: THREE.Vector3;
    distance: number;
  } | null {
    let best: {
      titan: TitanEntity;
      zone: TitanZoneType;
      point: THREE.Vector3;
      distance: number;
    } | null = null;
    let bestScore = Infinity;

    for (const titan of titans) {
      if (titan.isDead()) continue;
      for (const zone of Object.keys(titan.hurtboxes) as TitanZoneType[]) {
        const hb = titan.hurtboxes[zone];
        const distFromPlayer = playerPos.distanceTo(hb.worldPosition);
        if (distFromPlayer > GAME_CONFIG.odm.maxGrappleRange) continue;

        const toHb = new THREE.Vector3().subVectors(hb.worldPosition, origin);
        const proj = toHb.dot(dir);
        if (proj <= 0) continue;

        const closestOnRay = origin.clone().addScaledVector(dir, proj);
        const perpDist = closestOnRay.distanceTo(hb.worldPosition);
        if (perpDist <= hb.radius * 2.4) {
          const score = perpDist * 3.0 + distFromPlayer * 0.1;
          if (score < bestScore) {
            bestScore = score;
            best = {
              titan,
              zone,
              point: hb.worldPosition.clone(),
              distance: distFromPlayer,
            };
          }
        }
      }
    }

    return best;
  }

  /**
   * Updates moving Titan anchors, solves single/dual rope physics constraints,
   * and updates the 3D cable and anchor meshes.
   */
  public stepPhysics(
    dt: number,
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    steerWorldDir: THREE.Vector3,
    isBoosting: boolean,
    titans: TitanEntity[]
  ): {
    newPosition: THREE.Vector3;
    newVelocity: THREE.Vector3;
  } {
    const activeConstraints: RopeAnchorConstraintInput[] = [];
    const hookRefs: GrappleHookState[] = [];

    for (const hook of [this.leftHook, this.rightHook]) {
      if (!hook.active) continue;

      // Update anchor position if latched onto a live Titan bone hurtbox
      if (hook.attachedTitanId && hook.attachedZone) {
        const titan = titans.find((t) => t.id === hook.attachedTitanId);
        if (!titan || titan.isDead()) {
          this.releaseHook(hook.side);
          continue;
        }
        hook.anchorPos.copy(titan.hurtboxes[hook.attachedZone].worldPosition);
      }

      // Break hook if stretched way beyond maximum wire capacity
      const dist = playerPos.distanceTo(hook.anchorPos);
      if (dist > GAME_CONFIG.odm.maxGrappleRange * 1.22) {
        this.releaseHook(hook.side);
        continue;
      }

      hook.deployProgress = Math.min(1.0, hook.deployProgress + dt * 9.5);

      const reelRate = isBoosting
        ? GAME_CONFIG.odm.reelInSpeedBoost
        : GAME_CONFIG.odm.reelInSpeedBase;

      activeConstraints.push({
        anchorPos: hook.anchorPos,
        restLength: hook.restLength,
        reelInRate: reelRate,
      });
      hookRefs.push(hook);
    }

    if (activeConstraints.length === 0) {
      return {
        newPosition: playerPos.clone(),
        newVelocity: playerVel.clone(),
      };
    }

    const solved = solveODMRopeConstraints(
      playerPos,
      playerVel,
      activeConstraints,
      steerWorldDir,
      isBoosting,
      dt
    );

    for (let i = 0; i < hookRefs.length; i++) {
      hookRefs[i].restLength = solved.updatedRestLengths[i];
      hookRefs[i].isTaut = solved.isTaut[i];
    }

    return {
      newPosition: solved.newPosition,
      newVelocity: solved.newVelocity,
    };
  }

  public updateVisualWires(
    leftWinchWorld: THREE.Vector3,
    rightWinchWorld: THREE.Vector3
  ): void {
    this.updateSingleWireVisual(
      this.leftHook,
      leftWinchWorld,
      this.leftWireMesh,
      this.leftAnchorMesh
    );
    this.updateSingleWireVisual(
      this.rightHook,
      rightWinchWorld,
      this.rightWireMesh,
      this.rightAnchorMesh
    );
  }

  private updateSingleWireVisual(
    hook: GrappleHookState,
    originWorld: THREE.Vector3,
    wireMesh: THREE.Mesh,
    anchorMesh: THREE.Mesh
  ): void {
    if (!hook.active) {
      wireMesh.visible = false;
      anchorMesh.visible = false;
      return;
    }

    const currentTip = new THREE.Vector3().lerpVectors(
      originWorld,
      hook.anchorPos,
      hook.deployProgress
    );
    const dist = originWorld.distanceTo(currentTip);
    if (dist < 0.05) {
      wireMesh.visible = false;
      return;
    }

    wireMesh.visible = true;
    wireMesh.position.copy(originWorld);
    wireMesh.lookAt(currentTip);
    wireMesh.scale.set(1, 1, dist);

    anchorMesh.visible = true;
    anchorMesh.position.copy(hook.anchorPos);
    anchorMesh.rotation.y += 0.08;
  }
}
