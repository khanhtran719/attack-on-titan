import { CombatSystem } from '../combat/CombatSystem';
import { GAME_CONFIG, TacticalOverlayKeyMode } from '../config/GameConfig';
import { MissionStatus } from '../missions/MissionManager';
import { ODMSystem, ReticleGrapplePreview } from '../odm/ODMSystem';
import { PlayerController } from '../player/PlayerController';
import { NetRoomState } from '../shared/Protocol';

export type HookHudState = 'attached' | 'in-range' | 'ready' | 'out-of-range';

export class HudController {
  // Top-Left: Mission & Wave
  private missionTitleEl: HTMLElement;
  private waveBadgeEl: HTMLElement;
  private missionObjectiveEl: HTMLElement;

  // Top-Right: Kills / Target + Contextual Combo + Net Warning
  private killsEl: HTMLElement;
  private comboBadgeEl: HTMLElement;
  private netWarningEl: HTMLElement;

  // Center: Crosshair & Dual ODM Hook Brackets
  private crosshairRingEl: HTMLElement;
  private crosshairLeftEl: HTMLElement;
  private crosshairRightEl: HTMLElement;
  private crosshairLeftStateEl: HTMLElement;
  private crosshairRightStateEl: HTMLElement;

  // Contextual Center Prompts & Banners
  private combatBannerEl: HTMLElement;
  private contextPromptEl: HTMLElement;
  private contextPromptTextEl: HTMLElement;
  private contextProgressTrackEl: HTMLElement;
  private contextProgressFillEl: HTMLElement;

  // Bottom-Left: Slim HP, Gas & Speed
  private hpBarGroupEl: HTMLElement;
  private hpFillEl: HTMLElement;
  private hpTextEl: HTMLElement;
  private gasBarGroupEl: HTMLElement;
  private gasFillEl: HTMLElement;
  private gasTextEl: HTMLElement;
  private speedReadoutEl: HTMLElement;
  private speedValueEl: HTMLElement;

  // Bottom-Right: Blades, Thunder Spears & Tactical Hint
  private bladeBarGroupEl: HTMLElement;
  private bladeFillEl: HTMLElement;
  private bladeTextEl: HTMLElement;
  private bladePipsEls: HTMLElement[] = [];
  private spearTextEl: HTMLElement;
  private spearPipsEls: HTMLElement[] = [];
  private tacticalHintKeyEl: HTMLElement;

  // Screen Vignette & Speed Lines
  private damageVignetteEl: HTMLElement;
  private speedLinesEl: HTMLElement;

  private combatBannerTimeout: number | null = null;
  private damageVignetteTimer = 0;

  // Dirty-check cache
  private lastTitle = '';
  private lastWave = '';
  private lastObjective = '';
  private lastObjectiveVisible = false;
  private lastKillsStr = '';
  private lastCombo = -1;
  private lastNetWarning = '';
  private lastLeftHookState: HookHudState | '' = '';
  private lastRightHookState: HookHudState | '' = '';
  private lastLeftHookText = '';
  private lastRightHookText = '';
  private lastRingState = '';
  private lastHpPct = -1;
  private lastHpLow = false;
  private lastGasPct = -1;
  private lastGasLow = false;
  private lastSpeedInt = -1;
  private lastSpeedHigh = false;
  private lastBladePct = -1;
  private lastBladeLow = false;
  private lastSpareBlades = -1;
  private lastSpears = -1;
  private lastPromptText = '';
  private lastPromptMode = '';
  private lastPromptProgress = -1;
  private lastHintKeyMode: TacticalOverlayKeyMode | '' = '';

