import { NetworkClient } from '../../src/network/NetworkClient';
import type {
  C2S_AttackIntent,
  C2S_InputFrame,
  C2S_LobbyAction,
  C2S_TeamPing,
} from '../../src/shared/Protocol';

type Emit = (type: string, json: string) => void;
type Join = (client: NetworkClient) => Promise<void>;

function serverEndpoint(host: string): string {
  const supplied = host.trim();
  if (!supplied) {
    const current = new URL(window.location.origin);
    if (['localhost', '127.0.0.1', '[::1]'].includes(current.hostname)) {
      current.port = '2567';
    }
    return current.origin;
  }

  const input = /^(https?|wss?):\/\//i.test(supplied)
    ? supplied
    : `${window.location.protocol}//${supplied}`;
  const endpoint = new URL(input);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Enter a server host or HTTP/WebSocket URL.');
  }
  if (window.location.protocol === 'https:' &&
      ['http:', 'ws:'].includes(endpoint.protocol)) {
    throw new Error('An HTTPS page needs an HTTPS or WSS multiplayer server.');
  }
  return endpoint.href;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Godot owns a bridge instance. Keep the room, transport serializer, RTT,
// session credentials and reconnection policy in the existing browser client.
export function create(emit: Emit) {
  let client: NetworkClient | null = null;
  let discovery = 0;

  const publish = (type: string, payload: unknown) => emit(type, JSON.stringify(payload));
  const report = (code: string, error: unknown) =>
    publish('room_error', { code, message: errorMessage(error) });

  function clearClient() {
    const previous = client;
    client = null;
    if (previous) void previous.leaveRoom();
  }

  async function join(host: string, operation: Join) {
    let next: NetworkClient;
    try {
      next = new NetworkClient(serverEndpoint(host));
    } catch (error) {
      report('INVALID_HOST', error);
      return;
    }
    clearClient();
    client = next;

    next.onConnectionChange = (state, reason) => {
      if (client === next) {
        publish('connection', {
          state,
          reason: reason ?? '',
          playerId: next.myPlayerId,
        });
      }
    };
    next.onStateSnapshot = (snapshot) => {
      if (client === next) {
        publish('snapshot', {
          snapshot,
          playerId: next.myPlayerId,
          roomCode: next.roomCode,
          rttMs: next.rttMs,
          jitterMs: next.jitterMsEstimate,
        });
      }
    };
    next.onCombatEvent = (event) => {
      if (client === next) publish('combat_event', event);
    };
    next.onRoomError = (error) => {
      if (client === next) publish('room_error', error);
    };

    try {
      await operation(next);
    } catch (error) {
      if (client === next) report('MATCHMAKING_FAILED', error);
    } finally {
      // A join already in flight can resolve after the user leaves or
      // changes rooms. Close the stale seat as soon as it arrives.
      if (client !== next) await next.leaveRoom();
    }
  }

  return {
    async listRooms(host: string) {
      const request = ++discovery;
      try {
        const endpoint = new NetworkClient(serverEndpoint(host)).serverHttpUrl;
        const response = await fetch(`${endpoint}/api/rooms`);
        if (!response.ok) throw new Error(`Room list returned HTTP ${response.status}.`);
        const data = await response.json();
        if (!Array.isArray(data.rooms)) throw new Error('The server returned an invalid room list.');
        if (request === discovery) publish('rooms', { rooms: data.rooms });
      } catch (error) {
        if (request === discovery) {
          publish('rooms', { rooms: [] });
          report('ROOM_LIST_FAILED', error);
        }
      }
    },
    createRoom(nickname: string, roomName: string, isPublic: boolean, host: string) {
      return join(host, (next) => next.createRoom({ nickname, roomName, isPublic }));
    },
    joinRoomByCode(code: string, nickname: string, host: string) {
      if (!/^[A-Z0-9]{6}$/i.test(code.trim())) {
        report('INVALID_ROOM_CODE', new Error(`Enter a six-character room code (${code.trim()}).`));
        return;
      }
      return join(host, (next) => next.joinRoomByCode(code, nickname));
    },
    joinRoomById(id: string, nickname: string, host: string) {
      return join(host, (next) => next.joinRoomById(id, nickname));
    },
    leaveRoom() {
      discovery++;
      clearClient();
      publish('connection', { state: 'disconnected', reason: 'Left room', playerId: '' });
    },
    dispose() {
      discovery++;
      clearClient();
    },
    sendLobbyAction(action: C2S_LobbyAction['action'], nickname: string) {
      if (client?.connectionState === 'connected') {
        client.sendLobbyAction({ action, nickname });
      }
    },
    sendInputFrame(json: string) {
      if (!client || client.connectionState !== 'connected') return 0;
      const frame = JSON.parse(json) as Omit<C2S_InputFrame, 'seq' | 'clientTimeMs'>;
      const seq = client.nextInputSequence();
      // Protocol.ts normalizes wire yaw with a PI phase offset. Send the
      // inverse transform so the server's movement axes match camera vectors.
      client.sendInputFrame({ ...frame, yaw: frame.yaw + Math.PI, seq, clientTimeMs: Date.now() });
      return seq;
    },
    sendAttackIntent(json: string) {
      if (!client || client.connectionState !== 'connected') return 0;
      const intent = JSON.parse(json) as Omit<C2S_AttackIntent, 'seq' | 'clientRttMs'>;
      const seq = client.nextInputSequence();
      client.sendAttackIntent({ ...intent, seq, clientRttMs: client.rttMs });
      return seq;
    },
    sendTeamPing(json: string) {
      if (client?.connectionState === 'connected') {
        client.sendTeamPing(JSON.parse(json) as C2S_TeamPing);
      }
    },
  };
}
