import * as THREE from 'three';
import {
  HumanoidRigBuilder,
  PlayerRigAssets,
} from '../animation/HumanoidRigBuilder';
import { PlayerAnimator } from '../animation/PlayerAnimator';
import { AudioManager } from '../audio/AudioManager';
import { CombatSystem } from '../combat/CombatSystem';
import { GAME_CONFIG } from '../config/GameConfig';
import { TitanEntity } from '../enemies/TitanEntity';
import { InputState } from '../input/InputManager';
import { ODMSystem } from '../odm/ODMSystem';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { clamp, lerpAngle, shortestAngleDist } from '../utils/MathUtils';
import { SupplyStation } from '../world/CityBuilder';
import { ActionCamera } from './ActionCamera';

export class PlayerController {
  public readonly rig: PlayerRigAssets;
  public readonly animator: PlayerAnimator;

  public readonly position: THREE.Vector3 = new THREE.Vector3(0, 0.2, 24);
  public readonly velocity: THREE.Vector3 = new THREE.Vector3();
  public yaw = 0;

  public grounded = true;
  public isBoosting = false;

  // Player resources
  public health: number = GAME_CONFIG.player.maxHealth;
  public maxHealth: number = GAME_CONFIG.player.maxHealth;
  public gas: number = GAME_CONFIG.player.maxGas;
  public maxGas: number = GAME_CONFIG.player.maxGas;
  public bladeDurability: number = GAME_CONFIG.player.maxBladeDurability;
  public maxBladeDurability: number = GAME_CONFIG.player.maxBladeDurability;
  public spareBlades: number = GAME_CONFIG.player.maxSpareBlades;
  public maxSpareBlades: number = GAME_CONFIG.player.maxSpareBlades;

  // Dodge / Invulnerability state
  public dodgeTimer = 0;
  public dodgeCooldownTimer = 0;
  public invulnerableTimer = 0;

  private prevVelocity: THREE.Vector3 = new THREE.Vector3();
  private lateralAccel = 0;

  // Stats tracking for mission & training
  public totalGrapplesFired = 0;
  public totalSwingsTime = 0;
  public totalBoostTime = 0;
  public totalDodges = 0;
  public totalPerfectDodges = 0;

  constructor(private scene: THREE.Scene) {
    this.rig = HumanoidRigBuilder.buildPlayerRig();
    this.animator = new PlayerAnimator(this.rig);
    this.scene.add(this.rig.rootGroup);
  }

  public reset(spawnPos: THREE.Vector3, spawnYaw = 0): void {
    this.position.copy(spawnPos);
    this.velocity.set(0, 0, 0);
    this.prevVelocity.set(0, 0, 0);
    this.yaw = spawnYaw;
    this.grounded = true;
    this.isBoosting = false;

    this.health = this.maxHealth;
    this.gas = this.maxGas;
    this.bladeDurability = this.maxBladeDurability;
    this.spareBlades = this.maxSpareBlades;

    this.dodgeTimer = 0;
    this.dodgeCooldownTimer = 0;
    this.invulnerableTimer = 0;
    this.lateralAccel = 0;

    this.rig.rootGroup.position.copy(this.position);
    this.rig.rootGroup.rotation.set(0, this.yaw, 0);
    this.animator.playState('Idle', 0.05, true);
  }

  public isDead(): boolean {
    return this.health <= 0;
  }

  public isInPerfectDodgeWindow(): boolean {
    return (
      this.dodgeTimer >
      GAME_CONFIG.player.dodgeDuration - GAME_CONFIG.player.perfectDodgeWindow
    );
  }

  public takeDamage(
    amount: number,
    knockbackDir: THREE.Vector3,
    odm: ODMSystem,
    audio: AudioManager,
    onPerfectDodge?: () => void
  ): boolean {
    if (this.isDead()) return false;

    if (this.isInPerfectDodgeWindow()) {
      this.totalPerfectDodges++;
      this.invulnerableTimer = 0.7;
      onPerfectDodge?.();
      return false;
    }

    if (this.dodgeTimer > 0 || this.invulnerableTimer > 0) {
      return false;
    }

    this.health = Math.max(0, this.health - amount);
    this.invulnerableTimer = 0.85;
    this.velocity.copy(knockbackDir.clone().normalize().multiplyScalar(14));
    this.velocity.y = 7.5;
    this.grounded = false;

    if (this.health <= 0) {
      // Quality Requirement: If player dies while swinging, cleanly release all ODM hooks
      odm.releaseAll();
      this.isBoosting = false;
      this.animator.playState('Death', 0.12, true);
      audio.playBladeImpact(false, false);
    } else {
      this.animator.playState('HitReaction', 0.1, true);
      audio.playBladeImpact(false, false);
    }

    return true;
  }

