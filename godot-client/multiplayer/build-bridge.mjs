import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const outfile = process.argv[2];
if (!outfile) {
  console.error('Usage: node godot-client/multiplayer/build-bridge.mjs <output>/coop-bridge.js');
  process.exit(1);
}

await build({
  entryPoints: [fileURLToPath(new URL('./web-bridge.ts', import.meta.url))],
  outfile,
  bundle: true,
  format: 'iife',
  globalName: 'TitanCoop',
  platform: 'browser',
  target: ['es2022'],
  define: { 'import.meta': '{}' },
  minify: true,
  legalComments: 'eof',
});
