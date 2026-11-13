/**
 * Centralized Duckuu API and WebSocket configuration.
 * Primary port is 8000 (standard FastAPI/uvicorn).
 * Automatically detects and falls back to 8765 if 8000 is unreachable.
 */

let activeApiPort = 8000;
let portDetectionPromise: Promise<number> | null = null;

export function getActivePort(): number {
  return activeApiPort;
}

export function setActivePort(port: number): void {
  activeApiPort = port;
}

export function getApiBaseUrl(): string {
  return `http://127.0.0.1:${activeApiPort}`;
}

export function getWsUrl(): string {
  return `ws://127.0.0.1:${activeApiPort}/ws`;
}

export function apiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBaseUrl()}${cleanPath}`;
}

/**
 * Proactively tests port 8000 then 8765 on startup and caches the active port.
 */
export async function detectApiPort(): Promise<number> {
  if (portDetectionPromise) return portDetectionPromise;

  portDetectionPromise = (async () => {
    try {
      const res8000 = await fetch('http://127.0.0.1:8000/health', { method: 'GET', signal: AbortSignal.timeout(1500) });
      if (res8000.ok) {
        activeApiPort = 8000;
        return 8000;
      }
    } catch {
      // Port 8000 not reachable, try 8765
    }

    try {
      const res8765 = await fetch('http://127.0.0.1:8765/health', { method: 'GET', signal: AbortSignal.timeout(1500) });
      if (res8765.ok) {
        activeApiPort = 8765;
        return 8765;
      }
    } catch {
      // Default to 8000
    }

    activeApiPort = 8000;
    return 8000;
  })();

  return portDetectionPromise;
}

// Auto-run detection on load
detectApiPort().catch(() => {});

export async function apiFetch(path: string, init?: RequestInit, retries = 2): Promise<Response> {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const primaryUrl = `http://127.0.0.1:${activeApiPort}${cleanPath}`;

  try {
    const res = await fetch(primaryUrl, init);
    return res;
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 350));
      return apiFetch(path, init, retries - 1);
    }
    // If primary port (e.g. 8000) fails, try fallback port (8765)
    const fallbackPort = activeApiPort === 8000 ? 8765 : 8000;
    const fallbackUrl = `http://127.0.0.1:${fallbackPort}${cleanPath}`;
    try {
      const fallbackRes = await fetch(fallbackUrl, init);
      activeApiPort = fallbackPort;
      return fallbackRes;
    } catch {
      throw err;
    }
  }
}
