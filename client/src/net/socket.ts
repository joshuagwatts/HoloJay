import { io, type Socket } from "socket.io-client";
import { GAMES, compactFavorites, hatById, makeDresserHats, type PlayerPublic } from "@holojay/shared";
import { useGame } from "../state/store.ts";
import { voice } from "../voice/proximity.ts";
import { loadAllCompetitiveBoards } from "./scores.ts";
import { getServerUrl } from "./config.ts";

const hatKey = (id: string) => `holojay.hat.${id}`;

function hydrateHats(userId: string, seed: number) {
  const worn = localStorage.getItem(hatKey(userId));
  useGame.getState().setWornHatId(worn && hatById(worn) ? worn : null);
  useGame.getState().setDresserHats(makeDresserHats(seed));
  useGame.getState().setLeaderboards(loadAllCompetitiveBoards(GAMES.map((g) => g.id)));
}

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function connectRealm(token: string): Socket {
  disconnectRealm();
  const url = getServerUrl();
  const sock = io(url || undefined, { auth: { token }, transports: ["websocket", "polling"] });
  socket = sock;

  voice.sendSignal = (toId, data) => sock.emit("voice:signal", { toId, data });
  voice.onSpeaking = (active) => sock.emit("speaking", { active });

  sock.on("connect", () => useGame.getState().setConnected(true));
  sock.on("disconnect", () => useGame.getState().setConnected(false));
  sock.on("connect_error", (err) => useGame.getState().setNotice(err.message));

  sock.on("welcome", (payload) => {
    useGame.getState().setWelcome({
      ...payload,
      favorites: compactFavorites(payload.favorites),
    });
    hydrateHats(payload.self.id, Date.now() >>> 0);
    voice.setSelf(payload.self.id);
    for (const player of payload.players as PlayerPublic[]) {
      void voice.ensurePeer(player.id);
    }
  });

  sock.on("playerJoined", (player: PlayerPublic) => {
    useGame.getState().upsertPlayer(player);
    void voice.ensurePeer(player.id);
  });

  sock.on("playerLeft", ({ id }: { id: string }) => {
    useGame.getState().removePlayer(id);
    voice.removePeer(id);
  });

  sock.on("playerMoved", (payload) => {
    useGame.getState().movePlayer(payload.id, payload.position, payload.rotY, payload.location);
  });

  sock.on("playerSpeaking", ({ id, active }: { id: string; active: boolean }) => {
    useGame.getState().setSpeaking(id, active);
  });

  sock.on("playerChat", ({ fromId, text, at }: { fromId: string; text: string; at: number }) => {
    useGame.getState().setChat(fromId, text, at);
  });

  sock.on("assignments", ({ assignments }) => {
    useGame.getState().setAssignments(assignments);
    useGame.getState().setDresserHats(makeDresserHats((Date.now() ^ (Math.random() * 0xffff)) >>> 0));
    useGame.getState().setNotice("Loop complete — cabinets & hats reshuffled");
    window.setTimeout(() => {
      if (useGame.getState().notice?.startsWith("Loop complete")) {
        useGame.getState().setNotice(null);
      }
    }, 3200);
  });

  sock.on("favoritesUpdated", ({ favorites }) => {
    useGame.getState().setFavorites(favorites);
  });

  sock.on("followInvite", (invite) => {
    if (useGame.getState().location.type !== "hub") return;
    useGame.getState().setFollowInvite(invite);
    window.setTimeout(() => {
      const current = useGame.getState().followInvite;
      if (current?.instanceId === invite.instanceId) useGame.getState().setFollowInvite(null);
    }, 14000);
  });

  sock.on("entered", ({ location }) => {
    useGame.getState().setLocation(location);
    if (location.type === "game") {
      useGame.getState().setNotice("Hold E at the return door to leave");
    }
  });

  sock.on("error", ({ message }: { message: string }) => {
    useGame.getState().setNotice(message);
    window.setTimeout(() => {
      if (useGame.getState().notice === message) useGame.getState().setNotice(null);
    }, 2800);
  });

  sock.on("voice:signal", ({ fromId, data }: { fromId: string; data: unknown }) => {
    void voice.handleSignal(fromId, data);
  });

  return sock;
}

export function disconnectRealm(): void {
  voice.reset();
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}

export function emitMove(position: { x: number; y: number; z: number }, rotY: number): void {
  socket?.emit("move", { position, rotY });
}

export function emitChat(text: string): void {
  socket?.emit("chat", { text });
}

export function emitPin(gameId: string): void {
  socket?.emit("pin", { gameId });
}

export function emitUnpin(gameId: string): void {
  socket?.emit("unpin", { gameId });
}

export function emitLoopComplete(): void {
  socket?.emit("loopComplete");
}

export function emitEnter(source: "path" | "favorite", slot: number, gameId: string): void {
  socket?.emit("enterPortal", { source, slot, gameId });
}

export function emitLeave(): void {
  socket?.emit("leavePortal");
}

export function emitFollow(instanceId: string): void {
  socket?.emit("follow", { instanceId });
}
