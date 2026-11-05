import * as THREE from 'three';
import {
  HumanoidRigBuilder,
  PlayerRigAssets,
} from '../animation/HumanoidRigBuilder';
import { PlayerAnimator } from '../animation/PlayerAnimator';
import { VFXManager } from '../rendering/VFXManager';
import { NetHookState, NetPlayerState } from '../shared/Protocol';
import { clamp, lerpAngle } from '../utils/MathUtils';

interface BufferedPlayerSnapshot {
  recvTimeMs: number;
  state: NetPlayerState;
}

export interface RemotePlayerEntity {
  id: string;
  nickname: string;
  rig: PlayerRigAssets;
  animator: PlayerAnimator;
  leftWireMesh: THREE.Mesh;
  rightWireMesh: THREE.Mesh;
  leftAnchorMesh: THREE.Mesh;
  rightAnchorMesh: THREE.Mesh;
  currentPosition: THREE.Vector3;
  currentVelocity: THREE.Vector3;
  currentYaw: number;
  latestState: NetPlayerState;
  snapshots: BufferedPlayerSnapshot[];
  gasParticleAccum: number;
}

const INTERPOLATION_DELAY_MS = 85;
const MAX_EXTRAPOLATION_MS = 180;

export class RemotePlayerManager {
  public readonly remotePlayers: Map<string, RemotePlayerEntity> = new Map();
  private wireGeo: THREE.CylinderGeometry;
  private wireMat: THREE.MeshBasicMaterial;
  private anchorGeo: THREE.OctahedronGeometry;
  private anchorMatL: THREE.MeshBasicMaterial;
  private anchorMatR: THREE.MeshBasicMaterial;

  constructor(private scene: THREE.Scene) {
    this.wireGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 6, 1);
    this.wireGeo.rotateX(Math.PI / 2);
    this.wireGeo.translate(0, 0, 0.5);
    this.wireMat = new THREE.MeshBasicMaterial({ color: 0xbae6fd });

