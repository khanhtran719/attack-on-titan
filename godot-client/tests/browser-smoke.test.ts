import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';

const VIEWPORT = { width: 1280, height: 720 };
const GODOT = resolve(process.env.TITAN_WEB_BUILD ?? 'godot-client/exports/web');
const SOURCE = process.env.TITAN_THREE_BUILD;
const CHROME = process.env.TITAN_CHROME_BIN;
const OUTPUT = process.env.TITAN_BROWSER_ARTIFACTS;
const SOFTWARE = process.env.TITAN_SOFTWARE_GPU === '1';
const SAMPLE_COUNT = Number(process.env.TITAN_BENCHMARK_SAMPLES ?? '1');
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm',
  '.pck': 'application/octet-stream', '.css': 'text/css', '.png': 'image/png',
  '.json': 'application/json', '.glb': 'model/gltf-binary',
};

async function serve(root: string) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = resolve(root, '.' + pathname);
    if (!file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    if (pathname === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise<void>((done) => server.close(() => done())),
  };
}

async function launch() {
  return chromium.launch({
    ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }),
    args: SOFTWARE ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
  });
}

async function openPage(
  browser: Browser,
  url: string,
  engine: 'godot' | 'three',
  initialize?: (page: Page) => Promise<unknown>,
) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  await initialize?.(page);
  await page.goto(url);
  if (engine === 'godot') {
    await page.locator('#status').waitFor({ state: 'detached' });
    await page.locator('#canvas').waitFor({ state: 'visible' });
  } else {
    await page.locator('#btn-start-training').waitFor({ state: 'visible' });
  }
  await page.evaluate(() => new Promise<void>((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const bootMs = await page.evaluate(() => performance.now());
  return { page, errors, bootMs };
}

async function saveScreenshot(page: Page, filename: string) {
  if (!OUTPUT) return;
  const path = resolve(OUTPUT, filename);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

function recognize(image: Buffer) {
  return execFileSync(process.env.TITAN_OCR_BIN ?? 'tesseract',
    ['stdin', 'stdout', '--psm', '11'], { input: image, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
}

async function visibleText(page: Page, expected: RegExp, clip?: NonNullable<Parameters<Page['screenshot']>[0]>['clip']) {
  let last = '';
  try {
    await until(async () => {
      last = recognize(await page.screenshot({ clip }));
      return expected.test(last) ? true : undefined;
    }, 9000);
  } catch (cause) {
    throw new Error(`Could not read ${expected} in rendered canvas. OCR: ${last}`, { cause });
  }
}

async function until<T>(callback: () => T | Promise<T | undefined> | undefined, timeout = 12000): Promise<T> {
  const expires = Date.now() + timeout;
  do {
    const value = await callback();
    if (value !== undefined) return value;
    await delay(80);
  } while (Date.now() < expires);
  throw new Error('Condition not met before timeout');
}

async function pointerLocked(page: Page, expected: boolean) {
  await page.waitForFunction(
    (locked) => Boolean(document.pointerLockElement) === locked, expected,
    { polling: 100, timeout: 5000 },
  );
}

async function ensureClean(errors: string[]) {
  assert.deepEqual(errors, [], errors.join('\n'));
}

test('Godot Web renders training, movement, ODM, pause, settings, restart and Hunt', { timeout: 100000 }, async () => {
  const site = await serve(GODOT);
  let browser: Browser | undefined;
  try {
    browser = await launch();
    const { page, errors } = await openPage(browser, site.url, 'godot');
    await visibleText(page, /TITAN HUNTER/);
    await saveScreenshot(page, 'godot-menu.png');
    await page.mouse.click(640, 388);
    await pointerLocked(page, true);
    const topLeft = { x: 0, y: 18, width: 730, height: 98 };
    await visibleText(page, /Ground|1\s*\/\s*5/, topLeft);
    await page.waitForTimeout(1500);
    await page.keyboard.down('w');
    await page.keyboard.press('Space');
    await page.waitForTimeout(450);
    await page.keyboard.up('w');
    await visibleText(page, /grappling hooks|2\s*\/\s*5/i, topLeft);

    await page.keyboard.down('z');
    await page.keyboard.down('x');
    await page.waitForTimeout(700);
    await visibleText(page, /Pendulum swing|3\s*\/\s*5/i, topLeft);
    await saveScreenshot(page, 'godot-odm.png');
    await page.keyboard.down('Shift');
    await page.waitForTimeout(1500);
    await page.keyboard.up('Shift');
    await page.keyboard.up('z');
    await page.keyboard.up('x');
    await visibleText(page, /to lock on|Target lock-on|4\s*\/\s*5/i, topLeft);

    await page.keyboard.press('Tab');
    await visibleText(page, /Execute|Swing behind|Nape strike|5\s*\/\s*5/i, topLeft);
    await page.keyboard.down('h');
    await visibleText(page, /TACTICAL MAP/);
    await page.keyboard.up('h');
    await page.keyboard.press('Escape');
    await pointerLocked(page, false);
    await visibleText(page, /OPERATION PAUSED/);
    await saveScreenshot(page, 'godot-pause.png');
    await page.mouse.click(640, 386);
    await visibleText(page, /VANGUARD EQUIPMENT|Mouse sensitivity/);
    await saveScreenshot(page, 'godot-settings.png');
    await page.keyboard.press('Escape');
    await visibleText(page, /OPERATION PAUSED/);
    await page.mouse.click(640, 336);
    await pointerLocked(page, true);
    await page.keyboard.press('Escape');
    await visibleText(page, /OPERATION PAUSED/);
    await page.mouse.click(640, 435);
    await pointerLocked(page, true);
    await visibleText(page, /Ground|1\s*\/\s*5/, topLeft);
    await page.keyboard.press('Escape');
    await visibleText(page, /OPERATION PAUSED/);
    await page.mouse.click(640, 486);
    await visibleText(page, /TITAN HUNTER/);
    await page.mouse.click(640, 338);
    await pointerLocked(page, true);
    await visibleText(page, /WAVE|from behind|district/i, topLeft);
    await saveScreenshot(page, 'godot-hunt.png');
    await ensureClean(errors);
  } finally {
    await browser?.close();
    await site.stop();
  }
});

test('Godot Web restores legacy progression and persists new settings after reload', { timeout: 50000 }, async () => {
  const site = await serve(GODOT);
  let browser: Browser | undefined;
  try {
    browser = await launch();
    const { page, errors } = await openPage(browser, site.url, 'godot', (target) =>
      target.addInitScript(() => {
        localStorage.setItem('titan_hunter_3d_progress_v1', JSON.stringify({
          trainingCompleted: true, highScore: 2222, totalTitansSlain: 3,
        }));
        localStorage.setItem('titan_hunter_3d_settings_v1', JSON.stringify({ masterVolume: 0.7 }));
      }));
    const progress = { x: 360, y: 513, width: 520, height: 36 };
    await visibleText(page, /Best\s+2222/i, progress);
    await page.mouse.click(640, 487);
    const volume = { x: 390, y: 262, width: 187, height: 35 };
    await visibleText(page, /0[.,]70/, volume);
    await page.mouse.click(579, 275);
    await visibleText(page, /0[.,]00/, volume);
    await page.waitForTimeout(2000); // Allow the web filesystem to flush to IndexedDB.
    await page.reload();
    await page.locator('#status').waitFor({ state: 'detached' });
    await visibleText(page, /Best\s+2222/i, progress);
    await page.mouse.click(640, 487);
    await visibleText(page, /0[.,]00/, volume);
    await ensureClean(errors);
  } finally {
    await browser?.close();
    await site.stop();
  }
});

interface FrameMetrics {
  renderer: string;
  frames: number;
  averageFps: number;
  lowOnePctFps: number;
  frameP95Ms: number;
  frameP99Ms: number;
  jsHeapBytes?: number;
  encodedAssetBytes: number;
}

// Supply a script string so tsx's function-name transform cannot add a Node-only helper to browser code.
async function sampleFrames(page: Page) {
  return page.evaluate<FrameMetrics>(`(async () => {
    const probe = document.createElement('canvas').getContext('webgl2');
    const debug = probe?.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug && probe?.getParameter(debug.UNMASKED_RENDERER_WEBGL);
    probe?.getExtension('WEBGL_lose_context')?.loseContext();
    await new Promise((done) => setTimeout(done, 2500));
    const deltas = await new Promise((done) => {
      let first = 0;
      let previous = 0;
      const frames = [];
      requestAnimationFrame(function sample(time) {
        if (first === 0) first = time;
        if (previous !== 0) frames.push(time - previous);
        previous = time;
        if (time - first >= 6000) done(frames);
        else requestAnimationFrame(sample);
      });
    });
    const ordered = deltas.slice().sort((a, b) => a - b);
    const worst = ordered.slice(-Math.ceil(deltas.length / 100));
    const elapsed = deltas.reduce((sum, value) => sum + value, 0);
    const worstElapsed = worst.reduce((sum, value) => sum + value, 0);
    const heap = performance.memory;
    return {
      renderer,
      frames: deltas.length,
      averageFps: 1000 * deltas.length / elapsed,
      lowOnePctFps: 1000 * worst.length / worstElapsed,
      frameP95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
      frameP99Ms: ordered[Math.ceil(ordered.length * 0.99) - 1],
      jsHeapBytes: heap?.usedJSHeapSize,
      encodedAssetBytes: performance.getEntriesByType('resource')
        .reduce((bytes, entry) => bytes + entry.encodedBodySize, 0),
    };
  })()`);
}

async function sampleDrawCalls(page: Page) {
  return page.evaluate<number>(`(async () => {
    const methods = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements'];
    const prototype = WebGL2RenderingContext.prototype;
    const descriptors = methods.map((method) => Object.getOwnPropertyDescriptor(prototype, method));
    let calls = 0;
    methods.forEach((method) => {
      const native = prototype[method];
      Object.defineProperty(prototype, method, {
        configurable: true,
        value: function (...args) {
          calls++;
          return native.apply(this, args);
        },
      });
    });
    try {
      const draws = await new Promise((done) => {
        const counts = [];
        requestAnimationFrame(function sample() {
          counts.push(calls);
          calls = 0;
          if (counts.length >= 61) done(counts.slice(1));
          else requestAnimationFrame(sample);
        });
      });
      return draws.reduce((total, count) => total + count, 0) / draws.length;
    } finally {
      methods.forEach((method, index) => {
        const descriptor = descriptors[index];
        if (descriptor) Object.defineProperty(prototype, method, descriptor);
        else Reflect.deleteProperty(prototype, method);
      });
    }
  })()`);
}

test('benchmark Training spawn at 1280×720 against the Three.js build', {
  skip: SOURCE ? false : 'Set TITAN_THREE_BUILD to the path to the built Three.js dist directory.',
  timeout: 170000,
}, async () => {
  const godot = await serve(GODOT);
  const three = await serve(resolve(SOURCE!));
  let browser: Browser | undefined;
  try {
    browser = await launch();
    assert(Number.isInteger(SAMPLE_COUNT) && SAMPLE_COUNT >= 1 && SAMPLE_COUNT <= 4);
    const runs = [];
    for (let sample = 1; sample <= SAMPLE_COUNT; sample++) {
      const order = sample % 2 === 1 ? ['three', 'godot'] as const : ['godot', 'three'] as const;
      for (const engine of order) {
        const { page, errors, bootMs } = await openPage(browser, engine === 'godot' ? godot.url : three.url, engine);
        if (engine === 'godot') await page.mouse.click(640, 388);
        else await page.locator('#btn-start-training').click();
        await pointerLocked(page, true);
        const frames = await sampleFrames(page);
        const webglDrawCallsPerFrame = await sampleDrawCalls(page);
        runs.push({ engine, sample, bootMs, ...frames, webglDrawCallsPerFrame, errors });
        await saveScreenshot(page, `${engine}-benchmark-training-${sample}.png`);
        await page.close();
      }
    }
    const result = { browser: browser.version(), viewport: VIEWPORT, softwareGpu: SOFTWARE, runs };
    console.log(JSON.stringify(result));
    if (OUTPUT) await writeFile(resolve(OUTPUT, 'benchmark.json'), JSON.stringify(result, null, 2));
  } finally {
    await browser?.close();
    await three.stop();
    await godot.stop();
  }
});
