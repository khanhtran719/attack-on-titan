import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';
import { TitanEntity } from '../enemies/TitanEntity';
import { lerpAngle, shortestAngleDist } from '../utils/MathUtils';

export interface TitanAttackEvent {
  titan: TitanEntity;
  type: 'melee' | 'grab';
  damage: number;
  impactPoint: THREE.Vector3;
  radius: number;
}

export class TitanAI {
  public static updateTitanAI(
    titan: TitanEntity,
    dt: number,
    playerPos: THREE.Vector3,
    playerIsBoostingOrGrappling: boolean,
    patrolWaypoints: THREE.Vector3[],
    staticBoxes: ReadonlyArray<{ box: THREE.Box3 }>,
    onRoar?: (titan: TitanEntity) => void,
    onAttackImpact?: (event: TitanAttackEvent) => void
  ): void {
    if (titan.aiState === 'Dead') {
      titan.velocity.set(0, 0, 0);
      return;
    }

    // Training dummy Titan stands alert and slowly turns without chasing aggressively
    if (titan.isDummy) {
      titan.velocity.set(0, 0, 0);
      if (titan.aiState === 'Injured') {
        titan.stateTimer -= dt;
        if (titan.stateTimer <= 0) {
          titan.aiState = 'Idle';
          titan.playAnimation('Idle');
        }
      } else if (titan.aiState === 'Stunned') {
        titan.stateTimer -= dt;
        if (titan.stateTimer <= 0) {
          titan.aiState = 'Idle';
          titan.playAnimation('Idle');
        }
      } else {
        titan.playAnimation('Idle');
      }
      return;
    }

    const cfg = GAME_CONFIG.titans[titan.variant];
    const toPlayer = new THREE.Vector3(
      playerPos.x - titan.position.x,
      0,
      playerPos.z - titan.position.z
    );
    const flatDist = toPlayer.length();
    const dirToPlayer =
      flatDist > 0.001
        ? toPlayer.clone().divideScalar(flatDist)
        : new THREE.Vector3(0, 0, 1);

    const forward = titan.getForwardVector();
    const fovDot = forward.dot(dirToPlayer);
    const effectiveDetectRange = playerIsBoostingOrGrappling
      ? cfg.detectRange * 1.22
      : cfg.detectRange;

    const canSeePlayer =
      flatDist <= effectiveDetectRange &&
      (fovDot >= cfg.fovCos || flatDist < 22.0);

    switch (titan.aiState) {
      case 'Idle': {
        titan.velocity.set(0, 0, 0);
        titan.playAnimation('Idle');
        titan.stateTimer += dt;

        if (canSeePlayer) {
          this.enterState(titan, 'Detect', 0.65);
          onRoar?.(titan);
          return;
        }

        if (titan.stateTimer >= 2.2) {
          this.pickNextPatrolWaypoint(titan, patrolWaypoints);
          this.enterState(titan, 'Patrol', 8.0);
        }
        break;
      }

      case 'Patrol': {
        if (canSeePlayer) {
          this.enterState(titan, 'Detect', 0.65);
          onRoar?.(titan);
          return;
        }

        const toWp = new THREE.Vector3(
          titan.patrolTarget.x - titan.position.x,
          0,
          titan.patrolTarget.z - titan.position.z
        );
        const wpDist = toWp.length();
        titan.stateTimer -= dt;

        if (wpDist < 4.0 || titan.stateTimer <= 0) {
          this.enterState(titan, 'Idle', 0);
          return;
        }

        toWp.normalize();
        this.steerAndMove(titan, toWp, cfg.walkSpeed, cfg.turnSpeed * 0.75, dt, staticBoxes);
        titan.playAnimation('Walk');
        break;
      }

      case 'Detect': {
        titan.velocity.set(0, 0, 0);
        const desiredYaw = Math.atan2(dirToPlayer.x, dirToPlayer.z);
        titan.yaw = lerpAngle(titan.yaw, desiredYaw, cfg.turnSpeed * 1.4 * dt);
        titan.playAnimation('Turn');

        titan.stateTimer -= dt;
        if (titan.stateTimer <= 0) {
          this.enterState(titan, 'Chase', 0);
        }
        break;
      }

      case 'Chase': {
        if (flatDist > effectiveDetectRange * 1.45) {
          this.enterState(titan, 'Patrol', 6.0);
          return;
        }

        // Check if within melee or anti-air grab range
        const playerRelHeight = playerPos.y - titan.position.y;
        const canAttackArms = !titan.areBothArmsDisabled();

        if (canAttackArms && flatDist <= cfg.attackRange) {
          // If player is airborne near upper torso/head height, attempt Anti-Air Grab!
          if (
            playerRelHeight > titan.heightMeters * 0.42 &&
            playerRelHeight < titan.heightMeters * 1.18
          ) {
            titan.attackHitDealtInCurrentSwing = false;
            this.enterState(titan, 'Grab', 1.15);
            titan.playAnimation('Grab', 0.14, true);
            return;
          }

          // Otherwise perform ground/low-air Melee Sweep Attack
          if (playerRelHeight <= titan.heightMeters * 0.75) {
            titan.attackHitDealtInCurrentSwing = false;
            this.enterState(titan, 'Attack', 1.25);
            titan.playAnimation('Attack', 0.15, true);
            return;
          }
        }

        // Abnormal Titan weaves laterally as it sprints!
        const moveDir = dirToPlayer.clone();
        if (titan.variant === 'abnormal' && flatDist > 10) {
          const weave = Math.sin(performance.now() * 0.0045 + titan.position.x * 0.1) * 0.42;
          const perp = new THREE.Vector3(-moveDir.z, 0, moveDir.x);
          moveDir.addScaledVector(perp, weave).normalize();
        }

        // Injured legs slow chase speed if one leg is still recovering
        const legSpeedScale = titan.isAnyLegDisabled() ? 0.55 : 1.0;
        const chaseSpeed = cfg.chaseSpeed * legSpeedScale;

        this.steerAndMove(titan, moveDir, chaseSpeed, cfg.turnSpeed, dt, staticBoxes);
        titan.playAnimation(chaseSpeed > 5.2 ? 'Run' : 'Walk');
        break;
      }

      case 'Attack': {
        titan.velocity.set(0, 0, 0);
        // Track player slightly during windup
        if (titan.stateTimer > 0.65) {
          const desiredYaw = Math.atan2(dirToPlayer.x, dirToPlayer.z);
          titan.yaw = lerpAngle(titan.yaw, desiredYaw, cfg.turnSpeed * 0.8 * dt);
        }

        // Trigger impact check at apex of swing (when stateTimer drops below 0.55s)
        if (!titan.attackHitDealtInCurrentSwing && titan.stateTimer <= 0.58 && titan.stateTimer >= 0.3) {
          titan.attackHitDealtInCurrentSwing = true;
          const forwardHit = titan.position
            .clone()
            .addScaledVector(titan.getForwardVector(), cfg.attackRange * 0.65);
          forwardHit.y += titan.heightMeters * 0.35;

          onAttackImpact?.({
            titan,
            type: 'melee',
            damage: cfg.attackDamage,
            impactPoint: forwardHit,
            radius: cfg.attackRange * 0.72,
          });
        }

        titan.stateTimer -= dt;
        if (titan.stateTimer <= 0) {
          this.enterState(titan, 'Recover', 0.85);
          titan.playAnimation('Idle', 0.2);
        }
        break;
      }

      case 'Grab': {
        titan.velocity.set(0, 0, 0);
        if (titan.stateTimer > 0.55) {
          const desiredYaw = Math.atan2(dirToPlayer.x, dirToPlayer.z);
          titan.yaw = lerpAngle(titan.yaw, desiredYaw, cfg.turnSpeed * 1.1 * dt);
        }

        if (!titan.attackHitDealtInCurrentSwing && titan.stateTimer <= 0.52 && titan.stateTimer >= 0.25) {
          titan.attackHitDealtInCurrentSwing = true;
          const grabPoint = titan.position
            .clone()
            .addScaledVector(titan.getForwardVector(), cfg.attackRange * 0.55);
          grabPoint.y += titan.heightMeters * 0.76;

          onAttackImpact?.({
            titan,
            type: 'grab',
            damage: cfg.grabDamage,
            impactPoint: grabPoint,
            radius: cfg.attackRange * 0.62,
          });
        }

        titan.stateTimer -= dt;
        if (titan.stateTimer <= 0) {
          this.enterState(titan, 'Recover', 1.0);
          titan.playAnimation('Idle', 0.2);
        }
        break;
      }

      case 'Recover': {
        titan.velocity.set(0, 0, 0);
        titan.stateTimer -= dt;
        if (titan.stateTimer <= 0) {
          this.enterState(titan, 'Chase', 0);
        }
        break;
      }

      case 'Stunned': {
        titan.velocity.set(0, 0, 0);
        titan.playAnimation('Stagger');
        titan.stateTimer -= dt;
        if (titan.stateTimer <= 0) {
          this.enterState(titan, 'Chase', 0);
        }
        break;
      }

      case 'Injured': {
        // Kneeling helplessly while Achilles tendon regenerates
        titan.velocity.set(0, 0, 0);
        titan.playAnimation('Injured');
        titan.stateTimer -= dt;
        if (titan.stateTimer <= 0) {
          this.enterState(titan, 'Chase', 0);
        }
        break;
      }
    }
  }

