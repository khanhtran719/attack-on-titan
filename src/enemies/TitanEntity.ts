import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';
import {
  TitanAnimName,
  TitanRigAssets,
  TitanRigBuilder,
  TitanVariant,
  TitanZoneType,
} from './TitanRigBuilder';

export type TitanAIState =
  | 'Idle'
  | 'Patrol'
  | 'Detect'
  | 'Chase'
  | 'Attack'
  | 'Grab'
  | 'Recover'
  | 'Stunned'
  | 'Injured'
  | 'Dead';

export interface TitanHurtboxState {
  zone: TitanZoneType;
  hp: number;
  maxHp: number;
  radius: number;
  worldPosition: THREE.Vector3;
  disabledTimer: number;
}

export class TitanEntity {
  public readonly id: string;
  public readonly variant: TitanVariant;
  public readonly heightMeters: number;
  public readonly rig: TitanRigAssets;
  public readonly position: THREE.Vector3;
  public readonly velocity: THREE.Vector3 = new THREE.Vector3();
  public yaw = 0;

  public aiState: TitanAIState = 'Idle';
  public stateTimer = 0;
  public patrolTarget: THREE.Vector3 = new THREE.Vector3();
  public isDummy = false;

  public hurtboxes: Record<TitanZoneType, TitanHurtboxState>;
  public deathFadeTimer = 0;
  public readyForRemoval = false;
  public attackHitDealtInCurrentSwing = false;
  public grabbedPlayerId: string | null = null;
  public grabHoldTimer = 0;

  private mixer: THREE.AnimationMixer;
  private actions: Map<TitanAnimName, THREE.AnimationAction> = new Map();
  private currentAnim: TitanAnimName = 'Idle';
  private stepSoundAccum = 0;

  constructor(
    id: string,
    variant: TitanVariant,
    spawnPos: THREE.Vector3,
    heightMeters?: number,
    isDummy = false
  ) {
    this.id = id;
    this.variant = variant;
    this.isDummy = isDummy;

    const cfg = GAME_CONFIG.titans[variant];
    this.heightMeters =
      heightMeters ??
      cfg.minHeight + Math.random() * (cfg.maxHeight - cfg.minHeight);

    this.position = spawnPos.clone();
    this.rig = TitanRigBuilder.buildTitanRig(variant, this.heightMeters);
    this.rig.rootGroup.position.copy(this.position);

    const scaleRatio = this.heightMeters / 8.0;

    this.hurtboxes = {
      Nape: {
        zone: 'Nape',
        hp: cfg.napeHp,
        maxHp: cfg.napeHp,
        radius: Math.max(1.35, 1.45 * scaleRatio),
        worldPosition: new THREE.Vector3(),
        disabledTimer: 0,
      },
      Head: {
        zone: 'Head',
        hp: Math.round(cfg.limbHp * 0.8),
        maxHp: Math.round(cfg.limbHp * 0.8),
        radius: Math.max(0.85, 0.95 * scaleRatio),
        worldPosition: new THREE.Vector3(),
        disabledTimer: 0,
      },
      LeftArm: {
        zone: 'LeftArm',
        hp: cfg.limbHp,
        maxHp: cfg.limbHp,
        radius: Math.max(0.8, 0.9 * scaleRatio),
        worldPosition: new THREE.Vector3(),
        disabledTimer: 0,
      },
      RightArm: {
        zone: 'RightArm',
        hp: cfg.limbHp,
        maxHp: cfg.limbHp,
        radius: Math.max(0.8, 0.9 * scaleRatio),
        worldPosition: new THREE.Vector3(),
        disabledTimer: 0,
      },
      LeftLeg: {
        zone: 'LeftLeg',
        hp: cfg.limbHp,
        maxHp: cfg.limbHp,
        radius: Math.max(0.85, 0.98 * scaleRatio),
        worldPosition: new THREE.Vector3(),
        disabledTimer: 0,
      },
      RightLeg: {
        zone: 'RightLeg',
        hp: cfg.limbHp,
        maxHp: cfg.limbHp,
        radius: Math.max(0.85, 0.98 * scaleRatio),
        worldPosition: new THREE.Vector3(),
        disabledTimer: 0,
      },
    };

    this.mixer = new THREE.AnimationMixer(this.rig.skinnedMesh);
    for (const [name, clip] of this.rig.animations.entries()) {
      const action = this.mixer.clipAction(clip);
      if (
        name === 'Attack' ||
        name === 'Grab' ||
        name === 'Stagger' ||
        name === 'Fall' ||
        name === 'Death'
      ) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }
      this.actions.set(name, action);
    }

