/** Shared mouse / touch-pad movement intents for the orb (HUD + canvas). */
export const pad = {
  forward: 0,
  right: 0,
  up: 0,
  sprint: false,
};

type PadReleaseFn = () => void;
let padReleaseHandler: PadReleaseFn | null = null;

export function setOnPadRelease(fn: PadReleaseFn | null) {
  padReleaseHandler = fn;
}

export function setPadAxis(axis: "forward" | "right" | "up", value: number) {
  pad[axis] = value;
  if (value === 0) padReleaseHandler?.();
}

export function setPadSprint(on: boolean) {
  pad.sprint = on;
  if (!on) padReleaseHandler?.();
}

export function isPadMoving() {
  return pad.forward !== 0 || pad.right !== 0 || pad.up !== 0 || pad.sprint;
}
