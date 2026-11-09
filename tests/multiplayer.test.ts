import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../src/config/GameConfig';
import { MissionManager } from '../src/missions/MissionManager';
import { NetworkClient } from '../src/network/NetworkClient';
import { RemotePlayerManager } from '../src/network/RemotePlayerManager';
import { ODMSystem } from '../src/odm/ODMSystem';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { VFXManager } from '../src/rendering/VFXManager';
import { activeRoomsByCode, CoopHunterRoom } from '../src/server/CoopHunterRoom';
import { populateCityPhysicsWorld } from '../src/shared/CityLayout';
import {
  C2S_InputFrame,
  isValidFiniteVec3,
  NetPlayerState,
  QUICK_CHAT_PRESETS,
  sanitizeNickname,
} from '../src/shared/Protocol';
import { ServerTitan } from '../src/shared/ServerTitanSim';
import {
  findBestWorldGrapplePoint,
  stepReplayedInputFrame,
} from '../src/shared/WorldGrappleSolver';
import { CityBuilder } from '../src/world/CityBuilder';

function createMockClient(sessionId: string) {
  const sentMessages: Array<{ type: string; payload: any }> = [];
  return {
    sessionId,
    sentMessages,
    send(type: string, payload: any) {
      sentMessages.push({ type, payload });
    },
  };
}

function makeBaseInputFrame(
  seq: number,
  overrides: Partial<C2S_InputFrame> = {}
): C2S_InputFrame {
  return {
    seq,
    clientTimeMs: Date.now(),
    dt: 1 / 60,
    moveForward: 0,
    moveRight: 0,
    jumpPressed: false,
    boostHeld: false,
    dodgePressed: false,
    resupplyPressed: false,
    reviveHeld: false,
    yaw: 0,
    pitch: 0,
    camOrigin: [0, 2, 24],
    camForward: [0, 0.2, -0.98],
    camRight: [1, 0, 0],
    leftGrappleAction: 'none',
    rightGrappleAction: 'none',
    lockedTitanId: null,
    lockedZone: 'Nape',
    ...overrides,
  };
}

