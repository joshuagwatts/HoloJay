import {
  canPin,
  compactFavorites,
  gameById,
  makeAssignments,
  type AuthUser,
  type Favorite,
} from "@holojay/shared";
import { useGame } from "../state/store.ts";

const favKey = (id: string) => `holojay.favorites.${id}`;
const seedKey = (id: string) => `holojay.seed.${id}`;

function loadFavorites(userId: string): Favorite[] {
  try {
    const raw = localStorage.getItem(favKey(userId));
    return raw ? (JSON.parse(raw) as Favorite[]) : [];
  } catch {
    return [];
  }
}

function saveFavorites(userId: string, favorites: Favorite[]): void {
  localStorage.setItem(favKey(userId), JSON.stringify(favorites));
}

function loadSeed(userId: string): number {
  const raw = localStorage.getItem(seedKey(userId));
  if (raw) return Number(raw) >>> 0;
  const seed = (Math.random() * 0xffffffff) >>> 0;
  localStorage.setItem(seedKey(userId), String(seed));
  return seed;
}

function saveSeed(userId: string, seed: number): void {
  localStorage.setItem(seedKey(userId), String(seed));
}

export function startLocal(user: AuthUser): void {
  const favorites = loadFavorites(user.id);
  const seed = loadSeed(user.id);
  useGame.getState().setOffline(true);
  useGame.getState().setWelcome({
    self: {
      id: user.id,
      username: user.username,
      color: user.color,
      guest: user.guest,
      position: { x: 0, y: 1.2, z: 0 },
      rotY: 0,
      speaking: false,
      location: { type: "hub" },
    },
    players: [],
    assignments: makeAssignments(
      seed,
      favorites.map((f) => f.gameId),
    ),
    favorites,
  });
}

export function localPin(gameId: string): void {
  const state = useGame.getState();
  if (!gameById(gameId) || !state.selfId) return;
  const check = canPin(state.favorites, gameId);
  if (!check.ok) {
    state.setNotice(check.message ?? "Cannot pin");
    return;
  }
  if (state.favorites.some((f) => f.gameId === gameId)) return;
  const favorites = compactFavorites([...state.favorites, { slot: state.favorites.length, gameId }]);
  saveFavorites(state.selfId, favorites);
  state.setFavorites(favorites);
}

export function localUnpin(gameId: string): void {
  const state = useGame.getState();
  if (!state.selfId) return;
  const favorites = compactFavorites(state.favorites.filter((f) => f.gameId !== gameId));
  saveFavorites(state.selfId, favorites);
  state.setFavorites(favorites);
}

export function localLoopComplete(): void {
  const state = useGame.getState();
  if (!state.selfId) return;
  const seed = (Math.imul(loadSeed(state.selfId), 1664525) + 1013904223) >>> 0;
  saveSeed(state.selfId, seed);
  const assignments = makeAssignments(
    seed,
    state.favorites.map((f) => f.gameId),
  );
  state.setAssignments(assignments);
  state.setNotice("Loop complete — outer doors reshuffled");
  window.setTimeout(() => {
    if (useGame.getState().notice?.startsWith("Loop complete")) useGame.getState().setNotice(null);
  }, 3200);
}

export function localEnter(source: "path" | "favorite", slot: number, gameId: string): void {
  const state = useGame.getState();
  const valid =
    source === "path"
      ? state.assignments.find((a) => a.slot === slot && a.gameId === gameId)
      : state.favorites.find((f) => f.slot === slot && f.gameId === gameId);
  if (!valid || !gameById(gameId)) {
    state.setNotice("That door is closed");
    return;
  }
  state.setLocation({ type: "game", gameId, instanceId: `local:${gameId}` });
  state.setNotice("Hold E at the return door to leave");
}

export function localLeave(): void {
  useGame.getState().setLocation({ type: "hub" });
}

export function localChat(text: string): void {
  const state = useGame.getState();
  if (!state.selfId) return;
  state.setChat(state.selfId, text, Date.now());
}
