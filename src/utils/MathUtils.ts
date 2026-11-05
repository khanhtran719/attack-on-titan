import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function shortestAngleDist(from: number, to: number): number {
  const max = Math.PI * 2;
  const da = (to - from) % max;
  return ((2 * da) % max) - da;
}

export function lerpAngle(from: number, to: number, t: number): number {
  return from + shortestAngleDist(from, to) * clamp(t, 0, 1);
}

export interface RopeAnchorConstraintInput {
  anchorPos: THREE.Vector3;
  restLength: number;
  reelInRate: number; // m/s reduction in restLength
}

export interface RopeSolverResult {
  newPosition: THREE.Vector3;
  newVelocity: THREE.Vector3;
  updatedRestLengths: number[];
  isTaut: boolean[];
}

/**
 * Pure ODM Rope Constraint & Swing Momentum Solver.
 * - Supports 1 or 2 independent grappling hooks.
 * - When a rope is slack (distance <= restLength), it does NOT push the player away.
 * - When a rope is taut (distance > restLength), outward radial velocity is removed
 *   and converted into smooth tangential swing momentum, with soft spring-damper position constraint.
 * - Active reel-in pulls the player toward the anchor (or dual-anchor resultant vector)
 *   without teleporting or inducing uncontrolled oscillation.
 */
export function solveODMRopeConstraints(
  playerPos: THREE.Vector3,
  playerVel: THREE.Vector3,
  anchors: RopeAnchorConstraintInput[],
  steerWorldDir: THREE.Vector3,
  isBoosting: boolean,
  dt: number
): RopeSolverResult {
  const newPos = playerPos.clone();
  const newVel = playerVel.clone();
  const updatedRestLengths: number[] = [];
  const isTaut: boolean[] = [];

  if (anchors.length === 0 || dt <= 0) {
    return {
      newPosition: newPos,
      newVelocity: newVel,
      updatedRestLengths,
      isTaut,
    };
  }

  // Accumulate pull directions for active reel-in
  const compositePullDir = new THREE.Vector3();
  let activeHookCount = 0;

  for (let i = 0; i < anchors.length; i++) {
    const hook = anchors[i];
    const toPlayer = new THREE.Vector3().subVectors(playerPos, hook.anchorPos);
    const currentDist = toPlayer.length();

    // Reel in the rest length smoothly, bounded by minRopeLength
    const targetRest = Math.max(
      GAME_CONFIG.odm.minRopeLength,
      Math.min(hook.restLength, currentDist + 0.5) - hook.reelInRate * dt
    );
    updatedRestLengths.push(targetRest);

    if (currentDist < 0.001) {
      isTaut.push(false);
      continue;
    }

    const radialOutUnit = toPlayer.clone().divideScalar(currentDist); // points from anchor -> player
    const pullInUnit = radialOutUnit.clone().negate(); // points from player -> anchor
    compositePullDir.add(pullInUnit);
    activeHookCount++;

    const stretch = currentDist - targetRest;

    if (stretch > 0) {
      // Rope is TAUT
      isTaut.push(true);

      // 1. Check outward radial velocity component against initial velocity so dual hooks stay symmetric
      const radialSpeedOut = playerVel.dot(radialOutUnit);
      if (radialSpeedOut > 0) {
        // Remove outward component along this rope's radial axis
        newVel.addScaledVector(radialOutUnit, -radialSpeedOut / anchors.length);
        // Convert part of removed radial speed into tangential forward speed
        const tangentVel = playerVel
          .clone()
          .addScaledVector(radialOutUnit, -radialSpeedOut);
        if (tangentVel.lengthSq() > 0.01) {
          newVel.addScaledVector(
            tangentVel.normalize(),
            (radialSpeedOut * 0.22) / anchors.length
          );
        }
      }

      // 2. Apply inward reel/tension velocity impulse proportional to stretch
      const maxStretchCorrectionSpeed = isBoosting ? 36.0 : 24.0;
      const tensionSpeed = Math.min(
        maxStretchCorrectionSpeed,
        stretch * GAME_CONFIG.odm.ropeStiffness * dt + hook.reelInRate * 0.65
      );
      newVel.addScaledVector(pullInUnit, tensionSpeed);

      // 3. Soft position clamp if stretch is large to prevent excessive rubber-banding without hard teleport
      if (stretch > 1.2) {
        const excess = Math.min(stretch - 1.2, 6.0 * dt);
        newPos.addScaledVector(pullInUnit, excess);
      }
    } else {
      // Rope is SLACK (currentDist <= targetRest)
      // A flexible wire never pushes the player outward!
      isTaut.push(false);

      // If actively reeling in, apply gentle inward tension so player glides toward anchor
      if (hook.reelInRate > 0 && currentDist > GAME_CONFIG.odm.minRopeLength) {
        const gentlePull = hook.reelInRate * (isBoosting ? 1.15 : 0.75) * dt;
        newVel.addScaledVector(pullInUnit, gentlePull * 14.0);
      }
    }
  }

  // Dual-hook & single-hook tangential steering
  if (activeHookCount > 0) {
    compositePullDir.divideScalar(activeHookCount).normalize();

    if (steerWorldDir.lengthSq() > 0.001) {
      // Project steering onto plane perpendicular to composite rope vector so WASD orbits smoothly
      const radialPart = compositePullDir.clone().multiplyScalar(steerWorldDir.dot(compositePullDir));
      const tangentialSteer = steerWorldDir.clone().sub(radialPart);
      if (tangentialSteer.lengthSq() > 0.001) {
        tangentialSteer.normalize();
        newVel.addScaledVector(tangentialSteer, GAME_CONFIG.odm.swingSteeringAccel * dt);
      }
      // Also allow slight forward/backward influence along rope direction
      newVel.addScaledVector(steerWorldDir, GAME_CONFIG.odm.swingSteeringAccel * 0.35 * dt);
    }

    // Dual hooks provide extra forward slingshot acceleration toward the midpoint
    if (activeHookCount >= 2) {
      newVel.addScaledVector(compositePullDir, (isBoosting ? 24.0 : 12.0) * dt);
    }
  }

  // Clamp velocity to prevent runaway numerical explosion
  const speed = newVel.length();
  if (speed > GAME_CONFIG.odm.maxAirSpeed) {
    newVel.multiplyScalar(GAME_CONFIG.odm.maxAirSpeed / speed);
  }

  return {
    newPosition: newPos,
    newVelocity: newVel,
    updatedRestLengths,
    isTaut,
  };
}

