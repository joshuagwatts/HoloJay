import { shuffleIds } from "./path.ts";

export const DRESSER_HAT_COUNT = 5;

export type HatKind =
  | "top"
  | "crown"
  | "beanie"
  | "cone"
  | "propeller"
  | "cowboy"
  | "wizard"
  | "bow"
  | "antenna"
  | "flower"
  | "fez"
  | "halo"
  | "mushroom"
  | "cat"
  | "unicorn"
  | "chef"
  | "jester"
  | "ufo"
  | "duck"
  | "headphones"
  | "devil"
  | "bucket"
  | "pirate";

export type HatDef = {
  id: string;
  name: string;
  color: string;
  kind: HatKind;
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
  { id: "toad-cap", name: "Toad Cap", color: "#ff5252", kind: "mushroom" },
  { id: "kitty-ears", name: "Kitty Ears", color: "#ffab91", kind: "cat" },
  { id: "spark-horn", name: "Spark Horn", color: "#e1bee7", kind: "unicorn" },
  { id: "souffle-chef", name: "Soufflé Chef", color: "#fafafa", kind: "chef" },
  { id: "chaos-jester", name: "Chaos Jester", color: "#7c4dff", kind: "jester" },
  { id: "orbit-saucer", name: "Orbit Saucer", color: "#80d8ff", kind: "ufo" },
  { id: "bath-duck", name: "Bath Duck", color: "#ffee58", kind: "duck" },
  { id: "beat-cans", name: "Beat Cans", color: "#212121", kind: "headphones" },
  { id: "ember-horns", name: "Ember Horns", color: "#ff1744", kind: "devil" },
  { id: "tide-bucket", name: "Tide Bucket", color: "#26a69a", kind: "bucket" },
  { id: "raid-tricorne", name: "Raid Tricorne", color: "#4e342e", kind: "pirate" },
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
