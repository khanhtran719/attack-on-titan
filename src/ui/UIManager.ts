import * as THREE from 'three';
import { CombatSystem } from '../combat/CombatSystem';
import {
  GraphicsQuality,
  TacticalOverlayKeyMode,
  UserSettings,
} from '../config/GameConfig';
import { SaveProgress } from '../core/SaveManager';
import { TitanEntity } from '../enemies/TitanEntity';
import { GameMode, MissionStatus } from '../missions/MissionManager';
import { RemotePlayerEntity } from '../network/RemotePlayerManager';
import { ODMSystem, ReticleGrapplePreview } from '../odm/ODMSystem';
import { PlayerController } from '../player/PlayerController';
import { NetRoomState, PublicRoomSummary } from '../shared/Protocol';
import { HudController } from './HudController';
import { TacticalOverlayController } from './TacticalOverlayController';
import { WorldMarkersController } from './WorldMarkersController';

export interface UICallbacks {
  onStartGame: (mode: GameMode) => void;
  onResumeGame: () => void;
  onRestartMission: () => void;
  onReturnMainMenu: () => void;
  onSettingsChanged: (settings: Partial<UserSettings>) => void;
  onOpenMultiplayerMenu?: () => void;
  onCreateMultiplayerRoom?: (params: {
    nickname: string;
    roomName: string;
    isPrivate: boolean;
    serverUrl: string;
  }) => void;
  onJoinMultiplayerByCode?: (params: {
    nickname: string;
    roomCode: string;
    serverUrl: string;
  }) => void;
  onJoinMultiplayerByRoomId?: (params: {
    nickname: string;
    roomId: string;
    serverUrl: string;
  }) => void;
  onRefreshPublicRooms?: (serverUrl: string) => void;
  onToggleReady?: () => void;
  onStartMultiplayerMatch?: () => void;
  onLeaveMultiplayerRoom?: () => void;
}

export class UIManager {
  private container: HTMLElement;
  private callbacks: UICallbacks;
  private settings: UserSettings;

  // Sub-controllers
  private hudController!: HudController;
  private worldMarkersController!: WorldMarkersController;
  private tacticalOverlayController!: TacticalOverlayController;

  // Screen & Modal References
  private mainMenuEl!: HTMLElement;
  private pauseMenuEl!: HTMLElement;
  private settingsModalEl!: HTMLElement;
  private multiplayerModalEl!: HTMLElement;
  private resultScreenEl!: HTMLElement;
  private hudEl!: HTMLElement;
  private pauseLeaveCoopBtn!: HTMLElement;

  private lastLobbySignature = '';

  constructor(
    container: HTMLElement,
    initialSettings: UserSettings,
    progress: SaveProgress,
    callbacks: UICallbacks
  ) {
    this.container = container;
    this.settings = initialSettings;
    this.callbacks = callbacks;
    this.buildDOM(progress);
    this.hudController = new HudController(this.container);
    this.worldMarkersController = new WorldMarkersController(this.container);
    this.tacticalOverlayController = new TacticalOverlayController(
      this.container
    );
    this.bindDOMEvents();
  }

  private getDefaultServerUrl(): string {
    const envUrl = (
      import.meta as unknown as { env?: Record<string, string> }
    ).env?.VITE_MULTIPLAYER_WS_URL;
    if (envUrl) return envUrl;
    if (typeof window !== 'undefined') {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname || 'localhost';
      if (
        window.location.port === '' ||
        window.location.port === '80' ||
        window.location.port === '443' ||
        window.location.port === '8080'
      ) {
        return `${proto}//${window.location.host}`;
      }
      return `${proto}//${host}:2567`;
    }
    return 'ws://localhost:2567';
  }

