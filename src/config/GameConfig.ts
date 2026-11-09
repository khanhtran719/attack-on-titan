export type GraphicsQuality = 'low' | 'medium' | 'high';
export type TacticalOverlayKeyMode = 'KeyH' | 'Tab';

export interface DebugOptions {
  showColliders: boolean;
  showGrappleAnchors: boolean;
  showTitanHitboxes: boolean;
  showWeakPoints: boolean;
  showVelocityVectors: boolean;
  showAIStates: boolean;
  showPerformanceOverlay: boolean;
}

export interface UserSettings {
  mouseSensitivity: number;
  cameraDistance: number;
  graphicsQuality: GraphicsQuality;
  masterVolume: number;
  tacticalOverlayKey?: TacticalOverlayKeyMode;
  debug: DebugOptions;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  mouseSensitivity: 1.0,
  cameraDistance: 5.8,
  graphicsQuality: 'high',
  masterVolume: 0.7,
  tacticalOverlayKey: 'KeyH',
  debug: {
    showColliders: false,
    showGrappleAnchors: false,
    showTitanHitboxes: false,
    showWeakPoints: false,
    showVelocityVectors: false,
    showAIStates: false,
    showPerformanceOverlay: false,
  },
};

export const GAME_CONFIG = {
  physics: {
    fixedTimestep: 1 / 60,
    maxSubSteps: 4,
    gravity: -22.0,
    hookedGravityScale: 0.72,
    terminalVelocity: 54.0,
    groundFriction: 11.0,
    airDrag: 0.016,
  },

  player: {
    capsuleHalfHeight: 0.55,
    capsuleRadius: 0.35,
    eyeHeight: 1.55,
    walkSpeed: 5.5,
    runSpeed: 9.5,
    sprintSpeed: 13.5,
    jumpVelocity: 10.5,
    airControlAccel: 18.0,
    dodgeImpulse: 22.0,
    dodgeDuration: 0.38,
    dodgeCooldown: 0.75,
    perfectDodgeWindow: 0.2,
    maxHealth: 100,
    maxGas: 100,
    maxBladeDurability: 100,
    maxSpareBlades: 6,
    maxThunderSpears: 4,
  },

  odm: {
    maxGrappleRange: 88.0,
    aimAssistConeAngleRad: 0.14, // ~8 degrees assist cone for high-speed building/Titan hooks
    wireShootSpeed: 180.0, // visual wire deployment speed (m/s)
    reelInSpeedBase: 19.0,
    reelInSpeedBoost: 33.0,
    minRopeLength: 2.2,
    ropeStiffness: 42.0,
    ropeDamping: 0.92,
    swingSteeringAccel: 26.0,
    tangentialBoostFactor: 1.18,
    gasBoostAccel: 38.0,
    gasConsumptionBoostPerSec: 13.5,
    gasConsumptionReelPerSec: 3.5,
    gasPassiveRegenGroundedPerSec: 2.5,
    maxAirSpeed: 50.0,
  },

  combat: {
    lightAttackDuration: 0.44,
    heavyAttackDuration: 0.62,
    attackActiveStartNorm: 0.18,
    attackActiveEndNorm: 0.76,
    attackCooldown: 0.18,
    bladeReach: 2.35,
    baseLightDamage: 190,
    baseHeavyDamage: 320,
    velocityReferenceSpeed: 16.0,
    maxVelocityMultiplier: 3.0,
    minVelocityMultiplier: 0.65,
    napeCriticalAngleCos: -0.15, // requires approaching from rear/side-rear hemisphere
    napeRearBonusMultiplier: 1.55,
    dullBladeMultiplier: 0.35,
    bladeDurabilityLossPerHit: 14,
    bladeDurabilityLossHardHit: 22,
    hitStopDuration: 0.065,
    comboResetTime: 6.5,
    thunderSpearSpeed: 95,
    thunderSpearRange: 75,
    thunderSpearBaseDamage: 580,
    thunderSpearSplashDamage: 340,
    thunderSpearBlastRadius: 6.5,
    thunderSpearCooldown: 0.85,
    grabHoldDuration: 3.5,
    grabCrushDps: 10,
    grabEscapeStep: 0.38,
  },

  camera: {
    baseFov: 62,
    maxBoostFov: 86,
    fovLerpSpeed: 7.5,
    minPitch: -1.15,
    maxPitch: 1.25,
    followSmoothTime: 16.0,
    lookAheadVelocityFactor: 0.065,
    shoulderOffset: { x: 0.55, y: 1.65, z: 0 },
    wallClearanceRadius: 0.35,
  },

  world: {
    citySize: 300, // 300 x 300 meters
    wallHeight: 38,
    wallThickness: 10,
    buildingCountTarget: 68,
    minStreetWidth: 16,
    plazaRadius: 34,
    resupplyRange: 8.5,
  },

  titans: {
    normal: {
      name: 'Normal Titan',
      minHeight: 6.5,
      maxHeight: 9.0,
      napeHp: 340,
      limbHp: 210,
      walkSpeed: 3.8,
      chaseSpeed: 7.4,
      turnSpeed: 2.4,
      detectRange: 75,
      fovCos: -0.2,
      attackRange: 6.2,
      attackDamage: 28,
      grabDamage: 42,
      injuredDuration: 12.0,
      stunnedDuration: 6.0,
      scoreValue: 1000,
    },
    abnormal: {
      name: 'Abnormal Titan',
      minHeight: 7.5,
      maxHeight: 11.0,
      napeHp: 460,
      limbHp: 250,
      walkSpeed: 5.6,
      chaseSpeed: 13.8,
      turnSpeed: 4.2,
      detectRange: 95,
      fovCos: -0.4,
      attackRange: 7.4,
      attackDamage: 34,
      grabDamage: 48,
      injuredDuration: 10.0,
      stunnedDuration: 5.5,
      scoreValue: 1500,
    },
    large: {
      name: 'Colossal Vanguard Titan',
      minHeight: 13.0,
      maxHeight: 15.0,
      napeHp: 780,
      limbHp: 400,
      walkSpeed: 3.2,
      chaseSpeed: 5.8,
      turnSpeed: 1.7,
      detectRange: 110,
      fovCos: -0.3,
      attackRange: 9.8,
      attackDamage: 46,
      grabDamage: 60,
      injuredDuration: 14.0,
      stunnedDuration: 6.5,
      scoreValue: 2500,
    },
  },
} as const;
