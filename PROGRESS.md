# TITAN HUNTER 3D — PROJECT PROGRESS REPORT

## 1. Completed Milestones (Vertical Slice — Phases 1 to 5)

### Phase 1 — Playable Movement & 3D World (`COMPLETED`)
- [x] **Project Architecture:** Vite + TypeScript + Three.js + Rapier 3D (`@dimforge/rapier3d-compat`) + Vitest setup with fixed-timestep physics (`60 Hz`) and decoupled render loop.
- [x] **Fortified European City (`300m × 300m`):** Outer walls (`38m` high) with buttresses, central plaza with a `34m` bell tower, 60+ modular multi-story timber-frame buildings with pitched roofs & balconies, cobblestone avenues, 4 glowing Supply Depots, and `InstancedMesh` trees.
- [x] **32-Bone Humanoid Character (`VanguardStrider`):** `THREE.SkinnedMesh` bound to a 32-bone `THREE.Skeleton` with ODM hip winches, gas cylinders, rear turbine thruster, flowing shoulder cloak, and hand-parented dual high-carbon mono-blades.
- [x] **18 Skeletal Animations + Procedural Layering:** `Idle`, `Walk`, `Run`, `Sprint`, `Jump`, `Fall`, `Landing`, `AirborneIdle`, `LeftHook`, `RightHook`, `DualHook`, `Swing`, `Boost`, `Dodge`, `LightAttack`, `HeavyAttack`, `HitReaction`, `Death`, plus velocity banking on `Spine1`, arm aiming toward active grapple anchors, and cape wind flutter.
- [x] **Spring-Arm Action Camera:** Mouse look (`PointerLock`), Rapier raycast wall-collision pull-in, dynamic speed FOV (`62° -> 86°`), soft target lock framing, and camera trauma shake.

### Phase 2 — ODM Gear Core Gameplay (`COMPLETED`)
- [x] **Independent Dual Grappling Hooks (`LMB`/`RMB` or `Z`/`X`):** Multi-ray assist cone targeting on building facades, roofs, watchtowers, trees, and moving Titan body parts.
- [x] **Momentum-Preserving Swing Physics (`solveODMRopeConstraints`):** True slack vs. taut cable evaluation (slack ropes never push outward; taut ropes project radial velocity into tangential pendulum speed), active reel-in, single-hook banking arcs, and symmetric dual-hook slingshots.
- [x] **Gas Propulsion (`Shift`):** Directional thruster acceleration, gas gauge consumption & grounded passive recovery, rear nozzle steam trail particles, and speed-streak HUD feedback.

### Phase 3 — Titan Enemies, AI FSM & Kinetic Combat (`COMPLETED`)
- [x] **Three Titan Variants (`6.5m – 15m`):**
  - `Normal Titan` (`6.5m – 9m`): Patrols streets, chases, and performs melee sweep & anti-air grab attacks.
  - `Abnormal Titan` (`7.5m – 11m`): Fast erratic zig-zag sprint, aggressive lunges, and wide FOV detection.
  - `Large / Colossal Vanguard Titan` (`13m – 15m`): Towering crimson-scarred behemoth with high Nape HP threshold and wide attack reach.
- [x] **Bone-Local Anatomical Hurtboxes:** `Nape` weak point parented to posterior `Neck` bone (`-Z` local offset), plus `Head`, `LeftArm`, `RightArm`, `LeftLeg`, and `RightLeg`.
- [x] **Finite-State Machine AI:** `Idle -> Patrol -> Detect -> Chase -> Attack -> Recover`, plus `Grab`, `Stunned` (eyes/arms struck), `Injured` (collapsed on knees when leg Achilles tendon is severed), and `Dead`.
- [x] **Swept-Blade Kinetic Combat (`CombatSystem`):** Samples world-space blade segments (`hilt -> tip`) during active animation frames, calculates damage from relative speed + approach angle + blade sharpness, enforces rear-angle Nape execution, cripples limbs on non-lethal hits, and triggers hit-stop + slash arc VFX.

### Phase 4 — Game Modes, Missions & HUD (`COMPLETED`)
- [x] **Training Mode (Cadet Proving Grounds):** 5-stage guided interactive drill (Ground Movement -> Dual Hooks -> Swing & Boost -> Target Lock -> Nape Execution) with aerial rings.
- [x] **Titan Hunt Mode (Defense of Valkenburg):** Multi-wave district hunt with Supply Depot refills (`R`), combo multiplier, clear time bonus, and S/A/B/C rank grading.
- [x] **Dark-Fantasy Anime Military UI/HUD:** Main Menu, Pause Menu, Settings & Debug Modal, Victory/Defeat Screen, HP/Gas/Blade gauges, spare blade pips, dynamic grapple reticle, and 3D-to-2D projected target lock indicator.

### Phase 5 — Audio, Polish, Optimization & Verification (`COMPLETED`)
- [x] **Procedural Web Audio API Synthesizer:** Hook fire/latch, gas burst, sword slash, critical nape chime, Titan footsteps & roars, and resupply audio.
- [x] **Optimization & Debug Tools:** `InstancedMesh` foliage, `ObjectPool` particle/VFX recycling, Low/Medium/High quality presets, and real-time Debug Overlay (`60 FPS` at `~115–135 draw calls`).
- [x] **Automated Verification:** 7 Vitest unit/integration suites (`npm test`) and automated headless Chrome WebGL gameplay verification with real screenshots (`0 console/runtime errors`).

---

## 2. Post-Vertical-Slice Roadmap (Future Enhancements)

- [ ] **Additional Game Modes:** Escort Supply Wagon, Defend the Outer Gatehouse (Wall Integrity bar), and Boss Raid (Armored / Beast Titan).
- [ ] **AI Squadmates:** Autonomous Scout NPCs that follow squad orders (`Engage`, `Distract Limbs`, `Regroup`).
- [ ] **Equipment Upgrade Tree:** Spend mission score to upgrade Gas Cylinder Capacity, Wire Range, Anchor Reel Torque, and Mono-Blade Durability.
- [ ] **Custom Blender High-Poly Character/Titan Sculpt Imports:** Drop-in replacement `.glb` meshes via `AssetLoader`.

---

## 3. Known Technical Notes & Considerations

- **Pointer Lock in Browsers:** Browser security requires a user mouse click inside the canvas to engage `PointerLock` for 360° mouse camera control. Pressing `Z` and `X` is also supported alongside `Left Mouse` and `Right Mouse` for grappling.
- **Frontal Nape Guard:** By design, attacking a Titan's neck from the front glances off (`GLANCED OFF FRONT!`). Players must swing behind the Titan's rear hemisphere (or sever its legs first to drop it to its knees) to execute a lethal Nape strike.