  private buildDOM(progress: SaveProgress): void {
    const savedNick =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem('aot_mp_nickname') ||
          'Scout_' + Math.floor(100 + Math.random() * 899)
        : 'Scout_104';

    this.container.innerHTML = `
      <!-- Subtle Speed Lines & Damage Vignette -->
      <div id="speed-lines-overlay"></div>
      <div id="damage-vignette"></div>

      <!-- MINIMAL CINEMATIC GAMEPLAY HUD -->
      <div id="gameplay-hud" class="hidden">
        <!-- 3D Projected World Markers (Scoped inside Gameplay HUD) -->
        <div id="target-lock-indicator" class="hidden">
          <div class="target-lock-diamond">
            <span class="tl-corner tl-nw"></span>
            <span class="tl-corner tl-ne"></span>
            <span class="tl-corner tl-sw"></span>
            <span class="tl-corner tl-se"></span>
          </div>
          <div class="target-lock-meta">
            <div id="target-lock-zone-text" class="target-lock-label">NAPE · 100%</div>
            <div class="target-lock-hp-bar">
              <div id="target-lock-hp-fill" class="target-lock-hp-fill"></div>
            </div>
          </div>
        </div>

        <div id="titan-ai-labels-container"></div>
        <div id="teammate-labels-container"></div>
        <div id="ping-markers-container"></div>

        <!-- Top-Left: Mission & Wave -->
        <div id="hud-top-left" class="hud-corner-tl">
          <div class="hud-mission-row">
            <span id="hud-mission-title" class="hud-mission-name">Titan Hunt</span>
            <span class="hud-divider-dot">·</span>
            <span id="hud-wave-badge" class="hud-wave-pill">Wave 1 / 3</span>
          </div>
          <div id="hud-mission-objective" class="hud-mission-sub hidden"></div>
        </div>

        <!-- Top-Right: Titans Slain / Target + Contextual Combo & Network Warning -->
        <div id="hud-top-right" class="hud-corner-tr">
          <div class="hud-target-counter">
            <span class="hud-target-label">Titans Slain</span>
            <span id="hud-kills" class="hud-target-value">0 / 7</span>
          </div>
          <div id="hud-combo-badge" class="hud-combo-pill hidden">2× Combo</div>
          <div id="hud-net-warning" class="hud-net-warning-pill hidden">Reconnecting...</div>
        </div>

        <!-- Center: Precision Crosshair & Dual ODM Hook Indicators -->
        <div id="crosshair-container">
          <!-- Left Hook Indicator (LMB / Z) -->
          <div id="crosshair-left" class="crosshair-hook left hook-ready" data-hook-state="ready">
            <svg class="hook-arc-svg" viewBox="0 0 28 44" fill="none" aria-hidden="true">
              <path d="M22 4C11 10 7 16 7 22C7 28 11 34 22 40" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <span id="crosshair-left-state" class="hook-dist-tag"></span>
          </div>

          <!-- Center Reticle Ring & Dot -->
          <div id="crosshair-ring" data-ring-state="idle"></div>
          <div id="crosshair-dot"></div>

          <!-- Right Hook Indicator (RMB / X) -->
          <div id="crosshair-right" class="crosshair-hook right hook-ready" data-hook-state="ready">
            <svg class="hook-arc-svg" viewBox="0 0 28 44" fill="none" aria-hidden="true">
              <path d="M6 4C17 10 21 16 21 22C21 28 17 34 6 40" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <span id="crosshair-right-state" class="hook-dist-tag"></span>
          </div>
        </div>

        <!-- Contextual Center Banners & Action Prompts -->
        <div id="combat-banner" class="combat-banner hidden"></div>
        <div id="resupply-prompt" class="contextual-prompt hidden" data-prompt-mode="tactical">
          <div id="resupply-prompt-text" class="contextual-prompt-text">Press [R] to Resupply</div>
          <div id="context-progress-track" class="contextual-progress-track hidden">
            <div id="context-progress-fill" class="contextual-progress-fill"></div>
          </div>
        </div>

        <!-- Bottom-Left: Slim HP & Gas Bars + Subtle Speedometer -->
        <div id="hud-bottom-left" class="hud-corner-bl">
          <div class="hud-vitals-stack">
            <div id="hud-hp-group" class="hud-vital-row">
              <div class="hud-vital-meta">
                <span class="hud-vital-label">HP</span>
                <span id="hp-text" class="hud-vital-num">100</span>
              </div>
              <div class="hud-slim-track">
                <div id="hp-bar-fill" class="hud-slim-fill hp-fill" style="width: 100%"></div>
              </div>
            </div>

            <div id="hud-gas-group" class="hud-vital-row">
              <div class="hud-vital-meta">
                <span class="hud-vital-label">GAS</span>
                <span id="gas-text" class="hud-vital-num">100%</span>
              </div>
              <div class="hud-slim-track">
                <div id="gas-bar-fill" class="hud-slim-fill gas-fill" style="width: 100%"></div>
              </div>
            </div>
          </div>

          <div id="speed-readout" class="hud-speed-compact">
            <span id="speed-value" class="hud-speed-num">0</span>
            <span class="hud-speed-unit">m/s</span>
          </div>
        </div>

        <!-- Bottom-Right: Blades, Thunder Spears & Subtle Tactical Overlay Hint -->
        <div id="hud-bottom-right" class="hud-corner-br">
          <div class="hud-weapons-panel">
            <!-- Blades -->
            <div id="hud-blade-group" class="hud-weapon-block">
              <div class="hud-weapon-header">
                <span class="hud-weapon-name">Blades</span>
                <span id="blade-text" class="hud-weapon-val">100%</span>
              </div>
              <div class="hud-slim-track blade-track">
                <div id="blade-bar-fill" class="hud-slim-fill blade-fill" style="width: 100%"></div>
              </div>
              <div id="blade-pips" class="hud-pips-row"></div>
            </div>

            <!-- Thunder Spears -->
            <div class="hud-weapon-block spear-block">
              <div class="hud-weapon-header">
                <span class="hud-weapon-name">Spears <kbd>V</kbd></span>
                <span id="spear-text" class="hud-weapon-val">4 / 4</span>
              </div>
              <div id="spear-pips" class="hud-pips-row"></div>
            </div>
          </div>

          <div id="tactical-hint-pill" class="hud-tactical-hint">
            Hold <kbd id="hud-tactical-key-pill">H</kbd> Tactical Info
          </div>
        </div>

        <!-- TACTICAL OVERLAY (Shown on Hold [H / ~] or [Tab] when configured) -->
        <div id="hud-tactical-overlay" class="tactical-overlay" aria-hidden="true">
          <div class="tactical-card">
            <div class="tactical-header">
              <div>
                <div class="tactical-eyebrow">Tactical Situation Report</div>
                <h3 id="tactical-mission-title" class="tactical-title">Titan Hunt</h3>
                <p id="tactical-mission-objective" class="tactical-objective">Eliminate all hostile Titans in the sector.</p>
              </div>
              <div class="tactical-badges">
                <span id="tactical-room-badge" class="tactical-badge">SOLO DEPLOYMENT</span>
                <span id="tactical-overlay-key-label" class="tactical-badge muted">Hold [H / ~]</span>
              </div>
            </div>

            <div class="tactical-stats-grid">
              <div class="tactical-stat-box">
                <span class="tactical-stat-label">Combat Score</span>
                <span id="hud-score" class="tactical-stat-value">0</span>
              </div>
              <div class="tactical-stat-box">
                <span class="tactical-stat-label">Elapsed Time</span>
                <span id="hud-time" class="tactical-stat-value">00:00</span>
              </div>
              <div class="tactical-stat-box">
                <span class="tactical-stat-label">Projected Rank</span>
                <span id="hud-rank" class="tactical-stat-value accent-gold">A</span>
              </div>
              <div id="hud-ping-pill" class="tactical-stat-box hidden">
                <span class="tactical-stat-label">Network RTT</span>
                <span id="hud-ping" class="tactical-stat-value">0 ms</span>
              </div>
              <div class="tactical-stat-box">
                <span class="tactical-stat-label">Frame Rate</span>
                <span id="tactical-fps" class="tactical-stat-value">60 FPS</span>
              </div>
            </div>

            <div id="tactical-squad-section" class="tactical-section hidden">
              <div class="tactical-section-title">Active Scout Squad</div>
              <div id="hud-squad-panel" class="tactical-squad-grid hidden"></div>
            </div>

            <div class="tactical-section">
              <div class="tactical-section-title">ODM & Combat Controls</div>
              <div class="tactical-controls-grid">
                <div class="tactical-ctrl-item"><kbd>LMB</kbd> / <kbd>Z</kbd> <span>Left Grapple Hook</span></div>
                <div class="tactical-ctrl-item"><kbd>RMB</kbd> / <kbd>X</kbd> <span>Right Grapple Hook</span></div>
                <div class="tactical-ctrl-item"><kbd>Shift</kbd> <span>Gas Reel Boost</span></div>
                <div class="tactical-ctrl-item"><kbd>F</kbd> <span>Blade Slash / Spin-Slash</span></div>
                <div class="tactical-ctrl-item"><kbd>V</kbd> <span>Fire Thunder Spear</span></div>
                <div class="tactical-ctrl-item"><kbd>Q</kbd> <span>Aerial Dodge Impulse</span></div>
                <div class="tactical-ctrl-item"><kbd id="tactical-lock-key-label">Tab / MMB</kbd> <span>Target Lock Titan</span></div>
                <div class="tactical-ctrl-item"><kbd>Wheel</kbd> / <kbd>C</kbd> <span>Cycle Weak Point</span></div>
                <div class="tactical-ctrl-item"><kbd>R</kbd> <span>Reload / Supply Depot</span></div>
                <div class="tactical-ctrl-item"><kbd>E</kbd> <span>Revive Downed Ally</span></div>
                <div class="tactical-ctrl-item"><kbd>G</kbd> / <kbd>1–4</kbd> <span>3D Ping / Quick Comms</span></div>
                <div class="tactical-ctrl-item"><kbd>Esc</kbd> / <kbd>P</kbd> <span>Pause Menu</span></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Optional Developer Performance Telemetry (Off by default) -->
        <div id="debug-overlay" class="debug-telemetry-bar hidden"></div>
      </div>

      <!-- CINEMATIC MAIN MENU -->
      <div id="main-menu" class="menu-screen main-menu-screen">
        <div class="main-menu-layout">
          <div class="main-menu-brand">
            <div class="brand-eyebrow">104th Cadet Corps · Tactical Aerial Simulation</div>
            <h1 class="brand-title">Attack on Titan</h1>
            <p class="brand-subtitle">Three-Dimensional Maneuver Gear & Co-op Titan Warfare</p>
          </div>

          <nav class="main-menu-nav" aria-label="Main Menu">
            <button id="btn-start-hunt" class="nav-action-btn primary">
              <span class="nav-btn-text">
                <span class="nav-btn-title">Play — Titan Hunt</span>
                <span class="nav-btn-desc">Solo 3-wave defense inside the fortified district</span>
              </span>
              <span class="nav-btn-arrow">→</span>
            </button>

            <button id="btn-open-multiplayer" class="nav-action-btn accent">
              <span class="nav-btn-text">
                <span class="nav-btn-title">Multiplayer Co-op</span>
                <span class="nav-btn-desc">2–4 Scout real-time squad operations</span>
              </span>
              <span class="nav-btn-arrow">→</span>
            </button>

            <button id="btn-start-training" class="nav-action-btn">
              <span class="nav-btn-text">
                <span class="nav-btn-title">ODM Training</span>
                <span class="nav-btn-desc">Guided grapple, gas boost & nape strike drills</span>
              </span>
              <span class="nav-btn-arrow">→</span>
            </button>

            <button id="btn-open-settings" class="nav-action-btn">
              <span class="nav-btn-text">
                <span class="nav-btn-title">Settings</span>
                <span class="nav-btn-desc">Controls, camera, graphics & diagnostics</span>
              </span>
              <span class="nav-btn-arrow">→</span>
            </button>
          </nav>

          <footer id="menu-progress-stats" class="main-menu-footer">
            ${this.renderProgressMarkup(progress)}
          </footer>
        </div>
      </div>

      <!-- MULTIPLAYER ROOM BROWSER & CO-OP WAITING LOBBY -->
      <div id="multiplayer-modal" class="menu-screen modal-backdrop hidden">
        <div class="tactical-modal mp-modal-card">
          <header class="modal-header">
            <div>
              <div class="modal-eyebrow">Real-Time Co-op Network</div>
              <h2 class="modal-title">Scout Squad Operations</h2>
            </div>
            <button id="btn-close-mp" class="btn-ghost-sm">Back to Menu</button>
          </header>

          <div id="mp-error-banner" class="status-banner danger hidden"></div>

          <!-- Scout Profile & Server Endpoint Bar -->
          <div class="mp-identity-bar">
            <label class="field-group">
              <span class="field-label">Scout Callsign</span>
              <input id="mp-nickname-input" type="text" maxlength="18" value="${savedNick}" placeholder="Enter callsign..." />
            </label>
            <label class="field-group">
              <span class="field-label">Server Endpoint</span>
              <input id="mp-server-url" type="text" value="${this.getDefaultServerUrl()}" />
            </label>
          </div>

          <!-- View A: Room Browser / Create / Join -->
          <div id="mp-browser-section" class="mp-browser-grid">
            <!-- Left Column: Create or Join by Code -->
            <div class="mp-column-stack">
              <section class="mp-panel">
                <h3 class="panel-heading">Create Squad Room</h3>
                <p class="panel-desc">Host a new 2–4 player Co-op instance.</p>
                <label class="field-group">
                  <span class="field-label">Operation Name</span>
                  <input id="mp-room-name-input" type="text" maxlength="28" value="Trost District Defense" />
                </label>
                <label class="checkbox-line">
                  <input id="mp-private-checkbox" type="checkbox" />
                  <span>Private Room (Invite via 6-character code only)</span>
                </label>
                <button id="btn-mp-create-room" class="btn-solid primary full-width">Create Room</button>
              </section>

              <section class="mp-panel">
                <h3 class="panel-heading">Join by Room Code</h3>
                <div class="code-join-row">
                  <input id="mp-room-code-input" type="text" maxlength="6" placeholder="CODE6X" class="code-input" />
                  <button id="btn-mp-join-code" class="btn-solid">Join Squad</button>
                </div>
              </section>
            </div>

            <!-- Right Column: Public Rooms List -->
            <section class="mp-panel mp-public-panel">
              <div class="panel-header-inline">
                <div>
                  <h3 class="panel-heading">Active Public Squads</h3>
                  <p class="panel-desc">Join an open deployment lobby.</p>
                </div>
                <button id="btn-mp-refresh-rooms" class="btn-ghost-sm">Refresh</button>
              </div>
              <div id="mp-public-rooms-list" class="public-rooms-list">
                <div class="empty-list-state">Click Refresh to scan for active lobbies...</div>
              </div>
            </section>
          </div>

          <!-- View B: 4-Slot Co-op Waiting Lobby -->
          <div id="mp-waiting-room-section" class="mp-waiting-lobby hidden">
            <div class="lobby-top-bar">
              <div>
                <div class="modal-eyebrow">Waiting for Deployment</div>
                <div id="mp-lobby-status-text" class="lobby-status-headline">Waiting for players to ready up...</div>
              </div>

              <div class="room-code-cluster">
                <span class="room-code-caption">Room Code</span>
                <span id="mp-lobby-room-code" class="room-code-badge">------</span>
                <button id="btn-mp-copy-code" class="btn-ghost-sm" type="button">Copy Code</button>
              </div>
            </div>

            <!-- 4 Visual Player Slots -->
            <div id="mp-lobby-players-list" class="lobby-slots-grid"></div>

            <div class="lobby-footer-actions">
              <button id="btn-mp-leave-room" class="btn-ghost">Leave Squad</button>
              <div class="lobby-primary-actions">
                <button id="btn-mp-toggle-ready" class="btn-solid">Ready Up</button>
                <button id="btn-mp-start-match" class="btn-solid primary" disabled>Start Operation</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- PAUSE MENU -->
      <div id="pause-menu" class="menu-screen modal-backdrop hidden">
        <div class="tactical-modal compact-modal">
          <div class="modal-eyebrow">Simulation Paused</div>
          <h2 class="modal-title">Tactical Pause</h2>
          <div class="modal-button-stack">
            <button id="btn-resume" class="btn-solid primary full-width">Resume Operation</button>
            <button id="btn-restart" class="btn-solid full-width">Restart Mission</button>
            <button id="btn-pause-settings" class="btn-ghost full-width">Settings</button>
            <button id="btn-pause-leave-coop" class="btn-ghost danger full-width hidden">Leave Co-op Squad</button>
            <button id="btn-pause-mainmenu" class="btn-ghost full-width">Return to Main Menu</button>
          </div>
        </div>
      </div>

      <!-- SETTINGS MODAL -->
      <div id="settings-modal" class="menu-screen modal-backdrop hidden">
        <div class="tactical-modal settings-modal-card">
          <header class="modal-header">
            <div>
              <div class="modal-eyebrow">System Configuration</div>
              <h2 class="modal-title">Settings</h2>
            </div>
            <button id="btn-close-settings" class="btn-solid primary">Save & Close</button>
          </header>

          <div class="settings-columns">
            <!-- Controls, Camera & Audio -->
            <div class="settings-section">
              <h3 class="panel-heading">Controls & Camera</h3>

              <div class="setting-row">
                <div class="setting-label-wrap">
                  <span>Mouse Sensitivity</span>
                  <strong id="val-sens">${this.settings.mouseSensitivity.toFixed(2)}</strong>
                </div>
                <input id="set-sens" type="range" min="0.2" max="2.5" step="0.05" value="${this.settings.mouseSensitivity}" />
              </div>

              <div class="setting-row">
                <div class="setting-label-wrap">
                  <span>Camera Distance</span>
                  <strong id="val-camdist">${this.settings.cameraDistance.toFixed(1)}m</strong>
                </div>
                <input id="set-camdist" type="range" min="3.8" max="9.0" step="0.2" value="${this.settings.cameraDistance}" />
              </div>

              <div class="setting-row">
                <div class="setting-label-wrap">
                  <span>Tactical Overlay Keybind</span>
                </div>
                <select id="set-tactical-key">
                  <option value="KeyH" ${(this.settings.tacticalOverlayKey || 'KeyH') === 'KeyH' ? 'selected' : ''}>Hold [H / ~] · Target Lock on [Tab]</option>
                  <option value="Tab" ${this.settings.tacticalOverlayKey === 'Tab' ? 'selected' : ''}>Hold [Tab] · Target Lock on [MMB / T]</option>
                </select>
              </div>

              <h3 class="panel-heading" style="margin-top: 18px;">Audio & Graphics</h3>

              <div class="setting-row">
                <div class="setting-label-wrap">
                  <span>Master Volume</span>
                  <strong id="val-volume">${Math.round(this.settings.masterVolume * 100)}%</strong>
                </div>
                <input id="set-volume" type="range" min="0" max="1" step="0.05" value="${this.settings.masterVolume}" />
              </div>

              <div class="setting-row">
                <div class="setting-label-wrap">
                  <span>Graphics Preset</span>
                </div>
                <select id="set-quality">
                  <option value="low" ${this.settings.graphicsQuality === 'low' ? 'selected' : ''}>Low (Performance)</option>
                  <option value="medium" ${this.settings.graphicsQuality === 'medium' ? 'selected' : ''}>Medium (Balanced)</option>
                  <option value="high" ${this.settings.graphicsQuality === 'high' ? 'selected' : ''}>High (Fidelity + Shadows)</option>
                </select>
              </div>
            </div>

            <!-- Developer Diagnostics -->
            <div class="settings-section">
              <h3 class="panel-heading">Developer Diagnostics</h3>
              <p class="panel-desc">Optional 3D physics and AI visualization overlays.</p>
              <div class="diagnostics-checklist">
                <label class="checkbox-line">
                  <input id="dbg-perf" type="checkbox" ${this.settings.debug.showPerformanceOverlay ? 'checked' : ''} />
                  <span>Show Performance Telemetry Bar</span>
                </label>
                <label class="checkbox-line">
                  <input id="dbg-colliders" type="checkbox" ${this.settings.debug.showColliders ? 'checked' : ''} />
                  <span>Show Physics Colliders</span>
                </label>
                <label class="checkbox-line">
                  <input id="dbg-anchors" type="checkbox" ${this.settings.debug.showGrappleAnchors ? 'checked' : ''} />
                  <span>Show ODM Grapple Anchors</span>
                </label>
                <label class="checkbox-line">
                  <input id="dbg-hitboxes" type="checkbox" ${this.settings.debug.showTitanHitboxes ? 'checked' : ''} />
                  <span>Show Titan Hurtboxes</span>
                </label>
                <label class="checkbox-line">
                  <input id="dbg-weakpoints" type="checkbox" ${this.settings.debug.showWeakPoints ? 'checked' : ''} />
                  <span>Highlight Nape Weak Points</span>
                </label>
                <label class="checkbox-line">
                  <input id="dbg-velocity" type="checkbox" ${this.settings.debug.showVelocityVectors ? 'checked' : ''} />
                  <span>Show Velocity Vectors</span>
                </label>
                <label class="checkbox-line">
                  <input id="dbg-aistates" type="checkbox" ${this.settings.debug.showAIStates ? 'checked' : ''} />
                  <span>Show 3D Titan AI State Tags</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- VICTORY / DEFEAT RESULTS SCREEN -->
      <div id="result-screen" class="menu-screen modal-backdrop hidden">
        <div class="tactical-modal result-modal-card">
          <div class="modal-eyebrow" id="res-eyebrow">After-Action Report</div>
          <h2 id="res-title" class="result-headline">MISSION COMPLETE</h2>
          <p id="res-subtitle" class="result-subtitle">All hostile Titans neutralized.</p>

          <div class="result-summary-layout">
            <div class="result-rank-box">
              <span class="result-rank-caption">Combat Evaluation</span>
              <div id="res-rank" class="result-rank-emblem">S</div>
            </div>

            <div class="result-metrics-grid">
              <div class="result-metric-card">
                <span class="result-metric-label">Final Score</span>
                <strong id="res-score" class="result-metric-val">0</strong>
              </div>
              <div class="result-metric-card">
                <span class="result-metric-label">Clear Time</span>
                <strong id="res-time" class="result-metric-val">0.0s</strong>
              </div>
              <div class="result-metric-card">
                <span class="result-metric-label">Titans Slain</span>
                <strong id="res-kills" class="result-metric-val">0</strong>
              </div>
            </div>
          </div>

          <div id="res-coop-scoreboard-wrap" class="result-scoreboard-section hidden">
            <div class="tactical-section-title">Squad Performance Breakdown</div>
            <div id="res-coop-scoreboard" class="result-scoreboard-list"></div>
          </div>

          <div class="result-actions-row">
            <button id="btn-res-menu" class="btn-ghost">Main Menu</button>
            <button id="btn-res-retry" class="btn-solid primary">Deploy Again</button>
          </div>
        </div>
      </div>
    `;

    this.mainMenuEl = this.container.querySelector('#main-menu')!;
    this.pauseMenuEl = this.container.querySelector('#pause-menu')!;
    this.settingsModalEl = this.container.querySelector('#settings-modal')!;
    this.multiplayerModalEl =
      this.container.querySelector('#multiplayer-modal')!;
    this.resultScreenEl = this.container.querySelector('#result-screen')!;
    this.hudEl = this.container.querySelector('#gameplay-hud')!;
    this.pauseLeaveCoopBtn = this.container.querySelector(
      '#btn-pause-leave-coop'
    )!;
  }

