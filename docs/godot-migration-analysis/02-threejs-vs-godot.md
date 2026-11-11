# 02 — Three.js vs Godot 4.x Technical Comparison

**Baseline:** repository main `6836b59`, 2026-11-11. **Target evaluated:** latest stable Godot 4.x appropriate to the date, provisionally Godot **4.7.2** based on current official releases. Pin the precise patch binary/export templates before PoC. Compare **Godot web Compatibility** with **Three.js browser WebGL**, not Godot desktop Forward+ with browser WebGL.

## 1. Comparative engineering capabilities

| Concern | Keep Three.js + TypeScript | Godot 4.x client | Verified or expected result |
|---|---|---|---|
| Browser distribution | Direct Vite JS/WASM payload, standard WebGL browser runtime | Godot engine WASM plus `.pck`, WebGL 2 Compatibility renderer | Existing integration favors Three.js; compare bytes/time experimentally |
| World/scene | `THREE.Scene`, `Group`, `Mesh` constructed in code | `Node3D`, `PackedScene`, resource ownership/editor | Godot can simplify authoring, requires scene rewrite |
| Rendering | Three's custom materials, shadows, tone mapping | `MeshInstance3D`, lights, `StandardMaterial3D`/`ShaderMaterial` | Different default visuals; quality or speed not guaranteed |
| Geometry | TS `BufferGeometry`, merged groups, custom skin weights | `ArrayMesh`/`SurfaceTool`, procedural `Skin`, `Skeleton3D` or imported GLB | Algorithms portable, engine calls rewritten |
| Character animation | `AnimationMixer`, generated quaternion/position tracks | `AnimationPlayer`, `AnimationTree`, blend spaces, `SkeletonModifier3D` | Better built-in graph and editor tooling; generated clips need baking/port |
| Physics | Rapier WASM + custom kinematic controller + custom rope | Godot Jolt/physics + `CharacterBody3D` + custom rope | Different collision response and network prediction; substantial risk |
| Networking | Native `colyseus.js`, shared TS messages/state | Official Godot Colyseus SDK marked beta, or custom client | Keep backend possible; wire compatibility must be demonstrated |
| UI | HTML/CSS and pointer lock | `CanvasLayer`, `Control`, themes/input | Scene UI easier in editor, all existing DOM screens rewritten |
| Testing | Vitest, JS DevTools, browser Playwright possible | Godot unit/integration + browser Playwright external harness | Neither automatically wins; must create regression suite |
| Developer workflow | TS shared with Node server; code-first | GDScript text, `.tscn` and `.tres`; optional editor | Godot helps designers, may slow code-only TS developer |

## 2. Problems Godot may solve

1. **Animation authoring and transitions:** `AnimationTree` and blend spaces are more explicit than manual clip/state transitions. Godot can make debug/preview and IK layering easier if meshes/rigs are already correct.
2. **Scene lifecycle and prefab composition:** built-in nodes and resource import may reduce custom bookkeeping and giant orchestrator classes. Bad ownership patterns can still leak resources.
3. **Integrated tools:** scene inspector, visual physics/animation debugging, navigation editor, profiler and `.tscn` templates may improve iteration, especially when human designers participate.
4. **Reusable Godot resources:** material, animation and scene variants can reduce boilerplate compared with procedural TS construction, at the cost of porting procedural content.

## 3. Problems migration does **not** solve

- **Titan rigid joint deformation:** `TitanRigBuilder.buildSkinnedPart` stores 100% first-bone weight. Changing engine leaves bad weights unchanged.
- **ODM trajectory/feel:** stretch/tension/momentum values and camera smoothing are authored logic. Godot physics is not a drop-in numerical clone of Rapier.
- **Combat client/server authority:** `CoopHunterRoom` still validates hits and handles damage on Node; VFX timing and hit semantics require explicit synchronization.
- **Titan navigation:** AABB steering is gameplay AI design; `NavigationAgent3D` helps but requires path data and behavior changes.
- **Security:** publicly reachable metrics endpoint on Node is unaffected.
- **60FPS:** built-in engine optimizations are not evidence of better performance; Godot web renderer and WASM boot may create other bottlenecks.

