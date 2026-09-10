import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  setLookStick,
  setPadAxis,
  setPadSprint,
  setVehicleBoost,
  setVehicleFire,
  setVehicleLookStick,
  setVehicleSteer,
  setVehicleThrottle,
} from "../inputPad.ts";
import { isTouchUi, watchTouchUi } from "../touchUi.ts";
import { VirtualStick } from "./VirtualStick.tsx";

type Mode = "hub" | "vehicle-driver" | "vehicle-gunner" | "lanes";

type Props = {
  mode: Mode;
  onLane?: (dir: -1 | 1) => void;
  onJump?: () => void;
  onLock?: () => void;
  onSeat?: () => void;
};

function holdBtn(on: () => void, off: () => void) {
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      on();
    },
    onPointerUp: () => off(),
    onPointerCancel: () => off(),
    onLostPointerCapture: () => off(),
  };
}

/**
 * Cross-platform touch chrome — hub look/move, vehicle drive/gun, lane buttons.
 * Hidden automatically on fine-pointer desktops.
 */
export function GameTouchControls({ mode, onLane, onJump, onLock, onSeat }: Props) {
  const [touch, setTouch] = useState(() => (typeof window !== "undefined" ? isTouchUi() : false));
  useEffect(() => watchTouchUi(setTouch), []);
  if (!touch) return null;

  if (mode === "hub") {
    return (
      <div className="touch-layer hub-touch" aria-label="Touch controls">
        <VirtualStick className="touch-look" label="Look" onChange={(x, y) => setLookStick(x, y)} />
        <VirtualStick
          className="touch-move"
          label="Move"
          onChange={(x, y) => {
            setPadAxis("right", x);
            setPadAxis("forward", y);
          }}
        />
        <button type="button" className="touch-action boost" {...holdBtn(() => setPadSprint(true), () => setPadSprint(false))}>
          Boost
        </button>
        <button type="button" className="touch-action up" {...holdBtn(() => setPadAxis("up", 1), () => setPadAxis("up", 0))}>
          Up
        </button>
        <button type="button" className="touch-action dn" {...holdBtn(() => setPadAxis("up", -1), () => setPadAxis("up", 0))}>
          Dn
        </button>
      </div>
    );
  }

  if (mode === "vehicle-driver") {
    return (
      <div className="touch-layer vehicle-touch" aria-label="Drive controls">
        <VirtualStick
          className="touch-move"
          label="Drive"
          onChange={(x, y) => {
            setVehicleSteer(-x);
            setVehicleThrottle(y);
          }}
        />
        <button
          type="button"
          className="touch-action boost"
          {...holdBtn(() => setVehicleBoost(true), () => setVehicleBoost(false))}
        >
          Boost
        </button>
        {onSeat ? (
          <button type="button" className="touch-action seat" onClick={onSeat}>
            Seat
          </button>
        ) : null}
      </div>
    );
  }

  if (mode === "vehicle-gunner") {
    return (
      <div className="touch-layer vehicle-touch" aria-label="Gunner controls">
        <VirtualStick className="touch-look" label="Aim" onChange={(x, y) => setVehicleLookStick(x, y)} />
        <button type="button" className="touch-action fire" {...holdBtn(() => setVehicleFire(true), () => setVehicleFire(false))}>
          Fire
        </button>
        {onLock ? (
          <button type="button" className="touch-action lock" onClick={onLock}>
            Lock
          </button>
        ) : null}
        {onSeat ? (
          <button type="button" className="touch-action seat" onClick={onSeat}>
            Seat
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="touch-layer lane-touch" aria-label="Lane controls">
      <button type="button" className="touch-action lane-left" onClick={() => onLane?.(-1)}>
        ◀
      </button>
      <button type="button" className="touch-action lane-jump" onClick={() => onJump?.()}>
        Jump
      </button>
      <button type="button" className="touch-action lane-right" onClick={() => onLane?.(1)}>
        ▶
      </button>
    </div>
  );
}