  private static enterState(
    titan: TitanEntity,
    next: TitanEntity['aiState'],
    duration: number
  ): void {
    titan.aiState = next;
    titan.stateTimer = duration;
  }

  private static pickNextPatrolWaypoint(
    titan: TitanEntity,
    waypoints: THREE.Vector3[]
  ): void {
    if (waypoints.length === 0) {
      titan.patrolTarget.set(
        (Math.random() - 0.5) * 160,
        0,
        (Math.random() - 0.5) * 160
      );
      return;
    }
    const idx = Math.floor(Math.random() * waypoints.length);
    titan.patrolTarget.copy(waypoints[idx]);
  }

  private static steerAndMove(
    titan: TitanEntity,
    desiredDir: THREE.Vector3,
    speed: number,
    turnSpeed: number,
    dt: number,
    staticBoxes: ReadonlyArray<{ box: THREE.Box3 }>
  ): void {
    // Simple whisker obstacle avoidance around city blocks
    let steerDir = desiredDir.clone();
    const probeDist = titan.heightMeters * 0.45 + 3.5;
    const probePoint = titan.position.clone().addScaledVector(steerDir, probeDist);
    probePoint.y = 2.0;

    for (const item of staticBoxes) {
      if (item.box.containsPoint(probePoint)) {
        // Deflect perpendicular around building
        const center = new THREE.Vector3();
        item.box.getCenter(center);
        const away = new THREE.Vector3(
          probePoint.x - center.x,
          0,
          probePoint.z - center.z
        ).normalize();
        steerDir.addScaledVector(away, 1.5).normalize();
        break;
      }
    }

    const desiredYaw = Math.atan2(steerDir.x, steerDir.z);
    const angleDiff = Math.abs(shortestAngleDist(titan.yaw, desiredYaw));
    titan.yaw = lerpAngle(titan.yaw, desiredYaw, turnSpeed * dt);

    // Slow forward translation if executing a sharp turn
    const turnSlowdown = angleDiff > 1.1 ? 0.35 : 1.0;
    const forward = titan.getForwardVector();
    titan.velocity.set(
      forward.x * speed * turnSlowdown,
      0,
      forward.z * speed * turnSlowdown
    );

    const nextPos = titan.position.clone().addScaledVector(titan.velocity, dt);
    const halfCity = GAME_CONFIG.world.citySize * 0.5 - 8;
    nextPos.x = Math.max(-halfCity, Math.min(halfCity, nextPos.x));
    nextPos.z = Math.max(-halfCity, Math.min(halfCity, nextPos.z));

    // Prevent walking inside building footprints
    const bodyProbe = new THREE.Vector3(nextPos.x, 2.0, nextPos.z);
    let blocked = false;
    for (const item of staticBoxes) {
      if (item.box.containsPoint(bodyProbe)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      titan.position.copy(nextPos);
    }
  }
}
