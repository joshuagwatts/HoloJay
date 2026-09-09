/** Coarse-pointer / touch detection for cross-platform HUD. */

let cached: boolean | null = null;

export function isTouchUi(): boolean {
  if (cached !== null) return cached;
  try {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const noHover = window.matchMedia("(hover: none)").matches;
    const points = typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 0;
    cached = coarse || (noHover && points) || ("ontouchstart" in window && points);
  } catch {
    cached = false;
  }
  return cached;
}

/** Call once so orientation / device changes refresh the cache. */
export function watchTouchUi(onChange?: (touch: boolean) => void): () => void {
  const mq = window.matchMedia("(pointer: coarse)");
  const refresh = () => {
    cached = null;
    const next = isTouchUi();
    onChange?.(next);
  };
  mq.addEventListener?.("change", refresh);
  window.addEventListener("orientationchange", refresh);
  return () => {
    mq.removeEventListener?.("change", refresh);
    window.removeEventListener("orientationchange", refresh);
  };
}