  public consumeBladeOnHit(glanced: boolean): void {
    const loss = glanced
      ? GAME_CONFIG.combat.bladeDurabilityLossHardHit
      : GAME_CONFIG.combat.bladeDurabilityLossPerHit;
    this.bladeDurability = Math.max(0, this.bladeDurability - loss);
  }

  /**
   * Handles R key: full resupply if near a Supply Depot, or quick blade swap if spare blades remain.
   */
  public tryResupplyOrReloadBlades(
    supplyStations: SupplyStation[],
    audio: AudioManager
  ): { resuppliedAtStation: boolean; reloadedBlades: boolean } {
    for (const station of supplyStations) {
      if (
        this.position.distanceTo(station.position) <=
        GAME_CONFIG.world.resupplyRange
      ) {
        this.gas = this.maxGas;
        this.bladeDurability = this.maxBladeDurability;
        this.spareBlades = this.maxSpareBlades;
        this.health = Math.min(this.maxHealth, this.health + 45);
        audio.playResupply();
        return { resuppliedAtStation: true, reloadedBlades: true };
      }
    }

    if (
      this.bladeDurability < this.maxBladeDurability &&
      this.spareBlades > 0
    ) {
      this.spareBlades--;
      this.bladeDurability = this.maxBladeDurability;
      audio.playResupply();
      return { resuppliedAtStation: false, reloadedBlades: true };
    }

    return { resuppliedAtStation: false, reloadedBlades: false };
  }

