import { Client, Room } from 'colyseus.js';
import * as THREE from 'three';
import {
  C2S_AttackIntent,
  C2S_InputFrame,
  C2S_LobbyAction,
  C2S_TeamPing,
  NetRoomState,
  PublicRoomSummary,
  S2C_CombatEvent,
  S2C_PongRTT,
  S2C_RoomError,
} from '../shared/Protocol';

export interface PredictionRecord {
  seq: number;
  frame: C2S_InputFrame;
  predictedPos: THREE.Vector3;
  predictedVel: THREE.Vector3;
}

export interface NetworkConditions {
  latencyMs: number;      // e.g. 0, 50, 100, 200
  jitterMs: number;       // e.g. 0, 15
  packetLossPct: number;  // 0 to 0.5 (50%)
}

export class NetworkClient {
  public serverHttpUrl: string;
  public serverWsUrl: string;
  private client: Client;
  public room: Room | null = null;

  public myPlayerId = '';
  public sessionToken = '';
  public roomCode = '';
  public connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' =
    'disconnected';
  public rttMs = 12;
  public latestState: NetRoomState | null = null;
  public lastReconciliationTimeMs = 0;

  // Simulated network conditions for testing lag 50/100/200ms, jitter & packet loss
  public netConditions: NetworkConditions = {
    latencyMs: 0,
    jitterMs: 0,
    packetLossPct: 0,
  };

  // Client-side prediction history ring buffer
  private predictionHistory: PredictionRecord[] = [];
  private nextSeq = 1;
  private lastReceivedServerTick = -1;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  // Event callbacks
  public onStateSnapshot?: (state: NetRoomState) => void;
  public onCombatEvent?: (evt: S2C_CombatEvent) => void;
  public onRoomError?: (err: S2C_RoomError) => void;
  public onConnectionChange?: (
    state: NetworkClient['connectionState'],
    reason?: string
  ) => void;

  constructor(customHost?: string) {
    const host =
      customHost ||
      (typeof window !== 'undefined' && window.location.hostname
        ? `${window.location.hostname}:2567`
        : 'localhost:2567');
    this.serverHttpUrl = `http://${host}`;
    this.serverWsUrl = `ws://${host}`;
    this.client = new Client(this.serverWsUrl);
  }

  public setServerHost(hostWithPort: string): void {
    const clean = hostWithPort.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
    this.serverHttpUrl = `http://${clean}`;
    this.serverWsUrl = `ws://${clean}`;
    this.client = new Client(this.serverWsUrl);
  }

  public nextInputSequence(): number {
    return this.nextSeq++;
  }

  public recordPrediction(
    seq: number,
    frame: C2S_InputFrame,
    pos: THREE.Vector3,
    vel: THREE.Vector3
  ): void {
    this.predictionHistory.push({
      seq,
      frame,
      predictedPos: pos.clone(),
      predictedVel: vel.clone(),
    });
    if (this.predictionHistory.length > 120) {
      this.predictionHistory.shift();
    }
  }

  /**
   * Computes server reconciliation against local prediction history at `lastAckedSeq`.
   * Returns any position/velocity correction delta and unacknowledged frames to replay.
   */
  public reconcilePrediction(
    lastAckedSeq: number,
    serverPos: [number, number, number],
    serverVel: [number, number, number]
  ): {
    needsCorrection: boolean;
    authPosition: THREE.Vector3;
    authVelocity: THREE.Vector3;
    unackedFrames: C2S_InputFrame[];
  } {
    // Discard acknowledged entries older than lastAckedSeq
    let ackedEntry: PredictionRecord | undefined;
    while (
      this.predictionHistory.length > 0 &&
      this.predictionHistory[0].seq <= lastAckedSeq
    ) {
      const item = this.predictionHistory.shift()!;
      if (item.seq === lastAckedSeq) {
        ackedEntry = item;
      }
    }

    const authPos = new THREE.Vector3(...serverPos);
    const authVel = new THREE.Vector3(...serverVel);

    if (!ackedEntry) {
      return {
        needsCorrection: false,
        authPosition: authPos,
        authVelocity: authVel,
        unackedFrames: [],
      };
    }

    const posError = ackedEntry.predictedPos.distanceTo(authPos);
    if (posError > 0.45) {
      return {
        needsCorrection: true,
        authPosition: authPos,
        authVelocity: authVel,
        unackedFrames: this.predictionHistory.map((p) => p.frame),
      };
    }

    return {
      needsCorrection: false,
      authPosition: authPos,
      authVelocity: authVel,
      unackedFrames: [],
    };
  }

  public async fetchPublicRooms(): Promise<PublicRoomSummary[]> {
    try {
      const res = await fetch(`${this.serverHttpUrl}/api/rooms`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.rooms) ? data.rooms : [];
    } catch {
      return [];
    }
  }

  public async createRoom(options: {
    nickname: string;
    roomName: string;
    isPublic: boolean;
  }): Promise<void> {
    this.setConnectionState('connecting');
    try {
      const room = await this.client.create('coop_hunter', {
        nickname: options.nickname,
        roomName: options.roomName,
        isPublic: options.isPublic,
        sessionToken: this.sessionToken || undefined,
      });
      await this.bindRoom(room);
    } catch (err: any) {
      this.setConnectionState('disconnected', err?.message || 'Failed to create room');
      throw err;
    }
  }

