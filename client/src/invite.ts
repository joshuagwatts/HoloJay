import { getServerUrl, hasMultiplayerHub } from "./net/config.ts";

/** Build a link friends can open to join your hub (or solo deep-link a game). */
export function buildInviteUrl(opts?: { enter?: string }): string {
  const url = new URL(window.location.href);
  url.hash = "";
  // Strip transient QA params; keep a clean share target.
  url.search = "";
  const hub = hasMultiplayerHub() ? getServerUrl() : "";
  if (hub) url.searchParams.set("hub", hub);
  if (opts?.enter) url.searchParams.set("enter", opts.enter);
  return url.toString();
}

export async function copyInviteUrl(opts?: { enter?: string }): Promise<string> {
  const link = buildInviteUrl(opts);
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = link;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  return link;
}

export async function shareInvite(opts?: { enter?: string; title?: string }): Promise<"shared" | "copied"> {
  const link = buildInviteUrl(opts);
  const title = opts?.title ?? "Play HoloJay with me";
  const text = "Drop into Portal Realm — glowing orbs, cabinets, boss fights.";
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url: link });
      return "shared";
    } catch (err) {
      // User cancel — don't fall through to copy spam
      if (err instanceof DOMException && err.name === "AbortError") return "copied";
    }
  }
  await copyInviteUrl(opts);
  return "copied";
}
