import type {
  AuthUser,
  Favorite,
  PlayerLocation,
  PlayerPublic,
  PortalAssignment,
  Vec3,
} from "./types.ts";

export type WelcomePayload = {
  self: PlayerPublic;
  players: PlayerPublic[];
  assignments: PortalAssignment[];
  favorites: Favorite[];
  shuffleSeed: number;
};

export type FollowInvitePayload = {
  fromId: string;
  fromName: string;
  gameId: string;
  instanceId: string;
};

export type ChatPayload = {
  fromId: string;
  text: string;
  at: number;
};

export type VoiceSignal = {
  fromId: string;
  data: unknown;
};

export type ClientToServer = {
  move: { position: Vec3; rotY: number };
  chat: { text: string };
  pin: { gameId: string };
  unpin: { gameId: string };
  loopComplete: Record<string, never>;
  enterPortal: { source: "path" | "favorite"; slot: number; gameId: string };
  leavePortal: Record<string, never>;
  follow: { instanceId: string };
  speaking: { active: boolean };
  "voice:signal": { toId: string; data: unknown };
};

export type ServerToClient = {
  welcome: WelcomePayload;
  playerJoined: PlayerPublic;
  playerLeft: { id: string };
  playerMoved: { id: string; position: Vec3; rotY: number; location: PlayerLocation };
  playerSpeaking: { id: string; active: boolean };
  playerChat: ChatPayload;
  assignments: { seed: number; assignments: PortalAssignment[] };
  favoritesUpdated: { favorites: Favorite[] };
  followInvite: FollowInvitePayload;
  entered: { location: PlayerLocation };
  error: { message: string };
  "voice:signal": VoiceSignal;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
};
