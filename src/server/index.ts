import { matchMaker, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import http from 'node:http';
import { PublicRoomSummary } from '../shared/Protocol';
import { activeRoomsByCode, CoopHunterRoom } from './CoopHunterRoom';

// Ensure backwards-compatible seat reservation shape (`seat.room`) for colyseus.js clients
const origInvokeMethod = matchMaker.controller.invokeMethod.bind(
  matchMaker.controller
);
matchMaker.controller.invokeMethod = async function (
  method: string,
  roomName: string,
  clientOptions: any = {},
  authOptions?: any
) {
  const seat: any = await origInvokeMethod(
    method,
    roomName,
    clientOptions,
    authOptions
  );
  if (seat && !seat.room && seat.roomId) {
    seat.room = {
      name: seat.name,
      roomId: seat.roomId,
      processId: seat.processId,
      publicAddress: seat.publicAddress,
    };
  }
  return seat;
};

export interface RunningMultiplayerServer {
  port: number;
  httpServer: http.Server;
  gameServer: Server;
  shutdown: () => Promise<void>;
}

function handleCustomApiRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse
): boolean {
  const url = new URL(
    req.url || '/',
    `http://${req.headers.host || 'localhost'}`
  );

  const isCustomRoute =
    url.pathname === '/healthz' ||
    url.pathname === '/api/rooms' ||
    url.pathname.startsWith('/api/resolve/');

  if (!isCustomRoute) {
    return false;
  }

  // Enable CORS for custom API routes
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return true;
  }

  if (url.pathname === '/api/rooms' && req.method === 'GET') {
    const publicRooms: PublicRoomSummary[] = [];
    for (const entry of activeRoomsByCode.values()) {
      if (entry.isPublic) {
        const snap = entry.roomRef.getRoomSnapshot();
        publicRooms.push({
          roomId: entry.roomId,
          roomCode: entry.roomCode,
          roomName: entry.roomName,
          playerCount: Object.keys(snap.players).length,
          maxPlayers: snap.maxPlayers,
          phase: snap.phase,
        });
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rooms: publicRooms }));
    return true;
  }

  if (url.pathname.startsWith('/api/resolve/') && req.method === 'GET') {
    const code = url.pathname
      .replace('/api/resolve/', '')
      .trim()
      .toUpperCase();
    const found = activeRoomsByCode.get(code);
    if (!found) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: false,
          error: 'INVALID_ROOM_CODE',
          message: `No active squad room found with code "${code}".`,
        })
      );
      return true;
    }
    const snap = found.roomRef.getRoomSnapshot();
    if (Object.keys(snap.players).length >= snap.maxPlayers) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: false,
          error: 'ROOM_FULL',
          message: `Room "${code}" is full (4/4 players).`,
        })
      );
      return true;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        roomId: found.roomId,
        roomCode: found.roomCode,
        roomName: found.roomName,
        playerCount: Object.keys(snap.players).length,
        maxPlayers: snap.maxPlayers,
      })
    );
    return true;
  }

  return false;
}

export async function startMultiplayerServer(
  port = Number(process.env.PORT) || 2567
): Promise<RunningMultiplayerServer> {
  const httpServer = http.createServer();

  // Intercept custom API routes before Colyseus's internal matchmaking router
  const origEmit = httpServer.emit.bind(httpServer);
  httpServer.emit = function (event: string, ...args: any[]): boolean {
    if (event === 'request') {
      const [req, res] = args as [http.IncomingMessage, http.ServerResponse];
      if (handleCustomApiRoutes(req, res)) {
        return true;
      }
    }
    return origEmit(event, ...args);
  } as any;

  const transport = new WebSocketTransport({
    server: httpServer,
    pingInterval: 3000,
    pingMaxRetries: 3,
  });

  const gameServer = new Server({
    transport,
  });

  gameServer.define('coop_hunter', CoopHunterRoom);

  await gameServer.listen(port, '0.0.0.0');

  return {
    port,
    httpServer,
    gameServer,
    shutdown: async () => {
      await gameServer.gracefullyShutdown(false);
    },
  };
}

// Auto-start when invoked directly via `npx tsx src/server/index.ts`
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('src/server/index.ts') ||
    process.argv[1].endsWith('src\\server\\index.ts'));

if (isDirectRun) {
  const port = Number(process.env.PORT) || 2567;
  startMultiplayerServer(port)
    .then(() => {
      console.log(
        `[Titan Hunter 3D] Authoritative Co-op Server listening on ws://0.0.0.0:${port}`
      );
    })
    .catch((err) => {
      console.error('Failed to start multiplayer server:', err);
      process.exit(1);
    });
}
