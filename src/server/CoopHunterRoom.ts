import { Client, Room } from '@colyseus/core';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { PlayerAnimName } from '../animation/HumanoidRigBuilder';
import { GAME_CONFIG } from '../config/GameConfig';
import { TitanVariant, TitanZoneType } from '../enemies/TitanRigBuilder';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import {
  CityLayoutData,
  populateCityPhysicsWorld,
} from '../shared/CityLayout';
import {
  C2S_AttackIntent,
  C2S_InputFrame,
  C2S_LobbyAction,
  C2S_PingRTT,
  C2S_TeamPing,
  isValidFiniteVec3,
  NetHookState,
  NetPingMarker,
  NetPlayerState,
  NetRoomState,
  PlayerLifeState,
  QUICK_CHAT_PRESETS,
  RoomPhase,
  S2C_CombatEvent,
  sanitizeNickname,
  SQUAD_COLORS,
  validateAndSanitizeInputFrame,
  validateAttackIntent,
} from '../shared/Protocol';
import { ServerPlayerTarget, ServerTitan } from '../shared/ServerTitanSim';
import {
  findBestWorldGrapplePoint,
  HookFireDebugInfo,
  HookFireResultReason,
  validateServerWorldAnchorHint,
} from '../shared/WorldGrappleSolver';
import {
  calculateStrikeDamage,
  clamp,
  evaluateNapeApproachCos,
  lerpAngle,
  RopeAnchorConstraintInput,
  solveODMRopeConstraints,
} from '../utils/MathUtils';

interface ServerHook {
  side: 'left' | 'right';
  active: boolean;
  anchorPos: THREE.Vector3;
  restLength: number;
  isTaut: boolean;
  attachedTitanId: string | null;
  attachedZone: TitanZoneType | null;
}

interface ServerPlayerSession {
  id: string;
  sessionToken: string;
  tokenIssuedAtMs: number;
  client: Client;
  nickname: string;
  colorHex: number;
  connected: boolean;
  ready: boolean;
  isLeader: boolean;
  lifeState: PlayerLifeState;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  grounded: boolean;
  isBoosting: boolean;
  anim: PlayerAnimName;
  health: number;
  maxHealth: number;
  gas: number;
  maxGas: number;
  bladeDurability: number;
  spareBlades: number;
  thunderSpears: number;
  grabbedByTitanId: string | null;
  grabEscapeProgress: number;
  grabHoldRemaining: number;
  leftHook: ServerHook;
  rightHook: ServerHook;
  downedTimer: number;
  reviveProgress: number;
  reviverId: string | null;
  reviveHoldActive: boolean;
  kills: number;
  assists: number;
  score: number;
  damageDealt: number;
  lastAckedSeq: number;
  lastReceivedSeq: number;
  lastAttackSeq: number;

  // Cooldowns & security rate-limiting
  dodgeUntilMs: number;
  perfectDodgeUntilMs: number;
  dodgeCooldownUntilMs: number;
  invulnerableUntilMs: number;
  attackActiveUntilMs: number;
  nextAttackAllowedMs: number;
  nextThunderSpearAllowedMs: number;
  leftHookRetryAfterMs: number;
  rightHookRetryAfterMs: number;
  lastLeftHookDebug: HookFireDebugInfo | null;
  lastRightHookDebug: HookFireDebugInfo | null;
  inputQueue: C2S_InputFrame[];
  packetsThisSecond: number;
  rateWindowStartMs: number;
}

const SESSION_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

function generateSessionToken(): string {
  return `st_${crypto.randomBytes(24).toString('hex')}`;
}

// Active room code registry for lookup by 6-char room code
export const activeRoomsByCode = new Map<
  string,
  { roomId: string; roomCode: string; roomName: string; isPublic: boolean; roomRef: CoopHunterRoom }
