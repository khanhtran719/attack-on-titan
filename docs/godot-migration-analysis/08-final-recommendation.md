# 08 — Final Recommendation: Godot Migration Feasibility

## Executive decision

**Full client rewrite now: NO-GO.**  
**Time-boxed, separate Godot 4.x Web + Colyseus proof of concept: CONDITIONAL GO.**  
**Production roadmap: Keep Three.js/TypeScript/Rapier/Colyseus and optimize the current game while collecting a baseline.**

Reviewed `main` at commit [`6836b59`](https://github.com/khanhtran719/attack-on-titan/commit/6836b594c8460566e0305ebf461ca993ffb735bf) on 2026-11-11 via connected GitHub. The latest Docker-only commit does not modify gameplay; CI reports success. Godot browser and real game benchmarks were **not executed**. This is a source-grounded feasibility decision, not a claim that Three.js is globally faster or Godot impossible.

## Ten direct answers

### 1. What actual game problems can Godot solve?
Godot can simplify scene/prefab ownership, resource workflow, AnimationTree blending and IK authoring, inspector-based debugging and modular UI composition. These are credible **engineering workflow gains**, especially with asset designers. Current code-centered team may experience smaller benefit.

### 2. Which problems remain after migration?
ODM rope math and game feel, player camera, poor Titan joint weighting, Titan navigation, client/server hit semantic differences, server metrics disclosure, replay/prediction stability and browser benchmarking all require explicit engineering. Rewriting runtime does not fix gameplay algorithms or server-side defects.

### 3. Which features could get worse?
Two-hook ODM collision feel, server reconciliation, browser cold start, skin/animation parity, shader/lighting look and Colyseus session integration. Godot HTML5 Compatibility has platform constraints absent from its native rendering path; its official Godot SDK for Colyseus is beta.

### 4. Will FPS/rendering improve?
**Not established.** There is no measured Godot Web version of the game, no apples-to-apples scene, no CPU/GPU trace. Godot Web uses WebGL2 Compatibility. It could perform better in some workloads and worse in others. Re-run same-scene same-machine browser benchmarks at 1366×768/1080p/1440p to decide.

### 5. Will ODM and combat be better?
Not by swapping engines. `solveODMRopeConstraints` and Rapier collision behavior must be matched in Godot; Godot CharacterBody3D/Jolt differ numerically. Better editor debugging can aid tuning, but backend remains authoritative and combat presentation must be re-synchronized manually.

### 6. Is animation easier to manage?
**Likely yes for animation graphs**, since AnimationTree, AnimationPlayer and Skeleton3D provide structured state editing. **But asset migration is difficult**: current 18 clips, rig, geometry and skin weights originate as TypeScript runtime constructions; existing GLB files are empty scene-node placeholders. Bake genuine skinned GLB + animation first and correct existing weights.

### 7. Can the existing Colyseus backend remain?
**Yes, architecturally.** Retain Node server and protocol. Godot SDK official GDExtension is beta; test exact Godot/Web/export plugin versions and room join, message decode, input, reconnect, timeouts, target lock, 4-player behavior. WebSocket connectivity alone is insufficient.

### 8. How much of client would need rewriting?
Essentially **all engine-bound client systems**: scene/rendering, physics controller, animation driver, UI/CSS, inputs, network client/codec, prediction and camera. Reuse server without reauthoring; reuse numerical formulas, JSON fixture specifications, city config and some exported asset data after baking. No trustworthy percentage of lines ported should be claimed from static code size alone.

### 9. Is Godot advisable for a browser-first game?
It can be, but browser WebGL2 Compatibility and Godot WASM/runtime packaging must be benchmarked against the current browser implementation. Godot C# web export is unsupported in Godot 4.x, so GDScript is the practical starting point. For **this current code-first browser-oriented project**, keeping Three.js presently has lower risk.

### 10. Is rewrite worth it now?
**No.** Several improvement opportunities are concrete and independent of engine: fix publicly accessible `/api/metrics`, dispose `CityBuilder` resources, align projectile visual impact with server, separate Titan snapshot ingestion from render animation update, add browser perf metrics/E2E, polish ODM and improve skinning/IK. These deliver direct player value without a client rewrite.

## Decision matrix

Criteria weighted for browser-first objective (max 100):

| Option | Weighted score | Decision |
|---|---:|---|
| A. Optimize existing Three.js | **90/100** | **RECOMMEND** |
| B. Gradual parallel Godot PoC/client | **65/100** | CONDITIONAL GO to PoC only |
| C. Full Godot rewrite now | **47/100** | **NO-GO** |

Scores are reasoned engineering judgments (not measured FPS). Breakdown, effort assumptions, risks and migration gates: [06-risks-costs-and-roadmap.md](06-risks-costs-and-roadmap.md).

## Immediate action sequence

1. **Baseline**: run existing Three.js browser build with repeatable ODM/combat/multiplayer scene, capture FPS p95/p99, memory, cold start, network corrections and profiler traces.
2. **Fix observable defects**: security metrics route, resource disposal, VFX/server impact synchronization and Titan animation double-update risk; review in small independent PRs.
3. **Build code-first rig export pipeline**: upgrade skin weights and generate valid mesh/skeleton/clip GLB; useful to Three.js even if migration is rejected.
4. **Only then** run Godot Web/Colyseus compatibility gate: same Node backend, Godot HTML5 WebGL2 Compatibility, 2-player join, session reconnect and custom messages.
5. If Web/SDK gate passes, complete representative Godot vertical slice. Compare game feel, web startup/memory/FPS and engineering work. Decide again with measurements.

## The one critical architectural constraint

**Do not migrate client and server engines/protocol simultaneously.** Preserve existing Node/Colyseus authoritative room so the test isolates the effect of a Godot browser client. The Godot route is only justified if it can coexist on the wire and deliver tangible improved workflow or rendering without harming browser performance and ODM feel.

## Evidence labels and limitations

**Verified by GitHub source:** current stack, procedural generation, 18 clips, custom Colyseus messages, fixed tick, authoritative server, major defects/risks described in 01. **Verified by GitHub run metadata:** latest CI success. **Verified by official technology documentation:** Godot Web Compatibility, C# web restriction, SDK beta positioning. **Expected but unproven:** easier editor/animation workflow and any relative memory, FPS, development velocity, latency improvement. **Unavailable:** direct run, benchmark and visual confirmation; branch state of local working tree.

### Supporting sources

- Repository permalink: https://github.com/khanhtran719/attack-on-titan/tree/6836b594c8460566e0305ebf461ca993ffb735bf
- CI: https://github.com/khanhtran719/attack-on-titan/actions/runs/42961187961
- Godot Web export: https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html
- Godot Jolt: https://docs.godotengine.org/en/stable/tutorials/physics/using_jolt_physics.html
- Godot animation: https://docs.godotengine.org/en/stable/tutorials/animation/animation_tree.html
- Official Godot releases: https://godotengine.org/releases/
- Colyseus Godot: https://docs.colyseus.io/getting-started/godot

## Document map

1. [Current State Audit](01-current-state-audit.md)
2. [Three.js vs Godot](02-threejs-vs-godot.md)
3. [Performance and Web Feasibility](03-performance-and-web-feasibility.md)
4. [Feature Parity Matrix](04-feature-parity-matrix.md)
5. [Migration Architecture](05-migration-architecture.md)
6. [Risks, Costs and Roadmap](06-risks-costs-and-roadmap.md)
7. [Proof-of-Concept Plan](07-proof-of-concept-plan.md)
8. Final Recommendation (this file)
