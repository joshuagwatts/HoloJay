import type { GameDef } from "./types.ts";

export const GAMES: GameDef[] = [
  { id: "echo-well", name: "Echo Well", color: "#5ce1ff", tagline: "Bounce sound through crystal halls" },
  { id: "orbit-dash", name: "Orbit Dash", color: "#ff6bd6", tagline: "Race the rings before they collapse" },
  { id: "prism-fold", name: "Prism Fold", color: "#b388ff", tagline: "Fold light until the path appears" },
  { id: "tide-lock", name: "Tide Lock", color: "#64ffda", tagline: "Surf gravity between twin moons" },
  { id: "ember-knot", name: "Ember Knot", color: "#ff8a65", tagline: "Untie a living braid of fire" },
  { id: "void-marbles", name: "Void Marbles", color: "#82b1ff", tagline: "Pot stars into a drifting pocket" },
  { id: "glass-choir", name: "Glass Choir", color: "#ea80fc", tagline: "Conduct a choir of ringing panes" },
  { id: "drift-garden", name: "Drift Garden", color: "#69f0ae", tagline: "Grow flora that only blooms in fall" },
  { id: "signal-spike", name: "Signal Spike", color: "#ffd54f", tagline: "Climb a tower that rewrites itself" },
  { id: "mirror-run", name: "Mirror Run", color: "#80d8ff", tagline: "Outpace your other self" },
  { id: "nebula-pot", name: "Nebula Pot", color: "#ff80ab", tagline: "Cook constellations into a stew" },
  { id: "latch-key", name: "Latch Key", color: "#a7ffeb", tagline: "Pick locks made of memory" },
  { id: "hex-current", name: "Hex Current", color: "#b9f6ca", tagline: "Steer lightning through a honeycomb" },
  { id: "quiet-sun", name: "Quiet Sun", color: "#ffe57f", tagline: "Keep a star from waking" },
  { id: "rift-billiards", name: "Rift Billiards", color: "#8c9eff", tagline: "Bank shots across pocket dimensions" },
  { id: "loom-step", name: "Loom Step", color: "#ff9e80", tagline: "Dance a pattern into existence" },
  { id: "cold-relay", name: "Cold Relay", color: "#84ffff", tagline: "Pass ice between vanishing pads" },
  { id: "halo-split", name: "Halo Split", color: "#f8bbd0", tagline: "Divide a ring without breaking it" },
  { id: "dust-crown", name: "Dust Crown", color: "#d1c4e9", tagline: "Sculpt a kingdom from falling ash" },
  { id: "phase-anchor", name: "Phase Anchor", color: "#80cbc4", tagline: "Pin a glitch in the realm's heart" },
];

export function gameById(id: string): GameDef | undefined {
  return GAMES.find((g) => g.id === id);
}
