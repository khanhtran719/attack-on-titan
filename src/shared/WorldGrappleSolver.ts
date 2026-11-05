import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import {
  clamp,
  RopeAnchorConstraintInput,
  solveODMRopeConstraints,
} from '../utils/MathUtils';
import { C2S_InputFrame, isValidFiniteVec3 } from './Protocol';

export type HookFireResultReason =
  | 'LOCKED_TITAN_LATCH'
  | 'RAY_TITAN_LATCH'
  | 'CLIENT_HINT_VERIFIED'
  | 'DIRECT_WORLD_LATCH'
  | 'ASSIST_CONE_WORLD_LATCH'
  | 'CORRIDOR_ASSIST_WORLD_LATCH'
  | 'REJECT_NO_GAS'
  | 'REJECT_DEAD_OR_DOWNED'
  | 'REJECT_OUT_OF_RANGE'
  | 'REJECT_LOW_ELEVATION'
  | 'REJECT_NO_SURFACE_IN_CONE'
  | 'REJECT_LOS_BLOCKED';

export interface HookFireDebugInfo {
  side: 'left' | 'right';
  seq: number;
  timestampMs: number;
  success: boolean;
  reason: HookFireResultReason;
  anchor: [number, number, number] | null;
  distance: number;
  surfaceLabel?: string;
}

export interface WorldGrappleHit {
  point: THREE.Vector3;
  distance: number;
  reason:
    | 'CLIENT_HINT_VERIFIED'
    | 'DIRECT_WORLD_LATCH'
    | 'ASSIST_CONE_WORLD_LATCH'
    | 'CORRIDOR_ASSIST_WORLD_LATCH';
  surfaceLabel?: string;
}

/**
 * Verifies Line-of-Sight from the player's chest/waist winch origin toward a candidate world point,
 * ensuring the hit lands on a valid grappleable surface within maxRange.
 */
export function verifyLineOfSightGrapple(
  physics: PhysicsWorld,
  playerPos: THREE.Vector3,
  targetPoint: THREE.Vector3,
  maxRange: number = GAME_CONFIG.odm.maxGrappleRange
): {
  valid: boolean;
  point: THREE.Vector3;
  distance: number;
  surfaceLabel?: string;
} | null {
  const chestOrigin = new THREE.Vector3(
    playerPos.x,
    playerPos.y + 1.35,
    playerPos.z
  );
  const toTarget = new THREE.Vector3().subVectors(targetPoint, chestOrigin);
  const distFromChest = toTarget.length();
  if (distFromChest < 0.5 || distFromChest > maxRange + 4.0) {
    return null;
  }

  const dir = toTarget.clone().divideScalar(distFromChest);
  const hit = physics.castRay(chestOrigin, dir, distFromChest + 3.0, false);
  if (!hit || !hit.metadata.grappleable) {
    return null;
  }

  const distFromPlayer = playerPos.distanceTo(hit.point);
  if (distFromPlayer > maxRange || hit.point.y < 1.2) {
    return null;
  }

  return {
    valid: true,
    point: hit.point,
    distance: distFromPlayer,
    surfaceLabel: hit.metadata.label,
  };
}

/**
 * Validates a client-suggested world grapple anchor on the authoritative server:
 * checks finite coordinates, elevation, max range, forward aim cone, and Rapier 3D Line-of-Sight surface hit.
 */
