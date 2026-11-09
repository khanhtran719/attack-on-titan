import * as THREE from 'three';
import { CombatSystem } from '../combat/CombatSystem';
import { GAME_CONFIG } from '../config/GameConfig';
import { TitanEntity } from '../enemies/TitanEntity';
import { RemotePlayerEntity } from '../network/RemotePlayerManager';
import { NetRoomState } from '../shared/Protocol';

interface TeammateMarkerRefs {
  root: HTMLDivElement;
  chatEl: HTMLDivElement;
  tagEl: HTMLDivElement;
  hpFillEl: HTMLDivElement;
  reviveFillEl: HTMLDivElement;
  reviveTrackEl: HTMLDivElement;
  lastTagText: string;
  lastChatText: string;
  lastHpPct: number;
  lastRevivePct: number;
  lastDowned: boolean;
}

interface PingMarkerRefs {
  root: HTMLDivElement;
  labelEl: HTMLSpanElement;
  lastLabelText: string;
  lastKind: string;
}

export class WorldMarkersController {
  private targetLockEl: HTMLElement;
  private targetLockZoneEl: HTMLElement;
  private targetLockHpFillEl: HTMLElement;
  private teammateContainer: HTMLElement;
  private pingContainer: HTMLElement;
  private aiLabelsContainer: HTMLElement;

  private teammatePool: Map<string, TeammateMarkerRefs> = new Map();
  private pingPool: Map<string, PingMarkerRefs> = new Map();
  private aiLabelPool: Map<string, HTMLDivElement> = new Map();
  private quickChatBubbles: Map<string, { text: string; expiresAt: number }> =
    new Map();

  private lastTargetZoneText = '';
  private lastTargetHpPct = -1;
  private lastTargetVisible = false;

  constructor(root: HTMLElement) {
    this.targetLockEl = root.querySelector('#target-lock-indicator')!;
    this.targetLockZoneEl = root.querySelector('#target-lock-zone-text')!;
    this.targetLockHpFillEl = root.querySelector('#target-lock-hp-fill')!;
    this.teammateContainer = root.querySelector('#teammate-labels-container')!;
    this.pingContainer = root.querySelector('#ping-markers-container')!;
    this.aiLabelsContainer = root.querySelector('#titan-ai-labels-container')!;
  }

  public recordQuickChatBubble(playerId: string, text: string): void {
    this.quickChatBubbles.set(playerId, {
      text,
      expiresAt: performance.now() + 4200,
    });
  }

  public updateTargetLock(
    combat: CombatSystem,
    camera: THREE.PerspectiveCamera
  ): void {
    const lockedTitan = combat.lockedTitan;
    if (!lockedTitan || lockedTitan.isDead()) {
      if (this.lastTargetVisible) {
        this.targetLockEl.classList.add('hidden');
        this.lastTargetVisible = false;
      }
      return;
    }

    const zone = combat.lockedZone;
    const hb = lockedTitan.hurtboxes[zone];
    const screenPos = this.projectToScreen(hb.worldPosition, camera);

    if (!screenPos.visible) {
      if (this.lastTargetVisible) {
        this.targetLockEl.classList.add('hidden');
        this.lastTargetVisible = false;
      }
      return;
    }

    if (!this.lastTargetVisible) {
      this.targetLockEl.classList.remove('hidden');
      this.lastTargetVisible = true;
    }

    this.targetLockEl.style.transform = `translate3d(${screenPos.x.toFixed(1)}px, ${screenPos.y.toFixed(1)}px, 0)`;

    const hpPct = Math.max(0, Math.round((hb.hp / hb.maxHp) * 100));
    const zoneLabel =
      zone === 'Nape'
        ? 'NAPE'
        : zone
            .replace(/([A-Z])/g, ' $1')
            .trim()
            .toUpperCase();
    const isBroken = hb.disabledTimer > 0 || hb.hp <= 0;
    const labelText = isBroken
      ? `${zoneLabel} · SEVERED`
      : `${zoneLabel} · ${hpPct}%`;

    if (this.lastTargetZoneText !== labelText) {
      this.targetLockZoneEl.textContent = labelText;
      this.lastTargetZoneText = labelText;
    }

    if (this.lastTargetHpPct !== hpPct) {
      this.targetLockHpFillEl.style.width = `${hpPct}%`;
      this.lastTargetHpPct = hpPct;
    }
  }