  public async joinRoomByCode(
    roomCode: string,
    nickname: string
  ): Promise<void> {
    const cleanCode = roomCode.trim().toUpperCase();
    if (!cleanCode) {
      throw new Error('Please enter a valid 6-character Room Code.');
    }
    this.setConnectionState('connecting');
    try {
      const res = await fetch(`${this.serverHttpUrl}/api/resolve/${cleanCode}`);
      const body = await res.json();
      if (!res.ok || body?.error) {
        throw new Error(body?.message || `Unable to join room "${cleanCode}".`);
      }
      const room = await this.client.joinById(body.roomId, {
        nickname,
        sessionToken: this.sessionToken || undefined,
      });
      await this.bindRoom(room);
    } catch (err: any) {
      this.setConnectionState('disconnected', err?.message || 'Failed to join room');
      throw err;
    }
  }

  public async joinRoomById(roomId: string, nickname: string): Promise<void> {
    this.setConnectionState('connecting');
    try {
      const room = await this.client.joinById(roomId, {
        nickname,
        sessionToken: this.sessionToken || undefined,
      });
      await this.bindRoom(room);
    } catch (err: any) {
      this.setConnectionState('disconnected', err?.message || 'Failed to join room');
      throw err;
    }
  }

  public async reconnectToRoom(
    roomId: string,
    nickname: string
  ): Promise<boolean> {
    if (!this.sessionToken) return false;
    this.setConnectionState('reconnecting');
    try {
      const room = await this.client.joinById(roomId, {
        nickname,
        sessionToken: this.sessionToken,
      });
      await this.bindRoom(room);
      return true;
    } catch {
      this.setConnectionState('disconnected', 'Reconnection expired');
      return false;
    }
  }

  private bindRoom(room: Room): Promise<void> {
    this.room = room;
    this.myPlayerId = room.sessionId;
    this.lastReceivedServerTick = -1;
    this.predictionHistory = [];
    this.setConnectionState('connected');

    return new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      const welcomeTimeout = setTimeout(done, 400);

      room.onMessage(
        'session_welcome',
        (data: { playerId: string; sessionToken: string; roomCode: string }) => {
          this.myPlayerId = data.playerId;
          this.sessionToken = data.sessionToken;
          this.roomCode = data.roomCode;
        }
      );

      room.onMessage('room_snapshot', (snap: NetRoomState) => {
        this.deliverWithSimulatedConditions(() => {
          // Ignore out-of-order older snapshots!
          if (snap.serverTick < this.lastReceivedServerTick) {
            return;
          }
          this.lastReceivedServerTick = snap.serverTick;
          this.roomCode = snap.roomCode;
          this.latestState = snap;
          this.onStateSnapshot?.(snap);
          clearTimeout(welcomeTimeout);
          done();
        });
      });

    room.onMessage('combat_event', (evt: S2C_CombatEvent) => {
      this.deliverWithSimulatedConditions(() => {
        this.onCombatEvent?.(evt);
      });
    });

    room.onMessage('pong_rtt', (msg: S2C_PongRTT) => {
      const sample = Math.max(1, Date.now() - msg.clientSendMs);
      this.rttMs = Math.round(
        this.rttMs * 0.7 + (sample + this.netConditions.latencyMs) * 0.3
      );
    });

    room.onMessage('room_error', (err: S2C_RoomError) => {
      this.onRoomError?.(err);
    });

    room.onLeave((code) => {
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      // Code 1000 is normal consented leave; unexpected drop triggers reconnecting notice
      if (code !== 1000 && this.connectionState === 'connected') {
        this.setConnectionState('reconnecting', `Connection interrupted (${code})`);
      } else {
        this.setConnectionState('disconnected');
      }
    });

      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this.room && this.connectionState === 'connected') {
          this.room.send('ping_rtt', { clientSendMs: Date.now() });
        }
      }, 1200);

      room.send('request_welcome', {});
    });
  }

  private deliverWithSimulatedConditions(fn: () => void): void {
    const { latencyMs, jitterMs, packetLossPct } = this.netConditions;
    if (packetLossPct > 0 && Math.random() < packetLossPct) {
      return; // Simulated packet drop
    }
    const delay =
      latencyMs > 0 || jitterMs > 0
        ? Math.max(
            0,
            latencyMs * 0.5 + (Math.random() * 2 - 1) * jitterMs
          )
        : 0;
    if (delay > 1) {
      setTimeout(fn, delay);
    } else {
      fn();
    }
  }

  public sendLobbyAction(payload: C2S_LobbyAction): void {
    if (!this.room) return;
    this.room.send('lobby_action', payload);
  }

  public sendInputFrame(frame: C2S_InputFrame): void {
    if (!this.room || this.connectionState !== 'connected') return;
    this.deliverWithSimulatedConditions(() => {
      this.room?.send('input_frame', frame);
    });
  }

  public sendAttackIntent(intent: C2S_AttackIntent): void {
    if (!this.room || this.connectionState !== 'connected') return;
    this.deliverWithSimulatedConditions(() => {
      this.room?.send('attack_intent', intent);
    });
  }

  public sendTeamPing(ping: C2S_TeamPing): void {
    if (!this.room || this.connectionState !== 'connected') return;
    this.room.send('team_ping', ping);
  }

  public async leaveRoom(consented = true): Promise<void> {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.room) {
      try {
        await this.room.leave(consented);
      } catch {
        // Ignore already closed socket
      }
      this.room = null;
    }
    this.latestState = null;
    this.predictionHistory = [];
    this.setConnectionState('disconnected');
  }

  private setConnectionState(
    next: NetworkClient['connectionState'],
    reason?: string
  ): void {
    this.connectionState = next;
    this.onConnectionChange?.(next, reason);
  }
}
