import * as THREE from 'three';
import { TitanAI } from '../ai/TitanAI';
import { AssetLoader } from '../assets/AssetLoader';
import { AudioManager } from '../audio/AudioManager';
import { CombatSystem } from '../combat/CombatSystem';
import { GAME_CONFIG, UserSettings } from '../config/GameConfig';
import { InputManager } from '../input/InputManager';
import { GameMode, MissionManager } from '../missions/MissionManager';
import { NetworkClient } from '../network/NetworkClient';
import { RemotePlayerManager } from '../network/RemotePlayerManager';
import { ODMSystem } from '../odm/ODMSystem';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { ActionCamera } from '../player/ActionCamera';
import { PlayerController } from '../player/PlayerController';
import { DebugRenderer } from '../rendering/DebugRenderer';
import { RendererManager } from '../rendering/RendererManager';
import { VFXManager } from '../rendering/VFXManager';
import {
  C2S_InputFrame,
  NetRoomState,
  S2C_CombatEvent,
} from '../shared/Protocol';
import { UIManager } from '../ui/UIManager';
import { CityBuilder } from '../world/CityBuilder';
import { SaveManager } from './SaveManager';

const QUICK_CHAT_KEY_MAP: Record<string, string> = {
  '1': 'target_nape',
  '2': 'cripple_legs',
  '3': 'need_help',
  '4': 'resupplying',
};

export class GameEngine {
  public readonly rendererMgr: RendererManager;
  public readonly physics: PhysicsWorld;
  public readonly input: InputManager;
  public readonly audio: AudioManager;
  public readonly saveMgr: SaveManager;
  public readonly assetLoader: AssetLoader;
  public readonly netClient: NetworkClient;

  public cityBuilder!: CityBuilder;
  public player!: PlayerController;
  public actionCam!: ActionCamera;
  public odm!: ODMSystem;
  public combat!: CombatSystem;
  public missions!: MissionManager;
  public vfx!: VFXManager;
  public debugRenderer!: DebugRenderer;
  public remotePlayers!: RemotePlayerManager;
  public ui!: UIManager;

  public state: 'menu' | 'lobby' | 'playing' | 'paused' | 'result' = 'menu';

