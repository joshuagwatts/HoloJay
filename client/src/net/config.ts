/** Runtime multiplayer hub config (Pages-friendly). */

type RuntimeConfig = {
  serverUrl?: string;
};

const HUB_STORAGE_KEY = "holojay.hub";

let serverUrl =
  (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim() ||
  (import.meta.env.DEV ? "http://127.0.0.1:3001" : "");

let loaded = false;

function normalizeHub(url: string): string {
  return url.trim().replace(/\/$/, "");
}

async function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

/** Only honor an explicit ?hub= link (session). Stale tunnels in localStorage were hanging boot. */
function applyQueryHub(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("hub")?.trim();
    if (fromQuery) {
      serverUrl = normalizeHub(fromQuery);
      sessionStorage.setItem(HUB_STORAGE_KEY, serverUrl);
      params.delete("hub");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", next);
      return;
    }
    const sessionHub = sessionStorage.getItem(HUB_STORAGE_KEY)?.trim();
    if (sessionHub) serverUrl = normalizeHub(sessionHub);
  } catch {
    /* ignore */
  }
  // Drop any old persistent hub that used to block every refresh
  try {
    localStorage.removeItem(HUB_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function loadRuntimeConfig(): Promise<string> {
  if (loaded) return serverUrl;
  loaded = true;

  applyQueryHub();

  // Only read config.json when we don't already have a hub from ?hub= / env
  if (!serverUrl) {
    try {
      const res = await fetchWithTimeout("./config.json", 1200, { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as RuntimeConfig;
        const fromFile = json.serverUrl?.trim();
        if (fromFile) serverUrl = normalizeHub(fromFile);
      }
    } catch {
      /* solo is fine — never block boot */
    }
  }

  if (import.meta.env.DEV && !serverUrl) serverUrl = "http://127.0.0.1:3001";
  return serverUrl;
}

export function getServerUrl(): string {
  return serverUrl;
}

export function hasMultiplayerHub(): boolean {
  return Boolean(serverUrl);
}

export function clearHubOverride(): void {
  try {
    sessionStorage.removeItem(HUB_STORAGE_KEY);
    localStorage.removeItem(HUB_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (!import.meta.env.DEV) serverUrl = "";
}

export function apiUrl(path: string): string {
  const base = serverUrl.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  if (import.meta.env.DEV && (!base || base.includes("127.0.0.1:3001") || base.includes("localhost:3001"))) {
    return p;
  }
  if (!base) return p;
  return `${base}${p}`;
}
