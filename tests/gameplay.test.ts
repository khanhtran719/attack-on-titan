import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TitanAI } from '../src/ai/TitanAI';
import { HumanoidRigBuilder } from '../src/animation/HumanoidRigBuilder';
import { CombatSystem } from '../src/combat/CombatSystem';
import { GAME_CONFIG } from '../src/config/GameConfig';
import { TitanEntity } from '../src/enemies/TitanEntity';
import { TitanRigBuilder } from '../src/enemies/TitanRigBuilder';
import { MissionManager } from '../src/missions/MissionManager';
import { ODMSystem } from '../src/odm/ODMSystem';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { PlayerController } from '../src/player/PlayerController';
import {
  calculateStrikeDamage,
  evaluateNapeApproachCos,
  solveODMRopeConstraints,
  sweptBladeIntersectsHurtbox,
} from '../src/utils/MathUtils';

describe('Titan Hunter 3D — Core Gameplay, Physics, Rig & Combat Verification', () => {
  it('builds a 32-bone Player SkinnedMesh with valid skin weights and all 18 animations', () => {
    const rig = HumanoidRigBuilder.buildPlayerRig();
    expect(rig.skinnedMesh).toBeInstanceOf(THREE.SkinnedMesh);
    expect(rig.skeleton.bones.length).toBeGreaterThanOrEqual(25);
    expect(rig.skeleton.bones.length).toBeLessThanOrEqual(40);

    const geo = rig.skinnedMesh.geometry;
    expect(geo.getAttribute('skinIndex')).toBeDefined();
    expect(geo.getAttribute('skinWeight')).toBeDefined();

    const requiredAnims = [
      'Idle',
      'Walk',
      'Run',
      'Sprint',
      'Jump',
      'Fall',
      'Landing',
      'AirborneIdle',
      'LeftHook',
      'RightHook',
      'DualHook',
      'Swing',
      'Boost',
      'Dodge',
      'LightAttack',
      'HeavyAttack',
      'HitReaction',
      'Death',
    ] as const;

    for (const animName of requiredAnims) {
      expect(rig.animations.has(animName)).toBe(true);
    }
  });

  it('builds Normal, Abnormal, and Large Titan SkinnedMeshes with bone-local Nape weak points', () => {
    const normal = new TitanEntity('t1', 'normal', new THREE.Vector3(0, 0, 0), 8.0);
    const abnormal = new TitanEntity('t2', 'abnormal', new THREE.Vector3(20, 0, 0), 10.0);
    const large = new TitanEntity('t3', 'large', new THREE.Vector3(40, 0, 0), 14.5);

    expect(normal.rig.skinnedMesh).toBeInstanceOf(THREE.SkinnedMesh);
    expect(abnormal.rig.skinnedMesh).toBeInstanceOf(THREE.SkinnedMesh);
    expect(large.rig.skinnedMesh).toBeInstanceOf(THREE.SkinnedMesh);

    // Nape weak point must sit near the top of the Titan's neck (~85% of height) and behind its center (-Z when yaw=0)
    expect(normal.hurtboxes.Nape.worldPosition.y).toBeGreaterThan(6.0);
    expect(normal.hurtboxes.Nape.worldPosition.z).toBeLessThan(0);
    expect(large.hurtboxes.Nape.worldPosition.y).toBeGreaterThan(11.0);
  });

  it('handles slack vs taut ODM rope physics and preserves tangential swing velocity', () => {
    const anchor = new THREE.Vector3(0, 25, 0);

    // 1. Slack rope test (distance 15m < restLength 20m): no outward push force
    const slackPos = new THREE.Vector3(0, 10, 0); // 15m below anchor
    const slackVel = new THREE.Vector3(12, 0, 0);
    const slackRes = solveODMRopeConstraints(
      slackPos,
      slackVel,
      [{ anchorPos: anchor, restLength: 20, reelInRate: 0 }],
      new THREE.Vector3(0, 0, 0),
      false,
      1 / 60
    );
    expect(slackRes.isTaut[0]).toBe(false);
    expect(slackRes.newVelocity.x).toBeCloseTo(12, 1);

    // 2. Taut rope test (distance 22m > restLength 20m, with downward outward velocity)
    const tautPos = new THREE.Vector3(0, 3, 0); // 22m below anchor
    const tautVel = new THREE.Vector3(15, -10, 0); // moving right + falling down (away from anchor)
    const tautRes = solveODMRopeConstraints(
      tautPos,
      tautVel,
      [{ anchorPos: anchor, restLength: 20, reelInRate: 18 }],
      new THREE.Vector3(0, 0, 0),
      false,
      1 / 60
    );
    expect(tautRes.isTaut[0]).toBe(true);
    // Outward downward velocity (-10) is arrested/converted and tangential speed (+X) is conserved
    expect(tautRes.newVelocity.y).toBeGreaterThan(-1.0);
    expect(tautRes.newVelocity.x).toBeGreaterThan(15.0);
  });

  it('handles dual grappling hooks anchored on two opposite sides and releasing one hook mid-swing', () => {
    const playerPos = new THREE.Vector3(0, 6, 0);
    const playerVel = new THREE.Vector3(0, 0, -10);
    const leftAnchor = new THREE.Vector3(-18, 22, -28);
    const rightAnchor = new THREE.Vector3(18, 22, -28);

    // Dual hooks pull symmetrically toward X=0, forward -Z, and upward +Y
    const dualRes = solveODMRopeConstraints(
      playerPos,
      playerVel,
      [
        { anchorPos: leftAnchor, restLength: 32, reelInRate: 24 },
        { anchorPos: rightAnchor, restLength: 32, reelInRate: 24 },
      ],
      new THREE.Vector3(0, 0, -1),
      true,
      1 / 60
    );
    expect(Math.abs(dualRes.newVelocity.x)).toBeLessThan(0.01);
    expect(dualRes.newVelocity.z).toBeLessThan(-10);
    expect(dualRes.newVelocity.y).toBeGreaterThan(0);

    // Now release the right hook while keeping the left hook active: player banks toward the left (-X) while keeping forward (-Z) inertia
    const singleLeftRes = solveODMRopeConstraints(
      dualRes.newPosition,
      dualRes.newVelocity,
      [{ anchorPos: leftAnchor, restLength: 28, reelInRate: 24 }],
      new THREE.Vector3(0, 0, -1),
      true,
      1 / 60
    );
    expect(singleLeftRes.newVelocity.x).toBeLessThan(0);
    expect(singleLeftRes.newVelocity.z).toBeLessThan(-10);
  });

  it('enforces rear-angle Nape execution and prevents killing Titans from limb or frontal strikes', () => {
    const titan = new TitanEntity('t_combat', 'normal', new THREE.Vector3(0, 0, 0), 8.0);
    titan.yaw = 0; // Facing +Z

    // 1. Striking LeftLeg deals damage and cripples leg into Injured state, but NEVER kills the Titan
    const legRes = titan.applyZoneDamage('LeftLeg', 500);
    expect(legRes.killed).toBe(false);
    expect(legRes.limbBroken).toBe(true);
    expect(titan.aiState).toBe('Injured');
    expect(titan.isDead()).toBe(false);

    // 2. Attacking Nape from the FRONT (player at +Z in front of Titan) glances off and cannot kill
    const frontAttackerPos = new THREE.Vector3(0, 6.8, 4.0);
    const frontCos = evaluateNapeApproachCos(
      frontAttackerPos,
      titan.position,
      titan.getForwardVector()
    );
    expect(frontCos).toBeGreaterThan(0.5);

    const frontDmg = calculateStrikeDamage({
      isHeavyAttack: true,
      relativeSpeed: 30,
      bladeDurability: 100,
      isNape: true,
      napeApproachCos: frontCos,
    });
    expect(frontDmg.glancedOffFront).toBe(true);
    expect(frontDmg.isCriticalNapeHit).toBe(false);

    // 3. Attacking Nape from BEHIND (player at -Z behind Titan) at high speed triggers Critical Nape Execution!
    const rearAttackerPos = new THREE.Vector3(0, 6.8, -3.5);
    const rearCos = evaluateNapeApproachCos(
      rearAttackerPos,
      titan.position,
      titan.getForwardVector()
    );
    expect(rearCos).toBeLessThan(-0.8);

    const rearDmg = calculateStrikeDamage({
      isHeavyAttack: true,
      relativeSpeed: 28,
      bladeDurability: 100,
      isNape: true,
      napeApproachCos: rearCos,
    });
    expect(rearDmg.glancedOffFront).toBe(false);
    expect(rearDmg.isCriticalNapeHit).toBe(true);
    expect(rearDmg.damage).toBeGreaterThan(titan.hurtboxes.Nape.hp);

    const killRes = titan.applyZoneDamage('Nape', rearDmg.damage);
    expect(killRes.killed).toBe(true);
    expect(titan.isDead()).toBe(true);
  });

  it('accurately detects swept-blade collision against a moving and rotating Titan Nape', () => {
    const titan = new TitanEntity('t_moving', 'abnormal', new THREE.Vector3(10, 0, -20), 9.0);
    titan.yaw = Math.PI / 3;
    titan.position.set(14, 0, -16);
    titan.update(0.1);

    const napePos = titan.hurtboxes.Nape.worldPosition.clone();
    const radius = titan.hurtboxes.Nape.radius;

    // Blade sweep that slices across the moving Nape position
    const hit = sweptBladeIntersectsHurtbox(
      napePos.clone().add(new THREE.Vector3(-1.5, 0, -0.5)),
      napePos.clone().add(new THREE.Vector3(-1.5, 0, 1.2)),
      napePos.clone().add(new THREE.Vector3(1.5, 0, -0.5)),
      napePos.clone().add(new THREE.Vector3(1.5, 0, 1.2)),
      napePos,
      radius
    );
    expect(hit).toBe(true);

    // Blade swing far away (10m off) must not register a hit
    const miss = sweptBladeIntersectsHurtbox(
      napePos.clone().add(new THREE.Vector3(10, 0, 0)),
      napePos.clone().add(new THREE.Vector3(11, 0, 0)),
      napePos.clone().add(new THREE.Vector3(10, 1, 0)),
      napePos.clone().add(new THREE.Vector3(11, 1, 0)),
      napePos,
      radius
    );
    expect(miss).toBe(false);
  });

  it('detaches ODM hooks when out of range, when player dies mid-swing, and cleans up on repeated resets', async () => {
    const scene = new THREE.Scene();
    const physics = new PhysicsWorld();
    await physics.init();

    const odm = new ODMSystem(scene, physics);
    const player = new PlayerController(scene);
    const missions = new MissionManager(scene);

    // Simulate active hooks
    odm.leftHook.active = true;
    odm.leftHook.anchorPos.set(0, 20, -20);
    odm.leftHook.restLength = 25;

    // 1. Hook breaks when player moves beyond maxGrappleRange * 1.22
    odm.stepPhysics(
      1 / 60,
      new THREE.Vector3(0, 2, 120), // > 110m from anchor
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
      false,
      []
    );
    expect(odm.leftHook.active).toBe(false);

    // 2. Player dying while swinging releases all hooks immediately
    odm.leftHook.active = true;
    odm.rightHook.active = true;
    const dummyAudio = {
      playBladeImpact: () => {},
    } as any;
    player.takeDamage(999, new THREE.Vector3(0, 0, 1), odm, dummyAudio);
    expect(player.isDead()).toBe(true);
    expect(odm.leftHook.active).toBe(false);
    expect(odm.rightHook.active).toBe(false);

    // 3. Repeated mission resets do not leak Titan rootGroups in scene
    const spawns = [new THREE.Vector3(20, 0, 20), new THREE.Vector3(-20, 0, -20)];
    const baseChildren = scene.children.length;
    for (let i = 0; i < 5; i++) {
      missions.startMission('hunt', player, spawns);
    }
    missions.clearTitans();
    expect(scene.children.length).toBe(baseChildren);
  });

  it('supports Phase 7 Thunder Spear AoE blasts, Levi Spin-Slash multi-zone hits, and Titan Grab Escape Counter', async () => {
    const scene = new THREE.Scene();
    const physics = await PhysicsWorld.create();
    const odm = new ODMSystem(scene, physics);
    const player = new PlayerController(scene);
    const combat = new CombatSystem();
    const dummyAudio = {
      playBladeImpact: () => {},
      playSwordSlash: () => {},
      playGrabEscape: () => {},
      playResupply: () => {},
    } as any;

    // 1. Thunder Spear Aiming & AoE Detonation
    const titan = new TitanEntity('t_phase7', 'normal', new THREE.Vector3(0, 0, -20), 8.0);
    titan.syncHurtboxWorldPositions();
    expect(player.thunderSpears).toBe(GAME_CONFIG.player.maxThunderSpears);

    const aimRes = combat.aimThunderSpear(
      new THREE.Vector3(0, 4, 0),
      new THREE.Vector3(0, 0.15, -1).normalize(),
      player.position,
      [titan]
    );
    expect(aimRes.hitTitan?.id).toBe('t_phase7');

    const hitEvents: any[] = [];
    combat.detonateThunderSpear(
      titan.hurtboxes.RightArm.worldPosition.clone(),
      titan,
      'RightArm',
      [titan],
      (evt) => hitEvents.push(evt)
    );
    // Thunder Spear blast shatters RightArm AND splashes nearby zones, stunning the Titan
    expect(hitEvents.length).toBeGreaterThanOrEqual(1);
    expect(hitEvents.some((e) => e.isThunderSpear && e.limbBroken)).toBe(true);
    expect(titan.aiState).toBe('Stunned');

    // 2. Titan Grab Capture & Self-Escape Counter-Slash
    const grabTitan = new TitanEntity('t_grabber', 'normal', new THREE.Vector3(0, 0, 0), 8.0);
    grabTitan.syncHurtboxWorldPositions();

    const grabResult = player.captureByTitanGrab(
      grabTitan,
      14,
      odm,
      dummyAudio
    );
    expect(grabResult).toBe('grabbed');
    expect(player.grabbedByTitanId).toBe('t_grabber');
    expect(grabTitan.grabbedPlayerId).toBe('local');

    // Mash [F] (attackJustPressed) 3 times to sever the Titan's grabbing hand and escape!
    const dummyCam = {
      getFlatForwardVector: () => new THREE.Vector3(0, 0, -1),
      getRightVector: () => new THREE.Vector3(1, 0, 0),
      getForwardVector: () => new THREE.Vector3(0, 0, -1),
      camera: { position: new THREE.Vector3(0, 2, 5) },
    } as any;

    for (let i = 0; i < 3; i++) {
      player.stepPhysics(
        1 / 60,
        {
          moveForward: 0,
          moveRight: 0,
          jumpPressed: false,
          jumpHeld: false,
          leftGrappleHeld: false,
          leftGrappleJustPressed: false,
          rightGrappleHeld: false,
          rightGrappleJustPressed: false,
          boostHeld: false,
          attackJustPressed: true,
          thunderSpearJustPressed: false,
          dodgeJustPressed: false,
          lockTargetJustPressed: false,
          cycleZoneDelta: 0,
          resupplyJustPressed: false,
          interactJustPressed: false,
          interactHeld: false,
          pingJustPressed: false,
          quickChatKey: null,
          pauseJustPressed: false,
          mouseDeltaX: 0,
          mouseDeltaY: 0,
          pointerLocked: true,
        },
        dummyCam,
        physics,
        odm,
        combat,
        [grabTitan],
        dummyAudio
      );
    }

    expect(player.grabbedByTitanId).toBeNull();
    expect(grabTitan.grabbedPlayerId).toBeNull();
    expect(grabTitan.hurtboxes.RightArm.disabledTimer).toBeGreaterThan(0);
    expect(grabTitan.aiState).toBe('Stunned');
    expect(player.velocity.y).toBeGreaterThan(10);
  });
});
