# 01 — Current State Audit

**Project:** Titan Hunter 3D (`khanhtran719/attack-on-titan`)  
**Audited GitHub main HEAD:** [`6836b594c8460566e0305ebf461ca993ffb735bf`](https://github.com/khanhtran719/attack-on-titan/commit/6836b594c8460566e0305ebf461ca993ffb735bf)  
**Audit date:** 2026-11-11 (Asia/Ho_Chi_Minh)  
**Evidence level:** Source/static audit + reported GitHub Actions results. **No local clone, browser execution or independent FPS profiling.** A CI-successful function is not necessarily visually or interactively polished.

## 1. Repository and history

GitHub tree reported **93 entries**. Key files: `src/core/GameEngine.ts`, `src/physics/PhysicsWorld.ts`, `src/odm/ODMSystem.ts`, `src/utils/MathUtils.ts`, `src/animation/*`, `src/enemies/*`, `src/combat/CombatSystem.ts`, `src/missions/MissionManager.ts`, `src/network/*`, `src/server/*`, `src/shared/*`, `src/world/CityBuilder.ts`, `src/rendering/*`, `src/ui/*`, `tests/{gameplay,multiplayer}.test.ts`, `.github/workflows/ci.yml`. Read repository `README.md`, `PROGRESS.md`, `docs/ARCHITECTURE.md`, `docs/GAME_DESIGN.md`, `docs/MULTIPLAYER_ARCHITECTURE.md`, `docs/TECHNICAL_HARDENING.md`. No `AGENTS.md` or stand-alone `TODO` in GitHub tree.

| Commit | Date (UTC) | Audit significance |
|---|---|---|
| `6836b59` | Nov 11, 04:44 | Only `package.json` changes: Docker build `--no-cache` and `--platform linux/amd64`; gameplay unchanged from prior head |
| `ba46c36` | Nov 9, 06:45 | Server Thunder Spear projectile step, aim validation, reconnect timeout |
| `d5e3d8f` | Nov 9, 04:29 | CI, UI controllers, physics/session hardening and resource cleanup |
| `d197497` | Nov 9, 02:24 | Docker and deployment configurations |

Latest CI: [run #42961187961](https://github.com/khanhtran719/attack-on-titan/actions/runs/42961187961), GitHub reports success. Workflow runs `npm ci`, `npm run generate-assets`, TypeScript/Vite build and `npm test`; **no committed browser-based E2E or profiling gate**. `PROGRESS.md` describes prior headless Playwright verification, but it is not independently reproducible from current committed CI. `playwright-core` being installed does not amount to E2E coverage. No working tree status available via remote GitHub API; local uncommitted files cannot be determined.

## 2. Runtime architecture

- **Bootstrap/client loop**: `src/main.ts`; `src/core/GameEngine.ts` lines **77–153** initialisation, **700–1230** `requestAnimationFrame` control and frame pipeline, including fixed-step accumulator and render/HUD. Entity-oriented classes and Three.js scene graph; **not an ECS**.
- **Rendering**: `RendererManager.ts` lines **10–114** creates `WebGLRenderer`, MSAA, up to DPR 2, directional PCF shadows (2048 High / 1024 Medium), ACES tone mapping, fog; `getRenderStats` captures calls/triangles. `CityBuilder.ts` generates architecture/materials, instances foliage (lines **388–425**). No confirmed scene streaming/occlusion/LOD.
- **Physics**: Rapier WASM `PhysicsWorld.ts`, lines **65–143** actor registry, **293–382** character controller movement, **391–465** collision raycasts/line of sight, **143–200** world disposal. World geometry comes from shared `src/shared/CityLayout.ts`.
- **ODM**: `ODMSystem.ts` lines **211–280** reticle probe, **281–387** hook firing and target selection, **442–515** rope step, **517–568** wires. Mathematical core in `MathUtils.ts` lines **48–179** (`solveODMRopeConstraints`): slack/taut, tangential momentum, two-anchor pull, steering, reeling.
- **Character**: `PlayerController.ts` lines **240–718** interprets ground, air, boost, dodge, grapple and collision; `ActionCamera.ts` lines **83–239** smoothing, obstacle raycast, dynamic FOV and shake.
- **Animation/assets**: `HumanoidRigBuilder.ts` lines **182–774** generates a 32-bone skinned humanoid with mesh parts, gear and swords; lines **811–1519** synthesize 18 animation clips. `PlayerAnimator.ts` lines **39–211** blends named clips, adds banking, shoulder aiming and cape motion. `TitanRigBuilder.ts` procedural skeleton, segments and keyframed animations. `AssetLoader.ts` wraps `GLTFLoader` plus cache.
- **AI**: Single-player `TitanAI.ts` lines **15–274**, obstacle steering **300–360**; server `ServerTitanSim.ts` lines **396–660**, steering **721–776**. Both use finite-state logic and AABB/whisker avoidance, not full navmesh pathfinding.
- **Combat/missions**: `CombatSystem.ts` lines **357–548** performs animation-space swept-blade hit checking; Nape/limb logic, Thunder Spear, Dodge/Spin. `MissionManager.ts` lines **74–185** training/hunt and two wave mission, **189–277** co-op Titan snapshot application. Progression/boss/forest remain roadmap.
- **Networking**: `NetworkClient.ts` lines **121–197** prediction/reconciliation, **198–282** lobby, **283–511** reconnect deadline/backoff and late socket cleanup, **634–657** outbound messages; `RemotePlayerManager.ts` lines **55–92**, **170–298** interpolation (85ms delay, 180ms extrapolation). `src/shared/Protocol.ts` describes messages and state. **Colyseus session management + custom `room_snapshot`, `attack_intent`, `input_frame`, `combat_event` payloads**, not only standard Schema replication.
- **Server**: `CoopHunterRoom.ts` lines **232–520** lifecycle, **548–686** message handlers, **856–950** authoritative tick, **1281–1499** movement, **1533–1709** hook validation, **1747–2336** projectile, **2337–2629** melee. Node/TypeScript server uses Rapier and Colyseus; authoritative state should remain the truth.
- **UI/persistence**: `UIManager.ts`, `HudController.ts`, `TacticalOverlayController.ts`, `WorldMarkersController.ts`, `InputManager.ts`, `SaveManager.ts`; HTML/CSS overlays and browser local persistence. No separate Godot assets or project currently exist.

## 3. Feature inventory and status

Legend: **Implemented** = real code + supporting tests where noted; **Partial** = code with known quality gap; **Experimental** = unproven platform/gameplay; **Placeholder** = no functional model/content; **Missing** = absent. **Broken** reserved for reproducible failure, not suspected flaws.

| Feature | Source location | Current implementation | Quality/evidence | Problems | Migration difficulty | Godot equivalent |
|---|---|---|---|---|---|---|
| City rendering | `RendererManager`, `CityBuilder` | Procedural scene, lighting, foliage | Implemented; no FPS proof | Resource lifecycle, LOD | M–H | `WorldEnvironment`, `MeshInstance3D`, `MultiMeshInstance3D` |
| Character movement | `PlayerController`, `PhysicsWorld` | Rapier kinematic actor and 60Hz stepping | Implemented; tests basic | Re-tuning character collision if ported | H | `CharacterBody3D`, `move_and_slide()` |
| Dual-hook ODM | `ODMSystem`, `MathUtils`, `WorldGrappleSolver` | World/Titan hooks, reel, swing and momentum | Implemented; math unit tests | Frame/collision feel not measured | **Very high** | `RayCast3D`/`PhysicsDirectSpaceState3D` + custom solver |
| Camera | `ActionCamera` | Third-person, collision, lock-on/FOV/shake | Implemented | Camera feel/correction unmeasured | M | `Camera3D`, `SpringArm3D`, custom damping |
| Player visual | `HumanoidRigBuilder` | Runtime procedural `SkinnedMesh`, 32 bones | Implemented; aesthetic quality unverified | Code-specific geometry and bones | **Very high** | `Skeleton3D`, `Skin`, `ArrayMesh` / glTF |
| Animation | `HumanoidRigBuilder`, `PlayerAnimator` | 18 programmatic clips + procedural overlays | Partial in natural motion quality | No established foot IK / stride sync | H | `AnimationPlayer`, `AnimationTree`, `SkeletonModifier3D` |
| Titan models/AI | `TitanRigBuilder`, `TitanAI`, `ServerTitanSim` | Three variants, FSM, hurtboxes | Implemented; behavioral polish partial | Rigid deformation, basic obstacle logic | H | `Skeleton3D`, `NavigationAgent3D`, FSM |
| Sword combat | `CombatSystem`, `CoopHunterRoom` | Local swept blade; authoritative server hit check | Implemented; client/server parity partial | Different hit semantics | H | `Area3D`, shape query, shared attack definitions |
| Thunder Spear | `CoopHunterRoom`, `VFXManager` | Server projectile + local visual | Implemented; presentation partial | VFX/server timing divergence possible | M–H | projectile state node + `GPUParticles3D` |
| Singleplayer missions | `MissionManager` | Training, two hunt waves | Implemented | Content variety limited | M | Mission state resources/manager |
| 2–4 multiplayer | `NetworkClient`, `CoopHunterRoom`, `Protocol` | Room join, custom snapshot, prediction, reconnect | Implemented and test-covered at logic level | Godot protocol adapter uncertain | **Very high** | Colyseus SDK/adapter + `WebSocketPeer` fallback |
| Minimal Cinematic HUD | `UIManager`, controllers, CSS | DOM UI | Implemented | Full rewrite needed | M | `CanvasLayer`, `Control`, `Theme` |
| GLB character assets | `public/assets/models/*`, generator | Minimal JSON-only GLB scene nodes | **Placeholder** | No geometry, rig or clips | H | Generated valid skinned glTF 2.0 |
| Performance profiling | `RendererManager` stats, debug | FPS/triangles/draw-call counters | Partial | No repeatable p95/p99 benchmark | M | Godot/Chrome profiling harness |
| Progression/boss/new region | `PROGRESS.md` roadmap | Proposed | **Missing** | Not a migration deliverable | H | Future gameplay design |

## 4. Concrete technical risks (source-backed)

| Severity | Exact evidence | Why it matters | Action, independent of engine |
|---|---|---|---|
| **P0 before public deployment** | `src/server/index.ts:75–112`, `/api/metrics` returns per-room metrics without auth | Operational data and possible private room code leakage | Restrict to admin/private network and redact identifiers |
| P1 | `CityBuilder.ts:36–78` rebuild calls `clearWorld()` which detaches children but does not dispose world-owned geometry/material/texture | CPU/GPU memory may grow over restart cycles | Track resource ownership, `dispose` and soak-test |
| P1 | `VFXManager.ts:152–178,273–334`; `GameEngine.ts:1000–1062`; `CoopHunterRoom.ts:2010–2213` | Visual Thunder Spear may explode independently from authoritative collision | Couple VFX by `projectileId` and impact event |
| P1 | `MissionManager.ts:189–277`; `GameEngine.ts:321–510,700–780,960–990` | Snapshot sync advances Titan animation alongside render updates; may double-count time | Split snapshot state application from render tick; instrument |
| P1 | `CombatSystem.ts:357–548` vs `CoopHunterRoom.ts:2337–2629` | Solo/client animated blade sweep vs server simplified hit check | Shared attack timing and server validated sweep proxy |
| P1 | `.github/workflows/ci.yml` | CI success does not prove browser export, latency, feel, visuals or FPS | Browser E2E, telemetry, scenario benchmarking |
| P2 | `TitanRigBuilder.ts:37–83` sets cylindrical limb `boneA=1`, `boneB=0` skin weights | Stiff joint deformation survives engine swap | Smooth joint skin weights + pose test |
| P2 | `TitanAI.ts:300–360`, `ServerTitanSim.ts:721–776` | Whisker/AABB obstacle avoidance can stick on complex routes | Route graph/navigation and local avoidance |
| P2 | `GameEngine.ts` (~1505 lines), `CoopHunterRoom.ts` (~3060), `UIManager.ts` (~1351) | Large modules harder to test and port | Incrementally isolate systems and interfaces |

**Additional potential timing anomaly:** `CoopHunterRoom.stepAuthoritativeSimulation` uses `authoritativeDt` for players but accepts a clamped callback `dt` for `stepProjectiles` (`CoopHunterRoom.ts:856–905`). Verify that callbacks cannot produce different effective simulation durations in production. This is a code-level risk, not demonstrated cheating/desync.

## 5. Findings that cannot be claimed

- Neither 60FPS nor input latency is established on a target machine in this audit.
- No in-browser eyes-on animation/collision check was performed.
- No server capacity, room density, real bandwidth or long-running memory stability was benchmarked.
- CI success is verified from GitHub metadata, not rerun locally.
- Godot web export compatibility for this concrete game has not been validated yet.

**Source anchor:** https://github.com/khanhtran719/attack-on-titan/tree/6836b594c8460566e0305ebf461ca993ffb735bf
