import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { startMultiplayerServer } from '../../src/server/index';
import { activeRoomsByCode } from '../../src/server/CoopHunterRoom';
import type { NetRoomState, S2C_CombatEvent, S2C_RoomError } from '../../src/shared/Protocol';

async function eventually<T>(operation: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 12_000;
  do {
    const result = await operation();
    if (result !== undefined) return result;
    await delay(25);
  } while (Date.now() < deadline);
  throw new Error('Condition timed out');
}

async function setup(page: Page, url: string, useGodot: boolean): Promise<void> {
  await page.goto(url);
  if (useGodot) {
    await page.waitForFunction(() => (window as any).titanTest.available === true);
    return;
  }
  await page.evaluate(() => {
    const scope = window as any;
    scope.events = [];
    scope.coop = scope.TitanCoop.create((type: string, json: string) => {
      scope.events.push({ type, payload: JSON.parse(json) });
    });
  });
}

async function call<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(({ method, args }) => (window as any).coop[method](...args), {
    method,
    args,
  });
}

async function events<T>(page: Page, type: string): Promise<T[]> {
  return page.evaluate((type) => (window as any).events
    .filter((event: any) => event.type === type)
    .map((event: any) => event.payload), type);
}

interface SnapshotEvent {
  snapshot: NetRoomState;
  playerId: string;
  roomCode: string;
  rttMs: number;
}

async function snapshot(
  page: Page,
  predicate: (event: SnapshotEvent) => boolean,
): Promise<SnapshotEvent> {
  return eventually(async () => (await events<SnapshotEvent>(page, 'snapshot'))
    .findLast(predicate));
}

const browserFixture = `<script>
  window.events = [];
  let request = 0;
  const pending = new Map();
  window.titanTest = {
    emitEvent(type, json) { events.push({ type, payload: JSON.parse(json) }); },
    complete(id, result) { pending.get(id)?.(result); pending.delete(id); }
  };
  window.coop = new Proxy({}, {
    get(_target, method) {
      return (...args) => new Promise(resolve => {
        const id = ++request;
        pending.set(id, resolve);
        titanTest.command(id, method, JSON.stringify(args));
      });
    }
  });
</script>`;

function exportGodotFixture(godot: string, template: string, temp: string): void {
  const project = join(temp, 'project');
  mkdirSync(join(project, 'multiplayer'), { recursive: true });
  copyFileSync('godot-client/multiplayer/coop_client.gd', join(project, 'multiplayer/coop_client.gd'));
  copyFileSync('godot-client/tests/network-web-fixture.gd', join(project, 'fixture.gd'));
  writeFileSync(join(project, 'project.godot'), `config_version=5
[application]
config/name="Titan Co-op Integration Test"
run/main_scene="res://fixture.tscn"
[rendering]
renderer/rendering_method="gl_compatibility"
`);
  writeFileSync(join(project, 'fixture.tscn'), `[gd_scene load_steps=2 format=3]
[ext_resource type="Script" path="res://fixture.gd" id="1"]
[node name="Fixture" type="Node"]
script = ExtResource("1")
`);
  writeFileSync(join(project, 'export_presets.cfg'), `[preset.0]
name="Web"
platform="Web"
runnable=true
export_filter="all_resources"
include_filter=""
exclude_filter=""
[preset.0.options]
custom_template/debug="${resolve(template)}"
variant/thread_support=false
html/head_include="<script src='coop-bridge.js'></script>"
`);
  const common = ['--headless', '--path', project, '--log-file', join(temp, 'godot.log')];
  execFileSync(godot, [...common, '--import']);
  execFileSync(godot, [...common, '--export-debug', 'Web', join(temp, 'index.html')]);
}

