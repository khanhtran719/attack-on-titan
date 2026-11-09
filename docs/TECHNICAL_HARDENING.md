# TITAN HUNTER 3D — MULTIPLAYER TECHNICAL HARDENING & SECURITY AUDIT

## 1. Executive Summary & Baseline Audit (Phase 0)

This document records the comprehensive technical, physics, combat, security, and performance audit of **Titan Hunter 3D** at commit `d197497` (`main`), along with the root-cause fixes and regression tests implemented across Phases 1–6.

### Baseline Status Before Hardening
- **Build (`npm run build`):** Passed (`tsc --noEmit && vite build`).
- **Unit & Integration Tests (`npm test`):** `19/19` tests passing (`tests/gameplay.test.ts`, `tests/multiplayer.test.ts`).
- **Confirmed P0 / P1 Technical & Security Risks Identified:**

| ID | Severity | Category | Confirmed Root Cause | Status |
|---|---|---|---|---|
| **P0-1** | **P0** | Multi-Player Physics Isolation | `PhysicsWorld` used a single shared `playerBody`, `playerCollider`, and `characterController`. In `CoopHunterRoom`, stepping 2–4 players overwrote the same kinematic capsule collider on every player step and lacked per-player lifecycle cleanup. | **FIXED** |
| **P0-2** | **P0** | Server Tick vs. Client `frame.dt` | `CoopHunterRoom` processed up to 3 frames per tick and used client-supplied `frame.dt` (`0.004–0.05s`), allowing a lagging or malicious client to advance simulation time up to `3 × 50ms = 150ms` per `16.6ms` tick (`9x` speed-hack) and lacked strict `seq` monotonicity enforcement. | **FIXED** |
| **P0-3** | **P0** | Thunder Spear Wallhack & Spoofing | `handleAuthoritativeThunderSpear` trusted client `aimOrigin` without range clamping, allowed direct `targetTitanId` locks and AoE splash damage through solid buildings/walls without Line-of-Sight raycasts, and lacked `seq` deduplication. | **FIXED** |
| **P0-4** | **P0** | Melee Combat Validation & Deduplication | `handleAuthoritativeAttack` lacked `seq` deduplication, Line-of-Sight wall obstruction checks between player and Titan hurtbox, and per-swing zone hit tracking. | **FIXED** |
| **P1-1** | **P1** | ODM Reconciliation & Hook Lifecycle | Needed guaranteed hook release on all life-state transitions (grabbed, downed, dead, reconnect, restart) and structured rejection/reconciliation telemetry. | **FIXED** |
| **P1-2** | **P1** | Session Token Security & Reconnect Backoff | `CoopHunterRoom` used predictable `tok_${sessionId}_${Date.now()}` tokens and accepted client-provided `sessionToken` on initial join; `NetworkClient` entered `reconnecting` state on unexpected drop without bounded exponential backoff or timeout. | **FIXED** |
| **P1-3** | **P1** | WASM / Three.js Resource Disposal & Metrics | `PhysicsWorld.clearStaticWorld()` created a new `RAPIER.World` without freeing the previous WASM world/controllers; `TitanEntity` and `RemotePlayerManager` needed geometry/material disposal on cleanup; server lacked tick duration/overrun metrics. | **FIXED** |
| **P1-4** | **P1** | CI/CD Pipeline & Regression Suite | Repository lacked a GitHub Actions workflow (`.github/workflows/ci.yml`) and dedicated security/hardening regression tests for the 10 mandatory scenarios. | **FIXED** |

---

## 2. Detailed Technical Fixes by Phase

### Phase 1 — P0: Multi-Player Physics Isolation & Server-Authoritative Tick
1. **Per-Player Physics Entities (`src/physics/PhysicsWorld.ts`):**
   - Added `PlayerPhysicsActor` registry (`Map<string, PlayerPhysicsActor>`) where each player (`'local'` in single-player, or `sessionId` in multiplayer) owns a dedicated Rapier `RigidBody`, capsule `Collider`, and `KinematicCharacterController`.
   - Implemented `ensurePlayerActor(playerId, spawnPos)`, `removePlayerActor(playerId)`, `setPlayerPosition(pos, playerId)`, and `moveCharacter(currentFootPos, desiredDelta, isAirborneOrSwinging, playerId)`.
   - **Player–Player Collision Policy:** Co-op scouts use a **non-blocking pass-through policy** (`!this.playerColliderHandles.has(collider.handle)`) so high-speed aerial ODM swings and close-range revives never snag or body-block teammates mid-air, while `castRay` ignores all player capsule colliders.
   - Added `hasLineOfSight(origin, target, tolerance)` using `castRay` against static world geometry (`building`, `wall`, `tower`, `ground`) to block grapple hooks, melee strikes, and Thunder Spears through solid walls.
