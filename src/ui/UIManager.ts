import * as THREE from 'three';
import { CombatSystem } from '../combat/CombatSystem';
import { UserSettings } from '../config/GameConfig';
import { SaveProgress } from '../core/SaveManager';
import { TitanEntity } from '../enemies/TitanEntity';
import { GameMode, MissionStatus } from '../missions/MissionManager';
import { RemotePlayerEntity } from '../network/RemotePlayerManager';
import { ODMSystem, ReticleGrapplePreview } from '../odm/ODMSystem';
import { PlayerController } from '../player/PlayerController';
import { NetRoomState, PublicRoomSummary } from '../shared/Protocol';

export interface UICallbacks {
  onStartGame: (mode: GameMode) => void;
  onResumeGame: () => void;
  onRestartMission: () => void;
  onReturnMainMenu: () => void;
  onSettingsChanged: (newSettings: Partial<UserSettings>) => void;
  // Multiplayer Co-op Callbacks
  onOpenMultiplayerMenu?: () => void;
  onCreateMultiplayerRoom?: (params: {
    serverUrl: string;
    nickname: string;
    roomName: string;
    isPrivate: boolean;
  }) => void;
  onJoinMultiplayerByCode?: (params: {
    serverUrl: string;
    nickname: string;
    roomCode: string;
  }) => void;
  onJoinMultiplayerByRoomId?: (params: {
    serverUrl: string;
    nickname: string;
    roomId: string;
  }) => void;
  onRefreshPublicRooms?: (serverUrl: string) => void;
  onToggleReady?: () => void;
  onStartMultiplayerMatch?: () => void;
  onLeaveMultiplayerRoom?: () => void;
}

export class UIManager {
  private root: HTMLElement;
  private hudRoot!: HTMLElement;
  private speedLinesEl!: HTMLElement;
  private damageVignetteEl!: HTMLElement;

  // HUD Elements
  private missionTitleEl!: HTMLElement;
  private missionObjEl!: HTMLElement;
  private missionSubEl!: HTMLElement;
  private squadPanelEl!: HTMLElement;
  private netStatusEl!: HTMLElement;
  private killsValEl!: HTMLElement;
  private scoreValEl!: HTMLElement;
  private timerValEl!: HTMLElement;
  private comboBadgeEl!: HTMLElement;

  private hpBarEl!: HTMLElement;
  private hpTextEl!: HTMLElement;
  private gasBarEl!: HTMLElement;
  private gasTextEl!: HTMLElement;
  private bladeBarEl!: HTMLElement;
  private bladeTextEl!: HTMLElement;
  private bladePipsEl!: HTMLElement;
  private speedTextEl!: HTMLElement;

  private crosshairRingEl!: HTMLElement;
  private leftBracketEl!: HTMLElement;
  private rightBracketEl!: HTMLElement;

  private targetMarkerEl!: HTMLElement;
  private targetLabelEl!: HTMLElement;
  private centerPromptEl!: HTMLElement;
  private downedBannerEl!: HTMLElement;
  private combatBannerEl!: HTMLElement;
  private debugOverlayEl!: HTMLElement;
  private aiLabelsContainer!: HTMLElement;
  private teammateLabelsContainer!: HTMLElement;
  private pingMarkersContainer!: HTMLElement;

  // Menu Screens
  private mainMenuEl!: HTMLElement;
  private multiplayerScreenEl!: HTMLElement;
  private mpBrowserViewEl!: HTMLElement;
  private mpWaitingViewEl!: HTMLElement;
  private mpErrorBannerEl!: HTMLElement;
  private mpPublicRoomsListEl!: HTMLElement;
  private mpLobbyPlayersListEl!: HTMLElement;
  private mpLobbyRoomCodeEl!: HTMLElement;
  private mpLobbyTitleEl!: HTMLElement;
  private mpStartMatchBtn!: HTMLButtonElement;
  private mpToggleReadyBtn!: HTMLButtonElement;

  private pauseMenuEl!: HTMLElement;
  private settingsModalEl!: HTMLElement;
  private resultScreenEl!: HTMLElement;
  private resultCoopBoardEl!: HTMLElement;

  private bannerTimer = 0;
  private quickChatBubbles: Map<string, { text: string; expiresAt: number }> =
    new Map();

  constructor(
    container: HTMLElement,
    private settings: UserSettings,
    private progress: SaveProgress,
    private callbacks: UICallbacks
  ) {
    this.root = container;
    this.buildDOM();
  }

  private getDefaultServerUrl(): string {
    if (typeof window !== 'undefined' && window.location?.hostname) {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      return `${proto}://${window.location.hostname}:2567`;
    }
    return 'ws://localhost:2567';
  }

  private getDefaultNickname(): string {
    const rand = Math.floor(100 + Math.random() * 900);
    return `Scout_${rand}`;
  }