  private renderProgressMarkup(progress: SaveProgress): string {
    return `
      <div class="record-item">
        <span class="record-label">Best Score</span>
        <strong class="record-val">${progress.highScore.toLocaleString()}</strong>
      </div>
      <div class="record-item">
        <span class="record-label">Best Rank</span>
        <strong class="record-val accent-gold">${progress.bestRank}</strong>
      </div>
      <div class="record-item">
        <span class="record-label">Titans Slain</span>
        <strong class="record-val">${progress.totalTitansSlain}</strong>
      </div>
      <div class="record-item">
        <span class="record-label">Fastest Clear</span>
        <strong class="record-val">${progress.fastestHuntSeconds !== null ? `${progress.fastestHuntSeconds}s` : '—'}</strong>
      </div>
    `;
  }

  private bindDOMEvents(): void {
    this.container
      .querySelector('#btn-start-training')
      ?.addEventListener('click', () => {
        this.showGameplayHUD(false);
        this.callbacks.onStartGame('training');
      });

    this.container
      .querySelector('#btn-start-hunt')
      ?.addEventListener('click', () => {
        this.showGameplayHUD(false);
        this.callbacks.onStartGame('hunt');
      });

    this.container
      .querySelector('#btn-open-multiplayer')
      ?.addEventListener('click', () => {
        this.showMultiplayerMenu();
        this.callbacks.onOpenMultiplayerMenu?.();
      });

    this.container
      .querySelector('#btn-close-mp')
      ?.addEventListener('click', () => {
        this.multiplayerModalEl.classList.add('hidden');
        this.mainMenuEl.classList.remove('hidden');
      });

    const getMpInputs = () => {
      const nick =
        (
          this.container.querySelector('#mp-nickname-input') as HTMLInputElement
        )?.value.trim() || 'Scout';
      const serverUrl =
        (
          this.container.querySelector('#mp-server-url') as HTMLInputElement
        )?.value.trim() || this.getDefaultServerUrl();
      const roomName =
        (
          this.container.querySelector(
            '#mp-room-name-input'
          ) as HTMLInputElement
        )?.value.trim() || 'Scout Squad';
      const isPrivate = Boolean(
        (
          this.container.querySelector(
            '#mp-private-checkbox'
          ) as HTMLInputElement
        )?.checked
      );
      const roomCode = (
        (
          this.container.querySelector(
            '#mp-room-code-input'
          ) as HTMLInputElement
        )?.value || ''
      )
        .trim()
        .toUpperCase();
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('aot_mp_nickname', nick);
      }
      return { nick, serverUrl, roomName, isPrivate, roomCode };
    };

