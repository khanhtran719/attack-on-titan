# 05 — Proposed Godot Migration Architecture

**Conditional architecture:** Keep `src/server` and Node/Colyseus authoritative game server unchanged initially; replace only the browser presentation/client if the Godot PoC passes. Avoid changing transport and game engine simultaneously.

## 1. Boundary between Godot and existing backend

```text
Browser Godot 4.x / WebGL2 Compatibility / GDScript
 ├─ Main / GameState / InputMap
 ├─ PlayerCharacter (CharacterBody3D)
 │   ├─ GrappleController + RopeMathPort (dual anchors)
 │   ├─ PlayerVisual (Skeleton3D + AnimationTree)
 │   ├─ CameraRig (Camera3D + collision/aim)
 │   ├─ CombatPresentation + sword sockets
 │   └─ InputHistory + Prediction + Reconciliation
 ├─ World (generated CityLayout, static colliders, MultiMesh foliage)
 ├─ TitanVisual (Skeleton3D + hurtbox markers + Animator)
 ├─ HUD (CanvasLayer/Control)
 ├─ VFX (projectileId-linked effects)
 └─ ColyseusGateway (official beta SDK OR verified custom protocol adapter)
          │ wss / HTTP, custom messages and Colyseus room handshake
          ▼
Existing Node.js / Colyseus room server (UNCHANGED)
 ├─ CoopHunterRoom (60Hz)
 ├─ Rapier actor registry / authoritative character physics
 ├─ ServerTitanSim, CombatResolver, Projectile simulation
 └─ room_snapshot / combat_event + matchmaking / sessions
```

**Do not** let Godot become a second independent authority for damage, inventory, kills, revive, session or Titan AI in co-op. Server remains the source of truth; client predicts locally and reconciles.

## 2. Proposed directory tree

```text
godot-client/
  project.godot
  export_presets.cfg               # generated/validated Web Compatibility preset
  scenes/
    main.tscn
    world/city.tscn
    player/player.tscn
    titan/titan_visual.tscn
    effects/thunder_spear.tscn
    ui/main_menu.tscn
    ui/gameplay_hud.tscn
  scripts/
    core/game_state.gd
    core/game_loop.gd
    input/input_adapter.gd
    world/city_layout_import.gd
    movement/player_controller.gd
    movement/odm_controller.gd
    movement/rope_math.gd
    movement/camera_rig.gd
    animation/animation_driver.gd
    animation/rig_ik.gd
    combat/combat_presentation.gd
    ai/titan_visual_sync.gd
    network/colyseus_gateway.gd
    network/message_codec.gd
    network/prediction.gd
    network/snapshot_buffer.gd
    ui/hud_controller.gd
    debug/frame_profiler.gd
  resources/
    config/game_config.tres
    animations/                       # only genuinely imported/baked clips
    materials/
  assets/models/                      # export-ready mesh + skin + animations
  tests/
    rope_reference_vectors.json
    network_protocol_fixtures.json
    benchmark_scenarios.json
```

The tree is a **proposal**, not already implemented.

## 3. Scene hierarchy / ownership

`Main(Node)` owns `GameState`, `NetworkSession`, `World(Node3D)` and `UI(CanvasLayer)`. `Player(CharacterBody3D)` holds a `CollisionShape3D`, `PlayerVisual(Node3D)` with `Skeleton3D`, ODM sockets, `CameraPivot`, `Camera3D` and optional ray-query nodes. `TitanVisual(Node3D)` holds `Skeleton3D`, weak point nodes and visual `AnimationTree`; server supplies Titan state. Projectiles are visual-only in co-op; one scene instance keyed by server `projectileId`, updated by server snapshot and removed on authoritative impact.

**Lifecycle policy:** `enter_tree`/`ready` create game objects, `queue_free` handles nodes, resource references are shared intentionally, a `GameSession` owns and clears one match, network callbacks are scoped by room/session generation so stale callbacks cannot mutate new scenes.

## 4. Physics and ODM migration strategy

1. Record replay fixtures from existing `solveODMRopeConstraints` under 60Hz with known anchors, inputs, gas, release sequence and collisions. Save numeric states at every step and expected server snapshots.
2. Port solver's **pure math** to GDScript `Vector3`, same clamping, radial/tangent projection, dual-anchor pull, no new joints initially.
3. Implement local Godot character movement with `CharacterBody3D` and explicit `PhysicsDirectSpaceState3D` raycasts; choose Jolt/GodotPhysics version and document settings. Use matching collider scale/offset and ignore other player bodies per current co-op policy.
4. Build camera and hook preview using the same frame aim direction and input events. Ensure `InputMap` edge actions remain buffered until the next physics tick.
5. Replay tests: gravity fall, wall slide, single swing, dual swing, hook release at apex, active reel, boost, Titan anchor, sharp corner, collision and death cleanup.
6. Add networking only **after** solo movement reaches accepted trace tolerance; otherwise server reconciliation can mask physics regression.