>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export class CoopHunterRoom extends Room {
  public maxClients = 8; // Enforced at 4 active players via onAuth; headroom allows seamless sessionToken socket handoff
  public roomCode = '';
  public customRoomName = 'Valkenburg Squad';
  public isPublic = true;
  public phase: RoomPhase = 'lobby';
  public leaderId = '';
  public readonly hookDebugLog: HookFireDebugInfo[] = [];

  // Authoritative Telemetry & Security Counters
  public lastTickDurationMs = 0;
  public maxTickDurationMs = 0;
  public tickOverrunCount = 0;
  public rejectedInputCount = 0;
  public rejectedAttackCount = 0;
  public hookRejectCount = 0;

  private physics!: PhysicsWorld;
  private cityLayout!: CityLayoutData;
  private players: Map<string, ServerPlayerSession> = new Map();
  private tokenToPlayerId: Map<string, string> = new Map();
  private titans: Map<string, ServerTitan> = new Map();
  private pings: NetPingMarker[] = [];

  private serverTick = 0;
  private wave = 1;
  private maxWaves = 2;
  private totalKills = 0;
  private targetKills = 6;
  private teamScore = 0;
  private elapsedSeconds = 0;
  private nextTitanSeq = 1;
  private simInterval: ReturnType<typeof setInterval> | null = null;
  private broadcastInterval: ReturnType<typeof setInterval> | null = null;

  public getPhysicsWorld(): PhysicsWorld {
    return this.physics;
  }

  public getRoomMetrics() {
    return {
      roomId: this.roomId,
      roomCode: this.roomCode,
      phase: this.phase,
      serverTick: this.serverTick,
      playerCount: this.players.size,
      titanCount: this.titans.size,
      physicsActorCount: this.physics ? this.physics.getPlayerActorCount() : 0,
      lastTickDurationMs: Math.round(this.lastTickDurationMs * 100) / 100,
      maxTickDurationMs: Math.round(this.maxTickDurationMs * 100) / 100,
      tickOverrunCount: this.tickOverrunCount,
      rejectedInputCount: this.rejectedInputCount,
      rejectedAttackCount: this.rejectedAttackCount,
      hookRejectCount: this.hookRejectCount,
    };
  }

  public async onCreate(options: any): Promise<void> {
    this.roomCode = generateRoomCode();
    while (activeRoomsByCode.has(this.roomCode)) {
      this.roomCode = generateRoomCode();
    }
    this.customRoomName = sanitizeNickname(options?.roomName, 'Valkenburg Squad');
    this.isPublic = options?.isPublic !== false;

    if (!this.isPublic) {
      await this.setPrivate(true);
    }

    activeRoomsByCode.set(this.roomCode, {
      roomId: this.roomId,
      roomCode: this.roomCode,
      roomName: this.customRoomName,
      isPublic: this.isPublic,
      roomRef: this,
    });

    await this.setMetadata({
      roomCode: this.roomCode,
      roomName: this.customRoomName,
      isPublic: this.isPublic,
      phase: this.phase,
    });

    this.physics = new PhysicsWorld();
    await this.physics.init(false);
    this.cityLayout = populateCityPhysicsWorld(this.physics);

    this.registerMessageHandlers();

    // 60 Hz authoritative simulation loop
    const fixedDt = GAME_CONFIG.physics.fixedTimestep;
    this.simInterval = setInterval(() => {
      this.stepAuthoritativeSimulation(fixedDt);
    }, 1000 / 60);

    // 20 Hz state snapshot broadcast loop
    this.broadcastInterval = setInterval(() => {
      this.broadcastSnapshot();
    }, 50);
  }

  private isValidActiveSessionToken(token: string): boolean {
    if (!token || typeof token !== 'string' || !token.startsWith('st_')) {
      return false;
    }
    const oldId = this.tokenToPlayerId.get(token);
    if (!oldId) return false;
    const existing = this.players.get(oldId);
    if (!existing) {
      this.tokenToPlayerId.delete(token);
      return false;
    }
    if (Date.now() - existing.tokenIssuedAtMs > SESSION_TOKEN_TTL_MS) {
      this.tokenToPlayerId.delete(token);
      return false;
    }
    return true;
  }

  public onAuth(_client: Client, options: any): boolean {
    const token =
      typeof options?.sessionToken === 'string' ? options.sessionToken : '';
    const isReconnecting = this.isValidActiveSessionToken(token);
    if (this.players.size >= 4 && !isReconnecting) {
      throw new Error('Room is full (maximum 4 players).');
    }
    return true;
  }

  public onJoin(client: Client, options: any): void {
    const requestedToken =
      typeof options?.sessionToken === 'string' ? options.sessionToken : '';

    // Check if this is a reconnecting player with an active, non-expired server-issued session token
    if (this.isValidActiveSessionToken(requestedToken)) {
      const oldId = this.tokenToPlayerId.get(requestedToken)!;
      const existing = this.players.get(oldId);
      if (existing) {
        if (oldId !== client.sessionId) {
          this.players.delete(oldId);
          this.physics.removePlayerActor(oldId);
        }
        existing.id = client.sessionId;
        existing.client = client;
        existing.connected = true;
        existing.tokenIssuedAtMs = Date.now();
        this.physics.ensurePlayerActor(client.sessionId, existing.position);
        this.players.set(client.sessionId, existing);
        this.tokenToPlayerId.set(existing.sessionToken, client.sessionId);
        if (this.leaderId === oldId) {
          this.leaderId = client.sessionId;
          existing.isLeader = true;
        }
        client.send('session_welcome', {
          playerId: client.sessionId,
          sessionToken: existing.sessionToken,
          roomCode: this.roomCode,
        });
        this.broadcastSnapshot();
        return;
      }
    }

    const slotIdx = this.players.size % 4;
    const spawnPos =
      this.cityLayout.playerSpawnPoints[slotIdx] ??
      new THREE.Vector3(0, 0.2, 24);
    // Always generate a cryptographic session token on the server; never trust a client-invented token
    const sessionToken = generateSessionToken();
    const nickname = sanitizeNickname(
      options?.nickname,
      `Strider-${this.players.size + 1}`
    );

    const isFirst = this.players.size === 0 || !this.leaderId;
    if (isFirst) {
      this.leaderId = client.sessionId;
    }

    this.physics.ensurePlayerActor(client.sessionId, spawnPos);

    const player: ServerPlayerSession = {
      id: client.sessionId,
      sessionToken,
      tokenIssuedAtMs: Date.now(),
      client,
      nickname,
      colorHex: SQUAD_COLORS[slotIdx],
      connected: true,
      ready: isFirst, // Leader defaults to ready
      isLeader: isFirst,
      lifeState: 'alive',
      position: spawnPos.clone(),
      velocity: new THREE.Vector3(),
      yaw: Math.PI,
      grounded: true,
      isBoosting: false,
      anim: 'Idle',
      health: GAME_CONFIG.player.maxHealth,
      maxHealth: GAME_CONFIG.player.maxHealth,
      gas: GAME_CONFIG.player.maxGas,
      maxGas: GAME_CONFIG.player.maxGas,
      bladeDurability: GAME_CONFIG.player.maxBladeDurability,
      spareBlades: GAME_CONFIG.player.maxSpareBlades,
      thunderSpears: GAME_CONFIG.player.maxThunderSpears,
      grabbedByTitanId: null,
      grabEscapeProgress: 0,
      grabHoldRemaining: 0,
      leftHook: {
        side: 'left',
        active: false,
        anchorPos: new THREE.Vector3(),
        restLength: 0,
        isTaut: false,
        attachedTitanId: null,
        attachedZone: null,
      },
      rightHook: {
        side: 'right',
        active: false,
        anchorPos: new THREE.Vector3(),
        restLength: 0,
        isTaut: false,
        attachedTitanId: null,
        attachedZone: null,
      },
      downedTimer: 0,
      reviveProgress: 0,
      reviverId: null,
      reviveHoldActive: false,
      kills: 0,
      assists: 0,
      score: 0,
      damageDealt: 0,
      lastAckedSeq: 0,
      lastReceivedSeq: 0,
      lastAttackSeq: 0,
      dodgeUntilMs: 0,
      perfectDodgeUntilMs: 0,
      dodgeCooldownUntilMs: 0,
      invulnerableUntilMs: 0,
      attackActiveUntilMs: 0,
      nextAttackAllowedMs: 0,
      nextThunderSpearAllowedMs: 0,
      leftHookRetryAfterMs: 0,
      rightHookRetryAfterMs: 0,
      lastLeftHookDebug: null,
      lastRightHookDebug: null,
      inputQueue: [],
      packetsThisSecond: 0,
      rateWindowStartMs: Date.now(),
    };

    this.players.set(client.sessionId, player);
    this.tokenToPlayerId.set(sessionToken, client.sessionId);

    client.send('session_welcome', {
      playerId: client.sessionId,
      sessionToken,
      roomCode: this.roomCode,
    });

    this.broadcastSnapshot();
  }

  public async onLeave(client: Client, codeOrConsented?: number | boolean): Promise<void> {
    const consented =
      codeOrConsented === true ||
      codeOrConsented === 1000 ||
      codeOrConsented === 4000;
    const player = this.players.get(client.sessionId);
    if (!player) return;

    player.connected = false;
    player.leftHook.active = false;
    player.rightHook.active = false;
    player.isBoosting = false;
    player.reviveHoldActive = false;
    this.reassignLeaderIfNeeded();
    this.broadcastSnapshot();

    if (!consented) {
      // Allow 20-second reconnection grace period on unexpected disconnect
      try {
        await this.allowReconnection(client, 20);
        player.connected = true;
        this.broadcastSnapshot();
        return;
      } catch {
        // Grace period expired; remove player cleanly
      }
    }

    // If the player reconnected under a new sessionId during the grace window, do not delete the new session
    const currentMappedId = this.tokenToPlayerId.get(player.sessionToken);
    if (currentMappedId === client.sessionId) {
      this.tokenToPlayerId.delete(player.sessionToken);
    }
    this.players.delete(client.sessionId);
    this.physics.removePlayerActor(client.sessionId);
    this.reassignLeaderIfNeeded();
    this.checkSquadDefeatCondition();
    this.broadcastSnapshot();
  }

  public onDispose(): void {
    if (this.simInterval) clearInterval(this.simInterval);
    if (this.broadcastInterval) clearInterval(this.broadcastInterval);
    activeRoomsByCode.delete(this.roomCode);
    if (this.physics) {
      this.physics.dispose();
    }
  }

  private reassignLeaderIfNeeded(): void {
    const currentLeader = this.players.get(this.leaderId);
    if (currentLeader && currentLeader.connected) return;

    for (const p of this.players.values()) {
      p.isLeader = false;
    }
    for (const p of this.players.values()) {
      if (p.connected) {
        this.leaderId = p.id;
        p.isLeader = true;
        return;
      }
    }
    this.leaderId = '';
  }

  private checkRateLimit(player: ServerPlayerSession): boolean {
    const now = Date.now();
    if (now - player.rateWindowStartMs >= 1000) {
      player.rateWindowStartMs = now;
      player.packetsThisSecond = 0;
    }
    player.packetsThisSecond++;
    return player.packetsThisSecond <= 140;
  }

  private registerMessageHandlers(): void {
    // 0. Client Welcome & Initial Snapshot Handshake
    this.onMessage('request_welcome', (client) => {
      const player = this.players.get(client.sessionId);
      if (!player) return;
      client.send('session_welcome', {
        playerId: player.id,
        sessionToken: player.sessionToken,
        roomCode: this.roomCode,
      });
      client.send('room_snapshot', this.getRoomSnapshot());
    });

    // 1. Lobby Actions (Ready, Unready, Start Match, Restart Match, Nickname)
    this.onMessage('lobby_action', (client, payload: C2S_LobbyAction) => {
      const player = this.players.get(client.sessionId);
      if (!player || !payload || typeof payload.action !== 'string') return;

      if (payload.action === 'set_nickname' && payload.nickname) {
        player.nickname = sanitizeNickname(payload.nickname, player.nickname);
      } else if (payload.action === 'ready') {
        player.ready = true;
      } else if (payload.action === 'unready') {
        player.ready = false;
      } else if (payload.action === 'start_match') {
        if (player.id !== this.leaderId) {
          client.send('room_error', {
            code: 'NOT_LEADER',
            message: 'Only the Squad Leader can start the mission.',
          });
          return;
        }
        // Check all connected players are ready
        const allReady = Array.from(this.players.values()).every(
          (p) => !p.connected || p.ready || p.isLeader
        );
        if (!allReady) {
          client.send('room_error', {
            code: 'PLAYERS_NOT_READY',
            message: 'All squad members must be Ready before deploying.',
          });
          return;
        }
        this.startCoopMatch();
      } else if (payload.action === 'restart_match') {
        if (player.id === this.leaderId) {
          this.startCoopMatch();
        }
      }
      this.broadcastSnapshot();
    });

    // 2. Player Movement & ODM Input Frame (30-60 Hz)
    this.onMessage('input_frame', (client, rawFrame: unknown) => {
      const player = this.players.get(client.sessionId);
      if (!player || !this.checkRateLimit(player)) {
        this.rejectedInputCount++;
        return;
      }
      const frame = validateAndSanitizeInputFrame(
        rawFrame,
        player.lastReceivedSeq
      );
      if (!frame) {
        this.rejectedInputCount++;
        return;
      }
      player.lastReceivedSeq = frame.seq;

      // Bound input queue to prevent flood/memory growth
      if (player.inputQueue.length >= 16) {
        player.inputQueue.shift();
      }
      player.inputQueue.push(frame);
    });

    // 3. Authoritative Attack Intent
    this.onMessage('attack_intent', (client, rawIntent: unknown) => {
      const player = this.players.get(client.sessionId);
      if (!player || !this.checkRateLimit(player)) {
        this.rejectedAttackCount++;
        return;
      }
      const intent = validateAttackIntent(rawIntent, player.lastAttackSeq);
      if (!intent) {
        this.rejectedAttackCount++;
        return;
      }
      player.lastAttackSeq = intent.seq;
      this.handleAuthoritativeAttack(player, intent);
    });

    // 4. Team Ping & Quick Chat
    this.onMessage('team_ping', (client, ping: C2S_TeamPing) => {
      const player = this.players.get(client.sessionId);
      if (!player || !this.checkRateLimit(player) || !ping) return;
      if (!isValidFiniteVec3(ping.worldPos)) return;

      const chatText =
        ping.quickChatKey && QUICK_CHAT_PRESETS[ping.quickChatKey]
          ? QUICK_CHAT_PRESETS[ping.quickChatKey]
          : 'Target Pinged!';

      const marker: NetPingMarker = {
        id: `ping_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        senderId: player.id,
        senderName: player.nickname,
        position: ping.worldPos,
        targetTitanId:
          typeof ping.targetTitanId === 'string' ? ping.targetTitanId : null,
        message: chatText,
        createdAt: Date.now(),
      };
      this.pings.push(marker);
      if (this.pings.length > 8) this.pings.shift();
      this.broadcastSnapshot();
    });

    // 5. RTT Ping Measurement
    this.onMessage('ping_rtt', (client, msg: C2S_PingRTT) => {
      if (!msg || typeof msg.clientSendMs !== 'number') return;
      client.send('pong_rtt', {
        clientSendMs: msg.clientSendMs,
        serverTimeMs: Date.now(),
      });
    });
  }

  public startCoopMatch(): void {
    this.phase = 'playing';
    this.wave = 1;
    this.maxWaves = 2;
    this.totalKills = 0;
    const playerCount = Math.max(1, this.players.size);
    const wave1Count = Math.min(5, 2 + playerCount);
    const wave2Count = Math.min(6, 3 + playerCount);
    this.targetKills = wave1Count + wave2Count;
    this.teamScore = 0;
    this.elapsedSeconds = 0;
    this.titans.clear();
    this.pings = [];

    let idx = 0;
    for (const p of this.players.values()) {
      const sp =
        this.cityLayout.playerSpawnPoints[idx % 4] ??
        new THREE.Vector3(0, 0.2, 24);
      idx++;
      p.lifeState = 'alive';
      p.position.copy(sp);
      p.velocity.set(0, 0, 0);
      p.yaw = Math.PI;
      p.grounded = true;
      p.isBoosting = false;
      p.anim = 'Idle';
      p.health = p.maxHealth;
      p.gas = p.maxGas;
      p.bladeDurability = GAME_CONFIG.player.maxBladeDurability;
      p.spareBlades = GAME_CONFIG.player.maxSpareBlades;
      p.thunderSpears = GAME_CONFIG.player.maxThunderSpears;
      p.grabbedByTitanId = null;
      p.grabEscapeProgress = 0;
      p.grabHoldRemaining = 0;
      p.leftHook.active = false;
      p.leftHook.isTaut = false;
      p.leftHook.attachedTitanId = null;
      p.leftHook.attachedZone = null;
      p.rightHook.active = false;
      p.rightHook.isTaut = false;
      p.rightHook.attachedTitanId = null;
      p.rightHook.attachedZone = null;
      p.downedTimer = 0;
      p.reviveProgress = 0;
      p.reviverId = null;
      p.kills = 0;
      p.assists = 0;
      p.score = 0;
      p.damageDealt = 0;
      p.inputQueue = [];
      this.physics.ensurePlayerActor(p.id, sp);
      this.physics.setPlayerPosition(sp, p.id);
    }

    this.spawnWaveTitans(1, wave1Count);
    this.setMetadata({
      roomCode: this.roomCode,
      roomName: this.customRoomName,
      isPublic: this.isPublic,
      phase: this.phase,
    }).catch(() => {});
    this.broadcastSnapshot();
  }

  private spawnWaveTitans(wave: number, count: number): void {
    const spawns = this.cityLayout.titanSpawnPoints;
    const variants: TitanVariant[] =
      wave === 1
        ? ['normal', 'normal', 'abnormal', 'normal', 'abnormal']
        : ['normal', 'abnormal', 'large', 'abnormal', 'large', 'normal'];

    for (let i = 0; i < count; i++) {
      const variant = variants[i % variants.length];
      const basePt = spawns[(i + wave * 2) % spawns.length];
      const pos = new THREE.Vector3(
        basePt.x + (i % 2 === 0 ? -6 : 6),
        0,
        basePt.z + (i % 3 === 0 ? -6 : 6)
      );
      const id = `titan_${this.nextTitanSeq++}`;
      const titan = new ServerTitan(id, variant, pos);
      titan.yaw = Math.atan2(-pos.x, -pos.z);
      this.titans.set(id, titan);
    }
  }

  /**
   * Coalesces all queued client input frames received during the current server tick window
   * into a single authoritative tick input so a client sending multiple frames per tick
   * cannot advance physics faster than the server's fixed timestep, while preserving edge-triggered actions.
   */
  private coalesceInputBatch(batch: C2S_InputFrame[]): C2S_InputFrame {
    const latest = batch[batch.length - 1];
    if (batch.length === 1) return latest;

    let jumpPressed = false;
    let dodgePressed = false;
    let resupplyPressed = false;
    let escapePressed = false;

    let leftAction: C2S_InputFrame['leftGrappleAction'] =
      latest.leftGrappleAction;
    let leftTarget = latest.leftGrappleTarget;
    let rightAction: C2S_InputFrame['rightGrappleAction'] =
      latest.rightGrappleAction;
    let rightTarget = latest.rightGrappleTarget;

    let sawLeftFire = false;
    let sawLeftFireTarget: [number, number, number] | null | undefined = null;
    let sawRightFire = false;
    let sawRightFireTarget: [number, number, number] | null | undefined = null;

    for (const f of batch) {
      if (f.jumpPressed) jumpPressed = true;
      if (f.dodgePressed) dodgePressed = true;
      if (f.resupplyPressed) resupplyPressed = true;
      if (f.escapePressed) escapePressed = true;

      if (f.leftGrappleAction === 'fire') {
        sawLeftFire = true;
        sawLeftFireTarget = f.leftGrappleTarget;
      } else if (
        f.leftGrappleAction === 'release' ||
        f.leftGrappleAction === 'none'
      ) {
        sawLeftFire = false;
        sawLeftFireTarget = null;
      }

      if (f.rightGrappleAction === 'fire') {
        sawRightFire = true;
        sawRightFireTarget = f.rightGrappleTarget;
      } else if (
        f.rightGrappleAction === 'release' ||
        f.rightGrappleAction === 'none'
      ) {
        sawRightFire = false;
        sawRightFireTarget = null;
      }
    }

    if (sawLeftFire && leftAction === 'hold') {
      leftAction = 'fire';
      if (sawLeftFireTarget) leftTarget = sawLeftFireTarget;
    }
    if (sawRightFire && rightAction === 'hold') {
      rightAction = 'fire';
      if (sawRightFireTarget) rightTarget = sawRightFireTarget;
    }

    return {
      ...latest,
      jumpPressed,
      dodgePressed,
      resupplyPressed,
      escapePressed,
      leftGrappleAction: leftAction,
      leftGrappleTarget: leftTarget,
      rightGrappleAction: rightAction,
      rightGrappleTarget: rightTarget,
    };
  }

  private stepAuthoritativeSimulation(dt: number): void {
    const tickStartMs = performance.now();
    this.serverTick++;
    const nowMs = Date.now();

    // Expire old team pings (> 6 seconds)
    this.pings = this.pings.filter((p) => nowMs - p.createdAt < 6000);

    if (this.phase !== 'playing') {
      this.lastTickDurationMs = performance.now() - tickStartMs;
      return;
    }

    // Always use authoritative server fixed timestep, never client frame.dt
    const authoritativeDt = GAME_CONFIG.physics.fixedTimestep;
    this.elapsedSeconds += authoritativeDt;

    // 1. Process coalesced inputs and step physics ONCE per connected player per authoritative tick
    for (const player of this.players.values()) {
      if (!player.connected) continue;

      if (player.inputQueue.length > 0) {
        const batch = player.inputQueue.splice(0, player.inputQueue.length);
        const mergedFrame = this.coalesceInputBatch(batch);
        this.applyPlayerInputAndStep(
          player,
          mergedFrame,
          authoritativeDt,
          nowMs
        );
        if (mergedFrame.seq > player.lastAckedSeq) {
          player.lastAckedSeq = mergedFrame.seq;
        }
      } else {
        // Step player passive physics if no input arrived this tick
        this.stepPlayerPassive(player, authoritativeDt, nowMs);
      }
    }

    // Keep Rapier world & QueryPipeline synchronized each authoritative tick
    this.physics.step();

    // 2. Step Co-op Downed & Revive System
    this.stepDownedAndRevive(authoritativeDt, nowMs);

    // 3. Step Shared Server-Side Titan AI & Attack Collisions
    const playerTargets: ServerPlayerTarget[] = [];
    for (const p of this.players.values()) {
      if (p.connected) {
        playerTargets.push({
          id: p.id,
          position: p.position,
          isBoostingOrHooked:
            p.isBoosting || p.leftHook.active || p.rightHook.active,
          isAlive: p.lifeState === 'alive',
        });
      }
    }

    const staticBoxes = this.physics.getStaticBoxes();
    const waypoints = this.cityLayout.patrolWaypoints;

    for (const [tid, titan] of this.titans.entries()) {
      titan.stepServerAI(
        authoritativeDt,
        nowMs,
        playerTargets,
        waypoints,
        staticBoxes,
        (attackHit) => {
          this.resolveTitanAttackOnPlayers(attackHit, nowMs);
        }
      );

      if (titan.readyForRemoval) {
        this.titans.delete(tid);
      }
    }

    const tickElapsed = performance.now() - tickStartMs;
    this.lastTickDurationMs = tickElapsed;
    if (tickElapsed > this.maxTickDurationMs) {
      this.maxTickDurationMs = tickElapsed;
    }
    if (tickElapsed > (1000 / 60) * 1.25) {
      this.tickOverrunCount++;
    }
  }

  private applyPlayerInputAndStep(
    player: ServerPlayerSession,
    frame: C2S_InputFrame,
    dt: number,
    nowMs: number
  ): void {
    player.reviveHoldActive = Boolean(frame.reviveHeld);

    if (player.lifeState !== 'alive') {
      player.grabbedByTitanId = null;
      player.grabEscapeProgress = 0;
      player.leftHook.active = false;
      player.rightHook.active = false;
      player.isBoosting = false;
      player.reviveHoldActive = false;
      this.stepPlayerPassive(player, dt, nowMs);
      return;
    }

    // Handle authoritative Titan Grab & Escape Counter (Mash [F] / [SPACE])
    if (player.grabbedByTitanId) {
      const grabbingTitan = this.titans.get(player.grabbedByTitanId);
      if (
        !grabbingTitan ||
        grabbingTitan.isDead() ||
        grabbingTitan.aiState === 'Stunned' ||
        grabbingTitan.aiState === 'Injured'
      ) {
        player.grabbedByTitanId = null;
        player.grabEscapeProgress = 0;
        player.invulnerableUntilMs = nowMs + 1000;
        player.velocity.set(0, 9.5, 0);
      } else {
        player.leftHook.active = false;
        player.rightHook.active = false;
        player.isBoosting = false;
        player.grounded = false;
        player.position.copy(grabbingTitan.getGrabHoldWorldPosition());
        player.velocity.set(0, 0, 0);
        player.anim = 'HitReaction';

        if (frame.escapePressed || frame.jumpPressed) {
          player.grabEscapeProgress = Math.min(
            1.0,
            player.grabEscapeProgress + GAME_CONFIG.combat.grabEscapeStep
          );
          player.anim = 'HeavyAttack';

          if (player.grabEscapeProgress >= 1.0) {
            grabbingTitan.applyDamageFromPlayer(player.id, 'RightArm', 999);
            grabbingTitan.aiState = 'Stunned';
            grabbingTitan.anim = 'Stagger';
            grabbingTitan.stateTimer = 4.0;
            grabbingTitan.releaseGrabbedPlayer();

            player.grabbedByTitanId = null;
            player.grabEscapeProgress = 0;
            player.invulnerableUntilMs = nowMs + 1250;
            player.score += 300;
            this.teamScore += 300;
            const away = grabbingTitan
              .getForwardVector()
              .multiplyScalar(-14.0);
            away.y = 12.5;
            player.velocity.copy(away);

            this.broadcastCombatEvent({
              type: 'grab_escaped',
              attackerId: player.id,
              attackerName: player.nickname,
              targetPlayerId: player.id,
              targetPlayerName: player.nickname,
              targetTitanId: grabbingTitan.id,
              worldPos: player.position.toArray() as [number, number, number],
              message: `${player.nickname} severed Titan's hand and escaped Grab! (+300)`,
            });
            return;
          }
        }

        this.integratePlayerKinematics(
          player,
          new THREE.Vector3(0, 0, 0),
          dt,
          nowMs
        );
        return;
      }
    }

    const moveF = clamp(Number(frame.moveForward) || 0, -1, 1);
    const moveR = clamp(Number(frame.moveRight) || 0, -1, 1);
    const camYaw = Number.isFinite(frame.yaw) ? frame.yaw : 0;

    const camFlatForward = new THREE.Vector3(
      -Math.sin(camYaw),
      0,
      -Math.cos(camYaw)
    ).normalize();
    const camRight = new THREE.Vector3(
      -camFlatForward.z,
      0,
      camFlatForward.x
    ).normalize();

    const moveInputDir = new THREE.Vector3()
      .addScaledVector(camFlatForward, moveF)
      .addScaledVector(camRight, moveR);
    if (moveInputDir.lengthSq() > 1.0) moveInputDir.normalize();

    // Validate camera origin & aim vector for grapple raycasting
    const camOrigin = isValidFiniteVec3(frame.camOrigin)
      ? new THREE.Vector3(...frame.camOrigin)
      : player.position.clone().add(new THREE.Vector3(0, 1.65, 0));
    // Clamp camera origin within 12m of authoritative player position to prevent remote raycast spoofing
    if (camOrigin.distanceTo(player.position) > 12.0) {
      camOrigin.copy(player.position).add(new THREE.Vector3(0, 1.65, 0));
    }

    const camAimDir = isValidFiniteVec3(frame.camForward)
      ? new THREE.Vector3(...frame.camForward).normalize()
      : camFlatForward.clone();

    // 1. Authoritative Left & Right Grappling Hook Fire / Hold-Retry / Release
    const wantsFireLeft =
      frame.leftGrappleAction === 'fire' ||
      (frame.leftGrappleAction === 'hold' &&
        !player.leftHook.active &&
        nowMs >= player.leftHookRetryAfterMs);

    if (wantsFireLeft) {
      if (player.gas > 1.0) {
        player.leftHookRetryAfterMs = nowMs + 110;
        const latched = this.tryLatchServerHook(
          player,
          player.leftHook,
          camOrigin,
          camAimDir,
          camRight,
          frame.lockedTitanId,
          frame.lockedZone,
          frame.leftGrappleTarget,
          frame.seq
        );
        if (latched) {
          player.grounded = false;
          if (player.velocity.y < 3.5) player.velocity.y += 3.5;
        }
      } else {
        this.recordServerHookDebug(
          player,
          'left',
          frame.seq,
          false,
          'REJECT_NO_GAS',
          null,
          0
        );
      }
    } else if (
      frame.leftGrappleAction === 'release' ||
      frame.leftGrappleAction === 'none'
    ) {
      player.leftHook.active = false;
      player.leftHook.isTaut = false;
      player.leftHook.attachedTitanId = null;
      player.leftHook.attachedZone = null;
      player.leftHookRetryAfterMs = 0;
    }

    const wantsFireRight =
      frame.rightGrappleAction === 'fire' ||
      (frame.rightGrappleAction === 'hold' &&
        !player.rightHook.active &&
        nowMs >= player.rightHookRetryAfterMs);

    if (wantsFireRight) {
      if (player.gas > 1.0) {
        player.rightHookRetryAfterMs = nowMs + 110;
        const latched = this.tryLatchServerHook(
          player,
          player.rightHook,
          camOrigin,
          camAimDir,
          camRight,
          frame.lockedTitanId,
          frame.lockedZone,
          frame.rightGrappleTarget,
          frame.seq
        );
        if (latched) {
          player.grounded = false;
          if (player.velocity.y < 3.5) player.velocity.y += 3.5;
        }
      } else {
        this.recordServerHookDebug(
          player,
          'right',
          frame.seq,
          false,
          'REJECT_NO_GAS',
          null,
          0
        );
      }
    } else if (
      frame.rightGrappleAction === 'release' ||
      frame.rightGrappleAction === 'none'
    ) {
      player.rightHook.active = false;
      player.rightHook.isTaut = false;
      player.rightHook.attachedTitanId = null;
      player.rightHook.attachedZone = null;
      player.rightHookRetryAfterMs = 0;
    }

    if (player.gas <= 0) {
      player.leftHook.active = false;
      player.rightHook.active = false;
    }

    // 2. Resupply / Blade Reload (R)
    if (frame.resupplyPressed) {
      const nearDepot = this.cityLayout.supplyStations.some(
        (pos) =>
          pos.distanceTo(player.position) <= GAME_CONFIG.world.resupplyRange
      );
      if (nearDepot) {
        player.gas = player.maxGas;
        player.bladeDurability = GAME_CONFIG.player.maxBladeDurability;
        player.spareBlades = GAME_CONFIG.player.maxSpareBlades;
        player.thunderSpears = GAME_CONFIG.player.maxThunderSpears;
        player.health = Math.min(player.maxHealth, player.health + 45);
        this.broadcastCombatEvent({
          type: 'resupply',
          attackerId: player.id,
          attackerName: player.nickname,
          worldPos: player.position.toArray() as [number, number, number],
          message: `${player.nickname} resupplied at Depot`,
        });
      } else if (
        player.bladeDurability < GAME_CONFIG.player.maxBladeDurability &&
        player.spareBlades > 0
      ) {
        player.spareBlades--;
        player.bladeDurability = GAME_CONFIG.player.maxBladeDurability;
      }
    }

    // 3. Dodge (Q)
    if (
      frame.dodgePressed &&
      nowMs >= player.dodgeCooldownUntilMs &&
      player.gas >= 4.0
    ) {
      player.dodgeUntilMs = nowMs + GAME_CONFIG.player.dodgeDuration * 1000;
      player.perfectDodgeUntilMs =
        nowMs + GAME_CONFIG.player.perfectDodgeWindow * 1000;
      player.dodgeCooldownUntilMs =
        nowMs + GAME_CONFIG.player.dodgeCooldown * 1000;
      player.gas = Math.max(0, player.gas - 4.0);

      const dodgeDir =
        moveInputDir.lengthSq() > 0.05 ? moveInputDir.clone() : camFlatForward;
      player.velocity.copy(
        dodgeDir.multiplyScalar(GAME_CONFIG.player.dodgeImpulse)
      );
      if (!player.grounded) {
        player.velocity.y = Math.max(player.velocity.y, 4.0);
      }
    }

    // 4. Jump (Space)
    if (frame.jumpPressed) {
      if (player.grounded) {
        player.grounded = false;
        player.velocity.y = GAME_CONFIG.player.jumpVelocity;
      } else if (player.leftHook.active || player.rightHook.active) {
        player.velocity.y = Math.max(
          player.velocity.y + 6.5,
          GAME_CONFIG.player.jumpVelocity
        );
      }
    }

    // 5. Gas Boost (Shift)
    player.isBoosting = Boolean(frame.boostHeld) && player.gas > 0.5;
    if (player.isBoosting) {
      player.gas = Math.max(
        0,
        player.gas - GAME_CONFIG.odm.gasConsumptionBoostPerSec * dt
      );
      if (
        !player.grounded ||
        player.leftHook.active ||
        player.rightHook.active
      ) {
        const boostDir = camAimDir.clone();
        if (moveInputDir.lengthSq() > 0.05) {
          boostDir.lerp(moveInputDir, 0.35).normalize();
        }
        if (boostDir.y < 0.08 && player.position.y < 5.0) {
          boostDir.y = 0.15;
          boostDir.normalize();
        }
        player.velocity.addScaledVector(
          boostDir,
          GAME_CONFIG.odm.gasBoostAccel * dt
        );
      }
    }

    // 6. Step ODM Rope Constraints & Character Movement
    this.integratePlayerKinematics(player, moveInputDir, dt, nowMs);
  }

  private stepPlayerPassive(
    player: ServerPlayerSession,
    dt: number,
    nowMs: number
  ): void {
    this.integratePlayerKinematics(
      player,
      new THREE.Vector3(0, 0, 0),
      dt,
      nowMs
    );
  }

  private integratePlayerKinematics(
    player: ServerPlayerSession,
    moveInputDir: THREE.Vector3,
    dt: number,
    nowMs: number
  ): void {
    if (player.lifeState !== 'alive') {
      player.grabbedByTitanId = null;
      player.grabEscapeProgress = 0;
      player.leftHook.active = false;
      player.rightHook.active = false;
      player.velocity.y += GAME_CONFIG.physics.gravity * dt;
      player.velocity.x *= 0.9;
      player.velocity.z *= 0.9;
      const moveRes = this.physics.moveCharacter(
        player.position,
        player.velocity.clone().multiplyScalar(dt),
        false,
        player.id
      );
      player.position.copy(moveRes.footPosition);
      player.grounded = moveRes.grounded;
      if (player.grounded) player.velocity.set(0, 0, 0);
      player.anim = player.lifeState === 'downed' ? 'HitReaction' : 'Death';
      return;
    }

    // If player is held in a Titan's Grab, keep them pinned at the hand and apply periodic crush damage
    if (player.grabbedByTitanId) {
      const grabbingTitan = this.titans.get(player.grabbedByTitanId);
      if (
        !grabbingTitan ||
        grabbingTitan.isDead() ||
        grabbingTitan.aiState === 'Stunned' ||
        grabbingTitan.aiState === 'Injured'
      ) {
        player.grabbedByTitanId = null;
        player.grabEscapeProgress = 0;
        player.invulnerableUntilMs = nowMs + 1000;
        player.velocity.set(0, 9.5, 0);
      } else {
        player.position.copy(grabbingTitan.getGrabHoldWorldPosition());
        this.physics.setPlayerPosition(player.position, player.id);
        player.velocity.set(0, 0, 0);
        player.grounded = false;
        player.health = Math.max(
          0,
          player.health - GAME_CONFIG.combat.grabCrushDps * dt
        );
        player.grabHoldRemaining -= dt;

        if (player.health <= 0) {
          grabbingTitan.releaseGrabbedPlayer();
          player.grabbedByTitanId = null;
          player.grabEscapeProgress = 0;
          this.downOrKillPlayer(player);
          return;
        }
        if (player.grabHoldRemaining <= 0) {
          grabbingTitan.releaseGrabbedPlayer();
          player.grabbedByTitanId = null;
          player.grabEscapeProgress = 0;
          player.invulnerableUntilMs = nowMs + 850;
          const throwVec = grabbingTitan.getForwardVector().multiplyScalar(15);
          throwVec.y = 8.0;
          player.velocity.copy(throwVec);
        }
        return;
      }
    }

    // Update active ODM hooks & solve rope constraints
    const activeConstraints: RopeAnchorConstraintInput[] = [];
    const hookRefs: ServerHook[] = [];

    for (const hook of [player.leftHook, player.rightHook]) {
      if (!hook.active) continue;

      if (hook.attachedTitanId && hook.attachedZone) {
        const titan = this.titans.get(hook.attachedTitanId);
        if (!titan || titan.isDead()) {
          hook.active = false;
          hook.isTaut = false;
          continue;
        }
        hook.anchorPos.copy(titan.hurtboxes[hook.attachedZone].worldPosition);
      }

      const dist = player.position.distanceTo(hook.anchorPos);
      if (dist > GAME_CONFIG.odm.maxGrappleRange * 1.22) {
        hook.active = false;
        hook.isTaut = false;
        continue;
      }

      activeConstraints.push({
        anchorPos: hook.anchorPos,
        restLength: hook.restLength,
        reelInRate: player.isBoosting
          ? GAME_CONFIG.odm.reelInSpeedBoost
          : GAME_CONFIG.odm.reelInSpeedBase,
      });
      hookRefs.push(hook);
    }

    const hooked = activeConstraints.length > 0;

    if (hooked) {
      player.grounded = false;
      player.gas = Math.max(
        0,
        player.gas - GAME_CONFIG.odm.gasConsumptionReelPerSec * dt
      );
      player.velocity.y +=
        GAME_CONFIG.physics.gravity *
        GAME_CONFIG.physics.hookedGravityScale *
        dt;

      const solved = solveODMRopeConstraints(
        player.position,
        player.velocity,
        activeConstraints,
        moveInputDir,
        player.isBoosting,
        dt
      );
      player.position.copy(solved.newPosition);
      player.velocity.copy(solved.newVelocity);
      for (let i = 0; i < hookRefs.length; i++) {
        hookRefs[i].restLength = solved.updatedRestLengths[i];
        hookRefs[i].isTaut = solved.isTaut[i];
      }
      player.velocity.multiplyScalar(1 - GAME_CONFIG.physics.airDrag * dt * 12);
    } else if (!player.grounded) {
      player.velocity.y += GAME_CONFIG.physics.gravity * dt;
      if (moveInputDir.lengthSq() > 0.01) {
        player.velocity.addScaledVector(
          moveInputDir,
          GAME_CONFIG.player.airControlAccel * dt
        );
      }
      player.velocity.multiplyScalar(1 - GAME_CONFIG.physics.airDrag * dt * 15);
    } else {
      player.gas = Math.min(
        player.maxGas,
        player.gas + GAME_CONFIG.odm.gasPassiveRegenGroundedPerSec * dt
      );
      if (nowMs >= player.dodgeUntilMs) {
        const targetSpeed = player.isBoosting
          ? GAME_CONFIG.player.sprintSpeed
          : GAME_CONFIG.player.runSpeed;
        const desiredX = moveInputDir.x * targetSpeed;
        const desiredZ = moveInputDir.z * targetSpeed;
        const blend = clamp(GAME_CONFIG.physics.groundFriction * dt, 0, 1);
        player.velocity.x += (desiredX - player.velocity.x) * blend;
        player.velocity.z += (desiredZ - player.velocity.z) * blend;
      }
      if (player.velocity.y < 0) player.velocity.y = -1.5;
    }

    const totalSpeed = player.velocity.length();
    if (totalSpeed > GAME_CONFIG.physics.terminalVelocity) {
      player.velocity.multiplyScalar(
        GAME_CONFIG.physics.terminalVelocity / totalSpeed
      );
    }

    const moveRes = this.physics.moveCharacter(
      player.position,
      player.velocity.clone().multiplyScalar(dt),
      hooked || !player.grounded,
      player.id
    );
    player.position.copy(moveRes.footPosition);

    if (moveRes.hitWall && moveRes.wallNormal) {
      const intoWall = player.velocity.dot(moveRes.wallNormal);
      if (intoWall < 0) {
        player.velocity.addScaledVector(moveRes.wallNormal, -intoWall);
      }
    }

    if (!hooked && moveRes.grounded && player.velocity.y <= 0.5) {
      player.grounded = true;
      player.velocity.y = 0;
    } else {
      player.grounded = false;
    }

    const horizSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    if (horizSpeed > 0.8) {
      const velYaw = Math.atan2(player.velocity.x, player.velocity.z);
      player.yaw = lerpAngle(player.yaw, velYaw, 12.0 * dt);
    }

    // Determine authoritative animation state
    if (nowMs < player.attackActiveUntilMs) {
      // Keep current attack anim
    } else if (nowMs < player.dodgeUntilMs) {
      player.anim = 'Dodge';
    } else if (!player.grounded) {
      if (player.isBoosting) player.anim = 'Boost';
      else if (player.leftHook.active && player.rightHook.active)
        player.anim = horizSpeed > 14 ? 'Swing' : 'DualHook';
      else if (player.leftHook.active)
        player.anim = horizSpeed > 16 ? 'Swing' : 'LeftHook';
      else if (player.rightHook.active)
        player.anim = horizSpeed > 16 ? 'Swing' : 'RightHook';
      else if (player.velocity.y < -4.0) player.anim = 'Fall';
      else player.anim = 'AirborneIdle';
    } else {
      if (horizSpeed < 0.5) player.anim = 'Idle';
      else if (horizSpeed < 6.8) player.anim = 'Walk';
      else if (horizSpeed < 11.2) player.anim = 'Run';
      else player.anim = 'Sprint';
    }
  }

  private recordServerHookDebug(
    player: ServerPlayerSession,
    side: 'left' | 'right',
    seq: number,
    success: boolean,
    reason: HookFireResultReason,
    anchor: THREE.Vector3 | null,
    distance: number,
    surfaceLabel?: string
  ): void {
    if (!success) {
      this.hookRejectCount++;
    }
    const info: HookFireDebugInfo = {
      side,
      seq,
      timestampMs: Date.now(),
      success,
      reason,
      anchor: anchor ? [anchor.x, anchor.y, anchor.z] : null,
      distance,
      surfaceLabel,
    };
    if (side === 'left') {
      player.lastLeftHookDebug = info;
    } else {
      player.lastRightHookDebug = info;
    }
    this.hookDebugLog.push(info);
    if (this.hookDebugLog.length > 64) {
      this.hookDebugLog.shift();
    }
  }

  private tryLatchServerHook(
    player: ServerPlayerSession,
    hook: ServerHook,
    camOrigin: THREE.Vector3,
    camForward: THREE.Vector3,
    _camRight: THREE.Vector3,
    lockedTitanId: string | null,
    lockedZone: TitanZoneType,
    clientHintAnchor?: [number, number, number] | null,
    seq = 0
  ): boolean {
    const sideSign: -1 | 1 = hook.side === 'left' ? -1 : 1;
    const maxRange = GAME_CONFIG.odm.maxGrappleRange;
    const playerChest = new THREE.Vector3(
      player.position.x,
      player.position.y + 1.35,
      player.position.z
    );

    // 1. Locked Titan zone check (with Line-of-Sight verification)
    if (lockedTitanId) {
      const titan = this.titans.get(lockedTitanId);
      const zone: TitanZoneType =
        lockedZone && titan?.hurtboxes[lockedZone] ? lockedZone : 'Nape';
      if (titan && !titan.isDead()) {
        const hb = titan.hurtboxes[zone];
        const zonePos = hb.worldPosition;
        const dist = player.position.distanceTo(zonePos);
        if (
          dist <= maxRange &&
          this.physics.hasLineOfSight(playerChest, zonePos, hb.radius + 1.2)
        ) {
          hook.active = true;
          hook.anchorPos.copy(zonePos);
          hook.restLength = Math.max(GAME_CONFIG.odm.minRopeLength, dist);
          hook.attachedTitanId = titan.id;
          hook.attachedZone = zone;
          this.recordServerHookDebug(
            player,
            hook.side,
            seq,
            true,
            'LOCKED_TITAN_LATCH',
            zonePos,
            dist,
            `Titan ${titan.id} [${zone}]`
          );
          return true;
        }
      }
    }

    // 2. Raycast against any live Titan hurtbox along aim ray (with Line-of-Sight verification)
    for (const titan of this.titans.values()) {
      if (titan.isDead()) continue;
      for (const zone of Object.keys(titan.hurtboxes) as TitanZoneType[]) {
        const hb = titan.hurtboxes[zone];
        const dist = player.position.distanceTo(hb.worldPosition);
        if (dist > maxRange) continue;
        const toHb = hb.worldPosition.clone().sub(camOrigin);
        const proj = toHb.dot(camForward);
        if (proj <= 0) continue;
        const closest = camOrigin.clone().addScaledVector(camForward, proj);
        if (
          closest.distanceTo(hb.worldPosition) <= hb.radius * 2.5 &&
          this.physics.hasLineOfSight(
            playerChest,
            hb.worldPosition,
            hb.radius + 1.2
          )
        ) {
          hook.active = true;
          hook.anchorPos.copy(hb.worldPosition);
          hook.restLength = Math.max(GAME_CONFIG.odm.minRopeLength, dist);
          hook.attachedTitanId = titan.id;
          hook.attachedZone = zone;
          this.recordServerHookDebug(
            player,
            hook.side,
            seq,
            true,
            'RAY_TITAN_LATCH',
            hb.worldPosition,
            dist,
            `Titan ${titan.id} [${zone}]`
          );
          return true;
        }
      }
    }

    // 3. Authoritatively validate client's predicted world anchor hint (surface, distance, and Line-of-Sight)
    const verifiedHint = validateServerWorldAnchorHint(
      this.physics,
      player.position,
      camOrigin,
      camForward,
      clientHintAnchor
    );
    if (verifiedHint) {
      hook.active = true;
      hook.anchorPos.copy(verifiedHint.point);
      hook.restLength = Math.max(
        GAME_CONFIG.odm.minRopeLength,
        verifiedHint.distance
      );
      hook.attachedTitanId = null;
      hook.attachedZone = null;
      this.recordServerHookDebug(
        player,
        hook.side,
        seq,
        true,
        'CLIENT_HINT_VERIFIED',
        verifiedHint.point,
        verifiedHint.distance,
        verifiedHint.surfaceLabel
      );
      return true;
    }

    // 4. Shared Multi-Stage World Grapple Solver against Server Rapier 3D buildings/walls/towers
    const worldHit = findBestWorldGrapplePoint(
      this.physics,
      camOrigin,
      camForward,
      player.position,
      sideSign
    );
    if (worldHit) {
      hook.active = true;
      hook.anchorPos.copy(worldHit.point);
      hook.restLength = Math.max(
        GAME_CONFIG.odm.minRopeLength,
        worldHit.distance
      );
      hook.attachedTitanId = null;
      hook.attachedZone = null;
      this.recordServerHookDebug(
        player,
        hook.side,
        seq,
        true,
        worldHit.reason,
        worldHit.point,
        worldHit.distance,
        worldHit.surfaceLabel
      );
      return true;
    }

    // 5. Determine specific rejection reason for diagnostics
    const probeHit = this.physics.castRay(camOrigin, camForward, 320, false);
    let rejectReason: HookFireResultReason = 'REJECT_NO_SURFACE_IN_CONE';
    let rejectDist: number = maxRange;
    if (probeHit) {
      rejectDist = player.position.distanceTo(probeHit.point);
      if (!probeHit.metadata.grappleable || probeHit.point.y < 1.2) {
        rejectReason = 'REJECT_LOW_ELEVATION';
      } else if (rejectDist > maxRange) {
        rejectReason = 'REJECT_OUT_OF_RANGE';
      }
    }

    this.recordServerHookDebug(
      player,
      hook.side,
      seq,
      false,
      rejectReason,
      null,
      rejectDist,
      probeHit?.metadata.label
    );
    return false;
  }

  private releaseVictimOnTitanBreak(
    rescuer: ServerPlayerSession,
    titan: ServerTitan,
    freedPlayerId: string | null,
    nowMs: number
  ): void {
    const victimId = freedPlayerId || titan.releaseGrabbedPlayer();
    if (!victimId) return;
    const victim = this.players.get(victimId);
    if (!victim || !victim.grabbedByTitanId) return;

    victim.grabbedByTitanId = null;
    victim.grabEscapeProgress = 0;
    victim.invulnerableUntilMs = nowMs + 1200;
    victim.velocity.set(0, 11.0, 0);

    if (rescuer.id !== victim.id) {
      rescuer.score += 350;
      rescuer.assists++;
      this.teamScore += 350;
    }

    this.broadcastCombatEvent({
      type: 'grab_escaped',
      attackerId: rescuer.id,
      attackerName: rescuer.nickname,
      targetPlayerId: victim.id,
      targetPlayerName: victim.nickname,
      targetTitanId: titan.id,
      worldPos: victim.position.toArray() as [number, number, number],
      message:
        rescuer.id === victim.id
          ? `${victim.nickname} broke free from Titan Grab!`
          : `${rescuer.nickname} rescued ${victim.nickname} from Titan Grab! (+350)`,
    });
  }

  private handleAuthoritativeThunderSpear(
    player: ServerPlayerSession,
    intent: C2S_AttackIntent,
    nowMs: number
  ): void {
    if (player.thunderSpears <= 0 || nowMs < player.nextThunderSpearAllowedMs) {
      return;
    }

    player.thunderSpears--;
    player.nextThunderSpearAllowedMs =
      nowMs + GAME_CONFIG.combat.thunderSpearCooldown * 1000;
    player.anim = 'HeavyAttack';

    // If the player was grabbed by a Titan, firing a Thunder Spear immediately blasts them free!
    if (player.grabbedByTitanId) {
      const grabbingTitan = this.titans.get(player.grabbedByTitanId);
      if (grabbingTitan && !grabbingTitan.isDead()) {
        const res = grabbingTitan.applyDamageFromPlayer(
          player.id,
          'RightArm',
          GAME_CONFIG.combat.thunderSpearBaseDamage
        );
        player.damageDealt += GAME_CONFIG.combat.thunderSpearBaseDamage;
        this.releaseVictimOnTitanBreak(
          player,
          grabbingTitan,
          res.freedPlayerId || player.id,
          nowMs
        );
        return;
      }
    }

    const maxRange = GAME_CONFIG.combat.thunderSpearRange;
    const blastRadius = GAME_CONFIG.combat.thunderSpearBlastRadius;
    const baseDmg = GAME_CONFIG.combat.thunderSpearBaseDamage;
    const splashDmg = GAME_CONFIG.combat.thunderSpearSplashDamage;

    const playerChest = player.position
      .clone()
      .add(new THREE.Vector3(0, 1.5, 0));

    let aimOrigin = playerChest.clone();
    if (isValidFiniteVec3(intent.aimOrigin)) {
      const candidateOrigin = new THREE.Vector3(...intent.aimOrigin);
      if (
        candidateOrigin.distanceTo(player.position) <= 10.0 &&
        this.physics.hasLineOfSight(playerChest, candidateOrigin, 0.5)
      ) {
        aimOrigin = candidateOrigin;
      }
    }

    const aimDir = isValidFiniteVec3(intent.aimDir)
      ? new THREE.Vector3(...intent.aimDir).normalize()
      : new THREE.Vector3(
          -Math.sin(intent.aimYaw || player.yaw),
          0,
          -Math.cos(intent.aimYaw || player.yaw)
        ).normalize();

    let directTitan: ServerTitan | null = null;
    let directZone: TitanZoneType = intent.targetZone || 'Nape';
    let explosionPos: THREE.Vector3 | null = null;

    if (intent.targetTitanId) {
      const cand = this.titans.get(intent.targetTitanId);
      const hb = cand?.hurtboxes[directZone];
      if (
        cand &&
        !cand.isDead() &&
        hb &&
        hb.worldPosition.distanceTo(player.position) <= maxRange &&
        this.physics.hasLineOfSight(
          playerChest,
          hb.worldPosition,
          hb.radius + 1.2
        )
      ) {
        directTitan = cand;
        explosionPos = hb.worldPosition.clone();
      }
    }

    if (!explosionPos) {
      let bestScore = Infinity;
      for (const titan of this.titans.values()) {
        if (titan.isDead()) continue;
        for (const zone of Object.keys(titan.hurtboxes) as TitanZoneType[]) {
          const hb = titan.hurtboxes[zone];
          const dist = player.position.distanceTo(hb.worldPosition);
          if (dist > maxRange) continue;
          const toHb = hb.worldPosition.clone().sub(aimOrigin);
          const proj = toHb.dot(aimDir);
          if (proj <= 0) continue;
          const closest = aimOrigin.clone().addScaledVector(aimDir, proj);
          const radialErr = closest.distanceTo(hb.worldPosition);
          if (
            radialErr <= hb.radius * 3.5 &&
            this.physics.hasLineOfSight(
              playerChest,
              hb.worldPosition,
              hb.radius + 1.2
            )
          ) {
            const score =
              radialErr * 3.0 + dist * 0.15 - (zone === 'Nape' ? 2.5 : 0);
            if (score < bestScore) {
              bestScore = score;
              directTitan = titan;
              directZone = zone;
              explosionPos = hb.worldPosition.clone();
            }
          }
        }
      }
    }

    if (!explosionPos) {
      const rayHit = this.physics.castRay(aimOrigin, aimDir, maxRange, false);
      explosionPos = rayHit
        ? rayHit.point.clone()
        : aimOrigin.clone().addScaledVector(aimDir, 40);
    }

    const allZones: TitanZoneType[] = [
      'Nape',
      'Head',
      'LeftArm',
      'RightArm',
      'LeftLeg',
      'RightLeg',
    ];
    const damagedZones = new Set<string>();

    for (const titan of this.titans.values()) {
      if (titan.isDead()) continue;
      const isDirect = directTitan && titan.id === directTitan.id;
      const orderedZones: TitanZoneType[] = isDirect
        ? [directZone, ...allZones.filter((z) => z !== directZone)]
        : allZones;

      let hitTitan = false;
      for (const zone of orderedZones) {
        if (titan.isDead()) break;
        const zoneKey = `${titan.id}:${zone}`;
        if (damagedZones.has(zoneKey)) continue;

        const hb = titan.hurtboxes[zone];
        const dist = hb.worldPosition.distanceTo(explosionPos);
        const isPrimary = Boolean(isDirect && zone === directZone);

        // Nape execution requires direct Nape targeting on the primary Titan (or direct proximity <= 1.8m)
        if (zone === 'Nape' && !isPrimary && (isDirect || dist > 1.8)) {
          continue;
        }

        if (isPrimary || dist <= blastRadius + hb.radius) {
          // Verify Line-of-Sight from explosion Pos to hurtbox so splash damage cannot penetrate solid buildings/walls
          if (
            !isPrimary &&
            !this.physics.hasLineOfSight(
              explosionPos,
              hb.worldPosition,
              hb.radius + 1.2
            )
          ) {
            continue;
          }

          damagedZones.add(zoneKey);
          const dmg = isPrimary ? baseDmg : splashDmg;
          const res = titan.applyDamageFromPlayer(player.id, zone, dmg);
          player.damageDealt += dmg;
          hitTitan = true;

          if (res.freedPlayerId) {
            this.releaseVictimOnTitanBreak(
              player,
              titan,
              res.freedPlayerId,
              nowMs
            );
          }

          if (res.killed) {
            this.onServerTitanKilled(titan, player, dmg, 2.2);
            break;
          } else if (res.limbBroken) {
            player.score += 350;
            this.teamScore += 350;
          }
        }
      }

      if (hitTitan && !titan.isDead()) {
        if (titan.grabbedPlayerId) {
          this.releaseVictimOnTitanBreak(
            player,
            titan,
            titan.grabbedPlayerId,
            nowMs
          );
        }
        if (titan.aiState !== 'Injured') {
          titan.aiState = 'Stunned';
          titan.anim = 'Stagger';
          titan.stateTimer = Math.max(titan.stateTimer, 3.5);
          titan.velocity.set(0, 0, 0);
        }
      }
    }

    this.broadcastCombatEvent({
      type: 'thunder_spear_exploded',
      attackerId: player.id,
      attackerName: player.nickname,
      targetTitanId: directTitan?.id,
      zone: directZone,
      damage: baseDmg,
      worldPos: explosionPos.toArray() as [number, number, number],
      message: `${player.nickname} detonated a THUNDER SPEAR! (${baseDmg} BLAST DMG)`,
    });
  }

  private handleAuthoritativeAttack(
    player: ServerPlayerSession,
    intent: C2S_AttackIntent
  ): void {
    const nowMs = Date.now();
    if (this.phase !== 'playing' || player.lifeState !== 'alive') return;

    if (intent.weaponType === 'thunder_spear') {
      this.handleAuthoritativeThunderSpear(player, intent, nowMs);
      return;
    }

    if (player.grabbedByTitanId !== null) return;
    if (nowMs < player.nextAttackAllowedMs) return;

    const isHeavy = Boolean(intent.isHeavy);
    const durationMs =
      (isHeavy
        ? GAME_CONFIG.combat.heavyAttackDuration
        : GAME_CONFIG.combat.lightAttackDuration) * 1000;

    player.attackActiveUntilMs = nowMs + durationMs;
    player.nextAttackAllowedMs =
      nowMs + durationMs * 0.65 + GAME_CONFIG.combat.attackCooldown * 1000;
    player.anim = isHeavy ? 'HeavyAttack' : 'LightAttack';

    const playerSlashCenter = new THREE.Vector3(
      player.position.x,
      player.position.y + 1.15,
      player.position.z
    );

    // Apply close-range aerial strike assist lunge on server (only if unobstructed by walls)
    const targetTitan =
      intent.targetTitanId && this.titans.get(intent.targetTitanId);
    const targetZone: TitanZoneType = intent.targetZone || 'Nape';
    if (targetTitan && !targetTitan.isDead()) {
      const hb = targetTitan.hurtboxes[targetZone];
      const zp = hb?.worldPosition;
      if (
        zp &&
        zp.distanceTo(player.position) <= 9.0 &&
        this.physics.hasLineOfSight(playerSlashCenter, zp, hb.radius + 1.1)
      ) {
        const toZ = zp.clone().sub(player.position).normalize();
        const spd = Math.max(18.0, player.velocity.length());
        player.velocity.addScaledVector(toZ, spd * 0.35);
      }
    }

    // Evaluate hit against all live Titans using bounded lag-compensated hitbox history
    const rewindMs = clamp((Number(intent.clientRttMs) || 0) * 0.5, 0, 180);
    const speedAllowance = Math.min(2.2, player.velocity.length() * 0.065);
    const effectiveReach = GAME_CONFIG.combat.bladeReach * 1.15 + speedAllowance;
    const maxHitsAllowed = isHeavy ? 2 : 1;
    let hitsDealt = 0;
    const hitZonesInSwing = new Set<string>();

    for (const titan of this.titans.values()) {
      if (titan.isDead()) continue;

      const hist = titan.getHistoricalState(nowMs, rewindMs);
      const priorityZones: TitanZoneType[] = [
        targetZone,
        'Nape',
        'LeftLeg',
        'RightLeg',
        'LeftArm',
        'RightArm',
        'Head',
      ];
      const uniqueZones = Array.from(new Set(priorityZones));

      for (const zone of uniqueZones) {
        if (titan.isDead()) break;
        const zoneKey = `${titan.id}:${zone}`;
        if (hitZonesInSwing.has(zoneKey)) continue;

        const hb = titan.hurtboxes[zone];
        const currentPos = hb.worldPosition;
        const histPos = hist.hurtboxPositions[zone];

        const distNow = playerSlashCenter.distanceTo(currentPos);
        const distHist = playerSlashCenter.distanceTo(histPos);
        const minDist = Math.min(distNow, distHist);

        if (minDist <= hb.radius + effectiveReach) {
          // Verify Line-of-Sight so players cannot slash Titans through solid buildings or city walls
          const hasLoS =
            this.physics.hasLineOfSight(
              playerSlashCenter,
              currentPos,
              hb.radius + 1.1
            ) ||
            this.physics.hasLineOfSight(
              playerSlashCenter,
              histPos,
              hb.radius + 1.1
            );
          if (!hasLoS) continue;

          hitZonesInSwing.add(zoneKey);

          const relSpeed = player.velocity.clone().sub(titan.velocity).length();
          const titanForward = new THREE.Vector3(
            Math.sin(hist.yaw),
            0,
            Math.cos(hist.yaw)
          ).normalize();
          const napeCos = evaluateNapeApproachCos(
            player.position,
            hist.position,
            titanForward
          );

          const dmgOut = calculateStrikeDamage({
            isHeavyAttack: isHeavy,
            relativeSpeed: relSpeed,
            bladeDurability: player.bladeDurability,
            isNape: zone === 'Nape',
            napeApproachCos: napeCos,
          });

          // Consume blade durability on server
          const loss = dmgOut.glancedOffFront
            ? GAME_CONFIG.combat.bladeDurabilityLossHardHit
            : GAME_CONFIG.combat.bladeDurabilityLossPerHit;
          player.bladeDurability = Math.max(0, player.bladeDurability - loss);

          if (dmgOut.glancedOffFront) {
            this.broadcastCombatEvent({
              type: 'damage_applied',
              attackerId: player.id,
              attackerName: player.nickname,
              targetTitanId: titan.id,
              zone,
              damage: dmgOut.damage,
              glanced: true,
              worldPos: currentPos.toArray() as [number, number, number],
              message: `${player.nickname}'s strike glanced off frontal collar! Attack Nape from behind!`,
            });
            hitsDealt++;
            if (hitsDealt >= maxHitsAllowed) return;
            continue;
          }

          const res = titan.applyDamageFromPlayer(
            player.id,
            zone,
            dmgOut.damage
          );
          player.damageDealt += dmgOut.damage;

          if (res.freedPlayerId) {
            this.releaseVictimOnTitanBreak(
              player,
              titan,
              res.freedPlayerId,
              nowMs
            );
          }

          if (res.killed) {
            this.onServerTitanKilled(
              titan,
              player,
              dmgOut.damage,
              dmgOut.velocityMultiplier
            );
          } else if (res.limbBroken) {
            player.score += 350;
            this.teamScore += 350;
            this.broadcastCombatEvent({
              type: res.stunned ? 'titan_stunned' : 'limb_broken',
              attackerId: player.id,
              attackerName: player.nickname,
              targetTitanId: titan.id,
              zone,
              damage: dmgOut.damage,
              speedMult: dmgOut.velocityMultiplier,
              worldPos: currentPos.toArray() as [number, number, number],
              message: `${player.nickname} crippled Titan ${zone}! (${dmgOut.damage} DMG)`,
            });
          } else {
            this.broadcastCombatEvent({
              type: 'damage_applied',
              attackerId: player.id,
              attackerName: player.nickname,
              targetTitanId: titan.id,
              zone,
              damage: dmgOut.damage,
              speedMult: dmgOut.velocityMultiplier,
              worldPos: currentPos.toArray() as [number, number, number],
              message: `${player.nickname} ${isHeavy ? 'SPIN-SLASHED' : 'struck'} Titan ${zone} (${dmgOut.damage} DMG)`,
            });
          }
          hitsDealt++;
          if (hitsDealt >= maxHitsAllowed) return;
        }
      }
    }
  }

  private onServerTitanKilled(
    titan: ServerTitan,
    killer: ServerPlayerSession,
    damage: number,
    velocityMultiplier: number
  ): void {
    this.totalKills++;
    killer.kills++;

    const cfg = GAME_CONFIG.titans[titan.variant];
    const killPoints = Math.round(cfg.scoreValue * velocityMultiplier);
    killer.score += killPoints;
    this.teamScore += killPoints;

    // Award Assists to all teammates who also damaged this Titan
    for (const [contribId, dmg] of titan.damageContributors.entries()) {
      if (contribId !== killer.id && dmg > 0) {
        const teammate = this.players.get(contribId);
        if (teammate) {
          teammate.assists++;
          const assistPoints = Math.round(killPoints * 0.4);
          teammate.score += assistPoints;
          this.teamScore += assistPoints;
        }
      }
    }

    this.broadcastCombatEvent({
      type: 'titan_killed',
      attackerId: killer.id,
      attackerName: killer.nickname,
      targetTitanId: titan.id,
      zone: 'Nape',
      damage,
      speedMult: velocityMultiplier,
      worldPos: titan.hurtboxes.Nape.worldPosition.toArray() as [
        number,
        number,
        number,
      ],
      message: `${killer.nickname} executed ${cfg.name}! (${damage} DMG — ${velocityMultiplier.toFixed(1)}x SPEED)`,
    });

    // Check wave completion
    const aliveTitans = Array.from(this.titans.values()).filter(
      (t) => !t.isDead()
    ).length;
    if (aliveTitans === 0) {
      if (this.wave < this.maxWaves) {
        this.wave++;
        const remainingKills = Math.max(1, this.targetKills - this.totalKills);
        this.spawnWaveTitans(this.wave, remainingKills);

        // Respawn any fallen ('dead' or 'downed') squadmates at the start of the new wave!
        for (const p of this.players.values()) {
          if (p.connected && p.lifeState !== 'alive') {
            p.lifeState = 'alive';
            p.health = Math.round(p.maxHealth * 0.65);
            p.gas = p.maxGas;
            p.downedTimer = 0;
            p.reviveProgress = 0;
            p.leftHook.active = false;
            p.rightHook.active = false;
            p.position.set(0, 0.2, 24);
            this.physics.setPlayerPosition(p.position, p.id);
          }
        }
      } else if (this.totalKills >= this.targetKills) {
        this.phase = 'victory';
        const timeBonus = Math.max(
          0,
          Math.round((300 - this.elapsedSeconds) * 20)
        );
        this.teamScore += timeBonus;
      }
    }
  }

  private resolveTitanAttackOnPlayers(
    attackHit: {
      titan: ServerTitan;
      type: 'melee' | 'grab';
      damage: number;
      impactPoint: THREE.Vector3;
      radius: number;
    },
    nowMs: number
  ): void {
    for (const player of this.players.values()) {
      if (!player.connected || player.lifeState !== 'alive') continue;
      const dist = player.position.distanceTo(attackHit.impactPoint);
      if (dist > attackHit.radius) continue;

      // Perfect Dodge check
      if (nowMs <= player.perfectDodgeUntilMs) {
        player.invulnerableUntilMs = nowMs + 750;
        player.score += 250;
        this.teamScore += 250;
        this.broadcastCombatEvent({
          type: 'perfect_dodge',
          targetPlayerId: player.id,
          targetPlayerName: player.nickname,
          worldPos: player.position.toArray() as [number, number, number],
          message: `${player.nickname} performed a PERFECT DODGE! (+250)`,
        });
        continue;
      }

      if (
        nowMs <= player.dodgeUntilMs ||
        nowMs <= player.invulnerableUntilMs ||
        player.grabbedByTitanId !== null
      ) {
        continue;
      }

      // If this is a Titan Grab attack and the Titan's hand is free, capture the player!
      if (
        attackHit.type === 'grab' &&
        attackHit.titan.grabbedPlayerId === null
      ) {
        const initDmg = Math.max(12, Math.round(attackHit.damage * 0.35));
        player.health = Math.max(0, player.health - initDmg);
        player.leftHook.active = false;
        player.rightHook.active = false;
        player.isBoosting = false;
        player.grounded = false;
        player.reviveHoldActive = false;

        if (player.health <= 0) {
          this.downOrKillPlayer(player);
        } else {
          player.grabbedByTitanId = attackHit.titan.id;
          player.grabEscapeProgress = 0;
          player.grabHoldRemaining = GAME_CONFIG.combat.grabHoldDuration;
          attackHit.titan.grabbedPlayerId = player.id;
          attackHit.titan.grabHoldTimer = GAME_CONFIG.combat.grabHoldDuration;
          player.position.copy(attackHit.titan.getGrabHoldWorldPosition());
          this.physics.setPlayerPosition(player.position, player.id);
          player.velocity.set(0, 0, 0);
          player.anim = 'HitReaction';

          this.broadcastCombatEvent({
            type: 'player_grabbed',
            targetPlayerId: player.id,
            targetPlayerName: player.nickname,
            targetTitanId: attackHit.titan.id,
            damage: initDmg,
            worldPos: player.position.toArray() as [number, number, number],
            message: `${player.nickname} is GRABBED BY TITAN! Mash [F]/[SPACE] or sever its arm!`,
          });
        }
        continue;
      }

      player.health = Math.max(0, player.health - attackHit.damage);
      player.invulnerableUntilMs = nowMs + 900;
      player.reviveHoldActive = false;

      // Knockback impulse away from Titan
      const kb = player.position
        .clone()
        .sub(attackHit.titan.position)
        .setY(0)
        .normalize()
        .multiplyScalar(14);
      kb.y = 7.5;
      player.velocity.copy(kb);
      player.grounded = false;

      if (player.health <= 0) {
        this.downOrKillPlayer(player);
      } else {
        player.anim = 'HitReaction';
        this.broadcastCombatEvent({
          type: 'player_damaged',
          targetPlayerId: player.id,
          targetPlayerName: player.nickname,
          damage: attackHit.damage,
          worldPos: player.position.toArray() as [number, number, number],
          message: `${player.nickname} took ${attackHit.damage} DMG!`,
        });
      }
    }
  }

  public downOrKillPlayer(player: ServerPlayerSession): void {
    player.health = 0;
    player.leftHook.active = false;
    player.leftHook.isTaut = false;
    player.leftHook.attachedTitanId = null;
    player.leftHook.attachedZone = null;
    player.rightHook.active = false;
    player.rightHook.isTaut = false;
    player.rightHook.attachedTitanId = null;
    player.rightHook.attachedZone = null;
    player.isBoosting = false;

    const otherAliveTeammates = Array.from(this.players.values()).some(
      (p) => p.connected && p.id !== player.id && p.lifeState === 'alive'
    );

    if (otherAliveTeammates) {
      player.lifeState = 'downed';
      player.downedTimer = 30.0;
      player.reviveProgress = 0;
      player.reviverId = null;
      this.broadcastCombatEvent({
        type: 'player_downed',
        targetPlayerId: player.id,
        targetPlayerName: player.nickname,
        worldPos: player.position.toArray() as [number, number, number],
        message: `${player.nickname} is DOWNED! Hold [E] nearby to revive!`,
      });
    } else {
      player.lifeState = 'dead';
      this.checkSquadDefeatCondition();
    }
  }

  private stepDownedAndRevive(dt: number, nowMs: number): void {
    for (const downedPlayer of this.players.values()) {
      if (!downedPlayer.connected || downedPlayer.lifeState !== 'downed') {
        continue;
      }

      // Find nearest alive teammate holding E within 5.0m
      let activeReviver: ServerPlayerSession | null = null;
      for (const candidate of this.players.values()) {
        if (
          candidate.connected &&
          candidate.id !== downedPlayer.id &&
          candidate.lifeState === 'alive' &&
          candidate.reviveHoldActive &&
          candidate.position.distanceTo(downedPlayer.position) <= 5.0
        ) {
          activeReviver = candidate;
          break;
        }
      }

      if (activeReviver) {
        downedPlayer.reviverId = activeReviver.id;
        downedPlayer.reviveProgress = Math.min(
          1.0,
          downedPlayer.reviveProgress + dt / 2.2
        );
        if (downedPlayer.reviveProgress >= 1.0) {
          downedPlayer.lifeState = 'alive';
          downedPlayer.health = Math.round(downedPlayer.maxHealth * 0.5);
          downedPlayer.downedTimer = 0;
          downedPlayer.reviveProgress = 0;
          downedPlayer.reviverId = null;
          downedPlayer.leftHook.active = false;
          downedPlayer.rightHook.active = false;
          downedPlayer.invulnerableUntilMs = nowMs + 2000;
          activeReviver.score += 300;
          this.teamScore += 300;

          this.broadcastCombatEvent({
            type: 'player_revived',
            attackerId: activeReviver.id,
            attackerName: activeReviver.nickname,
            targetPlayerId: downedPlayer.id,
            targetPlayerName: downedPlayer.nickname,
            worldPos: downedPlayer.position.toArray() as [
              number,
              number,
              number,
            ],
            message: `${activeReviver.nickname} revived ${downedPlayer.nickname}! (+300)`,
          });
        }
      } else {
        downedPlayer.reviverId = null;
        downedPlayer.reviveProgress = Math.max(
          0,
          downedPlayer.reviveProgress - dt * 0.5
        );
        downedPlayer.downedTimer = Math.max(0, downedPlayer.downedTimer - dt);
        if (downedPlayer.downedTimer <= 0) {
          downedPlayer.lifeState = 'dead';
          this.checkSquadDefeatCondition();
        }
      }
    }
  }

  private checkSquadDefeatCondition(): void {
    if (this.phase !== 'playing') return;
    const connectedPlayers = Array.from(this.players.values()).filter(
      (p) => p.connected
    );
    if (connectedPlayers.length === 0) return;

    const anyAlive = connectedPlayers.some((p) => p.lifeState === 'alive');
    if (!anyAlive) {
      this.phase = 'defeat';
    }
  }

  private broadcastCombatEvent(evt: S2C_CombatEvent): void {
    this.broadcast('combat_event', evt);
  }

  public getRoomSnapshot(): NetRoomState {
    const playersObj: Record<string, NetPlayerState> = {};
    for (const [id, p] of this.players.entries()) {
      playersObj[id] = {
        id: p.id,
        nickname: p.nickname,
        colorHex: p.colorHex,
        connected: p.connected,
        ready: p.ready,
        isLeader: p.isLeader,
        lifeState: p.lifeState,
        position: [
          Math.round(p.position.x * 100) / 100,
          Math.round(p.position.y * 100) / 100,
          Math.round(p.position.z * 100) / 100,
        ],
        velocity: [
          Math.round(p.velocity.x * 100) / 100,
          Math.round(p.velocity.y * 100) / 100,
          Math.round(p.velocity.z * 100) / 100,
        ],
        yaw: Math.round(p.yaw * 1000) / 1000,
        grounded: p.grounded,
        isBoosting: p.isBoosting,
        anim: p.anim,
        health: Math.round(p.health),
        maxHealth: p.maxHealth,
        gas: Math.round(p.gas),
        maxGas: p.maxGas,
        bladeDurability: Math.round(p.bladeDurability),
        spareBlades: p.spareBlades,
        thunderSpears: p.thunderSpears,
        grabbedByTitanId: p.grabbedByTitanId,
        grabEscapeProgress: Math.round(p.grabEscapeProgress * 100) / 100,
        leftHook: this.serializeHook(p.leftHook),
        rightHook: this.serializeHook(p.rightHook),
        downedTimer: Math.round(p.downedTimer * 10) / 10,
        reviveProgress: Math.round(p.reviveProgress * 100) / 100,
        reviverId: p.reviverId,
        kills: p.kills,
        assists: p.assists,
        score: p.score,
        damageDealt: p.damageDealt,
        lastAckedSeq: p.lastAckedSeq,
      };
    }

    const titansObj: Record<string, ReturnType<ServerTitan['toNetState']>> = {};
    for (const [tid, t] of this.titans.entries()) {
      titansObj[tid] = t.toNetState();
    }

    const rank =
      this.teamScore >= 9000
        ? 'S'
        : this.teamScore >= 6000
          ? 'A'
          : this.teamScore >= 3000
            ? 'B'
            : 'C';

    return {
      roomId: this.roomId,
      roomCode: this.roomCode,
      roomName: this.customRoomName,
      isPublic: this.isPublic,
      maxPlayers: 4,
      phase: this.phase,
      leaderId: this.leaderId,
      serverTick: this.serverTick,
      serverTimeMs: Date.now(),
      wave: this.wave,
      maxWaves: this.maxWaves,
      totalKills: this.totalKills,
      targetKills: this.targetKills,
      teamScore: this.teamScore,
      elapsedSeconds: Math.round(this.elapsedSeconds * 10) / 10,
      rank,
      players: playersObj,
      titans: titansObj,
      pings: this.pings,
    };
  }

  private serializeHook(h: ServerHook): NetHookState {
    return {
      active: h.active,
      anchor: [
        Math.round(h.anchorPos.x * 100) / 100,
        Math.round(h.anchorPos.y * 100) / 100,
        Math.round(h.anchorPos.z * 100) / 100,
      ],
      restLength: Math.round(h.restLength * 100) / 100,
      isTaut: h.isTaut,
      attachedTitanId: h.attachedTitanId,
      attachedZone: h.attachedZone,
    };
  }

  private broadcastSnapshot(): void {
    this.broadcast('room_snapshot', this.getRoomSnapshot());
  }
}
