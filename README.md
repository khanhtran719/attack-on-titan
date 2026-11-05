# TITAN HUNTER 3D — Wings of Iron (Single-Player & 2–4 Player Online Co-op)

A high-speed third-person 3D aerial action game running directly in the browser with **Three.js**, **TypeScript**, **Rapier 3D**, and **Colyseus**, inspired by the omni-directional grappling and giant-hunting combat of *Attack on Titan 2: Final Battle*.

Supports both **Single-Player** (*Titan Hunt* & *Cadet Proving Grounds Training*) and **Real-Time Multiplayer Co-op (2–4 Players)** powered by an authoritative Node.js + Colyseus + Rapier 3D server.

---

## 1. Quick Start & Installation

### Cách 1: Chạy trực tiếp bằng Node.js / npm (Single-Player + Multiplayer Co-op)

```bash
# 1. Cài đặt dependencies
npm install

# 2. Chạy đồng thời cả Multiplayer Server (ws://localhost:2567) và WebGL Client (http://localhost:5173)
npm run dev:mp

# Hoặc chạy riêng từng dịch vụ:
npm run server   # Khởi động Colyseus + Rapier 3D Authoritative Server trên cổng 2567
npm run dev      # Khởi động Vite WebGL Client trên cổng 5173

# 3. Chạy toàn bộ Unit & Integration Tests (Single-player + Multiplayer Co-op)
npm test

# 4. Build bản Production
npm run build
```

### Cách 2: Chạy bằng Docker & Docker Compose (Client + Multiplayer Server)

```bash
# 1. Chạy bản Production (Client tại http://localhost:8080 + Multiplayer Server tại ws://localhost:2567)
docker compose up --build -d

# 2. Hoặc chạy chế độ Development có Hot-Reload (Client :5173 + Server :2567)
docker compose --profile dev up --build

# 3. Dừng container
docker compose down
```

### Cách 3: Kết nối nhiều máy qua mạng LAN / Internet

1. Trên máy chủ (Host machine), chạy `npm run dev:mp` (hoặc `docker compose up --build -d`).
2. Tìm địa chỉ IP LAN của máy chủ (ví dụ `192.168.1.50`). Nếu chạy Vite ở chế độ dev cho mạng LAN, dùng `npx vite --host 0.0.0.0`.
3. Các người chơi khác trong cùng mạng LAN mở trình duyệt truy cập `http://192.168.1.50:5173` (hoặc `:8080` với Docker), bấm **MULTIPLAYER CO-OP (2–4 PLAYERS ONLINE)**, kiểm tra ô Server URL (`ws://192.168.1.50:2567`), nhập **Room Code 6 ký tự** để vào cùng phòng và chiến đấu!

---

## 2. Controls (Single-Player & Co-op)

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
| **Hold E** *(Co-op)* | Revive a Downed Teammate within `5m` (`2.2s` channel) |
| **G** *(Co-op)* | Ping Targeted Titan / World Location for Squad |
| **1 / 2 / 3 / 4** *(Co-op)* | Quick Chat Tactical Callouts (`Target the Nape!`, `Sever its Legs!`, `Need Backup!`, `Heading to Supply Depot!`) |
| **Esc** *(or `P`)* | Pause Menu / Tactical Settings & Debug Overlays |

---

## 3. How to Play & Co-op Tactical Guide

1. **Master Dual-Hook Momentum (`LMB` + `RMB`):**
   - Fire a **single hook** (`LMB` or `RMB`) into a building facade or watchtower and steer laterally with `A`/`D` to swing in a banking pendulum arc around corners or behind a Titan.
   - Fire **both hooks simultaneously** (`LMB` + `RMB`) to launch straight forward between two buildings at high speed.
   - Release your hooks at the apex of a swing to preserve tangential inertia through the air.
2. **Gas Thruster Boost (`Shift`):**
   - Hold `Shift` while grappling or airborne to ignite your rear compressed-gas thruster, accelerating up to `50 m/s` and amplifying your kinetic strike multiplier (`up to 3.0x`).
3. **Co-op Pincer & Nape Execution (`Tab` + `C` + `F`):**
   - In Multiplayer Co-op, Titans dynamically track player threat/aggro. While one Scout draws a Titan's attention or severs its `LeftLeg`/`RightLeg` to force it onto its knees (`Injured`), teammates can swing behind its back and slice the **Nape Weak Point** for a high-speed execution!
   - All teammates who damaged a Titan receive **Assist** credit and bonus score when it is slain.
4. **Squad Downed & Revive (`Hold E`):**
   - When a Scout's HP reaches `0` while teammates are still alive, they enter the **DOWNED** state (`30s` bleed-out timer). Approach within `5m` and hold `E` for `2.2 seconds` to revive your teammate back into combat!

---

## 4. Documentation

- **[docs/GAME_DESIGN.md](docs/GAME_DESIGN.md):** Full Game Design Document covering ODM physics math, kinetic damage formula, Titan AI FSM, and mission design.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md):** System architecture diagrams, module breakdown, and step-by-step guide for extending `.glb` models, animations, maps, and missions.
- **[docs/MULTIPLAYER_ARCHITECTURE.md](docs/MULTIPLAYER_ARCHITECTURE.md):** Authoritative Multiplayer Co-op architecture, network protocol (`60 Hz` server tick / `20 Hz` snapshot broadcast), Client-Side Prediction & Server Reconciliation, lag-compensated combat history, and security validation.
- **[PROGRESS.md](PROGRESS.md):** Completed milestone checklist across Phases 1–6, verification telemetry, and future expansion roadmap.
