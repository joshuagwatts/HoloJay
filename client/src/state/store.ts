import { create } from "zustand";
import { CHECKPOINT_COUNT, type AuthUser, type Favorite, type FollowInvitePayload, type PlayerLocation, type PlayerPublic, type PortalAssignment } from "@holojay/shared";

export type NearbyPortal = {
  source: "path" | "favorite" | "return";
  slot: number;
  gameId: string;
} | null;

type GameStore = {
  token: string | null;
  user: AuthUser | null;
  connected: boolean;
  selfId: string | null;
  players: Record<string, PlayerPublic>;
  assignments: PortalAssignment[];
  favorites: Favorite[];
  location: PlayerLocation;
  followInvite: FollowInvitePayload | null;
  loopVisited: boolean[];
  loopCount: number;
  toast: string | null;
  nearby: NearbyPortal;
  pointerLocked: boolean;
  chatOpen: boolean;
  ptt: boolean;
  micReady: boolean;
  lastChat: Record<string, { text: string; at: number }>;
  notice: string | null;
  localPos: { x: number; y: number; z: number };
  offline: boolean;

  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
  setConnected: (v: boolean) => void;
  setWelcome: (payload: {
    self: PlayerPublic;
    players: PlayerPublic[];
    assignments: PortalAssignment[];
    favorites: Favorite[];
  }) => void;
  upsertPlayer: (player: PlayerPublic) => void;
  removePlayer: (id: string) => void;
  movePlayer: (id: string, position: PlayerPublic["position"], rotY: number, location: PlayerLocation) => void;
  setSpeaking: (id: string, active: boolean) => void;
  setChat: (id: string, text: string, at: number) => void;
  setAssignments: (assignments: PortalAssignment[]) => void;
  setFavorites: (favorites: Favorite[]) => void;
  setLocation: (location: PlayerLocation) => void;
  setFollowInvite: (invite: FollowInvitePayload | null) => void;
  markCheckpoint: (index: number) => boolean;
  resetLoop: () => void;
  setNearby: (nearby: NearbyPortal) => void;
  setPointerLocked: (v: boolean) => void;
  setChatOpen: (v: boolean) => void;
  setPtt: (v: boolean) => void;
  setMicReady: (v: boolean) => void;
  setNotice: (notice: string | null) => void;
  setLocalPos: (pos: { x: number; y: number; z: number }) => void;
  setOffline: (v: boolean) => void;
};

const emptyLoop = () => Array.from({ length: CHECKPOINT_COUNT }, () => false);

export const useGame = create<GameStore>((set, get) => ({
  token: null,
  user: null,
  connected: false,
  selfId: null,
  players: {},
  assignments: [],
  favorites: [],
  location: { type: "hub" },
  followInvite: null,
  loopVisited: emptyLoop(),
  loopCount: 0,
  toast: null,
  nearby: null,
  pointerLocked: false,
  chatOpen: false,
  ptt: false,
  micReady: false,
  lastChat: {},
  notice: null,
  localPos: { x: 0, y: 1.2, z: 0 },
  offline: false,

  setAuth: (token, user) => set({ token, user }),
  clearAuth: () =>
    set({
      token: null,
      user: null,
      connected: false,
      selfId: null,
      players: {},
      assignments: [],
      favorites: [],
      location: { type: "hub" },
      followInvite: null,
      loopVisited: emptyLoop(),
      offline: false,
    }),
  setConnected: (connected) => set({ connected }),
  setWelcome: ({ self, players, assignments, favorites }) =>
    set({
      selfId: self.id,
      assignments,
      favorites,
      location: self.location,
      players: Object.fromEntries(players.map((p) => [p.id, p])),
      connected: true,
      loopVisited: emptyLoop(),
    }),
  upsertPlayer: (player) => set({ players: { ...get().players, [player.id]: player } }),
  removePlayer: (id) => {
    const next = { ...get().players };
    delete next[id];
    set({ players: next });
  },
  movePlayer: (id, position, rotY, location) => {
    const current = get().players[id];
    if (!current) return;
    set({ players: { ...get().players, [id]: { ...current, position, rotY, location } } });
  },
  setSpeaking: (id, active) => {
    if (id === get().selfId) return;
    const current = get().players[id];
    if (!current) return;
    set({ players: { ...get().players, [id]: { ...current, speaking: active } } });
  },
  setChat: (id, text, at) => set({ lastChat: { ...get().lastChat, [id]: { text, at } } }),
  setAssignments: (assignments) => set({ assignments, loopVisited: emptyLoop(), loopCount: get().loopCount + 1 }),
  setFavorites: (favorites) => set({ favorites }),
  setLocation: (location) => set({ location, followInvite: null }),
  setFollowInvite: (followInvite) => set({ followInvite }),
  markCheckpoint: (index) => {
    const loopVisited = get().loopVisited.slice();
    if (loopVisited[index]) return loopVisited.every(Boolean);
    loopVisited[index] = true;
    set({ loopVisited });
    return loopVisited.every(Boolean);
  },
  resetLoop: () => set({ loopVisited: emptyLoop() }),
  setNearby: (nearby) => set({ nearby }),
  setPointerLocked: (pointerLocked) => set({ pointerLocked }),
  setChatOpen: (chatOpen) => set({ chatOpen }),
  setPtt: (ptt) => set({ ptt }),
  setMicReady: (micReady) => set({ micReady }),
  setNotice: (notice) => set({ notice }),
  setLocalPos: (localPos) => set({ localPos }),
  setOffline: (offline) => set({ offline }),
}));
