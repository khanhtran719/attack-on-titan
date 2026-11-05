import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type TitanVariant = 'normal' | 'abnormal' | 'large';

export type TitanAnimName =
  | 'Idle'
  | 'Walk'
  | 'Run'
  | 'Turn'
  | 'Attack'
  | 'Grab'
  | 'Stagger'
  | 'Injured'
  | 'Fall'
  | 'Death';

export type TitanZoneType =
  | 'Nape'
  | 'Head'
  | 'LeftArm'
  | 'RightArm'
  | 'LeftLeg'
  | 'RightLeg';

export interface TitanRigAssets {
  rootGroup: THREE.Group;
  scaleGroup: THREE.Group;
  skinnedMesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
  bonesByName: Record<string, THREE.Bone>;
  animations: Map<TitanAnimName, THREE.AnimationClip>;
  zoneNodes: Record<TitanZoneType, THREE.Object3D>;
  napeMarkerMesh: THREE.Mesh;
}

function buildSkinnedPart(params: {
  rTop: number;
  rBot: number;
  len: number;
  ox?: number;
  oy: number;
  oz?: number;
  boneA: number;
  boneB: number;
  colorHex: number;
}): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(
    params.rTop,
    params.rBot,
    params.len,
    12,
    6,
    false
  );
  geo.translate(params.ox ?? 0, params.oy, params.oz ?? 0);

  const count = geo.attributes.position.count;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color(params.colorHex);

  const minY = params.oy - params.len * 0.5;
  const invL = 1 / Math.max(0.001, params.len);

  for (let i = 0; i < count; i++) {
    skinIndex[i * 4 + 0] = params.boneA;
    skinIndex[i * 4 + 1] = params.boneB;
    skinWeight[i * 4 + 0] = 1.0;
    skinWeight[i * 4 + 1] = 0.0;
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function buildSkinnedSphere(params: {
  rx: number;
  ry: number;
  rz: number;
  cx: number;
  cy: number;
  cz: number;
  boneIdx: number;
  colorHex: number;
}): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 14, 12);
  geo.scale(params.rx, params.ry, params.rz);
  geo.translate(params.cx, params.cy, params.cz);

  const count = geo.attributes.position.count;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color(params.colorHex);

  for (let i = 0; i < count; i++) {
    skinIndex[i * 4 + 0] = params.boneIdx;
    skinWeight[i * 4 + 0] = 1.0;
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export class TitanRigBuilder {
  /**
   * Builds a 26-bone rigged Titan SkinnedMesh normalized to 2.0m base height,
   * then scaled by `heightMeters / 2.0` on `scaleGroup` so any height (5m - 15m) works seamlessly.
   */
  public static buildTitanRig(
    variant: TitanVariant,
    heightMeters: number
  ): TitanRigAssets {
    const rootGroup = new THREE.Group();
    const scaleGroup = new THREE.Group();
    const scaleFactor = heightMeters / 2.0;
    scaleGroup.scale.setScalar(scaleFactor);
    rootGroup.add(scaleGroup);

    const bones: THREE.Bone[] = [];
    const bonesByName: Record<string, THREE.Bone> = {};

    const addBone = (
      name: string,
      parent: THREE.Bone | null,
      x: number,
      y: number,
      z: number
    ): number => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, z);
      if (parent) parent.add(b);
      const idx = bones.length;
      bones.push(b);
      bonesByName[name] = b;
      return idx;
    };

    const iRoot = addBone('Root', null, 0, 0, 0);
    const iHips = addBone('Hips', bones[iRoot], 0, 1.0, 0);
    const iSpine = addBone('Spine', bones[iHips], 0, 0.16, 0);
    const iSpine1 = addBone('Spine1', bones[iSpine], 0, 0.2, 0);
    const iChest = addBone('Chest', bones[iSpine1], 0, 0.22, 0);
    const iNeck = addBone('Neck', bones[iChest], 0, 0.16, 0);
    const iHead = addBone('Head', bones[iNeck], 0, 0.12, 0.02);
    const iJaw = addBone('Jaw', bones[iHead], 0, -0.05, 0.06);

    const iLShoulder = addBone('LeftShoulder', bones[iChest], -0.14, 0.14, 0);
    const iLUpperArm = addBone('LeftUpperArm', bones[iLShoulder], -0.14, 0, 0);
    const iLLowerArm = addBone('LeftLowerArm', bones[iLUpperArm], 0, -0.34, 0);
    const iLHand = addBone('LeftHand', bones[iLLowerArm], 0, -0.32, 0);

    const iRShoulder = addBone('RightShoulder', bones[iChest], 0.14, 0.14, 0);
    const iRUpperArm = addBone('RightUpperArm', bones[iRShoulder], 0.14, 0, 0);
    const iRLowerArm = addBone('RightLowerArm', bones[iRUpperArm], 0, -0.34, 0);
    const iRHand = addBone('RightHand', bones[iRLowerArm], 0, -0.32, 0);

    const iLUpperLeg = addBone('LeftUpperLeg', bones[iHips], -0.14, -0.04, 0);
    const iLLowerLeg = addBone('LeftLowerLeg', bones[iLUpperLeg], 0, -0.48, 0);
    const iLFoot = addBone('LeftFoot', bones[iLLowerLeg], 0, -0.44, 0);

    const iRUpperLeg = addBone('RightUpperLeg', bones[iHips], 0.14, -0.04, 0);
    const iRLowerLeg = addBone('RightLowerLeg', bones[iRUpperLeg], 0, -0.48, 0);
    const iRFoot = addBone('RightFoot', bones[iRLowerLeg], 0, -0.44, 0);

    bones[iRoot].updateMatrixWorld(true);

    // Palette based on Titan variant
    const skinPrimary =
      variant === 'large'
        ? 0xa83832 // Exposed crimson muscle Colossal style
        : variant === 'abnormal'
          ? 0xc99c84 // Pale erratic flesh tone
          : 0xd6a689; // Classic Titan flesh tone
    const skinSecondary =
      variant === 'large'
        ? 0xd48c70 // Sinew/bone plates
        : variant === 'abnormal'
          ? 0x9e6b56
          : 0xb88267;
    const hairColor = variant === 'large' ? 0x6e1f1c : 0x2a211d;

    const bulk = variant === 'large' ? 1.24 : variant === 'abnormal' ? 0.94 : 1.05;

    const parts: THREE.BufferGeometry[] = [
      // Pelvis
      buildSkinnedPart({
        rTop: 0.19 * bulk,
        rBot: 0.18 * bulk,
        len: 0.22,
        oy: 1.02,
        boneA: iHips,
        boneB: iSpine,
        colorHex: skinSecondary,
      }),
      // Abdomen
      buildSkinnedPart({
        rTop: 0.21 * bulk,
        rBot: 0.18 * bulk,
        len: 0.24,
        oy: 1.22,
        boneA: iSpine,
        boneB: iSpine1,
        colorHex: skinPrimary,
      }),
      // Broad Muscular Chest & Ribcage
      buildSkinnedPart({
        rTop: 0.27 * bulk,
        rBot: 0.21 * bulk,
        len: 0.34,
        oy: 1.5,
        boneA: iSpine1,
        boneB: iChest,
        colorHex: skinPrimary,
      }),
      // Pectoral Muscle Plates
      buildSkinnedSphere({
        rx: 0.13 * bulk,
        ry: 0.09,
        rz: 0.11 * bulk,
        cx: -0.1 * bulk,
        cy: 1.55,
        cz: 0.12 * bulk,
        boneIdx: iChest,
        colorHex: skinSecondary,
      }),
      buildSkinnedSphere({
        rx: 0.13 * bulk,
        ry: 0.09,
        rz: 0.11 * bulk,
        cx: 0.1 * bulk,
        cy: 1.55,
        cz: 0.12 * bulk,
        boneIdx: iChest,
        colorHex: skinSecondary,
      }),
      // Neck (contains Nape on posterior side)
      buildSkinnedPart({
        rTop: 0.09 * bulk,
        rBot: 0.11 * bulk,
        len: 0.18,
        oy: 1.74,
        boneA: iNeck,
        boneB: iHead,
        colorHex: skinSecondary,
      }),
      // Uncanny Titan Head & Jaw
      buildSkinnedSphere({
        rx: 0.145,
        ry: 0.165,
        rz: 0.155,
        cx: 0,
        cy: 1.9,
        cz: 0.02,
        boneIdx: iHead,
        colorHex: skinPrimary,
      }),
      buildSkinnedSphere({
        rx: 0.12,
        ry: 0.07,
        rz: 0.12,
        cx: 0,
        cy: 1.81,
        cz: 0.05,
        boneIdx: iJaw,
        colorHex: 0xe6dcd2, // Unsettling exposed teeth/jawline
      }),
      buildSkinnedSphere({
        rx: 0.152,
        ry: 0.12,
        rz: 0.16,
        cx: 0,
        cy: 1.95,
        cz: -0.01,
        boneIdx: iHead,
        colorHex: hairColor,
      }),

      // Left Arm
      buildSkinnedSphere({
        rx: 0.11 * bulk,
        ry: 0.11 * bulk,
        rz: 0.11 * bulk,
        cx: -0.28,
        cy: 1.66,
        cz: 0,
        boneIdx: iLShoulder,
        colorHex: skinSecondary,
      }),
      buildSkinnedPart({
        rTop: 0.088 * bulk,
        rBot: 0.072 * bulk,
        len: 0.34,
        ox: -0.28,
        oy: 1.49,
        boneA: iLUpperArm,
        boneB: iLLowerArm,
        colorHex: skinPrimary,
      }),
      buildSkinnedPart({
        rTop: 0.072 * bulk,
        rBot: 0.058 * bulk,
        len: 0.32,
        ox: -0.28,
        oy: 1.16,
        boneA: iLLowerArm,
        boneB: iLHand,
        colorHex: skinPrimary,
      }),
      buildSkinnedSphere({
        rx: 0.068 * bulk,
        ry: 0.085 * bulk,
        rz: 0.055 * bulk,
        cx: -0.28,
        cy: 0.96,
        cz: 0,
        boneIdx: iLHand,
        colorHex: skinSecondary,
      }),

      // Right Arm
      buildSkinnedSphere({
        rx: 0.11 * bulk,
        ry: 0.11 * bulk,
        rz: 0.11 * bulk,
        cx: 0.28,
        cy: 1.66,
        cz: 0,
        boneIdx: iRShoulder,
        colorHex: skinSecondary,
      }),
      buildSkinnedPart({
        rTop: 0.088 * bulk,
        rBot: 0.072 * bulk,
        len: 0.34,
        ox: 0.28,
        oy: 1.49,
        boneA: iRUpperArm,
        boneB: iRLowerArm,
        colorHex: skinPrimary,
      }),
      buildSkinnedPart({
        rTop: 0.072 * bulk,
        rBot: 0.058 * bulk,
        len: 0.32,
        ox: 0.28,
        oy: 1.16,
        boneA: iRLowerArm,
        boneB: iRHand,
        colorHex: skinPrimary,
      }),
      buildSkinnedSphere({
        rx: 0.068 * bulk,
        ry: 0.085 * bulk,
        rz: 0.055 * bulk,
        cx: 0.28,
        cy: 0.96,
        cz: 0,
        boneIdx: iRHand,
        colorHex: skinSecondary,
      }),

      // Left Leg
      buildSkinnedPart({
        rTop: 0.125 * bulk,
        rBot: 0.092 * bulk,
        len: 0.48,
        ox: -0.14,
        oy: 0.72,
        boneA: iLUpperLeg,
        boneB: iLLowerLeg,
        colorHex: skinPrimary,
      }),
      buildSkinnedPart({
        rTop: 0.092 * bulk,
        rBot: 0.068 * bulk,
        len: 0.44,
        ox: -0.14,
        oy: 0.26,
        boneA: iLLowerLeg,
        boneB: iLFoot,
        colorHex: skinSecondary,
      }),
      buildSkinnedSphere({
        rx: 0.075,
        ry: 0.055,
        rz: 0.14,
        cx: -0.14,
        cy: 0.05,
        cz: 0.05,
        boneIdx: iLFoot,
        colorHex: skinSecondary,
      }),

      // Right Leg
      buildSkinnedPart({
        rTop: 0.125 * bulk,
        rBot: 0.092 * bulk,
        len: 0.48,
        ox: 0.14,
        oy: 0.72,
        boneA: iRUpperLeg,
        boneB: iRLowerLeg,
        colorHex: skinPrimary,
      }),
      buildSkinnedPart({
        rTop: 0.092 * bulk,
        rBot: 0.068 * bulk,
        len: 0.44,
        ox: 0.14,
        oy: 0.26,
        boneA: iRLowerLeg,
        boneB: iRFoot,
        colorHex: skinSecondary,
      }),
      buildSkinnedSphere({
        rx: 0.075,
        ry: 0.055,
        rz: 0.14,
        cx: 0.14,
        cy: 0.05,
        cz: 0.05,
        boneIdx: iRFoot,
        colorHex: skinSecondary,
      }),
    ];

    const mergedGeo = mergeGeometries(parts, false);
    mergedGeo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.05,
    });

    const skinnedMesh = new THREE.SkinnedMesh(mergedGeo, mat);
    skinnedMesh.castShadow = true;
    skinnedMesh.receiveShadow = true;
    skinnedMesh.frustumCulled = false;

    const skeleton = new THREE.Skeleton(bones);
    skinnedMesh.add(bones[iRoot]);
    skinnedMesh.bind(skeleton);
    scaleGroup.add(skinnedMesh);

    // =========================================================================
    // Glowing Eyes on Head Bone
    // =========================================================================
    const eyeMat = new THREE.MeshBasicMaterial({
      color: variant === 'abnormal' ? 0xff4500 : 0xffcc33,
    });
    const eyeGeo = new THREE.SphereGeometry(0.022, 8, 8);
    [-1, 1].forEach((side) => {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(side * 0.052, 0.03, 0.14);
      bonesByName['Head'].add(eye);
    });

    // =========================================================================
    // Attach Bone-Local Anatomical Hurtbox Nodes (Nape, Head, Arms, Legs)
    // =========================================================================
    // 1. Nape Weak Point attached to posterior Neck bone (-Z local)
    const napeNode = new THREE.Object3D();
    napeNode.name = 'NapeWeakPointNode';
    napeNode.position.set(0, 0.02, -0.12 * bulk);
    bonesByName['Neck'].add(napeNode);

    // Subtle visual scar/weakpoint highlight on the back of the neck
    const napeMarkerMat = new THREE.MeshBasicMaterial({
      color: 0xff2e4c,
      transparent: true,
      opacity: 0.72,
    });
    const napeMarkerMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.15, 0.045),
      napeMarkerMat
    );
    napeNode.add(napeMarkerMesh);

    // 2. Head/Eyes node
    const headNode = new THREE.Object3D();
    headNode.position.set(0, 0.02, 0.08);
    bonesByName['Head'].add(headNode);

    // 3. Left Arm node
    const leftArmNode = new THREE.Object3D();
    leftArmNode.position.set(0, -0.14, 0);
    bonesByName['LeftLowerArm'].add(leftArmNode);

    // 4. Right Arm node
    const rightArmNode = new THREE.Object3D();
    rightArmNode.position.set(0, -0.14, 0);
    bonesByName['RightLowerArm'].add(rightArmNode);

    // 5. Left Leg Achilles node
    const leftLegNode = new THREE.Object3D();
    leftLegNode.position.set(0, -0.22, -0.03);
    bonesByName['LeftLowerLeg'].add(leftLegNode);

    // 6. Right Leg Achilles node
    const rightLegNode = new THREE.Object3D();
    rightLegNode.position.set(0, -0.22, -0.03);
    bonesByName['RightLowerLeg'].add(rightLegNode);

    const zoneNodes: Record<TitanZoneType, THREE.Object3D> = {
      Nape: napeNode,
      Head: headNode,
      LeftArm: leftArmNode,
      RightArm: rightArmNode,
      LeftLeg: leftLegNode,
      RightLeg: rightLegNode,
    };

    const animations = this.buildTitanAnimations(variant);

    return {
      rootGroup,
      scaleGroup,
      skinnedMesh,
      skeleton,
      bonesByName,
      animations,
      zoneNodes,
      napeMarkerMesh,
    };
  }

  private static quatTrack(
    boneName: string,
    times: number[],
    eulers: Array<[number, number, number]>
  ): THREE.QuaternionKeyframeTrack {
    const values: number[] = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (const [rx, ry, rz] of eulers) {
      e.set(rx, ry, rz, 'XYZ');
      q.setFromEuler(e);
      values.push(q.x, q.y, q.z, q.w);
    }
    return new THREE.QuaternionKeyframeTrack(
      `${boneName}.quaternion`,
      times,
      values
    );
  }

  private static posTrack(
    boneName: string,
    times: number[],
    positions: Array<[number, number, number]>
  ): THREE.VectorKeyframeTrack {
    const values: number[] = [];
    for (const [x, y, z] of positions) {
      values.push(x, y, z);
    }
    return new THREE.VectorKeyframeTrack(
      `${boneName}.position`,
      times,
      values
    );
  }

  private static buildTitanAnimations(
    variant: TitanVariant
  ): Map<TitanAnimName, THREE.AnimationClip> {
    const map = new Map<TitanAnimName, THREE.AnimationClip>();

    // 1. Idle
    map.set(
      'Idle',
      new THREE.AnimationClip('Idle', 2.4, [
        this.quatTrack('Spine', [0, 1.2, 2.4], [
          [0.08, 0, 0.03],
          [0.14, 0, -0.03],
          [0.08, 0, 0.03],
        ]),
        this.quatTrack('Head', [0, 1.2, 2.4], [
          [0.05, 0.14, 0.06],
          [-0.04, -0.14, -0.06],
          [0.05, 0.14, 0.06],
        ]),
        this.quatTrack('LeftUpperArm', [0, 1.2, 2.4], [
          [0.12, 0, 0.15],
          [0.2, 0, 0.2],
          [0.12, 0, 0.15],
        ]),
        this.quatTrack('RightUpperArm', [0, 1.2, 2.4], [
          [0.12, 0, -0.15],
          [0.2, 0, -0.2],
          [0.12, 0, -0.15],
        ]),
      ])
    );

    // 2. Walk (heavy lumbering gait)
    map.set(
      'Walk',
      new THREE.AnimationClip('Walk', 1.4, [
        this.posTrack('Hips', [0, 0.35, 0.7, 1.05, 1.4], [
          [0, 0.98, 0],
          [0, 1.03, 0],
          [0, 0.98, 0],
          [0, 1.03, 0],
          [0, 0.98, 0],
        ]),
        this.quatTrack('Spine', [0, 0.7, 1.4], [
          [0.14, -0.08, -0.06],
          [0.14, 0.08, 0.06],
          [0.14, -0.08, -0.06],
        ]),
        this.quatTrack('LeftUpperLeg', [0, 0.7, 1.4], [
          [-0.5, 0, 0],
          [0.45, 0, 0],
          [-0.5, 0, 0],
        ]),
        this.quatTrack('LeftLowerLeg', [0, 0.35, 0.7, 1.4], [
          [0.15, 0, 0],
          [0.65, 0, 0],
          [0.1, 0, 0],
          [0.15, 0, 0],
        ]),
        this.quatTrack('RightUpperLeg', [0, 0.7, 1.4], [
          [0.45, 0, 0],
          [-0.5, 0, 0],
          [0.45, 0, 0],
        ]),
        this.quatTrack('RightLowerLeg', [0, 0.7, 1.05, 1.4], [
          [0.1, 0, 0],
          [0.15, 0, 0],
          [0.65, 0, 0],
          [0.1, 0, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.7, 1.4], [
          [0.35, 0, 0.14],
          [-0.35, 0, 0.14],
          [0.35, 0, 0.14],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.7, 1.4], [
          [-0.35, 0, -0.14],
          [0.35, 0, -0.14],
          [-0.35, 0, -0.14],
        ]),
      ])
    );

    // 3. Run (Abnormal Titans run with wild outstretched/flailing arms!)
    const abnormalFlail = variant === 'abnormal';
    map.set(
      'Run',
      new THREE.AnimationClip('Run', 0.84, [
        this.posTrack('Hips', [0, 0.21, 0.42, 0.63, 0.84], [
          [0, 0.94, 0],
          [0, 1.05, 0],
          [0, 0.94, 0],
          [0, 1.05, 0],
          [0, 0.94, 0],
        ]),
        this.quatTrack('Spine', [0, 0.42, 0.84], [
          [abnormalFlail ? 0.42 : 0.25, -0.14, -0.09],
          [abnormalFlail ? 0.42 : 0.25, 0.14, 0.09],
          [abnormalFlail ? 0.42 : 0.25, -0.14, -0.09],
        ]),
        this.quatTrack('LeftUpperLeg', [0, 0.42, 0.84], [
          [-0.85, 0, 0],
          [0.75, 0, 0],
          [-0.85, 0, 0],
        ]),
        this.quatTrack('LeftLowerLeg', [0, 0.21, 0.42, 0.84], [
          [0.2, 0, 0],
          [1.1, 0, 0],
          [0.15, 0, 0],
          [0.2, 0, 0],
        ]),
        this.quatTrack('RightUpperLeg', [0, 0.42, 0.84], [
          [0.75, 0, 0],
          [-0.85, 0, 0],
          [0.75, 0, 0],
        ]),
        this.quatTrack('RightLowerLeg', [0, 0.42, 0.63, 0.84], [
          [0.15, 0, 0],
          [0.2, 0, 0],
          [1.1, 0, 0],
          [0.15, 0, 0],
        ]),
        this.quatTrack(
          'LeftUpperArm',
          [0, 0.42, 0.84],
          abnormalFlail
            ? [
                [0.85, 0, 1.15],
                [0.45, 0, 1.35],
                [0.85, 0, 1.15],
              ]
            : [
                [0.65, 0, 0.2],
                [-0.65, 0, 0.2],
                [0.65, 0, 0.2],
              ]
        ),
        this.quatTrack(
          'RightUpperArm',
          [0, 0.42, 0.84],
          abnormalFlail
            ? [
                [0.45, 0, -1.35],
                [0.85, 0, -1.15],
                [0.45, 0, -1.35],
              ]
            : [
                [-0.65, 0, -0.2],
                [0.65, 0, -0.2],
                [-0.65, 0, -0.2],
              ]
        ),
      ])
    );

    // 4. Turn
    map.set(
      'Turn',
      new THREE.AnimationClip('Turn', 0.8, [
        this.quatTrack('Spine', [0, 0.4, 0.8], [
          [0.1, 0, 0],
          [0.14, 0.28, 0],
          [0.1, 0, 0],
        ]),
        this.quatTrack('LeftUpperLeg', [0, 0.4, 0.8], [
          [0, 0, 0],
          [-0.35, 0, 0],
          [0, 0, 0],
        ]),
      ])
    );

    // 5. Attack (Heavy Right/Dual Arm Smash Sweep)
    map.set(
      'Attack',
      new THREE.AnimationClip('Attack', 1.25, [
        this.quatTrack('Spine', [0, 0.45, 0.78, 1.25], [
          [0.1, 0, 0],
          [-0.25, -0.45, 0],
          [0.55, 0.55, 0],
          [0.1, 0, 0],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.45, 0.78, 1.25], [
          [0.1, 0, -0.15],
          [-2.15, -0.3, -0.55],
          [-0.35, 0.85, -0.2],
          [0.1, 0, -0.15],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.45, 0.78, 1.25], [
          [0.1, 0, 0.15],
          [-1.65, 0.2, 0.45],
          [-0.35, -0.55, 0.2],
          [0.1, 0, 0.15],
        ]),
      ])
    );

    // 6. Grab (Anti-air dual-hand lunging snatch)
    map.set(
      'Grab',
      new THREE.AnimationClip('Grab', 1.15, [
        this.quatTrack('Spine', [0, 0.4, 0.72, 1.15], [
          [0.1, 0, 0],
          [-0.2, 0, 0],
          [0.35, 0, 0],
          [0.1, 0, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.4, 0.72, 1.15], [
          [0.1, 0, 0.2],
          [-1.4, -0.5, 0.8],
          [-1.35, 0.45, 0.1],
          [0.1, 0, 0.2],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.4, 0.72, 1.15], [
          [0.1, 0, -0.2],
          [-1.4, 0.5, -0.8],
          [-1.35, -0.45, -0.1],
          [0.1, 0, -0.2],
        ]),
      ])
    );

    // 7. Stagger / Stunned (holding face / reeling back when eyes or arms struck)
    map.set(
      'Stagger',
      new THREE.AnimationClip('Stagger', 1.2, [
        this.quatTrack('Spine', [0, 0.35, 0.8, 1.2], [
          [0.1, 0, 0],
          [-0.38, 0.15, 0.12],
          [-0.25, -0.15, -0.12],
          [0.1, 0, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.4, 0.9, 1.2], [
          [0.1, 0, 0.2],
          [-1.8, 0.4, 0.2],
          [-1.7, 0.3, 0.2],
          [0.1, 0, 0.2],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.4, 0.9, 1.2], [
          [0.1, 0, -0.2],
          [-1.8, -0.4, -0.2],
          [-1.7, -0.3, -0.2],
          [0.1, 0, -0.2],
        ]),
      ])
    );

    // 8. Injured (Collapsed on knees / hunched low after leg Achilles tendon is severed!)
    map.set(
      'Injured',
      new THREE.AnimationClip('Injured', 1.6, [
        this.posTrack('Hips', [0, 0.8, 1.6], [
          [0, 0.86, 0],
          [0, 0.83, 0],
          [0, 0.86, 0],
        ]),
        this.quatTrack('Spine', [0, 0.8, 1.6], [
          [0.58, 0, 0],
          [0.64, 0, 0],
          [0.58, 0, 0],
        ]),
        this.quatTrack('LeftUpperLeg', [0, 1.6], [
          [-0.45, 0, 0],
          [-0.45, 0, 0],
        ]),
        this.quatTrack('LeftLowerLeg', [0, 1.6], [
          [0.65, 0, 0],
          [0.65, 0, 0],
        ]),
        this.quatTrack('RightUpperLeg', [0, 1.6], [
          [-0.45, 0, 0],
          [-0.45, 0, 0],
        ]),
        this.quatTrack('RightLowerLeg', [0, 1.6], [
          [0.65, 0, 0],
          [0.65, 0, 0],
        ]),
      ])
    );

    // 9. Fall
    map.set(
      'Fall',
      new THREE.AnimationClip('Fall', 0.9, [
        this.posTrack('Hips', [0, 0.5, 0.9], [
          [0, 1.0, 0],
          [0, 0.55, 0.15],
          [0, 0.22, 0.45],
        ]),
        this.quatTrack('Hips', [0, 0.5, 0.9], [
          [0, 0, 0],
          [0.75, 0, 0],
          [1.48, 0, 0],
        ]),
      ])
    );

    // 10. Death (Face-forward heavy collapse with evaporating steam)
    map.set(
      'Death',
      new THREE.AnimationClip('Death', 1.2, [
        this.posTrack('Hips', [0, 0.5, 1.2], [
          [0, 0.98, 0],
          [0, 0.52, 0.2],
          [0, 0.18, 0.55],
        ]),
        this.quatTrack('Hips', [0, 0.5, 1.2], [
          [0, 0, 0],
          [0.65, 0, 0],
          [1.52, 0, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 1.2], [
          [0.1, 0, 0.2],
          [-0.4, 0, 1.2],
        ]),
        this.quatTrack('RightUpperArm', [0, 1.2], [
          [0.1, 0, -0.2],
          [-0.4, 0, -1.2],
        ]),
      ])
    );

    return map;
  }
}