  constructor(root: HTMLElement) {
    this.missionTitleEl = root.querySelector('#hud-mission-title')!;
    this.waveBadgeEl = root.querySelector('#hud-wave-badge')!;
    this.missionObjectiveEl = root.querySelector('#hud-mission-objective')!;

    this.killsEl = root.querySelector('#hud-kills')!;
    this.comboBadgeEl = root.querySelector('#hud-combo-badge')!;
    this.netWarningEl = root.querySelector('#hud-net-warning')!;

    this.crosshairRingEl = root.querySelector('#crosshair-ring')!;
    this.crosshairLeftEl = root.querySelector('#crosshair-left')!;
    this.crosshairRightEl = root.querySelector('#crosshair-right')!;
    this.crosshairLeftStateEl = root.querySelector('#crosshair-left-state')!;
    this.crosshairRightStateEl = root.querySelector('#crosshair-right-state')!;

    this.combatBannerEl = root.querySelector('#combat-banner')!;
    this.contextPromptEl = root.querySelector('#resupply-prompt')!;
    this.contextPromptTextEl = root.querySelector('#resupply-prompt-text')!;
    this.contextProgressTrackEl = root.querySelector(
      '#context-progress-track'
    )!;
    this.contextProgressFillEl = root.querySelector('#context-progress-fill')!;

    this.hpBarGroupEl = root.querySelector('#hud-hp-group')!;
    this.hpFillEl = root.querySelector('#hp-bar-fill')!;
    this.hpTextEl = root.querySelector('#hp-text')!;
    this.gasBarGroupEl = root.querySelector('#hud-gas-group')!;
    this.gasFillEl = root.querySelector('#gas-bar-fill')!;
    this.gasTextEl = root.querySelector('#gas-text')!;
    this.speedReadoutEl = root.querySelector('#speed-readout')!;
    this.speedValueEl = root.querySelector('#speed-value')!;

    this.bladeBarGroupEl = root.querySelector('#hud-blade-group')!;
    this.bladeFillEl = root.querySelector('#blade-bar-fill')!;
    this.bladeTextEl = root.querySelector('#blade-text')!;
    this.spearTextEl = root.querySelector('#spear-text')!;
    this.tacticalHintKeyEl = root.querySelector('#hud-tactical-key-pill')!;

    this.damageVignetteEl = root.querySelector('#damage-vignette')!;
    this.speedLinesEl = root.querySelector('#speed-lines-overlay')!;

    const bladePipsContainer = root.querySelector('#blade-pips')!;
    bladePipsContainer.innerHTML = '';
    for (let i = 0; i < GAME_CONFIG.player.maxSpareBlades; i++) {
      const pip = document.createElement('span');
      pip.className = 'blade-pip active';
      bladePipsContainer.appendChild(pip);
      this.bladePipsEls.push(pip);
    }

    const spearPipsContainer = root.querySelector('#spear-pips')!;
    spearPipsContainer.innerHTML = '';
    for (let i = 0; i < GAME_CONFIG.player.maxThunderSpears; i++) {
      const pip = document.createElement('span');
      pip.className = 'spear-pip active';
      spearPipsContainer.appendChild(pip);
      this.spearPipsEls.push(pip);
    }
  }

  public showCombatBanner(text: string): void {
    this.combatBannerEl.textContent = text;
    this.combatBannerEl.classList.remove('hidden');
    if (this.combatBannerTimeout !== null) {
      window.clearTimeout(this.combatBannerTimeout);
    }
    this.combatBannerTimeout = window.setTimeout(() => {
      this.combatBannerEl.classList.add('hidden');
    }, 2200);
  }

  public flashDamageVignette(): void {
    this.damageVignetteTimer = 0.42;
    this.damageVignetteEl.style.opacity = '0.82';
  }

