import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { startMultiplayerServer } from '../../src/server/index';
import { activeRoomsByCode } from '../../src/server/CoopHunterRoom';

const mime: Record<string, string> = {
  '.js': 'text/javascript',
  '.html': 'text/html',
  '.wasm': 'application/wasm',
  '.pck': 'application/octet-stream',
  '.png': 'image/png',
};

// Godot Control nodes render inside the canvas. Keep the fixed viewport and
// use named points for the menu layout exercised by this real-input smoke test.
const point = {
  coopOperations: [640, 439],
  serverField: [650, 271],
  codeField: [620, 359],
  createRoom: [401, 458],
  joinByCode: [511, 458],
  readyUp: [640, 443],
  startOperation: [640, 495],
  world: [640, 359],
  restartMission: [640, 435],
  returnToCommand: [640, 459],
} as const;

async function click(page: Page, control: keyof typeof point): Promise<void> {
  await page.bringToFront();
  const [x, y] = point[control];
  await page.mouse.click(x, y);
}

async function eventually<T>(description: string, check: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 12_000;
  do {
    const result = check();
    if (result !== undefined) return result;
    await delay(30);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}`);
}

async function openGame(page: Page, url: string): Promise<void> {
  await page.bringToFront();
  await page.goto(url);
  try {
    await page.waitForFunction(() =>
      document.querySelector('canvas') !== null &&
      document.querySelector('#status') === null, null, { polling: 100, timeout: 60_000 });
  } catch (error) {
    const notice = await page.locator('#status-notice').allTextContents();
    throw new Error(`Godot page did not finish loading (${notice.join(' ') || 'no notice'})`, { cause: error });
  }
}

async function openCoop(page: Page, host: string): Promise<void> {
  await click(page, 'coopOperations');
  await delay(150);
  await click(page, 'serverField');
  await delay(80);
  await page.keyboard.type(host, { delay: 25 });
  await delay(150);
}

test('two exported Godot game clients enter and leave a live co-op match through the canvas UI', {
  timeout: 150_000,
}, async () => {
  const exportDir = resolve(process.env.TITAN_TEST_GAME_EXPORT || 'godot-client/exports/web');
  const screenshots = process.env.TITAN_TEST_SCREENSHOTS;
  const consoleErrors: string[] = [];
  const capture = async (page: Page, name: string) => {
    if (screenshots) {
      await mkdir(screenshots, { recursive: true });
      await page.screenshot({ path: join(screenshots, `${name}.png`) });
    }
  };
  // Make a missing export fail before opening a server or browser.
  await readFile(join(exportDir, 'index.html'));
  const site = createServer(async (req, res) => {
    const file = basename(new URL(req.url || '/', 'http://localhost').pathname) || 'index.html';
    try {
      const content = await readFile(join(exportDir, file));
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
      res.end(content);
    } catch {
      res.writeHead(404).end();
    }
  });
  let backend: Awaited<ReturnType<typeof startMultiplayerServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    backend = await startMultiplayerServer(0);
    const backendAddress = backend.httpServer.address();
    assert(backendAddress && typeof backendAddress !== 'string');
    const host = `http://127.0.0.1:${backendAddress.port}`;
    await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
    const address = site.address();
    assert(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}`;

    const chrome = process.env.TITAN_TEST_CHROME_BIN;
    browser = await chromium.launch(chrome ? { executablePath: chrome } : { channel: 'chrome' });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const leader = await context.newPage();
    const scout = await context.newPage();
    for (const [name, page] of [['leader', leader], ['scout', scout]] as const) {
      page.on('pageerror', (error) => consoleErrors.push(`${name}: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error' && /^(?:SCRIPT )?ERROR:/.test(message.text())) {
          consoleErrors.push(`${name}: ${message.text()}`);
        }
      });
    }

    await scout.route('**/coop-bridge.js', async (route) => {
      const response = await route.fetch();
      const script = await response.text();
      // Model a snapshot already queued on the client when the player leaves.
      // This arrives before the disconnected callback from the real bridge.
      await route.fulfill({ response, body: script + `
        TitanCoop = ((factory) => ({
          create(emit) {
            let playingSnapshot;
            const bridge = factory.create((kind, json) => {
              if (kind === 'snapshot' && JSON.parse(json).snapshot.phase === 'playing') {
                playingSnapshot = json;
              }
              emit(kind, json);
            });
            return { ...bridge, leaveRoom() {
              if (playingSnapshot) {
                window.lateCoopSnapshotCount = (window.lateCoopSnapshotCount || 0) + 1;
                emit('snapshot', playingSnapshot);
              }
              return bridge.leaveRoom();
            }};
          }
        }))(TitanCoop);
      ` });
    });

    await openGame(leader, url);
    await openCoop(leader, host);
    await capture(leader, 'leader-form');
    await click(leader, 'createRoom');
    const entry = await eventually('leader to create the room', () =>
      Array.from(activeRoomsByCode.values()).find((candidate) => Boolean(candidate.roomRef.getRoomSnapshot().leaderId)));
    const room = entry.roomRef;
    const leaderId = room.getRoomSnapshot().leaderId;
    assert.equal(room.getRoomSnapshot().players[leaderId].isLeader, true);
    await delay(300);
    await capture(leader, 'leader-lobby');

    await openGame(scout, url);
    const menuTitle = { clip: { x: 375, y: 212, width: 290, height: 48 } };
    const mainMenuTitle = await scout.screenshot(menuTitle);
    await openCoop(scout, host);
    await click(scout, 'codeField');
    await delay(80);
    await scout.keyboard.type(entry.roomCode, { delay: 25 });
    await delay(150);
    await capture(scout, 'scout-form');
    await click(scout, 'joinByCode');
    const scoutId = await eventually('scout to join by invitation code', () =>
      Object.keys(room.getRoomSnapshot().players).find((id) => id !== leaderId));
    await delay(300);
    await capture(scout, 'scout-lobby');
    await click(scout, 'readyUp');
    await eventually('scout ready state', () => room.getRoomSnapshot().players[scoutId]?.ready ? true : undefined);
    await delay(300);
    await click(leader, 'startOperation');
    const spawn = await eventually('live two-player mission', () => {
      const snapshot = room.getRoomSnapshot();
      return snapshot.phase === 'playing' ? snapshot.players[scoutId] : undefined;
    });
    assert.equal(Object.keys(room.getRoomSnapshot().titans).length, 4);

    await delay(300);
    await click(scout, 'world');
    await scout.waitForFunction(() => document.pointerLockElement === document.querySelector('canvas'), null, { timeout: 5_000 });
    await scout.keyboard.down('w');
    try {
      await eventually('real scout movement and server acknowledgements', () => {
        const player = room.getRoomSnapshot().players[scoutId];
        if (player.lastAckedSeq > 0 && Math.hypot(
          player.position[0] - spawn.position[0],
          player.position[2] - spawn.position[2],
        ) > 0.8) return true;
      });
    } finally {
      await scout.keyboard.up('w');
    }
    await scout.keyboard.press('1', { delay: 80 });
    await eventually('quick-chat marker broadcast', () =>
      room.getRoomSnapshot().pings.find((ping) => ping.senderId === scoutId && ping.message === 'Target the Nape!'));
    await scout.keyboard.press('v', { delay: 80 });
    await eventually('authoritative Thunder Spear ammunition use', () =>
      room.getRoomSnapshot().players[scoutId]?.thunderSpears === 3 ? true : undefined);
    await capture(scout, 'scout-match');

    const oldTitans = new Set(Object.keys(room.getRoomSnapshot().titans));
    await leader.bringToFront();
    await leader.keyboard.press('p', { delay: 80 });
    await delay(200);
    await capture(leader, 'leader-pause');
    await click(leader, 'restartMission');
    await eventually('leader restart with a new Titan roster and restored scout ammo', () => {
      const snapshot = room.getRoomSnapshot();
      const titans = Object.keys(snapshot.titans);
      if (snapshot.phase === 'playing' && titans.length === oldTitans.size &&
        titans.every((id) => !oldTitans.has(id)) &&
        snapshot.players[scoutId]?.thunderSpears === 4) return true;
    });

    // A real click and spear action require each client to have dismissed the pause
    // overlay and applied the fresh playing snapshot rather than leaving the room.
    for (const [page, id, name] of [[leader, leaderId, 'leader'], [scout, scoutId, 'scout']] as const) {
      await page.bringToFront();
      await delay(400);
      await capture(page, `${name}-fresh-round`);
      await click(page, 'world');
      await page.waitForFunction(() => document.pointerLockElement === document.querySelector('canvas'), null, { timeout: 5_000 });
      await page.keyboard.press('v', { delay: 80 });
      await eventually(`${name} to fire a fresh spear after restart`, () =>
        room.getRoomSnapshot().players[id]?.thunderSpears === 3 ? true : undefined);
      await capture(page, `${name}-restarted`);
    }

    await scout.keyboard.press('p', { delay: 80 });
    await scout.waitForFunction(() => document.pointerLockElement === null, null, { timeout: 5_000 });
    await delay(150);
    await capture(scout, 'scout-pause');
    await click(scout, 'returnToCommand');
    await eventually('scout to leave through the game menu', () =>
      Object.keys(room.getRoomSnapshot().players).length === 1 ? true : undefined);
    assert.equal(await scout.evaluate(() => (window as Window & { lateCoopSnapshotCount?: number }).lateCoopSnapshotCount), 1);
    await delay(400);
    assert((await scout.screenshot(menuTitle)).equals(mainMenuTitle),
      'A playing snapshot queued during leave must not reopen co-op or replace the main menu.');
    await capture(scout, 'scout-returned-to-command');
    assert.deepEqual(consoleErrors, []);
  } catch (error) {
    if (consoleErrors.length) console.error(consoleErrors.join('\n'));
    throw error;
  } finally {
    await browser?.close();
    await backend?.shutdown();
    site.close();
  }
});