    this.container
      .querySelector('#btn-mp-create-room')
      ?.addEventListener('click', () => {
        const { nick, serverUrl, roomName, isPrivate } = getMpInputs();
        this.setMultiplayerError(null);
        this.callbacks.onCreateMultiplayerRoom?.({
          nickname: nick,
          roomName,
          isPrivate,
          serverUrl,
        });
      });

    this.container
      .querySelector('#btn-mp-join-code')
      ?.addEventListener('click', () => {
        const { nick, serverUrl, roomCode } = getMpInputs();
        if (!roomCode) {
          this.setMultiplayerError('Please enter a 6-character Room Code.');
          return;
        }
        this.setMultiplayerError(null);
        this.callbacks.onJoinMultiplayerByCode?.({
          nickname: nick,
          roomCode,
          serverUrl,
        });
      });

    this.container
      .querySelector('#btn-mp-refresh-rooms')
      ?.addEventListener('click', () => {
        const { serverUrl } = getMpInputs();
        this.callbacks.onRefreshPublicRooms?.(serverUrl);
      });

    this.container
      .querySelector('#btn-mp-copy-code')
      ?.addEventListener('click', () => {
        const codeEl = this.container.querySelector('#mp-lobby-room-code');
        const copyBtn = this.container.querySelector(
          '#btn-mp-copy-code'
        ) as HTMLButtonElement | null;
        const code = codeEl?.textContent?.trim() || '';
        if (!code || code === '------') return;
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(code);
        }
        if (copyBtn) {
          const prev = copyBtn.textContent;
          copyBtn.textContent = 'Copied!';
          window.setTimeout(() => {
            copyBtn.textContent = prev || 'Copy Code';
          }, 1400);
        }
      });

    this.container
      .querySelector('#btn-mp-toggle-ready')
      ?.addEventListener('click', () => {
        this.callbacks.onToggleReady?.();
      });

    this.container
      .querySelector('#btn-mp-start-match')
      ?.addEventListener('click', () => {
        this.callbacks.onStartMultiplayerMatch?.();
      });

    this.container
      .querySelector('#btn-mp-leave-room')
      ?.addEventListener('click', () => {
        this.callbacks.onLeaveMultiplayerRoom?.();
      });

    this.container
      .querySelector('#btn-pause-leave-coop')
      ?.addEventListener('click', () => {
        this.pauseMenuEl.classList.add('hidden');
        this.callbacks.onLeaveMultiplayerRoom?.();
      });

    this.container
      .querySelector('#btn-open-settings')
      ?.addEventListener('click', () => {
        this.settingsModalEl.classList.remove('hidden');
      });

    this.container
      .querySelector('#btn-pause-settings')
      ?.addEventListener('click', () => {
        this.settingsModalEl.classList.remove('hidden');
      });

    this.container
      .querySelector('#btn-close-settings')
      ?.addEventListener('click', () => {
        this.settingsModalEl.classList.add('hidden');
      });

    this.container
      .querySelector('#btn-resume')
      ?.addEventListener('click', () => {
        this.setPaused(false);
        this.callbacks.onResumeGame();
      });

    this.container
      .querySelector('#btn-restart')
      ?.addEventListener('click', () => {
        this.setPaused(false);
        this.callbacks.onRestartMission();
      });

    this.container
      .querySelector('#btn-pause-mainmenu')
      ?.addEventListener('click', () => {
        this.showMainMenu();
        this.callbacks.onReturnMainMenu();
      });

    this.container
      .querySelector('#btn-res-retry')
      ?.addEventListener('click', () => {
        this.resultScreenEl.classList.add('hidden');
        this.hudEl.classList.remove('hidden');
        this.callbacks.onRestartMission();
      });

    this.container
      .querySelector('#btn-res-menu')
      ?.addEventListener('click', () => {
        this.showMainMenu();
        this.callbacks.onReturnMainMenu();
      });

    // Settings Inputs
    const sensInput = this.container.querySelector(
      '#set-sens'
    ) as HTMLInputElement;
    sensInput.addEventListener('input', () => {
      const val = parseFloat(sensInput.value);
      this.container.querySelector('#val-sens')!.textContent = val.toFixed(2);
      this.settings.mouseSensitivity = val;
      this.callbacks.onSettingsChanged({ mouseSensitivity: val });
    });

    const camInput = this.container.querySelector(
      '#set-camdist'
    ) as HTMLInputElement;
    camInput.addEventListener('input', () => {
      const val = parseFloat(camInput.value);
      this.container.querySelector('#val-camdist')!.textContent =
        `${val.toFixed(1)}m`;
      this.settings.cameraDistance = val;
      this.callbacks.onSettingsChanged({ cameraDistance: val });
    });

    const tacticalKeySelect = this.container.querySelector(
      '#set-tactical-key'
    ) as HTMLSelectElement;
    tacticalKeySelect.addEventListener('change', () => {
      const mode = tacticalKeySelect.value as TacticalOverlayKeyMode;
      this.settings.tacticalOverlayKey = mode;
      this.callbacks.onSettingsChanged({ tacticalOverlayKey: mode });
    });

    const volInput = this.container.querySelector(
      '#set-volume'
    ) as HTMLInputElement;
    volInput.addEventListener('input', () => {
      const val = parseFloat(volInput.value);
      this.container.querySelector('#val-volume')!.textContent =
        `${Math.round(val * 100)}%`;
      this.settings.masterVolume = val;
      this.callbacks.onSettingsChanged({ masterVolume: val });
    });

    const qualSelect = this.container.querySelector(
      '#set-quality'
    ) as HTMLSelectElement;
    qualSelect.addEventListener('change', () => {
      const val = qualSelect.value as GraphicsQuality;
      this.settings.graphicsQuality = val;
      this.callbacks.onSettingsChanged({ graphicsQuality: val });
    });

    const bindDebugCheckbox = (
      id: string,
      key: keyof UserSettings['debug']
    ) => {
      const el = this.container.querySelector(`#${id}`) as HTMLInputElement;
      el.addEventListener('change', () => {
        this.settings.debug[key] = el.checked;
        this.callbacks.onSettingsChanged({ debug: { ...this.settings.debug } });
      });
    };

    bindDebugCheckbox('dbg-colliders', 'showColliders');
    bindDebugCheckbox('dbg-anchors', 'showGrappleAnchors');
    bindDebugCheckbox('dbg-hitboxes', 'showTitanHitboxes');
    bindDebugCheckbox('dbg-weakpoints', 'showWeakPoints');
    bindDebugCheckbox('dbg-velocity', 'showVelocityVectors');
    bindDebugCheckbox('dbg-aistates', 'showAIStates');
    bindDebugCheckbox('dbg-perf', 'showPerformanceOverlay');
  }

  public showGameplayHUD(isCoop = false): void {
    this.mainMenuEl.classList.add('hidden');
    this.pauseMenuEl.classList.add('hidden');
    this.resultScreenEl.classList.add('hidden');
    this.multiplayerModalEl.classList.add('hidden');
    this.hudEl.classList.remove('hidden');
    this.pauseLeaveCoopBtn.classList.toggle('hidden', !isCoop);
  }

  public showMainMenu(progress?: SaveProgress): void {
    this.hudEl.classList.add('hidden');
    this.pauseMenuEl.classList.add('hidden');
    this.resultScreenEl.classList.add('hidden');
    this.multiplayerModalEl.classList.add('hidden');
    this.mainMenuEl.classList.remove('hidden');
    if (progress) {
      const statsEl = this.container.querySelector('#menu-progress-stats');
      if (statsEl) {
        statsEl.innerHTML = this.renderProgressMarkup(progress);
      }
    }
  }

  public showMultiplayerMenu(): void {
    this.hudEl.classList.add('hidden');
    this.pauseMenuEl.classList.add('hidden');
    this.resultScreenEl.classList.add('hidden');
    this.multiplayerModalEl.classList.remove('hidden');
    this.container
      .querySelector('#mp-browser-section')
      ?.classList.remove('hidden');
    this.container
      .querySelector('#mp-waiting-room-section')
      ?.classList.add('hidden');
    this.lastLobbySignature = '';
  }

  public showWaitingRoomLobby(): void {
    this.hudEl.classList.add('hidden');
    this.pauseMenuEl.classList.add('hidden');
    this.resultScreenEl.classList.add('hidden');
    this.multiplayerModalEl.classList.remove('hidden');
    this.container
      .querySelector('#mp-browser-section')
      ?.classList.add('hidden');
    this.container
      .querySelector('#mp-waiting-room-section')
      ?.classList.remove('hidden');
    this.pauseLeaveCoopBtn.classList.remove('hidden');
  }

  public updateLobbyState(snapshot: NetRoomState, myPlayerId: string): void {
    this.updateMultiplayerLobby(snapshot, myPlayerId);
  }

  public recordQuickChatBubble(playerId: string, text: string): void {
    this.worldMarkersController.recordQuickChatBubble(playerId, text);
  }

  public setMultiplayerError(message: string | null): void {
    const errEl = this.container.querySelector(
      '#mp-error-banner'
    ) as HTMLElement | null;
    if (!errEl) return;
    if (!message) {
      errEl.classList.add('hidden');
      errEl.textContent = '';
    } else {
      errEl.classList.remove('hidden');
      errEl.textContent = message;
    }
  }

  public updatePublicRoomsList(rooms: PublicRoomSummary[]): void {
    const listEl = this.container.querySelector(
      '#mp-public-rooms-list'
    ) as HTMLElement | null;
    if (!listEl) return;
    if (rooms.length === 0) {
      listEl.innerHTML = `<div class="empty-list-state">No open public squads found. Create a room to host!</div>`;
      return;
    }

    listEl.innerHTML = rooms
      .map(
        (r) => `
        <div class="public-room-row">
          <div class="public-room-info">
            <strong class="public-room-title">${this.escapeHtml(r.roomName)}</strong>
            <span class="public-room-meta">Code <kbd>${this.escapeHtml(r.roomCode)}</kbd> · ${r.playerCount}/${r.maxPlayers} Scouts · ${r.phase.toUpperCase()}</span>
          </div>
          <button class="btn-solid btn-sm btn-join-public-room" data-room-id="${this.escapeHtml(r.roomId)}">Join</button>
        </div>
      `
      )
      .join('');

    listEl.querySelectorAll('.btn-join-public-room').forEach((btn) => {
      btn.addEventListener('click', () => {
        const roomId = (btn as HTMLElement).getAttribute('data-room-id') || '';
        const nick =
          (
            this.container.querySelector(
              '#mp-nickname-input'
            ) as HTMLInputElement
          )?.value.trim() || 'Scout';
        const serverUrl =
          (
            this.container.querySelector('#mp-server-url') as HTMLInputElement
          )?.value.trim() || this.getDefaultServerUrl();
        this.callbacks.onJoinMultiplayerByRoomId?.({
          nickname: nick,
          roomId,
          serverUrl,
        });
      });
    });
  }

  public updateMultiplayerLobby(
    snapshot: NetRoomState | null,
    myPlayerId: string
  ): void {
    const browserSec = this.container.querySelector(
      '#mp-browser-section'
    ) as HTMLElement | null;
    const waitingSec = this.container.querySelector(
      '#mp-waiting-room-section'
    ) as HTMLElement | null;
    if (!browserSec || !waitingSec) return;

    if (!snapshot) {
      browserSec.classList.remove('hidden');
      waitingSec.classList.add('hidden');
      this.lastLobbySignature = '';
      return;
    }

    browserSec.classList.add('hidden');
    waitingSec.classList.remove('hidden');

    const players = Object.values(snapshot.players);
    const sig = `${snapshot.roomCode}|${snapshot.leaderId}|${myPlayerId}|${players
      .map((p) => `${p.id}:${p.nickname}:${p.ready}:${p.isLeader}`)
      .join(',')}`;
    if (this.lastLobbySignature === sig) return;
    this.lastLobbySignature = sig;

    const codeEl = this.container.querySelector('#mp-lobby-room-code');
    if (codeEl) codeEl.textContent = snapshot.roomCode || '------';

    const listEl = this.container.querySelector('#mp-lobby-players-list');
    if (listEl) {
      const slotsMarkup: string[] = [];
      for (let i = 0; i < 4; i++) {
        const p = players[i];
        if (p) {
          const isMe = p.id === myPlayerId;
          slotsMarkup.push(`
            <div class="lobby-player-slot filled ${p.ready ? 'is-ready' : ''} ${isMe ? 'is-self' : ''}">
              <div class="slot-header">
                <span class="slot-index">Scout 0${i + 1}</span>
                ${p.isLeader ? '<span class="slot-role-badge leader">Squad Leader</span>' : '<span class="slot-role-badge">Vanguard</span>'}
              </div>
              <div class="slot-player-name">
                ${this.escapeHtml(p.nickname)}
                ${isMe ? '<span class="slot-you-pill">You</span>' : ''}
              </div>
              <div class="slot-status-row">
                <span class="slot-ready-pill ${p.ready ? 'ready' : 'standby'}">
                  ${p.ready ? 'Ready for Launch' : 'Standing By'}
                </span>
              </div>
            </div>
          `);
        } else {
          slotsMarkup.push(`
            <div class="lobby-player-slot empty">
              <div class="slot-header">
                <span class="slot-index">Slot 0${i + 1}</span>
                <span class="slot-role-badge muted">Open</span>
              </div>
              <div class="slot-empty-label">Awaiting Scout...</div>
              <div class="slot-status-row">
                <span class="slot-ready-pill empty">Share Room Code to Invite</span>
              </div>
            </div>
          `);
        }
      }
      listEl.innerHTML = slotsMarkup.join('');
    }

    const me = snapshot.players[myPlayerId];
    const readyBtn = this.container.querySelector(
      '#btn-mp-toggle-ready'
    ) as HTMLButtonElement | null;
    if (readyBtn && me) {
      readyBtn.textContent = me.ready ? 'Stand Down (Unready)' : 'Ready Up';
      readyBtn.classList.toggle('primary', !me.ready);
    }

    const startBtn = this.container.querySelector(
      '#btn-mp-start-match'
    ) as HTMLButtonElement | null;
    const statusEl = this.container.querySelector('#mp-lobby-status-text');
    const allReady = players.length >= 1 && players.every((p) => p.ready);
    const isLeader = snapshot.leaderId === myPlayerId;

    if (startBtn) {
      startBtn.disabled = !(isLeader && allReady);
      startBtn.textContent = isLeader
        ? 'Start Operation'
        : 'Leader Starts Match';
    }
    if (statusEl) {
      statusEl.textContent = allReady
        ? isLeader
          ? 'All Scouts Ready — Cleared to launch operation.'
          : 'All Scouts Ready — Waiting for Squad Leader to launch.'
        : 'Waiting for all squad members to mark Ready...';
    }
  }

  public setPaused(paused: boolean): void {
    if (paused) {
      this.pauseMenuEl.classList.remove('hidden');
    } else {
      this.pauseMenuEl.classList.add('hidden');
      this.settingsModalEl.classList.add('hidden');
    }
  }

  public showResultScreen(
    status: MissionStatus,
    coopSnapshot?: NetRoomState | null
  ): void {
    this.hudEl.classList.add('hidden');
    this.resultScreenEl.classList.remove('hidden');

    const titleEl = this.container.querySelector('#res-title')!;
    const subEl = this.container.querySelector('#res-subtitle')!;
    const rankEl = this.container.querySelector('#res-rank')!;

    if (status.completed) {
      titleEl.textContent = 'MISSION COMPLETE';
      titleEl.className = 'result-headline victory';
      subEl.textContent =
        status.mode === 'training'
          ? 'ODM Gear & Combat qualification complete.'
          : status.mode === 'coop'
            ? 'Your Scout Squad defended the district!'
            : 'All Titan waves eliminated. Humanity prevails.';
    } else {
      titleEl.textContent = 'MISSION FAILED';
      titleEl.className = 'result-headline defeat';
      subEl.textContent =
        status.mode === 'coop'
          ? 'All squad members fell in battle.'
          : 'You were overwhelmed by the Titans.';
    }

    rankEl.textContent = status.rank;
    this.container.querySelector('#res-score')!.textContent = Math.round(
      status.score
    ).toLocaleString();
    this.container.querySelector('#res-time')!.textContent =
      `${status.elapsedSeconds.toFixed(1)}s`;
    this.container.querySelector('#res-kills')!.textContent =
      `${status.kills} / ${status.targetKills}`;

    const coopWrap = this.container.querySelector(
      '#res-coop-scoreboard-wrap'
    ) as HTMLElement | null;
    const coopBoard = this.container.querySelector(
      '#res-coop-scoreboard'
    ) as HTMLElement | null;

    if (coopWrap && coopBoard) {
      if (coopSnapshot && Object.keys(coopSnapshot.players).length > 0) {
        coopWrap.classList.remove('hidden');
        const sorted = Object.values(coopSnapshot.players).sort(
          (a, b) => b.score - a.score
        );
        coopBoard.innerHTML = sorted
          .map(
            (p, idx) => `
          <div class="result-scoreboard-row">
            <span class="sb-rank">#${idx + 1}</span>
            <strong class="sb-name">${this.escapeHtml(p.nickname)}</strong>
            <span class="sb-stat">${p.kills} Kills</span>
            <span class="sb-stat">${p.assists} Assists</span>
            <span class="sb-stat">${Math.round(p.damageDealt)} Dmg</span>
            <strong class="sb-score">${p.score.toLocaleString()} pts</strong>
          </div>
        `
          )
          .join('');
      } else {
        coopWrap.classList.add('hidden');
      }
    }
  }

  public showCombatBanner(text: string): void {
    this.hudController.showCombatBanner(text);
  }

  public flashDamageVignette(): void {
    this.hudController.flashDamageVignette();
  }

  public updateHUD(params: {
    dt: number;
    player: PlayerController;
    odm: ODMSystem;
    combat: CombatSystem;
    missionStatus: MissionStatus;
    reticlePreview: ReticleGrapplePreview;
    nearSupplyDepot: boolean;
    camera: THREE.PerspectiveCamera;
    titans: TitanEntity[];
    fps: number;
    drawCalls: number;
    triangles: number;
    coopSnapshot?: NetRoomState | null;
    localSessionId?: string;
    remotePlayers?: RemotePlayerEntity[];
    pingMs?: number;
    reconnecting?: boolean;
    tacticalOverlayHeld?: boolean;
  }): void {
    const {
      dt,
      player,
      odm,
      combat,
      missionStatus,
      reticlePreview,
      nearSupplyDepot,
      camera,
      titans,
      fps,
      drawCalls,
      triangles,
      coopSnapshot,
      localSessionId,
      remotePlayers,
      pingMs,
      reconnecting,
      tacticalOverlayHeld = false,
    } = params;

    const tacticalKeyMode = this.settings.tacticalOverlayKey || 'KeyH';

    this.hudController.update({
      dt,
      player,
      odm,
      combat,
      missionStatus,
      reticlePreview,
      nearSupplyDepot,
      coopSnapshot,
      localSessionId,
      pingMs,
      reconnecting,
      tacticalKeyMode,
    });

    this.worldMarkersController.updateTargetLock(combat, camera);
    this.worldMarkersController.updateCoopMarkers(
      coopSnapshot,
      localSessionId,
      remotePlayers,
      player.position,
      camera
    );
    this.worldMarkersController.updateDebugTitanLabels(
      this.settings.debug.showAIStates,
      titans,
      camera
    );

    this.tacticalOverlayController.update({
      held: tacticalOverlayHeld,
      keyMode: tacticalKeyMode,
      missionStatus,
      coopSnapshot,
      localSessionId,
      player,
      odm,
      combat,
      fps,
      drawCalls,
      triangles,
      pingMs,
      reconnecting,
      showPerformanceOverlay: this.settings.debug.showPerformanceOverlay,
    });
  }

  private escapeHtml(raw: string): string {
    return raw.replace(/[&<>"']/g, (ch) => {
      switch (ch) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        default:
          return '&#39;';
      }
    });
  }
}