    this.actions.get('Idle')!.play();
    this.syncHurtboxWorldPositions();
  }

  public playAnimation(name: TitanAnimName, fade = 0.2, force = false): void {
    if (this.currentAnim === 'Death') return;
    if (this.currentAnim === name && !force) return;

    const prev = this.actions.get(this.currentAnim);
    const next = this.actions.get(name);
    if (!next) return;

    next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);

    if (prev && prev !== next) {
      prev.crossFadeTo(next, fade, false);
    }
    next.play();
    this.currentAnim = name;
  }

  public getForwardVector(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
  }

  public getGrabHoldWorldPosition(): THREE.Vector3 {
    const rightArm = this.hurtboxes.RightArm.worldPosition;
    const forward = this.getForwardVector();
    return rightArm
      .clone()
      .addScaledVector(forward, 1.35)
      .add(new THREE.Vector3(0, 0.35, 0));
  }

  public releaseGrabbedPlayer(): string | null {
    const prev = this.grabbedPlayerId;
    this.grabbedPlayerId = null;
    this.grabHoldTimer = 0;
    return prev;
  }

  public isDead(): boolean {
    return this.aiState === 'Dead';
  }

  public areBothArmsDisabled(): boolean {
    return (
      this.hurtboxes.LeftArm.disabledTimer > 0 &&
      this.hurtboxes.RightArm.disabledTimer > 0
    );
  }

  public isAnyLegDisabled(): boolean {
    return (
      this.hurtboxes.LeftLeg.disabledTimer > 0 ||
      this.hurtboxes.RightLeg.disabledTimer > 0
    );
  }

  /**
   * Applies damage to a specific anatomical zone.
   * Returns whether this strike killed the Titan or severed/broke a limb.
   */
  public applyZoneDamage(
    zone: TitanZoneType,
    damage: number
  ): {
    killed: boolean;
    limbBroken: boolean;
    remainingHp: number;
  } {
    if (this.aiState === 'Dead') {
      return { killed: false, limbBroken: false, remainingHp: 0 };
    }

    const box = this.hurtboxes[zone];
    box.hp = Math.max(0, box.hp - damage);

    if (zone === 'Nape') {
      if (box.hp <= 0) {
        this.aiState = 'Dead';
        this.stateTimer = 0;
        this.velocity.set(0, 0, 0);
        this.releaseGrabbedPlayer();
        this.playAnimation('Death', 0.15, true);
        return { killed: true, limbBroken: false, remainingHp: 0 };
      }
      return { killed: false, limbBroken: false, remainingHp: box.hp };
    }

    // Non-nape limb or head hit
    if (box.hp <= 0 && box.disabledTimer <= 0) {
      const cfg = GAME_CONFIG.titans[this.variant];
      if (zone === 'LeftLeg' || zone === 'RightLeg') {
        box.disabledTimer = cfg.injuredDuration;
        this.aiState = 'Injured';
        this.stateTimer = cfg.injuredDuration;
        this.velocity.set(0, 0, 0);
        this.playAnimation('Injured', 0.2, true);
      } else if (zone === 'Head') {
        box.disabledTimer = cfg.stunnedDuration;
        this.aiState = 'Stunned';
        this.stateTimer = cfg.stunnedDuration;
        this.velocity.set(0, 0, 0);
        this.playAnimation('Stagger', 0.15, true);
      } else if (zone === 'LeftArm' || zone === 'RightArm') {
        box.disabledTimer = 15.0;
        // Visually shrink forearm to show severed/crippled state
        const boneName = zone === 'LeftArm' ? 'LeftLowerArm' : 'RightLowerArm';
        const bone = this.rig.bonesByName[boneName];
        if (bone) bone.scale.setScalar(0.35);

        if (this.aiState === 'Attack' || this.aiState === 'Grab') {
          this.aiState = 'Stunned';
          this.stateTimer = 4.0;
          this.playAnimation('Stagger', 0.15, true);
        }
      }
      this.releaseGrabbedPlayer();
      return { killed: false, limbBroken: true, remainingHp: 0 };
    }

    return { killed: false, limbBroken: false, remainingHp: box.hp };
  }

  public update(dt: number, onFootstep?: () => void): void {
    // Regenerate disabled limbs after timer expires
    for (const key of Object.keys(this.hurtboxes) as TitanZoneType[]) {
      const hb = this.hurtboxes[key];
      if (hb.disabledTimer > 0) {
        hb.disabledTimer = Math.max(0, hb.disabledTimer - dt);
        if (hb.disabledTimer <= 0) {
          hb.hp = hb.maxHp;
          if (key === 'LeftArm') {
            this.rig.bonesByName['LeftLowerArm']?.scale.setScalar(1.0);
          } else if (key === 'RightArm') {
            this.rig.bonesByName['RightLowerArm']?.scale.setScalar(1.0);
          }
        }
      }
    }

    if (this.aiState === 'Dead') {
      this.deathFadeTimer += dt;
      if (this.deathFadeTimer > 3.2) {
        this.readyForRemoval = true;
      }
    } else {
      const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      if (horizSpeed > 1.0 && onFootstep) {
        this.stepSoundAccum += horizSpeed * dt;
        const stride = this.heightMeters * 0.42;
        if (this.stepSoundAccum >= stride) {
          this.stepSoundAccum = 0;
          onFootstep();
        }
      }
    }

    this.rig.rootGroup.position.copy(this.position);
    this.rig.rootGroup.rotation.y = this.yaw;

    this.mixer.update(dt);
    this.rig.rootGroup.updateMatrixWorld(true);
    this.syncHurtboxWorldPositions();
  }

  public syncHurtboxWorldPositions(): void {
    for (const zone of Object.keys(this.rig.zoneNodes) as TitanZoneType[]) {
      const node = this.rig.zoneNodes[zone];
      node.getWorldPosition(this.hurtboxes[zone].worldPosition);
    }
  }
}