  private buildDOM(): void {
    const defaultServer = this.getDefaultServerUrl();
    const defaultNick = this.getDefaultNickname();

    this.root.innerHTML = `
      <div id="speed-lines-overlay"></div>
      <div id="damage-vignette"></div>

      <!-- Active Gameplay HUD -->
      <div id="hud-root" class="hud-root hidden">
        <div class="hud-top-left">
          <div class="mission-card">
            <div class="mission-header" id="hud-mission-title">DEFENSE OF VALKENBURG</div>
            <div class="mission-title" id="hud-mission-obj">Eliminate Titans</div>
            <div class="mission-sub" id="hud-mission-sub">Strike the Nape weak point from behind.</div>
          </div>
          <!-- Co-op Squad Status Panel -->
          <div id="hud-squad-panel" class="squad-panel hidden"></div>
        </div>

        <div class="hud-top-right">
          <div id="hud-net-status" class="net-status-pill hidden">ROOM: ------ | PING: 0ms | ONLINE</div>
          <div class="stats-strip">
            <div class="stat-item">
              <span class="stat-label">TITANS SLAIN</span>
              <span class="stat-value accent-crimson" id="hud-kills">0/7</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">SCORE</span>
              <span class="stat-value accent-gold" id="hud-score">0</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">TIME</span>
              <span class="stat-value" id="hud-timer">00:00</span>
            </div>
          </div>
          <div id="hud-combo" class="combo-badge hidden">2x COMBO</div>
        </div>

        <div class="hud-bottom-left">
          <div class="bar-group">
            <div class="bar-header">
              <span>VANGUARD INTEGRITY (HP)</span>
              <span id="hud-hp-text">100%</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill hp" id="hud-hp-bar"></div>
            </div>
          </div>

          <div class="bar-group">
            <div class="bar-header">
              <span>ODM GAS PRESSURE</span>
              <span id="hud-gas-text">100%</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill gas" id="hud-gas-bar"></div>
            </div>
          </div>

          <div class="bar-group">
            <div class="bar-header">
              <span>MONO-BLADE SHARPNESS</span>
              <span id="hud-blade-text">100% (6 SPARE)</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill blade" id="hud-blade-bar"></div>
            </div>
            <div class="blade-pips" id="hud-blade-pips"></div>
          </div>

          <div class="speed-readout">
            <span>AIRSPEED VELOCITY</span>
            <strong id="hud-speed-text">0.0 m/s</strong>
          </div>
        </div>

        <div class="hud-bottom-right">
          <div class="key-hint"><span>Move / Air Steer</span><span class="key-badge">WASD</span></div>
          <div class="key-hint"><span>Left / Right Grapple</span><span class="key-badge">LMB / RMB (or Z/X)</span></div>
          <div class="key-hint"><span>Gas Thruster Boost</span><span class="key-badge">SHIFT</span></div>
          <div class="key-hint"><span>Dual Sword Slash</span><span class="key-badge">F</span></div>
          <div class="key-hint"><span>Aerial Dodge</span><span class="key-badge">Q</span></div>
          <div class="key-hint"><span>Lock Titan / Cycle Limb</span><span class="key-badge">TAB / C / Wheel</span></div>
          <div class="key-hint"><span>Reload Blades / Resupply</span><span class="key-badge">R</span></div>
          <div class="key-hint"><span>Revive Ally / Ping / Chat</span><span class="key-badge">Hold E / G / 1-4</span></div>
          <div class="key-hint"><span>Pause / Settings</span><span class="key-badge">ESC</span></div>
        </div>

        <div class="crosshair-container">
          <div id="crosshair-left-bracket" class="hook-bracket left"></div>
          <div id="crosshair-ring" class="crosshair-ring"></div>
          <div class="crosshair-center"></div>
          <div id="crosshair-right-bracket" class="hook-bracket right"></div>
        </div>

        <!-- 3D Projected Target Reticle -->
        <div id="world-target-marker" class="world-marker hidden">
          <div class="target-reticle nape">
            <div id="world-target-label" class="target-reticle-label">NAPE [100%]</div>
          </div>
        </div>

        <!-- 3D Projected AI State Labels -->
        <div id="ai-labels-container"></div>

        <!-- 3D Projected Co-op Teammate Overhead Labels -->
        <div id="teammate-labels-container"></div>

        <!-- 3D Projected Co-op Ping Markers -->
        <div id="ping-markers-container"></div>

        <!-- Contextual Center Prompt, Downed Banner & Combat Banner -->
        <div id="hud-downed-banner" class="downed-alert-banner hidden">CRITICAL INJURY — BLEEDING OUT</div>
        <div id="hud-center-prompt" class="center-prompt hidden">[R] RESUPPLY GAS & BLADES</div>
        <div id="hud-combat-banner" class="combat-banner" style="opacity: 0;">CRITICAL NAPE EXECUTION!</div>

        <!-- Debug Overlay -->
        <div id="hud-debug-overlay" class="debug-overlay"></div>
      </div>

      <!-- Main Menu Screen -->
      <div id="main-menu-screen" class="menu-screen interactive-overlay">
        <div class="menu-box">
          <div>
            <div class="game-logo-sub">THREE.JS + RAPIER 3D AERIAL ACTION</div>
            <h1 class="game-logo-title">TITAN HUNTER 3D</h1>
          </div>
          <p class="game-logo-desc">
            Soar through the fortified city of Valkenburg with dual Omni-Directional Mobility grappling hooks. Build pendulum momentum, ignite gas thrusters, cripple Titan limbs, and sever their cervical Nape weak point at high velocity.
          </p>
          <div class="stats-strip" style="justify-content: space-between;">
            <div class="stat-item" style="align-items: flex-start;">
              <span class="stat-label">HIGH SCORE</span>
              <span class="stat-value accent-gold" id="menu-highscore">${this.progress.highScore}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">BEST RANK</span>
              <span class="stat-value" id="menu-bestrank">${this.progress.bestRank}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">TITANS SLAIN</span>
              <span class="stat-value accent-crimson" id="menu-totalslain">${this.progress.totalTitansSlain}</span>
            </div>
          </div>
          <div class="menu-buttons">
            <button id="btn-start-hunt" class="btn-military primary">
              <span>DEPLOY: TITAN HUNT (SINGLE-PLAYER)</span>
              <span>&#9654;</span>
            </button>
            <button id="btn-open-multiplayer" class="btn-military primary" style="border-left-color: #38d9c0;">
              <span>MULTIPLAYER CO-OP (2–4 PLAYERS ONLINE)</span>
              <span>&#9733;</span>
            </button>
            <button id="btn-start-training" class="btn-military">
              <span>CADET PROVING GROUNDS (TRAINING MODE)</span>
              <span>&#9654;</span>
            </button>
            <button id="btn-open-settings" class="btn-military">
              <span>TACTICAL SETTINGS & DEBUG TOOLS</span>
              <span>&#9881;</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Multiplayer Co-op Menu & Waiting Room Screen -->
      <div id="multiplayer-lobby-screen" class="menu-screen interactive-overlay hidden">
        <div class="menu-box wide">
          <div>
            <div class="game-logo-sub">COLYSEUS + RAPIER 3D AUTHORITATIVE SERVER</div>
            <h2 class="game-logo-title" id="mp-header-title">MULTIPLAYER CO-OP</h2>
          </div>

          <div id="mp-error-banner" class="mp-error-banner hidden"></div>

          <!-- View 1: Room Browser / Create / Join -->
          <div id="mp-browser-view" style="display: flex; flex-direction: column; gap: 14px;">
            <div class="mp-section">
              <div class="mp-section-title">1. Scout Identity & Server</div>
              <div class="mp-row">
                <input id="mp-nickname-input" class="mp-input" type="text" maxlength="16" placeholder="Scout Nickname" value="${defaultNick}" />
                <input id="mp-server-url" class="mp-input" type="text" placeholder="ws://localhost:2567" value="${defaultServer}" />
              </div>
            </div>

            <div class="mp-section">
              <div class="mp-section-title">2. Create Co-op Squad Room (Max 4 Players)</div>
              <div class="mp-row">
                <input id="mp-room-name-input" class="mp-input" type="text" maxlength="24" placeholder="Squad Room Name" value="Valkenburg Vanguard" />
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#cbd5e1;cursor:pointer;">
                  <input id="mp-private-checkbox" type="checkbox" />
                  Private Room (Code Only)
                </label>
                <button id="btn-mp-create-room" class="btn-military primary" style="padding: 9px 16px;">
                  <span>CREATE ROOM</span>
                </button>
              </div>
            </div>

            <div class="mp-section">
              <div class="mp-section-title">3. Join by 6-Character Room Code</div>
              <div class="mp-row">
                <input id="mp-room-code-input" class="mp-input" type="text" maxlength="6" placeholder="ENTER 6-CHAR CODE (e.g. VK7M2P)" style="text-transform: uppercase;" />
                <button id="btn-mp-join-code" class="btn-military" style="padding: 9px 16px;">
                  <span>JOIN BY CODE</span>
                </button>
              </div>
            </div>

            <div class="mp-section">
              <div class="mp-row" style="justify-content: space-between;">
                <span class="mp-section-title">4. Active Public Squad Rooms</span>
                <button id="btn-mp-refresh-rooms" class="btn-military" style="padding: 5px 12px; font-size: 11px;">
                  <span>REFRESH LIST &#8635;</span>
                </button>
              </div>
              <div id="mp-public-rooms-list" class="mp-rooms-list">
                <div style="font-size: 12px; color: #94a3b8;">Click Refresh or create a new room to begin.</div>
              </div>
            </div>

            <div class="menu-buttons">
              <button id="btn-mp-back-main" class="btn-military">
                <span>RETURN TO MAIN MENU</span>
                <span>&#8592;</span>
              </button>
            </div>
          </div>

          <!-- View 2: Connected Room Waiting Lobby -->
          <div id="mp-waiting-room-view" class="hidden" style="display: flex; flex-direction: column; gap: 16px;">
            <div class="mp-section">
              <div class="mp-row" style="justify-content: space-between;">
                <div>
                  <div class="mp-section-title" id="mp-lobby-room-title">SQUAD BRIEFING ROOM</div>
                  <div style="font-size: 12px; color: #94a3b8; margin-top: 2px;">Share the Room Code so 2–4 Scouts can join this deployment.</div>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 10px; color: #94a3b8; letter-spacing: 1px;">ROOM CODE</div>
                  <div id="mp-lobby-room-code" class="mp-room-code-badge">------</div>
                </div>
              </div>
            </div>

            <div class="mp-section">
              <div class="mp-section-title">Connected Vanguard Scouts (Max 4)</div>
              <div id="mp-lobby-players-list" class="mp-players-list"></div>
            </div>

            <div class="menu-buttons">
              <button id="btn-mp-toggle-ready" class="btn-military">
                <span>TOGGLE READY STATUS</span>
                <span>&#10003;</span>
              </button>
              <button id="btn-mp-start-match" class="btn-military primary">
                <span>DEPLOY SQUAD (LEADER START)</span>
                <span>&#9654;</span>
              </button>
              <button id="btn-mp-leave-room" class="btn-military">
                <span>LEAVE ROOM</span>
                <span>&#8592;</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Pause Menu Screen -->
      <div id="pause-menu-screen" class="menu-screen interactive-overlay hidden">
        <div class="menu-box">
          <div>
            <div class="game-logo-sub">OPERATION PAUSED</div>
            <h2 class="game-logo-title">COMMAND TENT</h2>
          </div>
          <div class="menu-buttons">
            <button id="btn-resume" class="btn-military primary">
              <span>RESUME COMBAT</span>
              <span>&#9654;</span>
            </button>
            <button id="btn-restart" class="btn-military">
              <span>RESTART MISSION</span>
              <span>&#8635;</span>
            </button>
            <button id="btn-pause-settings" class="btn-military">
              <span>SETTINGS & DEBUG OVERLAYS</span>
              <span>&#9881;</span>
            </button>
            <button id="btn-pause-mainmenu" class="btn-military">
              <span>RETURN TO MAIN MENU</span>
              <span>&#8592;</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Settings & Debug Modal -->
      <div id="settings-modal-screen" class="menu-screen interactive-overlay hidden">
        <div class="menu-box">
          <div>
            <div class="game-logo-sub">SYSTEM CONFIGURATION</div>
            <h2 class="game-logo-title">SETTINGS & DEBUG</h2>
          </div>
          <div class="settings-grid">
            <div class="setting-row">
              <span>Mouse Look Sensitivity</span>
              <input id="set-sensitivity" type="range" min="0.3" max="2.5" step="0.1" value="${this.settings.mouseSensitivity}" />
            </div>
            <div class="setting-row">
              <span>Camera Follow Distance</span>
              <input id="set-camdist" type="range" min="3.5" max="9.5" step="0.2" value="${this.settings.cameraDistance}" />
            </div>
            <div class="setting-row">
              <span>Master Audio Volume</span>
              <input id="set-volume" type="range" min="0" max="1" step="0.05" value="${this.settings.masterVolume}" />
            </div>
            <div class="setting-row">
              <span>Graphics Quality Preset</span>
              <select id="set-quality">
                <option value="low" ${this.settings.graphicsQuality === 'low' ? 'selected' : ''}>Low (Max FPS)</option>
                <option value="medium" ${this.settings.graphicsQuality === 'medium' ? 'selected' : ''}>Medium</option>
                <option value="high" ${this.settings.graphicsQuality === 'high' ? 'selected' : ''}>High (Shadows + 2x DPI)</option>
              </select>
            </div>
            <div class="setting-row">
              <span>Debug: Performance FPS Overlay</span>
              <input id="dbg-perf" type="checkbox" ${this.settings.debug.showPerformanceOverlay ? 'checked' : ''} />
            </div>
            <div class="setting-row">
              <span>Debug: Show Titan Hitboxes</span>
              <input id="dbg-hitboxes" type="checkbox" ${this.settings.debug.showTitanHitboxes ? 'checked' : ''} />
            </div>
            <div class="setting-row">
              <span>Debug: Show Nape Weak Points</span>
              <input id="dbg-weakpoints" type="checkbox" ${this.settings.debug.showWeakPoints ? 'checked' : ''} />
            </div>
            <div class="setting-row">
              <span>Debug: Show Grapple Anchors</span>
              <input id="dbg-anchors" type="checkbox" ${this.settings.debug.showGrappleAnchors ? 'checked' : ''} />
            </div>
            <div class="setting-row">
              <span>Debug: Show Velocity Vector</span>
              <input id="dbg-velocity" type="checkbox" ${this.settings.debug.showVelocityVectors ? 'checked' : ''} />
            </div>
            <div class="setting-row">
              <span>Debug: Show Titan AI States</span>
              <input id="dbg-aistates" type="checkbox" ${this.settings.debug.showAIStates ? 'checked' : ''} />
            </div>
            <div class="setting-row">
              <span>Debug: Show Player Collider</span>
              <input id="dbg-colliders" type="checkbox" ${this.settings.debug.showColliders ? 'checked' : ''} />
            </div>
          </div>
          <div class="menu-buttons">
            <button id="btn-close-settings" class="btn-military primary">
              <span>SAVE & RETURN</span>
              <span>&#10003;</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Victory / Defeat Result Screen -->
      <div id="result-screen" class="menu-screen interactive-overlay hidden">
        <div class="menu-box wide">
          <div>
            <div id="result-sub" class="game-logo-sub">MISSION REPORT</div>
            <h2 id="result-title" class="game-logo-title">VICTORY</h2>
          </div>
          <p id="result-desc" class="game-logo-desc">All hostile Titans in Valkenburg District have been eliminated.</p>
          <div class="stats-strip" style="justify-content: space-between;">
            <div class="stat-item" style="align-items: flex-start;">
              <span class="stat-label">FINAL SCORE</span>
              <span class="stat-value accent-gold" id="result-score">0</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">COMBAT RANK</span>
              <span class="stat-value" id="result-rank">S</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">CLEAR TIME</span>
              <span class="stat-value" id="result-time">00:00</span>
            </div>
          </div>
          <div id="result-coop-scoreboard" class="mp-section hidden"></div>
          <div class="menu-buttons">
            <button id="btn-result-retry" class="btn-military primary">
              <span>DEPLOY AGAIN</span>
              <span>&#8635;</span>
            </button>
            <button id="btn-result-mainmenu" class="btn-military">
              <span>RETURN TO MAIN MENU</span>
              <span>&#8592;</span>
            </button>
          </div>
        </div>
      </div>
    `;

    this.hudRoot = this.root.querySelector('#hud-root')!;
    this.speedLinesEl = this.root.querySelector('#speed-lines-overlay')!;
    this.damageVignetteEl = this.root.querySelector('#damage-vignette')!;

    this.missionTitleEl = this.root.querySelector('#hud-mission-title')!;
    this.missionObjEl = this.root.querySelector('#hud-mission-obj')!;
    this.missionSubEl = this.root.querySelector('#hud-mission-sub')!;
    this.squadPanelEl = this.root.querySelector('#hud-squad-panel')!;
    this.netStatusEl = this.root.querySelector('#hud-net-status')!;
    this.killsValEl = this.root.querySelector('#hud-kills')!;
    this.scoreValEl = this.root.querySelector('#hud-score')!;
    this.timerValEl = this.root.querySelector('#hud-timer')!;
    this.comboBadgeEl = this.root.querySelector('#hud-combo')!;

    this.hpBarEl = this.root.querySelector('#hud-hp-bar')!;
    this.hpTextEl = this.root.querySelector('#hud-hp-text')!;
    this.gasBarEl = this.root.querySelector('#hud-gas-bar')!;
    this.gasTextEl = this.root.querySelector('#hud-gas-text')!;
    this.bladeBarEl = this.root.querySelector('#hud-blade-bar')!;
    this.bladeTextEl = this.root.querySelector('#hud-blade-text')!;
    this.bladePipsEl = this.root.querySelector('#hud-blade-pips')!;
    this.speedTextEl = this.root.querySelector('#hud-speed-text')!;

    this.crosshairRingEl = this.root.querySelector('#crosshair-ring')!;
    this.leftBracketEl = this.root.querySelector('#crosshair-left-bracket')!;
    this.rightBracketEl = this.root.querySelector('#crosshair-right-bracket')!;

    this.targetMarkerEl = this.root.querySelector('#world-target-marker')!;
    this.targetLabelEl = this.root.querySelector('#world-target-label')!;
    this.centerPromptEl = this.root.querySelector('#hud-center-prompt')!;
    this.downedBannerEl = this.root.querySelector('#hud-downed-banner')!;
    this.combatBannerEl = this.root.querySelector('#hud-combat-banner')!;
    this.debugOverlayEl = this.root.querySelector('#hud-debug-overlay')!;
    this.aiLabelsContainer = this.root.querySelector('#ai-labels-container')!;
    this.teammateLabelsContainer = this.root.querySelector(
      '#teammate-labels-container'
    )!;
    this.pingMarkersContainer = this.root.querySelector(
      '#ping-markers-container'
    )!;

    this.mainMenuEl = this.root.querySelector('#main-menu-screen')!;
    this.multiplayerScreenEl = this.root.querySelector(
      '#multiplayer-lobby-screen'
    )!;
    this.mpBrowserViewEl = this.root.querySelector('#mp-browser-view')!;
    this.mpWaitingViewEl = this.root.querySelector('#mp-waiting-room-view')!;
    this.mpErrorBannerEl = this.root.querySelector('#mp-error-banner')!;
    this.mpPublicRoomsListEl = this.root.querySelector(
      '#mp-public-rooms-list'
    )!;
    this.mpLobbyPlayersListEl = this.root.querySelector(
      '#mp-lobby-players-list'
    )!;
    this.mpLobbyRoomCodeEl = this.root.querySelector('#mp-lobby-room-code')!;
    this.mpLobbyTitleEl = this.root.querySelector('#mp-lobby-room-title')!;
    this.mpStartMatchBtn = this.root.querySelector(
      '#btn-mp-start-match'
    ) as HTMLButtonElement;
    this.mpToggleReadyBtn = this.root.querySelector(
      '#btn-mp-toggle-ready'
    ) as HTMLButtonElement;

    this.pauseMenuEl = this.root.querySelector('#pause-menu-screen')!;
    this.settingsModalEl = this.root.querySelector('#settings-modal-screen')!;
    this.resultScreenEl = this.root.querySelector('#result-screen')!;
    this.resultCoopBoardEl = this.root.querySelector(
      '#result-coop-scoreboard'
    )!;

    this.bindMenuEvents();
  }

