import * as THREE from 'three';
import { TitanAI } from '../ai/TitanAI';
import { AssetLoader } from '../assets/AssetLoader';
import { AudioManager } from '../audio/AudioManager';
import { CombatSystem } from '../combat/CombatSystem';
import { GAME_CONFIG, UserSettings } from '../config/GameConfig';
import { InputManager } from '../input/InputManager';
import { GameMode, MissionManager } from '../missions/MissionManager';
import { ODMSystem } from '../odm/ODMSystem';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { ActionCamera } from '../player/ActionCamera';
import { PlayerController } from '../player/PlayerController';
import { DebugRenderer } from '../rendering/DebugRenderer';
import { RendererManager } from '../rendering/RendererManager';
import { VFXManager } from '../rendering/VFXManager';
import { UIManager } from '../ui/UIManager';
import { CityBuilder } from '../world/CityBuilder';
import { SaveManager } from './SaveManager';

export class GameEngine {
  public readonly rendererMgr: RendererManager;
  public readonly physics: PhysicsWorld;
  public readonly input: InputManager;
  public readonly audio: AudioManager;
  public readonly saveMgr: SaveManager;
  public readonly assetLoader: AssetLoader;

  public cityBuilder!: CityBuilder;
  public player!: PlayerController;
  public actionCam!: ActionCamera;
  public odm!: ODMSystem;
  public combat!: CombatSystem;
  public missions!: MissionManager;
  public vfx!: VFXManager;
  public debugRenderer!: DebugRenderer;
  public ui!: UIManager;

  public state: 'menu' | 'playing' | 'paused' | 'result' = 'menu';

