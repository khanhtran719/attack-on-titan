import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';
import { TitanEntity } from '../enemies/TitanEntity';
import { TitanZoneType } from '../enemies/TitanRigBuilder';
import {
  calculateStrikeDamage,
  evaluateNapeApproachCos,
  sweptBladeIntersectsHurtbox,
} from '../utils/MathUtils';

export interface CombatHitEvent {
  titan: TitanEntity;
  zone: TitanZoneType;
  damage: number;
  velocityMultiplier: number;
  isCriticalNapeHit: boolean;
  glancedOffFront: boolean;
  killedTitan: boolean;
  limbBroken: boolean;
  impactPoint: THREE.Vector3;
}

const ZONE_CYCLE_ORDER: TitanZoneType[] = [
  'Nape',
  'LeftLeg',
  'RightLeg',
  'LeftArm',
  'RightArm',
  'Head',
];

export class CombatSystem {
  public lockedTitan: TitanEntity | null = null;
  public lockedZone: TitanZoneType = 'Nape';

  private isAttacking = false;
  private isHeavyAttack = false;
  private attackTimer = 0;
  private attackDuration = 0;
  private attackCooldownTimer = 0;
  private hitTargetsInCurrentSwing: Set<string> = new Set();

  // Previous frame blade endpoints for continuous swept-blade collision detection
  private prevLeftHilt = new THREE.Vector3();
  private prevLeftTip = new THREE.Vector3();
  private prevRightHilt = new THREE.Vector3();
  private prevRightTip = new THREE.Vector3();
  private hasPrevBladePositions = false;

  // Hit-stop timer
  public hitStopTimer = 0;

  // Combo state
  public comboCount = 0;
  public comboTimer = 0;

  public cycleTargetLock(
    playerPos: THREE.Vector3,
    cameraForward: THREE.Vector3,
    titans: TitanEntity[]
  ): TitanEntity | null {
    const alive = titans.filter((t) => !t.isDead());
    if (alive.length === 0) {
      this.lockedTitan = null;
      return null;
    }

    // Sort by distance + camera alignment
    alive.sort((a, b) => {
      const da = a.position.distanceTo(playerPos);
      const db = b.position.distanceTo(playerPos);
      const toA = a.position.clone().sub(playerPos).normalize();
      const toB = b.position.clone().sub(playerPos).normalize();
      const scoreA = da - toA.dot(cameraForward) * 25;
      const scoreB = db - toB.dot(cameraForward) * 25;
      return scoreA - scoreB;
    });

    if (!this.lockedTitan || this.lockedTitan.isDead()) {
      this.lockedTitan = alive[0];
      this.lockedZone = 'Nape';
    } else {
      const idx = alive.indexOf(this.lockedTitan);
      if (idx === -1 || idx === alive.length - 1) {
        this.lockedTitan = alive[0];
      } else {
        this.lockedTitan = alive[idx + 1];
      }
      this.lockedZone = 'Nape';
    }

    return this.lockedTitan;
  }

  public cycleTargetZone(delta: number): TitanZoneType {
    const idx = ZONE_CYCLE_ORDER.indexOf(this.lockedZone);
    const nextIdx =
      (idx + (delta > 0 ? 1 : -1) + ZONE_CYCLE_ORDER.length) %
      ZONE_CYCLE_ORDER.length;
    this.lockedZone = ZONE_CYCLE_ORDER[nextIdx];
    return this.lockedZone;
  }

  public canStartAttack(): boolean {
    return !this.isAttacking && this.attackCooldownTimer <= 0;
  }