  private getMpInputs(): {
    serverUrl: string;
    nickname: string;
    roomName: string;
    isPrivate: boolean;
    roomCode: string;
  } {
    const serverUrl =
      (
        this.root.querySelector('#mp-server-url') as HTMLInputElement
      )?.value.trim() || this.getDefaultServerUrl();
    const nickname =
      (
        this.root.querySelector('#mp-nickname-input') as HTMLInputElement
      )?.value.trim() || 'Scout';
    const roomName =
      (
        this.root.querySelector('#mp-room-name-input') as HTMLInputElement
      )?.value.trim() || 'Valkenburg Squad';
    const isPrivate = Boolean(
      (this.root.querySelector('#mp-private-checkbox') as HTMLInputElement)
        ?.checked
    );
    const roomCode = (
      (this.root.querySelector('#mp-room-code-input') as HTMLInputElement)
        ?.value || ''
    )
      .trim()
      .toUpperCase();
    return { serverUrl, nickname, roomName, isPrivate, roomCode };
  }

  private bindMenuEvents(): void {
    this.root
      .querySelector('#btn-start-hunt')!
      .addEventListener('click', () => {
        this.showGameplayHUD();
        this.callbacks.onStartGame('hunt');
      });

    this.root
      .querySelector('#btn-open-multiplayer')!
      .addEventListener('click', () => {
        this.showMultiplayerMenu();
        this.callbacks.onOpenMultiplayerMenu?.();
      });

    this.root
      .querySelector('#btn-start-training')!
      .addEventListener('click', () => {
        this.showGameplayHUD();
        this.callbacks.onStartGame('training');
      });

    this.root
      .querySelector('#btn-open-settings')!
      .addEventListener('click', () => {
        this.settingsModalEl.classList.remove('hidden');
      });

    // Multiplayer Lobby Controls
    this.root
      .querySelector('#btn-mp-create-room')!
      .addEventListener('click', () => {
        const { serverUrl, nickname, roomName, isPrivate } = this.getMpInputs();
        this.setMultiplayerError(null);
        this.callbacks.onCreateMultiplayerRoom?.({
          serverUrl,
          nickname,
          roomName,
          isPrivate,
        });
      });

    this.root
      .querySelector('#btn-mp-join-code')!
      .addEventListener('click', () => {
        const { serverUrl, nickname, roomCode } = this.getMpInputs();
        if (!roomCode) {
          this.setMultiplayerError('Please enter a 6-character Room Code.');
          return;
        }
        this.setMultiplayerError(null);
        this.callbacks.onJoinMultiplayerByCode?.({
          serverUrl,
          nickname,
          roomCode,
        });
      });

    this.root
      .querySelector('#btn-mp-refresh-rooms')!
      .addEventListener('click', () => {
        const { serverUrl } = this.getMpInputs();
        this.callbacks.onRefreshPublicRooms?.(serverUrl);
      });

    this.root
      .querySelector('#btn-mp-back-main')!
      .addEventListener('click', () => {
        this.showMainMenu();
      });

    this.mpToggleReadyBtn.addEventListener('click', () => {
      this.callbacks.onToggleReady?.();
    });

    this.mpStartMatchBtn.addEventListener('click', () => {
      this.callbacks.onStartMultiplayerMatch?.();
    });

    this.root
      .querySelector('#btn-mp-leave-room')!
      .addEventListener('click', () => {
        this.callbacks.onLeaveMultiplayerRoom?.();
      });

    this.root
      .querySelector('#btn-resume')!
      .addEventListener('click', () => {
        this.pauseMenuEl.classList.add('hidden');
        this.callbacks.onResumeGame();
      });

    this.root
      .querySelector('#btn-restart')!
      .addEventListener('click', () => {
        this.pauseMenuEl.classList.add('hidden');
        this.resultScreenEl.classList.add('hidden');
        this.callbacks.onRestartMission();
      });

    this.root
      .querySelector('#btn-pause-settings')!
      .addEventListener('click', () => {
        this.settingsModalEl.classList.remove('hidden');
      });

    this.root
      .querySelector('#btn-pause-mainmenu')!
      .addEventListener('click', () => {
        this.showMainMenu();
        this.callbacks.onReturnMainMenu();
      });

    this.root
      .querySelector('#btn-result-retry')!
      .addEventListener('click', () => {
        this.resultScreenEl.classList.add('hidden');
        this.callbacks.onRestartMission();
      });

    this.root
      .querySelector('#btn-result-mainmenu')!
      .addEventListener('click', () => {
        this.showMainMenu();
        this.callbacks.onReturnMainMenu();
      });

    this.root
      .querySelector('#btn-close-settings')!
      .addEventListener('click', () => {
        this.readAndSaveSettings();
        this.settingsModalEl.classList.add('hidden');
      });
  }

