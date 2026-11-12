import * as THREE from 'three';

// Y is up and +Z is forward. These profiles use the existing 2 m rig's bind
// space so the authored clips and gameplay attachments can be used directly.
type TorsoBone = 'hips' | 'spine' | 'spine1' | 'chest' | 'neck' | 'head';
type BoneIds = Record<TorsoBone, number>;
type Ring = {
  y: number;
  width: number;
  front: number;
  back: number;
  centerZ?: number;
  bone: TorsoBone;
  blend?: [TorsoBone, number];
  color: number;
};

const TORSO: Ring[] = [
  { y: 0.90, width: 0.160, front: 0.134, back: 0.124, bone: 'hips', color: 0xa67a69 },
  { y: 1.00, width: 0.204, front: 0.147, back: 0.163, bone: 'hips', color: 0xb58571 },
  { y: 1.10, width: 0.199, front: 0.153, back: 0.157, bone: 'hips', blend: ['spine', 0.55], color: 0xc39680 },
  { y: 1.20, width: 0.184, front: 0.151, back: 0.156, bone: 'spine', blend: ['spine1', 0.28], color: 0xc49a85 },
  { y: 1.32, width: 0.216, front: 0.177, back: 0.181, bone: 'spine1', color: 0xd0a18a },
  { y: 1.44, width: 0.250, front: 0.191, back: 0.206, bone: 'spine1', blend: ['chest', 0.42], color: 0xd3a58d },
  { y: 1.54, width: 0.280, front: 0.205, back: 0.216, bone: 'chest', color: 0xd9aa92 },
  { y: 1.62, width: 0.282, front: 0.181, back: 0.198, bone: 'chest', color: 0xd5a58c },
  { y: 1.68, width: 0.222, front: 0.139, back: 0.157, bone: 'chest', blend: ['neck', 0.37], color: 0xc99a83 },
  { y: 1.72, width: 0.127, front: 0.107, back: 0.130, bone: 'neck', color: 0xbf8e78 },
  { y: 1.755, width: 0.108, front: 0.093, back: 0.126, bone: 'neck', color: 0xbb8b77 },
  { y: 1.81, width: 0.100, front: 0.092, back: 0.124, bone: 'neck', color: 0xc0907a },
  { y: 1.855, width: 0.094, front: 0.091, back: 0.104, bone: 'neck', blend: ['head', 0.7], color: 0xc6947e },
];

const SKULL: Ring[] = [
  { y: 1.765, width: 0.055, front: 0.088, back: 0.066, centerZ: 0.044, bone: 'head', color: 0xa97967 },
  { y: 1.795, width: 0.094, front: 0.112, back: 0.096, centerZ: 0.037, bone: 'head', color: 0xb98874 },
  { y: 1.835, width: 0.121, front: 0.126, back: 0.117, centerZ: 0.027, bone: 'head', color: 0xc5937e },
  { y: 1.875, width: 0.140, front: 0.126, back: 0.135, centerZ: 0.020, bone: 'head', color: 0xd5a790 },
  { y: 1.922, width: 0.136, front: 0.135, back: 0.141, centerZ: 0.017, bone: 'head', color: 0xd5a891 },
  { y: 1.968, width: 0.123, front: 0.124, back: 0.125, centerZ: 0.013, bone: 'head', color: 0xd4a38d },
  { y: 2.017, width: 0.091, front: 0.098, back: 0.096, centerZ: 0.006, bone: 'head', color: 0xcc9e88 },
  { y: 2.054, width: 0.043, front: 0.048, back: 0.049, centerZ: 0.002, bone: 'head', color: 0xc69880 },
];

const SEGMENTS = 20;

