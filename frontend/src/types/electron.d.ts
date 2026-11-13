export interface DuckuuApi {
  setIgnoreMouseEvents: (ignore: boolean) => void;
  toggleChat: () => void;
  showChat: () => void;
  hideChat: () => void;
  movePetWindow: (deltaX: number, deltaY: number) => void;
  setPetPosition: (x: number, y: number) => void;
  getWorkArea: () => Promise<{ x: number; y: number; width: number; height: number }>;
  getPetBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
  perchActiveWindow: () => void;
  injectTextIntoActiveApp: (text: string) => void;
  getClipboardText: () => Promise<string>;
  getStoredConfig: () => Promise<Record<string, any>>;
  setStoredConfig: (data: Record<string, any>) => Promise<boolean>;
  minimizeChat: () => void;
  maximizeChat: () => void;
  closeChat: () => void;
  isChatMaximized: () => Promise<boolean>;
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void;
  getInteractionMode: () => Promise<'dashboard' | 'stealth'>;
  setInteractionMode: (mode: 'dashboard' | 'stealth') => void;
  onInteractionModeChange: (callback: (mode: 'dashboard' | 'stealth') => void) => () => void;
  setNotchIgnoreMouseEvents: (ignore: boolean) => void;
  onNotchActivateVoice: (callback: () => void) => () => void;
  onNotchFocusInput?: (callback: () => void) => () => void;
  onToggleDictation: (callback: (data: { active: boolean }) => void) => () => void;
  onWakeAndListen: (callback: () => void) => () => void;
  onClipboardAction: (callback: (data: { text: string }) => void) => () => void;
  notifySpeechState?: (speaking: boolean) => void;
  onPetSpeechState?: (callback: (data: { speaking: boolean }) => void) => () => void;
}

declare global {
  interface Window {
    duckuuApi?: DuckuuApi;
  }
}