  private lastFrameTime = 0;
  private physicsAccumulator = 0;
  private fpsSmoothed = 60;
  private gasVfxAccum = 0;
  private localReady = false;
  private coopOverlayOpen = false;
  private lastAttackIntentSentAt = 0;
  private wasLocalDownedOrDead = false;

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
    this.netClient = new NetworkClient();
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
    this.remotePlayers = new RemotePlayerManager(this.rendererMgr.scene);

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
        onOpenMultiplayerMenu: () => this.openMultiplayerLobby(),
        onCreateMultiplayerRoom: (params) => this.createCoopRoom(params),
        onJoinMultiplayerByCode: (params) => this.joinCoopByCode(params),
        onJoinMultiplayerByRoomId: (params) => this.joinCoopByRoomId(params),
        onRefreshPublicRooms: (url) => this.refreshPublicRooms(url),
        onToggleReady: () => this.toggleCoopReady(),
        onStartMultiplayerMatch: () =>
          this.netClient.sendLobbyAction({ action: 'start_match' }),
        onLeaveMultiplayerRoom: () => this.leaveCoopRoom(),
      }
    );

    this.bindNetworkCallbacks();

    // Position player & camera in scenic city overview during Main Menu
    this.player.reset(new THREE.Vector3(0, 0.2, 26), Math.PI);
    this.physics.setPlayerPosition(this.player.position);

    this.lastFrameTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  private bindNetworkCallbacks(): void {
    this.netClient.onStateSnapshot = (snapshot) => {
      this.handleServerSnapshot(snapshot);
    };

    this.netClient.onCombatEvent = (evt) => {
      this.handleServerCombatEvent(evt);
    };

    this.netClient.onRoomError = (err) => {
      this.ui.setMultiplayerError(`[${err.code}] ${err.message}`);
      this.ui.showCombatBanner(err.message);
    };

    this.netClient.onConnectionChange = (connState) => {
      if (
        connState === 'reconnecting' &&
        this.missions.mode === 'coop' &&
        this.state === 'playing'
      ) {
        this.ui.showCombatBanner(
          'CONNECTION INTERRUPTED — ATTEMPTING RECONNECT...'
        );
      }
    };
  }

  private openMultiplayerLobby(): void {
    this.state = 'lobby';
    this.input.setEnabled(false);
    this.remotePlayers.clearAll();
    this.missions.clearTitans();
    void this.refreshPublicRooms();
  }

  private async refreshPublicRooms(serverUrl?: string): Promise<void> {
    if (serverUrl) {
      this.netClient.setServerHost(serverUrl);
    }
    const rooms = await this.netClient.fetchPublicRooms();
    this.ui.updatePublicRoomsList(rooms);
  }

  private async createCoopRoom(params: {
    serverUrl: string;
    nickname: string;
    roomName: string;
    isPrivate: boolean;
  }): Promise<void> {
    try {
      this.netClient.setServerHost(params.serverUrl);
      this.localReady = true;
      await this.netClient.createRoom({
        nickname: params.nickname,
        roomName: params.roomName,
        isPublic: !params.isPrivate,
      });
      this.ui.showWaitingRoomLobby();
    } catch (err) {
      this.ui.setMultiplayerError(
        err instanceof Error ? err.message : 'Failed to create room.'
      );
    }
  }

  private async joinCoopByCode(params: {
    serverUrl: string;
    nickname: string;
    roomCode: string;
  }): Promise<void> {
    try {
      this.netClient.setServerHost(params.serverUrl);
      this.localReady = false;
      await this.netClient.joinRoomByCode(params.roomCode, params.nickname);
      this.ui.showWaitingRoomLobby();
    } catch (err) {
      this.ui.setMultiplayerError(
        err instanceof Error ? err.message : 'Failed to join room by code.'
      );
    }
  }

  private async joinCoopByRoomId(params: {
    serverUrl: string;
    nickname: string;
    roomId: string;
  }): Promise<void> {
    try {
      this.netClient.setServerHost(params.serverUrl);
      this.localReady = false;
      await this.netClient.joinRoomById(params.roomId, params.nickname);
      this.ui.showWaitingRoomLobby();
    } catch (err) {
      this.ui.setMultiplayerError(
        err instanceof Error ? err.message : 'Failed to join public room.'
      );
    }
  }

  private toggleCoopReady(): void {
    this.localReady = !this.localReady;
    this.netClient.sendLobbyAction({
      action: this.localReady ? 'ready' : 'unready',
    });
  }

  private async leaveCoopRoom(): Promise<void> {
    await this.netClient.leaveRoom();
    this.remotePlayers.clearAll();
    this.missions.clearTitans();
    this.state = 'lobby';
    this.ui.showMultiplayerMenu();
    void this.refreshPublicRooms();
  }

  private enterCoopGameplay(snapshot: NetRoomState): void {
    this.audio.init();
    this.odm.releaseAll();
    this.vfx.clearAll();
    this.missions.clearTitans();
    this.remotePlayers.clearAll();

    this.physics.clearStaticWorld();
    this.cityBuilder.buildWorld(false);

    const myId = this.netClient.myPlayerId;
    const myNet = snapshot.players[myId];
    const spawnPos = myNet
      ? new THREE.Vector3(...myNet.position)
      : new THREE.Vector3(0, 0.2, 24);
    const spawnYaw = myNet ? myNet.yaw : Math.PI;

    this.player.reset(spawnPos, spawnYaw);
    this.physics.setPlayerPosition(spawnPos);

    this.actionCam.yaw = 0;
    this.actionCam.pitch = 0.14;
    this.combat.lockedTitan = null;
    this.combat.comboCount = 0;
    this.coopOverlayOpen = false;
    this.wasLocalDownedOrDead = false;

    this.missions.startMission(
      'coop',
      this.player,
      this.cityBuilder.getTitanSpawnPoints()
    );

    this.state = 'playing';
    this.ui.showGameplayHUD();
    this.input.setEnabled(true);
    this.input.requestPointerLock();
  }

  private handleServerSnapshot(snapshot: NetRoomState): void {
    const myId = this.netClient.myPlayerId;

    if (snapshot.phase === 'lobby') {
      if (this.state !== 'lobby') {
        this.state = 'lobby';
        this.ui.showWaitingRoomLobby();
      }
      this.ui.updateLobbyState(snapshot, myId);
      return;
    }

    if (
      snapshot.phase === 'playing' &&
      (this.state === 'lobby' ||
        (this.state === 'result' && this.missions.mode === 'coop'))
    ) {
      this.enterCoopGameplay(snapshot);
    }

    // Reconcile local player with authoritative server state
    const localNet = snapshot.players[myId];
    if (localNet && this.missions.mode === 'coop') {
      this.player.health = localNet.health;
      this.player.maxHealth = localNet.maxHealth;
      this.player.gas = localNet.gas;
      this.player.bladeDurability = localNet.bladeDurability;
      this.player.spareBlades = localNet.spareBlades;

      const isDownedOrDead =
        localNet.lifeState === 'downed' || localNet.lifeState === 'dead';

      if (isDownedOrDead) {
        this.odm.releaseAll();
        this.player.isBoosting = false;
        this.player.position.set(...localNet.position);
        this.player.velocity.set(...localNet.velocity);
        this.physics.setPlayerPosition(this.player.position);
        this.player.animator.playState(
          localNet.lifeState === 'downed' ? 'HitReaction' : 'Death',
          0.15
        );
        this.wasLocalDownedOrDead = true;
      } else {
        if (this.wasLocalDownedOrDead) {
          this.wasLocalDownedOrDead = false;
          this.player.animator.playState('Idle', 0.1, true);
          this.ui.showCombatBanner('REVIVED BY SQUAD — BACK IN ACTION!');
        }

        const recon = this.netClient.reconcilePrediction(
          localNet.lastAckedSeq,
          localNet.position,
          localNet.velocity
        );
        if (recon.needsCorrection) {
          const distErr = this.player.position.distanceTo(recon.authPosition);
          if (distErr > 4.0) {
            this.player.position.copy(recon.authPosition);
            this.player.velocity.copy(recon.authVelocity);
          } else {
            this.player.position.lerp(recon.authPosition, 0.35);
            this.player.velocity.lerp(recon.authVelocity, 0.35);
          }
          this.physics.setPlayerPosition(this.player.position);
        }

        // Sync authoritative hook release if server rejected/detached a hook
        if (!localNet.leftHook.active && this.odm.leftHook.active) {
          this.odm.releaseHook('left');
        }
        if (!localNet.rightHook.active && this.odm.rightHook.active) {
          this.odm.releaseHook('right');
        }
      }
    }

    // Push snapshot to RemotePlayerManager for interpolation of teammates
    this.remotePlayers.syncFromRoomSnapshot(snapshot.players, myId);

    // Sync any newly added team pings into quick chat bubble display
    if (snapshot.pings.length > 0) {
      const latestPing = snapshot.pings[snapshot.pings.length - 1];
      if (Date.now() - latestPing.createdAt < 1200) {
        this.ui.recordQuickChatBubble(
          latestPing.senderId,
          latestPing.message
        );
      }
    }

    // Check Victory / Defeat transition in Co-op mode
    if (
      (snapshot.phase === 'victory' || snapshot.phase === 'defeat') &&
      this.state !== 'result'
    ) {
      this.missions.syncCoopFromServer(snapshot, 0.016, this.player.position);
      this.state = 'result';
      this.coopOverlayOpen = false;
      this.input.setEnabled(false);
      const status = this.missions.getStatus();
      this.saveMgr.recordMissionResult(
        'hunt',
        status.score,
        status.rank,
        status.kills,
        status.elapsedSeconds
      );
      this.ui.showResultScreen(status, snapshot);
    }
  }

  private handleServerCombatEvent(evt: S2C_CombatEvent): void {
    const impactPos = new THREE.Vector3(...evt.worldPos);
    const myId = this.netClient.myPlayerId;

    if (
      evt.type === 'damage_applied' ||
      evt.type === 'limb_broken' ||
      evt.type === 'titan_stunned' ||
      evt.type === 'titan_killed'
    ) {
      const isCrit = evt.zone === 'Nape' && !evt.glanced;
      this.audio.playBladeImpact(isCrit, Boolean(evt.glanced));
      this.vfx.spawnImpactBurst(impactPos, isCrit, Boolean(evt.glanced));
      if (evt.attackerId === myId) {
        this.actionCam.addShake(isCrit ? 0.36 : 0.2, 0.22);
      }
      this.ui.showCombatBanner(evt.message);
    } else if (evt.type === 'player_damaged' || evt.type === 'player_downed') {
      if (evt.targetPlayerId === myId) {
        this.ui.flashDamageVignette();
        this.actionCam.addShake(0.35, 0.25);
        this.audio.playBladeImpact(false, false);
      }
      this.ui.showCombatBanner(evt.message);
    } else if (evt.type === 'player_revived' || evt.type === 'resupply') {
      this.audio.playResupply();
      this.ui.showCombatBanner(evt.message);
    } else if (evt.type === 'perfect_dodge') {
      this.ui.showCombatBanner(evt.message);
    }
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
    this.remotePlayers.clearAll();

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
    this.coopOverlayOpen = false;

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
    if (this.missions.mode === 'coop') {
      if (this.netClient.connectionState === 'connected') {
        this.netClient.sendLobbyAction({ action: 'restart_match' });
      }
      return;
    }
    this.startGame(this.missions.mode);
    this.ui.showGameplayHUD();
  }

  public pauseGame(): void {
    if (this.state !== 'playing') return;
    if (this.missions.mode === 'coop') {
      // Section 11: Pausing on one client never pauses the multiplayer room simulation
      this.coopOverlayOpen = true;
      this.input.setEnabled(false);
      this.ui.setPaused(true);
      return;
    }
    this.state = 'paused';
    this.input.setEnabled(false);
    this.ui.setPaused(true);
  }

  public resumeGame(): void {
    if (this.missions.mode === 'coop' && this.coopOverlayOpen) {
      this.coopOverlayOpen = false;
      this.ui.setPaused(false);
      this.input.setEnabled(true);
      this.input.requestPointerLock();
      return;
    }
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.setPaused(false);
    this.input.setEnabled(true);
    this.input.requestPointerLock();
  }

  public returnToMainMenu(): void {
    if (this.netClient.room) {
      void this.netClient.leaveRoom();
    }
    this.state = 'menu';
    this.coopOverlayOpen = false;
    this.input.setEnabled(false);
    this.odm.releaseAll();
    this.vfx.clearAll();
    this.missions.clearTitans();
    this.remotePlayers.clearAll();
    this.ui.showMainMenu(this.saveMgr.getProgress());
  }

  private loop(nowMs: number): void {
    requestAnimationFrame((t) => this.loop(t));

    const rawDt = Math.min(
      0.1,
      Math.max(0.0001, (nowMs - this.lastFrameTime) / 1000)
    );
    this.lastFrameTime = nowMs;
    this.fpsSmoothed = this.fpsSmoothed * 0.92 + (1 / rawDt) * 0.08;

    if (this.state === 'menu' || this.state === 'lobby') {
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
      if (this.missions.mode === 'coop' && this.netClient.latestState) {
        this.remotePlayers.update(rawDt, this.vfx);
        this.missions.syncCoopFromServer(
          this.netClient.latestState,
          rawDt,
          this.player.position
        );
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
      if (this.coopOverlayOpen) {
        this.resumeGame();
      } else {
        this.pauseGame();
        if (this.missions.mode !== 'coop') return;
      }
    }

    const isCoop = this.missions.mode === 'coop';

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

    // Handle Co-op Team Ping (G) & Quick Chat (1-4)
    if (isCoop && this.netClient.connectionState === 'connected') {
      if (inputState.pingJustPressed) {
        const locked = this.combat.lockedTitan;
        if (locked && !locked.isDead()) {
          this.netClient.sendTeamPing({
            targetTitanId: locked.id,
            worldPos: [
              locked.position.x,
              locked.position.y + locked.heightMeters * 0.85,
              locked.position.z,
            ],
          });
        } else {
          const preview = this.odm.probeReticleTarget(
            this.actionCam.camera.position,
            this.actionCam.getForwardVector(),
            this.player.position,
            this.missions.titans,
            null,
            'Nape'
          );
          const pt = preview.point
            ? preview.point
            : this.player.position
                .clone()
                .addScaledVector(this.actionCam.getForwardVector(), 30);
          this.netClient.sendTeamPing({
            targetTitanId: null,
            worldPos: [pt.x, pt.y, pt.z],
          });
        }
      }

      if (inputState.quickChatKey) {
        const presetKey = QUICK_CHAT_KEY_MAP[inputState.quickChatKey];
        if (presetKey) {
          this.netClient.sendTeamPing({
            targetTitanId: this.combat.lockedTitan?.id || null,
            worldPos: [
              this.player.position.x,
              this.player.position.y + 2.0,
              this.player.position.z,
            ],
            quickChatKey: presetKey,
          });
        }
      }
    }

    // Hit-stop pauses simulation briefly on heavy blade impact ONLY in single-player!
    // Section 11: In Co-op mode, local hit-stop must NEVER pause simulation or network updates.
    if (!isCoop && this.combat.hitStopTimer > 0) {
      this.combat.hitStopTimer = Math.max(0, this.combat.hitStopTimer - rawDt);
      this.rendererMgr.renderer.render(
        this.rendererMgr.scene,
        this.actionCam.camera
      );
      return;
    } else if (isCoop && this.combat.hitStopTimer > 0) {
      this.combat.hitStopTimer = Math.max(0, this.combat.hitStopTimer - rawDt);
    }

    // =========================================================================
    // Fixed-Timestep Physics & AI Simulation Loop (60 Hz)
    // =========================================================================
    this.physicsAccumulator += rawDt;
    const fixedDt = GAME_CONFIG.physics.fixedTimestep;
    let steps = 0;

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
        pingJustPressed: false,
        quickChatKey: null,
        pauseJustPressed: false,
        mouseDeltaX: 0,
        mouseDeltaY: 0,
      };
    }

    // =========================================================================
    // Frame-Rate Independent Visuals, Camera, Combat Sweep & HUD Update
    // =========================================================================
    this.player.updateVisuals(rawDt, this.odm);

    if (isCoop) {
      this.remotePlayers.update(rawDt, this.vfx);
      if (this.netClient.latestState) {
        this.missions.syncCoopFromServer(
          this.netClient.latestState,
          rawDt,
          this.player.position,
          (dist) => this.audio.playTitanStep(dist)
        );
      }
    }

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
      if (isCoop && this.netClient.connectionState === 'connected') {
        this.trySendCoopAttackIntent(nowMs);
      }
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

    if (!isCoop) {
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
    } else {
      // In Co-op mode, advance local attack cooldown timers and send attack intent if blade sweeps near a Titan
      this.combat.update(
        rawDt,
        this.player.position,
        this.player.velocity,
        this.player.bladeDurability,
        lHilt,
        lTip,
        rHilt,
        rTip,
        [],
        () => {}
      );
      if (this.combat.isCurrentlyAttacking()) {
        this.trySendCoopAttackIntent(nowMs);
      }
    }

    // Update Camera
    const lockedZoneWorld =
      this.combat.lockedTitan && !this.combat.lockedTitan.isDead()
        ? this.combat.lockedTitan.hurtboxes[this.combat.lockedZone].worldPosition
        : null;

    this.actionCam.update(
      rawDt,
      this.coopOverlayOpen ? 0 : inputState.mouseDeltaX,
      this.coopOverlayOpen ? 0 : inputState.mouseDeltaY,
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

    // Update Mission & Check Victory / Defeat (Single-Player)
    if (!isCoop) {
      this.missions.update(
        rawDt,
        this.player,
        this.combat.lockedTitan,
        this.cityBuilder.getTrainingRings()
      );
    }
    const missionStatus = this.missions.getStatus();

    if (!isCoop && (missionStatus.completed || missionStatus.failed)) {
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
      coopSnapshot: isCoop ? this.netClient.latestState : null,
      localSessionId: isCoop ? this.netClient.myPlayerId : undefined,
      remotePlayers: isCoop
        ? Array.from(this.remotePlayers.remotePlayers.values())
        : undefined,
      pingMs: isCoop ? this.netClient.rttMs : 0,
      reconnecting:
        isCoop && this.netClient.connectionState === 'reconnecting',
    });

    this.rendererMgr.renderer.render(
      this.rendererMgr.scene,
      this.actionCam.camera
    );
  }

  private trySendCoopAttackIntent(nowMs: number): void {
    if (nowMs - this.lastAttackIntentSentAt < 260) return;

    let bestTitan = this.combat.lockedTitan;
    let bestZone = this.combat.lockedZone;
    let bestDist = Infinity;

    if (bestTitan && !bestTitan.isDead()) {
      bestDist = bestTitan.hurtboxes[bestZone].worldPosition.distanceTo(
        this.player.position
      );
    } else {
      for (const t of this.missions.titans) {
        if (t.isDead()) continue;
        const d = t.hurtboxes.Nape.worldPosition.distanceTo(this.player.position);
        if (d < bestDist) {
          bestDist = d;
          bestTitan = t;
          bestZone = 'Nape';
        }
      }
    }

    if (bestTitan && bestDist <= 10.5) {
      this.lastAttackIntentSentAt = nowMs;
      this.netClient.sendAttackIntent({
        seq: this.netClient.nextInputSequence(),
        isHeavy: this.player.isBoosting || this.player.velocity.length() > 22,
        aimYaw: this.actionCam.yaw,
        targetTitanId: bestTitan.id,
        targetZone: bestZone,
        clientRttMs: this.netClient.rttMs,
      });
    }
  }

  private stepSimulation(
    dt: number,
    inputState: ReturnType<InputManager['sampleState']>
  ): void {
    const isCoop = this.missions.mode === 'coop';

    if (isCoop) {
      const myNet =
        this.netClient.latestState?.players[this.netClient.myPlayerId];
      const isDownedOrDead =
        myNet?.lifeState === 'downed' || myNet?.lifeState === 'dead';

      if (!isDownedOrDead) {
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
      }

      if (this.netClient.connectionState === 'connected') {
        const seq = this.netClient.nextInputSequence();
        const camForward = this.actionCam.getForwardVector();
        const camRight = this.actionCam.getRightVector();
        const camOrigin = this.actionCam.camera.position;

        const leftAction: C2S_InputFrame['leftGrappleAction'] =
          this.coopOverlayOpen
            ? 'none'
            : inputState.leftGrappleJustPressed
              ? 'fire'
              : inputState.leftGrappleHeld
                ? 'hold'
                : this.odm.leftHook.active
                  ? 'release'
                  : 'none';

        const rightAction: C2S_InputFrame['rightGrappleAction'] =
          this.coopOverlayOpen
            ? 'none'
            : inputState.rightGrappleJustPressed
              ? 'fire'
              : inputState.rightGrappleHeld
                ? 'hold'
                : this.odm.rightHook.active
                  ? 'release'
                  : 'none';

        const frame: C2S_InputFrame = {
          seq,
          clientTimeMs: Date.now(),
          dt,
          moveForward: this.coopOverlayOpen ? 0 : inputState.moveForward,
          moveRight: this.coopOverlayOpen ? 0 : inputState.moveRight,
          jumpPressed: !this.coopOverlayOpen && inputState.jumpPressed,
          boostHeld: !this.coopOverlayOpen && inputState.boostHeld,
          dodgePressed: !this.coopOverlayOpen && inputState.dodgeJustPressed,
          resupplyPressed:
            !this.coopOverlayOpen && inputState.resupplyJustPressed,
          reviveHeld: !this.coopOverlayOpen && inputState.interactHeld,
          yaw: this.actionCam.yaw,
          pitch: this.actionCam.pitch,
          camOrigin: [camOrigin.x, camOrigin.y, camOrigin.z],
          camForward: [camForward.x, camForward.y, camForward.z],
          camRight: [camRight.x, camRight.y, camRight.z],
          leftGrappleAction: leftAction,
          rightGrappleAction: rightAction,
          lockedTitanId: this.combat.lockedTitan?.id || null,
          lockedZone: this.combat.lockedZone,
        };

        this.netClient.sendInputFrame(frame);
        this.netClient.recordPrediction(
          seq,
          frame,
          this.player.position,
          this.player.velocity
        );
      }
      return;
    }

    // Single-Player Simulation ('hunt' | 'training')
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
