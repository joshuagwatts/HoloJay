import type { AuthResponse, AuthUser, Favorite } from "@holojay/shared";

const TOKEN_KEY = "holojay.token";
const USERS_KEY = "holojay.users";
const USERNAME_RE = /^[a-zA-Z0-9_]{3,16}$/;

type LocalRecord = {
  id: string;
  username: string;
  color: string;
  passHash: string;
};

export function savedToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function loadUsers(): Record<string, LocalRecord> {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || "{}") as Record<string, LocalRecord>;
  } catch {
    return {};
  }
}

function saveUsers(users: Record<string, LocalRecord>): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function localToken(user: AuthUser): AuthResponse {
  return { token: `local.${user.id}`, user };
}

async function read<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new Error("API unavailable");
  }
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; token?: string; user?: unknown };
  if (!res.ok) throw new Error(data.message || "Request failed");
  return data;
}

async function tryRemote<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await Promise.race([
      fn(),
      new Promise<null>((_, reject) => {
        window.setTimeout(() => reject(new Error("API timeout")), 1800);
      }),
    ]);
  } catch {
    return null;
  }
}

function localGuestUser(username: string, color: string): AuthUser {
  const clean = username.trim();
  return {
    id: crypto.randomUUID(),
    username: USERNAME_RE.test(clean) ? clean : `guest_${Math.floor(1000 + Math.random() * 9000)}`,
    color,
    guest: true,
  };
}

export async function register(username: string, password: string, color: string): Promise<AuthResponse> {
  const remote = await tryRemote(() =>
    fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, color }),
    }).then((res) => read<AuthResponse>(res)),
  );
  if (remote?.token && remote.user) return remote;

  const name = username.trim();
  if (!USERNAME_RE.test(name)) throw new Error("Username must be 3-16 letters, numbers, or _");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  const users = loadUsers();
  if (users[name.toLowerCase()]) throw new Error("That name is already taken");
  const user: AuthUser = { id: crypto.randomUUID(), username: name, color, guest: false };
  users[name.toLowerCase()] = { ...user, passHash: await sha256(password) };
  saveUsers(users);
  return localToken(user);
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const remote = await tryRemote(() =>
    fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).then((res) => read<AuthResponse>(res)),
  );
  if (remote?.token && remote.user) return remote;

  const row = loadUsers()[username.trim().toLowerCase()];
  if (!row || row.passHash !== (await sha256(password))) throw new Error("Wrong username or password");
  return localToken({ id: row.id, username: row.username, color: row.color, guest: false });
}

export async function guest(username: string, color: string): Promise<AuthResponse> {
  const remote = await tryRemote(() =>
    fetch("/api/auth/guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, color }),
    }).then((res) => read<AuthResponse>(res)),
  );
  if (remote?.token && remote.user) return remote;
  return localToken(localGuestUser(username, color));
}

export async function me(token: string): Promise<{ user: AuthUser; favorites: Favorite[] }> {
  if (token.startsWith("local.")) {
    const id = token.slice("local.".length);
    const users = Object.values(loadUsers());
    const row = users.find((u) => u.id === id);
    const stored = localStorage.getItem(TOKEN_KEY);
    if (row) {
      return { user: { id: row.id, username: row.username, color: row.color, guest: false }, favorites: [] };
    }
    const raw = localStorage.getItem("holojay.guest");
    if (raw) {
      const user = JSON.parse(raw) as AuthUser;
      if (user.id === id) return { user, favorites: [] };
    }
    if (stored === token) {
      throw new Error("Local session expired");
    }
    throw new Error("Invalid session");
  }

  return fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  }).then((res) => read<{ user: AuthUser; favorites: Favorite[] }>(res));
}

export function rememberGuest(user: AuthUser): void {
  if (user.guest) localStorage.setItem("holojay.guest", JSON.stringify(user));
  else localStorage.removeItem("holojay.guest");
}
