import { GAMES, gameById } from "./games.ts";
import { shuffleIds } from "./path.ts";
import { MAX_FAVORITES, PORTAL_COUNT, type Favorite, type PortalAssignment } from "./types.ts";

export function makeAssignments(seed: number, favoriteIds: string[]): PortalAssignment[] {
  const pool = GAMES.map((g) => g.id).filter((id) => !favoriteIds.includes(id));
  const count = Math.min(PORTAL_COUNT, pool.length);
  return shuffleIds(seed, pool)
    .slice(0, count)
    .map((gameId, slot) => ({ slot, gameId }));
}

export function compactFavorites(list: Favorite[]): Favorite[] {
  return list
    .slice()
    .filter((f) => Boolean(gameById(f.gameId)))
    .sort((a, b) => a.slot - b.slot)
    .map((fav, slot) => ({ slot, gameId: fav.gameId }));
}

export function canPin(favorites: Favorite[], gameId: string): { ok: boolean; message?: string } {
  if (!gameById(gameId)) return { ok: false, message: "Unknown game" };
  if (favorites.some((f) => f.gameId === gameId)) return { ok: true };
  if (favorites.length >= MAX_FAVORITES) return { ok: false, message: "Favorites plaza is full (6)" };
  return { ok: true };
}
