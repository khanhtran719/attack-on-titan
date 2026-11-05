import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { clamp, damp, lerpAngle } from '../utils/MathUtils';

export class ActionCamera {
  public readonly camera: THREE.PerspectiveCamera;
  public yaw = 0;
  public pitch = 0.18;
  public sensitivity = 1.0;
  public targetDistance = GAME_CONFIG.camera.shoulderOffset.z + 5.8;

  private smoothedPivot = new THREE.Vector3(0, 2, 0);
  private currentDistance = 5.8;
  private shakeIntensity = 0;
  private shakeTimer = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(
      GAME_CONFIG.camera.baseFov,
      aspect,
      0.2,
      480
    );
  }

  public addShake(intensity: number, duration = 0.18): void {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeTimer = Math.max(this.shakeTimer, duration);
  }

  public getForwardVector(): THREE.Vector3 {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return dir.normalize();
  }

  public getFlatForwardVector(): THREE.Vector3 {
    const forward = new THREE.Vector3(
      -Math.sin(this.yaw),
      0,
      -Math.cos(this.yaw)
    );
    return forward.normalize();
  }

  public getRightVector(): THREE.Vector3 {
    const forward = this.getFlatForwardVector();
    return new THREE.Vector3(-forward.z, 0, forward.x).normalize();
  }

  public update(
    dt: number,
    mouseDeltaX: number,
    mouseDeltaY: number,
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    isBoosting: boolean,
    lockedTargetPos: THREE.Vector3 | null,
    physics: PhysicsWorld
  ): void {
    const mouseScale = 0.0022 * this.sensitivity;
    this.yaw -= mouseDeltaX * mouseScale;
    this.pitch = clamp(
      this.pitch - mouseDeltaY * mouseScale,
      GAME_CONFIG.camera.minPitch,
      GAME_CONFIG.camera.maxPitch
    );

    // Soft lock-on camera tracking when target is locked and user isn't rapidly flicking mouse
    if (lockedTargetPos && Math.hypot(mouseDeltaX, mouseDeltaY) < 4.0) {
      const toTarget = new THREE.Vector3().subVectors(
        lockedTargetPos,
        this.smoothedPivot
      );
      const flatLen = Math.hypot(toTarget.x, toTarget.z);
      if (flatLen > 1.5) {
        const desiredYaw = Math.atan2(-toTarget.x, -toTarget.z);
        const desiredPitch = clamp(
          Math.atan2(toTarget.y, flatLen) * 0.65,
          GAME_CONFIG.camera.minPitch,
          GAME_CONFIG.camera.maxPitch
        );
        this.yaw = lerpAngle(this.yaw, desiredYaw, 3.8 * dt);
        this.pitch = damp(this.pitch, desiredPitch, 3.5, dt);
      }
    }

    // Compute desired pivot with subtle velocity look-ahead
    const lookAhead = playerVel
      .clone()
      .multiplyScalar(GAME_CONFIG.camera.lookAheadVelocityFactor);
    lookAhead.y *= 0.35;

    const targetPivot = new THREE.Vector3(
      playerPos.x + lookAhead.x,
      playerPos.y + GAME_CONFIG.camera.shoulderOffset.y + lookAhead.y,
      playerPos.z + lookAhead.z
    );

    this.smoothedPivot.x = damp(
      this.smoothedPivot.x,
      targetPivot.x,
      GAME_CONFIG.camera.followSmoothTime,
      dt
    );
    this.smoothedPivot.y = damp(
      this.smoothedPivot.y,
      targetPivot.y,
      GAME_CONFIG.camera.followSmoothTime,
      dt
    );
    this.smoothedPivot.z = damp(
      this.smoothedPivot.z,
      targetPivot.z,
      GAME_CONFIG.camera.followSmoothTime,
      dt
    );

    // Compute spherical offset behind character
    const cosPitch = Math.cos(this.pitch);
    const sinPitch = Math.sin(this.pitch);
    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);

    // Camera backward unit vector
    const backDir = new THREE.Vector3(
      sinYaw * cosPitch,
      -sinPitch,
      cosYaw * cosPitch
    ).normalize();

    const rightDir = this.getRightVector();
    const pivotWithShoulder = this.smoothedPivot
      .clone()
      .addScaledVector(rightDir, GAME_CONFIG.camera.shoulderOffset.x);

    // Raycast from pivot toward desired camera position to prevent wall clipping
    let allowedDist = this.targetDistance;
    const hit = physics.castRay(
      pivotWithShoulder,
      backDir,
      this.targetDistance + GAME_CONFIG.camera.wallClearanceRadius,
      false
    );
    if (hit) {
      allowedDist = Math.max(
        1.1,
        hit.distance - GAME_CONFIG.camera.wallClearanceRadius
      );
    }

    // Pull in fast on collision, ease out smoothly when clear
    if (allowedDist < this.currentDistance) {
      this.currentDistance = damp(this.currentDistance, allowedDist, 28, dt);
    } else {
      this.currentDistance = damp(this.currentDistance, allowedDist, 9, dt);
    }

    const camPos = pivotWithShoulder
      .clone()
      .addScaledVector(backDir, this.currentDistance);
    // Keep camera above ground
    camPos.y = Math.max(0.55, camPos.y);

    // Apply camera shake if active
    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
      const s = this.shakeIntensity * (this.shakeTimer / 0.2);
      camPos.x += (Math.random() * 2 - 1) * s;
      camPos.y += (Math.random() * 2 - 1) * s;
      camPos.z += (Math.random() * 2 - 1) * s;
      if (this.shakeTimer <= 0) {
        this.shakeIntensity = 0;
      }
    }

    this.camera.position.copy(camPos);

    const lookAtPoint = pivotWithShoulder
      .clone()
      .addScaledVector(backDir, -18.0);
    this.camera.lookAt(lookAtPoint);

    // Dynamic FOV based on player speed & gas boost
    const speed = playerVel.length();
    const speedRatio = clamp((speed - 9.0) / 36.0, 0, 1);
    const boostBonus = isBoosting ? 5.5 : 0;
    const desiredFov = clamp(
      GAME_CONFIG.camera.baseFov +
        speedRatio * (GAME_CONFIG.camera.maxBoostFov - GAME_CONFIG.camera.baseFov) +
        boostBonus,
      GAME_CONFIG.camera.baseFov,
      GAME_CONFIG.camera.maxBoostFov
    );

    this.camera.fov = damp(
      this.camera.fov,
      desiredFov,
      GAME_CONFIG.camera.fovLerpSpeed,
      dt
    );
    this.camera.updateProjectionMatrix();
  }
}