  private readAndSaveSettings(): void {
    const sens = parseFloat(
      (this.root.querySelector('#set-sensitivity') as HTMLInputElement).value
    );
    const camDist = parseFloat(
      (this.root.querySelector('#set-camdist') as HTMLInputElement).value
    );
    const vol = parseFloat(
      (this.root.querySelector('#set-volume') as HTMLInputElement).value
    );
    const quality = (
      this.root.querySelector('#set-quality') as HTMLSelectElement
    ).value as UserSettings['graphicsQuality'];

    const debug = {
      showPerformanceOverlay: (
        this.root.querySelector('#dbg-perf') as HTMLInputElement
      ).checked,
      showTitanHitboxes: (
        this.root.querySelector('#dbg-hitboxes') as HTMLInputElement
      ).checked,
      showWeakPoints: (
        this.root.querySelector('#dbg-weakpoints') as HTMLInputElement
      ).checked,
      showGrappleAnchors: (
        this.root.querySelector('#dbg-anchors') as HTMLInputElement
      ).checked,
      showVelocityVectors: (
        this.root.querySelector('#dbg-velocity') as HTMLInputElement
      ).checked,
      showAIStates: (
        this.root.querySelector('#dbg-aistates') as HTMLInputElement
      ).checked,
      showColliders: (
        this.root.querySelector('#dbg-colliders') as HTMLInputElement
      ).checked,
    };

    this.settings = {
      mouseSensitivity: sens,
      cameraDistance: camDist,
      masterVolume: vol,
      graphicsQuality: quality,
      debug,
    };

    this.callbacks.onSettingsChanged(this.settings);
  }