  /**
   * Starts a Light or Heavy dual-blade attack.
   * Returns an optional lunge velocity vector if striking near a Titan zone.
   */
  public startAttack(
    isHeavy: boolean,
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    titans: TitanEntity[]
  ): { started: boolean; lungeImpulse: THREE.Vector3 | null } {
    if (!this.canStartAttack()) {
      return { started: false, lungeImpulse: null };
    }

    this.isAttacking = true;
    this.isHeavyAttack = isHeavy;
    this.attackTimer = 0;
    this.attackDuration = isHeavy
      ? GAME_CONFIG.combat.heavyAttackDuration
      : GAME_CONFIG.combat.lightAttackDuration;
    this.hitTargetsInCurrentSwing.clear();
    this.hasPrevBladePositions = false;

    // Close-range aerial strike assist lunge toward nearest or locked hurtbox within 8.5m
    let lungeImpulse: THREE.Vector3 | null = null;
    const targetZoneWorld = this.findNearestStrikeZonePos(playerPos, titans);
    if (targetZoneWorld) {
      const toZone = new THREE.Vector3().subVectors(targetZoneWorld, playerPos);
      const dist = toZone.length();
      if (dist > 0.5 && dist <= 8.8) {
        toZone.normalize();
        const currentSpeed = Math.max(18.0, playerVel.length());
        lungeImpulse = toZone.multiplyScalar(currentSpeed * 0.38);
      }
    }

    return { started: true, lungeImpulse };
  }

  private findNearestStrikeZonePos(
    playerPos: THREE.Vector3,
    titans: TitanEntity[]
  ): THREE.Vector3 | null {
    if (this.lockedTitan && !this.lockedTitan.isDead()) {
      const p = this.lockedTitan.hurtboxes[this.lockedZone].worldPosition;
      if (p.distanceTo(playerPos) <= 9.5) {
        return p;
      }
    }

    let nearest: THREE.Vector3 | null = null;
    let bestDist = 9.0;
    for (const t of titans) {
      if (t.isDead()) continue;
      for (const zone of Object.keys(t.hurtboxes) as TitanZoneType[]) {
        const p = t.hurtboxes[zone].worldPosition;
        const d = p.distanceTo(playerPos);
        if (d < bestDist) {
          bestDist = d;
          nearest = p;
        }
      }
    }
    return nearest;
  }

  public isCurrentlyAttacking(): boolean {
    return this.isAttacking;
  }

  public isInActiveAttackFrames(): boolean {
    if (!this.isAttacking || this.attackDuration <= 0) return false;
    const norm = this.attackTimer / this.attackDuration;
    return (
      norm >= GAME_CONFIG.combat.attackActiveStartNorm &&
      norm <= GAME_CONFIG.combat.attackActiveEndNorm
    );
  }

