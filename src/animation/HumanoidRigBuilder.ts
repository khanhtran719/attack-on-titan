import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type PlayerAnimName =
  | 'Idle'
  | 'Walk'
  | 'Run'
  | 'Sprint'
  | 'Jump'
  | 'Fall'
  | 'Landing'
  | 'AirborneIdle'
  | 'LeftHook'
  | 'RightHook'
  | 'DualHook'
  | 'Swing'
  | 'Boost'
  | 'Dodge'
  | 'LightAttack'
  | 'HeavyAttack'
  | 'HitReaction'
  | 'Death';

export interface PlayerRigAssets {
  rootGroup: THREE.Group;
  skinnedMesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
  bonesByName: Record<string, THREE.Bone>;
  animations: Map<PlayerAnimName, THREE.AnimationClip>;
  leftWinchNode: THREE.Object3D;
  rightWinchNode: THREE.Object3D;
  thrusterNozzleNode: THREE.Object3D;
  leftSwordGroup: THREE.Group;
  rightSwordGroup: THREE.Group;
  leftBladeMesh: THREE.Mesh;
  rightBladeMesh: THREE.Mesh;
  leftSwordHilt: THREE.Object3D;
  leftSwordTip: THREE.Object3D;
  rightSwordHilt: THREE.Object3D;
  rightSwordTip: THREE.Object3D;
}

type BodyMatKey = 'skin' | 'cloth' | 'jacket' | 'leather' | 'hair' | 'eye' | 'cape';

interface SkinCtx {
  /** Bind-pose world positions of every bone, indexed like the skeleton. */
  bonePos: THREE.Vector3[];
}

/**
 * Assigns skin indices/weights + vertex colors to a bind-pose geometry.
 * When boneB is given, each vertex is projected onto the boneA -> boneB segment and
 * smoothly blended into boneB around the joint, so elbows/knees/waist bend softly
 * instead of rotating as rigid blocks.
 */
function applySkin(
  geo: THREE.BufferGeometry,
  ctx: SkinCtx,
  boneA: number,
  boneB: number | null,
  colorHex: number,
  blendStart = 0.72,
  blendEnd = 1.12
): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const count = pos.count;
  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color(colorHex);

  const a = ctx.bonePos[boneA];
  const b = boneB !== null ? ctx.bonePos[boneB] : null;
  const seg = b ? new THREE.Vector3().subVectors(b, a) : null;
  const segLenSq = seg ? Math.max(1e-6, seg.lengthSq()) : 1;
  const v = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    let wB = 0;
    if (b && seg) {
      v.fromBufferAttribute(pos, i).sub(a);
      const t = v.dot(seg) / segLenSq;
      wB = THREE.MathUtils.smoothstep(t, blendStart, blendEnd);
    }
    skinIndices[i * 4 + 0] = boneA;
    skinIndices[i * 4 + 1] = boneB ?? 0;
    skinWeights[i * 4 + 0] = 1 - wB;
    skinWeights[i * 4 + 1] = wB;

    colors[i * 3 + 0] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * Tapered limb/torso segment (cylinder) skinned with a smooth 2-bone blend.
 */
function createSkinnedLimbGeometry(
  ctx: SkinCtx,
  params: {
    radiusTop: number;
    radiusBottom: number;
    length: number;
    offsetY: number;
    offsetX?: number;
    offsetZ?: number;
    scaleX?: number;
    scaleZ?: number;
    rotX?: number;
    rotZ?: number;
    boneIndexA: number;
    boneIndexB: number | null;
    colorHex: number;
    radialSegments?: number;
    heightSegments?: number;
    openEnded?: boolean;
  }
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(
    params.radiusTop,
    params.radiusBottom,
    params.length,
    params.radialSegments ?? 16,
    params.heightSegments ?? 8,
    params.openEnded ?? false
  );
  if (params.scaleX || params.scaleZ) {
    geo.scale(params.scaleX ?? 1, 1, params.scaleZ ?? 1);
  }
  if (params.rotX) geo.rotateX(params.rotX);
  if (params.rotZ) geo.rotateZ(params.rotZ);
  geo.translate(params.offsetX ?? 0, params.offsetY, params.offsetZ ?? 0);
  return applySkin(geo, ctx, params.boneIndexA, params.boneIndexB, params.colorHex);
}

function createSkinnedEllipsoidGeometry(
  ctx: SkinCtx,
  params: {
    rx: number;
    ry: number;
    rz: number;
    cx: number;
    cy: number;
    cz: number;
    boneIndex: number;
    boneIndexB?: number;
    colorHex: number;
    rotX?: number;
    rotZ?: number;
    segments?: number;
  }
): THREE.BufferGeometry {
  const segs = params.segments ?? 16;
  const geo = new THREE.SphereGeometry(1, segs, Math.max(8, Math.round(segs * 0.75)));
  geo.scale(params.rx, params.ry, params.rz);
  if (params.rotX) geo.rotateX(params.rotX);
  if (params.rotZ) geo.rotateZ(params.rotZ);
  geo.translate(params.cx, params.cy, params.cz);
  return applySkin(geo, ctx, params.boneIndex, params.boneIndexB ?? null, params.colorHex);
}

/**
 * Rigidly skins an arbitrary pre-positioned geometry to a single bone
 * (used for hair spikes, straps, emblems and other accessories).
 */
function createSkinnedRigidGeometry(
  ctx: SkinCtx,
  geo: THREE.BufferGeometry,
  boneIndex: number,
  colorHex: number
): THREE.BufferGeometry {
  return applySkin(geo, ctx, boneIndex, null, colorHex);
}