  public stepPhysics(
    dt: number,
    input: InputState,
    actionCam: ActionCamera,
    physics: PhysicsWorld,
    odm: ODMSystem,
    combat: CombatSystem,
    titans: TitanEntity[],
    audio: AudioManager,
    onLandingImpact?: (fallSpeed: number) => void
  ): void {
    if (this.dodgeTimer > 0) this.dodgeTimer = Math.max(0, this.dodgeTimer - dt);
    if (this.dodgeCooldownTimer > 0) {
      this.dodgeCooldownTimer = Math.max(0, this.dodgeCooldownTimer - dt);
    }
    if (this.invulnerableTimer > 0) {
      this.invulnerableTimer = Math.max(0, this.invulnerableTimer - dt);
    }

    if (this.isDead()) {
      // Apply gravity so character falls to ground if killed mid-air
      this.velocity.y += GAME_CONFIG.physics.gravity * dt;
      this.velocity.x *= 0.92;
      this.velocity.z *= 0.92;
      const moveRes = physics.moveCharacter(
        this.position,
        this.velocity.clone().multiplyScalar(dt),
        false
      );
      this.position.copy(moveRes.footPosition);
      this.grounded = moveRes.grounded;
      if (this.grounded) {
        this.velocity.set(0, 0, 0);
      }
      return;
    }

    // Compute camera-relative directional vectors
    const camFlatForward = actionCam.getFlatForwardVector();
    const camRight = actionCam.getRightVector();
    const camAimDir = actionCam.getForwardVector();
    const camOrigin = actionCam.camera.position;

    const moveInputDir = new THREE.Vector3()
      .addScaledVector(camFlatForward, input.moveForward)
      .addScaledVector(camRight, input.moveRight);
    if (moveInputDir.lengthSq() > 1.0) {
      moveInputDir.normalize();
    }

    // =========================================================================
    // 1. Handle Left & Right Grappling Hooks (Independent Fire & Release)
    // =========================================================================
    if (input.leftGrappleJustPressed && this.gas > 1.0) {
      const fired = odm.tryFireHook(
        'left',
        camOrigin,
        camAimDir,
        camRight,
        this.position,
        titans,
        combat.lockedTitan,
        combat.lockedZone
      );
      if (fired) {
        this.totalGrapplesFired++;
        this.grounded = false;
        if (this.velocity.y < 3.5) this.velocity.y += 3.5;
        audio.playHookFire('left');
        audio.playHookLatch();
      }
    } else if (!input.leftGrappleHeld && odm.leftHook.active) {
      odm.releaseHook('left');
    }

    if (input.rightGrappleJustPressed && this.gas > 1.0) {
      const fired = odm.tryFireHook(
        'right',
        camOrigin,
        camAimDir,
        camRight,
        this.position,
        titans,
        combat.lockedTitan,
        combat.lockedZone
      );
      if (fired) {
        this.totalGrapplesFired++;
        this.grounded = false;
        if (this.velocity.y < 3.5) this.velocity.y += 3.5;
        audio.playHookFire('right');
        audio.playHookLatch();
      }
    } else if (!input.rightGrappleHeld && odm.rightHook.active) {
      odm.releaseHook('right');
    }

    // Out of gas detaches active hooks
    if (this.gas <= 0 && odm.isAnyHookActive()) {
      odm.releaseAll();
    }

    // =========================================================================
    // 2. Dodge Action (Q)
    // =========================================================================
    if (
      input.dodgeJustPressed &&
      this.dodgeCooldownTimer <= 0 &&
      this.gas >= 4.0
    ) {
      this.dodgeTimer = GAME_CONFIG.player.dodgeDuration;
      this.dodgeCooldownTimer = GAME_CONFIG.player.dodgeCooldown;
      this.gas = Math.max(0, this.gas - 4.0);
      this.totalDodges++;

      const dodgeDir =
        moveInputDir.lengthSq() > 0.05 ? moveInputDir.clone() : camFlatForward;
      this.velocity.copy(
        dodgeDir.multiplyScalar(GAME_CONFIG.player.dodgeImpulse)
      );
      if (!this.grounded) {
        this.velocity.y = Math.max(this.velocity.y, 4.0);
      }
      this.animator.playState('Dodge', 0.08, true);
      audio.playGasBurst();
    }

    // =========================================================================
    // 3. Jump Action (Space)
    // =========================================================================
    if (input.jumpPressed) {
      if (this.grounded) {
        this.grounded = false;
        this.velocity.y = GAME_CONFIG.player.jumpVelocity;
        this.animator.playState('Jump', 0.1, true);
      } else if (odm.isAnyHookActive()) {
        // Vault upwards while releasing or slackening hooks slightly
        this.velocity.y = Math.max(
          this.velocity.y + 6.5,
          GAME_CONFIG.player.jumpVelocity
        );
      }
    }

    // =========================================================================
    // 4. Gas Boost Propulsion (Shift)
    // =========================================================================
    const wantsBoost = input.boostHeld && this.gas > 0.5;
    this.isBoosting = wantsBoost;

    if (this.isBoosting) {
      this.gas = Math.max(
        0,
        this.gas - GAME_CONFIG.odm.gasConsumptionBoostPerSec * dt
      );
      this.totalBoostTime += dt;
      audio.playGasBurst();

      if (!this.grounded || odm.isAnyHookActive()) {
        // Blend boost impulse between camera aim, steering input, and active hook pull
        const boostDir = camAimDir.clone();
        if (moveInputDir.lengthSq() > 0.05) {
          boostDir.lerp(moveInputDir, 0.35).normalize();
        }
        if (boostDir.y < 0.08 && this.position.y < 5.0) {
          boostDir.y = 0.15;
          boostDir.normalize();
        }
        this.velocity.addScaledVector(
          boostDir,
          GAME_CONFIG.odm.gasBoostAccel * dt
        );
      }
    }

    // =========================================================================
    // 5. Dual Sword Attack Trigger (F)
    // =========================================================================
    if (input.attackJustPressed && combat.canStartAttack()) {
      const isHeavy =
        this.isBoosting ||
        (!this.grounded && this.velocity.length() > 22.0);
      const startRes = combat.startAttack(
        isHeavy,
        this.position,
        this.velocity,
        titans
      );
      if (startRes.started) {
        if (startRes.lungeImpulse) {
          this.velocity.add(startRes.lungeImpulse);
          this.grounded = false;
        }
        this.animator.playState(
          isHeavy ? 'HeavyAttack' : 'LightAttack',
          0.08,
          true
        );
        audio.playSwordSlash(isHeavy);
      }
    }

    // =========================================================================
    // 6. Locomotion & ODM Swing Physics Integration
    // =========================================================================
    const hooked = odm.isAnyHookActive();

    if (hooked) {
      this.grounded = false;
      this.totalSwingsTime += dt;
      this.gas = Math.max(
        0,
        this.gas - GAME_CONFIG.odm.gasConsumptionReelPerSec * dt
      );

      // Apply gravity scaled while suspended on wires
      this.velocity.y +=
        GAME_CONFIG.physics.gravity *
        GAME_CONFIG.physics.hookedGravityScale *
        dt;

      // Solve single or dual rope constraints & momentum conservation
      const ropeSolved = odm.stepPhysics(
        dt,
        this.position,
        this.velocity,
        moveInputDir,
        this.isBoosting,
        titans
      );
      this.position.copy(ropeSolved.newPosition);
      this.velocity.copy(ropeSolved.newVelocity);

      // Subtle aerodynamic drag
      this.velocity.multiplyScalar(1 - GAME_CONFIG.physics.airDrag * dt * 12);
    } else if (!this.grounded) {
      // Free-flight airborne trajectory (preserves inertia when hooks are released!)
      this.velocity.y += GAME_CONFIG.physics.gravity * dt;

      if (moveInputDir.lengthSq() > 0.01) {
        this.velocity.addScaledVector(
          moveInputDir,
          GAME_CONFIG.player.airControlAccel * dt
        );
      }

      this.velocity.multiplyScalar(1 - GAME_CONFIG.physics.airDrag * dt * 15);
    } else {
      // Grounded movement
      this.gas = Math.min(
        this.maxGas,
        this.gas + GAME_CONFIG.odm.gasPassiveRegenGroundedPerSec * dt
      );

      if (this.dodgeTimer <= 0) {
        const targetSpeed = this.isBoosting
          ? GAME_CONFIG.player.sprintSpeed
          : GAME_CONFIG.player.runSpeed;
        const desiredVelX = moveInputDir.x * targetSpeed;
        const desiredVelZ = moveInputDir.z * targetSpeed;

        const blend = clamp(GAME_CONFIG.physics.groundFriction * dt, 0, 1);
        this.velocity.x += (desiredVelX - this.velocity.x) * blend;
        this.velocity.z += (desiredVelZ - this.velocity.z) * blend;
      }
      if (this.velocity.y < 0) {
        this.velocity.y = -1.5;
      }
    }

    // Clamp terminal velocity
    const totalSpeed = this.velocity.length();
    if (totalSpeed > GAME_CONFIG.physics.terminalVelocity) {
      this.velocity.multiplyScalar(
        GAME_CONFIG.physics.terminalVelocity / totalSpeed
      );
    }

    // Move character capsule through Rapier world
    const wasGrounded = this.grounded;
    const preFallVelY = this.velocity.y;
    const desiredDelta = this.velocity.clone().multiplyScalar(dt);

    const moveRes = physics.moveCharacter(
      this.position,
      desiredDelta,
      hooked || !this.grounded
    );

    this.position.copy(moveRes.footPosition);

    // Handle wall sliding at high speed without getting stuck
    if (moveRes.hitWall && moveRes.wallNormal) {
      const intoWall = this.velocity.dot(moveRes.wallNormal);
      if (intoWall < 0) {
        this.velocity.addScaledVector(moveRes.wallNormal, -intoWall);
      }
    }

    // Detect landing transition
    if (!hooked && moveRes.grounded && this.velocity.y <= 0.5) {
      if (!wasGrounded && preFallVelY < -9.5) {
        this.animator.playState('Landing', 0.08, true);
        onLandingImpact?.(Math.abs(preFallVelY));
      }
      this.grounded = true;
      this.velocity.y = 0;
    } else {
      this.grounded = false;
    }

    // =========================================================================
    // 7. Character Facing Orientation & Banking Calculation
    // =========================================================================
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (horizSpeed > 0.8) {
      const velYaw = Math.atan2(this.velocity.x, this.velocity.z);
      const yawRate = !this.grounded ? 12.0 : 14.0;
      const prevYaw = this.yaw;
      this.yaw = lerpAngle(this.yaw, velYaw, yawRate * dt);
      const yawVel = shortestAngleDist(prevYaw, this.yaw) / Math.max(0.001, dt);
      this.lateralAccel = yawVel * horizSpeed * 0.15;
    } else {
      this.lateralAccel = 0;
    }

    this.rig.rootGroup.position.copy(this.position);
    this.rig.rootGroup.rotation.y = this.yaw;
    this.prevVelocity.copy(this.velocity);
  }

  public updateVisuals(dt: number, odm: ODMSystem): void {
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);

    this.animator.update(dt, {
      grounded: this.grounded,
      speed: horizSpeed,
      verticalVel: this.velocity.y,
      lateralAccel: this.lateralAccel,
      leftHookAnchor: odm.leftHook.active ? odm.leftHook.anchorPos : null,
      rightHookAnchor: odm.rightHook.active ? odm.rightHook.anchorPos : null,
      isBoosting: this.isBoosting,
      bladeDurability: this.bladeDurability,
      playerWorldPos: this.position,
      playerYaw: this.yaw,
    });

    this.rig.rootGroup.updateMatrixWorld(true);

    // Update ODM 3D wire meshes from hip winch nodes to world anchors
    const leftWinchWorld = new THREE.Vector3();
    const rightWinchWorld = new THREE.Vector3();
    this.rig.leftWinchNode.getWorldPosition(leftWinchWorld);
    this.rig.rightWinchNode.getWorldPosition(rightWinchWorld);
    odm.updateVisualWires(leftWinchWorld, rightWinchWorld);
  }
}
