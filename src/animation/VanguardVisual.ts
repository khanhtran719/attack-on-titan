import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Bind-pose coordinates are meters, with Y up and the cloak facing -Z.
const CLOAK_ROWS = [
  { height: 1.55, width: 0.122, back: -0.115 },
  { height: 1.49, width: 0.189, back: -0.149 },
  { height: 1.40, width: 0.195, back: -0.167 },
  { height: 1.30, width: 0.172, back: -0.179 },
  { height: 1.20, width: 0.151, back: -0.200 },
  { height: 1.09, width: 0.151, back: -0.228 },
  { height: 0.98, width: 0.153, back: -0.257 },
  { height: 0.88, width: 0.144, back: -0.282 },
];

type CloakBone = { index: number; height: number };
type CloakVertex = { u: number; v: number; color: THREE.Color; lift?: number };

function cloakPoint(u: number, v: number, lift = 0): THREE.Vector3 {
  const index = v * (CLOAK_ROWS.length - 1);
  const low = Math.floor(index);
  const first = CLOAK_ROWS[low];
  const next = CLOAK_ROWS[Math.min(low + 1, CLOAK_ROWS.length - 1)];
  const blend = index - low;
  const width = THREE.MathUtils.lerp(first.width, next.width, blend);
  const height = THREE.MathUtils.lerp(first.height, next.height, blend);
  const back = THREE.MathUtils.lerp(first.back, next.back, blend);
  const fold = Math.cos(u * Math.PI * 3) * (0.004 + 0.010 * v);
  const curve = -0.023 * (1 - u * u);
  const hem = 0.046 * u * u * THREE.MathUtils.smoothstep(v, 0.80, 1);
  return new THREE.Vector3(u * width, height + hem, back + curve + fold - lift);
}

function skinCloak(vertices: CloakVertex[], faces: number[], bones: [CloakBone, CloakBone, CloakBone]): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const weights: number[] = [];
  const [top, mid, tip] = bones;

  for (const vertex of vertices) {
    const point = cloakPoint(vertex.u, vertex.v, vertex.lift);
    positions.push(point.x, point.y, point.z);
    uvs.push(vertex.u * 0.5 + 0.5, 1 - vertex.v);
    colors.push(vertex.color.r, vertex.color.g, vertex.color.b);

    const isUpper = point.y >= mid.height;
    const upper = isUpper ? top : mid;
    const lower = isUpper ? mid : tip;
    const progress = THREE.MathUtils.smoothstep(upper.height - point.y, 0, upper.height - lower.height);
    indices.push(upper.index, lower.index, 0, 0);
    weights.push(1 - progress, progress, 0, 0);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(faces);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geometry.computeVertexNormals();
  return geometry;
}

export function createVanguardCloak(bones: [CloakBone, CloakBone, CloakBone]): THREE.BufferGeometry {
  const vertices: CloakVertex[] = [];
  const faces: number[] = [];
  const fabric = new THREE.Color(0x38674e);
  const hem = new THREE.Color(0x274637);
  const across = [-1, -0.93, -0.83, -0.67, -0.5, -0.33, -0.17, 0, 0.17, 0.33, 0.5, 0.67, 0.83, 0.93, 1];
  const rows = Array.from({ length: 22 }, (_, row) => row / 21);

  for (const [row, v] of rows.entries()) {
    for (const [column, u] of across.entries()) {
      const trimmed = Math.abs(u) > 0.92 || v >= rows.at(-2)!;
      const tint = trimmed ? hem : fabric;
      const color = tint.clone().multiplyScalar(0.91 + 0.12 * Math.cos(u * Math.PI * 3));
      vertices.push({ u, v, color });
      if (row + 1 < rows.length && column + 1 < across.length) {
        const index = row * across.length + column;
        const below = index + across.length;
        faces.push(index, index + 1, below, index + 1, below + 1, below);
      }
    }
  }

  // Crest panels are sampled from the same curved surface and weights as the cloth.
  const addPatch = (outline: ReadonlyArray<readonly [number, number]>, color: number, lift: number) => {
    const contour = outline.map(([u, v]) => new THREE.Vector2(u, v));
    const start = vertices.length;
    const tint = new THREE.Color(color);
    vertices.push(...contour.map(({ x, y }) => ({ u: x, v: y, color: tint, lift })));
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      faces.push(start + a, start + b, start + c);
    }
  };

  addPatch([[-0.37, 0.23], [0, 0.19], [0.37, 0.23], [0.32, 0.41], [0, 0.50], [-0.32, 0.41]], 0xbca478, 0.006);
  addPatch([[-0.32, 0.245], [0, 0.209], [0.32, 0.245], [0.27, 0.397], [0, 0.475], [-0.27, 0.397]], 0x873b39, 0.008);
  for (const side of [-1, 1]) {
    addPatch([
      [side * 0.045, 0.335], [side * 0.245, 0.272], [side * 0.205, 0.326],
      [side * 0.112, 0.368], [side * 0.174, 0.358], [side * 0.039, 0.427],
    ], 0xe9e4ce, 0.010);
  }

  return skinCloak(vertices, faces, bones);
}

export function createVanguardWinchHousing(): THREE.BufferGeometry {
  const profile = new THREE.Shape();
  profile.moveTo(-0.035, -0.068);
  profile.lineTo(0.035, -0.068);
  profile.lineTo(0.043, -0.045);
  profile.lineTo(0.043, 0.042);
  profile.lineTo(0.023, 0.070);
  profile.lineTo(-0.023, 0.070);
  profile.lineTo(-0.043, 0.042);
  profile.lineTo(-0.043, -0.045);
  profile.closePath();
  const housing = new THREE.ExtrudeGeometry(profile, {
    depth: 0.635, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.008, bevelThickness: 0.014,
  });
  housing.translate(0, 0, -0.3175);
  return housing;
}

export function createVanguardTankAssembly(side: number): THREE.BufferGeometry {
  const cylinder = (radius: number, length: number, z: number) =>
    new THREE.CylinderGeometry(radius, radius, length, 12)
      .rotateX(Math.PI / 2)
      .translate(side * 0.02, 0.11, z);
  const canister = cylinder(0.041, 0.55, -0.02);
  const rearCap = cylinder(0.051, 0.058, -0.253);
  const frontCollar = cylinder(0.047, 0.039, 0.187);
  const casingLip = new THREE.BoxGeometry(0.10, 0.028, 0.055).translate(0, 0.014, -0.295);
  const casingRail = new THREE.BoxGeometry(0.012, 0.027, 0.45).translate(side * 0.050, 0.015, -0.018);
  return mergeGeometries([canister, rearCap, frontCollar, casingLip, casingRail]);
}
