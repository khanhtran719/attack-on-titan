# 03 — Performance & Web Feasibility

**Decision platform: desktop browser first.** A Godot native desktop result cannot establish Godot browser suitability. Current performance baseline for this specific repository is **not measured in this audit**.

## 1. Godot 4 web architecture and constraints

- Godot 4 HTML5/web exports load WebAssembly runtime and `.pck` asset data; Godot 4 web uses **Compatibility renderer through WebGL 2.0**. Do not promise WebGPU/Forward+ features in web. Refer to [official Godot Web export docs](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html).
- Godot 4 **C# web exports are not currently supported** per official Godot documentation. Browser-first client PoC should use GDScript (or rigorously validated web-capable extension); do not select C# because team knows TypeScript.
- Web export runs under browser sandbox; browser/WebGL2 availability, GPU driver, platform restrictions, process memory and cross-origin resource hosting affect real compatibility. Some web platform features behave differently under iframe embedding.
- Threading: standard single-threaded web export is the practical baseline; threaded export requires appropriate browser capabilities and cross-origin isolation policies (`COOP`/`COEP`) and may interact with external fonts, analytics, third-party assets and CDNs. Document exact export preset and hosting headers.
- Colyseus connection uses WebSocket; test `wss://` behind HTTPS reverse proxy, hostname/path, TLS, session lifecycle and reconnect. Browser cannot use arbitrary raw TCP/UDP.
- Audio autoplay restrictions, keyboard/pointer lock, focus/visibility pauses, mobile browser incompatibilities and browser memory ceilings must be tested.
- Godot 4 web export size/boot may be higher than lean Three.js/Vite; do not assert actual differences until measuring compressed files and cold-load time.

## 2. Current Three.js performance engineering risk inventory

| Source | Present implementation | Possible bottleneck | Measurement |
|---|---|---|---|
| `RendererManager.ts:10–114` | WebGLRenderer antialias, DPR <=2, soft 2048 shadows (High) | GPU fill/fragment/shadow cost at 1440p | GPU time, render calls, pixel count |
| `CityBuilder.ts:36–78,271–332` | Programmatic building meshes and materials; non-disposing world rebuild | Draw calls and GPU memory retention | `renderer.info.memory`, Chrome GPU memory/heap soak |
| `CityBuilder.ts:388–425` | Instanced foliage | Good baseline but density-dependent | Calls/triangles and cull behavior |
| `HumanoidRigBuilder.ts:586–604` | Merged skinned geometry with material groups | Multiple material draws per character | draw calls per character under 1/4 players + Titans |
| `GameEngine.ts:700–1230` | Input, multiple simulations, camera, animations, HUD in one render loop | Main-thread long frames and GC | Chrome Performance trace marks and allocations |
| `ActionCamera.ts:83–239`, `PlayerController.ts` | `Vector3` creation each step | GC pressure under heavy ODM | allocations/frame and GC pauses |
| `RemotePlayerManager.ts:170–298` | buffered interpolation, new vectors and snapshot clones | Memory, bandwidth, frame pacing | heap allocation, 1% lows, bytes/s |
| `VFXManager.ts:37–344` | pooled effects, per-shot temporary scene objects | Spike on multiple rockets | active particles, allocations, GPU time |
| `CoopHunterRoom.ts:856–950` | fixed tick + AI/physics/projectiles | CPU room capacity, state size | p95 tick duration, heap/rss/room, bytes/s |

## 3. Apples-to-apples benchmark design

**Minimum fixed scene:** same city footprint/geometry count, same player mesh/skin weights/material look (or explicitly matched simplified proxy), 4 characters, six Titans, equivalent shadow mode/resolution, same physics geometry/queries, identical gameplay input trace and 20Hz server snapshots. Same camera path, pixel size and graphics preset. A native Godot baseline may be recorded but must not enter web-versus-web decision score.