  /**
   * Updates attack timers, samples world-space swept blade segments from the character's
   * left and right hand-mounted swords, and evaluates hurtbox intersections.
   */
  public update(
    dt: number,
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    bladeDurability: number,
    leftHiltWorld: THREE.Vector3,
    leftTipWorld: THREE.Vector3,
    rightHiltWorld: THREE.Vector3,
    rightTipWorld: THREE.Vector3,
    titans: TitanEntity[],
    onHit: (event: CombatHitEvent) => void
  ): void {
    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - dt);
    }

    if (this.comboTimer > 0) {
      this.comboTimer = Math.max(0, this.comboTimer - dt);
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
      }
    }

    if (this.attackCooldownTimer > 0) {
      this.attackCooldownTimer = Math.max(0, this.attackCooldownTimer - dt);
    }

    if (this.lockedTitan && this.lockedTitan.isDead()) {
      this.lockedTitan = null;
    }

    if (!this.isAttacking) {
      this.hasPrevBladePositions = false;
      return;
    }

    this.attackTimer += dt;
    if (this.attackTimer >= this.attackDuration) {
      this.isAttacking = false;
      this.attackCooldownTimer = GAME_CONFIG.combat.attackCooldown;
      this.hasPrevBladePositions = false;
      return;
    }

    // Extend effective tip reach along blade vector to match dual-sword slash arc
    const extendTip = (hilt: THREE.Vector3, tip: THREE.Vector3): THREE.Vector3 => {
      const dir = new THREE.Vector3().subVectors(tip, hilt);
      if (dir.lengthSq() < 1e-5) return tip.clone();
      dir.normalize();
      return hilt.clone().addScaledVector(dir, GAME_CONFIG.combat.bladeReach);
    };

    const curLTip = extendTip(leftHiltWorld, leftTipWorld);
    const curRTip = extendTip(rightHiltWorld, rightTipWorld);

    if (!this.hasPrevBladePositions) {
      this.prevLeftHilt.copy(leftHiltWorld);
      this.prevLeftTip.copy(curLTip);
      this.prevRightHilt.copy(rightHiltWorld);
      this.prevRightTip.copy(curRTip);
      this.hasPrevBladePositions = true;
    }

    if (this.isInActiveAttackFrames()) {
      for (const titan of titans) {
        if (titan.isDead()) continue;

        // Check Nape first if in sweep so a clean rear slash prioritizes the weak point
        const priorityZones: TitanZoneType[] = [
          'Nape',
          this.lockedZone,
          'LeftLeg',
          'RightLeg',
          'LeftArm',
          'RightArm',
          'Head',
        ];
        const uniqueZones = Array.from(new Set(priorityZones));

        for (const zone of uniqueZones) {
          const hitKey = `${titan.id}:${zone}`;
          if (this.hitTargetsInCurrentSwing.has(hitKey)) continue;

          const hb = titan.hurtboxes[zone];
          // Check Left Sword sweep, Right Sword sweep, AND close-range dual-blade spin volume
          const leftHit = sweptBladeIntersectsHurtbox(
            this.prevLeftHilt,
            this.prevLeftTip,
            leftHiltWorld,
            curLTip,
            hb.worldPosition,
            hb.radius
          );
          const rightHit = sweptBladeIntersectsHurtbox(
            this.prevRightHilt,
            this.prevRightTip,
            rightHiltWorld,
            curRTip,
            hb.worldPosition,
            hb.radius
          );
          const spinCenter = new THREE.Vector3(
            playerPos.x,
            playerPos.y + 1.15,
            playerPos.z
          );
          const spinHit =
            spinCenter.distanceTo(hb.worldPosition) <=
            hb.radius + GAME_CONFIG.combat.bladeReach * 0.95;

          if (leftHit || rightHit || spinHit) {
            this.hitTargetsInCurrentSwing.add(hitKey);

            // Prevent hitting multiple zones on the same Titan in a single light swing
            if (!this.isHeavyAttack) {
              for (const z of ZONE_CYCLE_ORDER) {
                this.hitTargetsInCurrentSwing.add(`${titan.id}:${z}`);
              }
            }

            const relVel = new THREE.Vector3().subVectors(
              playerVel,
              titan.velocity
            );
            const relSpeed = relVel.length();

            const napeCos = evaluateNapeApproachCos(
              playerPos,
              titan.position,
              titan.getForwardVector()
            );

            const dmgOut = calculateStrikeDamage({
              isHeavyAttack: this.isHeavyAttack,
              relativeSpeed: relSpeed,
              bladeDurability,
              isNape: zone === 'Nape',
              napeApproachCos: napeCos,
            });

            // If frontal attack clipped the Nape hurtbox, redirect or glance off without killing
            const result = dmgOut.glancedOffFront
              ? {
                  killed: false,
                  limbBroken: false,
                  remainingHp: hb.hp,
                }
              : titan.applyZoneDamage(zone, dmgOut.damage);

            if (!dmgOut.glancedOffFront) {
              this.comboCount++;
              this.comboTimer = GAME_CONFIG.combat.comboResetTime;
              this.hitStopTimer = GAME_CONFIG.combat.hitStopDuration;
            }

            onHit({
              titan,
              zone,
              damage: dmgOut.damage,
              velocityMultiplier: dmgOut.velocityMultiplier,
              isCriticalNapeHit: dmgOut.isCriticalNapeHit,
              glancedOffFront: dmgOut.glancedOffFront,
              killedTitan: result.killed,
              limbBroken: result.limbBroken,
              impactPoint: hb.worldPosition.clone(),
            });
            break;
          }
        }
      }
    }

    this.prevLeftHilt.copy(leftHiltWorld);
    this.prevLeftTip.copy(curLTip);
    this.prevRightHilt.copy(rightHiltWorld);
    this.prevRightTip.copy(curRTip);
  }
}