  public update(params: {
    dt: number;
    player: PlayerController;
    odm: ODMSystem;
    combat: CombatSystem;
    missionStatus: MissionStatus;
    reticlePreview: ReticleGrapplePreview;
    nearSupplyDepot: boolean;
    coopSnapshot?: NetRoomState | null;
    localSessionId?: string;
    pingMs?: number;
    reconnecting?: boolean;
    tacticalKeyMode: TacticalOverlayKeyMode;
  }): void {
    const {
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
    } = params;

    if (this.damageVignetteTimer > 0) {
      this.damageVignetteTimer = Math.max(0, this.damageVignetteTimer - dt);
      this.damageVignetteEl.style.opacity = String(
        (this.damageVignetteTimer / 0.42) * 0.82
      );
    }

    const speed = player.velocity.length();
    const speedRatio = Math.max(0, Math.min(1, (speed - 19) / 24));
    this.speedLinesEl.style.opacity = (
      speedRatio * (player.isBoosting ? 0.65 : 0.35)
    ).toFixed(2);

    // Top-Left: Mission Name & Wave
    const cleanTitle = missionStatus.title.includes('—')
      ? missionStatus.title.split('—')[0].trim()
      : missionStatus.title;
    if (this.lastTitle !== cleanTitle) {
      this.missionTitleEl.textContent = cleanTitle;
      this.lastTitle = cleanTitle;
    }

    const waveStr =
      missionStatus.mode === 'training'
        ? 'Training'
        : `Wave ${missionStatus.wave} / ${missionStatus.maxWaves}`;
    if (this.lastWave !== waveStr) {
      this.waveBadgeEl.textContent = waveStr;
      this.lastWave = waveStr;
    }

    const showObjInHud = missionStatus.mode === 'training';
    if (this.lastObjectiveVisible !== showObjInHud) {
      this.missionObjectiveEl.classList.toggle('hidden', !showObjInHud);
      this.lastObjectiveVisible = showObjInHud;
    }
    if (showObjInHud && this.lastObjective !== missionStatus.objectiveText) {
      this.missionObjectiveEl.textContent = missionStatus.objectiveText;
      this.lastObjective = missionStatus.objectiveText;
    }

    // Top-Right: Titans Slain / Target + Contextual Combo + Net Warning
    const killsStr = `${missionStatus.kills} / ${missionStatus.targetKills}`;
    if (this.lastKillsStr !== killsStr) {
      this.killsEl.textContent = killsStr;
      this.lastKillsStr = killsStr;
    }

    const combo = combat.comboCount;
    if (this.lastCombo !== combo) {
      if (combo > 1) {
        this.comboBadgeEl.classList.remove('hidden');
        this.comboBadgeEl.textContent = `${combo}× Combo`;
      } else {
        this.comboBadgeEl.classList.add('hidden');
      }
      this.lastCombo = combo;
    }

    let netWarn = '';
    if (reconnecting) {
      netWarn = 'Reconnecting to server...';
    } else if (missionStatus.mode === 'coop' && (pingMs || 0) >= 180) {
      netWarn = `High Latency (${Math.round(pingMs || 0)} ms)`;
    }
    if (this.lastNetWarning !== netWarn) {
      this.netWarningEl.textContent = netWarn;
      this.netWarningEl.classList.toggle('hidden', !netWarn);
      this.lastNetWarning = netWarn;
    }

    // Center: Crosshair & Left/Right ODM Hook States
    const maxRange = GAME_CONFIG.odm.maxGrappleRange;
    const leftState = this.resolveHookHudState(
      odm.leftHook.active,
      reticlePreview.canGrapple,
      reticlePreview.distance,
      maxRange
    );
    const rightState = this.resolveHookHudState(
      odm.rightHook.active,
      reticlePreview.canGrapple,
      reticlePreview.distance,
      maxRange
    );

    if (this.lastLeftHookState !== leftState) {
      this.applyHookDomState(this.crosshairLeftEl, leftState);
      this.lastLeftHookState = leftState;
    }
    if (this.lastRightHookState !== rightState) {
      this.applyHookDomState(this.crosshairRightEl, rightState);
      this.lastRightHookState = rightState;
    }

    const leftText = odm.leftHook.active
      ? `${Math.round(odm.leftHook.restLength)}m`
      : leftState === 'in-range'
        ? `${Math.round(reticlePreview.distance)}m`
        : '';
    if (this.lastLeftHookText !== leftText) {
      this.crosshairLeftStateEl.textContent = leftText;
      this.lastLeftHookText = leftText;
    }

    const rightText = odm.rightHook.active
      ? `${Math.round(odm.rightHook.restLength)}m`
      : rightState === 'in-range'
        ? `${Math.round(reticlePreview.distance)}m`
        : '';
    if (this.lastRightHookText !== rightText) {
      this.crosshairRightStateEl.textContent = rightText;
      this.lastRightHookText = rightText;
    }

    const ringState =
      odm.leftHook.active || odm.rightHook.active
        ? 'attached'
        : reticlePreview.isTitan && reticlePreview.canGrapple
          ? 'titan-target'
          : reticlePreview.canGrapple
            ? 'in-range'
            : 'idle';
    if (this.lastRingState !== ringState) {
      this.crosshairRingEl.dataset.ringState = ringState;
      this.lastRingState = ringState;
    }

    // Bottom-Left: Slim HP, Gas & Airspeed
    const hpPct = Math.max(0, Math.round(player.health));
    if (this.lastHpPct !== hpPct) {
      this.hpFillEl.style.width = `${hpPct}%`;
      this.hpTextEl.textContent = `${hpPct}`;
      this.lastHpPct = hpPct;
    }
    const hpLow = hpPct <= 30;
    if (this.lastHpLow !== hpLow) {
      this.hpBarGroupEl.classList.toggle('is-low', hpLow);
      this.lastHpLow = hpLow;
    }

    const gasPct = Math.max(0, Math.round(player.gas));
    if (this.lastGasPct !== gasPct) {
      this.gasFillEl.style.width = `${gasPct}%`;
      this.gasTextEl.textContent = `${gasPct}%`;
      this.lastGasPct = gasPct;
    }
    const gasLow = gasPct <= 22;
    if (this.lastGasLow !== gasLow) {
      this.gasBarGroupEl.classList.toggle('is-low', gasLow);
      this.lastGasLow = gasLow;
    }

    const speedInt = Math.round(speed);
    if (this.lastSpeedInt !== speedInt) {
      this.speedValueEl.textContent = String(speedInt);
      this.lastSpeedInt = speedInt;
    }
    const speedHigh = speed >= 24 || player.isBoosting;
    if (this.lastSpeedHigh !== speedHigh) {
      this.speedReadoutEl.classList.toggle('is-fast', speedHigh);
      this.lastSpeedHigh = speedHigh;
    }

    // Bottom-Right: Blades, Thunder Spears & Tactical Hint
    const bladePct = Math.max(0, Math.round(player.bladeDurability));
    if (this.lastBladePct !== bladePct) {
      this.bladeFillEl.style.width = `${bladePct}%`;
      this.bladeTextEl.textContent = `${bladePct}%`;
      this.lastBladePct = bladePct;
    }
    const bladeLow = bladePct <= 25;
    if (this.lastBladeLow !== bladeLow) {
      this.bladeBarGroupEl.classList.toggle('is-low', bladeLow);
      this.lastBladeLow = bladeLow;
    }

    if (this.lastSpareBlades !== player.spareBlades) {
      for (let i = 0; i < this.bladePipsEls.length; i++) {
        this.bladePipsEls[i].classList.toggle(
          'active',
          i < player.spareBlades
        );
      }
      this.lastSpareBlades = player.spareBlades;
    }

    if (this.lastSpears !== player.thunderSpears) {
      this.spearTextEl.textContent = `${player.thunderSpears} / ${GAME_CONFIG.player.maxThunderSpears}`;
      for (let i = 0; i < this.spearPipsEls.length; i++) {
        this.spearPipsEls[i].classList.toggle(
          'active',
          i < player.thunderSpears
        );
      }
      this.lastSpears = player.thunderSpears;
    }

    if (this.lastHintKeyMode !== tacticalKeyMode) {
      this.tacticalHintKeyEl.textContent =
        tacticalKeyMode === 'Tab' ? 'Tab' : 'H';
      this.lastHintKeyMode = tacticalKeyMode;
    }

    this.updateContextualPrompt(
      player,
      nearSupplyDepot,
      coopSnapshot,
      localSessionId,
      reconnecting
    );
  }