  private lastFrameTime = 0;
  private physicsAccumulator = 0;
  private fpsSmoothed = 60;
  private gasVfxAccum = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private uiContainer: HTMLElement
  ) {
    this.saveMgr = new SaveManager();
    this.rendererMgr = new RendererManager(canvas);
    this.physics = new PhysicsWorld();
    this.input = new InputManager(canvas);
    this.audio = new AudioManager();
    this.assetLoader = new AssetLoader();
  }

  public async init(): Promise<void> {
    await Promise.all([
      this.physics.init(),
      this.assetLoader.loadGLTF('/assets/models/vanguard_strider.glb'),
      this.assetLoader.loadGLTF('/assets/models/titan_behemoth.glb'),
    ]);

    const settings = this.saveMgr.getSettings();
    this.rendererMgr.applyQualityPreset(settings.graphicsQuality);
    this.audio.setVolume(settings.masterVolume);

    this.cityBuilder = new CityBuilder(this.rendererMgr.scene, this.physics);
    this.cityBuilder.buildWorld(false);

    this.player = new PlayerController(this.rendererMgr.scene);
    this.actionCam = new ActionCamera(window.innerWidth / window.innerHeight);
    this.actionCam.sensitivity = settings.mouseSensitivity;
    this.actionCam.targetDistance = settings.cameraDistance;

    window.addEventListener('resize', () => {
      this.actionCam.camera.aspect = window.innerWidth / window.innerHeight;
      this.actionCam.camera.updateProjectionMatrix();
    });

    this.odm = new ODMSystem(this.rendererMgr.scene, this.physics);
    this.combat = new CombatSystem();
    this.missions = new MissionManager(this.rendererMgr.scene);
    this.vfx = new VFXManager(this.rendererMgr.scene);
    this.debugRenderer = new DebugRenderer(this.rendererMgr.scene);

    this.ui = new UIManager(
      this.uiContainer,
      settings,
      this.saveMgr.getProgress(),
      {
        onStartGame: (mode) => this.startGame(mode),
        onResumeGame: () => this.resumeGame(),
        onRestartMission: () => this.restartMission(),
        onReturnMainMenu: () => this.returnToMainMenu(),
        onSettingsChanged: (newSet) => this.applySettings(newSet),
      }
    );

    // Position player & camera in scenic city overview during Main Menu
    this.player.reset(new THREE.Vector3(0, 0.2, 26), Math.PI);
    this.physics.setPlayerPosition(this.player.position);

    this.lastFrameTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  private applySettings(partial: Partial<UserSettings>): void {
    const updated = this.saveMgr.updateSettings(partial);
    this.actionCam.sensitivity = updated.mouseSensitivity;
    this.actionCam.targetDistance = updated.cameraDistance;
    this.audio.setVolume(updated.masterVolume);
    this.rendererMgr.applyQualityPreset(updated.graphicsQuality);
  }

  public startGame(mode: GameMode): void {
    this.audio.init();
    this.odm.releaseAll();
    this.vfx.clearAll();
    this.missions.clearTitans();

    // Rebuild world colliders & optional training course cleanly
    this.physics.clearStaticWorld();
    this.cityBuilder.buildWorld(mode === 'training');

    const spawnPos = new THREE.Vector3(0, 0.2, 24);
    this.player.reset(spawnPos, Math.PI);
    this.physics.setPlayerPosition(spawnPos);

    this.actionCam.yaw = 0;
    this.actionCam.pitch = 0.14;
    this.combat.lockedTitan = null;
    this.combat.comboCount = 0;

    this.missions.startMission(
      mode,
      this.player,
      this.cityBuilder.getTitanSpawnPoints()
    );

    this.state = 'playing';
    this.input.setEnabled(true);
    this.input.requestPointerLock();
  }

  public restartMission(): void {
    this.startGame(this.missions.mode);
    this.ui.showGameplayHUD();
  }

  public pauseGame(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.setEnabled(false);
    this.ui.setPaused(true);
  }

  public resumeGame(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.setPaused(false);
    this.input.setEnabled(true);
    this.input.requestPointerLock();
  }

  public returnToMainMenu(): void {
    this.state = 'menu';
    this.input.setEnabled(false);
    this.odm.releaseAll();
    this.vfx.clearAll();
    this.missions.clearTitans();
    this.ui.showMainMenu(this.saveMgr.getProgress());
  }

  private loop(nowMs: number): void {
    requestAnimationFrame((t) => this.loop(t));

    const rawDt = Math.min(0.1, Math.max(0.0001, (nowMs - this.lastFrameTime) / 1000));
    this.lastFrameTime = nowMs;
    this.fpsSmoothed = this.fpsSmoothed * 0.92 + (1 / rawDt) * 0.08;

    if (this.state === 'menu') {
      // Gently orbit camera around character in the plaza
      this.actionCam.yaw += rawDt * 0.18;
      this.player.updateVisuals(rawDt, this.odm);
      this.actionCam.update(
        rawDt,
        0,
        0,
        this.player.position,
        this.player.velocity,
        false,
        null,
        this.physics
      );
      this.rendererMgr.renderer.render(
        this.rendererMgr.scene,
        this.actionCam.camera
      );
      return;
    }

    if (this.state === 'paused' || this.state === 'result') {
      const sampled = this.input.sampleState();
      if (sampled.pauseJustPressed && this.state === 'paused') {
        this.resumeGame();
      }
      this.rendererMgr.renderer.render(
        this.rendererMgr.scene,
        this.actionCam.camera
      );
      return;
    }

    // Active Gameplay State ('playing')
    const inputState = this.input.sampleState();
    if (inputState.pauseJustPressed) {
      this.pauseGame();
      return;
    }

    // Handle Target Lock (Tab) & Target Zone Cycle (C / Mouse Wheel)
    if (inputState.lockTargetJustPressed) {
      const locked = this.combat.cycleTargetLock(
        this.player.position,
        this.actionCam.getForwardVector(),
        this.missions.titans
      );
      if (locked) {
        this.ui.showCombatBanner(
          `TARGET LOCKED: ${locked.variant.toUpperCase()} TITAN [${this.combat.lockedZone.toUpperCase()}]`
        );
      }
    }
    if (inputState.cycleZoneDelta !== 0) {
      const nextZone = this.combat.cycleTargetZone(inputState.cycleZoneDelta);
      this.ui.showCombatBanner(`TARGET ZONE: ${nextZone.toUpperCase()}`);
    }

    // Handle Resupply / Blade Reload (R)
    if (inputState.resupplyJustPressed) {
      const res = this.player.tryResupplyOrReloadBlades(
        this.cityBuilder.getSupplyStations(),
        this.audio
      );
      if (res.resuppliedAtStation) {
        this.ui.showCombatBanner('SUPPLY DEPOT: GAS, BLADES & HP RESTORED!');
      } else if (res.reloadedBlades) {
        this.ui.showCombatBanner('FRESH MONO-BLADES EQUIPPED!');
      }
    }

    // Hit-stop pauses simulation briefly on heavy blade impact for cinematic punch
    if (this.combat.hitStopTimer > 0) {
      this.combat.hitStopTimer = Math.max(0, this.combat.hitStopTimer - rawDt);
      this.rendererMgr.renderer.render(
        this.rendererMgr.scene,
        this.actionCam.camera
      );
      return;
    }

    // =========================================================================
    // Fixed-Timestep Physics & AI Simulation Loop (60 Hz)
    // =========================================================================
    this.physicsAccumulator += rawDt;
    const fixedDt = GAME_CONFIG.physics.fixedTimestep;
    let steps = 0;

    // For first sub-step, pass full inputState; subsequent sub-steps in same frame clear edge triggers
    let subInput = inputState;

    while (
      this.physicsAccumulator >= fixedDt &&
      steps < GAME_CONFIG.physics.maxSubSteps
    ) {
      this.stepSimulation(fixedDt, subInput);
      this.physicsAccumulator -= fixedDt;
      steps++;
      subInput = {
        ...subInput,
        jumpPressed: false,
        leftGrappleJustPressed: false,
        rightGrappleJustPressed: false,
        attackJustPressed: false,
        dodgeJustPressed: false,
        lockTargetJustPressed: false,
        cycleZoneDelta: 0,
        resupplyJustPressed: false,
        interactJustPressed: false,
        pauseJustPressed: false,
        mouseDeltaX: 0,
        mouseDeltaY: 0,
      };
    }

    // =========================================================================
    // Frame-Rate Independent Visuals, Camera, Combat Sweep & HUD Update
    // =========================================================================
    this.player.updateVisuals(rawDt, this.odm);

    // Emit gas boost trail particles and slash arcs
    if (this.player.isBoosting || this.odm.isAnyHookActive()) {
      this.gasVfxAccum += rawDt;
      const interval = this.player.isBoosting ? 0.025 : 0.065;
      if (this.gasVfxAccum >= interval) {
        this.gasVfxAccum = 0;
        const nozzlePos = new THREE.Vector3();
        this.player.rig.thrusterNozzleNode.getWorldPosition(nozzlePos);
        this.vfx.spawnGasJetPuff(nozzlePos, this.player.velocity);
      }
    }

    if (inputState.attackJustPressed && this.combat.isCurrentlyAttacking()) {
      this.vfx.spawnSlashArc(
        this.player.position,
        this.player.yaw,
        this.player.isBoosting
      );
    }

    // Sample world-space left & right sword segments for swept-blade hurtbox collision
    const lHilt = new THREE.Vector3();
    const lTip = new THREE.Vector3();
    const rHilt = new THREE.Vector3();
    const rTip = new THREE.Vector3();
    this.player.rig.leftSwordHilt.getWorldPosition(lHilt);
    this.player.rig.leftSwordTip.getWorldPosition(lTip);
    this.player.rig.rightSwordHilt.getWorldPosition(rHilt);
    this.player.rig.rightSwordTip.getWorldPosition(rTip);

    this.combat.update(
      rawDt,
      this.player.position,
      this.player.velocity,
      this.player.bladeDurability,
      lHilt,
      lTip,
      rHilt,
      rTip,
      this.missions.titans,
      (hitEvent) => {
        this.player.consumeBladeOnHit(hitEvent.glancedOffFront);
        this.audio.playBladeImpact(
          hitEvent.isCriticalNapeHit,
          hitEvent.glancedOffFront
        );
        this.vfx.spawnImpactBurst(
          hitEvent.impactPoint,
          hitEvent.isCriticalNapeHit,
          hitEvent.glancedOffFront
        );
        this.actionCam.addShake(
          hitEvent.isCriticalNapeHit ? 0.36 : 0.2,
          0.22
        );

        if (hitEvent.glancedOffFront) {
          this.ui.showCombatBanner(
            'GLANCED OFF FRONT! ATTACK NAPE FROM BEHIND!'
          );
        } else if (hitEvent.killedTitan) {
          this.missions.onTitanKilled(
            hitEvent.titan,
            hitEvent.velocityMultiplier,
            this.combat.comboCount,
            this.cityBuilder.getTitanSpawnPoints()
          );
          this.ui.showCombatBanner(
            `CRITICAL NAPE EXECUTION! (${hitEvent.damage} DMG — ${hitEvent.velocityMultiplier.toFixed(1)}x SPEED)`
          );
        } else if (hitEvent.limbBroken) {
          this.missions.onLimbBroken();
          this.ui.showCombatBanner(
            `TITAN ${hitEvent.zone.toUpperCase()} CRIPPLED! (${hitEvent.damage} DMG)`
          );
        } else {
          this.ui.showCombatBanner(
            `${hitEvent.zone.toUpperCase()} HIT: ${hitEvent.damage} DMG`
          );
        }
      }
    );

    // Update Camera
    const lockedZoneWorld =
      this.combat.lockedTitan && !this.combat.lockedTitan.isDead()
        ? this.combat.lockedTitan.hurtboxes[this.combat.lockedZone].worldPosition
        : null;

    this.actionCam.update(
      rawDt,
      inputState.mouseDeltaX,
      inputState.mouseDeltaY,
      this.player.position,
      this.player.velocity,
      this.player.isBoosting,
      lockedZoneWorld,
      this.physics
    );

    this.vfx.update(rawDt);

    const settings = this.saveMgr.getSettings();
    this.debugRenderer.update(
      settings.debug,
      this.player.position,
      this.player.velocity,
      this.odm,
      this.missions.titans,
      this.physics
    );

    // Update Mission & Check Victory / Defeat
    this.missions.update(
      rawDt,
      this.player,
      this.combat.lockedTitan,
      this.cityBuilder.getTrainingRings()
    );
    const missionStatus = this.missions.getStatus();

    if (missionStatus.completed || missionStatus.failed) {
      this.state = 'result';
      this.input.setEnabled(false);
      this.saveMgr.recordMissionResult(
        missionStatus.mode,
        missionStatus.score,
        missionStatus.rank,
        missionStatus.kills,
        missionStatus.elapsedSeconds
      );
      this.ui.showResultScreen(missionStatus);
    }

    // Probe reticle for HUD crosshair feedback
    const reticlePreview = this.odm.probeReticleTarget(
      this.actionCam.camera.position,
      this.actionCam.getForwardVector(),
      this.player.position,
      this.missions.titans,
      this.combat.lockedTitan,
      this.combat.lockedZone
    );

    const nearSupply = this.cityBuilder
      .getSupplyStations()
      .some(
        (s) =>
          s.position.distanceTo(this.player.position) <=
          GAME_CONFIG.world.resupplyRange
      );

    const renderStats = this.rendererMgr.getRenderStats();
    this.ui.updateHUD({
      dt: rawDt,
      player: this.player,
      odm: this.odm,
      combat: this.combat,
      missionStatus,
      reticlePreview,
      nearSupplyDepot: nearSupply,
      camera: this.actionCam.camera,
      titans: this.missions.titans,
      fps: this.fpsSmoothed,
      drawCalls: renderStats.drawCalls,
      triangles: renderStats.triangles,
    });

    this.rendererMgr.renderer.render(
      this.rendererMgr.scene,
      this.actionCam.camera
    );
  }

  private stepSimulation(dt: number, inputState: ReturnType<InputManager['sampleState']>): void {
    this.player.stepPhysics(
      dt,
      inputState,
      this.actionCam,
      this.physics,
      this.odm,
      this.combat,
      this.missions.titans,
      this.audio,
      (fallSpeed) => {
        if (fallSpeed > 14) {
          this.actionCam.addShake(0.14, 0.14);
        }
      }
    );

    this.physics.step();

    // Update all Titans AI & Skeletal Hurtboxes
    const patrolWaypoints = this.cityBuilder.getPatrolWaypoints();
    const staticBoxes = this.physics.getStaticBoxes();

    for (const titan of this.missions.titans) {
      TitanAI.updateTitanAI(
        titan,
        dt,
        this.player.position,
        this.player.isBoosting || this.odm.isAnyHookActive(),
        patrolWaypoints,
        staticBoxes,
        () => {
          this.audio.playTitanRoar();
        },
        (attackEvt) => {
          const distToPlayer = this.player.position.distanceTo(
            attackEvt.impactPoint
          );
          if (distToPlayer <= attackEvt.radius) {
            const kb = new THREE.Vector3()
              .subVectors(this.player.position, titan.position)
              .normalize();
            const damaged = this.player.takeDamage(
              attackEvt.damage,
              kb,
              this.odm,
              this.audio,
              () => {
                this.missions.onPerfectDodge();
                this.ui.showCombatBanner('PERFECT DODGE! (+250 PTS)');
              }
            );
            if (damaged) {
              this.ui.flashDamageVignette();
              this.actionCam.addShake(0.35, 0.25);
              this.ui.showCombatBanner(
                attackEvt.type === 'grab'
                  ? 'CRUSHED BY TITAN GRAB!'
                  : 'STRUCK BY TITAN SMASH!'
              );
            }
          }
        }
      );

      titan.update(dt, () => {
        const d = titan.position.distanceTo(this.player.position);
        this.audio.playTitanStep(d);
      });
    }
  }
}
