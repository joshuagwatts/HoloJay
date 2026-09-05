import type { Server, Socket } from "socket.io";
import {
  dist3,
  gameById,
  MAX_FAVORITES,
  PORTAL_INTERACT_RANGE,
  PROXIMITY_RANGE,
  portalSlotPose,
  favoriteSlotPose,
  makeAssignments,
  type AuthUser,
  type Favorite,
  type PlayerLocation,
  type PlayerPublic,
  type PortalAssignment,
  type Vec3,
} from "@holojay/shared";
import { listFavorites, replaceFavorites } from "./db.ts";
import { verifyToken } from "./auth.ts";

type Session = {
  socket: Socket;
  user: AuthUser;
  position: Vec3;
  rotY: number;
  speaking: boolean;
  location: PlayerLocation;
  assignments: PortalAssignment[];
  favorites: Favorite[];
  shuffleSeed: number;
};

const sessions = new Map<string, Session>();
const byUserId = new Map<string, string>();

function publicPlayer(s: Session): PlayerPublic {
  return {
    id: s.user.id,
    username: s.user.username,
    color: s.user.color,
    guest: s.user.guest,
    position: s.position,
    rotY: s.rotY,
    speaking: s.speaking,
    location: s.location,
  };
}

function samePlace(a: PlayerLocation, b: PlayerLocation): boolean {
  if (a.type === "hub" && b.type === "hub") return true;
  return a.type === "game" && b.type === "game" && a.instanceId === b.instanceId;
}

function othersInPlace(session: Session): Session[] {
  return [...sessions.values()].filter(
    (s) => s.user.id !== session.user.id && samePlace(s.location, session.location),
  );
}

function emitToPlace(session: Session, event: string, payload: unknown): void {
  for (const other of othersInPlace(session)) {
    other.socket.emit(event, payload);
  }
}

function loadFavorites(user: AuthUser): Favorite[] {
  if (user.guest) return [];
  return listFavorites(user.id).map((row) => ({ slot: row.slot, gameId: row.game_id }));
}

function persistFavorites(session: Session): void {
  if (session.user.guest) return;
  replaceFavorites(session.user.id, session.favorites);
}

function portalPosition(source: "path" | "favorite", slot: number): Vec3 {
  return source === "path" ? portalSlotPose(slot).position : favoriteSlotPose(slot).position;
}

function compactFavorites(list: Favorite[]): Favorite[] {
  return list
    .sort((a, b) => a.slot - b.slot)
    .map((fav, slot) => ({ slot, gameId: fav.gameId }));
}

