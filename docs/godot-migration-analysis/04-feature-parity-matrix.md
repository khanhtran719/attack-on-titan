# 04 — Feature Parity Matrix

**Reference code:** main `6836b59`; **Godot target:** 4.x stable web/Compatibility. **Migration difficulty** is relative to a developer comfortable with TS/Three.js but new to Godot GDScript. No successful Godot import/prototype in this audit.

Legend: **Reuse** = reuse data/equations/specification with a new adapter; **Partial** = reuse only conceptual algorithm; **Rewrite** = new implementation; **R**isk H/M/L. **Status** refers to existing source, not proven game-feel quality.

| Feature | Current source / status | Godot equivalent | Reuse / rewrite | Difficulty | Risk | Test to validate parity |
|---|---|---|---|---|---|---|
| Boot/game loop | `GameEngine.ts:77–153,700–1230`; implemented | `Main` scene, `_physics_process`, `_process` | Rewrite | H | H | fixed tick, focus/pause, frame pacing |
| WebGL world | `RendererManager.ts`; implemented | `WorldEnvironment`, lights, `MeshInstance3D` | Rewrite/recreate materials | H | H | matched screenshots, draw calls/GPU |
| Procedural city | `CityBuilder`, `CityLayout`; implemented | `Node3D` scene builder, generated meshes | Reuse deterministic layout data | H | M | building positions, geometry and collider parity |
| Instanced foliage | `CityBuilder:388–425`; implemented | `MultiMeshInstance3D` | Reuse instance transforms | M | L | 100/1000 objects, GPU frame |
| Kinematic player | `PhysicsWorld:65–143,293–382`; implemented | `CharacterBody3D`, physics server | Rewrite engine contacts | **VH** | H | wall slide, slope, roof corner, capsule isolation |
| Raycast/LOS | `PhysicsWorld:391–465`; implemented | `PhysicsDirectSpaceState3D` | Partial, recode queries | H | H | occlusion / ray hit tolerance |
| ODM ray solver | `ODMSystem:211–387`, `WorldGrappleSolver` | Godot ray/shape queries | Reuse geometric rules | H | H | hook targets in same map and cones |
| ODM rope equations | `MathUtils:48–179`; implemented/tested | Pure GDScript vector solver | Port math + test vectors | **VH** | H | deterministic trajectory thresholds |
| Gas/momentum | `PlayerController:387–718` | `CharacterBody3D` + custom movement | Partial | H | H | acceleration/release/terminal speed traces |
| Camera | `ActionCamera:83–239` | `Camera3D`, `SpringArm3D` custom | Reuse formulas | M | M | camera snap, wall avoidance, aim alignment |
| Humanoid mesh | `HumanoidRigBuilder:182–774`; implemented | `Skeleton3D` + imported mesh or ArrayMesh | Need genuine GLB bake or full port | **VH** | H | skeletal import, attachments, pose gallery |
| Animation library | `HumanoidRigBuilder:811–1519`; 18 clips | `AnimationPlayer`, `AnimationLibrary` | Bake clips or reauthor | H | H | complete clip name and timing comparison |
| Pose layering/aim | `PlayerAnimator:39–211` | `AnimationTree`, `SkeletonModifier3D` | Rewrite, reuse idea | H | M | foot plant, arm anchor, attack priority |
| Titan mesh | `TitanRigBuilder:37–903`; implemented with rigid weights | `Skeleton3D`, skinned mesh | Bake with corrected weights | **VH** | H | Nape bone, 6 limb hitboxes, bends |
| Titan FSM/AI | `TitanAI`, `ServerTitanSim`; implemented basic navigation | GDScript FSM + `NavigationAgent3D` optional | Reuse states, movement rewrite | H | M | patrol, chase, corner avoidance |
| Combat sword sweep | `CombatSystem:357–548` | bone socket traces/shape casts | Reuse maths, port queries | H | H | 100 fixed clip/hurtbox scenarios |
| Thunder Spear rendering | `VFXManager`, `CoopHunterRoom` | projectile visual scene/particles | Server behavior reused | H | H | authoritative explosion once, wall block |
| Singleplayer mode | `MissionManager` | `MissionDirector`/resources | Port state logic | M | M | waves, score, restart |
| Room matchmaking | `NetworkClient:198–282`, server/index | Godot Colyseus SDK or adapter | Client rewrite; server retained | **VH** | H | create/list/join/ready/start/leave |
| Reconnect | `NetworkClient:283–511` | native adapter lifecycle | Client rewrite | **VH** | H | timed-out joins, token TTL, no duplicate |
| Prediction/replay | `NetworkClient:121–197`, `WorldGrappleSolver` | GDScript circular input history | Port algorithm; physics differs | **VH** | H | 0/50/100/200ms reconciliation |
| Snapshot/interpolation | `RemotePlayerManager:55–92,170–298` | remote nodes plus time buffer | Algorithm portable | H | M | no snap, synchronized rope visuals |
| Authoritative backend | `CoopHunterRoom`, `ServerTitanSim` | **Retain Node/Colyseus** | **No server migration** | L if wire works | H until PoC | 4-player interoperability against original server |
| Menu/HUD | `UIManager`, HUD/WorldMarkers/Tactical, CSS | `CanvasLayer`, `Control`, `Theme` | Rewrite visuals | M–H | M | UX parity at 1366×768/1080p/1440p |
| Input/pointer lock | `InputManager` | `InputMap`, `InputEventMouseMotion` | Rewrite bindings | M | M | held/edge events, focus recovery |
| Browser local saves | `SaveManager` | `user://`, `ConfigFile`/JSON | Migrate schema/optional import | M | M | settings and progression survive migration |
| Existing `.glb` files | `public/assets/models`, generator | glTF importer | **Placeholder only** | H | H | generated GLB has skeleton, skin, mesh, clips |
| Debug/perf | `DebugRenderer`, renderer stats | `DebugDraw3D` custom/engine profiler | Rewrite | M | M | same latency/frame counters |
| Automated browser QA | Vitest, CI | Godot runner + Playwright | New harness | H | H | reproducible CI web 2-client test |

## Required protocol mapping for Godot client

| Protocol operation | TS source | Godot implementation constraint |
|---|---|---|
| Room discovery | `NetworkClient.fetchPublicRooms`, `src/server/index.ts /api/rooms` | HTTPS JSON, preserve room codes and published state |
| Colyseus connect/join | `colyseus.js` `Client` and `Room` | Use SDK or implement version-matched handshake; raw WebSocket alone not enough |
| `session_welcome` / token | `NetworkClient.bindRoom`, `CoopHunterRoom.onJoin` | Preserve token, client identity; never fabricate/reuse expired token |
| `input_frame` | `Protocol.C2S_InputFrame`, client fixed loop | Wire names/types, monotonically increasing sequence, camera vectors, both hook actions |
| `room_snapshot` | `Protocol.NetRoomState`, server broadcast | Decode all fields including `serverTick`, players, titans, projectiles, pings |
| `attack_intent` | `Protocol.C2S_AttackIntent` | Match weapon, sequence, aim cone, target zone and RTT semantics |
| `combat_event` | `Protocol.S2C_CombatEvent` | Deduplicate VFX and update authoritative impact |
| `lobby_action`, `team_ping` | `Protocol`, room handlers | Preserve lobby/ready/start and quick chat UX |
| Reconnect / errors | `NetworkClient.reconnectWithBackoff`, `onAuth` | Deadline/terminal errors, 15-minute token expiry and session binding |

**Exit condition for feature parity:** no engine commitment until all Must-have rows pass executable headless+real-browser tests and the Godot client can coexist with an unmodified Colyseus server.