export class HumanoidRigBuilder {
  public static buildPlayerRig(): PlayerRigAssets {
    const rootGroup = new THREE.Group();
    rootGroup.name = 'VanguardStriderRoot';

    // =========================================================================
    // 1. Construct 32-Bone Humanoid Skeleton
    // =========================================================================
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
    const iHips = addBone('Hips', bones[iRoot], 0, 0.96, 0);
    const iSpine = addBone('Spine', bones[iHips], 0, 0.14, 0);
    const iSpine1 = addBone('Spine1', bones[iSpine], 0, 0.16, 0);
    const iChest = addBone('Chest', bones[iSpine1], 0, 0.16, 0);
    const iNeck = addBone('Neck', bones[iChest], 0, 0.16, 0);
    const iHead = addBone('Head', bones[iNeck], 0, 0.1, 0);
    const iHairBack = addBone('HairBack', bones[iHead], 0, 0.08, -0.08);

    // 3-Bone Scout Cloak/Cape chain
    const iCapeTop = addBone('CapeTop', bones[iChest], 0, 0.12, -0.11);
    const iCapeMid = addBone('CapeMid', bones[iCapeTop], 0, -0.28, -0.04);
    const iCapeTip = addBone('CapeTip', bones[iCapeMid], 0, -0.32, -0.04);

    // Left Arm chain
    const iLShoulder = addBone('LeftShoulder', bones[iChest], -0.1, 0.11, 0);
    const iLUpperArm = addBone('LeftUpperArm', bones[iLShoulder], -0.09, 0, 0);
    const iLLowerArm = addBone('LeftLowerArm', bones[iLUpperArm], 0, -0.27, 0);
    const iLHand = addBone('LeftHand', bones[iLLowerArm], 0, -0.25, 0);
    const iLThumb = addBone('LeftThumb', bones[iLHand], -0.03, -0.04, 0.03);
    const iLFingers = addBone('LeftFingers', bones[iLHand], 0, -0.07, 0);

    // Right Arm chain
    const iRShoulder = addBone('RightShoulder', bones[iChest], 0.1, 0.11, 0);
    const iRUpperArm = addBone('RightUpperArm', bones[iRShoulder], 0.09, 0, 0);
    const iRLowerArm = addBone('RightLowerArm', bones[iRUpperArm], 0, -0.27, 0);
    const iRHand = addBone('RightHand', bones[iRLowerArm], 0, -0.25, 0);
    const iRThumb = addBone('RightThumb', bones[iRHand], 0.03, -0.04, 0.03);
    const iRFingers = addBone('RightFingers', bones[iRHand], 0, -0.07, 0);

    // Left Leg chain
    const iLUpperLeg = addBone('LeftUpperLeg', bones[iHips], -0.11, -0.04, 0);
    const iLLowerLeg = addBone('LeftLowerLeg', bones[iLUpperLeg], 0, -0.44, 0);
    const iLFoot = addBone('LeftFoot', bones[iLLowerLeg], 0, -0.42, 0);
    const iLToe = addBone('LeftToe', bones[iLFoot], 0, -0.05, 0.12);

    // Right Leg chain
    const iRUpperLeg = addBone('RightUpperLeg', bones[iHips], 0.11, -0.04, 0);
    const iRLowerLeg = addBone('RightLowerLeg', bones[iRUpperLeg], 0, -0.44, 0);
    const iRFoot = addBone('RightFoot', bones[iRLowerLeg], 0, -0.42, 0);
    const iRToe = addBone('RightToe', bones[iRFoot], 0, -0.05, 0.12);

    // ODM Gear mount bone
    const iODM = addBone('ODMThruster', bones[iHips], 0, 0.04, -0.14);

    // Update world matrices of bones in bind pose
    bones[iRoot].updateMatrixWorld(true);

    // =========================================================================
    // 2. Build Unified Anatomical SkinnedMesh Geometry (Bind-Pose World Coords)
    // =========================================================================
    const colTrousers = 0xe8e4dc; // White/cream military breeches
    const colBoots = 0x3b2618;    // Dark leather riding boots & harness
    const colStrap = 0x2a1b12;    // Darker harness straps
    const colBuckle = 0xb8925a;   // Brass buckles
    const colJacket = 0x7c4d32;   // Cropped amber-brown scout jacket
    const colShirt = 0x263240;    // Dark slate inner tunic
    const colCape = 0x1e4d38;     // Deep hunter-green Vanguard cloak
    const colSkin = 0xf4ccb0;     // Warm anime skin tone
    const colLip = 0xc98a7c;
    const colHair = 0x1d1f26;     // Raven dark hair
    const colSclera = 0xf5f2ee;
    const colIris = 0x2f5d7c;     // Steel-blue eyes
    const colEmblemW = 0xf1f5f9;
    const colEmblemB = 0x1e3a8a;

    const ctx: SkinCtx = {
      bonePos: bones.map((b) => b.getWorldPosition(new THREE.Vector3())),
    };

    const parts: Array<{ geo: THREE.BufferGeometry; mat: BodyMatKey }> = [];
    const add = (mat: BodyMatKey, geo: THREE.BufferGeometry) => parts.push({ geo, mat });
    const limb = (mat: BodyMatKey, p: Parameters<typeof createSkinnedLimbGeometry>[1]) =>
      add(mat, createSkinnedLimbGeometry(ctx, p));
    const ellip = (mat: BodyMatKey, p: Parameters<typeof createSkinnedEllipsoidGeometry>[1]) =>
      add(mat, createSkinnedEllipsoidGeometry(ctx, p));
    const rigid = (
      mat: BodyMatKey,
      geo: THREE.BufferGeometry,
      bone: number,
      color: number,
      place: (g: THREE.BufferGeometry) => void
    ) => {
      place(geo);
      add(mat, createSkinnedRigidGeometry(ctx, geo, bone, color));
    };

    // ---------------- Torso ----------------
    // Pelvis & Hips
    limb('cloth', {
      radiusTop: 0.132, radiusBottom: 0.142, length: 0.2, offsetY: 0.97, scaleZ: 0.82,
      boneIndexA: iHips, boneIndexB: iSpine, colorHex: colTrousers,
    });
    // Waist / inner tunic
    limb('cloth', {
      radiusTop: 0.128, radiusBottom: 0.13, length: 0.2, offsetY: 1.15, scaleZ: 0.78,
      boneIndexA: iSpine, boneIndexB: iSpine1, colorHex: colShirt,
    });
    // Upper torso — cropped scout jacket (broader shoulders, flatter front/back)
    limb('jacket', {
      radiusTop: 0.17, radiusBottom: 0.135, length: 0.3, offsetY: 1.37, scaleZ: 0.72,
      boneIndexA: iSpine1, boneIndexB: iChest, colorHex: colJacket,
    });
    // Chest volume / pectoral shape under jacket
    ellip('jacket', {
      rx: 0.14, ry: 0.09, rz: 0.09, cx: 0, cy: 1.44, cz: 0.02,
      boneIndex: iChest, colorHex: colJacket,
    });
    // Jacket collar (open-front ring) + shirt V
    limb('jacket', {
      radiusTop: 0.075, radiusBottom: 0.1, length: 0.06, offsetY: 1.535, scaleZ: 0.85,
      boneIndexA: iChest, boneIndexB: null, colorHex: colJacket, openEnded: true,
    });
    ellip('cloth', {
      rx: 0.05, ry: 0.07, rz: 0.02, cx: 0, cy: 1.46, cz: 0.1,
      boneIndex: iChest, colorHex: colShirt,
    });
    // Leather belt
    rigid('leather', new THREE.TorusGeometry(0.133, 0.018, 6, 24), iHips, colBoots, (g) => {
      g.scale(1, 0.82, 1);
      g.rotateX(Math.PI / 2);
      g.translate(0, 1.06, 0);
    });
    rigid('leather', new THREE.BoxGeometry(0.05, 0.04, 0.012), iHips, colBuckle, (g) =>
      g.translate(0, 1.06, 0.116)
    );

    // Chest harness — crossed straps front + back (signature ODM harness)
    [-1, 1].forEach((s) => {
      rigid('leather', new THREE.BoxGeometry(0.026, 0.36, 0.012), iChest, colStrap, (g) => {
        g.rotateZ(s * 0.42);
        g.translate(s * 0.045, 1.36, 0.118);
      });
      rigid('leather', new THREE.BoxGeometry(0.026, 0.36, 0.012), iChest, colStrap, (g) => {
        g.rotateZ(-s * 0.42);
        g.translate(s * 0.045, 1.36, -0.118);
      });
      // Shoulder strap over the top
      rigid('leather', new THREE.BoxGeometry(0.03, 0.012, 0.24), iChest, colStrap, (g) =>
        g.translate(s * 0.1, 1.525, 0)
      );
    });
    rigid('leather', new THREE.BoxGeometry(0.035, 0.035, 0.014), iChest, colBuckle, (g) =>
      g.translate(0, 1.36, 0.124)
    );

    // ---------------- Neck & Head ----------------
    limb('skin', {
      radiusTop: 0.052, radiusBottom: 0.062, length: 0.14, offsetY: 1.57,
      boneIndexA: iNeck, boneIndexB: iHead, colorHex: colSkin,
    });
    // Skull (slightly narrower jaw, taller cranium)
    ellip('skin', {
      rx: 0.102, ry: 0.122, rz: 0.112, cx: 0, cy: 1.695, cz: 0.01,
      boneIndex: iHead, colorHex: colSkin, segments: 20,
    });
    // Jaw / chin
    ellip('skin', {
      rx: 0.068, ry: 0.055, rz: 0.075, cx: 0, cy: 1.64, cz: 0.012,
      boneIndex: iHead, colorHex: colSkin,
    });
    // Ears
    [-1, 1].forEach((s) =>
      ellip('skin', {
        rx: 0.014, ry: 0.03, rz: 0.02, cx: s * 0.1, cy: 1.69, cz: 0.0,
        boneIndex: iHead, colorHex: colSkin, segments: 10,
      })
    );
    // Nose
    ellip('skin', {
      rx: 0.012, ry: 0.022, rz: 0.014, cx: 0, cy: 1.668, cz: 0.12,
      boneIndex: iHead, colorHex: colSkin, segments: 10,
    });
    // Mouth
    ellip('skin', {
      rx: 0.02, ry: 0.0035, rz: 0.006, cx: 0, cy: 1.632, cz: 0.105,
      boneIndex: iHead, colorHex: colLip, segments: 10,
    });
    // Eyes: sclera + iris + pupil highlight, and eyebrows
    [-1, 1].forEach((s) => {
      ellip('eye', {
        rx: 0.022, ry: 0.013, rz: 0.01, cx: s * 0.038, cy: 1.697, cz: 0.108,
        boneIndex: iHead, colorHex: colSclera, segments: 12,
      });
      ellip('eye', {
        rx: 0.0105, ry: 0.012, rz: 0.006, cx: s * 0.037, cy: 1.697, cz: 0.115,
        boneIndex: iHead, colorHex: colIris, segments: 10,
      });
      ellip('eye', {
        rx: 0.005, ry: 0.006, rz: 0.004, cx: s * 0.037, cy: 1.697, cz: 0.119,
        boneIndex: iHead, colorHex: 0x0b0d10, segments: 8,
      });
      // Determined, slightly angled brows
      ellip('hair', {
        rx: 0.026, ry: 0.0055, rz: 0.008, cx: s * 0.04, cy: 1.725, cz: 0.108,
        boneIndex: iHead, colorHex: colHair, rotZ: s * 0.18, segments: 8,
      });
    });

    // ---------------- Hair (anime spiky cut, face left visible) ----------------
    // Cap pushed up/back so it frames the face instead of covering it
    ellip('hair', {
      rx: 0.112, ry: 0.098, rz: 0.122, cx: 0, cy: 1.758, cz: -0.022,
      boneIndex: iHead, colorHex: colHair, segments: 18,
    });
    // Back volume / undercut
    ellip('hair', {
      rx: 0.1, ry: 0.09, rz: 0.07, cx: 0, cy: 1.69, cz: -0.065,
      boneIndex: iHead, colorHex: colHair,
    });
    // Front bangs — downward spikes over forehead
    const bangs: Array<[number, number, number]> = [
      [-0.07, 0.25, 0.08], [-0.035, 0.12, 0.095], [0.0, -0.05, 0.1],
      [0.035, -0.15, 0.095], [0.07, -0.28, 0.08],
    ];
    for (const [x, tilt, z] of bangs) {
      rigid('hair', new THREE.ConeGeometry(0.026, 0.085, 6), iHead, colHair, (g) => {
        g.rotateX(Math.PI); // point down
        g.rotateX(-0.35);   // sweep tip forward
        g.rotateZ(tilt);
        g.translate(x, 1.752, z);
      });
    }
    // Side locks covering upper ears
    [-1, 1].forEach((s) =>
      rigid('hair', new THREE.ConeGeometry(0.03, 0.1, 6), iHead, colHair, (g) => {
        g.rotateX(Math.PI);
        g.rotateZ(-s * 0.15);
        g.translate(s * 0.098, 1.705, 0.03);
      })
    );
    // Crown & back spikes, swept backward
    const spikes: Array<[number, number, number, number]> = [
      [0, 1.84, -0.04, -0.9], [-0.06, 1.82, -0.06, -1.15], [0.06, 1.82, -0.06, -1.15],
      [-0.04, 1.77, -0.11, -1.7], [0.04, 1.77, -0.11, -1.7], [0, 1.72, -0.12, -2.1],
    ];
    for (const [x, y, z, rx] of spikes) {
      rigid('hair', new THREE.ConeGeometry(0.035, 0.11, 6), iHead, colHair, (g) => {
        g.rotateX(rx);
        g.rotateZ(-x * 4);
        g.translate(x, y, z);
      });
    }

    // ---------------- Cape (Survey-style cloak with emblem) ----------------
    limb('cape', {
      radiusTop: 0.18, radiusBottom: 0.23, length: 0.32, offsetY: 1.36, offsetZ: -0.12,
      scaleZ: 0.14, boneIndexA: iCapeTop, boneIndexB: iCapeMid, colorHex: colCape,
    });
    limb('cape', {
      radiusTop: 0.23, radiusBottom: 0.28, length: 0.32, offsetY: 1.06, offsetZ: -0.15,
      scaleZ: 0.13, boneIndexA: iCapeMid, boneIndexB: iCapeTip, colorHex: colCape,
    });
    // Hood folded around the collar
    limb('cape', {
      radiusTop: 0.1, radiusBottom: 0.16, length: 0.07, offsetY: 1.53, offsetZ: -0.03,
      scaleZ: 0.85, boneIndexA: iCapeTop, boneIndexB: null, colorHex: colCape, openEnded: true,
    });
    // Wings-style emblem (two overlapping wing shapes, white + blue)
    rigid('cape', new THREE.CircleGeometry(0.06, 12), iCapeMid, colEmblemB, (g) => {
      g.scale(0.8, 1, 1);
      g.rotateY(Math.PI);
      g.translate(0.025, 1.3, -0.152);
    });
    rigid('cape', new THREE.CircleGeometry(0.06, 12), iCapeMid, colEmblemW, (g) => {
      g.scale(0.8, 1, 1);
      g.rotateY(Math.PI);
      g.translate(-0.025, 1.3, -0.153);
    });

    // ---------------- Arms ----------------
    // Bone world refs: Shoulder y=1.53, UpperArm x=±0.19, LowerArm y=1.26, Hand y=1.01
    [-1, 1].forEach((s) => {
      const isL = s < 0;
      const shoulder = isL ? iLShoulder : iRShoulder;
      const upper = isL ? iLUpperArm : iRUpperArm;
      const lower = isL ? iLLowerArm : iRLowerArm;
      const hand = isL ? iLHand : iRHand;
      const fingers = isL ? iLFingers : iRFingers;
      const thumb = isL ? iLThumb : iRThumb;
      const x = s * 0.19;

      // Deltoid
      ellip('jacket', {
        rx: 0.064, ry: 0.062, rz: 0.064, cx: s * 0.185, cy: 1.52, cz: 0,
        boneIndex: shoulder, boneIndexB: upper, colorHex: colJacket,
      });
      // Upper arm aligned to bone span 1.53 -> 1.26
      limb('jacket', {
        radiusTop: 0.056, radiusBottom: 0.046, length: 0.29, offsetX: x, offsetY: 1.39,
        boneIndexA: upper, boneIndexB: lower, colorHex: colJacket,
      });
      // Elbow cap fills gap when bending
      ellip('jacket', {
        rx: 0.047, ry: 0.047, rz: 0.047, cx: x, cy: 1.26, cz: 0,
        boneIndex: lower, colorHex: colJacket, segments: 12,
      });
      // Forearm aligned to 1.26 -> 1.01
      limb('jacket', {
        radiusTop: 0.046, radiusBottom: 0.036, length: 0.24, offsetX: x, offsetY: 1.135,
        boneIndexA: lower, boneIndexB: hand, colorHex: colJacket,
      });
      // Leather cuff / bracer
      limb('leather', {
        radiusTop: 0.04, radiusBottom: 0.039, length: 0.06, offsetX: x, offsetY: 1.04,
        boneIndexA: lower, boneIndexB: null, colorHex: colBoots,
      });
      // Palm + fingers + thumb (gloved grip)
      ellip('skin', {
        rx: 0.034, ry: 0.042, rz: 0.024, cx: x, cy: 0.975, cz: 0.005,
        boneIndex: hand, colorHex: colSkin, segments: 12,
      });
      ellip('skin', {
        rx: 0.03, ry: 0.035, rz: 0.022, cx: x, cy: 0.925, cz: 0.012,
        boneIndex: fingers, colorHex: colSkin, segments: 10,
      });
      ellip('skin', {
        rx: 0.012, ry: 0.026, rz: 0.012, cx: x + s * 0.032, cy: 0.96, cz: 0.02,
        boneIndex: thumb, colorHex: colSkin, segments: 8, rotZ: -s * 0.4,
      });
    });

    // ---------------- Legs ----------------
    // Bone world refs: UpperLeg y=0.92, LowerLeg y=0.48, Foot y=0.06
    [-1, 1].forEach((s) => {
      const isL = s < 0;
      const upper = isL ? iLUpperLeg : iRUpperLeg;
      const lower = isL ? iLLowerLeg : iRLowerLeg;
      const foot = isL ? iLFoot : iRFoot;
      const toe = isL ? iLToe : iRToe;
      const x = s * 0.11;

      // Thigh — loose riding breeches (slight flare)
      limb('cloth', {
        radiusTop: 0.085, radiusBottom: 0.06, length: 0.46, offsetX: x, offsetY: 0.7,
        boneIndexA: upper, boneIndexB: lower, colorHex: colTrousers,
      });
      // Thigh harness straps (two rings + vertical connector)
      [0.82, 0.62].forEach((y, k) =>
        rigid('leather', new THREE.TorusGeometry(k === 0 ? 0.086 : 0.072, 0.0075, 5, 20), upper, colStrap, (g) => {
          g.rotateX(Math.PI / 2);
          g.translate(x + s * 0.005, y, 0);
        })
      );
      rigid('leather', new THREE.BoxGeometry(0.012, 0.22, 0.02), upper, colStrap, (g) =>
        g.translate(x + s * 0.08, 0.72, 0)
      );
      // Knee
      ellip('leather', {
        rx: 0.06, ry: 0.06, rz: 0.06, cx: x, cy: 0.48, cz: 0.005,
        boneIndex: lower, colorHex: colBoots, segments: 12,
      });
      // Tall riding boot (shin) with calf curve
      limb('leather', {
        radiusTop: 0.064, radiusBottom: 0.047, length: 0.42, offsetX: x, offsetY: 0.27,
        boneIndexA: lower, boneIndexB: foot, colorHex: colBoots,
      });
      ellip('leather', {
        rx: 0.055, ry: 0.11, rz: 0.055, cx: x, cy: 0.36, cz: -0.015,
        boneIndex: lower, colorHex: colBoots, segments: 12,
      });
      // Boot cuff
      limb('leather', {
        radiusTop: 0.07, radiusBottom: 0.066, length: 0.04, offsetX: x, offsetY: 0.47,
        boneIndexA: lower, boneIndexB: null, colorHex: colStrap,
      });
      // Foot (heel) + toe cap
      ellip('leather', {
        rx: 0.052, ry: 0.045, rz: 0.08, cx: x, cy: 0.05, cz: 0.0,
        boneIndex: foot, colorHex: colBoots,
      });
      ellip('leather', {
        rx: 0.048, ry: 0.035, rz: 0.07, cx: x, cy: 0.035, cz: 0.1,
        boneIndex: toe, colorHex: colBoots,
      });
    });

    // Merge all parts with one draw group per part, then collapse to material slots
    const matOrder: BodyMatKey[] = ['skin', 'cloth', 'jacket', 'leather', 'hair', 'eye', 'cape'];
    const mergedBodyGeo = mergeGeometries(parts.map((p) => p.geo), true);
    mergedBodyGeo.computeVertexNormals();
    mergedBodyGeo.groups.forEach((grp, i) => {
      grp.materialIndex = matOrder.indexOf(parts[i].mat);
    });

    const matSettings: Record<BodyMatKey, THREE.MeshStandardMaterialParameters> = {
      skin: { roughness: 0.55, metalness: 0.0 },
      cloth: { roughness: 0.9, metalness: 0.0 },
      jacket: { roughness: 0.78, metalness: 0.0 },
      leather: { roughness: 0.48, metalness: 0.05 },
      hair: { roughness: 0.45, metalness: 0.0 },
      eye: { roughness: 0.15, metalness: 0.0 },
      cape: { roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide },
    };
    const bodyMats = matOrder.map(
      (k) => new THREE.MeshStandardMaterial({ vertexColors: true, ...matSettings[k] })
    );

    const skinnedMesh = new THREE.SkinnedMesh(mergedBodyGeo, bodyMats);
    skinnedMesh.name = 'VanguardStriderMesh';
    skinnedMesh.castShadow = true;
    skinnedMesh.receiveShadow = true;
    skinnedMesh.frustumCulled = false;

    const skeleton = new THREE.Skeleton(bones);
    skinnedMesh.add(bones[iRoot]);
    skinnedMesh.bind(skeleton);
    rootGroup.add(skinnedMesh);

    // =========================================================================
    // 3. Attach Detailed ODM Gear (Scabbards, Gas Tanks, Winches, Thruster)
    // =========================================================================
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x9ca3af,
      roughness: 0.32,
      metalness: 0.82,
    });
    const darkSteelMat = new THREE.MeshStandardMaterial({
      color: 0x272c35,
      roughness: 0.45,
      metalness: 0.7,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xd4a853,
      roughness: 0.35,
      metalness: 0.75,
    });

    const odmGroup = new THREE.Group();
    bonesByName['ODMThruster'].add(odmGroup);

    // Central Turbine & Rear Gas Manifold
    const turbine = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 0.22, 12),
      darkSteelMat
    );
    turbine.rotation.x = Math.PI / 2;
    odmGroup.add(turbine);

    const thrusterNozzleNode = new THREE.Object3D();
    thrusterNozzleNode.position.set(0, -0.02, -0.14);
    odmGroup.add(thrusterNozzleNode);

    // Left & Right Hip Scabbard Boxes + Compressed Gas Cylinders + Coiled Wire Drums
    const leftWinchNode = new THREE.Object3D();
    const rightWinchNode = new THREE.Object3D();

    [-1, 1].forEach((side) => {
      const rigSide = new THREE.Group();
      rigSide.position.set(side * 0.21, -0.08, 0.06);
      rigSide.rotation.x = 0.22;

      // Blade Scabbard Box
      const scabbard = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.16, 0.68),
        darkSteelMat
      );
      rigSide.add(scabbard);

      // Pressurized Gas Tank mounted above scabbard
      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(0.042, 0.042, 0.56, 10),
        metalMat
      );
      tank.rotation.x = Math.PI / 2;
      tank.position.set(side * 0.02, 0.11, -0.02);
      rigSide.add(tank);

      // Coiled Wire Winch Drum at front hip
      const drum = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.065, 0.06, 12),
        brassMat
      );
      drum.rotation.z = Math.PI / 2;
      drum.position.set(side * 0.03, 0.12, 0.22);
      rigSide.add(drum);

      if (side === -1) {
        leftWinchNode.position.set(-0.04, 0.12, 0.28);
        rigSide.add(leftWinchNode);
      } else {
        rightWinchNode.position.set(0.04, 0.12, 0.28);
        rigSide.add(rightWinchNode);
      }

      odmGroup.add(rigSide);
    });

    // =========================================================================
    // 4. Attach Dual High-Carbon Mono-Blades to LeftHand and RightHand Bones
    // =========================================================================
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.18,
      metalness: 0.92,
      emissive: 0x1e293b,
    });

    const buildSword = (side: 'left' | 'right') => {
      const swordGroup = new THREE.Group();
      swordGroup.name = `${side}Sword`;

      // Trigger Grip & Handguard
      const grip = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.16, 0.045),
        darkSteelMat
      );
      swordGroup.add(grip);

      const guard = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.14, 0.08),
        brassMat
      );
      guard.position.set(0, -0.02, 0.04);
      swordGroup.add(guard);

      // Segmented Ultra-Hard Steel Blade extending forward (+Z in hand frame)
      const bladeLen = 0.98;
      const bladeMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.042, bladeLen),
        bladeMat
      );
      bladeMesh.position.set(0, -0.04, bladeLen * 0.5 + 0.06);
      swordGroup.add(bladeMesh);

      const hiltNode = new THREE.Object3D();
      hiltNode.position.set(0, -0.04, 0.06);
      swordGroup.add(hiltNode);

      const tipNode = new THREE.Object3D();
      tipNode.position.set(0, -0.04, bladeLen + 0.06);
      swordGroup.add(tipNode);

      return { swordGroup, bladeMesh, hiltNode, tipNode };
    };

    const leftSword = buildSword('left');
    const rightSword = buildSword('right');
    bonesByName['LeftHand'].add(leftSword.swordGroup);
    bonesByName['RightHand'].add(rightSword.swordGroup);

    // =========================================================================
    // 5. Generate All 18 Required Skeletal Animations (AnimationClips)
    // =========================================================================
    const animations = this.buildAllAnimations();

    return {
      rootGroup,
      skinnedMesh,
      skeleton,
      bonesByName,
      animations,
      leftWinchNode,
      rightWinchNode,
      thrusterNozzleNode,
      leftSwordGroup: leftSword.swordGroup,
      rightSwordGroup: rightSword.swordGroup,
      leftBladeMesh: leftSword.bladeMesh,
      rightBladeMesh: rightSword.bladeMesh,
      leftSwordHilt: leftSword.hiltNode,
      leftSwordTip: leftSword.tipNode,
      rightSwordHilt: rightSword.hiltNode,
      rightSwordTip: rightSword.tipNode,
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

  private static buildAllAnimations(): Map<PlayerAnimName, THREE.AnimationClip> {
    const map = new Map<PlayerAnimName, THREE.AnimationClip>();

    // 1. Idle (alert combat stance with breathing and subtle cape sway)
    map.set(
      'Idle',
      new THREE.AnimationClip('Idle', 1.6, [
        this.posTrack('Hips', [0, 0.8, 1.6], [
          [0, 0.96, 0],
          [0, 0.94, 0],
          [0, 0.96, 0],
        ]),
        this.quatTrack('Spine', [0, 0.8, 1.6], [
          [0.06, 0.08, 0],
          [0.09, 0.08, 0],
          [0.06, 0.08, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.8, 1.6], [
          [0.2, 0, 0.22],
          [0.25, 0, 0.25],
          [0.2, 0, 0.22],
        ]),
        this.quatTrack('LeftLowerArm', [0, 0.8, 1.6], [
          [-0.55, 0, 0],
          [-0.6, 0, 0],
          [-0.55, 0, 0],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.8, 1.6], [
          [0.2, 0, -0.22],
          [0.25, 0, -0.25],
          [0.2, 0, -0.22],
        ]),
        this.quatTrack('RightLowerArm', [0, 0.8, 1.6], [
          [-0.55, 0, 0],
          [-0.6, 0, 0],
          [-0.55, 0, 0],
        ]),
        this.quatTrack('CapeMid', [0, 0.8, 1.6], [
          [0.08, 0, 0.03],
          [0.14, 0, -0.03],
          [0.08, 0, 0.03],
        ]),
      ])
    );

    // 2. Walk
    map.set(
      'Walk',
      new THREE.AnimationClip('Walk', 0.9, [
        this.posTrack('Hips', [0, 0.225, 0.45, 0.675, 0.9], [
          [0, 0.95, 0],
          [0, 0.98, 0],
          [0, 0.95, 0],
          [0, 0.98, 0],
          [0, 0.95, 0],
        ]),
        this.quatTrack('LeftUpperLeg', [0, 0.45, 0.9], [
          [-0.45, 0, 0],
          [0.45, 0, 0],
          [-0.45, 0, 0],
        ]),
        this.quatTrack('LeftLowerLeg', [0, 0.225, 0.45, 0.9], [
          [0.15, 0, 0],
          [0.55, 0, 0],
          [0.1, 0, 0],
          [0.15, 0, 0],
        ]),
        this.quatTrack('RightUpperLeg', [0, 0.45, 0.9], [
          [0.45, 0, 0],
          [-0.45, 0, 0],
          [0.45, 0, 0],
        ]),
        this.quatTrack('RightLowerLeg', [0, 0.45, 0.675, 0.9], [
          [0.1, 0, 0],
          [0.15, 0, 0],
          [0.55, 0, 0],
          [0.1, 0, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.45, 0.9], [
          [0.35, 0, 0.16],
          [-0.35, 0, 0.16],
          [0.35, 0, 0.16],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.45, 0.9], [
          [-0.35, 0, -0.16],
          [0.35, 0, -0.16],
          [-0.35, 0, -0.16],
        ]),
      ])
    );

    // 3. Run
    map.set(
      'Run',
      new THREE.AnimationClip('Run', 0.64, [
        this.posTrack('Hips', [0, 0.16, 0.32, 0.48, 0.64], [
          [0, 0.92, 0],
          [0, 0.99, 0],
          [0, 0.92, 0],
          [0, 0.99, 0],
          [0, 0.92, 0],
        ]),
        this.quatTrack('Spine', [0, 0.32, 0.64], [
          [0.24, -0.08, 0],
          [0.24, 0.08, 0],
          [0.24, -0.08, 0],
        ]),
        this.quatTrack('LeftUpperLeg', [0, 0.32, 0.64], [
          [-0.82, 0, 0],
          [0.72, 0, 0],
          [-0.82, 0, 0],
        ]),
        this.quatTrack('LeftLowerLeg', [0, 0.16, 0.32, 0.64], [
          [0.25, 0, 0],
          [1.1, 0, 0],
          [0.15, 0, 0],
          [0.25, 0, 0],
        ]),
        this.quatTrack('RightUpperLeg', [0, 0.32, 0.64], [
          [0.72, 0, 0],
          [-0.82, 0, 0],
          [0.72, 0, 0],
        ]),
        this.quatTrack('RightLowerLeg', [0, 0.32, 0.48, 0.64], [
          [0.15, 0, 0],
          [0.25, 0, 0],
          [1.1, 0, 0],
          [0.15, 0, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.32, 0.64], [
          [0.65, 0, 0.22],
          [-0.55, 0, 0.22],
          [0.65, 0, 0.22],
        ]),
        this.quatTrack('LeftLowerArm', [0, 0.32, 0.64], [
          [-0.85, 0, 0],
          [-0.65, 0, 0],
          [-0.85, 0, 0],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.32, 0.64], [
          [-0.55, 0, -0.22],
          [0.65, 0, -0.22],
          [-0.55, 0, -0.22],
        ]),
        this.quatTrack('RightLowerArm', [0, 0.32, 0.64], [
          [-0.65, 0, 0],
          [-0.85, 0, 0],
          [-0.65, 0, 0],
        ]),
        this.quatTrack('CapeTop', [0, 0.32, 0.64], [
          [0.45, 0, 0],
          [0.55, 0, 0],
          [0.45, 0, 0],
        ]),
      ])
    );

    // 4. Sprint
    map.set(
      'Sprint',
      new THREE.AnimationClip('Sprint', 0.48, [
        this.posTrack('Hips', [0, 0.12, 0.24, 0.36, 0.48], [
          [0, 0.89, 0],
          [0, 0.98, 0],
          [0, 0.89, 0],
          [0, 0.98, 0],
          [0, 0.89, 0],
        ]),
        this.quatTrack('Spine', [0, 0.24, 0.48], [
          [0.38, -0.12, 0],
          [0.38, 0.12, 0],
          [0.38, -0.12, 0],
        ]),
        this.quatTrack('LeftUpperLeg', [0, 0.24, 0.48], [
          [-1.05, 0, 0],
          [0.88, 0, 0],
          [-1.05, 0, 0],
        ]),
        this.quatTrack('LeftLowerLeg', [0, 0.12, 0.24, 0.48], [
          [0.3, 0, 0],
          [1.35, 0, 0],
          [0.2, 0, 0],
          [0.3, 0, 0],
        ]),
        this.quatTrack('RightUpperLeg', [0, 0.24, 0.48], [
          [0.88, 0, 0],
          [-1.05, 0, 0],
          [0.88, 0, 0],
        ]),
        this.quatTrack('RightLowerLeg', [0, 0.24, 0.36, 0.48], [
          [0.2, 0, 0],
          [0.3, 0, 0],
          [1.35, 0, 0],
          [0.2, 0, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.24, 0.48], [
          [0.75, 0, 0.32],
          [0.45, 0, 0.32],
          [0.75, 0, 0.32],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.24, 0.48], [
          [0.45, 0, -0.32],
          [0.75, 0, -0.32],
          [0.45, 0, -0.32],
        ]),
        this.quatTrack('CapeTop', [0, 0.24, 0.48], [
          [0.75, 0, 0],
          [0.88, 0, 0],
          [0.75, 0, 0],
        ]),
      ])
    );

    // 5. Jump
    map.set(
      'Jump',
      new THREE.AnimationClip('Jump', 0.45, [
        this.quatTrack('Spine', [0, 0.2, 0.45], [
          [0.25, 0, 0],
          [-0.1, 0, 0],
          [0.08, 0, 0],
        ]),
        this.quatTrack('LeftUpperLeg', [0, 0.25, 0.45], [
          [-0.3, 0, 0],
          [-0.85, 0, 0.08],
          [-0.65, 0, 0.08],
        ]),
        this.quatTrack('LeftLowerLeg', [0, 0.25, 0.45], [
          [0.4, 0, 0],
          [1.15, 0, 0],
          [0.95, 0, 0],
        ]),
        this.quatTrack('RightUpperLeg', [0, 0.25, 0.45], [
          [-0.1, 0, 0],
          [-0.55, 0, -0.08],
          [-0.45, 0, -0.08],
        ]),
        this.quatTrack('RightLowerLeg', [0, 0.25, 0.45], [
          [0.2, 0, 0],
          [0.75, 0, 0],
          [0.65, 0, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.45], [
          [0.3, 0, 0.25],
          [-0.45, 0, 0.55],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.45], [
          [0.3, 0, -0.25],
          [-0.45, 0, -0.55],
        ]),
      ])
    );

    // 6. Fall
    map.set(
      'Fall',
      new THREE.AnimationClip('Fall', 0.8, [
        this.quatTrack('Spine', [0, 0.4, 0.8], [
          [0.14, 0, 0],
          [0.22, 0, 0],
          [0.14, 0, 0],
        ]),
        this.quatTrack('LeftUpperLeg', [0, 0.4, 0.8], [
          [-0.55, 0, 0.12],
          [-0.65, 0, 0.14],
          [-0.55, 0, 0.12],
        ]),
        this.quatTrack('LeftLowerLeg', [0, 0.4, 0.8], [
          [0.85, 0, 0],
          [0.95, 0, 0],
          [0.85, 0, 0],
        ]),
        this.quatTrack('RightUpperLeg', [0, 0.4, 0.8], [
          [-0.35, 0, -0.12],
          [-0.45, 0, -0.14],
          [-0.35, 0, -0.12],
        ]),
        this.quatTrack('RightLowerLeg', [0, 0.4, 0.8], [
          [0.65, 0, 0],
          [0.75, 0, 0],
          [0.65, 0, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.4, 0.8], [
          [-0.25, 0, 0.68],
          [-0.35, 0, 0.76],
          [-0.25, 0, 0.68],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.4, 0.8], [
          [-0.25, 0, -0.68],
          [-0.35, 0, -0.76],
          [-0.25, 0, -0.68],
        ]),
        this.quatTrack('CapeTop', [0, 0.4, 0.8], [
          [0.95, 0, 0],
          [1.1, 0, 0],
          [0.95, 0, 0],
        ]),
      ])
    );

    // 7. Landing
    map.set(
      'Landing',
      new THREE.AnimationClip('Landing', 0.32, [
        this.posTrack('Hips', [0, 0.12, 0.32], [
          [0, 0.96, 0],
          [0, 0.72, 0],
          [0, 0.96, 0],
        ]),
        this.quatTrack('Spine', [0, 0.12, 0.32], [
          [0.15, 0, 0],
          [0.45, 0, 0],
          [0.08, 0, 0],
        ]),
        this.quatTrack('LeftUpperLeg', [0, 0.12, 0.32], [
          [-0.4, 0, 0],
          [-0.95, 0, 0.1],
          [0, 0, 0],
        ]),
        this.quatTrack('LeftLowerLeg', [0, 0.12, 0.32], [
          [0.5, 0, 0],
          [1.35, 0, 0],
          [0.1, 0, 0],
        ]),
      ])
    );

    // 8. AirborneIdle
    map.set(
      'AirborneIdle',
      new THREE.AnimationClip('AirborneIdle', 1.0, [
        this.quatTrack('Spine', [0, 0.5, 1.0], [
          [0.18, 0, 0],
          [0.24, 0, 0],
          [0.18, 0, 0],
        ]),
        this.quatTrack('LeftUpperLeg', [0, 0.5, 1.0], [
          [-0.65, 0, 0.1],
          [-0.72, 0, 0.1],
          [-0.65, 0, 0.1],
        ]),
        this.quatTrack('LeftLowerLeg', [0, 0.5, 1.0], [
          [1.0, 0, 0],
          [1.1, 0, 0],
          [1.0, 0, 0],
        ]),
        this.quatTrack('RightUpperLeg', [0, 0.5, 1.0], [
          [-0.35, 0, -0.1],
          [-0.42, 0, -0.1],
          [-0.35, 0, -0.1],
        ]),
        this.quatTrack('RightLowerLeg', [0, 0.5, 1.0], [
          [0.65, 0, 0],
          [0.72, 0, 0],
          [0.65, 0, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.5, 1.0], [
          [0.25, 0, 0.52],
          [0.32, 0, 0.58],
          [0.25, 0, 0.52],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.5, 1.0], [
          [0.25, 0, -0.52],
          [0.32, 0, -0.58],
          [0.25, 0, -0.52],
        ]),
      ])
    );

    // 9. LeftHook
    map.set(
      'LeftHook',
      new THREE.AnimationClip('LeftHook', 0.5, [
        this.quatTrack('Spine', [0, 0.25, 0.5], [
          [0.25, 0.22, -0.12],
          [0.3, 0.26, -0.16],
          [0.25, 0.22, -0.12],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.25, 0.5], [
          [-0.75, 0.2, 0.35],
          [-0.85, 0.2, 0.35],
          [-0.75, 0.2, 0.35],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.5], [
          [0.45, 0, -0.45],
          [0.45, 0, -0.45],
        ]),
        this.quatTrack('LeftUpperLeg', [0, 0.5], [
          [-0.75, 0, 0.12],
          [-0.75, 0, 0.12],
        ]),
        this.quatTrack('LeftLowerLeg', [0, 0.5], [
          [1.15, 0, 0],
          [1.15, 0, 0],
        ]),
      ])
    );

    // 10. RightHook
    map.set(
      'RightHook',
      new THREE.AnimationClip('RightHook', 0.5, [
        this.quatTrack('Spine', [0, 0.25, 0.5], [
          [0.25, -0.22, 0.12],
          [0.3, -0.26, 0.16],
          [0.25, -0.22, 0.12],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.25, 0.5], [
          [-0.75, -0.2, -0.35],
          [-0.85, -0.2, -0.35],
          [-0.75, -0.2, -0.35],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.5], [
          [0.45, 0, 0.45],
          [0.45, 0, 0.45],
        ]),
        this.quatTrack('RightUpperLeg', [0, 0.5], [
          [-0.75, 0, -0.12],
          [-0.75, 0, -0.12],
        ]),
        this.quatTrack('RightLowerLeg', [0, 0.5], [
          [1.15, 0, 0],
          [1.15, 0, 0],
        ]),
      ])
    );

    // 11. DualHook
    map.set(
      'DualHook',
      new THREE.AnimationClip('DualHook', 0.5, [
        this.quatTrack('Spine', [0, 0.25, 0.5], [
          [0.42, 0, 0],
          [0.48, 0, 0],
          [0.42, 0, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.5], [
          [-0.65, 0.15, 0.45],
          [-0.65, 0.15, 0.45],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.5], [
          [-0.65, -0.15, -0.45],
          [-0.65, -0.15, -0.45],
        ]),
        this.quatTrack('LeftUpperLeg', [0, 0.5], [
          [-0.85, 0, 0.1],
          [-0.85, 0, 0.1],
        ]),
        this.quatTrack('LeftLowerLeg', [0, 0.5], [
          [1.25, 0, 0],
          [1.25, 0, 0],
        ]),
        this.quatTrack('RightUpperLeg', [0, 0.5], [
          [-0.55, 0, -0.1],
          [-0.55, 0, -0.1],
        ]),
        this.quatTrack('RightLowerLeg', [0, 0.5], [
          [0.95, 0, 0],
          [0.95, 0, 0],
        ]),
      ])
    );

    // 12. Swing (dynamic knees tucked, blades swept back ready to strike)
    map.set(
      'Swing',
      new THREE.AnimationClip('Swing', 0.7, [
        this.quatTrack('Spine', [0, 0.35, 0.7], [
          [0.34, 0, 0],
          [0.42, 0, 0],
          [0.34, 0, 0],
        ]),
        this.quatTrack('LeftUpperLeg', [0, 0.35, 0.7], [
          [-0.78, 0, 0.12],
          [-0.88, 0, 0.12],
          [-0.78, 0, 0.12],
        ]),
        this.quatTrack('LeftLowerLeg', [0, 0.35, 0.7], [
          [1.18, 0, 0],
          [1.28, 0, 0],
          [1.18, 0, 0],
        ]),
        this.quatTrack('RightUpperLeg', [0, 0.35, 0.7], [
          [-0.38, 0, -0.1],
          [-0.48, 0, -0.1],
          [-0.38, 0, -0.1],
        ]),
        this.quatTrack('RightLowerLeg', [0, 0.35, 0.7], [
          [0.75, 0, 0],
          [0.85, 0, 0],
          [0.75, 0, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.35, 0.7], [
          [0.45, 0, 0.58],
          [0.55, 0, 0.65],
          [0.45, 0, 0.58],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.35, 0.7], [
          [0.45, 0, -0.58],
          [0.55, 0, -0.65],
          [0.45, 0, -0.58],
        ]),
        this.quatTrack('CapeTop', [0, 0.35, 0.7], [
          [0.85, 0, 0.05],
          [1.05, 0, -0.05],
          [0.85, 0, 0.05],
        ]),
      ])
    );

    // 13. Boost (aggressive forward torpedo tuck with blades trailed behind)
    map.set(
      'Boost',
      new THREE.AnimationClip('Boost', 0.4, [
        this.quatTrack('Spine', [0, 0.2, 0.4], [
          [0.62, 0, 0],
          [0.68, 0, 0],
          [0.62, 0, 0],
        ]),
        this.quatTrack('Head', [0, 0.4], [
          [-0.45, 0, 0],
          [-0.45, 0, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.4], [
          [0.85, 0, 0.45],
          [0.85, 0, 0.45],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.4], [
          [0.85, 0, -0.45],
          [0.85, 0, -0.45],
        ]),
        this.quatTrack('LeftUpperLeg', [0, 0.4], [
          [0.25, 0, 0.08],
          [0.25, 0, 0.08],
        ]),
        this.quatTrack('LeftLowerLeg', [0, 0.4], [
          [0.55, 0, 0],
          [0.55, 0, 0],
        ]),
        this.quatTrack('RightUpperLeg', [0, 0.4], [
          [0.35, 0, -0.08],
          [0.35, 0, -0.08],
        ]),
        this.quatTrack('RightLowerLeg', [0, 0.4], [
          [0.65, 0, 0],
          [0.65, 0, 0],
        ]),
        this.quatTrack('CapeTop', [0, 0.2, 0.4], [
          [1.15, 0, 0.08],
          [1.28, 0, -0.08],
          [1.15, 0, 0.08],
        ]),
      ])
    );

    // 14. Dodge (acrobatic barrel-spin evasive roll)
    map.set(
      'Dodge',
      new THREE.AnimationClip('Dodge', 0.38, [
        this.quatTrack('Hips', [0, 0.12, 0.25, 0.38], [
          [0, 0, 0],
          [0.4, 2.1, 0.5],
          [0.4, 4.2, -0.5],
          [0, 6.28, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.19, 0.38], [
          [0.2, 0, 0.3],
          [-0.6, 0, 0.9],
          [0.2, 0, 0.3],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.19, 0.38], [
          [0.2, 0, -0.3],
          [-0.6, 0, -0.9],
          [0.2, 0, -0.3],
        ]),
      ])
    );

    // 15. LightAttack (wide dual-blade cross-slash across the target)
    map.set(
      'LightAttack',
      new THREE.AnimationClip('LightAttack', 0.44, [
        this.quatTrack('Spine', [0, 0.1, 0.26, 0.44], [
          [0.15, -0.55, 0],
          [0.25, -0.75, 0],
          [0.32, 0.85, 0],
          [0.12, 0, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.1, 0.26, 0.44], [
          [-0.4, -0.6, 0.8],
          [-0.8, -0.8, 1.1],
          [-0.6, 0.9, 0.2],
          [0.2, 0, 0.22],
        ]),
        this.quatTrack('LeftLowerArm', [0, 0.1, 0.26, 0.44], [
          [-0.8, 0, 0],
          [-0.9, 0, 0],
          [-0.1, 0, 0],
          [-0.55, 0, 0],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.1, 0.26, 0.44], [
          [-0.4, -0.6, -0.2],
          [-0.9, -0.9, -0.4],
          [-0.5, 0.8, -1.1],
          [0.2, 0, -0.22],
        ]),
        this.quatTrack('RightLowerArm', [0, 0.1, 0.26, 0.44], [
          [-0.6, 0, 0],
          [-0.8, 0, 0],
          [-0.1, 0, 0],
          [-0.55, 0, 0],
        ]),
      ])
    );

    // 16. HeavyAttack (Levi-style high-speed 360° Beyblade aerial buzzsaw spin)
    map.set(
      'HeavyAttack',
      new THREE.AnimationClip('HeavyAttack', 0.62, [
        this.quatTrack('Hips', [0, 0.15, 0.31, 0.46, 0.62], [
          [0.3, 0, 0],
          [0.35, 3.14, 0.2],
          [0.35, 6.28, 0],
          [0.35, 9.42, -0.2],
          [0, 12.56, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.12, 0.5, 0.62], [
          [0.2, 0, 0.3],
          [0, 0, 1.48],
          [0, 0, 1.48],
          [0.2, 0, 0.3],
        ]),
        this.quatTrack('LeftLowerArm', [0, 0.12, 0.5, 0.62], [
          [-0.5, 0, 0],
          [-0.05, 0, 0],
          [-0.05, 0, 0],
          [-0.5, 0, 0],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.12, 0.5, 0.62], [
          [0.2, 0, -0.3],
          [0, 0, -1.48],
          [0, 0, -1.48],
          [0.2, 0, -0.3],
        ]),
        this.quatTrack('RightLowerArm', [0, 0.12, 0.5, 0.62], [
          [-0.5, 0, 0],
          [-0.05, 0, 0],
          [-0.05, 0, 0],
          [-0.5, 0, 0],
        ]),
      ])
    );

    // 17. HitReaction
    map.set(
      'HitReaction',
      new THREE.AnimationClip('HitReaction', 0.45, [
        this.quatTrack('Spine', [0, 0.14, 0.45], [
          [0.08, 0, 0],
          [-0.52, 0.18, 0.15],
          [0.08, 0, 0],
        ]),
        this.quatTrack('Head', [0, 0.14, 0.45], [
          [0, 0, 0],
          [-0.45, 0, 0],
          [0, 0, 0],
        ]),
        this.quatTrack('LeftUpperArm', [0, 0.14, 0.45], [
          [0.2, 0, 0.2],
          [-0.4, 0, 0.85],
          [0.2, 0, 0.2],
        ]),
        this.quatTrack('RightUpperArm', [0, 0.14, 0.45], [
          [0.2, 0, -0.2],
          [-0.4, 0, -0.85],
          [0.2, 0, -0.2],
        ]),
      ])
    );

    // 18. Death
    map.set(
      'Death',
      new THREE.AnimationClip('Death', 1.1, [
        this.posTrack('Hips', [0, 0.45, 1.1], [
          [0, 0.96, 0],
          [0, 0.52, -0.2],
          [0, 0.16, -0.45],
        ]),
        this.quatTrack('Hips', [0, 0.45, 1.1], [
          [0, 0, 0],
          [-0.65, 0.1, 0],
          [-1.48, 0.15, 0.1],
        ]),
        this.quatTrack('LeftUpperArm', [0, 1.1], [
          [0.2, 0, 0.2],
          [-0.3, 0, 1.1],
        ]),
        this.quatTrack('RightUpperArm', [0, 1.1], [
          [0.2, 0, -0.2],
          [-0.3, 0, -1.1],
        ]),
      ])
    );

    return map;
  }
}
