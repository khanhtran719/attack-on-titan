import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { AnimationClip, SkinnedMesh } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { HumanoidRigBuilder } from '../../src/animation/HumanoidRigBuilder';
import { TitanRigBuilder, type TitanVariant } from '../../src/enemies/TitanRigBuilder';

// Three r170 assembles the GLB with the browser FileReader API. These source
// rigs have no images, so only the binary Blob path is needed on Node.
class BinaryFileReader {
  result: ArrayBuffer | null = null;
  onloadend?: () => void;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
}

if (typeof globalThis.FileReader === 'undefined') {
  Object.defineProperty(globalThis, 'FileReader', { value: BinaryFileReader });
}

// The source groups its body geometry by authoring part. Put indices with
// the same material into one group, preserving all vertices, weights and faces.
function batchBodyMaterials(mesh: SkinnedMesh): void {
  const geometry = mesh.geometry;
  const indices = geometry.getIndex();
  if (!indices || !Array.isArray(mesh.material)) return;

  const sourceGroups = [...geometry.groups];
  const batchedIndices: number[] = [];
  geometry.clearGroups();
  mesh.material.forEach((material, materialIndex) => {
    const start = batchedIndices.length;
    for (const group of sourceGroups) {
      if (group.materialIndex !== materialIndex) continue;
      for (let i = group.start; i < group.start + group.count; i++) {
        batchedIndices.push(indices.getX(i));
      }
    }
    const count = batchedIndices.length - start;
    if (count > 0) geometry.addGroup(start, count, materialIndex);
    material.name = `VanguardBodyMaterial${materialIndex}`;
  });

  if (batchedIndices.length !== indices.count) {
    throw new Error('Material batching lost source triangles');
  }
  geometry.setIndex(batchedIndices);
}

function prepareClips(sourceClips: Iterable<AnimationClip>): AnimationClip[] {
  return Array.from(sourceClips, (source) => {
    const clip = source.clone();

    // glTF infers clip duration from the last key. The authored mixer uses
    // AnimationClip.duration, including holds after the final authored key.
    const longest = clip.tracks.reduce((result, track) =>
      track.times.at(-1)! > result.times.at(-1)! ? track : result
    );
    if (longest.times.at(-1)! < clip.duration - 0.000001) {
      const size = longest.getValueSize();
      longest.times = Float32Array.from([...longest.times, clip.duration]);
      longest.values = Float32Array.from([...longest.values, ...longest.values.slice(-size)]);
    }
    return clip;
  });
}

const player = HumanoidRigBuilder.buildPlayerRig();
batchBodyMaterials(player.skinnedMesh);
for (const [name, node] of Object.entries({
  LeftWinch: player.leftWinchNode,
  RightWinch: player.rightWinchNode,
  ThrusterNozzle: player.thrusterNozzleNode,
  LeftSwordHilt: player.leftSwordHilt,
  RightSwordHilt: player.rightSwordHilt,
  LeftSwordTip: player.leftSwordTip,
  RightSwordTip: player.rightSwordTip,
  LeftBlade: player.leftBladeMesh,
  RightBlade: player.rightBladeMesh,
})) {
  node.name = name;
}

const assets = [{ name: 'vanguard', root: player.rootGroup, animations: player.animations.values() }];
const variants: TitanVariant[] = ['normal', 'abnormal', 'large'];
for (const variant of variants) {
  const titan = TitanRigBuilder.buildTitanRig(variant, 2);
  titan.rootGroup.name = `Titan_${variant}`;
  titan.scaleGroup.name = 'TitanModel';
  titan.skinnedMesh.name = 'TitanMesh';
  titan.napeMarkerMesh.name = 'NapeScar';
  for (const [zone, node] of Object.entries(titan.zoneNodes)) {
    node.name = zone === 'Nape' ? 'NapeWeakPointNode' : `${zone}Zone`;
  }

  assets.push({
    name: `titan_${variant}`,
    root: titan.rootGroup,
    animations: titan.animations.values(),
  });
}

const output = new URL('../assets/', import.meta.url);
const checkOnly = process.argv.includes('--check');
if (!checkOnly) await mkdir(output, { recursive: true });
for (const { name, root, animations } of assets) {
  root.updateMatrixWorld(true);
  const exported = await new GLTFExporter().parseAsync(root, {
    animations: prepareClips(animations),
    binary: true,
  });
  if (!(exported instanceof ArrayBuffer)) throw new Error(`Expected binary GLB for ${name}`);
  const destination = new URL(`${name}.glb`, output);
  const bytes = Buffer.from(exported);
  if (checkOnly) {
    const current = await readFile(destination);
    if (!current.equals(bytes)) throw new Error(`${name}.glb differs from the source rig`);
  } else {
    await writeFile(destination, bytes);
  }
  console.log(`${name}.glb: ${exported.byteLength.toLocaleString('en-US')} bytes`);
}
