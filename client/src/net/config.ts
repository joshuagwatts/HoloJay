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

/** Read ?hub=https://… and remember it for the next visit. */
function applyQueryHub(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("hub")?.trim();
    if (fromQuery) {
      serverUrl = normalizeHub(fromQuery);
      localStorage.setItem(HUB_STORAGE_KEY, serverUrl);
      // Clean the URL so refreshes stay tidy
      params.delete("hub");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", next);
      return;
    }
    const stored = localStorage.getItem(HUB_STORAGE_KEY)?.trim();
    if (stored) serverUrl = normalizeHub(stored);
  } catch {
    /* ignore */
  }
}

export async function loadRuntimeConfig(): Promise<string> {
  if (loaded) return serverUrl;
  loaded = true;

  applyQueryHub();

  // Query/localStorage win over config.json so a shared link just works
  if (!serverUrl || import.meta.env.DEV) {
    try {
      const res = await fetch("./config.json", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as RuntimeConfig;
        const fromFile = json.serverUrl?.trim();
        if (fromFile && !localStorage.getItem(HUB_STORAGE_KEY)) {
          serverUrl = normalizeHub(fromFile);
        }
      }
    } catch {
      /* solo is fine */
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
  localStorage.removeItem(HUB_STORAGE_KEY);
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
