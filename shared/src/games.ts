import type { GameDef } from "./types.ts";

/** Only ship games that actually have playable rooms. */
export const GAMES: GameDef[] = [
  {
    id: "magic-room",
    name: "The Magic Room",
    color: "#c6ff00",
    tagline: "Dive into a living shader sea",
    mode: "fun",
  },
  {
    id: "lane-rush",
    name: "Lane Rush",
    color: "#ff6bd6",
    tagline: "Dodge forever — high score wins",
    mode: "competitive",
  },
  {
    id: "sky-escort",
    name: "Sky Escort",
    color: "#ff7043",
    tagline: "Last road out — cover the run",
    mode: "fun",
  },
];

export function gameById(id: string): GameDef | undefined {
  return GAMES.find((g) => g.id === id);
}

export function isCompetitive(gameId: string): boolean {
  return gameById(gameId)?.mode === "competitive";
}
