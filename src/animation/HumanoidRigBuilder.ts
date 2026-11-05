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

/**
 * Helper to create a tapered anatomical limb/torso segment with smooth 2-bone skin weights
 * and per-vertex RGB color attribute.
 */
function createSkinnedLimbGeometry(params: {
  radiusTop: number;
  radiusBottom: number;
  length: number;
  offsetY: number;
  offsetX?: number;
  offsetZ?: number;
  scaleZ?: number;
  rotX?: number;
  rotZ?: number;
  boneIndexA: number;
  boneIndexB: number;
  colorHex: number;
  radialSegments?: number;
  heightSegments?: number;
}): THREE.BufferGeometry {
  const radialSegs = params.radialSegments ?? 12;
  const heightSegs = params.heightSegments ?? 6;
  const geo = new THREE.CylinderGeometry(
    params.radiusTop,
    params.radiusBottom,
    params.length,
    radialSegs,
    heightSegs,
    false
  );

  if (params.scaleZ) geo.scale(1, 1, params.scaleZ);
  if (params.rotX) geo.rotateX(params.rotX);
  if (params.rotZ) geo.rotateZ(params.rotZ);
  geo.translate(
    params.offsetX ?? 0,
    params.offsetY,
    params.offsetZ ?? 0
  );

  const posAttr = geo.attributes.position;
  const vertexCount = posAttr.count;
  const skinIndices = new Uint16Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);
  const colors = new Float32Array(vertexCount * 3);

  const color = new THREE.Color(params.colorHex);
  const minY = params.offsetY - params.length * 0.5;
  const invLen = 1 / Math.max(0.001, params.length);

  for (let i = 0; i < vertexCount; i++) {
    skinIndices[i * 4 + 0] = params.boneIndexA;
    skinIndices[i * 4 + 1] = params.boneIndexB;
    skinIndices[i * 4 + 2] = 0;
    skinIndices[i * 4 + 3] = 0;

    skinWeights[i * 4 + 0] = 1.0;
    skinWeights[i * 4 + 1] = 0.0;
    skinWeights[i * 4 + 2] = 0;
    skinWeights[i * 4 + 3] = 0;

    colors[i * 3 + 0] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function createSkinnedEllipsoidGeometry(params: {
  rx: number;
  ry: number;
  rz: number;
  cx: number;
  cy: number;
  cz: number;
  boneIndex: number;
  colorHex: number;
}): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 14, 12);
  geo.scale(params.rx, params.ry, params.rz);
  geo.translate(params.cx, params.cy, params.cz);

  const count = geo.attributes.position.count;
  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color(params.colorHex);

  for (let i = 0; i < count; i++) {
    skinIndices[i * 4 + 0] = params.boneIndex;
    skinWeights[i * 4 + 0] = 1.0;
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
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
    const colJacket = 0x7c4d32;   // Cropped amber-brown scout jacket
    const colShirt = 0x263240;    // Dark slate inner tunic
    const colCape = 0x1e4d38;     // Deep hunter-green Vanguard cloak
    const colSkin = 0xf4ccb0;     // Warm anime skin tone
    const colHair = 0x1d1f26;     // Raven dark hair

    const parts: THREE.BufferGeometry[] = [
      // Pelvis & Hips
      createSkinnedLimbGeometry({
        radiusTop: 0.135,
        radiusBottom: 0.145,
        length: 0.18,
        offsetY: 0.96,
        boneIndexA: iHips,
        boneIndexB: iSpine,
        colorHex: colTrousers,
      }),
      // Waist & Leather Belt
      createSkinnedLimbGeometry({
        radiusTop: 0.13,
        radiusBottom: 0.135,
        length: 0.18,
        offsetY: 1.12,
        boneIndexA: iSpine,
        boneIndexB: iSpine1,
        colorHex: colShirt,
      }),
      // Upper Torso & Cropped Scout Jacket
      createSkinnedLimbGeometry({
        radiusTop: 0.165,
        radiusBottom: 0.135,
        length: 0.28,
        offsetY: 1.34,
        boneIndexA: iSpine1,
        boneIndexB: iChest,
        colorHex: colJacket,
      }),
      // Neck
      createSkinnedLimbGeometry({
        radiusTop: 0.055,
        radiusBottom: 0.065,
        length: 0.12,
        offsetY: 1.54,
        boneIndexA: iNeck,
        boneIndexB: iHead,
        colorHex: colSkin,
      }),
      // Sculpted Head
      createSkinnedEllipsoidGeometry({
        rx: 0.105,
        ry: 0.125,
        rz: 0.115,
        cx: 0,
        cy: 1.69,
        cz: 0.01,
        boneIndex: iHead,
        colorHex: colSkin,
      }),
      // Anime Hair Crown & Back Locks
      createSkinnedEllipsoidGeometry({
        rx: 0.116,
        ry: 0.11,
        rz: 0.125,
        cx: 0,
        cy: 1.73,
        cz: -0.01,
        boneIndex: iHead,
        colorHex: colHair,
      }),
      createSkinnedLimbGeometry({
        radiusTop: 0.08,
        radiusBottom: 0.03,
        length: 0.18,
        offsetY: 1.66,
        offsetZ: -0.09,
        boneIndexA: iHead,
        boneIndexB: iHairBack,
        colorHex: colHair,
      }),
      // Vanguard Green Shoulder Cloak / Cape (flattened sleek profile along Z)
      createSkinnedLimbGeometry({
        radiusTop: 0.17,
        radiusBottom: 0.22,
        length: 0.3,
        offsetY: 1.35,
        offsetZ: -0.11,
        scaleZ: 0.16,
        boneIndexA: iCapeTop,
        boneIndexB: iCapeMid,
        colorHex: colCape,
      }),
      createSkinnedLimbGeometry({
        radiusTop: 0.22,
        radiusBottom: 0.27,
        length: 0.3,
        offsetY: 1.07,
        offsetZ: -0.14,
        scaleZ: 0.15,
        boneIndexA: iCapeMid,
        boneIndexB: iCapeTip,
        colorHex: colCape,
      }),

      // Left Arm (Shoulder -> Upper -> Forearm -> Hand)
      createSkinnedEllipsoidGeometry({
        rx: 0.068,
        ry: 0.068,
        rz: 0.068,
        cx: -0.19,
        cy: 1.49,
        cz: 0,
        boneIndex: iLShoulder,
        colorHex: colJacket,
      }),
      createSkinnedLimbGeometry({
        radiusTop: 0.058,
        radiusBottom: 0.048,
        length: 0.27,
        offsetX: -0.19,
        offsetY: 1.355,
        boneIndexA: iLUpperArm,
        boneIndexB: iLLowerArm,
        colorHex: colJacket,
      }),
      createSkinnedLimbGeometry({
        radiusTop: 0.048,
        radiusBottom: 0.038,
        length: 0.25,
        offsetX: -0.19,
        offsetY: 1.095,
        boneIndexA: iLLowerArm,
        boneIndexB: iLHand,
        colorHex: colJacket,
      }),
      createSkinnedEllipsoidGeometry({
        rx: 0.038,
        ry: 0.05,
        rz: 0.03,
        cx: -0.19,
        cy: 0.94,
        cz: 0,
        boneIndex: iLHand,
        colorHex: colSkin,
      }),

      // Right Arm (Shoulder -> Upper -> Forearm -> Hand)
      createSkinnedEllipsoidGeometry({
        rx: 0.068,
        ry: 0.068,
        rz: 0.068,
        cx: 0.19,
        cy: 1.49,
        cz: 0,
        boneIndex: iRShoulder,
        colorHex: colJacket,
      }),
      createSkinnedLimbGeometry({
        radiusTop: 0.058,
        radiusBottom: 0.048,
        length: 0.27,
        offsetX: 0.19,
        offsetY: 1.355,
        boneIndexA: iRUpperArm,
        boneIndexB: iRLowerArm,
        colorHex: colJacket,
      }),
      createSkinnedLimbGeometry({
        radiusTop: 0.048,
        radiusBottom: 0.038,
        length: 0.25,
        offsetX: 0.19,
        offsetY: 1.095,
        boneIndexA: iRLowerArm,
        boneIndexB: iRHand,
        colorHex: colJacket,
      }),
      createSkinnedEllipsoidGeometry({
        rx: 0.038,
        ry: 0.05,
        rz: 0.03,
        cx: 0.19,
        cy: 0.94,
        cz: 0,
        boneIndex: iRHand,
        colorHex: colSkin,
      }),

      // Left Leg (Thigh -> Knee/Calf -> Boot)
      createSkinnedLimbGeometry({
        radiusTop: 0.082,
        radiusBottom: 0.062,
        length: 0.44,
        offsetX: -0.11,
        offsetY: 0.7,
        boneIndexA: iLUpperLeg,
        boneIndexB: iLLowerLeg,
        colorHex: colTrousers,
      }),
      createSkinnedLimbGeometry({
        radiusTop: 0.062,
        radiusBottom: 0.048,
        length: 0.42,
        offsetX: -0.11,
        offsetY: 0.27,
        boneIndexA: iLLowerLeg,
        boneIndexB: iLFoot,
        colorHex: colBoots,
      }),
      createSkinnedEllipsoidGeometry({
        rx: 0.055,
        ry: 0.045,
        rz: 0.11,
        cx: -0.11,
        cy: 0.05,
        cz: 0.04,
        boneIndex: iLFoot,
        colorHex: colBoots,
      }),

      // Right Leg (Thigh -> Knee/Calf -> Boot)
      createSkinnedLimbGeometry({
        radiusTop: 0.082,
        radiusBottom: 0.062,
        length: 0.44,
        offsetX: 0.11,
        offsetY: 0.7,
        boneIndexA: iRUpperLeg,
        boneIndexB: iRLowerLeg,
        colorHex: colTrousers,
      }),
      createSkinnedLimbGeometry({
        radiusTop: 0.062,
        radiusBottom: 0.048,
        length: 0.42,
        offsetX: 0.11,
        offsetY: 0.27,
        boneIndexA: iRLowerLeg,
        boneIndexB: iRFoot,
        colorHex: colBoots,
      }),
      createSkinnedEllipsoidGeometry({
        rx: 0.055,
        ry: 0.045,
        rz: 0.11,
        cx: 0.11,
        cy: 0.05,
        cz: 0.04,
        boneIndex: iRFoot,
        colorHex: colBoots,
      }),
    ];

    const mergedBodyGeo = mergeGeometries(parts, false);
    mergedBodyGeo.computeVertexNormals();

    const bodyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.12,
    });

    const skinnedMesh = new THREE.SkinnedMesh(mergedBodyGeo, bodyMat);
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
