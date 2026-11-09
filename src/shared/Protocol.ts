import { PlayerAnimName } from '../animation/HumanoidRigBuilder';
import { TitanAIState } from '../enemies/TitanEntity';
import {
  TitanAnimName,
  TitanVariant,
  TitanZoneType,
} from '../enemies/TitanRigBuilder';

export type PlayerLifeState = 'alive' | 'downed' | 'dead';
export type RoomPhase = 'lobby' | 'playing' | 'victory' | 'defeat';

export const SQUAD_COLORS = [
  0x1e4d38, // Vanguard Hunter Green
  0x1e3a8a, // Royal Cobalt Blue
  0x7c2d12, // Crimson Amber
  0x581c87, // Imperial Violet
] as const;

export const QUICK_CHAT_PRESETS: Record<string, string> = {
  target_nape: 'Target the Nape!',
  cripple_legs: 'Sever its Legs first!',
  need_help: 'Need Backup / Revive!',
  resupplying: 'Heading to Supply Depot!',
};

export interface NetHookState {
  active: boolean;
  anchor: [number, number, number];
  restLength: number;
  isTaut: boolean;
  attachedTitanId: string | null;
  attachedZone: TitanZoneType | null;
}

export interface NetPlayerState {
  id: string;
  nickname: string;
  colorHex: number;
  connected: boolean;
  ready: boolean;
  isLeader: boolean;
  lifeState: PlayerLifeState;
  position: [number, number, number];
  velocity: [number, number, number];
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
  leftHook: NetHookState;
  rightHook: NetHookState;
  downedTimer: number;
  reviveProgress: number;
  reviverId: string | null;
  kills: number;
  assists: number;
  score: number;
  damageDealt: number;
  lastAckedSeq: number;
}

export interface NetTitanHurtbox {
  hp: number;
  maxHp: number;
  disabledTimer: number;
  worldPos: [number, number, number];
  radius: number;
}

export interface NetTitanState {
  id: string;
  variant: TitanVariant;
  heightMeters: number;
  position: [number, number, number];
  velocity: [number, number, number];
  yaw: number;
  aiState: TitanAIState;
  anim: TitanAnimName;
  targetPlayerId: string | null;
  grabbedPlayerId: string | null;
  hurtboxes: Record<TitanZoneType, NetTitanHurtbox>;
}

export interface NetPingMarker {
  id: string;
  senderId: string;
  senderName: string;
  position: [number, number, number];
  targetTitanId: string | null;
  message: string;
  createdAt: number;
}

export interface NetProjectileState {
  id: string;
  ownerId: string;
  position: [number, number, number];
  velocity: [number, number, number];
  targetTitanId: string | null;
  targetZone: TitanZoneType | null;
}

export interface NetRoomState {
  roomId: string;
  roomCode: string;
  roomName: string;
  isPublic: boolean;
  maxPlayers: number;
  phase: RoomPhase;
  leaderId: string;
  serverTick: number;
  serverTimeMs: number;
  wave: number;
  maxWaves: number;
  totalKills: number;
  targetKills: number;
  teamScore: number;
  elapsedSeconds: number;
  rank: 'S' | 'A' | 'B' | 'C';
  players: Record<string, NetPlayerState>;
  titans: Record<string, NetTitanState>;
  pings: NetPingMarker[];
  projectiles?: NetProjectileState[];
}

export interface C2S_InputFrame {
  seq: number;
  clientTimeMs: number;
  dt: number;
  moveForward: number;
  moveRight: number;
  jumpPressed: boolean;
  boostHeld: boolean;
  dodgePressed: boolean;
  resupplyPressed: boolean;
  reviveHeld: boolean;
  yaw: number;
  pitch: number;
  camOrigin: [number, number, number];
  camForward: [number, number, number];
  camRight: [number, number, number];
  leftGrappleAction: 'none' | 'fire' | 'hold' | 'release';
  rightGrappleAction: 'none' | 'fire' | 'hold' | 'release';
  leftGrappleTarget?: [number, number, number] | null;
  rightGrappleTarget?: [number, number, number] | null;
  lockedTitanId: string | null;
  lockedZone: TitanZoneType;
  escapePressed?: boolean;
}

