import * as THREE from 'three';
import { damp, clamp } from '../utils/MathUtils';
import { PlayerAnimName, PlayerRigAssets } from './HumanoidRigBuilder';

export class PlayerAnimator {
  private mixer: THREE.AnimationMixer;
  private actions: Map<PlayerAnimName, THREE.AnimationAction> = new Map();
  private currentAnim: PlayerAnimName = 'Idle';
  private oneShotTimer = 0;
  private currentBankRoll = 0;
  private currentForwardPitch = 0;

  constructor(private rig: PlayerRigAssets) {
    this.mixer = new THREE.AnimationMixer(this.rig.skinnedMesh);

    for (const [name, clip] of this.rig.animations.entries()) {
      const action = this.mixer.clipAction(clip);
      if (
        name === 'Jump' ||
        name === 'Landing' ||
        name === 'Dodge' ||
        name === 'LightAttack' ||
        name === 'HeavyAttack' ||
        name === 'HitReaction' ||
        name === 'Death'
      ) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }
      this.actions.set(name, action);
    }

    const idle = this.actions.get('Idle')!;
    idle.play();
  }

  public playState(name: PlayerAnimName, fadeDuration = 0.16, forceRestart = false): void {
    if (this.currentAnim === 'Death' && name !== 'Idle') return;
    if (this.currentAnim === name && !forceRestart) return;

    const prevAction = this.actions.get(this.currentAnim);
    const nextAction = this.actions.get(name);
    if (!nextAction) return;

    nextAction.reset();
    nextAction.enabled = true;
    nextAction.setEffectiveTimeScale(1);
    nextAction.setEffectiveWeight(1);

    if (prevAction && prevAction !== nextAction) {
      prevAction.crossFadeTo(nextAction, fadeDuration, false);
    }
    nextAction.play();
    this.currentAnim = name;

    const clip = this.rig.animations.get(name)!;
    if (
      name === 'Jump' ||
      name === 'Landing' ||
      name === 'Dodge' ||
      name === 'LightAttack' ||
      name === 'HeavyAttack' ||
      name === 'HitReaction'
    ) {
      this.oneShotTimer = clip.duration * 0.92;
    } else {
      this.oneShotTimer = 0;
    }
  }

  public getCurrentAnimation(): PlayerAnimName {
    return this.currentAnim;
  }

  public isPlayingOneShot(): boolean {
    return this.oneShotTimer > 0;
  }

  public update(
    dt: number,
    params: {
      grounded: boolean;
      speed: number;
      verticalVel: number;
      lateralAccel: number;
      leftHookAnchor: THREE.Vector3 | null;
      rightHookAnchor: THREE.Vector3 | null;
      isBoosting: boolean;
      bladeDurability: number;
      playerWorldPos: THREE.Vector3;
      playerYaw: number;
    }
  ): void {
    if (this.oneShotTimer > 0) {
      this.oneShotTimer = Math.max(0, this.oneShotTimer - dt);
    }

    // Automatic locomotion state transition when not locked in a one-shot clip
    if (this.oneShotTimer <= 0 && this.currentAnim !== 'Death') {
      const hasL = params.leftHookAnchor !== null;
      const hasR = params.rightHookAnchor !== null;

      if (!params.grounded) {
        if (params.isBoosting) {
          this.playState('Boost', 0.14);
        } else if (hasL && hasR) {
          this.playState(params.speed > 14 ? 'Swing' : 'DualHook', 0.16);
        } else if (hasL) {
          this.playState(params.speed > 16 ? 'Swing' : 'LeftHook', 0.16);
        } else if (hasR) {
          this.playState(params.speed > 16 ? 'Swing' : 'RightHook', 0.16);
        } else if (params.verticalVel < -4.0) {
          this.playState('Fall', 0.2);
        } else {
          this.playState('AirborneIdle', 0.2);
        }
      } else {
        // Grounded locomotion
        if (params.speed < 0.5) {
          this.playState('Idle', 0.18);
        } else if (params.speed < 6.8) {
          this.playState('Walk', 0.15);
        } else if (params.speed < 11.2) {
          this.playState('Run', 0.14);
        } else {
          this.playState('Sprint', 0.12);
        }
      }
    }

    // Advance skeletal keyframe mixer
    this.mixer.update(dt);

    // =========================================================================
    // Procedural Post-Animation Bone Adjustments (Banking, Pitch, Hook Arm Aim, Cape Flutter)
    // =========================================================================
    const targetRoll = clamp(-params.lateralAccel * 0.032, -0.52, 0.52);
    const targetPitch = !params.grounded
      ? clamp(params.speed * 0.012 - params.verticalVel * 0.01, -0.35, 0.55)
      : clamp(params.speed * 0.008, 0, 0.18);

    this.currentBankRoll = damp(this.currentBankRoll, targetRoll, 10, dt);
    this.currentForwardPitch = damp(this.currentForwardPitch, targetPitch, 10, dt);

    const spineBone = this.rig.bonesByName['Spine1'];
    if (spineBone && this.currentAnim !== 'Death') {
      spineBone.rotation.z = this.currentBankRoll * 0.45;
      spineBone.rotation.x = this.currentForwardPitch * 0.35;
    }

    // Procedural Arm Reaction toward Active Grapple Anchor (when not attacking)
    const isAttacking =
      this.currentAnim === 'LightAttack' || this.currentAnim === 'HeavyAttack';

    if (!isAttacking && this.currentAnim !== 'Death') {
      if (params.leftHookAnchor) {
        this.aimArmAtAnchor('LeftShoulder', params.leftHookAnchor, params.playerWorldPos, params.playerYaw, -1);
      }
      if (params.rightHookAnchor) {
        this.aimArmAtAnchor('RightShoulder', params.rightHookAnchor, params.playerWorldPos, params.playerYaw, 1);
      }
    }

    // Dynamic Wind Flutter on CapeMid and CapeTip based on airspeed
    const capeTop = this.rig.bonesByName['CapeTop'];
    const capeMid = this.rig.bonesByName['CapeMid'];
    const capeTip = this.rig.bonesByName['CapeTip'];
    if (capeTop && capeMid && capeTip) {
      const t = performance.now() * 0.012;
      const windFactor = clamp(params.speed / 28.0, 0.05, 1.0);
      capeTop.rotation.x = clamp(windFactor * 0.25, 0, 0.28);
      capeMid.rotation.x = 0.06 + windFactor * 0.18 + Math.sin(t) * 0.08 * windFactor;
      capeTip.rotation.x = 0.04 + windFactor * 0.15 + Math.cos(t * 1.3) * 0.1 * windFactor;
    }

    // Blade length scaling when broken vs intact
    const bladeScaleZ = params.bladeDurability > 0 ? 1.0 : 0.25;
    this.rig.leftBladeMesh.scale.z = bladeScaleZ;
    this.rig.rightBladeMesh.scale.z = bladeScaleZ;

    this.rig.skinnedMesh.skeleton.update();
  }

  private aimArmAtAnchor(
    shoulderBoneName: string,
    anchorWorld: THREE.Vector3,
    playerPos: THREE.Vector3,
    playerYaw: number,
    sideSign: number
  ): void {
    const bone = this.rig.bonesByName[shoulderBoneName];
    if (!bone) return;
    const toAnchor = new THREE.Vector3().subVectors(anchorWorld, playerPos);
    toAnchor.y -= 1.25;
    if (toAnchor.lengthSq() < 0.01) return;
    toAnchor.normalize();

    // Rotate vector into character's local yaw frame
    const cosY = Math.cos(-playerYaw);
    const sinY = Math.sin(-playerYaw);
    const localX = toAnchor.x * cosY - toAnchor.z * sinY;
    const localZ = toAnchor.x * sinY + toAnchor.z * cosY;

    bone.rotation.x = clamp(-toAnchor.y * 0.55, -0.7, 0.5);
    bone.rotation.y = clamp(localX * 0.45, -0.5, 0.5);
    bone.rotation.z = sideSign * clamp(Math.abs(localZ) * 0.25, 0, 0.4);
  }
}
