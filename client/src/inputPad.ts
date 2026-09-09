/** Shared mouse / touch-pad intents for hub orb + vehicle minigames. */
export const pad = {
  forward: 0,
  right: 0,
  up: 0,
  sprint: false,
};

/** Analog look deltas for hub camera (consumed each frame). */
export const lookPad = {
  x: 0,
  y: 0,
  /** Held stick rates (-1..1) applied every frame while active. */
  stickX: 0,
  stickY: 0,
};

/** Drive / fire / look for escort-style games (Boss Wave, Sky Escort). */
export const vehiclePad = {
  throttle: 0,
  steer: 0,
  fire: false,
  lookX: 0,
  lookY: 0,
  stickX: 0,
  stickY: 0,
  boost: false,
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

export function addLookPad(dx: number, dy: number) {
  lookPad.x += dx;
  lookPad.y += dy;
}

export function setLookStick(x: number, y: number) {
  lookPad.stickX = Math.max(-1, Math.min(1, x));
  lookPad.stickY = Math.max(-1, Math.min(1, y));
}

export function consumeLookPad(): { x: number; y: number } {
  const out = { x: lookPad.x, y: lookPad.y };
  lookPad.x = 0;
  lookPad.y = 0;
  return out;
}

export function setVehicleThrottle(v: number) {
  vehiclePad.throttle = Math.max(-1, Math.min(1, v));
}

export function setVehicleSteer(v: number) {
  vehiclePad.steer = Math.max(-1, Math.min(1, v));
}

export function setVehicleFire(on: boolean) {
  vehiclePad.fire = on;
}

export function setVehicleBoost(on: boolean) {
  vehiclePad.boost = on;
}

export function addVehicleLook(dx: number, dy: number) {
  vehiclePad.lookX += dx;
  vehiclePad.lookY += dy;
}

export function setVehicleLookStick(x: number, y: number) {
  vehiclePad.stickX = Math.max(-1, Math.min(1, x));
  vehiclePad.stickY = Math.max(-1, Math.min(1, y));
}

export function consumeVehicleLook(): { x: number; y: number } {
  const out = { x: vehiclePad.lookX, y: vehiclePad.lookY };
  vehiclePad.lookX = 0;
  vehiclePad.lookY = 0;
  return out;
}

export function resetVehiclePad() {
  vehiclePad.throttle = 0;
  vehiclePad.steer = 0;
  vehiclePad.fire = false;
  vehiclePad.lookX = 0;
  vehiclePad.lookY = 0;
  vehiclePad.stickX = 0;
  vehiclePad.stickY = 0;
  vehiclePad.boost = false;
}