export function attachRealm(io: Server): void {
  io.use((socket, next) => {
    try {
      const token = String(socket.handshake.auth?.token ?? "");
      socket.data.user = verifyToken(token);
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as AuthUser;
    const previousId = byUserId.get(user.id);
    if (previousId) {
      const previous = sessions.get(previousId);
      previous?.socket.disconnect(true);
      sessions.delete(previousId);
    }

    const shuffleSeed = (Math.random() * 0xffffffff) >>> 0;
    const favorites = loadFavorites(user);
    const session: Session = {
      socket,
      user,
      position: { x: 0, y: 1.2, z: 0 },
      rotY: 0,
      speaking: false,
      location: { type: "hub" },
      favorites,
      shuffleSeed,
      assignments: makeAssignments(
        shuffleSeed,
        favorites.map((f) => f.gameId),
      ),
    };

    sessions.set(socket.id, session);
    byUserId.set(user.id, socket.id);

    const alreadyHere = [...sessions.values()]
      .filter((s) => s.user.id !== user.id && s.location.type === "hub")
      .map(publicPlayer);

    socket.emit("welcome", {
      self: publicPlayer(session),
      players: alreadyHere,
      assignments: session.assignments,
      favorites: session.favorites,
      shuffleSeed: session.shuffleSeed,
    });

    emitToPlace(session, "playerJoined", publicPlayer(session));

    socket.on("move", (payload: { position: Vec3; rotY: number }) => {
      if (!payload?.position) return;
      session.position = payload.position;
      session.rotY = payload.rotY ?? 0;
      emitToPlace(session, "playerMoved", {
        id: user.id,
        position: session.position,
        rotY: session.rotY,
        location: session.location,
      });
    });

    socket.on("chat", (payload: { text: string }) => {
      const text = String(payload?.text ?? "").slice(0, 140).trim();
      if (!text) return;
      const at = Date.now();
      for (const other of othersInPlace(session)) {
        if (dist3(session.position, other.position) <= PROXIMITY_RANGE) {
          other.socket.emit("playerChat", { fromId: user.id, text, at });
        }
      }
      socket.emit("playerChat", { fromId: user.id, text, at });
    });

    socket.on("speaking", (payload: { active: boolean }) => {
      session.speaking = Boolean(payload?.active);
      emitToPlace(session, "playerSpeaking", { id: user.id, active: session.speaking });
    });

    socket.on("pin", (payload: { gameId: string }) => {
      const gameId = String(payload?.gameId ?? "");
      if (!gameById(gameId)) {
        socket.emit("error", { message: "Unknown game" });
        return;
      }
      if (session.favorites.some((f) => f.gameId === gameId)) {
        socket.emit("favoritesUpdated", { favorites: session.favorites });
        return;
      }
      if (session.favorites.length >= MAX_FAVORITES) {
        socket.emit("error", { message: "Favorites plaza is full (6)" });
        return;
      }
      session.favorites = compactFavorites([
        ...session.favorites,
        { slot: session.favorites.length, gameId },
      ]);
      persistFavorites(session);
      socket.emit("favoritesUpdated", { favorites: session.favorites });
    });

    socket.on("unpin", (payload: { gameId: string }) => {
      const gameId = String(payload?.gameId ?? "");
      session.favorites = compactFavorites(session.favorites.filter((f) => f.gameId !== gameId));
      persistFavorites(session);
      socket.emit("favoritesUpdated", { favorites: session.favorites });
    });

    socket.on("loopComplete", () => {
      session.shuffleSeed = (Math.imul(session.shuffleSeed, 1664525) + 1013904223) >>> 0;
      session.assignments = makeAssignments(
        session.shuffleSeed,
        session.favorites.map((f) => f.gameId),
      );
      socket.emit("assignments", {
        seed: session.shuffleSeed,
        assignments: session.assignments,
      });
    });

    socket.on(
      "enterPortal",
      (payload: { source: "path" | "favorite"; slot: number; gameId: string }) => {
        if (session.location.type !== "hub") return;
        const source = payload?.source;
        const slot = Number(payload?.slot);
        const gameId = String(payload?.gameId ?? "");
        const valid =
          source === "path"
            ? session.assignments.find((a) => a.slot === slot && a.gameId === gameId)
            : session.favorites.find((f) => f.slot === slot && f.gameId === gameId);
        if (!valid || !gameById(gameId)) {
          socket.emit("error", { message: "That door is closed" });
          return;
        }
        const door = portalPosition(source, slot);
        if (dist3(session.position, door) > PORTAL_INTERACT_RANGE + 2) {
          socket.emit("error", { message: "Get closer to the portal" });
          return;
        }

        const instanceId = `${user.id}:${gameId}:${Date.now()}`;
        const nearby = [...sessions.values()].filter(
          (s) =>
            s.user.id !== user.id &&
            s.location.type === "hub" &&
            dist3(session.position, s.position) <= PROXIMITY_RANGE,
        );

        session.location = { type: "game", gameId, instanceId };
        session.position = { x: 0, y: 1.2, z: 4 };
        session.rotY = Math.PI;
        socket.emit("entered", { location: session.location });

        for (const other of nearby) {
          other.socket.emit("followInvite", {
            fromId: user.id,
            fromName: user.username,
            gameId,
            instanceId,
          });
        }

        for (const other of sessions.values()) {
          if (other.user.id === user.id) continue;
          if (other.location.type === "hub") {
            other.socket.emit("playerLeft", { id: user.id });
          }
        }
      },
    );

    socket.on("follow", (payload: { instanceId: string }) => {
      const instanceId = String(payload?.instanceId ?? "");
      const host = [...sessions.values()].find(
        (s) => s.location.type === "game" && s.location.instanceId === instanceId,
      );
      if (!host || host.location.type !== "game" || session.location.type !== "hub") {
        socket.emit("error", { message: "That instance already closed" });
        return;
      }
      if (dist3(session.position, host.position) > PROXIMITY_RANGE + 40) {
        // host already moved into the room; allow follow from hub anyway if invite is fresh
      }
      for (const other of sessions.values()) {
        if (other.user.id !== user.id && other.location.type === "hub") {
          other.socket.emit("playerLeft", { id: user.id });
        }
      }
      session.location = { ...host.location };
      session.position = { x: (Math.random() - 0.5) * 3, y: 1.2, z: 4 };
      socket.emit("entered", { location: session.location });
      emitToPlace(session, "playerJoined", publicPlayer(session));
    });

    socket.on("leavePortal", () => {
      if (session.location.type !== "game") return;
      const previous = session.location;
      for (const other of othersInPlace(session)) {
        other.socket.emit("playerLeft", { id: user.id });
      }
      session.location = { type: "hub" };
      session.position = { x: 0, y: 1.2, z: 0 };
      socket.emit("entered", { location: session.location });
      emitToPlace(session, "playerJoined", publicPlayer(session));
      void previous;
    });

    socket.on("voice:signal", (payload: { toId: string; data: unknown }) => {
      const toId = String(payload?.toId ?? "");
      const targetSocketId = byUserId.get(toId);
      if (!targetSocketId) return;
      io.to(targetSocketId).emit("voice:signal", { fromId: user.id, data: payload.data });
    });

    socket.on("minigame", (payload: { instanceId?: string; gameId?: string; payload?: unknown }) => {
      const instanceId = String(payload?.instanceId ?? "");
      const gameId = String(payload?.gameId ?? "");
      if (!instanceId || !gameId) return;
      if (session.location.type !== "game") return;
      if (session.location.instanceId !== instanceId || session.location.gameId !== gameId) return;
      const msg = { instanceId, gameId, fromId: user.id, payload: payload.payload };
      for (const other of sessions.values()) {
        if (other.user.id === user.id) continue;
        if (other.location.type !== "game") continue;
        if (other.location.instanceId !== instanceId || other.location.gameId !== gameId) continue;
        other.socket.emit("minigame", msg);
      }
    });

    socket.on("disconnect", () => {
      sessions.delete(socket.id);
      if (byUserId.get(user.id) === socket.id) byUserId.delete(user.id);
      for (const other of sessions.values()) {
        other.socket.emit("playerLeft", { id: user.id });
      }
    });
  });
}
