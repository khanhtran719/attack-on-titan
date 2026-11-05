import fs from 'node:fs';
import path from 'node:path';

/**
 * Generates minimal valid GLTF 2.0 binary (.glb) asset files in public/assets/models/
 * so GLTFLoader can load static .glb assets alongside our runtime 32-bone SkinnedMesh rigs.
 */
function createMinimalGLB(nodeName) {
  const jsonObj = {
    asset: { version: '2.0', generator: 'TitanHunter3D-AssetGenerator' },
    scene: 0,
    scenes: [{ name: `${nodeName}Scene`, nodes: [0] }],
    nodes: [{ name: nodeName, translation: [0, 0, 0] }],
  };
  let jsonStr = JSON.stringify(jsonObj);
  while (Buffer.byteLength(jsonStr, 'utf8') % 4 !== 0) {
    jsonStr += ' ';
  }
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const totalLen = 12 + 8 + jsonBuf.length;
  const glb = Buffer.alloc(totalLen);

  // GLB Header: magic 'glTF' (0x46546C67), version 2, total length
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(totalLen, 8);

  // JSON Chunk Header: chunkLength, chunkType 'JSON' (0x4E4F534A)
  glb.writeUInt32LE(jsonBuf.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  jsonBuf.copy(glb, 20);

  return glb;
}

const outDir = path.resolve('public/assets/models');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'vanguard_strider.glb'),
  createMinimalGLB('VanguardStriderRigMetadata')
);
fs.writeFileSync(
  path.join(outDir, 'titan_behemoth.glb'),
  createMinimalGLB('TitanBehemothRigMetadata')
);
console.log('Generated GLB assets in public/assets/models/');