export function validateServerWorldAnchorHint(
  physics: PhysicsWorld,
  playerPos: THREE.Vector3,
  camOrigin: THREE.Vector3,
  camForward: THREE.Vector3,
  hintAnchor?: [number, number, number] | null
): WorldGrappleHit | null {
  if (!isValidFiniteVec3(hintAnchor)) return null;

  const targetVec = new THREE.Vector3(
    hintAnchor[0],
    hintAnchor[1],
    hintAnchor[2]
  );
  if (targetVec.y < 1.2) return null;

  const maxRange = GAME_CONFIG.odm.maxGrappleRange;
  const rawDist = playerPos.distanceTo(targetVec);
  if (rawDist < 2.5 || rawDist > maxRange * 1.06) return null;

  // Must lie within reasonable forward/corridor view of the player's camera
  const fromCam = targetVec.clone().sub(camOrigin).normalize();
  if (fromCam.dot(camForward) < 0.22) return null;

  // 1. Check direct ray from chest to targetVec
  const los = verifyLineOfSightGrapple(
    physics,
    playerPos,
    targetVec,
    maxRange * 1.05
  );
  if (los && los.point.distanceTo(targetVec) <= 4.5) {
    return {
      point: los.point,
      distance: los.distance,
      reason: 'CLIENT_HINT_VERIFIED',
      surfaceLabel: los.surfaceLabel,
    };
  }

  // 2. Check ray from camera origin toward targetVec
  const camToTarget = targetVec.clone().sub(camOrigin);
  const camDist = camToTarget.length();
  if (camDist > 0.5) {
    const camHit = physics.castRay(
      camOrigin,
      camToTarget.divideScalar(camDist),
      camDist + 4.0,
      true
    );
    if (
      camHit &&
      camHit.point.y >= 1.2 &&
      camHit.point.distanceTo(playerPos) <= maxRange * 1.05
    ) {
      return {
        point: camHit.point,
        distance: camHit.point.distanceTo(playerPos),
        reason: 'CLIENT_HINT_VERIFIED',
        surfaceLabel: camHit.metadata.label,
      };
    }
  }

  return null;
}

/**
 * Multi-stage world building/wall/tower grapple solver shared by Client (`ODMSystem`) and Server (`CoopHunterRoom`).
 * Supports:
 * 1. Direct center/biased raycast with automatic vertical lift if aiming low on a tall facade.
 * 2. Inner & mid aim-assist cone for rooftop edges and towers.
 * 3. Street-corridor left/right fan so players flying down avenues can grapple left/right buildings without Titan lock.
 */