  public updateCoopMarkers(
    snapshot: NetRoomState | null | undefined,
    localSessionId: string | undefined,
    remotePlayers: RemotePlayerEntity[] | undefined,
    localPlayerPos: THREE.Vector3,
    camera: THREE.PerspectiveCamera
  ): void {
    if (!snapshot || !remotePlayers) {
      this.clearTeammatePool();
      this.clearPingPool();
      return;
    }

    const now = performance.now();

    // 1. Update 3D Teammate Markers
    const activePlayerIds = new Set<string>();
    for (const rp of remotePlayers) {
      const state = rp.latestState;
      if (rp.id === localSessionId || state.lifeState === 'dead') continue;
      activePlayerIds.add(rp.id);

      const headPos = rp.currentPosition
        .clone()
        .add(new THREE.Vector3(0, 2.25, 0));
      const screen = this.projectToScreen(headPos, camera);
      let refs = this.teammatePool.get(rp.id);

      if (!screen.visible) {
        if (refs) refs.root.classList.add('hidden');
        continue;
      }

      if (!refs) {
        refs = this.createTeammateMarkerDom();
        this.teammatePool.set(rp.id, refs);
        this.teammateContainer.appendChild(refs.root);
      }

      refs.root.classList.remove('hidden');
      refs.root.style.transform = `translate3d(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px, 0)`;

      const dist = Math.round(localPlayerPos.distanceTo(rp.currentPosition));
      const isDowned = state.lifeState === 'downed';
      const hpPct = Math.max(0, Math.min(100, Math.round(state.health)));
      const revPct = Math.round((state.reviveProgress || 0) * 100);

      if (refs.lastDowned !== isDowned) {
        refs.root.classList.toggle('is-downed', isDowned);
        refs.reviveTrackEl.classList.toggle('hidden', !isDowned);
        refs.lastDowned = isDowned;
      }

      const tagText = isDowned
        ? `${rp.nickname} · DOWNED (${dist}m)`
        : `${rp.nickname} · ${dist}m`;
      if (refs.lastTagText !== tagText) {
        refs.tagEl.textContent = tagText;
        refs.lastTagText = tagText;
      }

      if (refs.lastHpPct !== hpPct) {
        refs.hpFillEl.style.width = `${hpPct}%`;
        refs.lastHpPct = hpPct;
      }

      if (isDowned && refs.lastRevivePct !== revPct) {
        refs.reviveFillEl.style.width = `${revPct}%`;
        refs.lastRevivePct = revPct;
      }

      const bubble = this.quickChatBubbles.get(rp.id);
      const chatText = bubble && bubble.expiresAt > now ? bubble.text : '';
      if (refs.lastChatText !== chatText) {
        refs.chatEl.textContent = chatText;
        refs.chatEl.classList.toggle('hidden', !chatText);
        refs.lastChatText = chatText;
      }
    }

    for (const [id, refs] of this.teammatePool.entries()) {
      if (!activePlayerIds.has(id)) {
        refs.root.remove();
        this.teammatePool.delete(id);
      }
    }

    // 2. Update 3D Team Pings
    const activePingIds = new Set<string>();
    for (const ping of snapshot.pings) {
      activePingIds.add(ping.id);
      const pos = new THREE.Vector3(...ping.position);
      const screen = this.projectToScreen(pos, camera);
      let pingRefs = this.pingPool.get(ping.id);

      if (!screen.visible) {
        if (pingRefs) pingRefs.root.classList.add('hidden');
        continue;
      }

      if (!pingRefs) {
        pingRefs = this.createPingMarkerDom();
        this.pingPool.set(ping.id, pingRefs);
        this.pingContainer.appendChild(pingRefs.root);
      }

      pingRefs.root.classList.remove('hidden');
      pingRefs.root.style.transform = `translate3d(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px, 0)`;

      const dist = Math.round(localPlayerPos.distanceTo(pos));
      const labelText = `${ping.senderName}: ${ping.message} (${dist}m)`;
      if (pingRefs.lastLabelText !== labelText) {
        pingRefs.labelEl.textContent = labelText;
        pingRefs.lastLabelText = labelText;
      }
      const kind = ping.targetTitanId ? 'danger' : 'point';
      if (pingRefs.lastKind !== kind) {
        pingRefs.root.dataset.pingKind = kind;
        pingRefs.lastKind = kind;
      }
    }

    for (const [id, refs] of this.pingPool.entries()) {
      if (!activePingIds.has(id)) {
        refs.root.remove();
        this.pingPool.delete(id);
      }
    }
  }

