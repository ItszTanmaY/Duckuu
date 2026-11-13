/**
 * Speech synthesis & audio streaming service for Duckuu.
 * Supports sentence-by-sentence low-latency streaming TTS,
 * ElevenLabs studio cloud speech with automatic offline fallback to window.speechSynthesis,
 * and speech state subscriptions for Hands-Free Live Voice conversation.
 */
import { apiFetch } from '@/config/api';

class SpeechService {
  private isSpeaking = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private isMuted = false;
  private queue: string[] = [];
  private isProcessingQueue = false;

  private onSpeechStartListeners = new Set<() => void>();
  private onSpeechEndListeners = new Set<() => void>();

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (muted) {
      this.stop();
    }
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public subscribeSpeechStart(callback: () => void): () => void {
    this.onSpeechStartListeners.add(callback);
    return () => {
      this.onSpeechStartListeners.delete(callback);
    };
  }

  public subscribeSpeechEnd(callback: () => void): () => void {
    this.onSpeechEndListeners.add(callback);
    return () => {
      this.onSpeechEndListeners.delete(callback);
    };
  }

  private notifySpeechStart(): void {
    if (typeof window !== 'undefined') {
      window.duckuuApi?.notifySpeechState?.(true);
    }
    this.onSpeechStartListeners.forEach((cb) => {
      try {
        cb();
      } catch {}
    });
  }

  private notifySpeechEnd(): void {
    if (typeof window !== 'undefined') {
      window.duckuuApi?.notifySpeechState?.(false);
    }
    this.onSpeechEndListeners.forEach((cb) => {
      try {
        cb();
      } catch {}
    });
  }

  public cleanTextForSpeech(markdown: string): string {
    return markdown
      .replace(/```[\s\S]*?```/g, 'Code block omitted.')
      .replace(/`.*?`/g, '')
      .replace(/[*#_~>]/g, '')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/🦆/g, '')
      .replace(/\n+/g, '. ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Queues an incoming sentence as it arrives during streaming LLM output.
   */
  public queueSentence(rawSentence: string): void {
    if (this.isMuted) return;
    const clean = this.cleanTextForSpeech(rawSentence);
    if (!clean || clean.length < 3) return;

    this.queue.push(clean);
    if (!this.isProcessingQueue) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.queue.length > 0) {
      if (this.isMuted) {
        this.queue = [];
        break;
      }

      const nextSentence = this.queue.shift();
      if (!nextSentence) continue;

      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.notifySpeechStart();
      }

      await this.speakSingle(nextSentence);
    }

    this.isProcessingQueue = false;
    if (this.isSpeaking) {
      this.isSpeaking = false;
      this.notifySpeechEnd();
    }
    if (typeof window !== 'undefined') {
      window.duckuuApi?.notifySpeechState?.(false);
    }
  }

  private speakSingle(text: string): Promise<void> {
    return new Promise((resolve) => {
      // Step 1: Try ElevenLabs studio audio API first if configured
      apiFetch('/api/v1/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      })
        .then(async (res) => {
          if (res.ok) {
            const blob = await res.blob();
            if (blob.size > 500) {
              const url = URL.createObjectURL(blob);
              const audio = new Audio(url);
              this.currentAudio = audio;

              audio.onplay = () => {
                this.isSpeaking = true;
                this.notifySpeechStart();
                if (typeof window !== 'undefined') {
                  window.duckuuApi?.notifySpeechState?.(true);
                }
              };

              audio.onended = () => {
                URL.revokeObjectURL(url);
                this.currentAudio = null;
                if (typeof window !== 'undefined') {
                  window.duckuuApi?.notifySpeechState?.(false);
                }
                resolve();
              };

              audio.onpause = () => {
                if (typeof window !== 'undefined') {
                  window.duckuuApi?.notifySpeechState?.(false);
                }
              };

              audio.onerror = () => {
                URL.revokeObjectURL(url);
                this.currentAudio = null;
                if (typeof window !== 'undefined') {
                  window.duckuuApi?.notifySpeechState?.(false);
                }
                this.speakViaSpeechSynthesis(text, resolve);
              };

              try {
                await audio.play();
                return;
              } catch {
                if (typeof window !== 'undefined') {
                  window.duckuuApi?.notifySpeechState?.(false);
                }
              }
            }
          }
          this.speakViaSpeechSynthesis(text, resolve);
        })
        .catch(() => {
          this.speakViaSpeechSynthesis(text, resolve);
        });
    });
  }

  private speakViaSpeechSynthesis(text: string, onDone: () => void): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      onDone();
      return;
    }

    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.08;
      utterance.volume = 0.9;

      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find(
        (v) =>
          v.lang.startsWith('en') &&
          (v.name.includes('Natural') ||
            v.name.includes('Zira') ||
            v.name.includes('David') ||
            v.name.includes('Google') ||
            v.name.includes('George'))
      );
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      utterance.onstart = () => {
        this.isSpeaking = true;
        this.notifySpeechStart();
        if (typeof window !== 'undefined') {
          window.duckuuApi?.notifySpeechState?.(true);
        }
      };

      utterance.onend = () => {
        this.currentUtterance = null;
        if (typeof window !== 'undefined') {
          window.duckuuApi?.notifySpeechState?.(false);
        }
        onDone();
      };

      utterance.onerror = () => {
        this.currentUtterance = null;
        if (typeof window !== 'undefined') {
          window.duckuuApi?.notifySpeechState?.(false);
        }
        onDone();
      };

      this.currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    } catch {
      onDone();
    }
  }

  /**
   * Speak full text directly (e.g. from manual Listen button on a message bubble).
   */
  public speak(text: string, onEnd?: () => void): void {
    this.stop();
    const clean = this.cleanTextForSpeech(text);
    if (!clean) return;

    if (onEnd) {
      const unsub = this.subscribeSpeechEnd(() => {
        unsub();
        onEnd();
      });
    }

    // Split into sentences and stream through queue
    const sentences = clean.match(/[^.!?\n]+[.!?\n]+/g) || [clean];
    for (const s of sentences) {
      this.queue.push(s.trim());
    }
    this.processQueue();
  }

  public stop(): void {
    this.queue = [];
    this.isProcessingQueue = false;

    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio = null;
      } catch {}
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    this.currentUtterance = null;

    if (this.isSpeaking) {
      this.isSpeaking = false;
      this.notifySpeechEnd();
    }
    if (typeof window !== 'undefined') {
      window.duckuuApi?.notifySpeechState?.(false);
    }
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  public getCurrentUtterance(): SpeechSynthesisUtterance | null {
    return this.currentUtterance;
  }
}

export const speechService = new SpeechService();