export interface C2S_AttackIntent {
  seq: number;
  isHeavy: boolean;
  weaponType?: 'blade' | 'thunder_spear';
  aimYaw: number;
  aimOrigin?: [number, number, number];
  aimDir?: [number, number, number];
  targetTitanId: string | null;
  targetZone: TitanZoneType;
  clientRttMs: number;
}

export interface C2S_LobbyAction {
  action: 'ready' | 'unready' | 'start_match' | 'restart_match' | 'set_nickname';
  nickname?: string;
}

export interface C2S_TeamPing {
  targetTitanId: string | null;
  worldPos: [number, number, number];
  quickChatKey?: string;
}

export interface C2S_PingRTT {
  clientSendMs: number;
}

export interface S2C_CombatEvent {
  type:
    | 'attack_confirmed'
    | 'damage_applied'
    | 'limb_broken'
    | 'titan_stunned'
    | 'titan_killed'
    | 'player_damaged'
    | 'player_downed'
    | 'player_revived'
    | 'perfect_dodge'
    | 'resupply'
    | 'thunder_spear_fired'
    | 'thunder_spear_exploded'
    | 'player_grabbed'
    | 'grab_escaped';
  projectileId?: string;
  attackerId?: string;
  attackerName?: string;
  targetTitanId?: string;
  targetPlayerId?: string;
  targetPlayerName?: string;
  zone?: TitanZoneType;
  damage?: number;
  speedMult?: number;
  glanced?: boolean;
  origin?: [number, number, number];
  direction?: [number, number, number];
  targetPos?: [number, number, number];
  worldPos: [number, number, number];
  message: string;
}

export interface S2C_PongRTT {
  clientSendMs: number;
  serverTimeMs: number;
}

export interface S2C_RoomError {
  code: string;
  message: string;
}

export interface PublicRoomSummary {
  roomId: string;
  roomCode: string;
  roomName: string;
  playerCount: number;
  maxPlayers: number;
  phase: RoomPhase;
}

export function sanitizeNickname(raw: unknown, fallback = 'Scout'): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/[^\w\s\-]/g, '').trim().slice(0, 16);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function isValidFiniteVec3(v: unknown): v is [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    typeof v[2] === 'number' &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    Number.isFinite(v[2])
  );
}

export function isValidBoundedVec3(
  v: unknown,
  maxAbsCoord = 2500
): v is [number, number, number] {
  return (
    isValidFiniteVec3(v) &&
    Math.abs(v[0]) <= maxAbsCoord &&
    Math.abs(v[1]) <= maxAbsCoord &&
    Math.abs(v[2]) <= maxAbsCoord
  );
}

export const VALID_TITAN_ZONES: ReadonlySet<TitanZoneType> = new Set<TitanZoneType>([
  'Nape',
  'Head',
  'LeftArm',
  'RightArm',
  'LeftLeg',
  'RightLeg',
]);

export const VALID_GRAPPLE_ACTIONS: ReadonlySet<
  C2S_InputFrame['leftGrappleAction']
> = new Set(['none', 'fire', 'hold', 'release']);

export function isValidTitanZone(z: unknown): z is TitanZoneType {
  return typeof z === 'string' && VALID_TITAN_ZONES.has(z as TitanZoneType);
}

/**
 * Validates and sanitizes an untrusted C2S_InputFrame from a client.
 * Rejects malformed payloads, NaN/Infinity fields, non-monotonic sequences, or out-of-bounds vectors.
 */
