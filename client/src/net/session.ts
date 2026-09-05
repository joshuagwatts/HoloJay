import type { AuthUser } from "@holojay/shared";
import { useGame } from "../state/store.ts";
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

export { disconnectRealm, startLocal };

function localMode(): boolean {
  return useGame.getState().offline;
}

export function connectSession(token: string, user: AuthUser): void {
  disconnectRealm();
  if (token.startsWith("local.")) {
    startLocal(user);
    return;
  }
  useGame.getState().setOffline(false);
  connectRealm(token);
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