    this.anchorGeo = new THREE.OctahedronGeometry(0.24, 0);
    this.anchorMatL = new THREE.MeshBasicMaterial({ color: 0x38d9c0 });
    this.anchorMatR = new THREE.MeshBasicMaterial({ color: 0xf5a623 });
  }

  public syncFromRoomSnapshot(
    playersMap: Record<string, NetPlayerState>,
    localPlayerId: string
  ): void {
    const nowMs = performance.now();
    const activeIds = new Set<string>();

    for (const [id, netState] of Object.entries(playersMap)) {
      if (id === localPlayerId || !netState.connected) continue;
      activeIds.add(id);

      let entity = this.remotePlayers.get(id);
      if (!entity) {
        entity = this.createRemoteEntity(netState);
        this.remotePlayers.set(id, entity);
      }

      entity.nickname = netState.nickname;
      entity.latestState = netState;
      entity.snapshots.push({
        recvTimeMs: nowMs,
        state: structuredClone(netState),
      });
      if (entity.snapshots.length > 20) {
        entity.snapshots.shift();
      }
    }

    // Remove disconnected remote players cleanly
    for (const [id, entity] of this.remotePlayers.entries()) {
      if (!activeIds.has(id)) {
        this.disposeRemoteEntity(entity);
        this.remotePlayers.delete(id);
      }
    }
  }

  private createRemoteEntity(initState: NetPlayerState): RemotePlayerEntity {
    const rig = HumanoidRigBuilder.buildPlayerRig();
    const animator = new PlayerAnimator(rig);

    const leftWireMesh = new THREE.Mesh(this.wireGeo, this.wireMat);
    const rightWireMesh = new THREE.Mesh(this.wireGeo, this.wireMat);
    leftWireMesh.visible = false;
    rightWireMesh.visible = false;
    leftWireMesh.frustumCulled = false;
    rightWireMesh.frustumCulled = false;

    const leftAnchorMesh = new THREE.Mesh(this.anchorGeo, this.anchorMatL);
    const rightAnchorMesh = new THREE.Mesh(this.anchorGeo, this.anchorMatR);
    leftAnchorMesh.visible = false;
    rightAnchorMesh.visible = false;

    this.scene.add(
      rig.rootGroup,
      leftWireMesh,
      rightWireMesh,
      leftAnchorMesh,
      rightAnchorMesh
    );

    const startPos = new THREE.Vector3(...initState.position);
    rig.rootGroup.position.copy(startPos);
    rig.rootGroup.rotation.y = initState.yaw;

    return {
      id: initState.id,
      nickname: initState.nickname,
      rig,
      animator,
      leftWireMesh,
      rightWireMesh,
      leftAnchorMesh,
      rightAnchorMesh,
      currentPosition: startPos,
      currentVelocity: new THREE.Vector3(...initState.velocity),
      currentYaw: initState.yaw,
      latestState: initState,
      snapshots: [],
      gasParticleAccum: 0,
    };
  }

  private disposeRemoteEntity(entity: RemotePlayerEntity): void {
    this.scene.remove(
      entity.rig.rootGroup,
      entity.leftWireMesh,
      entity.rightWireMesh,
      entity.leftAnchorMesh,
      entity.rightAnchorMesh
    );
  }

  public clearAll(): void {
    for (const entity of this.remotePlayers.values()) {
      this.disposeRemoteEntity(entity);
    }
    this.remotePlayers.clear();
  }

  /**
   * Updates all remote 3D characters using buffered snapshot interpolation
   * + bounded extrapolation (up to 180ms) and updates their animations & ODM wires.
   */
  public update(dt: number, vfx: VFXManager): void {
    const renderTimeMs = performance.now() - INTERPOLATION_DELAY_MS;

    for (const entity of this.remotePlayers.values()) {
      const snaps = entity.snapshots;
      if (snaps.length === 0) continue;

      if (renderTimeMs <= snaps[0].recvTimeMs) {
        const s = snaps[0].state;
        entity.currentPosition.set(...s.position);
        entity.currentVelocity.set(...s.velocity);
        entity.currentYaw = s.yaw;
      } else {
        const latest = snaps[snaps.length - 1];
        if (renderTimeMs <= latest.recvTimeMs) {
          // Find bracketing pair [s0, s1] where s0.recvTimeMs <= renderTimeMs <= s1.recvTimeMs
          let s0 = snaps[0];
          let s1 = latest;
          for (let i = 0; i < snaps.length - 1; i++) {
            if (
              snaps[i].recvTimeMs <= renderTimeMs &&
              renderTimeMs <= snaps[i + 1].recvTimeMs
            ) {
              s0 = snaps[i];
              s1 = snaps[i + 1];
              break;
            }
          }
          const span = Math.max(1, s1.recvTimeMs - s0.recvTimeMs);
          const alpha = clamp((renderTimeMs - s0.recvTimeMs) / span, 0, 1);

          const p0 = new THREE.Vector3(...s0.state.position);
          const p1 = new THREE.Vector3(...s1.state.position);
          entity.currentPosition.lerpVectors(p0, p1, alpha);

          const v0 = new THREE.Vector3(...s0.state.velocity);
          const v1 = new THREE.Vector3(...s1.state.velocity);
          entity.currentVelocity.lerpVectors(v0, v1, alpha);

          entity.currentYaw = lerpAngle(s0.state.yaw, s1.state.yaw, alpha);
        } else {
          // Bounded dead-reckoning extrapolation during packet delay/loss (max 180ms)
          const extrapMs = Math.min(
            MAX_EXTRAPOLATION_MS,
            renderTimeMs - latest.recvTimeMs
          );
          const extrapSec = extrapMs / 1000;
          const basePos = new THREE.Vector3(...latest.state.position);
          const baseVel = new THREE.Vector3(...latest.state.velocity);

          entity.currentPosition
            .copy(basePos)
            .addScaledVector(baseVel, extrapSec);
          entity.currentPosition.y = Math.max(0, entity.currentPosition.y);
          entity.currentVelocity.copy(baseVel);
          entity.currentYaw = latest.state.yaw;
        }
      }

      entity.rig.rootGroup.position.copy(entity.currentPosition);
      entity.rig.rootGroup.rotation.y = entity.currentYaw;

      const s = entity.latestState;
      const horizSpeed = Math.hypot(
        entity.currentVelocity.x,
        entity.currentVelocity.z
      );

      // Sync animation state
      if (entity.animator.getCurrentAnimation() !== s.anim) {
        entity.animator.playState(s.anim, 0.14);
      }

      const leftAnchorVec = s.leftHook.active
        ? new THREE.Vector3(...s.leftHook.anchor)
        : null;
      const rightAnchorVec = s.rightHook.active
        ? new THREE.Vector3(...s.rightHook.anchor)
        : null;

      entity.animator.update(dt, {
        grounded: s.grounded,
        speed: horizSpeed,
        verticalVel: entity.currentVelocity.y,
        lateralAccel: 0,
        leftHookAnchor: leftAnchorVec,
        rightHookAnchor: rightAnchorVec,
        isBoosting: s.isBoosting,
        bladeDurability: s.bladeDurability,
        playerWorldPos: entity.currentPosition,
        playerYaw: entity.currentYaw,
      });

      entity.rig.rootGroup.updateMatrixWorld(true);

      // Update Remote Player's Left & Right 3D ODM Steel Cables
      const lWinch = new THREE.Vector3();
      const rWinch = new THREE.Vector3();
      entity.rig.leftWinchNode.getWorldPosition(lWinch);
      entity.rig.rightWinchNode.getWorldPosition(rWinch);

      this.updateRemoteWire(
        s.leftHook,
        lWinch,
        entity.leftWireMesh,
        entity.leftAnchorMesh
      );
      this.updateRemoteWire(
        s.rightHook,
        rWinch,
        entity.rightWireMesh,
        entity.rightAnchorMesh
      );

      // Emit gas boost trail puffs for boosting teammates
      if (s.isBoosting || s.leftHook.active || s.rightHook.active) {
        entity.gasParticleAccum += dt;
        const interval = s.isBoosting ? 0.035 : 0.08;
        if (entity.gasParticleAccum >= interval) {
          entity.gasParticleAccum = 0;
          const nozzle = new THREE.Vector3();
          entity.rig.thrusterNozzleNode.getWorldPosition(nozzle);
          vfx.spawnGasJetPuff(nozzle, entity.currentVelocity);
        }
      }
    }
  }

  private updateRemoteWire(
    hook: NetHookState,
    originWorld: THREE.Vector3,
    wireMesh: THREE.Mesh,
    anchorMesh: THREE.Mesh
  ): void {
    if (!hook.active) {
      wireMesh.visible = false;
      anchorMesh.visible = false;
      return;
    }
    const anchorPos = new THREE.Vector3(...hook.anchor);
    const dist = originWorld.distanceTo(anchorPos);
    if (dist < 0.05) {
      wireMesh.visible = false;
      anchorMesh.visible = false;
      return;
    }
    wireMesh.visible = true;
    wireMesh.position.copy(originWorld);
    wireMesh.lookAt(anchorPos);
    wireMesh.scale.set(1, 1, dist);

    anchorMesh.visible = true;
    anchorMesh.position.copy(anchorPos);
    anchorMesh.rotation.y += 0.08;
  }
}
