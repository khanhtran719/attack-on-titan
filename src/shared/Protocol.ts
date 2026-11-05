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
}

export interface C2S_AttackIntent {
  seq: number;
  isHeavy: boolean;
  aimYaw: number;
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
    | 'resupply';
  attackerId?: string;
  attackerName?: string;
  targetTitanId?: string;
  targetPlayerId?: string;
  targetPlayerName?: string;
  zone?: TitanZoneType;
  damage?: number;
  speedMult?: number;
  glanced?: boolean;
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
