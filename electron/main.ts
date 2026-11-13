import { app, BrowserWindow, ipcMain, screen, globalShortcut, clipboard, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import http from 'http';

let petWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let notchWindow: BrowserWindow | null = null;
let isDictating = false;
let interactionMode: 'dashboard' | 'stealth' = 'dashboard';
let roamingEngine: ElectronRoamingEngine | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';

function loadWindowContent(win: BrowserWindow, htmlFileName: string): void {
  const distFile = path.join(__dirname, `../dist/${htmlFileName}`);

  win.webContents.on('did-fail-load', (_event, errorCode) => {
    // If connection refused (-102) to Vite dev server, fallback to compiled production dist
    if (errorCode === -102 && fs.existsSync(distFile)) {
      win.loadFile(distFile);
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}/${htmlFileName}`).catch(() => {
      if (fs.existsSync(distFile)) win.loadFile(distFile);
    });
  } else if (fs.existsSync(distFile)) {
    win.loadFile(distFile);
  } else {
    win.loadURL(`${VITE_DEV_SERVER_URL}/${htmlFileName}`).catch(() => {
      if (fs.existsSync(distFile)) win.loadFile(distFile);
    });
  }
}

function createPetWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workArea;

  const win = new BrowserWindow({
    width: 220,
    height: 220,
    x: Math.round(screenWidth - 300),
    y: Math.round(screenHeight - 240),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  loadWindowContent(win, 'pet.html');

  return win;
}

function createChatWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 720,
    show: false,
    frame: false,
    transparent: true,
    backgroundMaterial: 'acrylic', // Windows 11 Acrylic frosted-glass effect
    resizable: true,
    minWidth: 500,
    minHeight: 520,
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  win.on('maximize', () => {
    win.webContents.send('chat-maximize-change', true);
  });

  win.on('unmaximize', () => {
    win.webContents.send('chat-maximize-change', false);
  });

  loadWindowContent(win, 'chat.html');

  return win;
}

function createNotchWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, y: screenY } = primaryDisplay.workArea;
  const notchWidth = 520;
  const notchHeight = 68;

  const win = new BrowserWindow({
    width: notchWidth,
    height: notchHeight,
    x: Math.round((screenWidth - notchWidth) / 2),
    y: Math.max(0, screenY + 8),
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });

  loadWindowContent(win, 'notch.html');

  return win;
}

function anchorChatToPet(): void {
  if (!petWindow || !chatWindow || chatWindow.isMaximized()) return;

  const petBounds = petWindow.getBounds();
  const chatBounds = chatWindow.getBounds();
  const currentDisplay = screen.getDisplayMatching(petBounds);
  const workArea = currentDisplay.workArea;

  const margin = 16;
  let targetX: number;
  let targetY: number;

  if (petBounds.x - chatBounds.width - margin >= workArea.x) {
    targetX = petBounds.x - chatBounds.width - margin;
  } else if (petBounds.x + petBounds.width + margin + chatBounds.width <= workArea.x + workArea.width) {
    targetX = petBounds.x + petBounds.width + margin;
  } else {
    targetX = Math.max(workArea.x + margin, Math.min(workArea.x + workArea.width - chatBounds.width - margin, petBounds.x - Math.round(chatBounds.width / 2)));
  }

  if (petBounds.y + petBounds.height + margin + chatBounds.height <= workArea.y + workArea.height) {
    targetY = petBounds.y;
  } else if (petBounds.y - chatBounds.height + petBounds.height >= workArea.y) {
    targetY = petBounds.y - chatBounds.height + petBounds.height;
  } else {
    targetY = workArea.y + workArea.height - chatBounds.height - margin;
  }

  targetX = Math.max(workArea.x + 8, Math.min(workArea.x + workArea.width - chatBounds.width - 8, targetX));
  targetY = Math.max(workArea.y + 8, Math.min(workArea.y + workArea.height - chatBounds.height - 8, targetY));

  chatWindow.setBounds({
    x: Math.round(targetX),
    y: Math.round(targetY),
    width: chatBounds.width,
    height: chatBounds.height
  });
}

interface ActiveWindowInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  title?: string;
}

class ElectronRoamingEngine {
  private petWindow: BrowserWindow | null = null;
  private walkTimer: NodeJS.Timeout | null = null;
  private roamingInterval: NodeJS.Timeout | null = null;
  private isWalking = false;
  private lastSnappedKey = '';

  constructor(win: BrowserWindow) {
    this.petWindow = win;
  }

  public getActiveWindow(): Promise<ActiveWindowInfo | null> {
    return new Promise((resolve) => {
      // 1. Try local agent backend endpoint first
      const req = http.get('http://127.0.0.1:8000/api/agent/active-window', (res) => {
        let raw = '';
        res.on('data', (c) => raw += c);
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            if (data && data.is_valid && data.width > 120 && data.height > 120) {
              resolve({ x: data.x, y: data.y, width: data.width, height: data.height, title: data.title });
              return;
            }
          } catch {}
          this.fallbackPowershellWindow(resolve);
        });
      });
      req.on('error', () => {
        this.fallbackPowershellWindow(resolve);
      });
      req.setTimeout(450, () => {
        req.destroy();
        this.fallbackPowershellWindow(resolve);
      });
    });
  }

  private fallbackPowershellWindow(resolve: (info: ActiveWindowInfo | null) => void): void {
    const ps = `powershell -NoProfile -Command "Add-Type '@using System; using System.Runtime.InteropServices; public class W { [DllImport(\\\"user32.dll\\\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\\\"user32.dll\\\")] public static extern bool GetWindowRect(IntPtr h, out R r); [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, R, B; } }'; $h = [W]::GetForegroundWindow(); $r = New-Object W+R; if([W]::GetWindowRect($h, [ref]$r)){ Write-Output ($r.L.ToString() + ',' + $r.T.ToString() + ',' + ($r.R - $r.L).ToString() + ',' + ($r.B - $r.T).ToString()) }"`;
    exec(ps, { timeout: 900 }, (err, stdout) => {
      if (!err && stdout.trim()) {
        const parts = stdout.trim().split(',').map(Number);
        if (parts.length === 4 && parts[2] > 120 && parts[3] > 120) {
          resolve({ x: parts[0], y: parts[1], width: parts[2], height: parts[3] });
          return;
        }
      }
      resolve(null);
    });
  }

  public walkTo(targetX: number, targetY: number, onArrived?: () => void): void {
    if (!this.petWindow || this.petWindow.isDestroyed()) return;

    if (this.walkTimer) {
      clearInterval(this.walkTimer);
      this.walkTimer = null;
    }

    const [startX, startY] = this.petWindow.getPosition();
    const dx = targetX - startX;
    const dy = targetY - startY;
    const distance = Math.hypot(dx, dy);

    if (distance < 8) {
      this.petWindow.setPosition(targetX, targetY);
      onArrived?.();
      return;
    }

    this.isWalking = true;
    this.petWindow.webContents.send('pet-state', 'walking');

    const stepSpeed = 3.5;
    const totalTicks = Math.max(1, Math.ceil(distance / stepSpeed));
    let tick = 0;

    this.walkTimer = setInterval(() => {
      if (!this.petWindow || this.petWindow.isDestroyed()) {
        if (this.walkTimer) clearInterval(this.walkTimer);
        return;
      }

      tick++;
      const progress = Math.min(1, tick / totalTicks);
      const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      const curX = Math.round(startX + dx * ease);
      const curY = Math.round(startY + dy * ease);

      this.petWindow.setPosition(curX, curY);

      if (progress >= 1) {
        if (this.walkTimer) clearInterval(this.walkTimer);
        this.walkTimer = null;
        this.isWalking = false;
        onArrived?.();
      }
    }, 28);
  }

  public snapToActiveWindow(): void {
    if (!this.petWindow || this.petWindow.isDestroyed() || this.isWalking) return;

    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea;

    this.getActiveWindow().then((winInfo) => {
      if (!this.petWindow || this.petWindow.isDestroyed()) return;

      if (winInfo) {
        // Perch on top-right of active OS window
        const targetX = Math.max(workArea.x + 10, Math.min(workArea.x + workArea.width - 220, winInfo.x + winInfo.width - 130));
        const targetY = Math.max(workArea.y, Math.min(workArea.y + workArea.height - 220, winInfo.y - 120));

        const windowKey = `${winInfo.x},${winInfo.y},${winInfo.width},${winInfo.height}`;
        if (windowKey !== this.lastSnappedKey) {
          this.lastSnappedKey = windowKey;
          this.walkTo(targetX, targetY, () => {
            this.petWindow?.webContents.send('pet-state', 'sitting');
          });
        }
      } else {
        const defaultX = workArea.x + workArea.width - 260;
        const defaultY = workArea.y + workArea.height - 230;
        this.walkTo(defaultX, defaultY, () => {
          this.petWindow?.webContents.send('pet-state', 'sitting');
        });
      }
    });
  }

  public startRoaming(): void {
    if (this.roamingInterval) return;

    // Immediately snap to active window
    this.snapToActiveWindow();

    // Check periodically to follow active window or roam
    this.roamingInterval = setInterval(() => {
      this.snapToActiveWindow();
    }, 8000);
  }

  public stopRoaming(): void {
    if (this.walkTimer) {
      clearInterval(this.walkTimer);
      this.walkTimer = null;
    }
    if (this.roamingInterval) {
      clearInterval(this.roamingInterval);
      this.roamingInterval = null;
    }
    this.isWalking = false;
    this.lastSnappedKey = '';
    this.petWindow?.webContents.send('pet-state', 'idle');
  }
}

function perchOnActiveWindow(): void {
  roamingEngine?.snapToActiveWindow();
}

// Sovereign State: Persistent Local Configuration Store
const getConfigFilePath = () => path.join(app.getPath('userData'), 'duckuu_config.json');
const getBackendCachePath = () => path.join(__dirname, '../backend/cache/duckuu_state.json');

const readLocalConfig = (): Record<string, any> => {
  try {
    const configPath = getConfigFilePath();
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    const backendPath = getBackendCachePath();
    if (fs.existsSync(backendPath)) {
      return JSON.parse(fs.readFileSync(backendPath, 'utf-8'));
    }
  } catch (err) {
    console.error('Error reading local config store:', err);
  }
  return {};
};

const writeLocalConfig = (data: Record<string, any>): void => {
  try {
    const configPath = getConfigFilePath();
    const existing = readLocalConfig();
    const merged = { ...existing, ...data };
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing local config store:', err);
  }
};

app.whenReady().then(async () => {
  // Read persisted interaction mode (defaults to dashboard)
  const cfg = readLocalConfig();
  interactionMode = (cfg.interaction_mode as 'dashboard' | 'stealth') || 'dashboard';

  // Grant microphone & media permissions across Electron windows for voice dictation
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
      return;
    }
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media';
  });

  petWindow = createPetWindow();
  chatWindow = createChatWindow();
  notchWindow = createNotchWindow();

  roamingEngine = new ElectronRoamingEngine(petWindow);

  chatWindow.on('minimize', () => roamingEngine?.startRoaming());
  chatWindow.on('hide', () => roamingEngine?.startRoaming());
  chatWindow.on('show', () => roamingEngine?.stopRoaming());
  chatWindow.on('restore', () => roamingEngine?.stopRoaming());

  if (!chatWindow.isVisible()) {
    roamingEngine.startRoaming();
  }

  if (interactionMode === 'stealth') {
    notchWindow.showInactive();
  }

  // IPC: Real Pixel Hit-Testing Click-Through toggle
  ipcMain.on('set-ignore-mouse-events', (event, ignore: boolean) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin && senderWin === petWindow) {
      senderWin.setIgnoreMouseEvents(ignore, { forward: true });
    }
  });

  // IPC: Dashboard Window Controls (Minimize / Maximize / Restore / Close)
  ipcMain.on('minimize-chat', () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.minimize();
      roamingEngine?.startRoaming();
    }
  });

  ipcMain.on('maximize-chat', () => {
    if (!chatWindow || chatWindow.isDestroyed()) return;
    if (chatWindow.isMaximized()) {
      chatWindow.unmaximize();
    } else {
      chatWindow.maximize();
    }
  });

  ipcMain.on('close-chat', () => {
    if (chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible()) {
      chatWindow.hide();
      roamingEngine?.startRoaming();
    }
  });

  ipcMain.handle('is-chat-maximized', () => {
    return chatWindow && !chatWindow.isDestroyed() ? chatWindow.isMaximized() : false;
  });

  // IPC: Interaction Mode Management (Dashboard vs Stealth Notch Mode)
  ipcMain.handle('get-interaction-mode', () => {
    return interactionMode;
  });

  ipcMain.on('set-interaction-mode', (_event, mode: 'dashboard' | 'stealth') => {
    interactionMode = mode;
    writeLocalConfig({ interaction_mode: mode });

    if (mode === 'stealth') {
      if (chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible()) {
        chatWindow.hide();
      }
      if (notchWindow && !notchWindow.isDestroyed()) {
        notchWindow.showInactive();
      }
    } else {
      if (notchWindow && !notchWindow.isDestroyed()) {
        notchWindow.hide();
      }
      if (chatWindow && !chatWindow.isDestroyed()) {
        anchorChatToPet();
        chatWindow.show();
        chatWindow.focus();
      }
    }

    [petWindow, chatWindow, notchWindow].forEach((w) => {
      if (w && !w.isDestroyed()) {
        w.webContents.send('interaction-mode-change', mode);
      }
    });
  });

  ipcMain.on('set-notch-ignore-mouse-events', (_event, ignore: boolean) => {
    if (notchWindow && !notchWindow.isDestroyed()) {
      notchWindow.setIgnoreMouseEvents(ignore, { forward: true });
    }
  });

  // IPC: Audio-Synced Speaking State Relay to Pet and Notch
  ipcMain.on('pet-speech-state', (_event, data: { speaking: boolean }) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet-speech-state', data);
    }
    if (notchWindow && !notchWindow.isDestroyed()) {
      notchWindow.webContents.send('pet-speech-state', data);
    }
  });

  // IPC: Toggle Chat Window with dynamic anchoring (or Notch in stealth mode)
  ipcMain.on('toggle-chat', () => {
    if (interactionMode === 'stealth') {
      if (notchWindow && !notchWindow.isDestroyed()) {
        notchWindow.showInactive();
        notchWindow.webContents.send('notch-activate-voice');
      }
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('wake-and-listen');
      }
    } else {
      if (!chatWindow || chatWindow.isDestroyed()) return;
      if (chatWindow.isVisible()) {
        chatWindow.hide();
        roamingEngine?.startRoaming();
      } else {
        roamingEngine?.stopRoaming();
        anchorChatToPet();
        chatWindow.show();
        chatWindow.focus();
      }
    }
  });

  ipcMain.on('show-chat', () => {
    if (!chatWindow || chatWindow.isDestroyed()) return;
    roamingEngine?.stopRoaming();
    anchorChatToPet();
    chatWindow.show();
    chatWindow.focus();
  });

  ipcMain.on('hide-chat', () => {
    if (chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible()) {
      chatWindow.hide();
      roamingEngine?.startRoaming();
    }
  });

  // IPC: Pet Window Dragging & Physics
  ipcMain.on('move-pet-window', (_event, { deltaX, deltaY }: { deltaX: number; deltaY: number }) => {
    if (!petWindow) return;
    const [currX, currY] = petWindow.getPosition();
    petWindow.setPosition(currX + deltaX, currY + deltaY);
    if (chatWindow && chatWindow.isVisible()) {
      anchorChatToPet();
    }
  });

  ipcMain.on('set-pet-position', (_event, { x, y }: { x: number; y: number }) => {
    if (!petWindow) return;
    petWindow.setPosition(Math.round(x), Math.round(y));
    if (chatWindow && chatWindow.isVisible()) {
      anchorChatToPet();
    }
  });

  ipcMain.on('perch-active-window', () => {
    perchOnActiveWindow();
  });

  // IPC: Focused OS Text Injection (Preserves user clipboard, simulates Ctrl+V)
  ipcMain.on('inject-text-into-active-app', (_event, cleanText: string) => {
    try {
      const prevClipboard = clipboard.readText();
      clipboard.writeText(cleanText);

      // Windows PowerShell virtual keystroke simulation
      const psCommand = `powershell -NoProfile -Command "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^v')"`;
      exec(psCommand, () => {
        setTimeout(() => {
          clipboard.writeText(prevClipboard);
        }, 350);
      });
    } catch (err) {
      console.error('Failed to inject text into focused app:', err);
    }
  });

  // IPC: Screen Geometry & Boundaries
  ipcMain.handle('get-work-area', () => {
    const primaryDisplay = screen.getPrimaryDisplay();
    return primaryDisplay.workArea;
  });

  ipcMain.handle('get-pet-bounds', () => {
    if (!petWindow) return null;
    return petWindow.getBounds();
  });

  // Phase 2 & 3: Global Hotkeys Registration (Windows key shortcuts)
  const registerShortcut = (keys: string[], cb: () => void) => {
    for (const k of keys) {
      try {
        globalShortcut.register(k, cb);
      } catch (e) {
        console.warn(`Could not register shortcut ${k}:`, e);
      }
    }
  };

  // 1. Dashboard Shortcut (Windows + `): Toggle main Chat/Dashboard window
  registerShortcut(['Super+`', 'Meta+`'], () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      if (chatWindow.isVisible()) {
        chatWindow.hide();
      } else {
        chatWindow.show();
        chatWindow.focus();
      }
    }
  });

  // 2. Notch Shortcut (Windows + Shift + N): Show & focus the Notch window
  registerShortcut(['Super+Shift+N', 'Meta+Shift+N'], () => {
    if (notchWindow && !notchWindow.isDestroyed()) {
      notchWindow.show();
      notchWindow.focus();
    }
  });

  // 3. Notch Type Shortcut (Windows + Shift + Q): Focus Notch text input for immediate typing
  registerShortcut(['Super+Shift+Q', 'Meta+Shift+Q'], () => {
    if (notchWindow && !notchWindow.isDestroyed()) {
      notchWindow.show();
      notchWindow.focus();
      notchWindow.setIgnoreMouseEvents(false);
      notchWindow.webContents.send('notch-focus-input');
    }
  });

  // 2. Wispr Focused Dictation Hotkey (Alt+Shift+D) - Operates quietly in background
  globalShortcut.register('Alt+Shift+D', () => {
    isDictating = !isDictating;
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('toggle-dictation', { active: isDictating });
    }
    // Do NOT open or focus chat window so the external focused application keeps cursor focus!
  });

  // 3. Smart Clipboard Quick-Action Hotkey (Alt+Shift+C / Ctrl+Shift+C)
  const triggerClipboardAction = () => {
    try {
      const text = clipboard.readText().trim();
      if (text && chatWindow && !chatWindow.isDestroyed()) {
        anchorChatToPet();
        chatWindow.show();
        chatWindow.focus();
        chatWindow.webContents.send('clipboard-quick-action', { text });
      }
    } catch (err) {
      console.error('Failed reading clipboard for quick action:', err);
    }
  };

  try {
    globalShortcut.register('Alt+Shift+C', triggerClipboardAction);
    globalShortcut.register('CommandOrControl+Shift+C', triggerClipboardAction);
  } catch (err) {
    console.error('Failed to register clipboard hotkeys:', err);
  }

  // IPC: Read Clipboard Directly
  ipcMain.handle('get-clipboard-text', () => {
    try {
      return clipboard.readText();
    } catch {
      return '';
    }
  });

  ipcMain.handle('get-stored-config', () => {
    return readLocalConfig();
  });

  ipcMain.handle('set-stored-config', (_event, data: Record<string, any>) => {
    writeLocalConfig(data);
    return true;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      petWindow = createPetWindow();
      chatWindow = createChatWindow();
      notchWindow = createNotchWindow();
      roamingEngine = new ElectronRoamingEngine(petWindow);
      if (interactionMode === 'stealth') {
        notchWindow.showInactive();
      }
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
