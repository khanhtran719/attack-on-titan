import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';
import { TitanEntity } from '../enemies/TitanEntity';
import { TitanVariant, TitanZoneType } from '../enemies/TitanRigBuilder';
import { PlayerController } from '../player/PlayerController';
import { NetRoomState } from '../shared/Protocol';
import { lerpAngle } from '../utils/MathUtils';
import { TrainingRing } from '../world/CityBuilder';

export type GameMode = 'training' | 'hunt' | 'coop';

export interface MissionStatus {
  mode: GameMode;
  title: string;
  objectiveText: string;
  subText: string;
  kills: number;
  targetKills: number;
  wave: number;
  maxWaves: number;
  score: number;
  elapsedSeconds: number;
  completed: boolean;
  failed: boolean;
  rank: 'S' | 'A' | 'B' | 'C';
}

export class MissionManager {
  public mode: GameMode = 'hunt';
  public elapsedSeconds = 0;
  public score = 0;
  public kills = 0;
  public totalTargetKills = 0;
  public currentWave = 1;
  public maxWaves = 3;
  public completed = false;
  public failed = false;

  // Training progression
  public trainingStep = 1;
  private startGrappleCount = 0;
  private startBoostTime = 0;

  // Active Titans
  public titans: TitanEntity[] = [];
  private nextTitanId = 1;

  constructor(private scene: THREE.Scene) {}