export function findBestWorldGrapplePoint(
  physics: PhysicsWorld,
  camOrigin: THREE.Vector3,
  camForward: THREE.Vector3,
  playerPos: THREE.Vector3,
  sideSign: -1 | 0 | 1
): WorldGrappleHit | null {
  const maxRange = GAME_CONFIG.odm.maxGrappleRange;
  const up = new THREE.Vector3(0, 1, 0);
  const forward = camForward.clone().normalize();

  // Handle near-vertical look safely
  const flatRight = new THREE.Vector3().crossVectors(forward, up);
  if (flatRight.lengthSq() < 0.001) {
    flatRight.set(1, 0, 0);
  } else {
    flatRight.normalize();
  }
  const orthoUp = new THREE.Vector3().crossVectors(flatRight, forward).normalize();

  const biasedForward =
    sideSign !== 0
      ? forward
          .clone()
          .addScaledVector(flatRight, sideSign * 0.04)
          .normalize()
      : forward;

  // =========================================================================
  // Stage 1: Direct Reticle Raycast (from Camera & Player Chest)
  // =========================================================================
  const directHit = physics.castRay(camOrigin, biasedForward, maxRange + 10, true);
  if (
    directHit &&
    directHit.distance >= 2.0 &&
    directHit.point.distanceTo(playerPos) >= 2.5 &&
    directHit.point.distanceTo(playerPos) <= maxRange &&
    directHit.point.y >= 1.2
  ) {
    let bestPoint = directHit.point;

    // If the player aimed low on a tall building/tower while grounded or low, probe slightly higher on the same facade
    // so the grapple anchor gives upward pendulum swing lift instead of pulling horizontally into the street
    if (bestPoint.y < playerPos.y + 4.5) {
      for (const liftPitch of [0.18, 0.3, 0.42]) {
        const liftedDir = biasedForward
          .clone()
          .addScaledVector(orthoUp, liftPitch)
          .normalize();
        const liftedHit = physics.castRay(
          camOrigin,
          liftedDir,
          maxRange + 10,
          true
        );
        if (
          liftedHit &&
          liftedHit.point.distanceTo(playerPos) <= maxRange &&
          liftedHit.point.y >= bestPoint.y + 2.5 &&
          Math.hypot(
            liftedHit.point.x - bestPoint.x,
            liftedHit.point.z - bestPoint.z
          ) <= 6.0
        ) {
          bestPoint = liftedHit.point;
          break;
        }
      }
    }

    const los = verifyLineOfSightGrapple(physics, playerPos, bestPoint, maxRange);
    const finalPt = los ? los.point : bestPoint;
    return {
      point: finalPt,
      distance: finalPt.distanceTo(playerPos),
      reason: 'DIRECT_WORLD_LATCH',
      surfaceLabel: directHit.metadata.label,
    };
  }

  // Also check direct ray from player chest toward a point 65m along camera forward
  const chestOrigin = new THREE.Vector3(
    playerPos.x,
    playerPos.y + 1.35,
    playerPos.z
  );
  const focalPoint = camOrigin.clone().addScaledVector(biasedForward, 65);
  const chestToFocal = focalPoint.sub(chestOrigin).normalize();
  const chestDirect = physics.castRay(chestOrigin, chestToFocal, maxRange, true);
  if (
    chestDirect &&
    chestDirect.distance >= 2.0 &&
    chestDirect.point.distanceTo(playerPos) >= 2.5 &&
    chestDirect.point.distanceTo(playerPos) <= maxRange &&
    chestDirect.point.y >= 1.5
  ) {
    return {
      point: chestDirect.point,
      distance: chestDirect.point.distanceTo(playerPos),
      reason: 'DIRECT_WORLD_LATCH',
      surfaceLabel: chestDirect.metadata.label,
    };
  }

  // =========================================================================
  // Stage 2: Scored Multi-Ring Aim Assist Cone + Street-Corridor Fan
  // =========================================================================
  const prefSide = sideSign === 0 ? 1 : sideSign;
  const cone = GAME_CONFIG.odm.aimAssistConeAngleRad; // 0.22 rad

  // [horizRadians, vertRadians, isCorridorFan]
  const candidateAngles: Array<[number, number, boolean]> = [
    // Inner precision ring
    [prefSide * cone * 0.45, cone * 0.25, false],
    [prefSide * cone * 0.8, 0.0, false],
    [0, cone * 0.5, false],
    [0, -cone * 0.4, false],
    [prefSide * cone * 1.1, cone * 0.45, false],
    [-prefSide * cone * 0.45, cone * 0.25, false],
    [prefSide * cone * 1.35, -cone * 0.2, false],
    [0, cone * 0.95, false],
    [0, -cone * 0.85, false],

    // Mid assist ring (catches rooftops when aiming slightly high or low)
    [prefSide * 0.34, 0.14, false],
    [prefSide * 0.34, -0.12, false],
    [prefSide * 0.38, 0.28, false],
    [-prefSide * 0.32, 0.14, false],
    [0, 0.32, false],
    [0, -0.28, false],

    // Street-corridor lateral fan (catches avenue buildings on left/right up to ~38 deg)
    [prefSide * 0.48, 0.12, true],
    [prefSide * 0.48, 0.26, true],
    [prefSide * 0.58, 0.16, true],
    [prefSide * 0.58, 0.32, true],
    [prefSide * 0.68, 0.2, true],
    [-prefSide * 0.46, 0.16, true],
    [-prefSide * 0.56, 0.22, true],
  ];

  let bestCandidate: WorldGrappleHit | null = null;
  let bestScore = -Infinity;

  for (const [rx, ry, isCorridor] of candidateAngles) {
    if (isCorridor && Math.abs(forward.y) >= 0.7) continue;
    const rayDir = biasedForward
      .clone()
      .addScaledVector(flatRight, rx)
      .addScaledVector(orthoUp, ry)
      .normalize();

    const hit = physics.castRay(camOrigin, rayDir, maxRange + 8, true);
    if (!hit || hit.distance < 2.0) continue;

    // Verify Line-of-Sight from player chest
    const los = verifyLineOfSightGrapple(physics, playerPos, hit.point, maxRange);
    const validPt = los && los.distance >= 2.0 ? los.point : hit.point;
    const dist = validPt.distanceTo(playerPos);
    if (dist > maxRange || dist < 2.5 || validPt.y < 1.5) continue;

    // Score candidate:
    // 1. Alignment with camera forward (0..1)
    const toPtFromCam = validPt.clone().sub(camOrigin).normalize();
    const alignDot = toPtFromCam.dot(forward);
    if (alignDot < 0.35) continue;

    // 2. Side preference for Left vs Right hook dual-hook street swinging
    const lateralOffset = toPtFromCam.dot(flatRight);
    const sideMatchBonus =
      sideSign !== 0 ? (lateralOffset * sideSign >= -0.02 ? 0.18 : -0.12) : 0;

    // 3. Elevation bonus: anchors above the player provide strong pendulum lift
    const heightAbovePlayer = validPt.y - playerPos.y;
    const elevationBonus = clamp(heightAbovePlayer / 18.0, -0.1, 0.32);

    // 4. Sweet-spot swing distance bonus (14m..68m)
    const distScore =
      dist >= 12 && dist <= 72 ? 0.15 : 0.05 - Math.abs(dist - 42) * 0.002;

    const totalScore =
      alignDot * 2.2 + sideMatchBonus + elevationBonus + distScore;

    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestCandidate = {
        point: validPt,
        distance: dist,
        reason: isCorridor
          ? 'CORRIDOR_ASSIST_WORLD_LATCH'
          : 'ASSIST_CONE_WORLD_LATCH',
        surfaceLabel: los?.surfaceLabel || hit.metadata.label,
      };
    }
  }

  return bestCandidate;
}

