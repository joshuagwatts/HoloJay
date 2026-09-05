import {
  GAMES,
  canPin,
  compactFavorites,
  gameById,
  hatById,
  makeAssignments,
  makeDresserHats,
  type AuthUser,
  type Favorite,
} from "@holojay/shared";
import { useGame } from "../state/store.ts";
import { loadAllCompetitiveBoards } from "./scores.ts";

const favKey = (id: string) => `holojay.favorites.${id}`;
const seedKey = (id: string) => `holojay.seed.${id}`;
const hatKey = (id: string) => `holojay.hat.${id}`;

function loadFavorites(userId: string): Favorite[] {
  try {
    const raw = localStorage.getItem(favKey(userId));
    const list = raw ? (JSON.parse(raw) as Favorite[]) : [];
    return compactFavorites(list);
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

function loadWornHat(userId: string): string | null {
  const id = localStorage.getItem(hatKey(userId));
  return id && hatById(id) ? id : null;
}

export function saveWornHat(userId: string, hatId: string | null): void {
  if (hatId) localStorage.setItem(hatKey(userId), hatId);
  else localStorage.removeItem(hatKey(userId));
}

export function applyDresserHats(seed: number): void {
  useGame.getState().setDresserHats(makeDresserHats(seed));
}

function hydrateLeaderboards(): void {
  useGame.getState().setLeaderboards(loadAllCompetitiveBoards(GAMES.map((g) => g.id)));
}

export function wearHat(hatId: string | null): void {
  const state = useGame.getState();
  if (!state.selfId) return;
  if (hatId && !hatById(hatId)) return;
  const next = state.wornHatId === hatId ? null : hatId;
  state.setWornHatId(next);
  saveWornHat(state.selfId, next);
  const name = next ? hatById(next)?.name : null;
  state.setNotice(name ? `Wearing ${name}` : "Hat removed");
  window.setTimeout(() => {
    const n = useGame.getState().notice;
    if (n?.startsWith("Wearing") || n === "Hat removed") useGame.getState().setNotice(null);
  }, 1800);
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
  useGame.getState().setWornHatId(loadWornHat(user.id));
  applyDresserHats(seed);
  hydrateLeaderboards();
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
  applyDresserHats(seed);
  state.setNotice("Loop complete — cabinets & hats reshuffled");
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
  if (gameId === "lane-rush") {
    state.setNotice("Lane Rush — Enter to start · E to return");
  } else {
    state.setNotice("Hold E at the return door to leave");
  }
}

export function localLeave(): void {
  useGame.getState().setLocation({ type: "hub" });
}

export function localChat(text: string): void {
  const state = useGame.getState();
  if (!state.selfId) return;
  state.setChat(state.selfId, text, Date.now());
}