2. **Server-Authoritative Fixed Timestep & Input Coalescing (`src/server/CoopHunterRoom.ts`):**
   - Removed usage of client `frame.dt` on the server. Every player is simulated at most **once per server tick** using the server's authoritative `fixedDt = GAME_CONFIG.physics.fixedTimestep` (`1/60s`).
   - Added strict `validateAndSanitizeInputFrame(raw, lastReceivedSeq)` enforcing sequence monotonicity (`seq > lastReceivedSeq`), finite numeric bounds, unit-normalized vectors, and payload structure validation.
   - When multiple valid frames arrive in the same tick window (e.g., network jitter or 120Hz client), `coalescePlayerInputFrames` preserves edge-triggered actions (`fire`, `release`, `jumpPressed`, `dodgePressed`, `resupplyPressed`, `escapePressed`) while stepping kinematics **once** with `fixedDt`, completely eliminating `frame.dt` speed-hacking and burst acceleration.

### Phase 2 — P0: Authoritative Combat Security (Thunder Spears & Melee)
1. **Thunder Spear Validation (`CoopHunterRoom.handleAuthoritativeThunderSpear`):**
   - Deduplicates attack intents via `intent.seq <= player.lastAttackSeq`.
   - Clamps `aimOrigin` within `10m` of authoritative `player.position` (preventing remote origin spoofing).
   - Verifies unobstructed **Line-of-Sight** (`this.physics.hasLineOfSight`) from the player to the targeted Titan hurtbox AND from the detonation point (`explosionPos`) to each hurtbox within `thunderSpearBlastRadius` (`6.5m`). If a building or wall intercepts the rocket path, the projectile detonates on the wall surface instead of damaging the Titan behind cover.
2. **Melee Combat Validation (`CoopHunterRoom.handleAuthoritativeAttack`):**
   - Enforces `intent.seq > player.lastAttackSeq`, attack cooldown (`nowMs >= player.nextAttackAllowedMs`), bounded lag-compensated history (`<= 180ms`), and `this.physics.hasLineOfSight(playerSlashCenter, currentPos)` so players cannot slash Titans through building walls.
   - Tracks `hitZonesInSwing` per attack so a single swing cannot double-hit the same hurtbox or trigger duplicate kills.

### Phase 3 — P1: ODM Networking, Reconciliation & Lifecycle Safety
- Guaranteed hook detachment (`releasePlayerHooks`) on player death, downed state, Titan grab capture, disconnect, and match restart.
- Added structured hook rejection and reconciliation counters on both `ODMSystem` / `NetworkClient` and `CoopHunterRoom`.

### Phase 4 — P1: Cryptographic Session Security & Bounded Reconnection
- **Server (`CoopHunterRoom.ts`):**
  - Generates 192-bit cryptographically random session tokens via `node:crypto` (`randomBytes(24).toString('hex')`).
  - Never accepts client-invented session tokens; validates token ownership and expiration (`15` minutes TTL) on reconnect, cleans up the old `sessionId` physics actor, and prevents duplicate player sessions.
- **Client (`NetworkClient.ts`):**
  - Added automatic exponential backoff reconnection (`maxReconnectAttempts = 4`, delays `400ms, 800ms, 1600ms, 3200ms`, hard timeout `10s`) when an unexpected WebSocket drop occurs (`code !== 1000`), transitioning cleanly to `'disconnected'` with an error notification if reconnection fails.

### Phase 5 — P1: Resource Disposal, Memory Safety & Server Telemetry
- **`PhysicsWorld.ts`:** Properly frees WASM `RAPIER.World` and `KinematicCharacterController` instances in `clearStaticWorld()` and `dispose()`.
- **Three.js Scene Cleanup:** Added geometry/material disposal in `MissionManager.clearTitans()`, `RemotePlayerManager.clearAll()`, and `VFXManager.clearAll()`.
- **Server Metrics (`CoopHunterRoom.ts` & `src/server/index.ts`):** Tracks `lastTickDurationMs`, `maxTickDurationMs`, `tickOverrunCount`, and exposes server health & metrics on `/healthz` and `/api/metrics`.

### Phase 6 — CI/CD, Docker & 10-Scenario Regression Suite
- Added `.github/workflows/ci.yml` for automated asset generation, TypeScript typechecking, Vite production build, and Vitest test execution.
- Updated `Dockerfile`, `Dockerfile.client`, `Dockerfile.server`, and `docker-compose.yml` for reproducible builds.
- Added comprehensive unit & integration tests covering all 10 mandatory regression scenarios in `tests/multiplayer.test.ts` and `tests/gameplay.test.ts`.
