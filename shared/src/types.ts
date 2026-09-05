export const PATH_SCALE = 38;
export const PORTAL_COUNT = 8;
export const MAX_FAVORITES = 6;
export const CHECKPOINT_COUNT = 16;
export const PROXIMITY_RANGE = 20;
export const PROXIMITY_VOICE_REF = 8;
export const PORTAL_INTERACT_RANGE = 5.2;
export const CHECKPOINT_RANGE = 7;
export const MOVE_HZ = 15;

export type GameDef = {
  id: string;
  name: string;
  color: string;
  tagline: string;
};

export type AuthUser = {
  id: string;
  username: string;
  color: string;
  guest: boolean;
};

export type Vec3 = { x: number; y: number; z: number };

export type PlayerLocation =
  | { type: "hub" }
  | { type: "game"; gameId: string; instanceId: string };

export type PlayerPublic = {
  id: string;
  username: string;
  color: string;
  guest: boolean;
  position: Vec3;
  rotY: number;
  speaking: boolean;
  location: PlayerLocation;
  chat?: { text: string; at: number };
};

export type PortalAssignment = {
  slot: number;
  gameId: string;
};

export type Favorite = {
  slot: number;
  gameId: string;
};

export const ORB_COLORS = [
  "#5ce1ff",
  "#ff6bd6",
  "#b388ff",
  "#69f0ae",
  "#ffd54f",
  "#ff8a65",
  "#82b1ff",
  "#ea80fc",
] as const;