function loft(rings: Ring[], bones: BoneIds): THREE.BufferGeometry {
  const position: number[] = [];
  const uv: number[] = [];
  const colors: number[] = [];
  const joints: number[] = [];
  const weights: number[] = [];
  const indices: number[] = [];

  const appendVertex = (ring: Ring, x: number, z: number, u: number, v: number, shade = 1): number => {
    const vertex = position.length / 3;
    const tint = new THREE.Color(ring.color).multiplyScalar(shade);
    const [secondBone, influence] = ring.blend ?? [ring.bone, 0];
    position.push(x, ring.y, z);
    uv.push(u, v);
    colors.push(tint.r, tint.g, tint.b);
    joints.push(bones[ring.bone], bones[secondBone], 0, 0);
    weights.push(1 - influence, influence, 0, 0);
    return vertex;
  };

  for (const [row, ring] of rings.entries()) {
    for (let segment = 0; segment < SEGMENTS; segment++) {
      const angle = segment / SEGMENTS * Math.PI * 2;
      const lateral = Math.cos(angle);
      const forward = Math.sin(angle);
      const depth = forward < 0 ? ring.back : ring.front;
      const flankShade = 1 - 0.16 * lateral ** 2;
      appendVertex(
        ring, lateral * ring.width, (ring.centerZ ?? 0) + forward * depth,
        segment / SEGMENTS, row / (rings.length - 1), flankShade
      );
      if (row === rings.length - 1) continue;
      const a = row * SEGMENTS + segment;
      const b = row * SEGMENTS + (segment + 1) % SEGMENTS;
      indices.push(a, a + SEGMENTS, b, b, a + SEGMENTS, b + SEGMENTS);
    }
  }

  const first = rings[0];
  const last = rings[rings.length - 1];
  const bottom = appendVertex(first, 0, first.centerZ ?? 0, 0.5, 0);
  const top = appendVertex(last, 0, last.centerZ ?? 0, 0.5, 1);
  const topStart = (rings.length - 1) * SEGMENTS;
  for (let segment = 0; segment < SEGMENTS; segment++) {
    const next = (segment + 1) % SEGMENTS;
    indices.push(bottom, segment, next, top, topStart + next, topStart + segment);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geometry.computeVertexNormals();
  return geometry;
}

export function buildNormalTitanBody(bones: BoneIds): THREE.BufferGeometry[] {
  return [loft(TORSO, bones), loft(SKULL, bones)];
}

function neckSurface(x: number, y: number): number {
  const upperIndex = TORSO.findIndex(ring => ring.y >= y);
  const upper = TORSO[upperIndex];
  const lower = TORSO[upperIndex - 1];
  const t = (y - lower.y) / (upper.y - lower.y);
  const width = THREE.MathUtils.lerp(lower.width, upper.width, t);
  const back = THREE.MathUtils.lerp(lower.back, upper.back, t);
  return -back * Math.sqrt(Math.max(0, 1 - (x / width) ** 2));
}

export function buildNormalTitanScar(anchor: THREE.Vector3): THREE.Mesh {
  const position: number[] = [];
  const indices: number[] = [];
  // Short diagonal creases follow the rear neck surface from the existing
  // gameplay marker. The outline reads in silhouette without a floating box.
  const slashes = [
    [[-0.047, -0.019], [-0.037, -0.002], [-0.029, 0.016], [-0.019, 0.030]],
    [[-0.018, -0.031], [-0.007, -0.014], [0.003, 0.007], [0.014, 0.034]],
    [[0.015, -0.022], [0.025, -0.008], [0.035, 0.012], [0.045, 0.025]],
  ];
  for (const slash of slashes) {
    for (const [index, [x, y]] of slash.entries()) {
      const halfWidth = index === 0 || index === slash.length - 1 ? 0.0017 : 0.0052;
      const a = position.length / 3;
      for (const side of [-1, 1]) {
        const offsetX = x + side * halfWidth;
        const z = neckSurface(offsetX, 1.74 + anchor.y + y) - anchor.z - 0.002;
        position.push(offsetX, y, z);
      }
      if (index < slash.length - 1) indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0xb34332,
    emissive: 0x7c271b,
    emissiveIntensity: 0.5,
    roughness: 0.93,
  }));
}
