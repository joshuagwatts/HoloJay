/** Shared mouse / touch-pad movement intents for the orb (HUD + canvas). */
export const pad = {
  forward: 0,
  right: 0,
  up: 0,
  sprint: false,
};

export function setPadAxis(axis: "forward" | "right" | "up", value: number) {
  pad[axis] = value;
}

export function setPadSprint(on: boolean) {
  pad.sprint = on;
}
