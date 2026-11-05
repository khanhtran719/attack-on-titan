import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';
import { TitanAIState } from '../enemies/TitanEntity';
import {
  TitanAnimName,
  TitanVariant,
  TitanZoneType,
} from '../enemies/TitanRigBuilder';
import { lerpAngle, shortestAngleDist } from '../utils/MathUtils';
import { NetTitanHurtbox, NetTitanState } from './Protocol';

export interface ServerPlayerTarget {
  id: string;
  position: THREE.Vector3;
  isBoostingOrHooked: boolean;
  isAlive: boolean;
}

export interface ServerTitanAttackHit {
  titan: ServerTitan;
  type: 'melee' | 'grab';
  damage: number;
  impactPoint: THREE.Vector3;
  radius: number;
}

export interface TitanHistoryEntry {
  timeMs: number;
  position: THREE.Vector3;
  yaw: number;
  hurtboxPositions: Record<TitanZoneType, THREE.Vector3>;
}

const ZONE_KEYS: TitanZoneType[] = [
  'Nape',
  'Head',
  'LeftArm',
  'RightArm',
  'LeftLeg',
  'RightLeg',
];

export class ServerTitan {
  public readonly id: string;
  public readonly variant: TitanVariant;
  public readonly heightMeters: number;
  public readonly position: THREE.Vector3;
  public readonly velocity: THREE.Vector3 = new THREE.Vector3();
  public yaw = 0;

  public aiState: TitanAIState = 'Idle';
  public anim: TitanAnimName = 'Idle';
  public stateTimer = 0;
  public patrolTarget: THREE.Vector3 = new THREE.Vector3();
  public targetPlayerId: string | null = null;
  public attackHitDealtInCurrentSwing = false;
  public deathFadeTimer = 0;
  public readyForRemoval = false;

  public hurtboxes: Record<
    TitanZoneType,
    {
      hp: number;
      maxHp: number;
      radius: number;
      worldPosition: THREE.Vector3;
      disabledTimer: number;
    }
  >;

  public aggroByPlayer: Map<string, number> = new Map();
  public damageContributors: Map<string, number> = new Map();
  public history: TitanHistoryEntry[] = [];

  constructor(
    id: string,
    variant: TitanVariant,
    spawnPos: THREE.Vector3,
    heightMeters?: number
  ) {
    this.id = id;
    this.variant = variant;
    const cfg = GAME_CONFIG.titans[variant];
    this.heightMeters =
      heightMeters ??
      cfg.minHeight + Math.random() * (cfg.maxHeight - cfg.minHeight);
    this.position = spawnPos.clone();

    const scaleRatio = this.heightMeters / 8.0;
    this.hurtboxes = {
      Nape: {
        hp: cfg.napeHp,
        maxHp: cfg.napeHp,
        radius: Math.max(1.35, 1.45 * scaleRatio),
        worldPosition: new THREE.Vector3(),
        disabledTimer: 0,
      },
      Head: {
        hp: Math.round(cfg.limbHp * 0.8),
        maxHp: Math.round(cfg.limbHp * 0.8),
        radius: Math.max(0.85, 0.95 * scaleRatio),
        worldPosition: new THREE.Vector3(),
        disabledTimer: 0,
      },
      LeftArm: {
        hp: cfg.limbHp,
        maxHp: cfg.limbHp,
        radius: Math.max(0.8, 0.9 * scaleRatio),
        worldPosition: new THREE.Vector3(),
        disabledTimer: 0,
      },
      RightArm: {
        hp: cfg.limbHp,
        maxHp: cfg.limbHp,
        radius: Math.max(0.8, 0.9 * scaleRatio),
        worldPosition: new THREE.Vector3(),
        disabledTimer: 0,
      },
      LeftLeg: {
        hp: cfg.limbHp,
        maxHp: cfg.limbHp,
        radius: Math.max(0.85, 0.98 * scaleRatio),
        worldPosition: new THREE.Vector3(),
        disabledTimer: 0,
      },
      RightLeg: {
        hp: cfg.limbHp,
        maxHp: cfg.limbHp,
        radius: Math.max(0.85, 0.98 * scaleRatio),
        worldPosition: new THREE.Vector3(),
        disabledTimer: 0,
      },
    };

    this.syncHurtboxWorldPositions();
  }

