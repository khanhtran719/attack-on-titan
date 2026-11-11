# 06 — Risks, Costs, Decision Matrix & Migration Roadmap

**All effort estimates are assumptions-based** (engineering person-days, 1 person-day = 8 focused development hours, one capable developer already productive with TypeScript/Three.js, less practiced with Godot GDScript; AI coding assistance does not guarantee or discount test effort). No project benchmark or code-based port exists. Numbers describe comparable *engineering effort ranges*, not delivery dates or a fixed quote.

## 1. Three candidate strategies

| Option | Technical upside | Main reuse | Risk and cost | Browser outcome |
|---|---|---|---|---|
| **A: Keep Three.js, optimize** | Preserve gameplay feel, one TS ecosystem, directly fix observed bugs | All client/server runtime, fixtures/assets | Lowest rewrite risk; own game-engine plumbing persists | Strongest existing compatibility; FPS still must be profiled |
| **B: Parallel Godot client PoC / gradual migration** | Test AnimationTree, scenes and tooling without changing production | Server, protocol semantics, procedural specs, tests/data | Two clients to maintain, high network/client parity cost | Feasible *conditionally* if Web export and Colyseus plugin work |
| **C: Full Godot client rewrite now** | Unified Godot authoring, potential long-term pipeline | Node server only; content/math redesigned | Greatest regression/opportunity cost; no demonstrated gains | Risk of worse initial load, rendering parity and integration |

**Important distinction:** Option B here means **parallel client replacement in independent builds**, not mixing Godot and Three.js into one scene or incrementally swapping runtime components in-process.

## 2. Weighted decision matrix

Scale 1–5 (5 = best for current goals). Values are **engineering judgment based on repo/static/platform evidence**, not measured performance. Weighted score = sum(weight × score) / 5, maximum 100. Browser priority drives weights.

| Criterion | Weight % | A: Optimize TS | B: Godot PoC | C: Rewrite now |
|---|---:|---:|---:|---:|
| Desktop browser/WebGL compatibility and deployment | 25 | 5 | 3 | 2 |
| ODM/combat behavior preservation | 20 | 5 | 3 | 2 |
| Engineering effort/opportunity cost | 15 | 5 | 3 | 1 |
| Animation authoring and model pipeline | 15 | 3 | 4 | 4 |
| Multiplayer compatibility/authority | 15 | 5 | 3 | 2 |
| Long-term code maintainability/tools | 10 | 3 | 4 | 4 |
| **Weighted /100** | **100** | **90** | **65** | **47** |

**Why scores differ:** Existing JS/browser deployment, physics parity and Colyseus SDK have demonstrated integration versus Godot Web constraints; Godot's animation/editor facilities receive higher tooling score. Godot FPS advantage is unknown and therefore intentionally receives **no automatic scoring bonus**. Even if Godot gains 1 score point in animation or maintainability, full rewrite still loses on browser/parity/effort until the PoC yields measurable contrary evidence.

## 3. Effort ranges — best / base / worst

Assume: same scope as current features; one primary developer; retained authoritative Node server; no redesign of graphics, missions or backend; tested HTML5 export with Chrome and Firefox; visual goal = parity, not premium art overhaul; server security fixes separately.

| Work package | Best (person-days) | Base | Worst | Reuse / dependency |
|---|---:|---:|---:|---|
| A: Fix critical visual/lifecycle/security and add baseline profiling | 6 | 12 | 24 | Current code; immediate benefit |
| A: ODM/animation/combat optimization, 4-player browser E2E | 12 | 24 | 50 | Current TS code reused |
| **A combined improvement campaign** | **18** | **36** | **74** | Can ship incrementally |
| B: Minimal Godot web runtime/Colyseus interoperability spike | 4 | 9 | 20 | SDK and web tooling gate |
| B: Bake procedural rig & 3 animations as genuine GLB | 5 | 12 | 25 | Required before high-quality scene |
| B: ODM/camera/movement/titan/combat PoC | 9 | 20 | 45 | Depends on solver parity and assets |
| B: Browser benchmarks, regression and recommendation | 4 | 9 | 20 | Depends on comparable scene |
| **B decision-grade PoC total** | **22** | **50** | **110** | Non-production experiment; includes complete representative slice |
| C: Production client parity (beyond PoC) | 45 | 95 | 200+ | Additional to B; UI, all clips, settings, content, QA |

These are **not schedules** and **not guarantees**. Complexity of Godot Web SDK support can invalidate estimates or turn B into NO-GO. Full rewrite could require >200 person-days if SDK must be reimplemented, model baking fails, or browser quality diverges. Source files line counts are not convertible to effort directly.

## 4. Principal risk register