  public showMainMenu(updatedProgress?: SaveProgress): void {
    if (updatedProgress) {
      this.progress = updatedProgress;
      this.root.querySelector('#menu-highscore')!.textContent = String(
        this.progress.highScore
      );
      this.root.querySelector('#menu-bestrank')!.textContent =
        this.progress.bestRank;
      this.root.querySelector('#menu-totalslain')!.textContent = String(
        this.progress.totalTitansSlain
      );
    }
    this.hudRoot.classList.add('hidden');
    this.multiplayerScreenEl.classList.add('hidden');
    this.pauseMenuEl.classList.add('hidden');
    this.resultScreenEl.classList.add('hidden');
    this.mainMenuEl.classList.remove('hidden');
  }

  public showMultiplayerMenu(): void {
    this.mainMenuEl.classList.add('hidden');
    this.hudRoot.classList.add('hidden');
    this.pauseMenuEl.classList.add('hidden');
    this.resultScreenEl.classList.add('hidden');
    this.multiplayerScreenEl.classList.remove('hidden');
    this.mpBrowserViewEl.classList.remove('hidden');
    this.mpWaitingViewEl.classList.add('hidden');
    this.setMultiplayerError(null);
  }

  public showWaitingRoomLobby(): void {
    this.mainMenuEl.classList.add('hidden');
    this.hudRoot.classList.add('hidden');
    this.multiplayerScreenEl.classList.remove('hidden');
    this.mpBrowserViewEl.classList.add('hidden');
    this.mpWaitingViewEl.classList.remove('hidden');
    this.setMultiplayerError(null);
  }

