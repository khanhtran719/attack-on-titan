# TITAN HUNTER 3D — Wings of Iron

A high-speed third-person 3D aerial action game running directly in the browser with **Three.js**, **TypeScript**, and **Rapier 3D**, inspired by the omni-directional grappling and giant-hunting combat of *Attack on Titan 2: Final Battle*.

---

## 1. Quick Start & Installation

```bash
# 1. Install dependencies
npm install

# 2. Start the development server
npm run dev

# 3. Run unit & integration tests (ODM physics, rigging, combat math)
npm test

# 4. Build for production
npm run build
```

Open the URL printed by Vite (default `http://localhost:5173`) in a desktop browser with mouse and keyboard.

---

## 2. Controls

| Input | Action |
|---|---|
| **WASD** | Ground Movement / Mid-Air Swing Steering |
| **Mouse** | 360° Third-Person Camera Aim (click canvas to lock pointer) |
| **Space** | Jump / Aerial Wire Vault |
| **Left Mouse Hold** *(or `Z`)* | Fire & Reel Left Grappling Hook |
| **Right Mouse Hold** *(or `X`)* | Fire & Reel Right Grappling Hook |
| **Shift (Hold)** | Ignite Gas Propulsion Boost |
| **F** | Dual Sword Slash *(Spinning Heavy Aerial Slash when boosting)* |
| **Q** | Aerial / Ground Dodge *(time just before Titan attack for **Perfect Dodge**)* |
| **Tab** *(or Middle Mouse)* | Lock-On / Cycle Titan Target |
| **C** *(or Mouse Wheel)* | Cycle Targeted Body Part (`Nape` -> `Legs` -> `Arms` -> `Head`) |
| **R** | Reload Fresh Blades / Full Resupply at Cyan Supply Depots |
| **Esc** *(or `P`)* | Pause Menu / Tactical Settings & Debug Overlays |

---

## 3. How to Play & Combat Guide

1. **Master Dual-Hook Momentum (`LMB` + `RMB`):**
   - Fire a **single hook** (`LMB` or `RMB`) into a building facade or watchtower and steer laterally with `A`/`D` to swing in a banking pendulum arc around corners or behind a Titan.
   - Fire **both hooks simultaneously** (`LMB` + `RMB`) to launch straight forward between two buildings at high speed.
   - Release your hooks at the apex of a swing to preserve tangential inertia through the air.
2. **Gas Thruster Boost (`Shift`):**
   - Hold `Shift` while grappling or airborne to ignite your rear compressed-gas thruster, accelerating up to `50 m/s` and amplifying your kinetic strike multiplier (`up to 3.0x`).
3. **Target the Nape Weak Point (`Tab` + `F`):**
   - Titans cannot be killed by ordinary strikes to their limbs or front torso.
   - Press `Tab` to lock onto a Titan. Swing **behind its back** and press `F` while slicing across its **Nape Weak Point** (highlighted in red at the back of the neck) to execute it!
4. **Cripple Limbs first on Large / Abnormal Titans (`C` / Mouse Wheel):**
   - Cycle your target zone to `LeftLeg` or `RightLeg` to sever the Titan's Achilles tendon, forcing it onto its knees (`Injured` state) so its Nape is stationary and easy to reach.
   - Severing `LeftArm` or `RightArm` disables the Titan's dangerous swipe and anti-air grab attacks.
5. **Manage Gas & Blade Sharpness (`R`):**
   - Each strike dulls your mono-blades. When durability hits `0%`, press `R` to equip a fresh pair from your scabbard (`6` spare pairs).
   - Visit glowing cyan **Supply Depots** around the city and press `R` to fully restore Gas (`100%`), Spare Blades (`6/6`), and Health.

---

## 4. Documentation

- **[docs/GAME_DESIGN.md](docs/GAME_DESIGN.md):** Full Game Design Document covering ODM physics math, kinetic damage formula, Titan AI FSM, and mission design.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md):** System architecture diagrams, module breakdown, and step-by-step guide for extending `.glb` models, animations, maps, and missions.
- **[PROGRESS.md](PROGRESS.md):** Completed milestone checklist across Phases 1–5, verification telemetry, and future expansion roadmap.
