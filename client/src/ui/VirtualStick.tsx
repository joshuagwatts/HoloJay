import { useRef, type PointerEvent as ReactPointerEvent } from "react";

type Props = {
  className?: string;
  label?: string;
  /** Called with normalized -1..1 stick values while dragging; 0,0 on release. */
  onChange: (x: number, y: number) => void;
  /** Optional deadzone (0..1). */
  deadzone?: number;
};

/**
 * Analog virtual stick for touch / coarse pointer.
 * Pointer-capture so thumbs stay glued while sliding.
 */
export function VirtualStick({ className = "", label, onChange, deadzone = 0.12 }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const active = useRef(false);

  function apply(clientX: number, clientY: number) {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const max = Math.min(rect.width, rect.height) * 0.42;
    let dx = (clientX - cx) / max;
    let dy = (clientY - cy) / max;
    const len = Math.hypot(dx, dy) || 1;
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    if (Math.hypot(dx, dy) < deadzone) {
      onChange(0, 0);
      return;
    }
    onChange(dx, -dy); // screen Y down → stick Y up
  }

  function onDown(e: ReactPointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    active.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    apply(e.clientX, e.clientY);
  }

  function onMove(e: ReactPointerEvent) {
    if (!active.current) return;
    apply(e.clientX, e.clientY);
  }

  function onUp() {
    active.current = false;
    onChange(0, 0);
  }

  return (
    <div
      ref={rootRef}
      className={`vstick ${className}`}
      role="group"
      aria-label={label ?? "Stick"}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={onUp}
    >
      <i className="vstick-knob" aria-hidden />
      {label ? <span className="vstick-label">{label}</span> : null}
    </div>
  );
}