/**
 * Shortest squared distance between 3D line segment AB and point P.
 */
export function pointToSegmentDistSq(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3
): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ap = new THREE.Vector3().subVectors(p, a);
  const lenSq = ab.lengthSq();
  if (lenSq < 1e-6) {
    return ap.lengthSq();
  }
  const t = clamp(ap.dot(ab) / lenSq, 0, 1);
  const closest = a.clone().addScaledVector(ab, t);
  return p.distanceToSquared(closest);
}

/**
 * Checks whether a swept blade segment (from hilt->tip at previous & current sub-steps)
 * intersects a hurtbox sphere in 3D space.
 */
export function sweptBladeIntersectsHurtbox(
  hiltStart: THREE.Vector3,
  tipStart: THREE.Vector3,
  hiltEnd: THREE.Vector3,
  tipEnd: THREE.Vector3,
  hurtboxCenter: THREE.Vector3,
  hurtboxRadius: number
): boolean {
  const rSq = hurtboxRadius * hurtboxRadius;
  // Sample 4 slices across the blade sweep arc
  const steps = 4;
  const h = new THREE.Vector3();
  const t = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) {
    const alpha = i / steps;
    h.lerpVectors(hiltStart, hiltEnd, alpha);
    t.lerpVectors(tipStart, tipEnd, alpha);
    if (pointToSegmentDistSq(hurtboxCenter, h, t) <= rSq) {
      return true;
    }
  }
  return false;
}

/**
 * Evaluates whether the attacker is approaching the Titan's nape from a valid rear/flank angle.
 * Returns the approach dot product:
 *   dot(normalize(attackerPos - titanCenter), titanForward)
 * Since titanForward points to the Titan's front (+Z), a player behind the Titan has dot < 0.
 */
export function evaluateNapeApproachCos(
  attackerPos: THREE.Vector3,
  titanPos: THREE.Vector3,
  titanForward: THREE.Vector3
): number {
  const dirToAttacker = new THREE.Vector3(
    attackerPos.x - titanPos.x,
    0,
    attackerPos.z - titanPos.z
  );
  if (dirToAttacker.lengthSq() < 1e-5) return -1;
  dirToAttacker.normalize();

  const flatForward = new THREE.Vector3(titanForward.x, 0, titanForward.z);
  if (flatForward.lengthSq() < 1e-5) return -1;
  flatForward.normalize();

  return dirToAttacker.dot(flatForward);
}

export interface StrikeDamageInput {
  isHeavyAttack: boolean;
  relativeSpeed: number;
  bladeDurability: number;
  isNape: boolean;
  napeApproachCos: number; // dot(toAttacker, titanForward), negative means behind Titan
}

export interface StrikeDamageOutput {
  damage: number;
  velocityMultiplier: number;
  isCriticalNapeHit: boolean;
  glancedOffFront: boolean;
}

/**
 * Pure kinetic combat damage calculator.
 * - Rewards high relative ODM speed.
 * - Enforces rear-hemisphere approach angle for lethal Nape hits.
 * - Penalizes dull blades when durability <= 0.
 */
export function calculateStrikeDamage(input: StrikeDamageInput): StrikeDamageOutput {
  const base = input.isHeavyAttack
    ? GAME_CONFIG.combat.baseHeavyDamage
    : GAME_CONFIG.combat.baseLightDamage;

  const velocityMultiplier = clamp(
    GAME_CONFIG.combat.minVelocityMultiplier +
      input.relativeSpeed / GAME_CONFIG.combat.velocityReferenceSpeed,
    GAME_CONFIG.combat.minVelocityMultiplier,
    GAME_CONFIG.combat.maxVelocityMultiplier
  );

  const sharpnessMultiplier =
    input.bladeDurability > 0 ? 1.0 : GAME_CONFIG.combat.dullBladeMultiplier;

  if (input.isNape) {
    // Must approach from behind or rear-flank (napeApproachCos <= napeCriticalAngleCos)
    if (input.napeApproachCos > GAME_CONFIG.combat.napeCriticalAngleCos) {
      // Glanced off throat/collar from the front! Cannot execute nape from front.
      return {
        damage: Math.round(base * 0.2 * sharpnessMultiplier),
        velocityMultiplier,
        isCriticalNapeHit: false,
        glancedOffFront: true,
      };
    }

    // Valid rear nape strike!
    const rearBonus =
      input.napeApproachCos < -0.55 ? GAME_CONFIG.combat.napeRearBonusMultiplier : 1.25;
    const damage = Math.round(base * velocityMultiplier * sharpnessMultiplier * rearBonus);
    return {
      damage,
      velocityMultiplier,
      isCriticalNapeHit: true,
      glancedOffFront: false,
    };
  }

  // Limb or Head strike
  const damage = Math.round(base * velocityMultiplier * sharpnessMultiplier);
  return {
    damage,
    velocityMultiplier,
    isCriticalNapeHit: false,
    glancedOffFront: false,
  };
}
