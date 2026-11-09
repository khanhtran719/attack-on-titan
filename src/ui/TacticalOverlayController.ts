import { CombatSystem } from '../combat/CombatSystem';
import { TacticalOverlayKeyMode } from '../config/GameConfig';
import { MissionStatus } from '../missions/MissionManager';
import { ODMSystem } from '../odm/ODMSystem';
import { PlayerController } from '../player/PlayerController';
import { NetRoomState } from '../shared/Protocol';

interface SquadRowRefs {
  row: HTMLDivElement;
  nameEl: HTMLSpanElement;
  statusEl: HTMLSpanElement;
  hpFillEl: HTMLDivElement;
  statsEl: HTMLSpanElement;
  lastKey: string;
}

export class TacticalOverlayController {
  private overlayEl: HTMLElement;
  private missionTitleEl: HTMLElement;
  private missionObjectiveEl: HTMLElement;
  private roomBadgeEl: HTMLElement;
  private scoreEl: HTMLElement;
  private timeEl: HTMLElement;
  private rankEl: HTMLElement;
  private pingPillEl: HTMLElement;
  private pingEl: HTMLElement;
  private fpsEl: HTMLElement;
  private squadSectionEl: HTMLElement;
  private squadListEl: HTMLElement;
  private keyHintBadgeEl: HTMLElement;
  private lockKeyHintEl: HTMLElement;
  private debugOverlayEl: HTMLElement;

  private squadRowPool: Map<string, SquadRowRefs> = new Map();

  private isVisible = false;
  private lastTitle = '';
  private lastObjective = '';
  private lastRoomCode = '';
  private lastScore = -1;
  private lastTimeStr = '';
  private lastRank = '';
  private lastPing = -1;
  private lastFps = -1;
  private lastKeyMode: TacticalOverlayKeyMode | '' = '';
  private lastDebugVisible = false;
  private lastDebugText = '';

  constructor(root: HTMLElement) {
    this.overlayEl = root.querySelector('#hud-tactical-overlay')!;
    this.missionTitleEl = root.querySelector('#tactical-mission-title')!;
    this.missionObjectiveEl = root.querySelector('#tactical-mission-objective')!;
    this.roomBadgeEl = root.querySelector('#tactical-room-badge')!;
    this.scoreEl = root.querySelector('#hud-score')!;
    this.timeEl = root.querySelector('#hud-time')!;
    this.rankEl = root.querySelector('#hud-rank')!;
    this.pingPillEl = root.querySelector('#hud-ping-pill')!;
    this.pingEl = root.querySelector('#hud-ping')!;
    this.fpsEl = root.querySelector('#tactical-fps')!;
    this.squadSectionEl = root.querySelector('#tactical-squad-section')!;
    this.squadListEl = root.querySelector('#hud-squad-panel')!;
    this.keyHintBadgeEl = root.querySelector('#tactical-overlay-key-label')!;
    this.lockKeyHintEl = root.querySelector('#tactical-lock-key-label')!;
    this.debugOverlayEl = root.querySelector('#debug-overlay')!;
  }

  public update(params: {
    held: boolean;
    keyMode: TacticalOverlayKeyMode;
    missionStatus: MissionStatus;
    coopSnapshot?: NetRoomState | null;
    localSessionId?: string;
    player: PlayerController;
    odm: ODMSystem;
    combat: CombatSystem;
    fps: number;
    drawCalls: number;
    triangles: number;
    pingMs?: number;
    reconnecting?: boolean;
    showPerformanceOverlay: boolean;
  }): void {
    const {
      held,
      keyMode,
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
      showPerformanceOverlay,
    } = params;

    if (this.lastKeyMode !== keyMode) {
      this.keyHintBadgeEl.textContent =
        keyMode === 'Tab' ? 'Hold [Tab]' : 'Hold [H / ~]';
      this.lockKeyHintEl.textContent =
        keyMode === 'Tab' ? 'MMB / T' : 'Tab / MMB';
      this.lastKeyMode = keyMode;
    }

    if (this.isVisible !== held) {
      this.overlayEl.classList.toggle('is-visible', held);
      this.overlayEl.setAttribute('aria-hidden', held ? 'false' : 'true');
      this.isVisible = held;
    }

    const scoreRounded = Math.round(missionStatus.score);
    if (this.lastScore !== scoreRounded) {
      this.scoreEl.textContent = scoreRounded.toLocaleString();
      this.lastScore = scoreRounded;
    }

    const mins = Math.floor(missionStatus.elapsedSeconds / 60);
    const secs = Math.floor(missionStatus.elapsedSeconds % 60);
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    if (this.lastTimeStr !== timeStr) {
      this.timeEl.textContent = timeStr;
      this.lastTimeStr = timeStr;
    }

    if (this.lastRank !== missionStatus.rank) {
      this.rankEl.textContent = missionStatus.rank;
      this.lastRank = missionStatus.rank;
    }

    const isCoop = missionStatus.mode === 'coop' && Boolean(coopSnapshot);
    this.pingPillEl.classList.toggle('hidden', !isCoop);

    if (isCoop) {
      const pingVal = reconnecting ? -999 : Math.round(pingMs || 0);
      if (this.lastPing !== pingVal) {
        this.pingEl.textContent = reconnecting
          ? 'RECONNECTING'
          : `${Math.max(0, pingVal)} ms`;
        this.lastPing = pingVal;
      }
    }

    if (held || isCoop) {
      if (this.lastTitle !== missionStatus.title) {
        this.missionTitleEl.textContent = missionStatus.title;
        this.lastTitle = missionStatus.title;
      }
      if (this.lastObjective !== missionStatus.objectiveText) {
        this.missionObjectiveEl.textContent = missionStatus.objectiveText;
        this.lastObjective = missionStatus.objectiveText;
      }

      const fpsRounded = Math.round(fps);
      if (this.lastFps !== fpsRounded) {
        this.fpsEl.textContent = `${fpsRounded} FPS`;
        this.lastFps = fpsRounded;
      }

      const roomCode = coopSnapshot?.roomCode || '';
      if (this.lastRoomCode !== roomCode) {
        this.roomBadgeEl.textContent = roomCode
          ? `ROOM ${roomCode}`
          : 'SOLO DEPLOYMENT';
        this.lastRoomCode = roomCode;
      }

      this.updateSquadTable(coopSnapshot, localSessionId, player);
    }

    if (this.lastDebugVisible !== showPerformanceOverlay) {
      this.debugOverlayEl.classList.toggle('hidden', !showPerformanceOverlay);
      this.lastDebugVisible = showPerformanceOverlay;
    }

    if (showPerformanceOverlay) {
      const lDbg = odm.lastLeftDebug
        ? `${odm.lastLeftDebug.reason}(${odm.lastLeftDebug.distance.toFixed(0)}m)`
        : 'IDLE';
      const rDbg = odm.lastRightDebug
        ? `${odm.lastRightDebug.reason}(${odm.lastRightDebug.distance.toFixed(0)}m)`
        : 'IDLE';
      const speed = player.velocity.length();
      const debugStr =
        `FPS ${Math.round(fps)} · ${speed.toFixed(1)} m/s · GND ${player.grounded ? 'Y' : 'N'} · ` +
        `POS (${player.position.x.toFixed(0)}, ${player.position.y.toFixed(0)}, ${player.position.z.toFixed(0)}) · ` +
        `L:${odm.leftHook.active ? 'ON' : 'OFF'}[${lDbg}] R:${odm.rightHook.active ? 'ON' : 'OFF'}[${rDbg}] · ` +
        `LOCK ${combat.lockedTitan ? combat.lockedZone : 'NONE'} · DC ${drawCalls} · TRI ${(triangles / 1000).toFixed(1)}k`;
      if (this.lastDebugText !== debugStr) {
        this.debugOverlayEl.textContent = debugStr;
        this.lastDebugText = debugStr;
      }
    }
  }