  private resolveHookHudState(
    active: boolean,
    canGrapple: boolean,
    distance: number,
    maxRange: number
  ): HookHudState {
    if (active) return 'attached';
    if (!canGrapple) return 'out-of-range';
    if (distance <= maxRange * 0.86) return 'in-range';
    return 'ready';
  }

  private applyHookDomState(el: HTMLElement, state: HookHudState): void {
    el.dataset.hookState = state;
    el.classList.toggle('active', state === 'attached');
    el.classList.toggle('hook-attached', state === 'attached');
    el.classList.toggle('hook-in-range', state === 'in-range');
    el.classList.toggle('hook-ready', state === 'ready');
    el.classList.toggle('hook-out-of-range', state === 'out-of-range');
  }

  private updateContextualPrompt(
    player: PlayerController,
    nearSupplyDepot: boolean,
    coopSnapshot: NetRoomState | null | undefined,
    localSessionId: string | undefined,
    reconnecting: boolean | undefined
  ): void {
    const myNetPlayer =
      coopSnapshot && localSessionId
        ? coopSnapshot.players[localSessionId]
        : null;

    let nearDownedAllyName: string | null = null;
    let nearDownedProgress = 0;
    if (coopSnapshot && localSessionId) {
      for (const p of Object.values(coopSnapshot.players)) {
        if (p.id === localSessionId || p.lifeState !== 'downed') continue;
        const d = Math.hypot(
          p.position[0] - player.position.x,
          p.position[1] - player.position.y,
          p.position[2] - player.position.z
        );
        if (d <= 5.5) {
          nearDownedAllyName = p.nickname;
          nearDownedProgress = p.reviveProgress || 0;
          break;
        }
      }
    }

    let text = '';
    let mode = '';
    let progress = -1;

    if (reconnecting) {
      text = 'Connection interrupted · Attempting to rejoin squad...';
      mode = 'danger';
    } else if (myNetPlayer?.lifeState === 'downed') {
      const bleedSec = Math.ceil(myNetPlayer.downedTimer);
      const revPct = Math.round((myNetPlayer.reviveProgress || 0) * 100);
      text =
        revPct > 0
          ? `Being Revived by Teammate (${revPct}%)`
          : `Downed · Bleedout in ${bleedSec}s · Ping [G] for Help`;
      mode = 'danger';
      progress = revPct > 0 ? revPct : Math.round((bleedSec / 25) * 100);
    } else if (myNetPlayer?.lifeState === 'dead') {
      text = 'Fallen in Action · Spectating Squad until Wave Clear';
      mode = 'danger';
    } else if (player.grabbedByTitanId || myNetPlayer?.grabbedByTitanId) {
      const escPct = Math.round(
        (myNetPlayer
          ? myNetPlayer.grabEscapeProgress
          : player.grabEscapeProgress) * 100
      );
      text = `Grabbed by Titan · Mash [F] / [Space] or Fire [V] (${escPct}%)`;
      mode = 'danger';
      progress = escPct;
    } else if (nearDownedAllyName) {
      const revPct = Math.round(nearDownedProgress * 100);
      text = `Hold [E] · Revive ${nearDownedAllyName}${revPct > 0 ? ` (${revPct}%)` : ''}`;
      mode = 'tactical';
      progress = revPct;
    } else if (nearSupplyDepot) {
      text = 'Press [R] · Resupply Gas, Blades & Thunder Spears';
      mode = 'supply';
    } else if (player.bladeDurability <= 0 && player.spareBlades > 0) {
      text = 'Blades Dull · Press [R] to Reload Fresh Blades';
      mode = 'warning';
    }

    if (!text) {
      if (this.lastPromptText !== '') {
        this.contextPromptEl.classList.add('hidden');
        this.lastPromptText = '';
        this.lastPromptMode = '';
        this.lastPromptProgress = -1;
      }
      return;
    }

    if (this.lastPromptText === '') {
      this.contextPromptEl.classList.remove('hidden');
    }

    if (this.lastPromptText !== text) {
      this.contextPromptTextEl.textContent = text;
      this.lastPromptText = text;
    }

    if (this.lastPromptMode !== mode) {
      this.contextPromptEl.dataset.promptMode = mode;
      this.lastPromptMode = mode;
    }

    const showProgress = progress >= 0;
    this.contextProgressTrackEl.classList.toggle('hidden', !showProgress);
    if (showProgress && this.lastPromptProgress !== progress) {
      this.contextProgressFillEl.style.width = `${Math.max(0, Math.min(100, progress))}%`;
      this.lastPromptProgress = progress;
    }
  }
}
