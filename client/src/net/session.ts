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
  emitMinigame as remoteMinigame,
  emitMove as remoteMove,
  emitPin as remotePin,
  emitUnpin as remoteUnpin,
  onMinigame as remoteOnMinigame,
} from "./socket.ts";

export { disconnectRealm, startLocal, loadRuntimeConfig, hasMultiplayerHub };

function localMode(): boolean {
  return useGame.getState().offline || !hasMultiplayerHub();
}

export function connectSession(token: string, user: AuthUser): void {
  disconnectRealm();
  useGame.getState().setLocation({ type: "hub" });

  // Default path on Pages: solo, immediate
  if (!hasMultiplayerHub() || token.startsWith("local.")) {
    startLocal(user);
    return;
  }

  useGame.getState().setOffline(false);
  // Open the plaza immediately; socket upgrades to multiplayer if the hub answers
  startLocal(user);
  useGame.getState().setOffline(false);
  connectRealm(token);

  window.setTimeout(() => {
    const state = useGame.getState();
    if (state.token !== token) return;
    if (state.connected && !state.offline) return;
    // Stay in the solo plaza we already opened
    state.setOffline(true);
  }, 4000);
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

export function emitMinigame(instanceId: string, gameId: string, payload: unknown): void {
  if (!localMode()) remoteMinigame(instanceId, gameId, payload);
}

export function onMinigame(
  handler: (msg: { instanceId: string; gameId: string; fromId: string; payload: unknown }) => void,
): () => void {
  if (localMode()) return () => undefined;
  return remoteOnMinigame(handler);
}