## 4. Potential regressions

- Browser rendering/shading/shadows change; Forward+ is not the Godot browser renderer.
- Godot **C# web export is not supported for Godot 4.x** in official documentation; use GDScript for a browser-first PoC.
- Custom TS procedural rig/animation generation requires baking real GLB with mesh, skin and clips, or full GDScript port.
- Cross-language gameplay drift against the still-TypeScript/Rapier authoritative server may raise reconciliation corrections, particularly dual-hook collision and character sliding.
- Colyseus SDK plugin is beta; HTML5 support, extension binaries, version compatibility, join/rejoin, event dispatch and custom message handling are release gates.
- HTML/CSS menu, keyboard/mouse/pointer-lock and browser storage behavior must be reimplemented.

## 5. Physics comparison in detail

Existing `solveODMRopeConstraints()` (`src/utils/MathUtils.ts:48–179`) is an **application-specific velocity and position adjustment**, not a generic rope joint. It projects radial velocity, preserves a portion as tangent momentum, handles slack, dual-anchor pull, aerial steering and reel-in. Port equations first as pure GDScript; run identical input/anchor traces against TS reference to check near-equivalence. Then integrate `CharacterBody3D` and ray queries. Expect **physical divergence** because Rapier and Godot Jolt have different character-motion semantics, contact margins and step behavior. Requiring exact bitwise parity is unrealistic; use bounded acceptable error and visual correction criteria.

Do **not** immediately replace ODM with `PinJoint3D`/`DampedSpringJoint3D`; stock joints may alter the intended arcade-style momentum, especially for two anchors.

## 6. Animation transfer and architectural comparison

Current source: `HumanoidRigBuilder.ts:182–774,811–1519` creates geometry, bones and 18 clips at runtime; `PlayerAnimator.ts:39–211` blends plus procedural aiming/cape. Existing `.glb` assets are metadata-only nodes generated by `scripts/generate-glb-assets.mjs`; they cannot supply those clips to Godot.

**Route 1: export existing runtime rig:** extract valid glTF 2.0 mesh, joint inverse bind matrices, skin joint weights, skeleton hierarchy and animation channels into GLB. Validate import in Godot, compare bind pose, forearm/elbow and knee bends, weapon anchors, action timing. Risks: Three.js exporter not supporting some custom data/track types, clip naming, orientation coordinate conventions.

**Route 2: regenerate natively:** GDScript `ArrayMesh`/Skin/AnimationLibrary built from parametric source specs. Much larger rewrite and unproven advantage; defer.

Godot `AnimationTree` makes animation **management** easier after an asset pipeline exists; it does not improve original keyframe quality, lack of foot IK or poor vertex weights by itself.

## 7. Development experience

For a **code-first** project with strong TS/Node stack, Three.js maintains one language and reuses math, protocol DTOs, constants and test utilities. Godot introduces GDScript, `.tscn`, engine import conventions, export templates, plugin version management and a second debug workflow. Scene editor convenience is a genuine benefit if it will actually be used; it should not be counted as an automatic speed-up for AI-only coding.

## 8. Official references

- Godot Web export: https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html
- Godot Jolt: https://docs.godotengine.org/en/stable/tutorials/physics/using_jolt_physics.html
- AnimationTree: https://docs.godotengine.org/en/stable/tutorials/animation/animation_tree.html
- SkeletonModifier3D: https://docs.godotengine.org/en/stable/classes/class_skeletonmodifier3d.html
- Colyseus Godot SDK: https://docs.colyseus.io/getting-started/godot
- Godot official releases: https://godotengine.org/releases/

**Verdict:** Godot gives a strong *authoring ergonomics* argument, but no established *browser runtime* or *migration ROI* advantage for the current game.
