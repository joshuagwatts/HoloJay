import {
  CHECKPOINT_COUNT,
  MAX_FAVORITES,
  PATH_SCALE,
  PORTAL_COUNT,
  type Vec3,
} from "./types.ts";

export function figure8Point(t: number, scale = PATH_SCALE): Vec3 {
  const x = scale * Math.sin(t);
  const z = scale * Math.sin(t) * Math.cos(t);
  return { x, y: 0.12, z };
}

export function figure8Tangent(t: number, scale = PATH_SCALE): Vec3 {
  const dx = scale * Math.cos(t);
  const dz = scale * Math.cos(2 * t);
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, y: 0, z: dz / len };
}

export function figure8Normal(t: number): Vec3 {
  const tangent = figure8Tangent(t);
  return { x: -tangent.z, y: 0, z: tangent.x };
}

export function portalSlotPose(slot: number) {
  const t = ((slot + 0.5) / PORTAL_COUNT) * Math.PI * 2;
  const p = figure8Point(t);
  const tangent = figure8Tangent(t);
  const normal = figure8Normal(t);
  const outward = 3.8;
  // Face inward toward the path so players walk up to the screen
  const face = { x: -normal.x, z: -normal.z };
  return {
    t,
    tangent,
    yaw: Math.atan2(face.x, face.z),
    position: {
      x: p.x + normal.x * outward,
      y: 0,
      z: p.z + normal.z * outward,
    },
  };
}

export function favoriteSlotPose(slot: number, total = MAX_FAVORITES) {
  const angle = (slot / total) * Math.PI * 2 - Math.PI / 2;
  const r = 6.2;
  return {
    // Face the plaza center
    yaw: angle + Math.PI,
    position: { x: Math.cos(angle) * r, y: 0, z: Math.sin(angle) * r },
  };
}

/** Dresser sits just off the plaza, facing inward. */
export function dresserPose() {
  return {
    position: { x: -10.5, y: 0, z: 2.2 },
    yaw: Math.PI * 0.5,
  };
}

/** World pose for a hat on the dresser top (matches HatDresser local layout). */
export function dresserHatSlotPose(slot: number, total = 5) {
  const dresser = dresserPose();
  const localX = (slot - (total - 1) / 2) * 0.58;
  const localZ = 0.15;
  const cy = Math.cos(dresser.yaw);
  const sy = Math.sin(dresser.yaw);
  return {
    position: {
      x: dresser.position.x + localX * cy + localZ * sy,
      y: 1.28,
      z: dresser.position.z - localX * sy + localZ * cy,
    },
    yaw: dresser.yaw + Math.PI,
  };
}

export function checkpointPose(index: number) {
  const t = (index / CHECKPOINT_COUNT) * Math.PI * 2;
  return { t, position: figure8Point(t) };
}

export function pathSamples(count = 256): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= count; i += 1) {
    pts.push(figure8Point((i / count) * Math.PI * 2));
  }
  return pts;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleIds(seed: number, ids: string[]): string[] {
  const rng = mulberry32(seed);
  const next = ids.slice();
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function distXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
