import { DEFAULT_USER_SETTINGS, UserSettings } from '../config/GameConfig';

export interface SaveProgress {
  trainingCompleted: boolean;
  highScore: number;
  bestRank: string;
  totalTitansSlain: number;
  fastestHuntSeconds: number | null;
}

const SETTINGS_KEY = 'titan_hunter_3d_settings_v1';
const PROGRESS_KEY = 'titan_hunter_3d_progress_v1';

const DEFAULT_PROGRESS: SaveProgress = {
  trainingCompleted: false,
  highScore: 0,
  bestRank: '-',
  totalTitansSlain: 0,
  fastestHuntSeconds: null,
};

export class SaveManager {
  private settings: UserSettings;
  private progress: SaveProgress;

  constructor() {
    this.settings = this.loadSettings();
    this.progress = this.loadProgress();
  }

  private loadSettings(): UserSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return structuredClone(DEFAULT_USER_SETTINGS);
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_USER_SETTINGS,
        ...parsed,
        debug: {
          ...DEFAULT_USER_SETTINGS.debug,
          ...(parsed.debug || {}),
        },
      };
    } catch {
      return structuredClone(DEFAULT_USER_SETTINGS);
    }
  }

  private loadProgress(): SaveProgress {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return { ...DEFAULT_PROGRESS };
      return { ...DEFAULT_PROGRESS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_PROGRESS };
    }
  }

  public getSettings(): UserSettings {
    return this.settings;
  }

  public updateSettings(partial: Partial<UserSettings>): UserSettings {
    this.settings = {
      ...this.settings,
      ...partial,
      debug: {
        ...this.settings.debug,
        ...(partial.debug || {}),
      },
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // Ignore quota errors
    }
    return this.settings;
  }

  public getProgress(): SaveProgress {
    return this.progress;
  }

  public recordMissionResult(
    mode: 'training' | 'hunt',
    score: number,
    rank: string,
    kills: number,
    clearSeconds: number
  ): void {
    if (mode === 'training') {
      this.progress.trainingCompleted = true;
    } else {
      if (score > this.progress.highScore) {
        this.progress.highScore = score;
        this.progress.bestRank = rank;
      }
      if (
        this.progress.fastestHuntSeconds === null ||
        clearSeconds < this.progress.fastestHuntSeconds
      ) {
        this.progress.fastestHuntSeconds = Math.round(clearSeconds * 10) / 10;
      }
    }
    this.progress.totalTitansSlain += kills;
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(this.progress));
    } catch {
      // Ignore storage errors
    }
  }
}
