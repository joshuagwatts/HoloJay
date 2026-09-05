import type { AuthUser } from "@holojay/shared";
import { useGame } from "../state/store.ts";
import { hasMultiplayerHub, loadRuntimeConfig } from "./config.ts";
import {
  localChat,
  localEnter,
  localLeave,
  localLoopComplete,
  localPin,
  localUnpin,
  startLocal,
} from "./localRealm.ts";
import {
  connectRealm,
  disconnectRealm,
  emitChat as remoteChat,
  emitEnter as remoteEnter,
  emitFollow as remoteFollow,
  emitLeave as remoteLeave,
  emitLoopComplete as remoteLoop,
  emitMove as remoteMove,
  emitPin as remotePin,
  emitUnpin as remoteUnpin,
} from "./socket.ts";

export { disconnectRealm, startLocal, loadRuntimeConfig, hasMultiplayerHub };

function localMode(): boolean {
  return useGame.getState().offline || !hasMultiplayerHub();
}

/**
 * Enter the plaza. With no hub URL (GitHub Pages default) this is always solo.
 * With a hub URL we try multiplayer, and only fall back to solo if the socket never welcomes.
 */
export function connectSession(token: string, user: AuthUser): void {
  disconnectRealm();
  useGame.getState().setLocation({ type: "hub" });

  const wantMulti = hasMultiplayerHub() && !token.startsWith("local.");

  if (!wantMulti) {
    startLocal(user);
    return;
  }

  useGame.getState().setOffline(false);
  // Keep hubReady true from a prior solo session so we don't blank the UI while linking
  connectRealm(token);

  window.setTimeout(() => {
    const state = useGame.getState();
    if (state.token !== token) return;
    if (state.connected && state.hubReady && !state.offline) return;
    // Hub never came up — seamless solo, no boot-screen trap
    startLocal(user);
    state.setNotice("Playing solo (hub unreachable)");
    window.setTimeout(() => {
      if (useGame.getState().notice?.startsWith("Playing solo")) {
        useGame.getState().setNotice(null);
      }
    }, 2800);
  }, 3200);
}

export function emitMove(position: { x: number; y: number; z: number }, rotY: number): void {
  if (!localMode()) remoteMove(position, rotY);
}

export function emitChat(text: string): void {
  if (localMode()) localChat(text);
  else remoteChat(text);
}

export function emitPin(gameId: string): void {
  if (localMode()) localPin(gameId);
  else remotePin(gameId);
}

export function emitUnpin(gameId: string): void {
  if (localMode()) localUnpin(gameId);
  else remoteUnpin(gameId);
}

export function emitLoopComplete(): void {
  if (localMode()) localLoopComplete();
  else remoteLoop();
}

export function emitEnter(source: "path" | "favorite", slot: number, gameId: string): void {
  if (localMode()) localEnter(source, slot, gameId);
  else remoteEnter(source, slot, gameId);
}

export function emitLeave(): void {
  if (localMode()) localLeave();
  else remoteLeave();
}

export function emitFollow(instanceId: string): void {
  if (!localMode()) remoteFollow(instanceId);
}