**Rollback:** keep Three.js client shipping; Godot PoC branch never changes server. Feature flag/build route can choose client at deployment, not blended simulation at runtime.

## 5. Animation/asset pipeline

Recommended path is an offline TS **GLB baker**, not import of current placeholder files: build rig/geometry in Node-capable Three.js (where possible), bake complete mesh, joint hierarchy, inverse bind matrices, vertex attributes, 18 clips and attachment metadata into glTF 2.0. Validate in independent glTF validator, in Godot and with a consistent pose image suite; fix source weights before baking. Build a common `CharacterSpec` JSON for code-first procedural geometry.

In Godot: `Skeleton3D` and `AnimationPlayer` store clips, `AnimationTree` handles Idle/Run/Jump/Swing/Attack transitions and blend parameters, `SkeletonModifier3D` handles additive hook-arm aiming, IK and cape constraints. `CharacterBody3D` moves collision; skeleton pose should not drive authoritative location unless server/physics design explicitly accommodates root motion.

## 6. Networking options

**Preferred first:** Official Colyseus Godot SDK (GDExtension, documented beta) if matching Godot stable **Web export** and current protocol. Pin SDK revision/versions; prove handshake, matchmaking, `onMessage`, custom JSON payload, room leave, reconnect, and 4-player test in browser before expanding.

**Fallback:** Implement a version-correct Colyseus client (not just `WebSocketPeer.connect_to_url`) in GDScript/extension; includes room reservation/join, message framing, type IDs, handshake/reconnect and potentially Schema support. This is costly and risky. A proxy translating custom JSON to browser-compatible websocket protocol could reduce client complexity but **changes backend/deployment**, violating the initial minimal-change preference; only consider after a separate decision.

Use a typed `.json` fixture corpus for `NetRoomState`, `C2S_InputFrame`, `C2S_AttackIntent`, `S2C_CombatEvent`, `session_welcome` and `room errors`; compare TS/GDScript codec round trips, finite vector validation, field defaults and error handling. Never trust client positions/damage in server.

## 7. UI and deployment

`Control` and `Theme` replace DOM/CSS HUD. Preserve high-speed crosshair clarity, contextual prompts, four-slot co-op lobby, pointer-lock flow, pause vs co-op overlay behavior. Use 1366×768, 1920×1080 and 1440p QA. Include UI safe area and browser zoom tests. SaveManager migrates settings and scores via an explicit schema import bridge; do not silently discard old localStorage data.

Web export uses Compatibility/WebGL2, GDScript, pinned templates, HTTPS/WSS, correct MIME/CSP/cache/CORS and optional COOP/COEP only for tested threaded export. Add Playwright E2E and browser frame profiling. Need deployment/rollback rehearsals before a client cutover.

## 8. Direct code mapping (abbreviated; full matrix in 04)

| Three.js | Godot | Reuse | Validation |
|---|---|---|---|
| `GameEngine.loop` | Main `_process` + `_physics_process` | Rewrite | fixed simulation trace |
| `RendererManager`/`CityBuilder` | `WorldEnvironment` + scene generated mesh | Layout data only | screenshots, FPS and draw calls |
| `PhysicsWorld` | `CharacterBody3D` + ray queries | Math concepts | collision trajectory |
| `ODMSystem`, `MathUtils` | `ODMController`, `RopeMath` | Equations | deterministic hook/rope fixtures |
| `HumanoidRigBuilder` | GLB baker + `Skeleton3D` | Baked assets | import/pose tests |
| `PlayerAnimator` | `AnimationTree` + skeleton modifier | animation states | pose/clip duration and IK |
| `NetworkClient` | `ColyseusGateway` | Wire schema | 2–4 player, reconnect |
| `RemotePlayerManager` | `RemotePlayerVisual` | buffering algorithm | snapshot interpolation |
| `UIManager`/HUD | `Control`/`CanvasLayer` | layout intent | UI snapshot/resolution |
| `CoopHunterRoom` | unchanged Node server | Full retention | server contract untouched |