  public updateDebugTitanLabels(
    enabled: boolean,
    titans: TitanEntity[],
    camera: THREE.PerspectiveCamera
  ): void {
    if (!enabled) {
      if (this.aiLabelPool.size > 0) {
        for (const el of this.aiLabelPool.values()) el.remove();
        this.aiLabelPool.clear();
      }
      return;
    }

    const activeIds = new Set<string>();
    for (const t of titans) {
      if (t.isDead()) continue;
      activeIds.add(t.id);
      const headPos = t.position
        .clone()
        .add(new THREE.Vector3(0, t.heightMeters + 1.2, 0));
      const screen = this.projectToScreen(headPos, camera);
      let el = this.aiLabelPool.get(t.id);

      if (!screen.visible) {
        if (el) el.classList.add('hidden');
        continue;
      }

      if (!el) {
        el = document.createElement('div');
        el.className = 'titan-ai-label';
        this.aiLabelPool.set(t.id, el);
        this.aiLabelsContainer.appendChild(el);
      }

      el.classList.remove('hidden');
      el.style.transform = `translate3d(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px, 0)`;
      const tName = GAME_CONFIG.titans[t.variant].name;
      const text = `${tName} [${t.aiState.toUpperCase()}] Nape ${Math.ceil(t.hurtboxes.Nape.hp)}`;
      if (el.textContent !== text) {
        el.textContent = text;
      }
    }

    for (const [id, el] of this.aiLabelPool.entries()) {
      if (!activeIds.has(id)) {
        el.remove();
        this.aiLabelPool.delete(id);
      }
    }
  }

  private createTeammateMarkerDom(): TeammateMarkerRefs {
    const root = document.createElement('div');
    root.className = 'teammate-3d-marker';

    const chatEl = document.createElement('div');
    chatEl.className = 'teammate-quickchat-bubble hidden';

    const tagEl = document.createElement('div');
    tagEl.className = 'teammate-name-tag';

    const hpTrack = document.createElement('div');
    hpTrack.className = 'teammate-mini-hp-track';
    const hpFillEl = document.createElement('div');
    hpFillEl.className = 'teammate-mini-hp-fill';
    hpTrack.appendChild(hpFillEl);

    const reviveTrackEl = document.createElement('div');
    reviveTrackEl.className = 'teammate-revive-track hidden';
    const reviveFillEl = document.createElement('div');
    reviveFillEl.className = 'teammate-revive-fill';
    reviveTrackEl.appendChild(reviveFillEl);

    root.append(chatEl, tagEl, hpTrack, reviveTrackEl);
    return {
      root,
      chatEl,
      tagEl,
      hpFillEl,
      reviveFillEl,
      reviveTrackEl,
      lastTagText: '',
      lastChatText: '',
      lastHpPct: -1,
      lastRevivePct: -1,
      lastDowned: false,
    };
  }

  private createPingMarkerDom(): PingMarkerRefs {
    const root = document.createElement('div');
    root.className = 'world-ping-marker';

    const diamond = document.createElement('span');
    diamond.className = 'world-ping-diamond';

    const labelEl = document.createElement('span');
    labelEl.className = 'world-ping-label';

    root.append(diamond, labelEl);
    return {
      root,
      labelEl,
      lastLabelText: '',
      lastKind: '',
    };
  }

  private clearTeammatePool(): void {
    if (this.teammatePool.size === 0) return;
    for (const refs of this.teammatePool.values()) {
      refs.root.remove();
    }
    this.teammatePool.clear();
  }

  private clearPingPool(): void {
    if (this.pingPool.size === 0) return;
    for (const refs of this.pingPool.values()) {
      refs.root.remove();
    }
    this.pingPool.clear();
  }

  private projectToScreen(
    worldPos: THREE.Vector3,
    camera: THREE.PerspectiveCamera
  ): { x: number; y: number; visible: boolean } {
    const v = worldPos.clone().project(camera);
    const visible =
      v.z >= -1 &&
      v.z <= 1 &&
      Math.abs(v.x) <= 1.05 &&
      Math.abs(v.y) <= 1.05;
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    return { x, y, visible };
  }
}