/**
 * Pure kinematic + ODM rope constraint step used for replaying unacknowledged input frames
 * during client-side prediction reconciliation so swing momentum is preserved across server snapshots.
 */
export function stepReplayedInputFrame(
  physics: PhysicsWorld,
  pos: THREE.Vector3,
  vel: THREE.Vector3,
  grounded: boolean,
  leftHook: { active: boolean; anchorPos: THREE.Vector3; restLength: number },
  rightHook: { active: boolean; anchorPos: THREE.Vector3; restLength: number },
  frame: C2S_InputFrame
): { grounded: boolean } {
  const dt = clamp(frame.dt || 1 / 60, 0.004, 0.05);
  const camYaw = Number.isFinite(frame.yaw) ? frame.yaw : 0;
  const camFlatForward = new THREE.Vector3(
    -Math.sin(camYaw),
    0,
    -Math.cos(camYaw)
  ).normalize();
  const camRight = new THREE.Vector3(
    -camFlatForward.z,
    0,
    camFlatForward.x
  ).normalize();

  const moveInputDir = new THREE.Vector3()
    .addScaledVector(camFlatForward, clamp(frame.moveForward || 0, -1, 1))
    .addScaledVector(camRight, clamp(frame.moveRight || 0, -1, 1));
  if (moveInputDir.lengthSq() > 1.0) moveInputDir.normalize();

  const camAimDir = isValidFiniteVec3(frame.camForward)
    ? new THREE.Vector3(...frame.camForward).normalize()
    : camFlatForward.clone();

  let isGrounded = grounded;
  const isBoosting = Boolean(frame.boostHeld);

  if (frame.jumpPressed) {
    if (isGrounded) {
      isGrounded = false;
      vel.y = GAME_CONFIG.player.jumpVelocity;
    } else if (leftHook.active || rightHook.active) {
      vel.y = Math.max(vel.y + 6.5, GAME_CONFIG.player.jumpVelocity);
    }
  }

  if (isBoosting && (!isGrounded || leftHook.active || rightHook.active)) {
    const boostDir = camAimDir.clone();
    if (moveInputDir.lengthSq() > 0.05) {
      boostDir.lerp(moveInputDir, 0.35).normalize();
    }
    if (boostDir.y < 0.08 && pos.y < 5.0) {
      boostDir.y = 0.15;
      boostDir.normalize();
    }
    vel.addScaledVector(boostDir, GAME_CONFIG.odm.gasBoostAccel * dt);
  }

  const activeConstraints: RopeAnchorConstraintInput[] = [];
  const hookRefs: Array<{
    active: boolean;
    anchorPos: THREE.Vector3;
    restLength: number;
  }> = [];

  for (const h of [leftHook, rightHook]) {
    if (!h.active) continue;
    if (pos.distanceTo(h.anchorPos) > GAME_CONFIG.odm.maxGrappleRange * 1.22) {
      continue;
    }
    activeConstraints.push({
      anchorPos: h.anchorPos,
      restLength: h.restLength,
      reelInRate: isBoosting
        ? GAME_CONFIG.odm.reelInSpeedBoost
        : GAME_CONFIG.odm.reelInSpeedBase,
    });
    hookRefs.push(h);
  }

  const hooked = activeConstraints.length > 0;
  if (hooked) {
    isGrounded = false;
    vel.y +=
      GAME_CONFIG.physics.gravity *
      GAME_CONFIG.physics.hookedGravityScale *
      dt;
    const solved = solveODMRopeConstraints(
      pos,
      vel,
      activeConstraints,
      moveInputDir,
      isBoosting,
      dt
    );
    pos.copy(solved.newPosition);
    vel.copy(solved.newVelocity);
    for (let i = 0; i < hookRefs.length; i++) {
      hookRefs[i].restLength = solved.updatedRestLengths[i];
    }
    vel.multiplyScalar(1 - GAME_CONFIG.physics.airDrag * dt * 12);
  } else if (!isGrounded) {
    vel.y += GAME_CONFIG.physics.gravity * dt;
    if (moveInputDir.lengthSq() > 0.01) {
      vel.addScaledVector(
        moveInputDir,
        GAME_CONFIG.player.airControlAccel * dt
      );
    }
    vel.multiplyScalar(1 - GAME_CONFIG.physics.airDrag * dt * 15);
  } else {
    const targetSpeed = isBoosting
      ? GAME_CONFIG.player.sprintSpeed
      : GAME_CONFIG.player.runSpeed;
    const desiredX = moveInputDir.x * targetSpeed;
    const desiredZ = moveInputDir.z * targetSpeed;
    const blend = clamp(GAME_CONFIG.physics.groundFriction * dt, 0, 1);
    vel.x += (desiredX - vel.x) * blend;
    vel.z += (desiredZ - vel.z) * blend;
    if (vel.y < 0) vel.y = -1.5;
  }

  const totalSpeed = vel.length();
  if (totalSpeed > GAME_CONFIG.physics.terminalVelocity) {
    vel.multiplyScalar(GAME_CONFIG.physics.terminalVelocity / totalSpeed);
  }

  const moveRes = physics.moveCharacter(
    pos,
    vel.clone().multiplyScalar(dt),
    hooked || !isGrounded
  );
  pos.copy(moveRes.footPosition);
  if (moveRes.hitWall && moveRes.wallNormal) {
    const intoWall = vel.dot(moveRes.wallNormal);
    if (intoWall < 0) {
      vel.addScaledVector(moveRes.wallNormal, -intoWall);
    }
  }

  if (!hooked && moveRes.grounded && vel.y <= 0.5) {
    isGrounded = true;
    vel.y = 0;
  } else {
    isGrounded = false;
  }

  return { grounded: isGrounded };
}