  private updateSquadTable(
    snapshot: NetRoomState | null | undefined,
    localSessionId: string | undefined,
    localPlayer: PlayerController
  ): void {
    if (!snapshot) {
      this.squadSectionEl.classList.add('hidden');
      this.squadListEl.classList.add('hidden');
      for (const refs of this.squadRowPool.values()) {
        refs.row.remove();
      }
      this.squadRowPool.clear();
      return;
    }

    this.squadSectionEl.classList.remove('hidden');
    this.squadListEl.classList.remove('hidden');

    const players = Object.values(snapshot.players);
    const activeIds = new Set<string>();

    for (const p of players) {
      activeIds.add(p.id);
      let refs = this.squadRowPool.get(p.id);
      if (!refs) {
        refs = this.createSquadRowDom();
        this.squadRowPool.set(p.id, refs);
        this.squadListEl.appendChild(refs.row);
      }

      const isMe = p.id === localSessionId;
      const dist = isMe
        ? 0
        : Math.round(
            Math.hypot(
              p.position[0] - localPlayer.position.x,
              p.position[1] - localPlayer.position.y,
              p.position[2] - localPlayer.position.z
            )
          );
      const hpPct = Math.max(0, Math.min(100, Math.round(p.health)));
      const stateTag =
        p.lifeState === 'downed'
          ? 'DOWNED'
          : p.lifeState === 'dead'
            ? 'KIA'
            : p.grabbedByTitanId
              ? 'GRABBED'
              : 'ACTIVE';

      const cacheKey = `${p.nickname}|${isMe}|${stateTag}|${hpPct}|${p.kills}|${p.assists}|${p.score}|${dist}`;
      if (refs.lastKey !== cacheKey) {
        refs.row.classList.toggle('is-self', isMe);
        refs.row.classList.toggle('is-downed', p.lifeState === 'downed');
        refs.nameEl.textContent = `${p.nickname}${isMe ? ' (You)' : ''}`;
        refs.statusEl.textContent = isMe ? stateTag : `${stateTag} · ${dist}m`;
        refs.hpFillEl.style.width = `${hpPct}%`;
        refs.statsEl.textContent = `${p.kills}K · ${p.assists}A · ${p.score} pts`;
        refs.lastKey = cacheKey;
      }
    }

    for (const [id, refs] of this.squadRowPool.entries()) {
      if (!activeIds.has(id)) {
        refs.row.remove();
        this.squadRowPool.delete(id);
      }
    }
  }

  private createSquadRowDom(): SquadRowRefs {
    const row = document.createElement('div');
    row.className = 'squad-member-card';

    const topRow = document.createElement('div');
    topRow.className = 'squad-member-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'squad-member-name';

    const statusEl = document.createElement('span');
    statusEl.className = 'squad-member-dist';

    topRow.append(nameEl, statusEl);

    const hpTrack = document.createElement('div');
    hpTrack.className = 'squad-hp-track';
    const hpFillEl = document.createElement('div');
    hpFillEl.className = 'squad-hp-fill';
    hpTrack.appendChild(hpFillEl);

    const statsEl = document.createElement('span');
    statsEl.className = 'squad-member-stats';

    row.append(topRow, hpTrack, statsEl);
    return {
      row,
      nameEl,
      statusEl,
      hpFillEl,
      statsEl,
      lastKey: '',
    };
  }
}