  public isDead(): boolean {
    return this.aiState === 'Dead';
  }

  public getForwardVector(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
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
   * Computes exact bone-local world positions matching TitanRigBuilder's skeleton proportions.
   */
  public syncHurtboxWorldPositions(): void {
    const s = this.heightMeters / 2.0; // Base rig is 2.0m tall
    const bulk =
      this.variant === 'large'
        ? 1.24
        : this.variant === 'abnormal'
          ? 0.94
          : 1.05;

    // When Injured (kneeling/hunched), upper body drops slightly and leans forward (+Z)
    const isInjured = this.aiState === 'Injured';
    const yScale = isInjured ? 0.78 : 1.0;
    const forwardLean = isInjured ? 0.14 : 0.0;

    const localOffsets: Record<TitanZoneType, [number, number, number]> = {
      Nape: [0, 1.76 * yScale, (-0.12 * bulk) + forwardLean],
      Head: [0, 1.88 * yScale, 0.1 + forwardLean * 1.2],
      LeftArm: [-0.28, 1.24 * yScale, forwardLean * 0.5],
      RightArm: [0.28, 1.24 * yScale, forwardLean * 0.5],
      LeftLeg: [-0.14, 0.26, -0.03],
      RightLeg: [0.14, 0.26, -0.03],
    };

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);

    for (const zone of ZONE_KEYS) {
      const [lx, ly, lz] = localOffsets[zone];
      const sx = lx * s;
      const sy = ly * s;
      const sz = lz * s;
      const wx = this.position.x + sx * cosY + sz * sinY;
      const wy = this.position.y + sy;
      const wz = this.position.z - sx * sinY + sz * cosY;
      this.hurtboxes[zone].worldPosition.set(wx, wy, wz);
    }
  }

  public recordHistory(nowMs: number): void {
    const snap: Record<TitanZoneType, THREE.Vector3> = {
      Nape: this.hurtboxes.Nape.worldPosition.clone(),
      Head: this.hurtboxes.Head.worldPosition.clone(),
      LeftArm: this.hurtboxes.LeftArm.worldPosition.clone(),
      RightArm: this.hurtboxes.RightArm.worldPosition.clone(),
      LeftLeg: this.hurtboxes.LeftLeg.worldPosition.clone(),
      RightLeg: this.hurtboxes.RightLeg.worldPosition.clone(),
    };
    this.history.push({
      timeMs: nowMs,
      position: this.position.clone(),
      yaw: this.yaw,
      hurtboxPositions: snap,
    });
    if (this.history.length > 24) {
      this.history.shift();
    }
  }

