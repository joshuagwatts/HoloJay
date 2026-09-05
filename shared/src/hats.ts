import { shuffleIds } from "./path.ts";

export const DRESSER_HAT_COUNT = 5;

export type HatDef = {
  id: string;
  name: string;
  color: string;
  kind: "top" | "crown" | "beanie" | "cone" | "propeller" | "cowboy" | "wizard" | "bow" | "antenna" | "flower" | "fez" | "halo";
};

export const HATS: HatDef[] = [
  { id: "silk-top", name: "Silk Topper", color: "#1a1a1a", kind: "top" },
  { id: "neon-crown", name: "Neon Crown", color: "#ffd54f", kind: "crown" },
  { id: "cozy-beanie", name: "Cozy Beanie", color: "#ff6bd6", kind: "beanie" },
  { id: "party-cone", name: "Party Cone", color: "#5ce1ff", kind: "cone" },
  { id: "prop-cap", name: "Propeller Cap", color: "#69f0ae", kind: "propeller" },
  { id: "dust-cowboy", name: "Dust Cowboy", color: "#c4a574", kind: "cowboy" },
  { id: "star-wizard", name: "Star Wizard", color: "#b388ff", kind: "wizard" },
  { id: "gift-bow", name: "Gift Bow", color: "#ff8a65", kind: "bow" },
  { id: "signal-antenna", name: "Signal Antenna", color: "#82b1ff", kind: "antenna" },
  { id: "petal-hat", name: "Petal Hat", color: "#ea80fc", kind: "flower" },
  { id: "ruby-fez", name: "Ruby Fez", color: "#e53935", kind: "fez" },
  { id: "soft-halo", name: "Soft Halo", color: "#ffe57f", kind: "halo" },
];

export function hatById(id: string): HatDef | undefined {
  return HATS.find((h) => h.id === id);
}

export function makeDresserHats(seed: number, count = DRESSER_HAT_COUNT): string[] {
  return shuffleIds(
    seed ^ 0x9e3779b9,
    HATS.map((h) => h.id),
  ).slice(0, count);
}