  public setMultiplayerError(message: string | null): void {
    if (!message) {
      this.mpErrorBannerEl.classList.add('hidden');
      this.mpErrorBannerEl.textContent = '';
    } else {
      this.mpErrorBannerEl.classList.remove('hidden');
      this.mpErrorBannerEl.textContent = message;
    }
  }

  public updatePublicRoomsList(rooms: PublicRoomSummary[]): void {
    if (rooms.length === 0) {
      this.mpPublicRoomsListEl.innerHTML = `<div style="font-size: 12px; color: #94a3b8;">No public rooms currently open. Create one above!</div>`;
      return;
    }

    this.mpPublicRoomsListEl.innerHTML = rooms
      .map(
        (r) => `
        <div class="mp-room-item">
          <div>
            <strong style="color:#f8fafc;">${this.escapeHtml(r.roomName)}</strong>
            <span style="color:#38d9c0;font-family:monospace;margin-left:8px;">[${r.roomCode}]</span>
            <span style="color:#94a3b8;margin-left:8px;">${r.playerCount}/${r.maxPlayers} Scouts (${r.phase.toUpperCase()})</span>
          </div>
          <button class="btn-military btn-join-public-room" data-room-id="${r.roomId}" style="padding: 4px 12px; font-size: 11px;">
            JOIN
          </button>
        </div>
      `
      )
      .join('');

    this.mpPublicRoomsListEl
      .querySelectorAll('.btn-join-public-room')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const roomId = (btn as HTMLElement).getAttribute('data-room-id');
          if (!roomId) return;
          const { serverUrl, nickname } = this.getMpInputs();
          this.callbacks.onJoinMultiplayerByRoomId?.({
            serverUrl,
            nickname,
            roomId,
          });
        });
      });
  }

  public updateLobbyState(
    snapshot: NetRoomState,
    localSessionId: string
  ): void {
    this.mpLobbyRoomCodeEl.textContent = snapshot.roomCode;
    this.mpLobbyTitleEl.textContent = `${snapshot.roomName.toUpperCase()} (${!snapshot.isPublic ? 'PRIVATE' : 'PUBLIC'})`;

    const players = Object.values(snapshot.players);
    this.mpLobbyPlayersListEl.innerHTML = players
      .map((p) => {
        const isYou = p.id === localSessionId;
        const readyClass = p.ready ? 'ready' : 'unready';
        const readyLabel = p.ready ? 'READY' : 'NOT READY';
        return `
          <div class="mp-player-slot">
            <div>
              <strong style="font-size:14px;color:${isYou ? '#38d9c0' : '#f8fafc'};">
                ${this.escapeHtml(p.nickname)} ${isYou ? '(YOU)' : ''}
              </strong>
              ${p.isLeader ? '<span class="mp-badge host">HOST LEADER</span>' : ''}
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <span class="mp-badge ${readyClass}">${readyLabel}</span>
            </div>
          </div>
        `;
      })
      .join('');

    const localPlayer = snapshot.players[localSessionId];
    const isLeader = Boolean(localPlayer?.isLeader);
    this.mpStartMatchBtn.style.display = isLeader ? 'flex' : 'none';
  }

  public recordQuickChatBubble(sessionId: string, text: string): void {
    this.quickChatBubbles.set(sessionId, {
      text,
      expiresAt: performance.now() + 4200,
    });
  }

  public showGameplayHUD(): void {
    this.mainMenuEl.classList.add('hidden');
    this.multiplayerScreenEl.classList.add('hidden');
    this.pauseMenuEl.classList.add('hidden');
    this.resultScreenEl.classList.add('hidden');
    this.hudRoot.classList.remove('hidden');
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
    this.resultScreenEl.classList.remove('hidden');
    const titleEl = this.root.querySelector('#result-title')!;
    const subEl = this.root.querySelector('#result-sub')!;
    const descEl = this.root.querySelector('#result-desc')!;

    if (status.completed) {
      subEl.textContent = 'OPERATION SUCCESSFUL';
      titleEl.textContent =
        status.mode === 'training' ? 'TRAINING COMPLETE' : 'DISTRICT SECURED';
      descEl.textContent =
        status.mode === 'training'
          ? 'You have mastered ODM pendulum swinging, gas propulsion, and Nape execution.'
          : `All ${status.kills} hostile Titans in Valkenburg District have been eliminated.`;
    } else {
      subEl.textContent = 'VANGUARD FALLEN';
      titleEl.textContent = 'MISSION FAILED';
      descEl.textContent =
        'Your squad was overwhelmed in combat. Regroup and deploy again.';
    }

    this.root.querySelector('#result-score')!.textContent = String(status.score);
    this.root.querySelector('#result-rank')!.textContent = status.completed
      ? status.rank
      : 'F';
    this.root.querySelector('#result-time')!.textContent = this.formatTime(
      status.elapsedSeconds
    );

    if (coopSnapshot) {
      this.resultCoopBoardEl.classList.remove('hidden');
      const players = Object.values(coopSnapshot.players).sort(
        (a, b) => b.score - a.score
      );
      this.resultCoopBoardEl.innerHTML = `
        <div class="mp-section-title">CO-OP SQUAD PERFORMANCE LEDGER</div>
        ${players
          .map(
            (p) => `
          <div class="mp-room-item">
            <span><strong>${this.escapeHtml(p.nickname)}</strong></span>
            <span style="font-family:monospace;color:#cbd5e1;">
              KILLS: <strong style="color:#ff6466;">${p.kills}</strong> |
              ASSISTS: <strong style="color:#38d9c0;">${p.assists}</strong> |
              SCORE: <strong style="color:#c9a45c;">${p.score}</strong>
            </span>
          </div>
        `
          )
          .join('')}
      `;
    } else {
      this.resultCoopBoardEl.classList.add('hidden');
    }
  }

  public showCombatBanner(text: string): void {
    this.combatBannerEl.textContent = text;
    this.combatBannerEl.style.opacity = '1';
    this.bannerTimer = 1.65;
  }

  public flashDamageVignette(): void {
    this.damageVignetteEl.style.opacity = '1';
    setTimeout(() => {
      this.damageVignetteEl.style.opacity = '0';
    }, 260);
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
      pingMs = 0,
      reconnecting = false,
    } = params;

    if (this.bannerTimer > 0) {
      this.bannerTimer = Math.max(0, this.bannerTimer - dt);
      if (this.bannerTimer <= 0) {
        this.combatBannerEl.style.opacity = '0';
      }
    }

    // 1. Mission & Score
    this.missionTitleEl.textContent = missionStatus.title;
    this.missionObjEl.textContent = missionStatus.objectiveText;
    this.missionSubEl.textContent = missionStatus.subText;
    this.killsValEl.textContent = `${missionStatus.kills}/${missionStatus.targetKills}`;
    this.scoreValEl.textContent = String(missionStatus.score);
    this.timerValEl.textContent = this.formatTime(missionStatus.elapsedSeconds);

    if (combat.comboCount > 1) {
      this.comboBadgeEl.classList.remove('hidden');
      this.comboBadgeEl.textContent = `${combat.comboCount}x COMBO`;
    } else {
      this.comboBadgeEl.classList.add('hidden');
    }

    // 2. Player Bars (HP, Gas, Blades, Speed)
    const hpPct = Math.round((player.health / player.maxHealth) * 100);
    this.hpBarEl.style.width = `${hpPct}%`;
    this.hpTextEl.textContent = `${hpPct}%`;

    const gasPct = Math.round((player.gas / player.maxGas) * 100);
    this.gasBarEl.style.width = `${gasPct}%`;
    this.gasTextEl.textContent = `${gasPct}%`;

    const bladePct = Math.round(
      (player.bladeDurability / player.maxBladeDurability) * 100
    );
    this.bladeBarEl.style.width = `${bladePct}%`;
    this.bladeTextEl.textContent = `${bladePct}% (${player.spareBlades} SPARE)`;

    let pipsHtml = '';
    for (let i = 0; i < player.maxSpareBlades; i++) {
      pipsHtml += `<div class="blade-pip ${i < player.spareBlades ? 'active' : ''}"></div>`;
    }
    this.bladePipsEl.innerHTML = pipsHtml;

    const speed = player.velocity.length();
    this.speedTextEl.textContent = `${speed.toFixed(1)} m/s`;

    // Radial speed lines overlay when flying fast
    const speedOverlayAlpha = Math.max(0, Math.min(0.85, (speed - 19) / 28));
    this.speedLinesEl.style.opacity = String(speedOverlayAlpha);

    // 3. Crosshair & Grapple Range Brackets
    this.crosshairRingEl.classList.toggle('in-range', reticlePreview.canGrapple);
    this.crosshairRingEl.classList.toggle('locked', combat.lockedTitan !== null);

    this.leftBracketEl.classList.toggle('ready', reticlePreview.canGrapple);
    this.leftBracketEl.classList.toggle('active', odm.leftHook.active);
    this.rightBracketEl.classList.toggle('ready', reticlePreview.canGrapple);
    this.rightBracketEl.classList.toggle('active', odm.rightHook.active);

    // 4. Contextual Resupply / Blade Reload Prompt
    if (nearSupplyDepot) {
      this.centerPromptEl.classList.remove('hidden');
      this.centerPromptEl.textContent =
        '[R] RESUPPLY GAS, BLADES & MEDICAL KIT';
    } else if (player.bladeDurability <= 0 && player.spareBlades > 0) {
      this.centerPromptEl.classList.remove('hidden');
      this.centerPromptEl.textContent =
        '[R] BLADES DULL — PRESS R TO EQUIP FRESH BLADES';
    } else {
      this.centerPromptEl.classList.add('hidden');
    }

    // 5. 3D Projected Target Lock & Weak-Point Indicator
    const targetTitan =
      combat.lockedTitan && !combat.lockedTitan.isDead()
        ? combat.lockedTitan
        : this.findClosestAliveTitan(player.position, titans);

    if (targetTitan) {
      const zone = combat.lockedTitan ? combat.lockedZone : 'Nape';
      const hb = targetTitan.hurtboxes[zone];
      const screen = this.projectToScreen(hb.worldPosition, camera);
      if (screen.visible) {
        this.targetMarkerEl.classList.remove('hidden');
        this.targetMarkerEl.style.left = `${screen.x}px`;
        this.targetMarkerEl.style.top = `${screen.y}px`;
        const hpRatio = Math.round((hb.hp / hb.maxHp) * 100);
        const lockPrefix = combat.lockedTitan ? '[LOCKED] ' : '';
        this.targetLabelEl.textContent = `${lockPrefix}${zone.toUpperCase()} (${hpRatio}%)`;
      } else {
        this.targetMarkerEl.classList.add('hidden');
      }
    } else {
      this.targetMarkerEl.classList.add('hidden');
    }

    // 6. Co-op Squad Panel, Overhead Teammate Markers, Ping Markers & Downed Banner
    if (coopSnapshot) {
      this.netStatusEl.classList.remove('hidden');
      this.netStatusEl.textContent = `ROOM: ${coopSnapshot.roomCode} | PING: ${pingMs}ms | ${
        reconnecting ? 'RECONNECTING...' : 'ONLINE'
      }`;
      this.netStatusEl.style.borderColor = reconnecting ? '#ef4444' : '#38d9c0';

      this.squadPanelEl.classList.remove('hidden');
      const allPlayers = Object.values(coopSnapshot.players);
      this.squadPanelEl.innerHTML = allPlayers
        .map((p) => {
          const isYou = p.id === localSessionId;
          const dist = isYou
            ? 0
            : Math.round(
                Math.hypot(
                  p.position[0] - player.position.x,
                  p.position[1] - player.position.y,
                  p.position[2] - player.position.z
                )
              );
          const hpPercent = Math.round(
            (p.health / Math.max(1, p.maxHealth)) * 100
          );
          return `
            <div class="squad-member-row">
              <div class="squad-member-top">
                <span style="color:${isYou ? '#38d9c0' : '#f8fafc'};">
                  ${this.escapeHtml(p.nickname)} ${isYou ? '(YOU)' : `[${dist}m]`}
                </span>
                <span class="squad-life-badge ${p.lifeState}">
                  ${p.lifeState.toUpperCase()}
                </span>
              </div>
              <div class="bar-track" style="height:6px;">
                <div class="bar-fill hp" style="width:${hpPercent}%;background:${
            p.lifeState === 'downed' ? '#f59e0b' : '#22c55e'
          };"></div>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;font-family:monospace;">
                <span>K:${p.kills} A:${p.assists}</span>
                <span>PTS:${p.score}</span>
              </div>
            </div>
          `;
        })
        .join('');

      // Local player Downed / Reviving Banner
      const localNet = localSessionId
        ? coopSnapshot.players[localSessionId]
        : undefined;
      if (localNet?.lifeState === 'downed') {
        this.downedBannerEl.classList.remove('hidden');
        const revPct = Math.round(localNet.reviveProgress * 100);
        this.downedBannerEl.textContent =
          revPct > 0
            ? `ALLY REVIVING YOU (${revPct}%) — HOLD POSITION!`
            : `CRITICAL INJURY — BLEEDING OUT (${Math.ceil(
                localNet.downedTimer
              )}s) — WAIT FOR SQUAD REVIVE!`;
      } else if (localNet?.lifeState === 'dead') {
        this.downedBannerEl.classList.remove('hidden');
        this.downedBannerEl.textContent =
          'VANGUARD FALLEN — SPECTATING SQUAD (RESPAWN NEXT WAVE)';
      } else {
        // Check if local player is near a downed teammate
        const downedAlly = allPlayers.find(
          (p) =>
            p.id !== localSessionId &&
            p.lifeState === 'downed' &&
            Math.hypot(
              p.position[0] - player.position.x,
              p.position[1] - player.position.y,
              p.position[2] - player.position.z
            ) <= 6.0
        );
        if (downedAlly) {
          this.downedBannerEl.classList.remove('hidden');
          const revPct = Math.round(downedAlly.reviveProgress * 100);
          this.downedBannerEl.textContent = `[HOLD E] REVIVE ${downedAlly.nickname.toUpperCase()} (${revPct}%)`;
        } else {
          this.downedBannerEl.classList.add('hidden');
        }
      }

      // 3D Projected Overhead Teammate Markers
      const nowMs = performance.now();
      let tmHtml = '';
      if (remotePlayers) {
        for (const rp of remotePlayers) {
          const headWorld = rp.currentPosition
            .clone()
            .add(new THREE.Vector3(0, 2.25, 0));
          const proj = this.projectToScreen(headWorld, camera);
          if (!proj.visible) continue;
          const dist = Math.round(
            rp.currentPosition.distanceTo(player.position)
          );
          const s = rp.latestState;
          const hpPctRemote = Math.round(
            (s.health / Math.max(1, s.maxHealth)) * 100
          );
          const chat = this.quickChatBubbles.get(rp.id);
          const chatHtml =
            chat && chat.expiresAt > nowMs
              ? `<div class="teammate-chat-bubble">${this.escapeHtml(chat.text)}</div>`
              : '';
          const downedTag =
            s.lifeState === 'downed'
              ? `[DOWNED - HOLD E (${Math.round(s.reviveProgress * 100)}%)]`
              : `${dist}m`;

          tmHtml += `
            <div class="teammate-marker" style="left:${proj.x}px;top:${proj.y}px;">
              ${chatHtml}
              <div class="teammate-name-tag ${s.lifeState === 'downed' ? 'downed' : ''}">
                ${this.escapeHtml(rp.nickname)} · ${downedTag}
              </div>
              <div class="teammate-mini-hp">
                <div class="teammate-mini-hp-fill" style="width:${
                  s.lifeState === 'downed'
                    ? Math.round(s.reviveProgress * 100)
                    : hpPctRemote
                }%;background:${
            s.lifeState === 'downed' ? '#f59e0b' : '#22c55e'
          };"></div>
              </div>
            </div>
          `;
        }
      }
      this.teammateLabelsContainer.innerHTML = tmHtml;

      // 3D Projected Team Pings
      let pingHtml = '';
      for (const ping of coopSnapshot.pings) {
        const proj = this.projectToScreen(
          new THREE.Vector3(...ping.position),
          camera
        );
        if (proj.visible) {
          pingHtml += `
            <div class="ping-world-marker" style="left:${proj.x}px;top:${proj.y}px;">
              &#9888; ${this.escapeHtml(ping.senderName)}: ${this.escapeHtml(ping.message)}
            </div>
          `;
        }
      }
      this.pingMarkersContainer.innerHTML = pingHtml;
    } else {
      this.netStatusEl.classList.add('hidden');
      this.squadPanelEl.classList.add('hidden');
      this.downedBannerEl.classList.add('hidden');
      this.teammateLabelsContainer.innerHTML = '';
      this.pingMarkersContainer.innerHTML = '';
    }

    // 7. Optional AI State World Labels (Debug option)
    if (this.settings.debug.showAIStates) {
      let labelsHtml = '';
      for (const t of titans) {
        if (t.isDead()) continue;
        const headPos = t.position
          .clone()
          .add(new THREE.Vector3(0, t.heightMeters + 1.2, 0));
        const proj = this.projectToScreen(headPos, camera);
        if (proj.visible) {
          labelsHtml += `<div class="world-marker" style="left:${proj.x}px;top:${proj.y}px;background:rgba(0,0,0,0.8);padding:2px 6px;border:1px solid #38d9c0;font-size:10px;font-family:monospace;">${t.variant.toUpperCase()} [${t.aiState}] Nape:${t.hurtboxes.Nape.hp}</div>`;
        }
      }
      this.aiLabelsContainer.innerHTML = labelsHtml;
    } else {
      this.aiLabelsContainer.innerHTML = '';
    }

    // 8. Debug Performance Overlay
    if (this.settings.debug.showPerformanceOverlay) {
      this.debugOverlayEl.classList.remove('hidden');
      this.debugOverlayEl.innerHTML = `
        FPS: ${Math.round(fps)} | Draw Calls: ${drawCalls} | Tris: ${triangles} ${
        coopSnapshot ? `| Ping: ${pingMs}ms` : ''
      }<br/>
        Pos: (${player.position.x.toFixed(1)}, ${player.position.y.toFixed(1)}, ${player.position.z.toFixed(1)}) | Grounded: ${player.grounded}<br/>
        Hooks: L=${odm.leftHook.active ? (odm.leftHook.isTaut ? 'TAUT' : 'SLACK') : 'OFF'} R=${odm.rightHook.active ? (odm.rightHook.isTaut ? 'TAUT' : 'SLACK') : 'OFF'} | Anim: ${player.animator.getCurrentAnimation()}
      `;
    } else {
      this.debugOverlayEl.classList.add('hidden');
    }
  }

  private findClosestAliveTitan(
    playerPos: THREE.Vector3,
    titans: TitanEntity[]
  ): TitanEntity | null {
    let best: TitanEntity | null = null;
    let bestDist = 85;
    for (const t of titans) {
      if (t.isDead()) continue;
      const d = t.position.distanceTo(playerPos);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    return best;
  }

  private projectToScreen(
    worldPos: THREE.Vector3,
    camera: THREE.PerspectiveCamera
  ): { x: number; y: number; visible: boolean } {
    const v = worldPos.clone().project(camera);
    if (v.z > 1.0 || v.z < -1.0) {
      return { x: 0, y: 0, visible: false };
    }
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-(v.y * 0.5) + 0.5) * window.innerHeight;
    return { x, y, visible: true };
  }

  private formatTime(sec: number): string {
    const total = Math.max(0, Math.floor(sec));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