  /**
   * Retrieves the Titan's state at a bounded historical timestamp (clamped to <= 200ms rewind)
   * for fair server-side lag compensation.
   */
  public getHistoricalState(
    nowMs: number,
    rewindMs: number
  ): {
    position: THREE.Vector3;
    yaw: number;
    hurtboxPositions: Record<TitanZoneType, THREE.Vector3>;
  } {
    const clampedRewind = Math.max(0, Math.min(200, rewindMs));
    const targetTime = nowMs - clampedRewind;

    if (this.history.length === 0) {
      return {
        position: this.position,
        yaw: this.yaw,
        hurtboxPositions: {
          Nape: this.hurtboxes.Nape.worldPosition,
          Head: this.hurtboxes.Head.worldPosition,
          LeftArm: this.hurtboxes.LeftArm.worldPosition,
          RightArm: this.hurtboxes.RightArm.worldPosition,
          LeftLeg: this.hurtboxes.LeftLeg.worldPosition,
          RightLeg: this.hurtboxes.RightLeg.worldPosition,
        },
      };
    }

    let best = this.history[this.history.length - 1];
    let bestDiff = Math.abs(best.timeMs - targetTime);
    for (const entry of this.history) {
      const diff = Math.abs(entry.timeMs - targetTime);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = entry;
      }
    }
    return best;
  }

  public applyDamageFromPlayer(
    attackerId: string,
    zone: TitanZoneType,
    damage: number
  ): {
    killed: boolean;
    limbBroken: boolean;
    stunned: boolean;
    remainingHp: number;
  } {
    if (this.aiState === 'Dead') {
      return {
        killed: false,
        limbBroken: false,
        stunned: false,
        remainingHp: 0,
      };
    }

    // Track aggro & damage contribution for Kill/Assist attribution
    this.aggroByPlayer.set(
      attackerId,
      (this.aggroByPlayer.get(attackerId) ?? 0) + damage * 1.4
    );
    this.damageContributors.set(
      attackerId,
      (this.damageContributors.get(attackerId) ?? 0) + damage
    );

    const hb = this.hurtboxes[zone];
    hb.hp = Math.max(0, hb.hp - damage);

    if (zone === 'Nape') {
      if (hb.hp <= 0) {
        this.aiState = 'Dead';
        this.anim = 'Death';
        this.stateTimer = 0;
        this.velocity.set(0, 0, 0);
        return {
          killed: true,
          limbBroken: false,
          stunned: false,
          remainingHp: 0,
        };
      }
      return {
        killed: false,
        limbBroken: false,
        stunned: false,
        remainingHp: hb.hp,
      };
    }

    if (hb.hp <= 0 && hb.disabledTimer <= 0) {
      const cfg = GAME_CONFIG.titans[this.variant];
      if (zone === 'LeftLeg' || zone === 'RightLeg') {
        hb.disabledTimer = cfg.injuredDuration;
        this.aiState = 'Injured';
        this.anim = 'Injured';
        this.stateTimer = cfg.injuredDuration;
        this.velocity.set(0, 0, 0);
        return {
          killed: false,
          limbBroken: true,
          stunned: false,
          remainingHp: 0,
        };
      } else if (zone === 'Head') {
        hb.disabledTimer = cfg.stunnedDuration;
        this.aiState = 'Stunned';
        this.anim = 'Stagger';
        this.stateTimer = cfg.stunnedDuration;
        this.velocity.set(0, 0, 0);
        return {
          killed: false,
          limbBroken: true,
          stunned: true,
          remainingHp: 0,
        };
      } else if (zone === 'LeftArm' || zone === 'RightArm') {
        hb.disabledTimer = 15.0;
        if (this.aiState === 'Attack' || this.aiState === 'Grab') {
          this.aiState = 'Stunned';
          this.anim = 'Stagger';
          this.stateTimer = 4.0;
        }
        return {
          killed: false,
          limbBroken: true,
          stunned: this.aiState === 'Stunned',
          remainingHp: 0,
        };
      }
    }

    return {
      killed: false,
      limbBroken: false,
      stunned: false,
      remainingHp: hb.hp,
    };
  }

  public stepServerAI(
    dt: number,
    nowMs: number,
    players: ServerPlayerTarget[],
    patrolWaypoints: THREE.Vector3[],
    staticBoxes: ReadonlyArray<{ box: THREE.Box3 }>,
    onAttackImpact?: (hit: ServerTitanAttackHit) => void
  ): void {
    // Regenerate disabled limbs
    for (const zone of ZONE_KEYS) {
      const hb = this.hurtboxes[zone];
      if (hb.disabledTimer > 0) {
        hb.disabledTimer = Math.max(0, hb.disabledTimer - dt);
        if (hb.disabledTimer <= 0) {
          hb.hp = hb.maxHp;
        }
      }
    }

    // Decay aggro slowly over time
    for (const [pid, val] of this.aggroByPlayer.entries()) {
      const next = Math.max(0, val - 18 * dt);
      if (next <= 0) this.aggroByPlayer.delete(pid);
      else this.aggroByPlayer.set(pid, next);
    }

    if (this.aiState === 'Dead') {
      this.velocity.set(0, 0, 0);
      this.deathFadeTimer += dt;
      if (this.deathFadeTimer > 3.0) {
        this.readyForRemoval = true;
      }
      this.syncHurtboxWorldPositions();
      this.recordHistory(nowMs);
      return;
    }

    const cfg = GAME_CONFIG.titans[this.variant];
    const bestTarget = this.selectBestPlayerTarget(players);
    this.targetPlayerId = bestTarget ? bestTarget.id : null;

    const toTarget = bestTarget
      ? new THREE.Vector3(
          bestTarget.position.x - this.position.x,
          0,
          bestTarget.position.z - this.position.z
        )
      : new THREE.Vector3();
    const flatDist = bestTarget ? toTarget.length() : Infinity;
    const dirToTarget =
      flatDist > 0.001 && Number.isFinite(flatDist)
        ? toTarget.clone().divideScalar(flatDist)
        : new THREE.Vector3(0, 0, 1);

    switch (this.aiState) {
      case 'Idle': {
        this.velocity.set(0, 0, 0);
        this.anim = 'Idle';
        this.stateTimer += dt;

        if (bestTarget) {
          this.aiState = 'Detect';
          this.stateTimer = 0.55;
          return;
        }
        if (this.stateTimer >= 2.0) {
          this.pickPatrolWaypoint(patrolWaypoints);
          this.aiState = 'Patrol';
          this.stateTimer = 8.0;
        }
        break;
      }

      case 'Patrol': {
        if (bestTarget) {
          this.aiState = 'Detect';
          this.stateTimer = 0.55;
          return;
        }
        const toWp = new THREE.Vector3(
          this.patrolTarget.x - this.position.x,
          0,
          this.patrolTarget.z - this.position.z
        );
        const wpDist = toWp.length();
        this.stateTimer -= dt;
        if (wpDist < 4.0 || this.stateTimer <= 0) {
          this.aiState = 'Idle';
          this.stateTimer = 0;
          return;
        }
        toWp.normalize();
        this.steerAndMove(toWp, cfg.walkSpeed, cfg.turnSpeed * 0.75, dt, staticBoxes);
        this.anim = 'Walk';
        break;
      }

      case 'Detect': {
        this.velocity.set(0, 0, 0);
        if (bestTarget) {
          const desiredYaw = Math.atan2(dirToTarget.x, dirToTarget.z);
          this.yaw = lerpAngle(this.yaw, desiredYaw, cfg.turnSpeed * 1.4 * dt);
        }
        this.anim = 'Turn';
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.aiState = 'Chase';
        }
        break;
      }

      case 'Chase': {
        if (!bestTarget || flatDist > cfg.detectRange * 1.55) {
          this.aiState = 'Patrol';
          this.stateTimer = 6.0;
          return;
        }

        const playerRelHeight = bestTarget.position.y - this.position.y;
        const canAttackArms = !this.areBothArmsDisabled();

        if (canAttackArms && flatDist <= cfg.attackRange) {
          if (
            playerRelHeight > this.heightMeters * 0.42 &&
            playerRelHeight < this.heightMeters * 1.18
          ) {
            this.attackHitDealtInCurrentSwing = false;
            this.aiState = 'Grab';
            this.anim = 'Grab';
            this.stateTimer = 1.15;
            return;
          }
          if (playerRelHeight <= this.heightMeters * 0.75) {
            this.attackHitDealtInCurrentSwing = false;
            this.aiState = 'Attack';
            this.anim = 'Attack';
            this.stateTimer = 1.25;
            return;
          }
        }

        const moveDir = dirToTarget.clone();
        if (this.variant === 'abnormal' && flatDist > 10) {
          const weave = Math.sin(nowMs * 0.0045 + this.position.x * 0.1) * 0.42;
          const perp = new THREE.Vector3(-moveDir.z, 0, moveDir.x);
          moveDir.addScaledVector(perp, weave).normalize();
        }

        const legSpeedScale = this.isAnyLegDisabled() ? 0.55 : 1.0;
        const chaseSpeed = cfg.chaseSpeed * legSpeedScale;
        this.steerAndMove(moveDir, chaseSpeed, cfg.turnSpeed, dt, staticBoxes);
        this.anim = chaseSpeed > 5.2 ? 'Run' : 'Walk';
        break;
      }

      case 'Attack': {
        this.velocity.set(0, 0, 0);
        this.anim = 'Attack';
        if (bestTarget && this.stateTimer > 0.65) {
          const desiredYaw = Math.atan2(dirToTarget.x, dirToTarget.z);
          this.yaw = lerpAngle(this.yaw, desiredYaw, cfg.turnSpeed * 0.8 * dt);
        }

        if (
          !this.attackHitDealtInCurrentSwing &&
          this.stateTimer <= 0.58 &&
          this.stateTimer >= 0.3
        ) {
          this.attackHitDealtInCurrentSwing = true;
          const forwardHit = this.position
            .clone()
            .addScaledVector(this.getForwardVector(), cfg.attackRange * 0.65);
          forwardHit.y += this.heightMeters * 0.35;
          onAttackImpact?.({
            titan: this,
            type: 'melee',
            damage: cfg.attackDamage,
            impactPoint: forwardHit,
            radius: cfg.attackRange * 0.72,
          });
        }

        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.aiState = 'Recover';
          this.anim = 'Idle';
          this.stateTimer = 0.85;
        }
        break;
      }

      case 'Grab': {
        this.velocity.set(0, 0, 0);
        this.anim = 'Grab';
        if (bestTarget && this.stateTimer > 0.55) {
          const desiredYaw = Math.atan2(dirToTarget.x, dirToTarget.z);
          this.yaw = lerpAngle(this.yaw, desiredYaw, cfg.turnSpeed * 1.1 * dt);
        }

        if (
          !this.attackHitDealtInCurrentSwing &&
          this.stateTimer <= 0.52 &&
          this.stateTimer >= 0.25
        ) {
          this.attackHitDealtInCurrentSwing = true;
          const grabPoint = this.position
            .clone()
            .addScaledVector(this.getForwardVector(), cfg.attackRange * 0.55);
          grabPoint.y += this.heightMeters * 0.76;
          onAttackImpact?.({
            titan: this,
            type: 'grab',
            damage: cfg.grabDamage,
            impactPoint: grabPoint,
            radius: cfg.attackRange * 0.62,
          });
        }

        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.aiState = 'Recover';
          this.anim = 'Idle';
          this.stateTimer = 1.0;
        }
        break;
      }

      case 'Recover': {
        this.velocity.set(0, 0, 0);
        this.anim = 'Idle';
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.aiState = 'Chase';
        }
        break;
      }

      case 'Stunned': {
        this.velocity.set(0, 0, 0);
        this.anim = 'Stagger';
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.aiState = 'Chase';
        }
        break;
      }

      case 'Injured': {
        this.velocity.set(0, 0, 0);
        this.anim = 'Injured';
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.aiState = 'Chase';
        }
        break;
      }
    }

    this.syncHurtboxWorldPositions();
    this.recordHistory(nowMs);
  }

  /**
   * Multi-player threat & target selector:
   * Evaluates all alive players by proximity, FOV visibility, ODM noise, and damage aggro.
   */
  private selectBestPlayerTarget(
    players: ServerPlayerTarget[]
  ): ServerPlayerTarget | null {
    const cfg = GAME_CONFIG.titans[this.variant];
    const forward = this.getForwardVector();

    let best: ServerPlayerTarget | null = null;
    let bestThreatScore = -Infinity;

    for (const p of players) {
      if (!p.isAlive) continue;

      const toP = new THREE.Vector3(
        p.position.x - this.position.x,
        0,
        p.position.z - this.position.z
      );
      const dist = toP.length();
      const maxDetect = p.isBoostingOrHooked
        ? cfg.detectRange * 1.25
        : cfg.detectRange;
      const aggro = this.aggroByPlayer.get(p.id) ?? 0;

      // Always detect if player has dealt damage (aggro > 0) or is within detect range
      if (dist > maxDetect && aggro <= 0) continue;

      const dir = dist > 0.001 ? toP.divideScalar(dist) : new THREE.Vector3(0, 0, 1);
      const fovDot = forward.dot(dir);
      const visible = fovDot >= cfg.fovCos || dist < 24.0 || aggro > 0;
      if (!visible) continue;

      // Threat score: closer distance + higher aggro + current target hysteresis
      const distanceScore = Math.max(0, 120 - dist) * 2.2;
      const noiseBonus = p.isBoostingOrHooked ? 25 : 0;
      const hysteresisBonus = this.targetPlayerId === p.id ? 35 : 0;
      const threat = distanceScore + aggro * 0.5 + noiseBonus + hysteresisBonus;

      if (threat > bestThreatScore) {
        bestThreatScore = threat;
        best = p;
      }
    }

    return best;
  }

  private pickPatrolWaypoint(waypoints: THREE.Vector3[]): void {
    if (waypoints.length === 0) {
      this.patrolTarget.set(
        (Math.random() - 0.5) * 140,
        0,
        (Math.random() - 0.5) * 140
      );
      return;
    }
    const idx = Math.floor(Math.random() * waypoints.length);
    this.patrolTarget.copy(waypoints[idx]);
  }

  private steerAndMove(
    desiredDir: THREE.Vector3,
    speed: number,
    turnSpeed: number,
    dt: number,
    staticBoxes: ReadonlyArray<{ box: THREE.Box3 }>
  ): void {
    const steerDir = desiredDir.clone();
    const probeDist = this.heightMeters * 0.45 + 3.5;
    const probePoint = this.position.clone().addScaledVector(steerDir, probeDist);
    probePoint.y = 2.0;

    for (const item of staticBoxes) {
      if (item.box.containsPoint(probePoint)) {
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
    const angleDiff = Math.abs(shortestAngleDist(this.yaw, desiredYaw));
    this.yaw = lerpAngle(this.yaw, desiredYaw, turnSpeed * dt);

    const turnSlowdown = angleDiff > 1.1 ? 0.35 : 1.0;
    const forward = this.getForwardVector();
    this.velocity.set(
      forward.x * speed * turnSlowdown,
      0,
      forward.z * speed * turnSlowdown
    );

    const nextPos = this.position.clone().addScaledVector(this.velocity, dt);
    const halfCity = GAME_CONFIG.world.citySize * 0.5 - 8;
    nextPos.x = Math.max(-halfCity, Math.min(halfCity, nextPos.x));
    nextPos.z = Math.max(-halfCity, Math.min(halfCity, nextPos.z));

    const bodyProbe = new THREE.Vector3(nextPos.x, 2.0, nextPos.z);
    let blocked = false;
    for (const item of staticBoxes) {
      if (item.box.containsPoint(bodyProbe)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      this.position.copy(nextPos);
    }
  }

  public toNetState(): NetTitanState {
    const hbOut = {} as Record<TitanZoneType, NetTitanHurtbox>;
    for (const zone of ZONE_KEYS) {
      const hb = this.hurtboxes[zone];
      hbOut[zone] = {
        hp: hb.hp,
        maxHp: hb.maxHp,
        disabledTimer: Math.round(hb.disabledTimer * 10) / 10,
        worldPos: [
          Math.round(hb.worldPosition.x * 100) / 100,
          Math.round(hb.worldPosition.y * 100) / 100,
          Math.round(hb.worldPosition.z * 100) / 100,
        ],
        radius: hb.radius,
      };
    }

    return {
      id: this.id,
      variant: this.variant,
      heightMeters: Math.round(this.heightMeters * 100) / 100,
      position: [
        Math.round(this.position.x * 100) / 100,
        Math.round(this.position.y * 100) / 100,
        Math.round(this.position.z * 100) / 100,
      ],
      velocity: [
        Math.round(this.velocity.x * 100) / 100,
        Math.round(this.velocity.y * 100) / 100,
        Math.round(this.velocity.z * 100) / 100,
      ],
      yaw: Math.round(this.yaw * 1000) / 1000,
      aiState: this.aiState,
      anim: this.anim,
      targetPlayerId: this.targetPlayerId,
      hurtboxes: hbOut,
    };
  }
}