**Hardware tiers:** integrated desktop GPU on 1366×768; standard discrete or high-end integrated GPU at 1920×1080; stronger GPU at 2560×1440. Test at devicePixelRatio 1 and one higher DPI preset; specify actual GPU, CPU, browser version, driver, OS, plugged/battery state, background load and display refresh rate. Run same official browser and graphics preset on both engines.

**Measured results** (every result includes profiler link/file, commit, test ID and date):
- Cold/warm **FCP/first interactive playable** time, network transfer size (gzip/brotli where applicable), WASM compile/start and asset load durations.
- Average FPS, p50/p95/p99 frame time, 1% low FPS (derive consistently), maximum consecutive >33.3ms frames, frame pacing distributions.
- JavaScript + WASM main-thread CPU time, physics step p95, animation update p95, render submission and **measured GPU time** when supported; distinguish GPU timer availability.
- Draw calls, triangles, shadow draws, overdraw risks, memory heap/rss, texture/geometry counts, post-restart memory slope.
- Network egress/ingress bytes/s, packet/message size, RTT, jitter, lost snapshots, prediction correction magnitude at RTT 0/50/100/200ms with random packet loss and 4 players.
- Multiroom server capacity: independent synthetic rooms at 1/5/10-room loads, tick p95/p99, missed tick count; same Node server for both clients.
- Visual and semantic parity: shadow/texture/camera differences, hook success rate, movement trajectory deviation, combat hit results, physics penetration and snapping.

**Method:** warm up 60s, record >=180s for steady load, run >=3 repetitions and show median + spread; 10–20 restarts for memory; run deterministic scripted inputs where possible; separate CPU/GPU constrained cases. A demo that starts does not pass.

## 4. Proposed budgets (NOT measurements)

| Criterion | Acceptance goal at specified reference machine |
|---|---|
| 1080p Medium browser | 60FPS playable; p95 <=16.7ms, p99 <=25ms where feasible |
| Main loop | Input visible by next rendered frame locally; physics stepping reliable at target tick |
| 4p / 6 Titans | Stable gameplay at nominal 20Hz snapshots, no severe animation drift |
| Multiplayer corrections | Agree explicit error thresholds before PoC; record correction p95 and max |
| Browser support | Chrome + Firefox + Edge stable on agreed supported OS; Safari as separate compatibility gate |
| Cold start | Candidate must not regress baseline beyond agreed % or seconds |
| Memory | No monotonic GPU/heap growth over repeated room joins and mission restarts |
| Server | Godot client cannot degrade Node server tick under comparable gameplay loads |

## 5. Web deployment gates

1. Generate an HTML5 export from **pinned** stable Godot with Compatibility renderer and project configured for web; record engine/template hashes and plugin versions.
2. Serve HTTPS with correct `.wasm` content type, compressed `.pck` where safe, long-lived hashed assets and cache strategy; apply COOP/COEP only if threaded export demands it and dependencies support it.
3. Establish browser WebSocket `wss` to retained Colyseus server through existing reverse proxy; test dev host and production subpath.
4. Verify focus/pointer-lock, fullscreen, display scaling, keyboard/mouse events, audio gating, reconnect after sleep and tab switch.
5. Browser automated smoke tests: launch, 2-player join, hook, swing, hit, server kill, leave, reconnect, unload; assert no JS console errors.
6. Compare WebGL renderer output and GPU cost against Three.js production mode; reject native-only comparisons.

## 6. Evidence and limitations

Existing `PROGRESS.md` references ~60FPS at ~115–135 draw calls; these are **project claims**, not verified performance measurements in this review and cannot form the baseline. GitHub CI only proves the listed Node build/test stages passed. Browser real-world FPS, load time, GPU time, Colyseus/Godot compatibility and full memory profile are unknown.

Official docs:
- https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html
- https://docs.godotengine.org/en/stable/tutorials/rendering/renderers.html
- https://docs.godotengine.org/en/stable/tutorials/physics/using_jolt_physics.html
- https://docs.colyseus.io/getting-started/godot
