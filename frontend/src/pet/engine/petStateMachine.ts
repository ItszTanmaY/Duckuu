import { PetEmotion } from '@/types/api';

export type StateListener = (state: PetEmotion, previousState: PetEmotion) => void;

export class PetStateMachine {
  private currentEmotion: PetEmotion = 'idle';
  private previousEmotion: PetEmotion = 'idle';
  private listeners: Set<StateListener> = new Set();
  private stateTimer: number | null = null;
  private idleTimeSec = 0;
  private idleCheckInterval: number | null = null;

  // Rapid click tracking for scolding
  private clickTimestamps: number[] = [];
  private readonly RAPID_CLICK_THRESHOLD = 4;
  private readonly RAPID_CLICK_WINDOW_MS = 900;

  constructor() {
    this.startIdleMonitor();
  }

  public getState(): PetEmotion {
    return this.currentEmotion;
  }

  public getPreviousState(): PetEmotion {
    return this.previousEmotion;
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setState(newEmotion: PetEmotion, durationMs?: number): void {
    if (this.currentEmotion === newEmotion) return;

    const prev = this.currentEmotion;
    this.previousEmotion = prev;
    this.currentEmotion = newEmotion;
    this.idleTimeSec = 0;

    if (this.stateTimer !== null) {
      window.clearTimeout(this.stateTimer);
      this.stateTimer = null;
    }

    this.notify(newEmotion, prev);

    // Auto-revert transient states back to idle or roaming
    if (durationMs && durationMs > 0) {
      this.stateTimer = window.setTimeout(() => {
        this.revertToDefault();
      }, durationMs);
    } else {
      const defaultDurations: Partial<Record<PetEmotion, number>> = {
        happy: 2400,
        annoyed: 3200,
        done: 2200,
        waking: 1800,
        confused: 2800,
        sad: 3000,
        surprised: 2000
      };
      const autoDuration = defaultDurations[newEmotion];
      if (autoDuration) {
        this.stateTimer = window.setTimeout(() => {
          this.revertToDefault();
        }, autoDuration);
      }
    }
  }

  private revertToDefault(): void {
    this.setState('idle');
  }

  private notify(current: PetEmotion, previous: PetEmotion): void {
    for (const listener of this.listeners) {
      try {
        listener(current, previous);
      } catch (err) {
        console.error('Error in PetStateMachine listener:', err);
      }
    }
  }

  private startIdleMonitor(): void {
    if (typeof window === 'undefined') return;
    this.idleCheckInterval = window.setInterval(() => {
      if (this.currentEmotion === 'idle' || this.currentEmotion === 'roaming') {
        this.idleTimeSec += 1;
        // After 45s of no interaction, Duckuu falls asleep
        if (this.idleTimeSec >= 45) {
          this.setState('sleeping');
        }
      }
    }, 1000);
  }

  // Handle interaction events
  public registerClick(): { isScolded: boolean } {
    const now = Date.now();
    this.idleTimeSec = 0;

    // Wake up if sleeping
    if (this.currentEmotion === 'sleeping') {
      this.setState('waking');
      return { isScolded: false };
    }

    // Rapid-click scolding detection
    this.clickTimestamps = this.clickTimestamps.filter(t => now - t < this.RAPID_CLICK_WINDOW_MS);
    this.clickTimestamps.push(now);

    if (this.clickTimestamps.length >= this.RAPID_CLICK_THRESHOLD) {
      this.clickTimestamps = [];
      this.setState('annoyed');
      return { isScolded: true };
    }

    // Normal happy click
    this.setState('happy');
    return { isScolded: false };
  }

  public registerPetting(): void {
    this.idleTimeSec = 0;
    if (this.currentEmotion === 'sleeping') {
      this.setState('waking');
      return;
    }
    this.setState('happy', 2600);
  }

  public registerDragStart(): void {
    this.idleTimeSec = 0;
    if (this.currentEmotion === 'sleeping') {
      this.setState('waking');
    }
  }

  public destroy(): void {
    if (this.stateTimer !== null) {
      window.clearTimeout(this.stateTimer);
    }
    if (this.idleCheckInterval !== null) {
      window.clearInterval(this.idleCheckInterval);
    }
    this.listeners.clear();
  }
}