| ID | Severity | Event | Trigger/likelihood | Impact | Gate/mitigation |
|---|---|---|---|---|---|
| R1 | High | Godot SDK unavailable/incompatible in target HTML5 export | GDExtension beta, binary/ABI mismatch | Cannot join existing Colyseus rooms | Prove room create/join/message/rejoin on exact exported WASM before port |
| R2 | High | ODM feel/regression | Rapier vs Godot CharacterBody3D collision differences | Game loses core mechanic | Numeric reference fixtures, trajectory tolerance, visual playtest |
| R3 | High | Procedural GLB bake not feasible for all rig/clip features | Existing assets are metadata-only | Reauthor full character system | First character + idle/run/swing export gate |
| R4 | High | Godot Web renderer/frame performance worse | WebGL2 Compatibility, heavy WASM/scene | Main browser KPI regresses | Cold-load/GPU/frame comparison, explicit veto thresholds |
| R5 | High | Cross-language client prediction divergence | TS server vs GDScript client | Correction spikes / rubberbanding | 0/50/100/200ms and packet loss parity tests |
| R6 | Medium | UI/input parity incomplete | CSS/DOM rewritten into Control nodes | Loss of accessible/fast HUD | Screenshot, pointer lock, resizing and browser focus tests |
| R7 | Medium | Dual maintenance slows feature work | Two engine clients during PoC | Roadmap stalls | Timebox decision, independent branch and scope restriction |
| R8 | Medium | Local progress migration fails | JS localStorage vs Godot user data | User settings/progress lost | Explicit export/import JSON with schema version |
| R9 | High | Existing security issue ignored during migration | `/api/metrics` unprotected | Private session metadata exposed | Fix server access irrespective of engine |
| R10 | Medium | Documentation drift vs runtime | `PROGRESS` past verified claims differ from CI | Poor migration assumptions | Per-claim code/test/browser evidence labels |

## 5. Staged migration / comparison work

**Stage 0 — Freeze and measure Three.js baseline (Must-have):** Pin commit, fix public metrics exposure if testing internet-facing, run existing CI, add Playwright and trace capture, measure standard 4-player scenario and load. Exit: reproducible baseline and matched benchmark fixtures. **Rollback:** no change to current runtime until validated fixes are reviewed.

**Stage 1 — Web technology gate (Must-have):** Pin Godot stable/export templates/SDK revision; empty Godot page loads on Chrome/Firefox; connect to original Colyseus server via WSS; create/list/join room, receive custom JSON, leave/rejoin with session. Exit: exact protocol fixture exchange works from exported browser. **Early abort** if SDK cannot ship Web and adapter costs exceed budget.

**Stage 2 — Asset gate (Must-have):** Generate one real GLB from current `HumanoidRigBuilder` with skin + skeleton + Idle/Run/Swing; import into Godot; validate bone attachment paths and joint deformation. Exit: pose gallery plus clipping/skin weight report. Rollback: asset baker is optional addition to TS project.

**Stage 3 — Movement/ODM gate (Must-have):** Use generated city/colliders, `CharacterBody3D`, custom rope port and camera. Compare scripted single- and double-hook traces, collision and input latency at 60Hz. Exit: agreed tolerance for trace/feel; no severe wall penetration.

**Stage 4 — Combat/Titan gate (Must-have):** One authoritative Titan, basic chase/attack and Nape sword hit. Client only presents damage as server events. Exit: animation, hit events, attack response and LOS parity under network load.

**Stage 5 — Browser benchmark/decision (Must-have):** Same scene, resolutions, 4 players/6 Titans, 50/100/200ms RTT. Compare FPS p95/p99, startup, memory and network correction. Exit: real metrics, demo links, test reports and signed decision matrix update.

**Stage 6 — Production migration (OPTIONAL, only if GO):** Port all clips, UI, game modes, configs and test cases; beta opt-in Godot client route, staged rollout and feature-based reversion to Three.js client. Rollback: keep same server/API and downloadable Three.js deployment artifact, revert frontend routing only.

## 6. Formal go/no-go thresholds

**P0 gates:** confirmed Godot Web export; correct Colyseus session + custom message protocol; same server; code-generated real skinned asset import; ODM no game-breaking divergence; stable 2–4 players; no unauthorized data leak caused by port; no unacceptable performance regression.

**Performance threshold to agree before running:** Godot p95 frame time must be at least as good as Three.js (or compensate with a significant measured workflow benefit), 1% low should not materially regress, cold-start and memory must stay inside documented limits. Avoid cherry-picking native executable benchmarks.

**Decision at current evidence: NO-GO for full rewrite, CONDITIONAL GO for isolated PoC only.** A remains the production recommendation until data demonstrates B/C return on investment.
