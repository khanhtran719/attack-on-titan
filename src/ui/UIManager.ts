import * as THREE from 'three';
import { CombatSystem } from '../combat/CombatSystem';
import { UserSettings } from '../config/GameConfig';
import { SaveProgress } from '../core/SaveManager';
import { TitanEntity } from '../enemies/TitanEntity';
import { GameMode, MissionStatus } from '../missions/MissionManager';
import { ODMSystem, ReticleGrapplePreview } from '../odm/ODMSystem';
import { PlayerController } from '../player/PlayerController';

export interface UICallbacks {
  onStartGame: (mode: GameMode) => void;
  onResumeGame: () => void;
  onRestartMission: () => void;
  onReturnMainMenu: () => void;
  onSettingsChanged: (newSettings: Partial<UserSettings>) => void;
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
  private combatBannerEl!: HTMLElement;
  private debugOverlayEl!: HTMLElement;
  private aiLabelsContainer!: HTMLElement;

  // Menu Screens
  private mainMenuEl!: HTMLElement;
  private pauseMenuEl!: HTMLElement;
  private settingsModalEl!: HTMLElement;
  private resultScreenEl!: HTMLElement;

  private bannerTimer = 0;

  constructor(
    container: HTMLElement,
    private settings: UserSettings,
    private progress: SaveProgress,
    private callbacks: UICallbacks
  ) {
    this.root = container;
    this.buildDOM();
  }

  private buildDOM(): void {
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
        </div>

        <div class="hud-top-right">
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

        <!-- Contextual Center Prompt & Combat Banner -->
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
              <span>DEPLOY: TITAN HUNT (DEFEND VALKENBURG)</span>
              <span>&#9654;</span>
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
        <div class="menu-box">
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
    this.combatBannerEl = this.root.querySelector('#hud-combat-banner')!;
    this.debugOverlayEl = this.root.querySelector('#hud-debug-overlay')!;
    this.aiLabelsContainer = this.root.querySelector('#ai-labels-container')!;

    this.mainMenuEl = this.root.querySelector('#main-menu-screen')!;
    this.pauseMenuEl = this.root.querySelector('#pause-menu-screen')!;
    this.settingsModalEl = this.root.querySelector('#settings-modal-screen')!;
    this.resultScreenEl = this.root.querySelector('#result-screen')!;

    this.bindMenuEvents();
  }

  private bindMenuEvents(): void {
    this.root
      .querySelector('#btn-start-hunt')!
      .addEventListener('click', () => {
        this.showGameplayHUD();
        this.callbacks.onStartGame('hunt');
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
    this.pauseMenuEl.classList.add('hidden');
    this.resultScreenEl.classList.add('hidden');
    this.mainMenuEl.classList.remove('hidden');
  }

  public showGameplayHUD(): void {
    this.mainMenuEl.classList.add('hidden');
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

  public showResultScreen(status: MissionStatus): void {
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
        'Your hunter was overwhelmed in combat. Regroup and deploy again.';
    }

    this.root.querySelector('#result-score')!.textContent = String(status.score);
    this.root.querySelector('#result-rank')!.textContent = status.completed
      ? status.rank
      : 'F';
    this.root.querySelector('#result-time')!.textContent = this.formatTime(
      status.elapsedSeconds
    );
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

    // 6. Optional AI State World Labels (Debug option)
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

    // 7. Debug Performance Overlay
    if (this.settings.debug.showPerformanceOverlay) {
      this.debugOverlayEl.classList.remove('hidden');
      this.debugOverlayEl.innerHTML = `
        FPS: ${Math.round(fps)} | Draw Calls: ${drawCalls} | Tris: ${triangles}<br/>
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
}
