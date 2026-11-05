import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../src/config/GameConfig';
import { NetworkClient } from '../src/network/NetworkClient';
import { RemotePlayerManager } from '../src/network/RemotePlayerManager';
import { VFXManager } from '../src/rendering/VFXManager';
import { activeRoomsByCode, CoopHunterRoom } from '../src/server/CoopHunterRoom';
import {
  C2S_InputFrame,
  isValidFiniteVec3,
  NetPlayerState,
  QUICK_CHAT_PRESETS,
  sanitizeNickname,
} from '../src/shared/Protocol';
import { ServerTitan } from '../src/shared/ServerTitanSim';

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

    // Out-of-range hook (e.g. 500m away) is rejected by server
    p1Internal.leftHook.active = false;
    const farTitan = (room as any).titans.get(firstTitanId) as ServerTitan;
    farTitan.position.set(0, 0, -400);
    farTitan.syncHurtboxWorldPositions();
    inputHandler(
      c1,
      makeBaseInputFrame(2, {
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
});
