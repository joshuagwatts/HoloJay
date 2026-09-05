/** Runtime multiplayer hub config (Pages-friendly — edit public/config.json). */

type RuntimeConfig = {
  serverUrl?: string;
};

let serverUrl =
  (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim() ||
  (import.meta.env.DEV ? "http://127.0.0.1:3001" : "");

let loaded = false;

export async function loadRuntimeConfig(): Promise<string> {
  if (loaded) return serverUrl;
  loaded = true;
  try {
    const res = await fetch("./config.json", { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as RuntimeConfig;
      const fromFile = json.serverUrl?.trim();
      if (fromFile) serverUrl = fromFile.replace(/\/$/, "");
    }
  } catch {
    /* solo is fine */
  }
  // Dev keeps the local hub unless config/env overrides
  if (import.meta.env.DEV && !serverUrl) serverUrl = "http://127.0.0.1:3001";
  return serverUrl;
}

export function getServerUrl(): string {
  return serverUrl;
}

/** True when a multiplayer hub URL is configured. */
export function hasMultiplayerHub(): boolean {
  return Boolean(serverUrl);
}

export function apiUrl(path: string): string {
  const base = serverUrl.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  // In Vite dev, prefer same-origin /api so the proxy works even if serverUrl points at :3001
  if (import.meta.env.DEV && (!base || base.includes("127.0.0.1:3001") || base.includes("localhost:3001"))) {
    return p;
  }
  if (!base) return p;
  return `${base}${p}`;
}