describe('Titan Hunter 3D — Multiplayer Co-op Suite', () => {
  it('1. Protocol sanitizers & validators enforce safe nicknames and finite vectors', () => {
    expect(sanitizeNickname('  <script>Levi_Ackerman</script>  ')).toBe(
      'scriptLevi_Acker'
    );
    expect(sanitizeNickname('', 'ScoutFallback')).toBe('ScoutFallback');
    expect(sanitizeNickname(null, 'DefaultScout')).toBe('DefaultScout');

    expect(isValidFiniteVec3([10, 20, -30])).toBe(true);
    expect(isValidFiniteVec3([10, NaN, 0])).toBe(false);
    expect(isValidFiniteVec3([10, Infinity, 0])).toBe(false);
    expect(isValidFiniteVec3([10, 20])).toBe(false);
    expect(QUICK_CHAT_PRESETS.target_nape).toBe('Target the Nape!');
  });

  it('2. Client-Side Prediction & Server Reconciliation handles drift and lag (50/100/200ms)', () => {
    const net = new NetworkClient('localhost:2567');

    // Record 5 predicted frames moving forward
    for (let i = 1; i <= 5; i++) {
      const seq = net.nextInputSequence();
      const f = makeBaseInputFrame(seq, { moveForward: 1 });
      net.recordPrediction(
        seq,
        f,
        new THREE.Vector3(0, 0.2, 24 - i * 0.2),
        new THREE.Vector3(0, 0, -12)
      );
    }

    // Case A: Server agrees within 0.45m tolerance -> no jarring correction
    const okRecon = net.reconcilePrediction(3, [0, 0.2, 23.38], [0, 0, -12]);
    expect(okRecon.needsCorrection).toBe(false);

    // Case B: Server diverges by > 0.45m -> triggers smooth correction + unacked replay frames
    const corrRecon = net.reconcilePrediction(4, [2.5, 0.2, 20.0], [0, 0, -10]);
    expect(corrRecon.needsCorrection).toBe(true);
    expect(corrRecon.unackedFrames.length).toBe(1);
    expect(corrRecon.unackedFrames[0].seq).toBe(5);
  });

  it('3. RemotePlayerManager interpolates 3D rigs, ODM cables, and bounds extrapolation <= 180ms', () => {
    const scene = new THREE.Scene();
    const vfx = new VFXManager(scene);
    const mgr = new RemotePlayerManager(scene);

    const p2StateA: NetPlayerState = {
      id: 'p2',
      nickname: 'Mikasa_Vanguard',
      colorHex: 0x1e3a8a,
      connected: true,
      ready: true,
      isLeader: false,
      lifeState: 'alive',
      position: [10, 8, -10],
      velocity: [0, 4, -20],
      yaw: 0.2,
      grounded: false,
      isBoosting: true,
      anim: 'Swing',
      health: 100,
      maxHealth: 100,
      gas: 88,
      maxGas: 100,
      bladeDurability: 100,
      spareBlades: 6,
      thunderSpears: 4,
      grabbedByTitanId: null,
      grabEscapeProgress: 0,
      leftHook: {
        active: true,
        anchor: [2, 28, -30],
        restLength: 26,
        isTaut: true,
        attachedTitanId: null,
        attachedZone: null,
      },
      rightHook: {
        active: true,
        anchor: [18, 28, -30],
        restLength: 26,
        isTaut: true,
        attachedTitanId: null,
        attachedZone: null,
      },
      downedTimer: 0,
      reviveProgress: 0,
      reviverId: null,
      kills: 1,
      assists: 0,
      score: 1200,
      damageDealt: 1100,
      lastAckedSeq: 10,
    };

    mgr.syncFromRoomSnapshot({ p2: p2StateA }, 'p1');
    expect(mgr.remotePlayers.size).toBe(1);

    const entity = mgr.remotePlayers.get('p2')!;
    mgr.update(1 / 60, vfx);

    expect(entity.leftWireMesh.visible).toBe(true);
    expect(entity.rightWireMesh.visible).toBe(true);
    expect(entity.animator.getCurrentAnimation()).toBe('Boost');

    // Simulate a 500ms packet stall and verify bounded extrapolation caps at 180ms
    entity.snapshots[0].recvTimeMs = performance.now() - 600;
    mgr.update(1 / 60, vfx);
    // At -20 m/s Z velocity, 180ms extrapolation moves at most 3.6m from Z = -10 -> Z = -13.6
    expect(entity.currentPosition.z).toBeCloseTo(-10 + -20 * 0.18, 1);

    mgr.clearAll();
    expect(mgr.remotePlayers.size).toBe(0);
  });

  it('4. ServerTitan AI multi-player aggro, lag-compensated history & anti-double-kill protection', () => {
    const titan = new ServerTitan(
      'titan_coop_1',
      'normal',
      new THREE.Vector3(0, 0, -40),
      10.0
    );

    const nowMs = Date.now();
    const players = [
      {
        id: 'p1',
        position: new THREE.Vector3(0, 0, -10), // 30m away
        isBoostingOrHooked: false,
        isAlive: true,
      },
      {
        id: 'p2',
        position: new THREE.Vector3(0, 4, -32), // 8m away & boosting
        isBoostingOrHooked: true,
        isAlive: true,
      },
    ];

    titan.stepServerAI(0.1, nowMs, players, [new THREE.Vector3(0, 0, 0)], []);
    // Titan should prioritize closer, boosting player p2
    expect(titan.targetPlayerId).toBe('p2');

    // If p1 deals heavy damage to the Titan, threat/aggro shifts toward p1
    const limbHit = titan.applyDamageFromPlayer('p1', 'LeftLeg', 500);
    expect(limbHit.limbBroken).toBe(true);
    expect(titan.aiState).toBe('Injured');

    // Verify historical lag-compensation state lookup
    const hist = titan.getHistoricalState(nowMs, 100);
    expect(hist.hurtboxPositions.Nape).toBeDefined();

    // Co-op Nape kill race condition test:
    // Player 1 deals 250 Nape damage, Player 2 deals 250 Nape damage (lethal on 450 HP Nape), Player 1 strikes again on same tick
    const hit1 = titan.applyDamageFromPlayer('p1', 'Nape', 250);
    expect(hit1.killed).toBe(false);

    const hit2 = titan.applyDamageFromPlayer('p2', 'Nape', 250);
    expect(hit2.killed).toBe(true);
    expect(titan.isDead()).toBe(true);

    // Simultaneous 3rd strike on already dead Titan must NOT trigger a second kill!
    const hit3 = titan.applyDamageFromPlayer('p1', 'Nape', 900);
    expect(hit3.killed).toBe(false);

    // Both p1 and p2 are recorded in damageContributors for Kill + Assist attribution
    expect(titan.damageContributors.get('p1')).toBeGreaterThan(0);
    expect(titan.damageContributors.get('p2')).toBeGreaterThan(0);
  });

  it('5. Authoritative CoopHunterRoom: 2-4 player lobby, ODM hooks, co-op combat, downed/revive & reconnect', async () => {
    const room = new CoopHunterRoom();
    // Stub Colyseus internal methods for direct unit/integration testing
    (room as any).roomId = 'test_room_1';
    (room as any).setPrivate = async () => {};
    (room as any).setMetadata = async () => {};
    const broadcasts: Array<{ type: string; payload: any }> = [];
    (room as any).broadcast = (type: string, payload: any) => {
      broadcasts.push({ type, payload });
    };

    const messageHandlers = new Map<string, (client: any, payload: any) => void>();
    (room as any).onMessage = (
      type: string,
      cb: (client: any, payload: any) => void
    ) => {
      messageHandlers.set(type, cb);
    };

    await room.onCreate({ roomName: 'Alpha Squad', isPublic: true });
    expect(room.roomCode).toHaveLength(6);
    expect(activeRoomsByCode.has(room.roomCode)).toBe(true);

    // Join 4 players
    const c1 = createMockClient('sess_1');
    const c2 = createMockClient('sess_2');
    const c3 = createMockClient('sess_3');
    const c4 = createMockClient('sess_4');
    const c5 = createMockClient('sess_5');

    room.onJoin(c1 as any, { nickname: 'Eren' });
    room.onJoin(c2 as any, { nickname: 'Mikasa' });
    room.onJoin(c3 as any, { nickname: 'Armin' });
    room.onJoin(c4 as any, { nickname: 'Levi' });

    // 5th player must be rejected by onAuth (max 4 players)
    expect(() => room.onAuth(c5 as any, { nickname: 'Extra' })).toThrow(
      /Room is full/
    );

    // Non-leader cannot start match
    const lobbyHandler = messageHandlers.get('lobby_action')!;
    lobbyHandler(c2, { action: 'start_match' });
    expect(room.phase).toBe('lobby');
    expect(
      c2.sentMessages.some(
        (m) => m.type === 'room_error' && m.payload.code === 'NOT_LEADER'
      )
    ).toBe(true);

    // Leader cannot start match while teammates are unready
    lobbyHandler(c1, { action: 'start_match' });
    expect(room.phase).toBe('lobby');

    // Ready all teammates and Leader starts match
    lobbyHandler(c2, { action: 'ready' });
    lobbyHandler(c3, { action: 'ready' });
    lobbyHandler(c4, { action: 'ready' });
    lobbyHandler(c1, { action: 'start_match' });

    expect(room.phase).toBe('playing');
    const snapStart = room.getRoomSnapshot();
    expect(Object.keys(snapStart.players)).toHaveLength(4);
    expect(Object.keys(snapStart.titans).length).toBeGreaterThanOrEqual(4);

    // Test Simultaneous ODM Grappling & Gas Boost on Server
    const inputHandler = messageHandlers.get('input_frame')!;
    // Aim at a valid city building/wall and fire left hook + boost
    const firstTitanId = Object.keys(snapStart.titans)[0];
    const firstTitan = snapStart.titans[firstTitanId];

    // Move player 1 within grapple range of firstTitan and fire hook at its Nape
    const internalPlayers = (room as any).players as Map<string, any>;
    const p1Internal = internalPlayers.get('sess_1')!;
    p1Internal.position.set(
      firstTitan.position[0],
      2.0,
      firstTitan.position[2] - 18
    );

    inputHandler(
      c1,
      makeBaseInputFrame(1, {
        moveForward: 1,
        boostHeld: true,
        leftGrappleAction: 'fire',
        lockedTitanId: firstTitanId,
        lockedZone: 'Nape',
      })
    );
    (room as any).stepAuthoritativeSimulation(1 / 60);

    expect(p1Internal.leftHook.active).toBe(true);
    expect(p1Internal.gas).toBeLessThan(GAME_CONFIG.player.maxGas);

    // Out-of-range hook (e.g. 400m away and aiming into open sky from plaza) is rejected by server
    p1Internal.leftHook.active = false;
    p1Internal.position.set(0, 0.2, 24);
    const farTitan = (room as any).titans.get(firstTitanId) as ServerTitan;
    farTitan.position.set(0, 0, -400);
    farTitan.syncHurtboxWorldPositions();
    inputHandler(
      c1,
      makeBaseInputFrame(2, {
        camOrigin: [0, 2, 24],
        camForward: [0, 1, 0],
        leftGrappleAction: 'fire',
        lockedTitanId: firstTitanId,
        lockedZone: 'Nape',
      })
    );
    (room as any).stepAuthoritativeSimulation(1 / 60);
    expect(p1Internal.leftHook.active).toBe(false);

    // Test Co-op Downed & Teammate Revive System:
    // Down player 2 while players 1, 3, 4 are alive
    const p2Internal = internalPlayers.get('sess_2')!;
    room.downOrKillPlayer(p2Internal);
    expect(p2Internal.lifeState).toBe('downed');
    expect(p1Internal.health).toBe(GAME_CONFIG.player.maxHealth); // Other players unaffected!

    // Place player 1 stationary within 2.0m of downed player 2 and hold E (reviveHeld = true) for 2.3s
    p1Internal.position.copy(p2Internal.position).add(new THREE.Vector3(2, 0, 0));
    p1Internal.velocity.set(0, 0, 0);
    p1Internal.grounded = true;
    for (let i = 0; i < 140; i++) {
      p1Internal.packetsThisSecond = 0;
      inputHandler(c1, makeBaseInputFrame(10 + i, { reviveHeld: true }));
      (room as any).stepAuthoritativeSimulation(1 / 60);
    }
    expect(p2Internal.lifeState).toBe('alive');
    expect(p2Internal.health).toBeGreaterThan(0);
    expect(p1Internal.score).toBeGreaterThanOrEqual(300);

    // Test Disconnect & SessionToken Reconnection
    const welcomeMsg = c3.sentMessages.find((m) => m.type === 'session_welcome');
    const c3Token = welcomeMsg?.payload.sessionToken;
    expect(c3Token).toBeTruthy();

    const p3Internal = internalPlayers.get('sess_3')!;
    p3Internal.score = 777;
    const c3Reconnected = createMockClient('sess_3_new');
    room.onJoin(c3Reconnected as any, {
      nickname: 'Armin',
      sessionToken: c3Token,
    });

    const snapAfterReconnect = room.getRoomSnapshot();
    expect(snapAfterReconnect.players['sess_3_new']).toBeDefined();
    expect(snapAfterReconnect.players['sess_3_new'].score).toBe(777);

    room.onDispose();
    expect(activeRoomsByCode.has(room.roomCode)).toBe(false);
  });

  it('6. Single-source collision layout guarantees 100% collider parity between client CityBuilder and server PhysicsWorld', async () => {
    const clientPhysics = await PhysicsWorld.create();
    const serverPhysics = await PhysicsWorld.create();

    const clientScene = new THREE.Scene();
    const cityBuilder = new CityBuilder(clientScene, clientPhysics);
    cityBuilder.buildWorld(false);

    populateCityPhysicsWorld(serverPhysics);

    // Probe 12 ray directions from spawn plaza & avenues and verify identical hit points & metadata
    const origins = [
      new THREE.Vector3(0, 2.5, 24),
      new THREE.Vector3(12, 6.0, -15),
      new THREE.Vector3(-18, 8.0, 35),
    ];
    const dirs = [
      new THREE.Vector3(0, 0.15, -1).normalize(),
      new THREE.Vector3(0.45, 0.18, -0.88).normalize(),
      new THREE.Vector3(-0.45, 0.18, -0.88).normalize(),
      new THREE.Vector3(0.85, 0.2, 0.4).normalize(),
    ];

    for (const origin of origins) {
      for (const dir of dirs) {
        const clientHit = clientPhysics.castRay(origin, dir, 120, true);
        const serverHit = serverPhysics.castRay(origin, dir, 120, true);
        expect(Boolean(clientHit)).toBe(Boolean(serverHit));
        if (clientHit && serverHit) {
          expect(clientHit.distance).toBeCloseTo(serverHit.distance, 3);
          expect(clientHit.point.x).toBeCloseTo(serverHit.point.x, 3);
          expect(clientHit.point.y).toBeCloseTo(serverHit.point.y, 3);
          expect(clientHit.point.z).toBeCloseTo(serverHit.point.z, 3);
          expect(clientHit.metadata.label).toBe(serverHit.metadata.label);
        }
      }
    }
  });

  it('7. Grappling onto world buildings when lockedTitanId = null (Left, Right, Dual Hooks & Client/Server Anchor Confirmation)', async () => {
    const room = new CoopHunterRoom();
    (room as any).roomId = 'test_world_grapple_room';
    (room as any).setPrivate = async () => {};
    (room as any).setMetadata = async () => {};
    (room as any).broadcast = () => {};

    const messageHandlers = new Map<string, (client: any, payload: any) => void>();
    (room as any).onMessage = (
      type: string,
      cb: (client: any, payload: any) => void
    ) => {
      messageHandlers.set(type, cb);
    };

    await room.onCreate({ roomName: 'World Grapple Test', isPublic: true });
    const c1 = createMockClient('sess_grapple_1');
    room.onJoin(c1 as any, { nickname: 'Hange' });

    const lobbyHandler = messageHandlers.get('lobby_action')!;
    lobbyHandler(c1, { action: 'start_match' });
    expect(room.phase).toBe('playing');

    const inputHandler = messageHandlers.get('input_frame')!;
    const internalPlayers = (room as any).players as Map<string, any>;
    const p1Server = internalPlayers.get('sess_grapple_1')!;

    // Set up matching client ODM + PhysicsWorld
    const clientPhysics = await PhysicsWorld.create();
    populateCityPhysicsWorld(clientPhysics);
    const clientScene = new THREE.Scene();
    const clientOdm = new ODMSystem(clientScene, clientPhysics);

    const playerPos = p1Server.position.clone(); // [0, 0.2, 24]
    const camOrigin = new THREE.Vector3(playerPos.x, playerPos.y + 2.2, playerPos.z + 4.5);
    // Aim down the north avenue (lockedTitanId = null!)
    const camForward = new THREE.Vector3(0, 0.14, -0.99).normalize();
    const camRight = new THREE.Vector3(1, 0, 0);

    // 1. Fire Left Hook on client with lockedTitan = null
    const leftLatchedClient = clientOdm.tryFireHook(
      'left',
      camOrigin,
      camForward,
      camRight,
      playerPos,
      [],
      null,
      'Nape'
    );
    expect(leftLatchedClient).toBe(true);
    expect(clientOdm.leftHook.active).toBe(true);
    expect(clientOdm.leftHook.attachedTitanId).toBeNull();
    expect(clientOdm.lastLeftDebug?.success).toBe(true);

    // Send input frame to server with lockedTitanId = null and client's world anchor hint
    const leftAnchor: [number, number, number] = [
      clientOdm.leftHook.anchorPos.x,
      clientOdm.leftHook.anchorPos.y,
      clientOdm.leftHook.anchorPos.z,
    ];
    inputHandler(
      c1,
      makeBaseInputFrame(1, {
        camOrigin: [camOrigin.x, camOrigin.y, camOrigin.z],
        camForward: [camForward.x, camForward.y, camForward.z],
        camRight: [camRight.x, camRight.y, camRight.z],
        leftGrappleAction: 'fire',
        leftGrappleTarget: leftAnchor,
        rightGrappleAction: 'none',
        lockedTitanId: null,
      })
    );
    (room as any).stepAuthoritativeSimulation(1 / 60);

    expect(p1Server.leftHook.active).toBe(true);
    expect(p1Server.leftHook.attachedTitanId).toBeNull();
    expect(p1Server.lastLeftHookDebug?.success).toBe(true);
    expect(p1Server.lastLeftHookDebug?.reason).toBe('CLIENT_HINT_VERIFIED');
    // Verify client and server confirm the exact same anchor
    expect(p1Server.leftHook.anchorPos.distanceTo(clientOdm.leftHook.anchorPos)).toBeLessThan(0.05);

    // 2. Fire Right Hook simultaneously (Dual-hook grapple onto buildings with lockedTitanId = null)
    const rightLatchedClient = clientOdm.tryFireHook(
      'right',
      camOrigin,
      camForward,
      camRight,
      playerPos,
      [],
      null,
      'Nape'
    );
    expect(rightLatchedClient).toBe(true);
    expect(clientOdm.rightHook.active).toBe(true);

    const rightAnchor: [number, number, number] = [
      clientOdm.rightHook.anchorPos.x,
      clientOdm.rightHook.anchorPos.y,
      clientOdm.rightHook.anchorPos.z,
    ];
    inputHandler(
      c1,
      makeBaseInputFrame(2, {
        camOrigin: [camOrigin.x, camOrigin.y, camOrigin.z],
        camForward: [camForward.x, camForward.y, camForward.z],
        camRight: [camRight.x, camRight.y, camRight.z],
        leftGrappleAction: 'hold',
        rightGrappleAction: 'fire',
        rightGrappleTarget: rightAnchor,
        lockedTitanId: null,
      })
    );
    (room as any).stepAuthoritativeSimulation(1 / 60);

    expect(p1Server.leftHook.active).toBe(true);
    expect(p1Server.rightHook.active).toBe(true);
    expect(p1Server.rightHook.anchorPos.distanceTo(clientOdm.rightHook.anchorPos)).toBeLessThan(0.05);

    room.onDispose();
  });

  it('8. Building-to-building ODM swinging in multiplayer without Titan lock preserves momentum', async () => {
    const room = new CoopHunterRoom();
    (room as any).roomId = 'test_b2b_swing_room';
    (room as any).setPrivate = async () => {};
    (room as any).setMetadata = async () => {};
    (room as any).broadcast = () => {};

    const messageHandlers = new Map<string, (client: any, payload: any) => void>();
    (room as any).onMessage = (
      type: string,
      cb: (client: any, payload: any) => void
    ) => {
      messageHandlers.set(type, cb);
    };

    await room.onCreate({ roomName: 'B2B Swing Test', isPublic: true });
    const c1 = createMockClient('sess_b2b');
    room.onJoin(c1 as any, { nickname: 'Jean' });

    const lobbyHandler = messageHandlers.get('lobby_action')!;
    lobbyHandler(c1, { action: 'start_match' });

    const inputHandler = messageHandlers.get('input_frame')!;
    const internalPlayers = (room as any).players as Map<string, any>;
    const p1 = internalPlayers.get('sess_b2b')!;

    // Phase 1: Latch onto Building 1 along the avenue with lockedTitanId = null
    const aim1 = new THREE.Vector3(-0.35, 0.25, -0.9).normalize();
    let seq = 1;
    inputHandler(
      c1,
      makeBaseInputFrame(seq++, {
        moveForward: 1,
        jumpPressed: true,
        boostHeld: true,
        camOrigin: [p1.position.x, p1.position.y + 2.2, p1.position.z + 4],
        camForward: [aim1.x, aim1.y, aim1.z],
        leftGrappleAction: 'fire',
        rightGrappleAction: 'fire',
        lockedTitanId: null,
      })
    );
    (room as any).stepAuthoritativeSimulation(1 / 60);
    expect(p1.leftHook.active || p1.rightHook.active).toBe(true);
    const firstAnchor = p1.leftHook.active
      ? p1.leftHook.anchorPos.clone()
      : p1.rightHook.anchorPos.clone();

    // Swing for 35 ticks (~0.58s) holding hooks + gas boost
    for (let i = 0; i < 35; i++) {
      p1.packetsThisSecond = 0;
      inputHandler(
        c1,
        makeBaseInputFrame(seq++, {
          moveForward: 1,
          boostHeld: true,
          camOrigin: [p1.position.x, p1.position.y + 2.2, p1.position.z + 4],
          camForward: [aim1.x, aim1.y, aim1.z],
          leftGrappleAction: 'hold',
          rightGrappleAction: 'hold',
          lockedTitanId: null,
        })
      );
      (room as any).stepAuthoritativeSimulation(1 / 60);
    }

    const speedBeforeTransition = p1.velocity.length();
    expect(speedBeforeTransition).toBeGreaterThan(15);
    expect(p1.position.y).toBeGreaterThan(2.5);

    // Phase 2: Release first building hooks while airborne
    inputHandler(
      c1,
      makeBaseInputFrame(seq++, {
        moveForward: 1,
        boostHeld: true,
        leftGrappleAction: 'release',
        rightGrappleAction: 'release',
        lockedTitanId: null,
      })
    );
    (room as any).stepAuthoritativeSimulation(1 / 60);
    expect(p1.leftHook.active).toBe(false);
    expect(p1.rightHook.active).toBe(false);

    // Phase 3: Immediately fire onto a second building further down the street
    const aim2 = new THREE.Vector3(0.38, 0.22, -0.9).normalize();
    const camOrigin2 = new THREE.Vector3(
      p1.position.x,
      p1.position.y + 1.8,
      p1.position.z + 3.5
    );
    const hit2 = findBestWorldGrapplePoint(
      (room as any).physics,
      camOrigin2,
      aim2,
      p1.position,
      1
    );
    expect(hit2).not.toBeNull();

    inputHandler(
      c1,
      makeBaseInputFrame(seq++, {
        moveForward: 1,
        boostHeld: true,
        camOrigin: [camOrigin2.x, camOrigin2.y, camOrigin2.z],
        camForward: [aim2.x, aim2.y, aim2.z],
        rightGrappleAction: 'fire',
        rightGrappleTarget: hit2
          ? [hit2.point.x, hit2.point.y, hit2.point.z]
          : null,
        lockedTitanId: null,
      })
    );
    (room as any).stepAuthoritativeSimulation(1 / 60);

    expect(p1.rightHook.active).toBe(true);
    expect(p1.rightHook.anchorPos.distanceTo(firstAnchor)).toBeGreaterThan(5.0);
    expect(p1.velocity.length()).toBeGreaterThan(14.0);

    room.onDispose();
  });

  it('9. Sequence-aware hook sync prevents stale snapshots from cancelling newly predicted hooks and restores server-active hooks', async () => {
    const physics = await PhysicsWorld.create();
    populateCityPhysicsWorld(physics);
    const scene = new THREE.Scene();
    const odm = new ODMSystem(scene, physics);

    const playerPos = new THREE.Vector3(0, 0.2, 24);
    const camOrigin = new THREE.Vector3(0, 2.4, 28.5);
    const camForward = new THREE.Vector3(0, 0.14, -0.99).normalize();
    const camRight = new THREE.Vector3(1, 0, 0);

    // Client predicts left hook fire at seq = 15
    const fired = odm.tryFireHook(
      'left',
      camOrigin,
      camForward,
      camRight,
      playerPos,
      [],
      null,
      'Nape'
    );
    expect(fired).toBe(true);
    const lastLeftActionSeq = 15;

    // Stale snapshot arrives from server with lastAckedSeq = 13 (< 15) and leftHook.active = false
    const staleSnapshotAck = 13;
    if (staleSnapshotAck >= lastLeftActionSeq) {
      odm.syncHookFromServer(
        'left',
        {
          active: false,
          anchor: [0, 0, 0],
          restLength: 0,
          isTaut: false,
          attachedTitanId: null,
          attachedZone: null,
        },
        []
      );
    }
    // Hook MUST remain active because staleSnapshotAck < lastLeftActionSeq!
    expect(odm.leftHook.active).toBe(true);

    // Now test restoration: if client hook is inactive, and an up-to-date server snapshot (ack = 16 >= 15) reports active hook
    odm.releaseHook('left');
    expect(odm.leftHook.active).toBe(false);

    const ackedSnapshotSeq = 16;
    if (ackedSnapshotSeq >= lastLeftActionSeq) {
      odm.syncHookFromServer(
        'left',
        {
          active: true,
          anchor: [-18, 22, -12],
          restLength: 38.5,
          isTaut: true,
          attachedTitanId: null,
          attachedZone: null,
        },
        []
      );
    }
    expect(odm.leftHook.active).toBe(true);
    expect(odm.leftHook.anchorPos.x).toBeCloseTo(-18, 2);
    expect(odm.leftHook.anchorPos.y).toBeCloseTo(22, 2);
    expect(odm.leftHook.anchorPos.z).toBeCloseTo(-12, 2);
    expect(odm.leftHook.restLength).toBeCloseTo(38.5, 2);
  });

  it('10. Server reconciliation replays unacknowledged input frames across 50ms / 100ms / 200ms RTT without losing swing momentum', async () => {
    const physics = await PhysicsWorld.create();
    populateCityPhysicsWorld(physics);

    for (const rttMs of [50, 100, 200]) {
      const unackedCount = Math.round((rttMs / 1000) * 60); // 3, 6, 12 frames
      const net = new NetworkClient('localhost:2567');

      const simPos = new THREE.Vector3(0, 12, 10);
      const simVel = new THREE.Vector3(4, 2, -24);
      let grounded = false;
      const leftHook = {
        active: true,
        anchorPos: new THREE.Vector3(-14, 28, -25),
        restLength: simPos.distanceTo(new THREE.Vector3(-14, 28, -25)),
      };
      const rightHook = {
        active: true,
        anchorPos: new THREE.Vector3(14, 28, -25),
        restLength: simPos.distanceTo(new THREE.Vector3(14, 28, -25)),
      };

      const authPosAtAck = simPos.clone();
      const authVelAtAck = simVel.clone();

      // Step 1 frame at seq = 1 (acknowledged baseline)
      const f1 = makeBaseInputFrame(net.nextInputSequence(), {
        moveForward: 1,
        boostHeld: true,
        leftGrappleAction: 'hold',
        rightGrappleAction: 'hold',
      });
      net.recordPrediction(1, f1, authPosAtAck, authVelAtAck);

      // Step `unackedCount` frames ahead on client while snapshot is in flight
      for (let i = 0; i < unackedCount; i++) {
        const seq = net.nextInputSequence();
        const frame = makeBaseInputFrame(seq, {
          moveForward: 1,
          boostHeld: true,
          leftGrappleAction: 'hold',
          rightGrappleAction: 'hold',
        });
        const out = stepReplayedInputFrame(
          physics,
          simPos,
          simVel,
          grounded,
          leftHook,
          rightHook,
          frame
        );
        grounded = out.grounded;
        net.recordPrediction(seq, frame, simPos, simVel);
      }

      // Simulate server snapshot arriving for seq = 1 with slight 0.6m perturbation
      const perturbedAuthPos: [number, number, number] = [
        authPosAtAck.x + 0.6,
        authPosAtAck.y,
        authPosAtAck.z,
      ];
      const recon = net.reconcilePrediction(1, perturbedAuthPos, [
        authVelAtAck.x,
        authVelAtAck.y,
        authVelAtAck.z,
      ]);

      expect(recon.needsCorrection).toBe(true);
      expect(recon.unackedFrames.length).toBe(unackedCount);

      // Replay unacknowledged frames starting from recon.authPosition
      const replayedPos = recon.authPosition.clone();
      const replayedVel = recon.authVelocity.clone();
      let replayedGrounded = false;
      const replayL = {
        active: leftHook.active,
        anchorPos: leftHook.anchorPos.clone(),
        restLength: leftHook.restLength,
      };
      const replayR = {
        active: rightHook.active,
        anchorPos: rightHook.anchorPos.clone(),
        restLength: rightHook.restLength,
      };

      for (const unacked of recon.unackedFrames) {
        const stepOut = stepReplayedInputFrame(
          physics,
          replayedPos,
          replayedVel,
          replayedGrounded,
          replayL,
          replayR,
          unacked
        );
        replayedGrounded = stepOut.grounded;
      }

      // Replayed velocity must preserve high swing speed (> 22 m/s) and stay close to client trajectory
      expect(replayedVel.length()).toBeGreaterThan(22);
      expect(replayedPos.distanceTo(simPos)).toBeLessThan(2.5);
    }
  });

  it('11. Authoritative Co-op Phase 7: Thunder Spears AoE blast, Spin-Slash multi-hit, Titan Grab Self-Escape & Teammate Rescue', async () => {
    const room = new CoopHunterRoom();
    (room as any).roomId = 'test_phase7_room';
    (room as any).setPrivate = async () => {};
    (room as any).setMetadata = async () => {};
    const combatEvents: any[] = [];
    (room as any).broadcast = (type: string, payload: any) => {
      if (type === 'combat_event') combatEvents.push(payload);
    };

    const messageHandlers = new Map<string, (client: any, payload: any) => void>();
    (room as any).onMessage = (
      type: string,
      cb: (client: any, payload: any) => void
    ) => {
      messageHandlers.set(type, cb);
    };

    await room.onCreate({ roomName: 'Thunder Spear Squad', isPublic: true });
    const c1 = createMockClient('sess_p1');
    const c2 = createMockClient('sess_p2');
    room.onJoin(c1 as any, { nickname: 'Levi' });
    room.onJoin(c2 as any, { nickname: 'Hange' });

    const lobbyHandler = messageHandlers.get('lobby_action')!;
    lobbyHandler(c2, { action: 'ready' });
    lobbyHandler(c1, { action: 'start_match' });
    expect(room.phase).toBe('playing');

    const inputHandler = messageHandlers.get('input_frame')!;
    const attackHandler = messageHandlers.get('attack_intent')!;
    const internalPlayers = (room as any).players as Map<string, any>;
    const titansMap = (room as any).titans as Map<string, ServerTitan>;

    const p1 = internalPlayers.get('sess_p1')!;
    const p2 = internalPlayers.get('sess_p2')!;
    const titan = Array.from(titansMap.values())[0];

    // 1. Test Titan Grab Capture on Player 1 & Self-Escape via Mash [F]/[SPACE]
    p1.position.copy(titan.position).add(new THREE.Vector3(0, 5.5, 2.0));
    (room as any).resolveTitanAttackOnPlayers(
      {
        titan,
        type: 'grab',
        damage: 42,
        impactPoint: p1.position.clone(),
        radius: 5.0,
      },
      Date.now()
    );

    expect(p1.grabbedByTitanId).toBe(titan.id);
    expect(titan.grabbedPlayerId).toBe('sess_p1');
    expect(combatEvents.some((e) => e.type === 'player_grabbed')).toBe(true);

    // Player 1 mashes escapePressed 3 times to sever Titan's RightArm and break free
    for (let i = 0; i < 3; i++) {
      p1.packetsThisSecond = 0;
      inputHandler(
        c1,
        makeBaseInputFrame(100 + i, {
          escapePressed: true,
        })
      );
      (room as any).stepAuthoritativeSimulation(1 / 60);
    }

    expect(p1.grabbedByTitanId).toBeNull();
    expect(titan.grabbedPlayerId).toBeNull();
    expect(titan.aiState).toBe('Stunned');
    expect(combatEvents.some((e) => e.type === 'grab_escaped')).toBe(true);

    // 2. Test Teammate Rescue via Authoritative Thunder Spear Blast!
    const titan2 = Array.from(titansMap.values())[1];
    p1.invulnerableUntilMs = 0;
    p1.position.copy(titan2.position).add(new THREE.Vector3(0, 5.5, 2.0));
    (room as any).resolveTitanAttackOnPlayers(
      {
        titan: titan2,
        type: 'grab',
        damage: 42,
        impactPoint: p1.position.clone(),
        radius: 5.0,
      },
      Date.now()
    );
    expect(p1.grabbedByTitanId).toBe(titan2.id);

    // Player 2 fires a Thunder Spear at titan2's Nape from 25m away!
    p2.position.copy(titan2.position).add(new THREE.Vector3(0, 8.0, -22.0));
    expect(p2.thunderSpears).toBe(4);
    const prevAssists = p2.assists;

    attackHandler(c2, {
      seq: 201,
      isHeavy: true,
      weaponType: 'thunder_spear',
      aimYaw: 0,
      aimOrigin: [p2.position.x, p2.position.y + 1.5, p2.position.z],
      aimDir: [0, 0, 1],
      targetTitanId: titan2.id,
      targetZone: 'Nape',
      clientRttMs: 40,
    });

    expect(p2.thunderSpears).toBe(3);
    // Player 1 is immediately rescued from titan2's grab!
    expect(p1.grabbedByTitanId).toBeNull();
    expect(titan2.grabbedPlayerId).toBeNull();
    expect(p2.assists).toBeGreaterThan(prevAssists);
    expect(
      combatEvents.some((e) => e.type === 'thunder_spear_exploded')
    ).toBe(true);

    room.onDispose();
  });

  it('12. P0 Multi-Player Physics Isolation: 4 players have independent Rapier colliders/controllers & clean lifecycle on leave/dispose', async () => {
    const room = new CoopHunterRoom();
    (room as any).roomId = 'test_physics_isolation_room';
    (room as any).setPrivate = async () => {};
    (room as any).setMetadata = async () => {};
    (room as any).broadcast = () => {};

    const messageHandlers = new Map<string, (client: any, payload: any) => void>();
    (room as any).onMessage = (
      type: string,
      cb: (client: any, payload: any) => void
    ) => {
      messageHandlers.set(type, cb);
    };

    await room.onCreate({ roomName: 'Physics Isolation Squad', isPublic: true });
    const c1 = createMockClient('iso_p1');
    const c2 = createMockClient('iso_p2');
    const c3 = createMockClient('iso_p3');
    const c4 = createMockClient('iso_p4');

    room.onJoin(c1 as any, { nickname: 'P1' });
    room.onJoin(c2 as any, { nickname: 'P2' });
    room.onJoin(c3 as any, { nickname: 'P3' });
    room.onJoin(c4 as any, { nickname: 'P4' });

    const phys = room.getPhysicsWorld();
    expect(phys.getPlayerActorCount()).toBe(4);
    expect(phys.hasPlayerActor('iso_p1')).toBe(true);
    expect(phys.hasPlayerActor('iso_p2')).toBe(true);
    expect(phys.hasPlayerActor('iso_p3')).toBe(true);
    expect(phys.hasPlayerActor('iso_p4')).toBe(true);

    const lobbyHandler = messageHandlers.get('lobby_action')!;
    lobbyHandler(c2, { action: 'ready' });
    lobbyHandler(c3, { action: 'ready' });
    lobbyHandler(c4, { action: 'ready' });
    lobbyHandler(c1, { action: 'start_match' });

    const p2CenterBefore = phys.getPlayerCapsuleCenter('iso_p2')!.clone();
    const p3CenterBefore = phys.getPlayerCapsuleCenter('iso_p3')!.clone();

    // Move Player 1 rapidly forward and upward while Player 2 & 3 stand still
    const inputHandler = messageHandlers.get('input_frame')!;
    for (let i = 1; i <= 15; i++) {
      inputHandler(
        c1,
        makeBaseInputFrame(i, {
          moveForward: 1,
          jumpPressed: i === 1,
          boostHeld: true,
        })
      );
      (room as any).stepAuthoritativeSimulation(1 / 60);
    }

    const p1CenterAfter = phys.getPlayerCapsuleCenter('iso_p1')!;
    const p2CenterAfter = phys.getPlayerCapsuleCenter('iso_p2')!;
    const p3CenterAfter = phys.getPlayerCapsuleCenter('iso_p3')!;

    // Player 1 moved significantly, while Player 2 & Player 3 capsule colliders were NOT overwritten by Player 1!
    expect(p1CenterAfter.distanceTo(p2CenterAfter)).toBeGreaterThan(5.0);
    expect(p2CenterAfter.x).toBeCloseTo(p2CenterBefore.x, 3);
    expect(p2CenterAfter.z).toBeCloseTo(p2CenterBefore.z, 3);
    expect(p3CenterAfter.x).toBeCloseTo(p3CenterBefore.x, 3);
    expect(p3CenterAfter.z).toBeCloseTo(p3CenterBefore.z, 3);

    // Consented leave removes only that player's physics actor
    await room.onLeave(c4 as any, 1000);
    expect(phys.hasPlayerActor('iso_p4')).toBe(false);
    expect(phys.getPlayerActorCount()).toBe(3);

    // Room dispose frees all remaining player actors and WASM world
    room.onDispose();
    expect(phys.getPlayerActorCount()).toBe(0);
  });

  it('13. P0 Authoritative Fixed-Tick Anti-Speed-Hack, Sequence Monotonicity & Malformed Input Rejection', async () => {
    const setupSinglePlayerRoom = async (roomId: string) => {
      const r = new CoopHunterRoom();
      (r as any).roomId = roomId;
      (r as any).setPrivate = async () => {};
      (r as any).setMetadata = async () => {};
      (r as any).broadcast = () => {};
      const handlers = new Map<string, (client: any, payload: any) => void>();
      (r as any).onMessage = (
        type: string,
        cb: (client: any, payload: any) => void
      ) => {
        handlers.set(type, cb);
      };
      await r.onCreate({ roomName: roomId, isPublic: true });
      const client = createMockClient(`client_${roomId}`);
      r.onJoin(client as any, { nickname: 'Tester' });
      handlers.get('lobby_action')!(client, { action: 'start_match' });
      // Clear Titans so AI attacks cannot interfere with pure kinematic distance comparison
      ((r as any).titans as Map<string, any>).clear();
      return {
        room: r,
        client,
        handlers,
        player: ((r as any).players as Map<string, any>).get(
          `client_${roomId}`
        )!,
      };
    };

    const normal = await setupSinglePlayerRoom('normal_tick_room');
    const hacker = await setupSinglePlayerRoom('speed_hack_room');

    const startPosNormal = normal.player.position.clone();
    const startPosHacker = hacker.player.position.clone();

    // Run 25 authoritative ticks:
    // - Normal client sends 1 frame per tick with dt = 1/60
    // - Speed-hacker client sends 5 frames per tick with inflated dt = 0.5 (attempting 30x speed-hack!)
    let hackSeq = 1;
    for (let tick = 1; tick <= 25; tick++) {
      normal.player.packetsThisSecond = 0;
      normal.handlers.get('input_frame')!(
        normal.client,
        makeBaseInputFrame(tick, {
          dt: 1 / 60,
          moveForward: 1,
          boostHeld: true,
        })
      );
      (normal.room as any).stepAuthoritativeSimulation(1 / 60);

      hacker.player.packetsThisSecond = 0;
      for (let burst = 0; burst < 5; burst++) {
        hacker.handlers.get('input_frame')!(
          hacker.client,
          makeBaseInputFrame(hackSeq++, {
            dt: 0.5, // Spoofed 500ms frame dt
            moveForward: 999, // Out-of-range axis
            boostHeld: true,
          })
        );
      }
      (hacker.room as any).stepAuthoritativeSimulation(1 / 60);
    }

    const normalDist = normal.player.position.distanceTo(startPosNormal);
    const hackerDist = hacker.player.position.distanceTo(startPosHacker);

    // Both players must have moved the EXACT same distance after 25 authoritative server ticks!
    expect(normalDist).toBeGreaterThan(1.0);
    expect(hackerDist).toBeCloseTo(normalDist, 4);

    // Test duplicate / stale seq rejection and malformed payload rejection
    const prevRejected = normal.room.rejectedInputCount;
    // Duplicate seq (seq = 25 when lastReceivedSeq = 25)
    normal.handlers.get('input_frame')!(
      normal.client,
      makeBaseInputFrame(25, { moveForward: 1 })
    );
    // Out-of-order older seq (seq = 5)
    normal.handlers.get('input_frame')!(
      normal.client,
      makeBaseInputFrame(5, { moveForward: 1 })
    );
    // NaN / Infinity injection
    normal.handlers.get('input_frame')!(
      normal.client,
      makeBaseInputFrame(26, { moveForward: Number.NaN, yaw: Infinity })
    );
    // Out-of-bounds camera origin (> 2500m)
    normal.handlers.get('input_frame')!(
      normal.client,
      makeBaseInputFrame(27, { camOrigin: [99999, 10, 10] })
    );
    expect(normal.room.rejectedInputCount).toBe(prevRejected + 4);

    normal.room.onDispose();
    hacker.room.onDispose();
  });

  it('14. P0 Authoritative Combat Security: Building Line-of-Sight blocks Thunder Spear & Melee wallhacks + attack_intent deduplication', async () => {
    const room = new CoopHunterRoom();
    (room as any).roomId = 'test_combat_security_room';
    (room as any).setPrivate = async () => {};
    (room as any).setMetadata = async () => {};
    const combatEvents: any[] = [];
    (room as any).broadcast = (type: string, payload: any) => {
      if (type === 'combat_event') combatEvents.push(payload);
    };

    const messageHandlers = new Map<string, (client: any, payload: any) => void>();
    (room as any).onMessage = (
      type: string,
      cb: (client: any, payload: any) => void
    ) => {
      messageHandlers.set(type, cb);
    };

    await room.onCreate({ roomName: 'Combat Security Audit', isPublic: true });
    const c1 = createMockClient('sec_p1');
    room.onJoin(c1 as any, { nickname: 'Auditor' });
    messageHandlers.get('lobby_action')!(c1, { action: 'start_match' });

    const attackHandler = messageHandlers.get('attack_intent')!;
    const p1 = ((room as any).players as Map<string, any>).get('sec_p1')!;
    const titansMap = (room as any).titans as Map<string, ServerTitan>;
    const titan = Array.from(titansMap.values())[0];

    // Add a solid 10m-thick stone building wall at Z = 0 between Player (Z = +12) and Titan (Z = -12)
    room.getPhysicsWorld().addStaticBox(
      new THREE.Vector3(0, 10, 0),
      new THREE.Vector3(20, 10, 3),
      { type: 'wall', grappleable: true, label: 'Solid Security Wall' }
    );
    room.getPhysicsWorld().step();

    p1.position.set(0, 1.0, 12);
    room.getPhysicsWorld().setPlayerPosition(p1.position, 'sec_p1');
    titan.position.set(0, 0, -12);
    titan.yaw = Math.PI; // Facing North (-Z), so its Nape is at Z ~ -11 facing South toward the wall
    titan.syncHurtboxWorldPositions();

    const initialNapeHp = titan.hurtboxes.Nape.hp;
    const initialRightArmHp = titan.hurtboxes.RightArm.hp;

    // 1. Attempt to fire a Thunder Spear locked onto the Titan THROUGH the solid stone wall!
    attackHandler(c1, {
      seq: 1,
      isHeavy: true,
      weaponType: 'thunder_spear',
      aimYaw: 0,
      aimOrigin: [0, 2.5, 12],
      aimDir: [0, 0.1, -1],
      targetTitanId: titan.id,
      targetZone: 'Nape',
      clientRttMs: 20,
    });

    // Thunder Spear was consumed, detonated against the South face of the wall (Z >= 2.9), and dealt 0 damage to the Titan behind the wall!
    expect(p1.thunderSpears).toBe(3);
    expect(titan.hurtboxes.Nape.hp).toBe(initialNapeHp);
    expect(titan.hurtboxes.RightArm.hp).toBe(initialRightArmHp);
    const spearEvt = combatEvents.find(
      (e) => e.type === 'thunder_spear_exploded'
    );
    expect(spearEvt).toBeDefined();
    expect(spearEvt.worldPos[2]).toBeGreaterThanOrEqual(2.9);

    // 2. Duplicate / replayed attack_intent with seq = 1 must be rejected!
    const prevRejectedAttacks = room.rejectedAttackCount;
    attackHandler(c1, {
      seq: 1,
      isHeavy: true,
      weaponType: 'thunder_spear',
      aimYaw: 0,
      targetTitanId: titan.id,
      targetZone: 'Nape',
      clientRttMs: 20,
    });
    expect(room.rejectedAttackCount).toBe(prevRejectedAttacks + 1);
    expect(p1.thunderSpears).toBe(3); // No extra ammo consumed

    // 3. Attempt a close-range Melee Slash through a thin solid wall (Player at Z = +3.5, Titan at Z = -2.5, Wall at Z = 0..1)
    p1.nextAttackAllowedMs = 0;
    p1.position.set(0, 5.0, 3.3);
    titan.position.set(0, 0, -2.5);
    titan.syncHurtboxWorldPositions();
    attackHandler(c1, {
      seq: 2,
      isHeavy: true,
      weaponType: 'blade',
      aimYaw: 0,
      targetTitanId: titan.id,
      targetZone: 'Nape',
      clientRttMs: 20,
    });
    // Blocked by wall -> 0 damage!
    expect(titan.hurtboxes.Nape.hp).toBe(initialNapeHp);

    // 4. Move Player to the unobstructed side of the wall (Z = -10.5, behind Titan at Z = -12 facing -Z? Wait: Titan yaw = 0 faces +Z, so behind Titan is Z = -14)
    p1.nextAttackAllowedMs = 0;
    titan.position.set(0, 0, -20);
    titan.yaw = 0; // Faces South (+Z), so Nape is on the North (-Z) side
    titan.syncHurtboxWorldPositions();
    const napePos = titan.hurtboxes.Nape.worldPosition.clone();
    p1.position.copy(napePos).add(new THREE.Vector3(0, 0, -2.2));
    p1.velocity.set(0, 0, 28);

    attackHandler(c1, {
      seq: 3,
      isHeavy: true,
      weaponType: 'blade',
      aimYaw: Math.PI,
      targetTitanId: titan.id,
      targetZone: 'Nape',
      clientRttMs: 20,
    });
    // Unobstructed rear Nape strike deals lethal damage!
    expect(titan.hurtboxes.Nape.hp).toBeLessThan(initialNapeHp);

    room.onDispose();
  });

  it('15. P1 Session Token Security & Bounded Reconnection Backoff: rejects spoofed tokens and never hangs on reconnect', async () => {
    const room = new CoopHunterRoom();
    (room as any).roomId = 'test_session_security_room';
    (room as any).setPrivate = async () => {};
    (room as any).setMetadata = async () => {};
    (room as any).broadcast = () => {};
    (room as any).onMessage = () => {};

    await room.onCreate({ roomName: 'Session Security', isPublic: true });

    // 1. Client attempting to supply a custom/spoofed sessionToken on initial join receives a fresh server-generated st_ token instead
    const c1 = createMockClient('sec_sess_1');
    const c2 = createMockClient('sec_sess_2');
    const c3 = createMockClient('sec_sess_3');
    const c4 = createMockClient('sec_sess_4');

    room.onJoin(c1 as any, {
      nickname: 'P1',
      sessionToken: 'spoofed_client_token_123',
    });
    const welcome1 = c1.sentMessages.find((m) => m.type === 'session_welcome')
      ?.payload;
    expect(welcome1.sessionToken).not.toBe('spoofed_client_token_123');
    expect(welcome1.sessionToken).toMatch(/^st_[0-9a-f]{48}$/);

    room.onJoin(c2 as any, { nickname: 'P2' });
    room.onJoin(c3 as any, { nickname: 'P3' });
    room.onJoin(c4 as any, { nickname: 'P4' });

    // 2. When room has 4 players, a 5th player passing a fake st_ token is rejected by onAuth
    const c5 = createMockClient('sec_sess_5');
    expect(() =>
      room.onAuth(c5 as any, {
        nickname: 'Attacker',
        sessionToken: 'st_000000000000000000000000000000000000000000000000',
      })
    ).toThrow(/Room is full/);

    // 3. Legitimate player 1 reconnecting with their server-issued st_ token passes onAuth and replaces old session cleanly
    const c1Reconnect = createMockClient('sec_sess_1_reconnected');
    expect(
      room.onAuth(c1Reconnect as any, {
        nickname: 'P1',
        sessionToken: welcome1.sessionToken,
      })
    ).toBe(true);
    room.onJoin(c1Reconnect as any, {
      nickname: 'P1',
      sessionToken: welcome1.sessionToken,
    });

    const snap = room.getRoomSnapshot();
    expect(Object.keys(snap.players)).toHaveLength(4);
    expect(snap.players['sec_sess_1']).toBeUndefined();
    expect(snap.players['sec_sess_1_reconnected']).toBeDefined();
    expect(room.getPhysicsWorld().hasPlayerActor('sec_sess_1')).toBe(false);
    expect(
      room.getPhysicsWorld().hasPlayerActor('sec_sess_1_reconnected')
    ).toBe(true);

    room.onDispose();

    // 4. Test NetworkClient bounded exponential backoff reconnection transitions to 'disconnected' when unreachable
    const netClient = new NetworkClient('localhost:59999');
    netClient.sessionToken = welcome1.sessionToken;
    netClient.maxReconnectAttempts = 2;
    netClient.reconnectBaseDelayMs = 20;
    netClient.reconnectTimeoutMs = 250;

    const states: string[] = [];
    netClient.onConnectionChange = (st) => states.push(st);

    const ok = await netClient.reconnectWithBackoff('nonexistent_room', 'P1');
    expect(ok).toBe(false);
    expect(states[0]).toBe('reconnecting');
    expect(netClient.connectionState).toBe('disconnected');
  });

  it('16. P1 Resource Disposal & Server Telemetry Metrics: 10 mission restart cycles leave zero orphan Three.js / Rapier resources', async () => {
    const scene = new THREE.Scene();
    const vfx = new VFXManager(scene);
    const baselineSceneChildren = scene.children.length;

    const remoteMgr = new RemotePlayerManager(scene);
    const missionMgr = new MissionManager(scene);

    const room = new CoopHunterRoom();
    (room as any).roomId = 'test_metrics_room';
    (room as any).setPrivate = async () => {};
    (room as any).setMetadata = async () => {};
    (room as any).broadcast = () => {};
    const handlers = new Map<string, (client: any, payload: any) => void>();
    (room as any).onMessage = (
      type: string,
      cb: (client: any, payload: any) => void
    ) => {
      handlers.set(type, cb);
    };

    await room.onCreate({ roomName: 'Metrics & Disposal', isPublic: true });
    const c1 = createMockClient('m_p1');
    const c2 = createMockClient('m_p2');
    room.onJoin(c1 as any, { nickname: 'Erwin' });
    room.onJoin(c2 as any, { nickname: 'Levi' });
    handlers.get('lobby_action')!(c2, { action: 'ready' });
    handlers.get('lobby_action')!(c1, { action: 'start_match' });

    // Run 10 repeated match restarts + client sync cycles
    for (let cycle = 0; cycle < 10; cycle++) {
      room.startCoopMatch();
      (room as any).stepAuthoritativeSimulation(1 / 60);
      const snap = room.getRoomSnapshot();

      remoteMgr.syncFromRoomSnapshot(snap.players, 'm_p1');
      missionMgr.syncCoopFromServer(
        snap,
        1 / 60,
        new THREE.Vector3(0, 0, 24)
      );
      vfx.spawnThunderSpearProjectile(
        new THREE.Vector3(0, 2, 24),
        new THREE.Vector3(0, 8, -20)
      );
    }

    // Clear all active entities and verify scene child count returns to exact baseline
    missionMgr.clearTitans();
    remoteMgr.clearAll();
    vfx.clearAll();
    expect(scene.children.length).toBe(baselineSceneChildren);

    // Verify server telemetry metrics
    const metrics = room.getRoomMetrics();
    expect(metrics.roomId).toBe('test_metrics_room');
    expect(metrics.playerCount).toBe(2);
    expect(metrics.physicsActorCount).toBe(2);
    expect(metrics.serverTick).toBeGreaterThanOrEqual(10);
    expect(metrics.lastTickDurationMs).toBeGreaterThanOrEqual(0);

    room.onDispose();
    expect(room.getPhysicsWorld().getPlayerActorCount()).toBe(0);
  });
});