export function validateAndSanitizeInputFrame(
  raw: unknown,
  lastReceivedSeq: number
): C2S_InputFrame | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;

  if (
    typeof f.seq !== 'number' ||
    !Number.isInteger(f.seq) ||
    f.seq <= lastReceivedSeq ||
    f.seq > lastReceivedSeq + 100000
  ) {
    return null;
  }

  if (
    (f.dt !== undefined && (typeof f.dt !== 'number' || !Number.isFinite(f.dt))) ||
    (f.clientTimeMs !== undefined &&
      (typeof f.clientTimeMs !== 'number' || !Number.isFinite(f.clientTimeMs))) ||
    typeof f.moveForward !== 'number' ||
    !Number.isFinite(f.moveForward) ||
    typeof f.moveRight !== 'number' ||
    !Number.isFinite(f.moveRight) ||
    typeof f.yaw !== 'number' ||
    !Number.isFinite(f.yaw) ||
    typeof f.pitch !== 'number' ||
    !Number.isFinite(f.pitch)
  ) {
    return null;
  }

  if (
    !isValidBoundedVec3(f.camOrigin, 2500) ||
    !isValidBoundedVec3(f.camForward, 100) ||
    !isValidBoundedVec3(f.camRight, 100)
  ) {
    return null;
  }

  const fwdLen = Math.hypot(f.camForward[0], f.camForward[1], f.camForward[2]);
  if (fwdLen < 0.01) return null;

  if (
    typeof f.leftGrappleAction !== 'string' ||
    !VALID_GRAPPLE_ACTIONS.has(
      f.leftGrappleAction as C2S_InputFrame['leftGrappleAction']
    ) ||
    typeof f.rightGrappleAction !== 'string' ||
    !VALID_GRAPPLE_ACTIONS.has(
      f.rightGrappleAction as C2S_InputFrame['rightGrappleAction']
    )
  ) {
    return null;
  }

  if (
    f.leftGrappleTarget !== undefined &&
    f.leftGrappleTarget !== null &&
    !isValidBoundedVec3(f.leftGrappleTarget, 2500)
  ) {
    return null;
  }

  if (
    f.rightGrappleTarget !== undefined &&
    f.rightGrappleTarget !== null &&
    !isValidBoundedVec3(f.rightGrappleTarget, 2500)
  ) {
    return null;
  }

  if (
    f.lockedTitanId !== null &&
    f.lockedTitanId !== undefined &&
    (typeof f.lockedTitanId !== 'string' || f.lockedTitanId.length > 64)
  ) {
    return null;
  }

  const lockedZone: TitanZoneType = isValidTitanZone(f.lockedZone)
    ? f.lockedZone
    : 'Nape';

  const clampNum = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(max, v));

  return {
    seq: f.seq,
    clientTimeMs:
      typeof f.clientTimeMs === 'number' ? f.clientTimeMs : Date.now(),
    dt: typeof f.dt === 'number' ? clampNum(f.dt, 0.004, 0.05) : 1 / 60,
    moveForward: clampNum(f.moveForward, -1, 1),
    moveRight: clampNum(f.moveRight, -1, 1),
    jumpPressed: Boolean(f.jumpPressed),
    boostHeld: Boolean(f.boostHeld),
    dodgePressed: Boolean(f.dodgePressed),
    resupplyPressed: Boolean(f.resupplyPressed),
    reviveHeld: Boolean(f.reviveHeld),
    yaw: ((f.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI,
    pitch: clampNum(f.pitch, -Math.PI * 0.49, Math.PI * 0.49),
    camOrigin: [f.camOrigin[0], f.camOrigin[1], f.camOrigin[2]],
    camForward: [
      f.camForward[0] / fwdLen,
      f.camForward[1] / fwdLen,
      f.camForward[2] / fwdLen,
    ],
    camRight: [f.camRight[0], f.camRight[1], f.camRight[2]],
    leftGrappleAction:
      f.leftGrappleAction as C2S_InputFrame['leftGrappleAction'],
    rightGrappleAction:
      f.rightGrappleAction as C2S_InputFrame['rightGrappleAction'],
    leftGrappleTarget: isValidBoundedVec3(f.leftGrappleTarget, 2500)
      ? [
          f.leftGrappleTarget[0],
          f.leftGrappleTarget[1],
          f.leftGrappleTarget[2],
        ]
      : null,
    rightGrappleTarget: isValidBoundedVec3(f.rightGrappleTarget, 2500)
      ? [
          f.rightGrappleTarget[0],
          f.rightGrappleTarget[1],
          f.rightGrappleTarget[2],
        ]
      : null,
    lockedTitanId:
      typeof f.lockedTitanId === 'string' ? f.lockedTitanId : null,
    lockedZone,
    escapePressed: Boolean(f.escapePressed),
  };
}

/**
 * Validates and sanitizes an untrusted C2S_AttackIntent from a client.
 * Enforces strictly increasing attack sequence numbers and valid vectors/zones.
 */
export function validateAttackIntent(
  raw: unknown,
  lastAttackSeq: number
): C2S_AttackIntent | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;

  if (
    typeof a.seq !== 'number' ||
    !Number.isInteger(a.seq) ||
    a.seq <= lastAttackSeq ||
    a.seq > lastAttackSeq + 100000
  ) {
    return null;
  }

  if (typeof a.aimYaw !== 'number' || !Number.isFinite(a.aimYaw)) {
    return null;
  }

  if (
    a.weaponType !== undefined &&
    a.weaponType !== 'blade' &&
    a.weaponType !== 'thunder_spear'
  ) {
    return null;
  }

  if (
    a.targetTitanId !== null &&
    a.targetTitanId !== undefined &&
    (typeof a.targetTitanId !== 'string' || a.targetTitanId.length > 64)
  ) {
    return null;
  }

  if (a.targetZone !== undefined && !isValidTitanZone(a.targetZone)) {
    return null;
  }

  let aimOrigin: [number, number, number] | undefined;
  if (a.aimOrigin !== undefined) {
    if (!isValidBoundedVec3(a.aimOrigin, 2500)) return null;
    aimOrigin = [a.aimOrigin[0], a.aimOrigin[1], a.aimOrigin[2]];
  }

  let aimDir: [number, number, number] | undefined;
  if (a.aimDir !== undefined) {
    if (!isValidBoundedVec3(a.aimDir, 100)) return null;
    const len = Math.hypot(a.aimDir[0], a.aimDir[1], a.aimDir[2]);
    if (len < 0.01) return null;
    aimDir = [a.aimDir[0] / len, a.aimDir[1] / len, a.aimDir[2] / len];
  }

  const rtt =
    typeof a.clientRttMs === 'number' && Number.isFinite(a.clientRttMs)
      ? Math.max(0, Math.min(1000, a.clientRttMs))
      : 0;

  return {
    seq: a.seq,
    isHeavy: Boolean(a.isHeavy),
    weaponType: a.weaponType ?? 'blade',
    aimYaw: a.aimYaw,
    aimOrigin,
    aimDir,
    targetTitanId:
      typeof a.targetTitanId === 'string' ? a.targetTitanId : null,
    targetZone: isValidTitanZone(a.targetZone) ? a.targetZone : 'Nape',
    clientRttMs: rtt,
  };
}

