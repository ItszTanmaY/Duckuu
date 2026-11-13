import { contextBridge, ipcRenderer } from 'electron';

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
  onNotchFocusInput: (callback: () => void) => () => void;
  onToggleDictation: (callback: (data: { active: boolean }) => void) => () => void;
  onWakeAndListen: (callback: () => void) => () => void;
  onClipboardAction: (callback: (data: { text: string }) => void) => () => void;
  notifySpeechState: (speaking: boolean) => void;
  onPetSpeechState: (callback: (data: { speaking: boolean }) => void) => () => void;
  onPetStateChange: (callback: (state: string) => void) => () => void;
}

const duckuuApi: DuckuuApi = {
  setIgnoreMouseEvents: (ignore: boolean) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore);
  },
  toggleChat: () => {
    ipcRenderer.send('toggle-chat');
  },
  showChat: () => {
    ipcRenderer.send('show-chat');
  },
  hideChat: () => {
    ipcRenderer.send('hide-chat');
  },
  movePetWindow: (deltaX: number, deltaY: number) => {
    ipcRenderer.send('move-pet-window', { deltaX, deltaY });
  },
  setPetPosition: (x: number, y: number) => {
    ipcRenderer.send('set-pet-position', { x, y });
  },
  getWorkArea: () => {
    return ipcRenderer.invoke('get-work-area');
  },
  getPetBounds: () => {
    return ipcRenderer.invoke('get-pet-bounds');
  },
  perchActiveWindow: () => {
    ipcRenderer.send('perch-active-window');
  },
  injectTextIntoActiveApp: (text: string) => {
    ipcRenderer.send('inject-text-into-active-app', text);
  },
  getClipboardText: () => {
    return ipcRenderer.invoke('get-clipboard-text');
  },
  getStoredConfig: () => {
    return ipcRenderer.invoke('get-stored-config');
  },
  setStoredConfig: (data: Record<string, any>) => {
    return ipcRenderer.invoke('set-stored-config', data);
  },
  minimizeChat: () => {
    ipcRenderer.send('minimize-chat');
  },
  maximizeChat: () => {
    ipcRenderer.send('maximize-chat');
  },
  closeChat: () => {
    ipcRenderer.send('close-chat');
  },
  isChatMaximized: () => {
    return ipcRenderer.invoke('is-chat-maximized');
  },
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    const handler = (_event: any, isMaximized: boolean) => callback(isMaximized);
    ipcRenderer.on('chat-maximize-change', handler);
    return () => {
      ipcRenderer.removeListener('chat-maximize-change', handler);
    };
  },
  getInteractionMode: () => {
    return ipcRenderer.invoke('get-interaction-mode');
  },
  setInteractionMode: (mode: 'dashboard' | 'stealth') => {
    ipcRenderer.send('set-interaction-mode', mode);
  },
  onInteractionModeChange: (callback: (mode: 'dashboard' | 'stealth') => void) => {
    const handler = (_event: any, mode: 'dashboard' | 'stealth') => callback(mode);
    ipcRenderer.on('interaction-mode-change', handler);
    return () => {
      ipcRenderer.removeListener('interaction-mode-change', handler);
    };
  },
  setNotchIgnoreMouseEvents: (ignore: boolean) => {
    ipcRenderer.send('set-notch-ignore-mouse-events', ignore);
  },
  onNotchActivateVoice: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('notch-activate-voice', handler);
    return () => {
      ipcRenderer.removeListener('notch-activate-voice', handler);
    };
  },
  onNotchFocusInput: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('notch-focus-input', handler);
    return () => {
      ipcRenderer.removeListener('notch-focus-input', handler);
    };
  },
  onToggleDictation: (callback: (data: { active: boolean }) => void) => {
    const handler = (_event: any, data: { active: boolean }) => callback(data);
    ipcRenderer.on('toggle-dictation', handler);
    return () => {
      ipcRenderer.removeListener('toggle-dictation', handler);
    };
  },
  onWakeAndListen: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('wake-and-listen', handler);
    return () => {
      ipcRenderer.removeListener('wake-and-listen', handler);
    };
  },
  onClipboardAction: (callback: (data: { text: string }) => void) => {
    const handler = (_event: any, data: { text: string }) => callback(data);
    ipcRenderer.on('clipboard-quick-action', handler);
    return () => {
      ipcRenderer.removeListener('clipboard-quick-action', handler);
    };
  },
  notifySpeechState: (speaking: boolean) => {
    ipcRenderer.send('pet-speech-state', { speaking });
  },
  onPetSpeechState: (callback: (data: { speaking: boolean }) => void) => {
    const handler = (_event: any, data: { speaking: boolean }) => callback(data);
    ipcRenderer.on('pet-speech-state', handler);
    return () => {
      ipcRenderer.removeListener('pet-speech-state', handler);
    };
  },
  onPetStateChange: (callback: (state: string) => void) => {
    const handler = (_event: any, state: string) => callback(state);
    ipcRenderer.on('pet-state', handler);
    return () => {
      ipcRenderer.removeListener('pet-state', handler);
    };
  }
};

contextBridge.exposeInMainWorld('duckuuApi', duckuuApi);

declare global {
  interface Window {
    duckuuApi: DuckuuApi;
  }
}
