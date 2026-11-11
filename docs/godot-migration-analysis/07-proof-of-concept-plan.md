# 07 — Proof-of-Concept & Validation Plan

**Objective:** Decide whether Godot 4.x Web client improves development and gameplay outcomes for Titan Hunter 3D **with existing Node/Colyseus backend retained**. A demonstration of editor-only/native Godot gameplay is insufficient.

## 1. Non-negotiable PoC gates

- Export and run in the **desktop web browser**, using Godot Compatibility/WebGL2, GDScript and a pinned stable engine version.
- Connect to **unmodified existing Colyseus server**, not a substitute WebSocket mock, for the final multiplayer milestone.
- Support same procedural player mesh and a valid skeleton/skin/animation: current `.glb` files are placeholders and must be replaced or generated afresh.
- Recreate input-responsive movement, third-person camera, one- and two-hook ODM, one Titan AI, animation, Nape hit and basic authoritative combat.
- Test 2 players then 4 players, including reconnect, snapshot interpolation and prediction vs server physics at varying RTT.
- Compare **same** visual/physics target scene against current Three.js in web browser. Publish raw traces and analysis, not a screenshot-only success claim.

## 2. Representative vertical slice

**Scene: First Hunt City Avenue.** Two adjacent building rows with grab surfaces; plaza; one supply point; one Normal Titan; one procedurally generated 32-bone scout with sword/ODM sockets; shadow/light baseline matching original; optional 3 replicated teammates. Scripted scenario: sprint, left hook, dual hook, boost, release, land, target lock, approach from behind, Nape strike, receive score/damage event, respawn/restart. Do not add bosses, new weapon types, forests or progression.

## 3. Validation matrix

| ID | Test | Pass evidence | Failure / stop condition |
|---|---|---|---|
| WEB-01 | Export Godot 4.x Compatibility HTML5, load HTTPS | Browser console/log, supported GPU list, startup duration | Black screen/unsupported WebGL2/extension failure |
| NET-01 | Colyseus create/list/join room on existing server | Browser packet trace and server event, exact room ID | Can't complete SDK handshake |
| NET-02 | `room_snapshot`, `input_frame`, `combat_event`, `lobby_action` | Golden fixtures round-trip, 2-client room | Message type/serialization mismatch |
| NET-03 | 4 clients, reconnect after 3s offline, leave/rejoin | No duplicate session/orphan sockets, token expiry handling | Session hijack/state corruption |
| ANIM-01 | Generated GLB with mesh/skin, Idle/Run/Swing | glTF validation, screenshot pose gallery | Metadata-only GLB or wrong bone weights |
| ANIM-02 | Hook arm aims at anchor, foot contact | Frame captures at ground/air/attack | Severe clipping or wrong bone transforms |
| PHYS-01 | Same Rapier/Godot free fall, wall slide, corner collisions | Numeric trace + collision footage | Penetration/large drift |
| ODM-01 | Single hook, dual hook, reel, release and gas boost | 60Hz baseline trajectory comparison, camera recording | Broken core mobility |
| ODM-02 | Free-world hooks without target lock, rooftop edge | Target ray results and pass/fail counts | Surfaces cannot be latched consistently |
| HIT-01 | Back-of-nape strike, blocked front attack, wall LOS | Authoritative event log, hit VFX synchronized | Client decides damage / through-wall hit |
| FPS-01 | 1366×768,1080p,1440p + presets | Same-scene p95/p99 frame times, 1% low | Measurable performance regression over agreed bound |
| MEM-01 | Restart 20×; 10min 4-player scene | Heap/GPU allocation slope and stats | Monotonic growth indicative of leak |
| LAT-01 | RTT 0,50,100,200ms + jitter/loss | Correction p95/maximum, input traces | Rubber-banding or frequent state divergence |
| UX-01 | pointer lock, focus loss, pause, UI scaling | Browser automation + manual playtest | Controls unusable in target browser |

## 4. How to test with evidence

1. **Before port** record serialized reference fixtures from existing `solveODMRopeConstraints` and authoritative Node tests. Use JSON with inputs, positions, velocities, anchors, dt and expected outputs, full precision plus error tolerances; version fixtures with commit SHA.
2. **Instrument both engines**: JS `performance.mark/measure` or Chrome traces on Three.js; Godot profiler + Web Performance API/integrated metrics for Godot web; separate CPU, GPU and WASM time if measurable; report unavailable GPU metrics rather than guessing.
3. **Deterministic input playback**: scripted 60Hz snapshots and complete input streams; for non-deterministic collisions use envelope tolerance (position/velocity/collision category) and report differences.
4. **Visual evidence**: capture same camera sequence with identical render resolution and comparable lighting; evaluate animation silhouettes, foot sliding, clipping, readability and projectile timing by humans, not only automated thresholds.
5. **Network evidence**: unchanged server revision; log server tick, input seq, last ack, state snapshot times, position correction; apply browser network throttling + test proxy only when measurement methodology is reproducible.
6. **Artifact pack**: browser URL/build and export logs; fixture JSON; performance CSV; comparison charts; screenshots/video; test logs; SDK/engine versions and commit hashes; explicit Known Issues and exception list.

## 5. Deliverable definition

- A separate `godot-client/` proof-of-concept branch/project with source-generated authentic character mesh/rig/three animations.
- One production-like Godot HTML5 build, run locally and via HTTPS.
- A 2-player and 4-player end-to-end test using unmodified Colyseus server.
- Browser comparative perf report and gameplay-feel notes from same scene.
- Decision update with actual observed benefits and setbacks. **No full migration work** until gates pass.

## 6. Decision gate and rollback

**GO to full port** only if all must-have web/network/physics/asset gates pass and measured browser result plus authoring benefit justify the effort. **Conditional GO** when an unresolved but bounded SDK/artifact risk has an owner, cost ceiling, and clear experiment. **NO-GO** when browser export/SDK fails, ODM feel cannot be matched, or Godot underperforms without compensating measurable benefits.

Rollback is simple: Godot PoC never takes over production; leave Node server and Three.js client intact. For a later opt-in beta, switch frontend routing back to the original TS client without data migration or room protocol changes.

## 7. Proposed task dependency graph

`Baseline + Fixtures` -> `Godot Web & Colyseus handshake` -> `real GLB generation/import` -> `ODM physics` -> `Titan & combat` -> `4p browser benchmark` -> `Decision`. If any early gate fails, stop spending on late-stage content.

**Source:** `src/core/GameEngine.ts`, `src/odm/ODMSystem.ts`, `src/utils/MathUtils.ts`, `src/network/NetworkClient.ts`, `src/server/CoopHunterRoom.ts`, `scripts/generate-glb-assets.mjs` at HEAD `6836b59`.