  private disposeTitanResources(t: TitanEntity): void {
    this.scene.remove(t.rig.rootGroup);
    t.rig.rootGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else if (mesh.material) {
          mesh.material.dispose();
        }
      }
    });
  }

  public clearTitans(): void {
    for (const t of this.titans) {
      this.disposeTitanResources(t);
    }
    this.titans = [];
  }

  public startMission(
    mode: GameMode,
    player: PlayerController,
    spawnPoints: THREE.Vector3[]
  ): void {
    this.clearTitans();
    this.mode = mode;
    this.elapsedSeconds = 0;
    this.score = 0;
    this.kills = 0;
    this.completed = false;
    this.failed = false;

    if (mode === 'training') {
      this.trainingStep = 1;
      this.currentWave = 1;
      this.maxWaves = 1;
      this.totalTargetKills = 1;
      this.startGrappleCount = player.totalGrapplesFired;
      this.startBoostTime = player.totalBoostTime;

      // Spawn a Training Dummy Titan in the northern avenue so player can practice targeting & nape strikes
      const dummyPos = new THREE.Vector3(0, 0, -45);
      const dummy = new TitanEntity(
        `titan_training_${this.nextTitanId++}`,
        'normal',
        dummyPos,
        8.0,
        true
      );
      dummy.yaw = 0; // Facing South (+Z) initially; player can swing behind its back (-Z)
      this.titans.push(dummy);
      this.scene.add(dummy.rig.rootGroup);
    } else if (mode === 'coop') {
      this.currentWave = 1;
      this.maxWaves = 2;
      this.totalTargetKills = 7;
      // In co-op mode, Titans are spawned and controlled authoritatively by the server
    } else {
      this.currentWave = 1;
      this.maxWaves = 2;
      this.totalTargetKills = 7; // Wave 1 (3 Titans) + Wave 2 (4 Titans)
      this.spawnHuntWave(1, spawnPoints);
    }
  }

  private spawnHuntWave(wave: number, spawnPoints: THREE.Vector3[]): void {
    const waveRoster: TitanVariant[] =
      wave === 1
        ? ['normal', 'normal', 'abnormal']
        : ['normal', 'abnormal', 'abnormal', 'large'];

    waveRoster.forEach((variant, idx) => {
      const basePt =
        spawnPoints.length > 0
          ? spawnPoints[(idx + wave * 2) % spawnPoints.length]
          : new THREE.Vector3((idx - 1) * 45, 0, -65);

      const jitter = new THREE.Vector3(
        (Math.random() - 0.5) * 12,
        0,
        (Math.random() - 0.5) * 12
      );
      const pos = basePt.clone().add(jitter);
      pos.y = 0;

      const titan = new TitanEntity(
        `titan_${this.nextTitanId++}`,
        variant,
        pos
      );
      titan.yaw = Math.atan2(-pos.x, -pos.z);
      this.titans.push(titan);
      this.scene.add(titan.rig.rootGroup);
    });
  }

  public onTitanKilled(
    titan: TitanEntity,
    velocityMultiplier: number,
    comboCount: number,
    spawnPoints: THREE.Vector3[]
  ): void {
    this.kills++;
    const cfg = GAME_CONFIG.titans[titan.variant];
    const comboMult = Math.min(3.0, 1 + (comboCount - 1) * 0.25);
    const points = Math.round(cfg.scoreValue * velocityMultiplier * comboMult);
    this.score += points;

    if (this.mode === 'training') {
      this.trainingStep = 6;
      this.completed = true;
      this.score += 1500;
      return;
    }

    // Check if current wave is cleared
    const aliveInWave = this.titans.filter((t) => !t.isDead()).length;
    if (aliveInWave === 0) {
      if (this.currentWave < this.maxWaves) {
        this.currentWave++;
        this.spawnHuntWave(this.currentWave, spawnPoints);
      } else if (this.kills >= this.totalTargetKills) {
        this.completed = true;
        // Time clear bonus
        const timeBonus = Math.max(0, Math.round((300 - this.elapsedSeconds) * 15));
        this.score += timeBonus;
      }
    }
  }

  public onLimbBroken(): void {
    this.score += 350;
  }

  public onPerfectDodge(): void {
    this.score += 250;
  }

  /**
   * Synchronizes shared Titans and wave/mission status from the authoritative server snapshot in Co-op mode.
   */
  public syncCoopFromServer(
    snapshot: NetRoomState,
    dt: number,
    playerPos: THREE.Vector3,
    onFootstep?: (dist: number) => void
  ): void {
    this.mode = 'coop';
    this.elapsedSeconds = snapshot.elapsedSeconds;
    this.score = snapshot.teamScore;
    this.kills = snapshot.totalKills;
    this.totalTargetKills = snapshot.targetKills;
    this.currentWave = snapshot.wave;
    this.maxWaves = snapshot.maxWaves;
    this.completed = snapshot.phase === 'victory';
    this.failed = snapshot.phase === 'defeat';

    const serverIds = new Set(Object.keys(snapshot.titans));

    // Remove Titans no longer present on server
    for (let i = this.titans.length - 1; i >= 0; i--) {
      const t = this.titans[i];
      if (!serverIds.has(t.id)) {
        this.disposeTitanResources(t);
        this.titans.splice(i, 1);
      }
    }

    // Create or update Titans from snapshot
    for (const netTitan of Object.values(snapshot.titans)) {
      let titan = this.titans.find((t) => t.id === netTitan.id);
      if (!titan) {
        titan = new TitanEntity(
          netTitan.id,
          netTitan.variant,
          new THREE.Vector3(...netTitan.position),
          netTitan.heightMeters,
          false
        );
        titan.yaw = netTitan.yaw;
        this.titans.push(titan);
        this.scene.add(titan.rig.rootGroup);
      }

      const targetPos = new THREE.Vector3(...netTitan.position);
      if (titan.position.distanceTo(targetPos) > 18) {
        titan.position.copy(targetPos);
      } else {
        titan.position.lerp(targetPos, Math.min(1, dt * 16));
      }
      titan.yaw = lerpAngle(titan.yaw, netTitan.yaw, Math.min(1, dt * 16));
      titan.velocity.set(...netTitan.velocity);
      titan.aiState = netTitan.aiState;
      titan.playAnimation(netTitan.anim, 0.16);

      for (const zone of Object.keys(netTitan.hurtboxes) as TitanZoneType[]) {
        const netZ = netTitan.hurtboxes[zone];
        const hb = titan.hurtboxes[zone];
        if (hb && netZ) {
          hb.hp = netZ.hp;
          hb.maxHp = netZ.maxHp;
          hb.disabledTimer = netZ.disabledTimer;
          if (zone === 'LeftArm') {
            titan.rig.bonesByName['LeftLowerArm']?.scale.setScalar(
              netZ.disabledTimer > 0 ? 0.35 : 1.0
            );
          } else if (zone === 'RightArm') {
            titan.rig.bonesByName['RightLowerArm']?.scale.setScalar(
              netZ.disabledTimer > 0 ? 0.35 : 1.0
            );
          }
        }
      }

      titan.update(dt, () => {
        onFootstep?.(titan!.position.distanceTo(playerPos));
      });
    }
  }

  public update(
    dt: number,
    player: PlayerController,
    lockedTitan: TitanEntity | null,
    trainingRings: TrainingRing[]
  ): void {
    if (this.completed || this.failed) return;

    this.elapsedSeconds += dt;

    if (player.isDead()) {
      this.failed = true;
      return;
    }

    // Clean up dead Titans that finished their steam evaporation fade
    for (let i = this.titans.length - 1; i >= 0; i--) {
      if (this.titans[i].readyForRemoval) {
        this.disposeTitanResources(this.titans[i]);
        this.titans.splice(i, 1);
      }
    }

    // Update Training Rings & Step Progression
    if (this.mode === 'training') {
      for (const ring of trainingRings) {
        if (!ring.passed && player.position.distanceTo(ring.position) < 5.5) {
          ring.passed = true;
          const mat = ring.mesh.material as THREE.MeshBasicMaterial;
          mat.color.setHex(0x22c55e);
          this.score += 200;
        }
      }

      if (this.trainingStep === 1) {
        const moved =
          Math.hypot(player.velocity.x, player.velocity.z) > 4.0 ||
          !player.grounded;
        if (moved && this.elapsedSeconds > 1.2) {
          this.trainingStep = 2;
        }
      } else if (this.trainingStep === 2) {
        if (player.totalGrapplesFired - this.startGrappleCount >= 2) {
          this.trainingStep = 3;
        }
      } else if (this.trainingStep === 3) {
        if (player.totalBoostTime - this.startBoostTime >= 0.45) {
          this.trainingStep = 4;
        }
      } else if (this.trainingStep === 4) {
        if (lockedTitan !== null || player.position.z < -20) {
          this.trainingStep = 5;
        }
      }
    }
  }

  public getStatus(): MissionStatus {
    const rank = this.computeRank();

    if (this.mode === 'training') {
      const steps: Record<number, { obj: string; sub: string }> = {
        1: {
          obj: 'Stage 1/5: Ground Locomotion & Jump',
          sub: 'Use WASD to run through the courtyard and press SPACE to jump.',
        },
        2: {
          obj: 'Stage 2/5: Dual ODM Grappling Hooks',
          sub: 'Aim at a building facade or tower and hold Left/Right Mouse (or Z/X) to fire both hooks.',
        },
        3: {
          obj: 'Stage 3/5: Pendulum Swing & Gas Boost',
          sub: 'Swing on your cables and hold SHIFT to ignite the rear Gas Thruster.',
        },
        4: {
          obj: 'Stage 4/5: Target Lock-On & Approach',
          sub: 'Approach the Training Titan ahead (North Avenue) and press TAB to lock onto its Nape.',
        },
        5: {
          obj: 'Stage 5/5: Execute Nape Strike',
          sub: 'Swing behind the Titan’s neck and press F at high speed to sever its Nape Weak Point!',
        },
        6: {
          obj: 'Training Complete!',
          sub: 'All Vanguard ODM & Nape Execution drills passed.',
        },
      };
      const cur = steps[this.trainingStep] || steps[5];
      return {
        mode: 'training',
        title: 'CADET PROVING GROUNDS',
        objectiveText: cur.obj,
        subText: cur.sub,
        kills: this.kills,
        targetKills: 1,
        wave: 1,
        maxWaves: 1,
        score: this.score,
        elapsedSeconds: this.elapsedSeconds,
        completed: this.completed,
        failed: this.failed,
        rank,
      };
    }

    const remaining = Math.max(0, this.totalTargetKills - this.kills);
    if (this.mode === 'coop') {
      return {
        mode: 'coop',
        title: `CO-OP VANGUARD OPERATION — WAVE ${this.currentWave}/${this.maxWaves}`,
        objectiveText: `Eliminate District Titans with Squad (${this.kills}/${this.totalTargetKills})`,
        subText: `${remaining} Hostile Titan(s) remaining. Press [G] to Ping Target, [1-4] Quick Chat, [Hold E] near downed allies to Revive.`,
        kills: this.kills,
        targetKills: this.totalTargetKills,
        wave: this.currentWave,
        maxWaves: this.maxWaves,
        score: this.score,
        elapsedSeconds: this.elapsedSeconds,
        completed: this.completed,
        failed: this.failed,
        rank,
      };
    }

    return {
      mode: 'hunt',
      title: `DEFENSE OF VALKENBURG — WAVE ${this.currentWave}/${this.maxWaves}`,
      objectiveText: `Eliminate Titans in the District (${this.kills}/${this.totalTargetKills})`,
      subText: `${remaining} Hostile Titan(s) remaining. Strike the rear Nape for lethal execution. Press R at Cyan Depots to resupply.`,
      kills: this.kills,
      targetKills: this.totalTargetKills,
      wave: this.currentWave,
      maxWaves: this.maxWaves,
      score: this.score,
      elapsedSeconds: this.elapsedSeconds,
      completed: this.completed,
      failed: this.failed,
      rank,
    };
  }

  private computeRank(): 'S' | 'A' | 'B' | 'C' {
    if (this.mode === 'training') return 'S';
    if (this.score >= 8500) return 'S';
    if (this.score >= 5500) return 'A';
    if (this.score >= 3000) return 'B';
    return 'C';
  }
}