test('two Chrome clients exercise the browser bridge against the existing Colyseus server', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'titan-coop-test-'));
  const bundle = join(temp, 'coop-bridge.js');
  const godot = process.env.TITAN_TEST_GODOT_BIN;
  const template = process.env.TITAN_TEST_WEB_TEMPLATE;
  const useGodot = Boolean(godot && template);
  let backend: Awaited<ReturnType<typeof startMultiplayerServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const mime: Record<string, string> = {
    '.js': 'text/javascript',
    '.html': 'text/html',
    '.wasm': 'application/wasm',
    '.pck': 'application/octet-stream',
    '.png': 'image/png',
  };
  const site = createServer((req, res) => {
    const name = basename(req.url || '') || 'index.html';
    try {
      const extension = extname(name);
      let file: Buffer | string;
      if (name === 'index.html') {
        file = useGodot
          ? readFileSync(join(temp, name), 'utf8').replace('</head>', browserFixture + '</head>')
          : '<!doctype html><script src="/coop-bridge.js"></script>';
      } else {
        file = readFileSync(join(temp, name));
      }
      res.writeHead(200, { 'Content-Type': mime[extension] || 'application/octet-stream' });
      res.end(file);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    execFileSync(process.execPath, ['godot-client/multiplayer/build-bridge.mjs', bundle]);
    if (godot && template) exportGodotFixture(godot, template, temp);
    backend = await startMultiplayerServer(0);
    const backendAddress = backend.httpServer.address();
    assert(backendAddress && typeof backendAddress !== 'string');
    const host = `http://127.0.0.1:${backendAddress.port}`;
    await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
    const siteAddress = site.address();
    assert(siteAddress && typeof siteAddress !== 'string');
    const url = `http://127.0.0.1:${siteAddress.port}`;

    const chrome = process.env.TITAN_TEST_CHROME_BIN;
    browser = await chromium.launch({
      ...(chrome ? { executablePath: chrome } : { channel: 'chrome' }),
      args: useGodot ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
    });
    const leader = await browser.newPage();
    const scout = await browser.newPage();
    await Promise.all([setup(leader, url, useGodot), setup(scout, url, useGodot)]);

    await call(leader, 'createRoom', 'Vanguard', 'Migration parity', true, host);
    const first = await snapshot(leader, (event) => !!event.roomCode);
    assert.equal(first.snapshot.players[first.playerId].isLeader, true);
    assert.equal(first.roomCode.length, 6);

    await call(scout, 'listRooms', host);
    const listing = await eventually(async () =>
      (await events<{ rooms: { roomCode: string }[] }>(scout, 'rooms'))
        .find((event) => event.rooms.some((room) => room.roomCode === first.roomCode)));
    assert.equal(listing.rooms.length, 1);
    await call(scout, 'joinRoomByCode', 'AAAAAA', 'Scout', host);
    await eventually(async () => (await events<S2C_RoomError>(scout, 'room_error'))
      .find((event) => event.message.includes('AAAAAA')));

    await call(scout, 'joinRoomByCode', first.roomCode.toLowerCase(), 'Scout', host);
    const joined = await snapshot(scout, (event) => Object.keys(event.snapshot.players).length === 2);
    assert.equal(joined.snapshot.players[joined.playerId].nickname, 'Scout');
    assert.equal(joined.snapshot.players[joined.playerId].ready, false);

    await call(scout, 'sendLobbyAction', 'start_match', '');
    await eventually(async () => (await events<S2C_RoomError>(scout, 'room_error'))
      .find((event) => event.code === 'NOT_LEADER'));
    await call(scout, 'sendLobbyAction', 'ready', '');
    await snapshot(leader, (event) => !!event.snapshot.players[joined.playerId]?.ready);
    await call(leader, 'sendLobbyAction', 'start_match', '');
    const live = await snapshot(scout, (event) => event.snapshot.phase === 'playing');
    assert.equal(Object.keys(live.snapshot.titans).length, 4);

    const self = live.snapshot.players[joined.playerId];
    const frame = {
      dt: 1 / 60,
      moveForward: 1,
      moveRight: 0,
      jumpPressed: false,
      boostHeld: false,
      dodgePressed: false,
      resupplyPressed: false,
      reviveHeld: false,
      yaw: 0,
      pitch: 0,
      camOrigin: [self.position[0], self.position[1] + 1.65, self.position[2]],
      camForward: [0, 0, -1],
      camRight: [1, 0, 0],
      leftGrappleAction: 'none',
      rightGrappleAction: 'none',
      lockedTitanId: null,
      lockedZone: 'Nape',
    };
    let seq = 0;
    for (let i = 0; i < 48; i++) {
      seq = await call<number>(scout, 'sendInputFrame', JSON.stringify(frame));
      await delay(15);
    }
    const moved = await snapshot(leader, (event) =>
      event.snapshot.players[joined.playerId]?.lastAckedSeq >= seq);
    const movedPlayer = moved.snapshot.players[joined.playerId];
    assert(movedPlayer.position[2] < self.position[2] - 0.2,
      `Expected forward movement from ${self.position} but reached ${movedPlayer.position}`);

    await call(scout, 'sendTeamPing', JSON.stringify({
      targetTitanId: null,
      worldPos: self.position,
      quickChatKey: 'target_nape',
    }));
    await snapshot(leader, (event) =>
      event.snapshot.pings.some((ping) => ping.message === 'Target the Nape!'));

    const attackSeq = await call<number>(scout, 'sendAttackIntent', JSON.stringify({
      isHeavy: true,
      weaponType: 'thunder_spear',
      aimYaw: 0,
      aimOrigin: frame.camOrigin,
      aimDir: frame.camForward,
      targetTitanId: null,
      targetZone: 'Nape',
    }));
    assert(attackSeq > seq);
    await eventually(async () => (await events<S2C_CombatEvent>(leader, 'combat_event'))
      .find((event) => event.type === 'thunder_spear_fired' && event.attackerId === joined.playerId));
    await eventually(async () => (await events<S2C_CombatEvent>(leader, 'combat_event'))
      .find((event) => event.type === 'thunder_spear_exploded'));

    const room = activeRoomsByCode.get(first.roomCode)?.roomRef;
    const client = room?.clients.find((candidate) => candidate.sessionId === joined.playerId);
    assert(client);
    (client as unknown as { ref: { terminate: () => void } }).ref.terminate();
    await eventually(async () =>
      (await events<{ state: string }>(scout, 'connection')).find((event) => event.state === 'reconnecting'));
    const recovered = await snapshot(scout, (event) =>
      event.playerId !== joined.playerId && !!event.snapshot.players[event.playerId]?.connected);
    assert.equal(Object.keys(recovered.snapshot.players).length, 2);
    assert.equal(recovered.snapshot.players[recovered.playerId].nickname, 'Scout');
    assert.equal(recovered.snapshot.players[recovered.playerId].thunderSpears, 3);

    await call(scout, 'leaveRoom');
    await snapshot(leader, (event) =>
      Object.keys(event.snapshot.players).length === 1 && event.snapshot.serverTick >= recovered.snapshot.serverTick);
    await call(leader, 'leaveRoom');
  } finally {
    await browser?.close();
    await backend?.shutdown();
    site.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
