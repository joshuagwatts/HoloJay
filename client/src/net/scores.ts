import type { LeaderboardEntry } from "@holojay/shared";
import { isCompetitive } from "@holojay/shared";

const MAX_ENTRIES = 5;

function key(gameId: string) {
  return `holojay.lb.${gameId}`;
}

export function loadLeaderboard(gameId: string): LeaderboardEntry[] {
  if (!isCompetitive(gameId)) return [];
  try {
    const raw = localStorage.getItem(key(gameId));
    if (!raw) return [];
    const list = JSON.parse(raw) as LeaderboardEntry[];
    return Array.isArray(list) ? list.slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

export function submitScore(gameId: string, username: string, score: number): LeaderboardEntry[] {
  if (!isCompetitive(gameId) || score <= 0) return loadLeaderboard(gameId);
  const next = [...loadLeaderboard(gameId), { username, score: Math.floor(score), at: Date.now() }]
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, MAX_ENTRIES);
  localStorage.setItem(key(gameId), JSON.stringify(next));
  return next;
}

export function loadAllCompetitiveBoards(gameIds: string[]): Record<string, LeaderboardEntry[]> {
  const out: Record<string, LeaderboardEntry[]> = {};
  for (const id of gameIds) {
    if (isCompetitive(id)) out[id] = loadLeaderboard(id);
  }
  return out;
}