export interface AimValidationInput {
  playerPos: [number, number, number];
  aimOrigin: [number, number, number];
  aimDir: [number, number, number];
  lastCamForward?: [number, number, number] | null;
  targetPos: [number, number, number];
  targetRadius: number;
  maxRange: number;
  maxHalfConeDeg?: number;
}

export interface AimValidationResult {
  valid: boolean;
  reason:
    | 'OK'
    | 'OUT_OF_RANGE'
    | 'INVALID_AIM_ORIGIN'
    | 'AIM_DIR_MISMATCH'
    | 'BEHIND_PLAYER'
    | 'OUTSIDE_AIM_CONE';
  dotAim: number;
  dotPlayerForward: number;
}

/**
 * Validates that a targeted Titan hurtbox lies within a legitimate forward aim cone / FOV
 * relative to the player's position, validated camera origin, and authoritative look direction.
 * Rejects targets behind the player's back, outside the FOV cone, or with spoofed aim origins/directions.
 */
export function validateTargetLockAim(
  input: AimValidationInput
): AimValidationResult {
  const {
    playerPos,
    aimOrigin,
    aimDir,
    lastCamForward,
    targetPos,
    targetRadius,
    maxRange,
    maxHalfConeDeg = 50,
  } = input;

  // 1. Validate aimOrigin proximity to player position (third-person camera is within ~6.5m)
  const originDist = Math.hypot(
    aimOrigin[0] - playerPos[0],
    aimOrigin[1] - playerPos[1],
    aimOrigin[2] - playerPos[2]
  );
  if (!Number.isFinite(originDist) || originDist > 10.0) {
    return {
      valid: false,
      reason: 'INVALID_AIM_ORIGIN',
      dotAim: -1,
      dotPlayerForward: -1,
    };
  }

  // 2. Normalize aimDir and verify against authoritative camera forward if present
  const aimLen = Math.hypot(aimDir[0], aimDir[1], aimDir[2]);
  if (!Number.isFinite(aimLen) || aimLen < 0.01) {
    return {
      valid: false,
      reason: 'AIM_DIR_MISMATCH',
      dotAim: -1,
      dotPlayerForward: -1,
    };
  }
  const ax = aimDir[0] / aimLen;
  const ay = aimDir[1] / aimLen;
  const az = aimDir[2] / aimLen;

  if (lastCamForward && isValidFiniteVec3(lastCamForward)) {
    const lfLen = Math.hypot(
      lastCamForward[0],
      lastCamForward[1],
      lastCamForward[2]
    );
    if (lfLen > 0.01) {
      const lfx = lastCamForward[0] / lfLen;
      const lfy = lastCamForward[1] / lfLen;
      const lfz = lastCamForward[2] / lfLen;
      const dotCamConsistency = ax * lfx + ay * lfy + az * lfz;
      // Allow up to ~81 deg rapid flick between input_frame and attack_intent; reject backwards spoofing
      if (dotCamConsistency < 0.15) {
        return {
          valid: false,
          reason: 'AIM_DIR_MISMATCH',
          dotAim: dotCamConsistency,
          dotPlayerForward: dotCamConsistency,
        };
      }
    }
  }

  // 3. Validate distance from player to target hurtbox
  const chestX = playerPos[0];
  const chestY = playerPos[1] + 1.4;
  const chestZ = playerPos[2];
  const dxPlayer = targetPos[0] - chestX;
  const dyPlayer = targetPos[1] - chestY;
  const dzPlayer = targetPos[2] - chestZ;
  const distPlayer = Math.hypot(dxPlayer, dyPlayer, dzPlayer);

  if (!Number.isFinite(distPlayer) || distPlayer > maxRange + targetRadius) {
    return {
      valid: false,
      reason: 'OUT_OF_RANGE',
      dotAim: 0,
      dotPlayerForward: 0,
    };
  }

  // 4. Reject targets behind the player's back (rear hemisphere relative to player chest along aimDir)
  let dotPlayerForward = 1.0;
  if (distPlayer > 0.01) {
    dotPlayerForward =
      (dxPlayer * ax + dyPlayer * ay + dzPlayer * az) / distPlayer;
  }
  if (distPlayer > targetRadius + 1.2 && dotPlayerForward < 0) {
    return {
      valid: false,
      reason: 'BEHIND_PLAYER',
      dotAim: dotPlayerForward,
      dotPlayerForward,
    };
  }

  // 5. Validate target lies within forward aim cone / FOV from aimOrigin
  const dxCam = targetPos[0] - aimOrigin[0];
  const dyCam = targetPos[1] - aimOrigin[1];
  const dzCam = targetPos[2] - aimOrigin[2];
  const distCam = Math.hypot(dxCam, dyCam, dzCam);
  let dotAim = 1.0;
  if (distCam > 0.01) {
    dotAim = (dxCam * ax + dyCam * ay + dzCam * az) / distCam;
  }

  const angularAllowanceRad = Math.atan2(
    Math.max(0.5, targetRadius + 1.2),
    Math.max(1.5, distCam)
  );
  const halfConeRad = Math.min(
    (72 * Math.PI) / 180,
    (maxHalfConeDeg * Math.PI) / 180 + angularAllowanceRad
  );
  const minConeDot = Math.cos(halfConeRad);

  if (dotAim < minConeDot) {
    return {
      valid: false,
      reason: 'OUTSIDE_AIM_CONE',
      dotAim,
      dotPlayerForward,
    };
  }

  return {
    valid: true,
    reason: 'OK',
    dotAim,
    dotPlayerForward,
  };
}
