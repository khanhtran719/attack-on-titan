import { GameEngine } from './core/GameEngine';

declare global {
  interface Window {
    __TITAN_HUNTER_GAME__?: GameEngine;
  }
}

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const uiLayer = document.getElementById('ui-layer') as HTMLElement;

  if (!canvas || !uiLayer) {
    throw new Error('Missing #game-canvas or #ui-layer in DOM.');
  }

  const engine = new GameEngine(canvas, uiLayer);
  await engine.init();
  window.__TITAN_HUNTER_GAME__ = engine;
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap Titan Hunter 3D:', err);
});
