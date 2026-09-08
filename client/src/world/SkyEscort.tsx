import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { emitMinigame, onMinigame } from "../net/session.ts";
import { useGame } from "../state/store.ts";

/** Halo-3-finale vibe: pickup-truck trek A→B over a dying plain. Driver + bed gunner. */

type LevelDef = {
  id: string;
  name: string;
  startZ: number;
  endZ: number;
  halfW: number;
  tile: number;
  hull: number;
  driveSpeed: number;
  turnRate: number;
  meteorEvery: number;
  alienEvery: number;
};

const LEVEL_NAMES = [
  "Dust Trail",
  "Ash Run",
  "Cinder Flats",
  "Glass Plain",
  "Scorch Reach",
  "Breach Field",
  "Ruin Expanse",
  "Last Ridge",
];

/** Endless escalating runs — index 0 is gentle, denser chaos as you push. */
function makeLevel(n: number): LevelDef {
  const t = Math.max(0, Math.floor(n));
  const soft = Math.min(t, 24);
  return {
    id: `run-${t}`,
    name: LEVEL_NAMES[t] ?? `Wave ${t + 1}`,
    startZ: 24 + Math.min(soft, 10) * 1.4,
    // Longer early runs so the fight has room to breathe (~12–16s L0).
    endZ: -(110 + soft * 30),
    halfW: 38 + Math.min(soft, 14) * 1.8,
    tile: 5,
    hull: 3 + (soft >= 6 ? 1 : 0) + (soft >= 14 ? 1 : 0),
    driveSpeed: 19 + Math.min(soft, 16) * 0.55,
    turnRate: 2.55,
    // Early pressure is the whole point — don't wait until wave 10 to feel alive.
    meteorEvery: Math.max(0.32, 0.92 - soft * 0.035),
    alienEvery: Math.max(0.38, 0.95 - soft * 0.04),
  };
}

/** Tiny arcade one-shots — silence was killing the fantasy. */
type SfxKind = "fire" | "kill" | "boom" | "boost" | "hurt" | "gate" | "hit";
let sfxCtx: AudioContext | null = null;
function playSfx(kind: SfxKind) {
  try {
    sfxCtx ??= new AudioContext();
    if (sfxCtx.state === "suspended") void sfxCtx.resume();
    const t0 = sfxCtx.currentTime;
    const o = sfxCtx.createOscillator();
    const g = sfxCtx.createGain();
    o.connect(g);
    g.connect(sfxCtx.destination);
    const table: Record<SfxKind, { f: number; f2: number; dur: number; type: OscillatorType; vol: number }> = {
      fire: { f: 420, f2: 180, dur: 0.05, type: "square", vol: 0.045 },
      hit: { f: 880, f2: 440, dur: 0.06, type: "triangle", vol: 0.05 },
      kill: { f: 660, f2: 1320, dur: 0.12, type: "sawtooth", vol: 0.07 },
      boom: { f: 90, f2: 40, dur: 0.22, type: "sine", vol: 0.09 },
      boost: { f: 220, f2: 520, dur: 0.18, type: "sawtooth", vol: 0.06 },
      hurt: { f: 160, f2: 70, dur: 0.2, type: "square", vol: 0.08 },
      gate: { f: 392, f2: 784, dur: 0.28, type: "triangle", vol: 0.08 },
    };
    const s = table[kind];
    o.type = s.type;
    o.frequency.setValueAtTime(s.f, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, s.f2), t0 + s.dur);
    g.gain.setValueAtTime(s.vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + s.dur);
    o.start(t0);
    o.stop(t0 + s.dur + 0.02);
  } catch {
    /* audio optional */
  }
}

function levelIndexFromId(id: string | undefined): number {
  if (!id) return 0;
  const m = /^run-(\d+)$/.exec(id);
  if (m) return parseInt(m[1], 10);
  if (id === "ash-run") return 0;
  if (id === "glass-plain") return 1;
  return 0;
}

/** Winding route ribbon — curves, bridge arch, corkscrew — not a straight ash runway. */
type Crater = { id: number; x: number; z: number; r: number; depth: number };
type PathPoint = { t: number; x: number; z: number; y: number; yaw: number };

const ROAD_HALF = 6.6;

function pathXZ(t: number, levelIdx: number, startZ: number, endZ: number): { x: number; z: number } {
  const span = Math.max(1, startZ - endZ);
  const tt = Math.min(1, Math.max(0, t));
  const seed = levelIdx * 2.17;
  const amp = 13 + Math.min(levelIdx, 14) * 1.15;
  const z = startZ - tt * span;
  let x =
    Math.sin(tt * Math.PI * 1.85 + seed) * amp * 0.62 +
    Math.sin(tt * Math.PI * 3.6 + seed * 1.4) * amp * 0.28;
  // Corkscrew / helix mid-route
  if (tt > 0.3 && tt < 0.58) {
    const u = (tt - 0.3) / 0.28;
    x += Math.sin(u * Math.PI * 2.6 + seed) * (11 + Math.min(levelIdx, 10) * 0.35);
  }
  // Late S-bend into the gate
  if (tt > 0.72) {
    const u = (tt - 0.72) / 0.28;
    x += Math.sin(u * Math.PI) * (amp * 0.35) * (levelIdx % 2 === 0 ? 1 : -1);
  }
  return { x, z };
}

function pathHeight(t: number, levelIdx: number): number {
  const tt = Math.min(1, Math.max(0, t));
  let y = 1.05 + tt * 0.55;
  // Drive-up ramps
  y += Math.exp(-((tt - 0.16) ** 2) * 110) * 3.2;
  y += Math.exp(-((tt - 0.72) ** 2) * 100) * 2.6;
  // Bridge arch — must stay on the ribbon
  if (tt > 0.44 && tt < 0.63) {
    const u = (tt - 0.44) / 0.19;
    y += Math.sin(u * Math.PI) * (5.8 + Math.min(levelIdx, 8) * 0.15);
  }
  // Corkscrew rise
  if (tt > 0.3 && tt < 0.58) {
    const u = (tt - 0.3) / 0.28;
    y += 0.9 + Math.sin(u * Math.PI) * 2.8;
  }
  if (tt < 0.05) y = 1.05;
  if (tt > 0.95) y = Math.min(y, 1.55);
  return y;
}

function pathPoint(t: number, levelIdx: number, startZ: number, endZ: number): PathPoint {
  const tt = Math.min(1, Math.max(0, t));
  const a = pathXZ(tt, levelIdx, startZ, endZ);
  const b = pathXZ(Math.min(1, tt + 0.006), levelIdx, startZ, endZ);
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  return { t: tt, x: a.x, z: a.z, y: pathHeight(tt, levelIdx), yaw };
}

/** Cached path polyline — nearestOnPath was melting the frame after L1. */
type PathCache = { key: string; samples: PathPoint[] };
let pathCache: PathCache | null = null;

function pathCacheKey(levelIdx: number, startZ: number, endZ: number) {
  return `${levelIdx}:${startZ}:${endZ}`;
}

function ensurePathCache(levelIdx: number, startZ: number, endZ: number): PathPoint[] {
  const key = pathCacheKey(levelIdx, startZ, endZ);
  if (pathCache?.key === key) return pathCache.samples;
  const samples: PathPoint[] = [];
  const n = 64;
  for (let i = 0; i <= n; i++) samples.push(pathPoint(i / n, levelIdx, startZ, endZ));
  pathCache = { key, samples };
  return samples;
}

function nearestOnPath(
  x: number,
  z: number,
  startZ: number,
  endZ: number,
  levelIdx: number,
): { dist: number; pt: PathPoint } {
  const samples = ensurePathCache(levelIdx, startZ, endZ);
  // Coarse guess from Z progress, then local search — O(1) typical.
  const span = Math.max(1, startZ - endZ);
  let guess = Math.round(((startZ - z) / span) * (samples.length - 1));
  guess = Math.min(samples.length - 1, Math.max(0, guess));
  let best = samples[guess]!;
  let bestD = Math.hypot(best.x - x, best.z - z);
  const window = 10;
  const lo = Math.max(0, guess - window);
  const hi = Math.min(samples.length - 1, guess + window);
  for (let i = lo; i <= hi; i++) {
    const pt = samples[i]!;
    const d = Math.hypot(pt.x - x, pt.z - z);
    if (d < bestD) {
      bestD = d;
      best = pt;
    }
  }
  return { dist: bestD, pt: best };
}

function craterCarve(x: number, z: number, craters: Crater[]): number {
  let cut = 0;
  for (const c of craters) {
    const dist = Math.hypot(x - c.x, z - c.z);
    if (dist >= c.r) continue;
    const t = 1 - dist / c.r;
    cut += c.depth * t * t * (0.65 + 0.35 * t);
  }
  return cut;
}

function groundY(
  x: number,
  z: number,
  startZ: number,
  endZ: number,
  craters: Crater[],
  levelIdx: number,
): number {
  const { dist, pt } = nearestOnPath(x, z, startZ, endZ, levelIdx);
  let h: number;
  if (dist <= ROAD_HALF) {
    h = pt.y - (dist / ROAD_HALF) ** 2 * 0.28;
  } else if (dist < ROAD_HALF + 5.5) {
    const u = (dist - ROAD_HALF) / 5.5;
    h = pt.y - u * u * 8.5 - 0.4;
  } else {
    h = pt.y - 10 - (dist - ROAD_HALF) * 0.4;
  }
  // Void under elevated bridge / corkscrew if you leave the ribbon
  if (pt.y > 3.6 && dist > ROAD_HALF + 0.4) {
    h = Math.min(h, 0.15);
  }
  return Math.max(-3.2, h - craterCarve(x, z, craters));
}

type Role = "driver" | "gunner";
type Phase = "ready" | "run" | "intro" | "upgrade" | "won" | "dead";

type Meteor = { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number };
type Alien = { id: number; x: number; y: number; z: number; hp: number };
type Bullet = { id: number; x: number; y: number; z: number; dx: number; dy: number; dz: number };
type Blast = { id: number; x: number; y: number; z: number; age: number };

/** Lowkey upgrade / booster scaffolding — expand later without rewriting the loop. */
type UpgradeId = "boost" | "armor" | "radar" | "turret";
type Loadout = {
  boostCharges: number;
  boostMax: number;
  armorBonus: number;
  radar: boolean;
  turretRate: number;
};
type Pickup = {
  id: number;
  kind: UpgradeId;
  x: number;
  y: number;
  z: number;
  taken: boolean;
};

const DEFAULT_LOADOUT = (): Loadout => ({
  boostCharges: 1,
  boostMax: 1,
  armorBonus: 0,
  radar: false,
  turretRate: 1,
});

const UPGRADE_LABEL: Record<UpgradeId, string> = {
  boost: "Boost cell",
  armor: "Hull plate",
  radar: "Threat radar",
  turret: "Turret feed",
};

const UPGRADE_BLURB: Record<UpgradeId, string> = {
  boost: "Extra Shift boost charge for the next sectors",
  armor: "+1 max hull — tank one more hit",
  radar: "Paint dive ships and meteors in the sky",
  turret: "Faster bed-gun fire rate",
};

const UPGRADE_COLOR: Record<UpgradeId, string> = {
  boost: "#ff7043",
  armor: "#69f0ae",
  radar: "#40c4ff",
  turret: "#ffd54f",
};

type Snap = {
  type: "snap";
  phase: Phase;
  hull: number;
  score: number;
  x: number;
  z: number;
  y: number;
  yaw: number;
  craters: Crater[];
  meteors: Meteor[];
  aliens: Alien[];
  blasts: Blast[];
  shake: number;
  driverId: string | null;
  gunnerId: string | null;
  levelId: string;
};

type RoleMsg = {
  type: "role";
  driverId: string | null;
  gunnerId: string | null;
  phase?: Phase;
  levelId?: string;
};

type InputMsg = {
  type: "input";
  role: Role;
  throttle?: number;
  steer?: number;
  yaw?: number;
  pitch?: number;
  fire?: boolean;
};

function hostIdFromInstance(instanceId: string): string {
  if (instanceId.startsWith("local:")) return "local";
  return instanceId.split(":")[0] || "local";
}

function syncGroup<T>(
  group: THREE.Group | null,
  items: T[],
  apply: (item: T, mesh: THREE.Mesh) => void,
  make: () => THREE.Mesh,
) {
  if (!group) return;
  while (group.children.length < items.length) group.add(make());
  while (group.children.length > items.length) {
    const last = group.children[group.children.length - 1] as THREE.Mesh;
    group.remove(last);
    last.geometry.dispose();
  }
  items.forEach((item, i) => apply(item, group.children[i] as THREE.Mesh));
}

export function SkyEscort({ color }: { color: string }) {
  const { camera, gl, scene } = useThree();
  const selfId = useGame((s) => s.selfId) ?? "local";
  const location = useGame((s) => s.location);
  const players = useGame((s) => s.players);
  const offline = useGame((s) => s.offline);

  const instanceId = location.type === "game" ? location.instanceId : "local:sky-escort";
  const playerCount = Object.keys(players).length;
  const solo = offline || instanceId.startsWith("local:") || playerCount <= 1;
  // Solo must always simulate — otherwise the gate never advances.
  const isHost = solo || hostIdFromInstance(instanceId) === selfId;

  const [levelIdx, setLevelIdx] = useState(0);
  const levelIdxRef = useRef(0);
  const level = makeLevel(levelIdx);

  const [phase, setPhase] = useState<Phase>("ready");
  const [seat, setSeat] = useState<Role>("driver");
  const [hull, setHull] = useState(level.hull);
  const [hudDist, setHudDist] = useState(0);
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  const killStreak = useRef(0);
  const streakT = useRef(0);
  const [failCue, setFailCue] = useState(false);
  const failCueT = useRef(0);
  const [clearBanner, setClearBanner] = useState<string | null>(null);
  const clearBannerT = useRef(0);
  const [introLevel, setIntroLevel] = useState<{ idx: number; name: string } | null>(null);
  const [upgradeChoices, setUpgradeChoices] = useState<UpgradeId[]>([]);
  const upgradeChoicesRef = useRef<UpgradeId[]>([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const introT = useRef(0);
  const introSkipLock = useRef(0);
  const advancing = useRef(false);
  const loadout = useRef<Loadout>(DEFAULT_LOADOUT());
  const [loadoutHud, setLoadoutHud] = useState<Loadout>(DEFAULT_LOADOUT());
  const pickups = useRef<Pickup[]>([]);
  const boostTimer = useRef(0);
  const pickupGroup = useRef<THREE.Group>(null);
  const gateBeacon = useRef<THREE.Group>(null);
  const gateArch = useRef<THREE.Group>(null);
  const headingArrow = useRef<THREE.Group>(null);
  const introNextRef = useRef(1);

  const phaseRef = useRef<Phase>("ready");
  const seatRef = useRef<Role>("driver");
  const hullRef = useRef(level.hull);
  const shakeRef = useRef(0);
  const hudAcc = useRef(0);

  const x = useRef(0);
  const z = useRef(level.startZ);
  const y = useRef(0.85);
  const yaw = useRef(Math.PI); // face toward -Z gate
  const speed = useRef(0);
  const falling = useRef(false);
  const invuln = useRef(0);

  const keys = useRef({ throttle: 0, steer: 0 });
  const nextId = useRef(1);
  const meteorAcc = useRef(0);
  const alienAcc = useRef(0);
  const snapAcc = useRef(0);
  const gunSendAcc = useRef(0);
  const gunYaw = useRef(0);
  const gunPitch = useRef(0.12);
  const fireHeld = useRef(false);
  const fireCd = useRef(0);
  const lookQ = useRef({ x: 0, y: 0 });
  const remoteInput = useRef<InputMsg | null>(null);
  const driverIdRef = useRef<string | null>(selfId);
  const gunnerIdRef = useRef<string | null>("ai");
  const distScoreAcc = useRef(0);
  const hitFlashT = useRef(0);
  const [hitFlash, setHitFlash] = useState(false);
  const fovKick = useRef(0);

  const craters = useRef<Crater[]>([]);
  const meteors = useRef<Meteor[]>([]);
  const aliens = useRef<Alien[]>([]);
  const bullets = useRef<Bullet[]>([]);
  const blasts = useRef<Blast[]>([]);
  const groundDirty = useRef(true);

  const buggy = useRef<THREE.Group>(null);
  const gunMount = useRef<THREE.Group>(null);
  const gunPitchMount = useRef<THREE.Group>(null);
  /** First-person gun hardware locked to camera — always fills the gunner FOV. */
  const fpGun = useRef<THREE.Group | null>(null);
  const gunPivotWorld = useRef(new THREE.Vector3());
  const gunQuatWorld = useRef(new THREE.Quaternion());
  const gunEyeLocal = useRef(new THREE.Vector3());
  const gunLookDir = useRef(new THREE.Vector3());
  const bindCabHide = (g: THREE.Group | null) => {
    g?.traverse((obj) => {
      obj.layers.set(1);
    });
  };
  const groundMesh = useRef<THREE.Mesh>(null);
  const rampGroup = useRef<THREE.Group>(null);
  const craterGroup = useRef<THREE.Group>(null);
  const meteorGroup = useRef<THREE.Group>(null);
  const alienGroup = useRef<THREE.Group>(null);
  const bulletGroup = useRef<THREE.Group>(null);
  const blastGroup = useRef<THREE.Group>(null);

  const mats = useMemo(
    () => ({
      ground: new THREE.MeshStandardMaterial({
        color: "#5a4634",
        emissive: "#2a1c12",
        emissiveIntensity: 0.18,
        roughness: 0.92,
        metalness: 0.08,
        vertexColors: true,
      }),
      ramp: new THREE.MeshStandardMaterial({
        color: "#ffab40",
        emissive: "#ff6d00",
        emissiveIntensity: 1.35,
        roughness: 0.45,
        metalness: 0.35,
        transparent: true,
        opacity: 0.85,
      }),
      finish: new THREE.MeshStandardMaterial({
        color: "#c9a227",
        emissive: "#ffd54f",
        emissiveIntensity: 0.9,
        roughness: 0.4,
        metalness: 0.35,
      }),
      meteor: new THREE.MeshStandardMaterial({ color: "#5c4030", emissive: "#ff6a00", emissiveIntensity: 1.3 }),
      alien: new THREE.MeshStandardMaterial({ color: "#1b5e20", emissive: "#69f0ae", emissiveIntensity: 1.4 }),
      bullet: new THREE.MeshBasicMaterial({ color: "#ffe082" }),
      blast: new THREE.MeshBasicMaterial({ color: "#ff9100", transparent: true, opacity: 0.7 }),
    }),
    [color],
  );

  function setPhaseBoth(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function broadcastSnap() {
    if (!isHost || instanceId.startsWith("local:")) return;
    emitMinigame(instanceId, "sky-escort", {
      type: "snap",
      phase: phaseRef.current,
      hull: hullRef.current,
      score: scoreRef.current,
      x: x.current,
      z: z.current,
      y: y.current,
      yaw: yaw.current,
      craters: craters.current.map((c) => ({ ...c })),
      meteors: meteors.current.map((m) => ({ ...m })),
      aliens: aliens.current.map((a) => ({ ...a })),
      blasts: blasts.current.map((b) => ({ ...b })),
      shake: shakeRef.current,
      driverId: driverIdRef.current,
      gunnerId: gunnerIdRef.current,
      levelId: activeLevel().id,
    } satisfies Snap);
  }

  function addBlast(px: number, py: number, pz: number) {
    blasts.current.push({ id: nextId.current++, x: px, y: py, z: pz, age: 0 });
    if (blasts.current.length > 22) blasts.current.shift();
  }

  function hurt(n = 1) {
    if (invuln.current > 0) return;
    hullRef.current = Math.max(0, hullRef.current - n);
    setHull(hullRef.current);
    invuln.current = 0.85;
    shakeRef.current = Math.max(shakeRef.current, 0.85);
    addBlast(x.current, y.current + 0.4, z.current);
    playSfx("hurt");
    if (hullRef.current <= 0) {
      setPhaseBoth("dead");
      // Snaps only run during "run" — push one last death snap so gunner/clients see it.
      broadcastSnap();
    }
  }

  function flashHit() {
    hitFlashT.current = 0.12;
    setHitFlash(true);
  }

  /** Bed-turret pivot — matches gunMount local pos on the open bed. */
  function turretWorld() {
    const back = 2.45;
    const ox = Math.sin(yaw.current) * -back;
    const oz = Math.cos(yaw.current) * -back;
    return { x: x.current + ox, y: y.current + 1.65, z: z.current + oz };
  }

  function addScore(pts: number, label?: string) {
    scoreRef.current += pts;
    setScore(scoreRef.current);
    if (label) {
      setClearBanner(label);
      clearBannerT.current = 1.1;
    }
  }

  /** Muzzle tip along current aim — bullets leave here. */
  /** Muzzle tip — gunYaw/gunPitch are world-space, independent of truck yaw. */
  function muzzleWorld() {
    const t = turretWorld();
    const cy = Math.cos(gunYaw.current);
    const sy = Math.sin(gunYaw.current);
    const cp = Math.cos(gunPitch.current);
    const sp = Math.sin(gunPitch.current);
    const len = 1.9;
    return {
      x: t.x + sy * cp * len,
      y: t.y + sp * len,
      z: t.z + cy * cp * len,
    };
  }

  function activeLevel() {
    return makeLevel(levelIdxRef.current);
  }

  function setLevel(idx: number) {
    const next = Math.max(0, Math.floor(idx));
    levelIdxRef.current = next;
    setLevelIdx(next);
  }

  
  function gy(wx: number, wz: number) {
    const L = activeLevel();
    return groundY(wx, wz, L.startZ, L.endZ, craters.current, levelIdxRef.current);
  }

  function pathAt(t: number) {
    const L = activeLevel();
    return pathPoint(t, levelIdxRef.current, L.startZ, L.endZ);
  }

  function nearPath(wx: number, wz: number) {
    const L = activeLevel();
    return nearestOnPath(wx, wz, L.startZ, L.endZ, levelIdxRef.current);
  }

  function rebuildGroundSurface() {
    const mesh = groundMesh.current;
    if (!mesh) return;
    const L = activeLevel();
    const idx = levelIdxRef.current;
    const width = L.halfW * 2.8;
    const length = L.startZ - L.endZ + 56;
    const midZ = (L.startZ + L.endZ) * 0.5;
    const segX = 96;
    const segZ = Math.min(200, Math.max(100, Math.floor(length / 2)));
    const geo = new THREE.PlaneGeometry(width, length, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i);
      const wz = midZ + pos.getZ(i);
      const h = groundY(wx, wz, L.startZ, L.endZ, craters.current, idx);
      pos.setY(i, h);
      const { dist, pt } = nearestOnPath(wx, wz, L.startZ, L.endZ, idx);
      const onRoad = dist <= ROAD_HALF + 0.4;
      if (craterCarve(wx, wz, craters.current) > 0.35) {
        colors[i * 3] = 0.1;
        colors[i * 3 + 1] = 0.06;
        colors[i * 3 + 2] = 0.04;
      } else if (onRoad) {
        // Lit path ribbon — read as road
        const bridge = pt.y > 3.5 ? 0.18 : 0;
        colors[i * 3] = 0.42 + bridge + pt.t * 0.08;
        colors[i * 3 + 1] = 0.3 + bridge * 0.5;
        colors[i * 3 + 2] = 0.18;
      } else {
        colors[i * 3] = 0.18;
        colors[i * 3 + 1] = 0.12;
        colors[i * 3 + 2] = 0.09;
      }
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const prev = mesh.geometry;
    mesh.geometry = geo;
    mesh.position.set(0, 0, midZ);
    prev.dispose();
    groundDirty.current = false;

    // Markers along ramps / bridge / corkscrew
    const rg = rampGroup.current;
    if (rg) {
      while (rg.children.length) {
        const c = rg.children[0]!;
        rg.remove(c);
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
        }
      }
      const marks = [0.16, 0.38, 0.52, 0.72, 0.85];
      for (const t of marks) {
        const pt = pathPoint(t, idx, L.startZ, L.endZ);
        const ahead = pathPoint(Math.min(1, t + 0.02), idx, L.startZ, L.endZ);
        for (const side of [-1, 1]) {
          const nx = -Math.sin(pt.yaw + Math.PI / 2);
          const nz = -Math.cos(pt.yaw + Math.PI / 2);
          const marker = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.5, 3), mats.ramp);
          marker.position.set(pt.x + nx * side * 5.2, pt.y + 0.85, pt.z + nz * side * 5.2);
          marker.rotation.set(0.25, pt.yaw, 0);
          rg.add(marker);
        }
        const strip = new THREE.Mesh(new THREE.BoxGeometry(11, 0.07, 2.4), mats.ramp);
        strip.position.set(pt.x, pt.y + 0.04, pt.z);
        strip.rotation.y = pt.yaw;
        rg.add(strip);
        // Bridge glow rails
        if (t > 0.45 && t < 0.62) {
          for (const side of [-1, 1]) {
            const nx = -Math.sin(pt.yaw + Math.PI / 2);
            const nz = -Math.cos(pt.yaw + Math.PI / 2);
            const rail = new THREE.Mesh(
              new THREE.BoxGeometry(0.18, 0.7, 2.2),
              mats.ramp,
            );
            rail.position.set(pt.x + nx * side * ROAD_HALF * 0.92, pt.y + 0.45, pt.z + nz * side * ROAD_HALF * 0.92);
            rail.rotation.y = pt.yaw;
            rg.add(rail);
          }
        }
        void ahead;
      }
    }
  }

  function syncCraterMeshes() {
    const g = craterGroup.current;
    if (!g) return;
    const list = craters.current;
    while (g.children.length < list.length) {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(1, 16),
        new THREE.MeshStandardMaterial({
          color: "#1a100c",
          emissive: "#3e1f10",
          emissiveIntensity: 0.35,
          roughness: 1,
          side: THREE.DoubleSide,
        }),
      );
      m.rotation.x = -Math.PI / 2;
      g.add(m);
    }
    while (g.children.length > list.length) {
      const last = g.children[g.children.length - 1] as THREE.Mesh;
      g.remove(last);
      last.geometry.dispose();
    }
    list.forEach((c, i) => {
      const m = g.children[i] as THREE.Mesh;
      const hy = gy(c.x, c.z) + 0.06;
      m.position.set(c.x, hy, c.z);
      m.scale.setScalar(c.r * 0.95);
    });
  }

  function spawnPickups(L: LevelDef) {
    // Mid-run pads are bonus juice — real upgrades are chosen between levels.
    const list: Pickup[] = [];
    const pads = 2;
    for (let i = 0; i < pads; i++) {
      const tAlong = 0.28 + i * 0.35;
      const pt = pathPoint(tAlong, levelIdxRef.current, L.startZ, L.endZ);
      const side = i % 2 === 0 ? 1 : -1;
      const nx = -Math.sin(pt.yaw + Math.PI / 2);
      const nz = -Math.cos(pt.yaw + Math.PI / 2);
      const xx = pt.x + nx * side * 3.2;
      const zz = pt.z + nz * side * 3.2;
      list.push({
        id: nextId.current++,
        kind: "boost",
        x: xx,
        y: groundY(xx, zz, L.startZ, L.endZ, craters.current, levelIdxRef.current) + 1.1,
        z: zz,
        taken: false,
      });
    }
    pickups.current = list;
  }

  function buildTerrain() {
    craters.current = [];
    pathCache = null;
    groundDirty.current = true;
    spawnPickups(activeLevel());
    // Rebuild on next frame — disposing geometry mid-useFrame was crashing between levels.
  }

  function applyPickup(kind: UpgradeId) {
    const L = loadout.current;
    if (kind === "boost") {
      L.boostMax = Math.min(3, L.boostMax + 1);
      L.boostCharges = Math.min(L.boostMax, L.boostCharges + 1);
    } else if (kind === "armor") {
      L.armorBonus = Math.min(2, L.armorBonus + 1);
      hullRef.current = Math.min(activeLevel().hull + L.armorBonus, hullRef.current + 1);
      setHull(hullRef.current);
    } else if (kind === "radar") {
      L.radar = true;
    } else if (kind === "turret") {
      L.turretRate = Math.min(1.85, L.turretRate + 0.3);
    }
    setLoadoutHud({ ...L });
    setClearBanner(`UPGRADE · ${UPGRADE_LABEL[kind].toUpperCase()}`);
    clearBannerT.current = 1.8;
    playSfx("gate");
    shakeRef.current = Math.max(shakeRef.current, 0.4);
  }

  function tryBoost() {
    if (phaseRef.current !== "run" || seatRef.current !== "driver") return;
    if (boostTimer.current > 0) return;
    if (loadout.current.boostCharges <= 0) return;
    loadout.current.boostCharges -= 1;
    boostTimer.current = 1.25;
    fovKick.current = 1;
    shakeRef.current = Math.max(shakeRef.current, 0.45);
    setLoadoutHud({ ...loadout.current });
    setClearBanner("BOOST");
    clearBannerT.current = 0.7;
    playSfx("boost");
  }

  function snapSeatCam(role: Role) {
    if (role === "gunner") {
      // World-space aim — starts facing the route, not locked to chassis yaw.
      const face = nearPath(x.current, z.current).pt.yaw || Math.PI;
      gunYaw.current = face;
      gunPitch.current = 0.06;
      const t = turretWorld();
      camera.position.set(t.x - Math.sin(gunYaw.current) * 0.9, t.y + 0.55, t.z - Math.cos(gunYaw.current) * 0.9);
      camera.lookAt(
        t.x + Math.sin(gunYaw.current) * 30,
        t.y + 1.0,
        t.z + Math.cos(gunYaw.current) * 30,
      );
    } else {
      const back = 12;
      camera.position.set(
        x.current - Math.sin(yaw.current) * back,
        y.current + 5.6,
        z.current - Math.cos(yaw.current) * back,
      );
      camera.lookAt(
        x.current + Math.sin(yaw.current) * 14,
        1.2,
        z.current + Math.cos(yaw.current) * 14,
      );
    }
    camera.near = 0.1;
    camera.far = 420;
    camera.updateProjectionMatrix();
  }

  function pickSeat(role: Role) {
    seatRef.current = role;
    setSeat(role);
    snapSeatCam(role);
  }


  function setPausedBoth(next: boolean) {
    pausedRef.current = next;
    setPaused(next);
    if (next) {
      fireHeld.current = false;
      keys.current = { throttle: 0, steer: 0 };
      document.exitPointerLock?.();
    }
  }

  function offerUpgrades() {
    if (phaseRef.current === "upgrade" && upgradeChoicesRef.current.length > 0) return;
    const L = loadout.current;
    const pool = (["boost", "armor", "radar", "turret"] as UpgradeId[]).filter((k) => {
      if (k === "radar" && L.radar) return false;
      if (k === "armor" && L.armorBonus >= 2) return false;
      if (k === "turret" && L.turretRate >= 1.85) return false;
      if (k === "boost" && L.boostMax >= 3) return false;
      return true;
    });
    const bag = pool.length >= 2 ? [...pool] : (["boost", "armor", "radar", "turret"] as UpgradeId[]);
    const picks: UpgradeId[] = [];
    while (picks.length < 3 && bag.length) {
      const i = Math.floor(Math.random() * bag.length);
      picks.push(bag.splice(i, 1)[0]!);
    }
    while (picks.length < 3) picks.push(picks[picks.length - 1] ?? "boost");
    upgradeChoicesRef.current = picks;
    setUpgradeChoices(picks);
    setPausedBoth(false);
    setPhaseBoth("upgrade");
    emitMinigame(instanceId, "sky-escort", {
      type: "role",
      driverId: driverIdRef.current,
      gunnerId: gunnerIdRef.current,
      phase: "upgrade",
      levelId: makeLevel(introNextRef.current).id,
    } satisfies RoleMsg);
  }

  function chooseUpgrade(kind: UpgradeId) {
    if (phaseRef.current !== "upgrade") return;
    if (!isHost && !solo) return;
    applyPickup(kind);
    const next = introNextRef.current;
    advancing.current = false;
    upgradeChoicesRef.current = [];
    setUpgradeChoices([]);
    // Defer reset so we don't rebuild terrain in the same input/frame as the overlay unmount.
    queueMicrotask(() => {
      resetRun(seatRef.current, next);
      emitMinigame(instanceId, "sky-escort", {
        type: "role",
        driverId: driverIdRef.current,
        gunnerId: gunnerIdRef.current,
        phase: "run",
        levelId: makeLevel(next).id,
      } satisfies RoleMsg);
    });
  }

  function finishIntro() {
    if (phaseRef.current !== "intro") return;
    setIntroLevel(null);
    introT.current = 0;
    fireHeld.current = false;
    document.exitPointerLock?.();
    offerUpgrades();
  }

  function beginAdvance() {
    if (advancing.current || phaseRef.current !== "run") return;
    advancing.current = true;
    setPausedBoth(false);
    const next = levelIdxRef.current + 1;
    const nextL = makeLevel(next);
    // Freeze on the pad
    speed.current = 0;
    falling.current = false;
    keys.current = { throttle: 0, steer: 0 };
    fireHeld.current = false;
    lookQ.current.x = 0;
    lookQ.current.y = 0;
    const g = pathAt(1);
    x.current = g.x;
    z.current = g.z;
    y.current = g.y + 0.85;
    introT.current = 2.6;
    introSkipLock.current = 1.2;
    introNextRef.current = next;
    setIntroLevel({ idx: next, name: nextL.name });
    addScore(hullRef.current * 50 + 200, `GATE +${hullRef.current * 50 + 200}`);
    playSfx("gate");
    setPhaseBoth("intro");
    document.exitPointerLock?.();
    emitMinigame(instanceId, "sky-escort", {
      type: "role",
      driverId: driverIdRef.current,
      gunnerId: gunnerIdRef.current,
      phase: "intro",
      levelId: nextL.id,
    } satisfies RoleMsg);
  }

  function resetRun(asRole: Role, nextLevelIdx = levelIdxRef.current) {
    setLevel(nextLevelIdx);
    const L = makeLevel(nextLevelIdx);
    seatRef.current = asRole;
    setSeat(asRole);
    driverIdRef.current = asRole === "driver" ? selfId : "ai";
    gunnerIdRef.current = asRole === "gunner" ? selfId : "ai";
    const peer = Object.values(useGame.getState().players).find((p) => p.id !== selfId);
    if (peer) {
      if (asRole === "driver") gunnerIdRef.current = peer.id;
      else driverIdRef.current = peer.id;
    }
    const start = pathAt(0);
    x.current = start.x;
    z.current = start.z;
    y.current = start.y + 0.85;
    yaw.current = start.yaw;
    gunYaw.current = start.yaw;
    gunPitch.current = 0.06;
    speed.current = 0;
    falling.current = false;
    invuln.current = 0;
    hullRef.current = L.hull + (phaseRef.current === "intro" || phaseRef.current === "upgrade" ? loadout.current.armorBonus : 0);
    setHull(hullRef.current);
    // Fresh attempt from ready / death resets score + loadout; level clears keep them.
    if (nextLevelIdx === 0 || phaseRef.current === "dead" || phaseRef.current === "ready") {
      if (phaseRef.current !== "intro") {
        scoreRef.current = 0;
        setScore(0);
        killStreak.current = 0;
        loadout.current = DEFAULT_LOADOUT();
        setLoadoutHud({ ...loadout.current });
      }
    }
    keys.current = { throttle: 0, steer: 0 };
    meteors.current = [];
    aliens.current = [];
    bullets.current = [];
    blasts.current = [];
    meteorAcc.current = 0.55;
    alienAcc.current = 0.7;
    boostTimer.current = 0;
    distScoreAcc.current = 0;
    fovKick.current = 0;
    // Keep upgrades across levels; top off one boost charge each clear.
    loadout.current.boostCharges = Math.min(loadout.current.boostMax, loadout.current.boostCharges + 1);
    setLoadoutHud({ ...loadout.current });
    buildTerrain();
    // Seed dive ships so the first seconds aren't an empty commute.
    const seedN = 2 + Math.min(2, Math.floor(nextLevelIdx / 4));
    for (let i = 0; i < seedN; i++) {
      const pt = pathPoint(0.08 + i * 0.07, nextLevelIdx, L.startZ, L.endZ);
      aliens.current.push({
        id: nextId.current++,
        x: pt.x + (Math.random() - 0.5) * 8,
        y: pt.y + 5 + Math.random() * 4,
        z: pt.z,
        hp: nextLevelIdx < 3 ? 1 : 2,
      });
    }
    shakeRef.current = 0;
    failCueT.current = 0;
    setFailCue(false);
    // keep clearBanner so the "cleared" toast can show into the next run
    snapSeatCam(asRole);
    advancing.current = false;
    setPhaseBoth("run");
  }

  useEffect(() => {
    document.exitPointerLock?.();
    buildTerrain();
    snapSeatCam("driver");
    return () => {
      document.exitPointerLock?.();
      camera.position.set(3, 4.2, 11);
      camera.lookAt(0, 1.2, 0);
      camera.layers.enable(0);
      camera.layers.enable(1);
      camera.updateProjectionMatrix();
    };
  }, [camera]);

  // First-person viewmodel lives in the SCENE (not parented to the camera).
  // Camera parenting + MeshStandardMaterial kept failing to show a barrel on alpha;
  // scene-sync + MeshBasicMaterial is always lit and always in the graph R3F renders.
  useEffect(() => {
    const gun = new THREE.Group();
    gun.name = "sky-escort-fp-gun";
    gun.visible = false;
    gun.frustumCulled = false;
    gun.renderOrder = 10;

    // Unlit materials — cannot wash out or depend on truck/camera lights.
    const matSteel = new THREE.MeshBasicMaterial({ color: "#e8eef2" });
    const matReceiver = new THREE.MeshBasicMaterial({ color: "#b0bec5" });
    const matCheek = new THREE.MeshBasicMaterial({ color: "#6d4c41" });
    const matGrip = new THREE.MeshBasicMaterial({ color: "#3e2723" });
    const matMuzzle = new THREE.MeshBasicMaterial({ color: "#ffab40" });
    const matBead = new THREE.MeshBasicMaterial({ color: "#ffe082" });

    const bead = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.07), matBead);
    bead.position.set(0, 0.16, -0.65);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.4, 0.95), matReceiver);
    receiver.position.set(0, -0.12, 0.45);
    const cheekL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.48, 0.7), matCheek);
    cheekL.position.set(-0.52, -0.02, 0.32);
    const cheekR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.48, 0.7), matCheek);
    cheekR.position.set(0.52, -0.02, 0.32);
    // Camera looks down -Z; -PI/2 puts cylinder tip toward muzzle / into the world.
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 2.6, 14), matSteel);
    barrel.rotation.x = -Math.PI / 2;
    barrel.position.set(0, -0.04, -1.25);
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.12, 0.36, 12), matMuzzle);
    muzzle.rotation.x = -Math.PI / 2;
    muzzle.position.set(0, -0.04, -2.55);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.5), matGrip);
    grip.position.set(0, -0.38, 0.28);

    gun.add(bead, receiver, cheekL, cheekR, barrel, muzzle, grip);
    gun.traverse((o) => {
      o.layers.set(0);
      o.frustumCulled = false;
      if (o instanceof THREE.Mesh) {
        o.renderOrder = 10;
        // Draw on top of nearby truck bed geo so the viewmodel never "vanishes".
        o.material.depthTest = true;
        o.material.depthWrite = true;
      }
    });
    scene.add(gun);
    fpGun.current = gun;

    return () => {
      scene.remove(gun);
      gun.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
      fpGun.current = null;
    };
  }, [scene]);

  useEffect(() => {
    const others = Object.values(players).filter((p) => p.id !== selfId);
    if (instanceId.startsWith("local:") || offline || others.length === 0) {
      driverIdRef.current = seat === "driver" ? selfId : "ai";
      gunnerIdRef.current = seat === "gunner" ? selfId : "ai";
    } else if (isHost) {
      driverIdRef.current = selfId;
      gunnerIdRef.current = others[0]?.id ?? "ai";
    } else {
      driverIdRef.current = hostIdFromInstance(instanceId);
      gunnerIdRef.current = selfId;
      pickSeat("gunner");
    }
  }, [players, selfId, instanceId, offline, isHost, seat]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (useGame.getState().chatOpen) return;
      if (e.repeat) return;
      const p = phaseRef.current;

      if (e.code === "Escape") {
        e.preventDefault();
        if (p === "run") {
          setPausedBoth(!pausedRef.current);
        } else if (p === "upgrade") {
          // stay on upgrade — Esc does nothing
        }
        return;
      }

      if (pausedRef.current) {
        if (e.code === "Space" || e.code === "Enter" || e.code === "KeyP") {
          e.preventDefault();
          setPausedBoth(false);
        }
        return;
      }

      if (p === "ready") {
        if (e.code === "Digit1" || e.code === "KeyQ") pickSeat("driver");
        if (e.code === "Digit2" || e.code === "KeyE") pickSeat("gunner");
        if (e.code === "Tab" || e.code === "KeyX") {
          e.preventDefault();
          pickSeat(seatRef.current === "driver" ? "gunner" : "driver");
        }
        if (e.code === "Space" || e.code === "Enter") {
          e.preventDefault();
          if (!isHost) return;
          const role = seatRef.current;
          resetRun(role, levelIdxRef.current);
          emitMinigame(instanceId, "sky-escort", {
            type: "role",
            driverId: role === "driver" ? selfId : "ai",
            gunnerId: role === "gunner" ? selfId : Object.values(players).find((pl) => pl.id !== selfId)?.id ?? "ai",
            phase: "run",
            levelId: activeLevel().id,
          } satisfies RoleMsg);
        }
        return;
      }

      if (p === "intro" && (e.code === "Space" || e.code === "Enter")) {
        if (introSkipLock.current > 0) return;
        e.preventDefault();
        finishIntro();
        return;
      }

      if (p === "upgrade") {
        if (e.code === "Digit1" || e.code === "Numpad1") {
          e.preventDefault();
          const k = upgradeChoicesRef.current[0];
          if (k) chooseUpgrade(k);
        }
        if (e.code === "Digit2" || e.code === "Numpad2") {
          e.preventDefault();
          const k = upgradeChoicesRef.current[1];
          if (k) chooseUpgrade(k);
        }
        if (e.code === "Digit3" || e.code === "Numpad3") {
          e.preventDefault();
          const k = upgradeChoicesRef.current[2];
          if (k) chooseUpgrade(k);
        }
        return;
      }

      if ((p === "dead" || p === "won") && (e.code === "Space" || e.code === "KeyR" || e.code === "Enter")) {
        e.preventDefault();
        if (!isHost) return;
        const next = p === "won" ? levelIdxRef.current + 1 : levelIdxRef.current;
        resetRun(seatRef.current, next);
        emitMinigame(instanceId, "sky-escort", {
          type: "role",
          driverId: driverIdRef.current,
          gunnerId: gunnerIdRef.current,
          phase: "run",
          levelId: activeLevel().id,
        } satisfies RoleMsg);
        return;
      }

      if (p !== "run") return;
      if (seatRef.current === "driver") {
        if (e.code === "KeyW" || e.code === "ArrowUp") keys.current.throttle = 1;
        if (e.code === "KeyS" || e.code === "ArrowDown") keys.current.throttle = -1;
        if (e.code === "KeyA" || e.code === "ArrowLeft") keys.current.steer = 1;
        if (e.code === "KeyD" || e.code === "ArrowRight") keys.current.steer = -1;
      }
      if (seatRef.current === "gunner" && (e.code === "Space" || e.code === "KeyF")) fireHeld.current = true;
      if (seatRef.current === "driver" && (e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "KeyB")) {
        tryBoost();
      }
    };

    const up = (e: KeyboardEvent) => {
      if (e.code === "KeyW" || e.code === "ArrowUp" || e.code === "KeyS" || e.code === "ArrowDown") {
        keys.current.throttle = 0;
      }
      if (e.code === "KeyA" || e.code === "ArrowLeft" || e.code === "KeyD" || e.code === "ArrowRight") {
        keys.current.steer = 0;
      }
      if (e.code === "Space" || e.code === "KeyF") fireHeld.current = false;
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [isHost, instanceId, selfId, players]);

  useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: MouseEvent) => {
      if (phaseRef.current !== "run" || pausedRef.current || seatRef.current !== "gunner") return;
      lookQ.current.x += e.movementX;
      lookQ.current.y += e.movementY;
    };
    const onDown = () => {
      if (phaseRef.current !== "run" || pausedRef.current || seatRef.current !== "gunner") return;
      if (document.pointerLockElement !== el) void el.requestPointerLock();
      fireHeld.current = true;
    };
    const onUp = () => {
      fireHeld.current = false;
    };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, [gl]);

  useEffect(() => {
    return onMinigame((msg) => {
      if (msg.instanceId !== instanceId || msg.gameId !== "sky-escort") return;
      const data = msg.payload as RoleMsg | InputMsg | Snap;
      if (!data || typeof data !== "object" || !("type" in data)) return;

      if (data.type === "role") {
        driverIdRef.current = data.driverId;
        gunnerIdRef.current = data.gunnerId;
        if (data.levelId) {
          setLevel(levelIndexFromId(data.levelId));
        }
        if (data.driverId === selfId) pickSeat("driver");
        else if (data.gunnerId === selfId) pickSeat("gunner");
        if (data.phase === "intro" && !isHost) {
          const idx = levelIndexFromId(data.levelId);
          const L = makeLevel(idx);
          introNextRef.current = idx;
          setIntroLevel({ idx, name: L.name });
          introT.current = 2.6;
          introSkipLock.current = 1.2;
          advancing.current = true;
          setPausedBoth(false);
          setPhaseBoth("intro");
        }
        if (data.phase === "upgrade" && !isHost) {
          const idx = levelIndexFromId(data.levelId);
          introNextRef.current = idx;
          setIntroLevel(null);
          offerUpgrades();
        }
        if (data.phase === "run" && !isHost) {
          const idx = levelIndexFromId(data.levelId);
          setLevel(idx);
          buildTerrain();
          const L = activeLevel();
          hullRef.current = L.hull;
          setHull(L.hull);
          advancing.current = false;
          setIntroLevel(null);
          setPhaseBoth("run");
        }
      }
      if (data.type === "input" && isHost) remoteInput.current = data;
      if (data.type === "snap" && !isHost) {
        if (data.levelId) {
          setLevel(levelIndexFromId(data.levelId));
        }
        phaseRef.current = data.phase;
        setPhase(data.phase);
        hullRef.current = data.hull;
        setHull(data.hull);
        if (typeof data.score === "number") {
          scoreRef.current = data.score;
          setScore(data.score);
        }
        x.current = data.x;
        z.current = data.z;
        y.current = data.y;
        yaw.current = data.yaw;
        craters.current = (data.craters ?? []).map((c) => ({ ...c }));
        groundDirty.current = true;
        meteors.current = data.meteors;
        aliens.current = data.aliens;
        blasts.current = data.blasts;
        shakeRef.current = data.shake;
        driverIdRef.current = data.driverId;
        gunnerIdRef.current = data.gunnerId;
      }
    });
  }, [instanceId, isHost, selfId]);

  useFrame((_, dt) => {
    const clamped = Math.min(dt, 0.05);
    const level = activeLevel();
    const progress = nearPath(x.current, z.current).pt.t;
    hudAcc.current += clamped;
    if (hudAcc.current > 0.12) {
      hudAcc.current = 0;
      const gate = pathAt(1);
      setHudDist(Math.max(0, Math.floor(Math.hypot(gate.x - x.current, gate.z - z.current))));
    }

    if (failCueT.current > 0) {
      failCueT.current = Math.max(0, failCueT.current - clamped);
      if (failCueT.current <= 0) setFailCue(false);
    }
    if (clearBannerT.current > 0) {
      clearBannerT.current = Math.max(0, clearBannerT.current - clamped);
      if (clearBannerT.current <= 0) setClearBanner(null);
    }
    if (phaseRef.current === "intro") {
      introT.current -= clamped;
      introSkipLock.current = Math.max(0, introSkipLock.current - clamped);
      if (introT.current <= 0) finishIntro();
    }

    if (pausedRef.current || phaseRef.current === "upgrade") {
      // Frozen — still keep the truck posed; skip sim / threats.
      if (buggy.current) {
        buggy.current.position.set(x.current, Math.max(y.current, -3), z.current);
        buggy.current.rotation.y = yaw.current;
      }
    } else if (phaseRef.current === "run" && seatRef.current === "driver" && !isHost) {
      snapAcc.current += clamped;
      if (snapAcc.current > 0.05) {
        snapAcc.current = 0;
        emitMinigame(instanceId, "sky-escort", {
          type: "input",
          role: "driver",
          throttle: keys.current.throttle,
          steer: keys.current.steer,
        } satisfies InputMsg);
      }
    }

    if (phaseRef.current === "run" && isHost && !pausedRef.current) {
      let throttle = keys.current.throttle;
      let steer = keys.current.steer;
      const rin = remoteInput.current;
      if (driverIdRef.current !== selfId && rin?.role === "driver") {
        if (typeof rin.throttle === "number") throttle = rin.throttle;
        if (typeof rin.steer === "number") steer = rin.steer;
      }

      if (driverIdRef.current === "ai") {
        throttle = 0.95;
        const look = pathAt(Math.min(1, nearPath(x.current, z.current).pt.t + 0.04));
        const wantYaw = Math.atan2(look.x - x.current, look.z - z.current);
        let err = wantYaw - yaw.current;
        while (err > Math.PI) err -= Math.PI * 2;
        while (err < -Math.PI) err += Math.PI * 2;
        steer = THREE.MathUtils.clamp(err * 2.4, -1, 1);
        const threat = meteors.current.find(
          (m) => Math.hypot(m.x - x.current, m.z - z.current) < 10 && m.y < 8,
        );
        if (threat) steer += threat.x > x.current ? -0.7 : 0.7;
      }

      if (!falling.current) {
        // Freer steering when slow — Warthog fantasy, not a boat.
        const steerScale = 0.85 + Math.min(0.35, Math.abs(speed.current) / 28);
        yaw.current += steer * level.turnRate * clamped * steerScale;
        if (boostTimer.current > 0) boostTimer.current = Math.max(0, boostTimer.current - clamped);
        const boostMul = boostTimer.current > 0 ? 1.55 : 1;
        const target =
          throttle === 0
            ? speed.current * 0.15 // light coast, not an instant brick
            : throttle * level.driveSpeed * boostMul * (0.92 + progress * 0.22);
        speed.current = THREE.MathUtils.damp(speed.current, target, throttle === 0 ? 1.6 : 8.5, clamped);
        const v = speed.current;
        x.current += Math.sin(yaw.current) * v * clamped;
        z.current += Math.cos(yaw.current) * v * clamped;
        // Soft corridor — pull back onto the winding ribbon if you drift off.
        const on = nearPath(x.current, z.current);
        if (on.dist > ROAD_HALF + 1.2) {
          const pull = Math.min(1, (on.dist - ROAD_HALF) / 8) * 10 * clamped;
          x.current += (on.pt.x - x.current) * pull;
          z.current += (on.pt.z - z.current) * pull * 0.35;
        }
        x.current = THREE.MathUtils.clamp(x.current, -level.halfW + 2.5, level.halfW - 2.5);
        // Fall off bridge / corkscrew void
        if (on.dist > ROAD_HALF + 2.8 && on.pt.y > 3.4) falling.current = true;
        // Driver gets drip score for meters burned — seat isn't just a taxi.
        if (Math.abs(v) > 4) {
          distScoreAcc.current += Math.abs(v) * clamped * 0.45;
          if (distScoreAcc.current >= 5) {
            const pts = Math.floor(distScoreAcc.current);
            distScoreAcc.current -= pts;
            addScore(pts);
          }
        }
      }

      // Continuous ground follow + crater pits (no block tiles).
      const surface = gy(x.current, z.current);
      const pit = craterCarve(x.current, z.current, craters.current);
      if (!falling.current && pit > 2.1) falling.current = true;
      if (falling.current) {
        y.current -= 16 * clamped;
        if (y.current < surface - 4 || y.current < -4) {
          falling.current = false;
          hurt(1);
          // Snap back onto the route ribbon
          const back = nearPath(x.current, z.current).pt;
          x.current = back.x;
          z.current = back.z;
          y.current = back.y + 0.85;
          yaw.current = back.yaw;
        }
      } else {
        const ahead = gy(
          x.current + Math.sin(yaw.current) * 3.2,
          z.current + Math.cos(yaw.current) * 3.2,
        );
        const behind = gy(
          x.current - Math.sin(yaw.current) * 2.4,
          z.current - Math.cos(yaw.current) * 2.4,
        );
        const targetY = surface + 0.85;
        y.current = THREE.MathUtils.damp(y.current, targetY, 14, clamped);
        if (buggy.current) {
          const pitch = Math.atan2(behind - ahead, 5.6);
          buggy.current.rotation.x = THREE.MathUtils.damp(buggy.current.rotation.x, pitch, 10, clamped);
        }
      }

      // Pickup pads (boost / upgrade scaffolding)
      for (const pk of pickups.current) {
        if (pk.taken) continue;
        if (Math.hypot(pk.x - x.current, pk.z - z.current) < 3.4) {
          pk.taken = true;
          applyPickup(pk.kind);
          addBlast(pk.x, pk.y + 0.4, pk.z);
        }
      }

      meteorAcc.current += clamped;
      const meteorEvery = Math.max(0.32, level.meteorEvery - progress * Math.min(0.35, 0.15 + levelIdxRef.current * 0.025));
      if (meteorAcc.current >= meteorEvery) {
        meteorAcc.current = 0;
        // Bias impacts toward the truck corridor so they matter.
        const near = Math.random() < 0.62;
        meteors.current.push({
          id: nextId.current++,
          x: near
            ? x.current + (Math.random() - 0.5) * 14
            : x.current + (Math.random() - 0.5) * level.halfW * 1.2,
          y: 14 + Math.random() * 8,
          z: z.current - 6 - Math.random() * 36,
          vx: (Math.random() - 0.5) * 5,
          vy: -17 - progress * 10,
          vz: 3 + Math.random() * 6,
        });
      }
      for (const m of meteors.current) {
        m.x += m.vx * clamped;
        m.y += m.vy * clamped;
        m.z += m.vz * clamped;
        if (m.y < 0.3) {
          addBlast(m.x, 0.45, m.z);
          const nearTruck = Math.hypot(m.x - x.current, m.z - z.current) < 11;
          if (nearTruck) {
            shakeRef.current = Math.max(shakeRef.current, 0.7);
            failCueT.current = 0.9;
            setFailCue(true);
            playSfx("boom");
          }
          craters.current.push({
            id: nextId.current++,
            x: m.x,
            z: m.z,
            r: 4.8 + Math.random() * 1.6,
            depth: 2.4 + Math.random() * 1.2,
          });
          if (craters.current.length > 28) craters.current.shift();
          groundDirty.current = true;
          m.y = -99;
        }
        if (Math.hypot(m.x - x.current, m.z - z.current) < 1.7 && m.y < 2.3 && m.y > 0) {
          hurt(1);
          m.y = -99;
          addBlast(x.current, y.current, z.current);
        }
      }
      meteors.current = meteors.current.filter((m) => m.y > -20 && m.z < z.current + 40);

      alienAcc.current += clamped;
      const alienEvery = Math.max(0.36, level.alienEvery - progress * 0.55);
      if (alienAcc.current >= alienEvery) {
        alienAcc.current = 0;
        // Wave packs ahead along the winding route.
        const pack = Math.random() < 0.35 + Math.min(0.35, levelIdxRef.current * 0.04) ? 2 : 1;
        const here = nearPath(x.current, z.current).pt.t;
        for (let i = 0; i < pack; i++) {
          const pt = pathAt(Math.min(0.98, here + 0.08 + Math.random() * 0.12 + i * 0.03));
          aliens.current.push({
            id: nextId.current++,
            x: pt.x + (Math.random() - 0.5) * 10,
            y: pt.y + 5 + Math.random() * 6,
            z: pt.z,
            hp: levelIdxRef.current < 3 ? 1 : levelIdxRef.current < 10 ? 2 : 3,
          });
        }
      }

      const muzzle = muzzleWorld();
      fireCd.current = Math.max(0, fireCd.current - clamped);
      const gunIsAi = gunnerIdRef.current === "ai";

      if (gunIsAi && aliens.current[0] && fireCd.current <= 0) {
        const t = aliens.current[0];
        // AI is backup, not a laser — miss often so diving ships stay dramatic for the driver.
        const miss = Math.random() < 0.42;
        const dx = t.x - muzzle.x + (miss ? (Math.random() - 0.5) * 8 : (Math.random() - 0.5) * 1.2);
        const dy = t.y - muzzle.y + (miss ? (Math.random() - 0.5) * 4 : 0);
        const dz = t.z - muzzle.z + (miss ? (Math.random() - 0.5) * 6 : 0);
        const len = Math.hypot(dx, dy, dz) || 1;
        bullets.current.push({
          id: nextId.current++,
          x: muzzle.x,
          y: muzzle.y,
          z: muzzle.z,
          dx: dx / len,
          dy: dy / len,
          dz: dz / len,
        });
        fireCd.current = 0.34;
        playSfx("fire");
      }

      if (!gunIsAi) {
        if (seatRef.current === "gunner") {
          gunYaw.current -= lookQ.current.x * 0.0032;
          gunPitch.current = Math.max(-0.4, Math.min(0.9, gunPitch.current - lookQ.current.y * 0.0028));
          lookQ.current.x *= 0.08;
          lookQ.current.y *= 0.08;
        }
        if (rin?.role === "gunner") {
          if (typeof rin.yaw === "number") gunYaw.current = rin.yaw;
          if (typeof rin.pitch === "number") gunPitch.current = rin.pitch;
          if (rin.fire) fireHeld.current = true;
        }
        if (fireHeld.current && fireCd.current <= 0) {
          const cy = Math.cos(gunYaw.current);
          const sy = Math.sin(gunYaw.current);
          const cp = Math.cos(gunPitch.current);
          const sp = Math.sin(gunPitch.current);
          const tip = muzzleWorld();
          bullets.current.push({
            id: nextId.current++,
            x: tip.x,
            y: tip.y,
            z: tip.z,
            dx: sy * cp,
            dy: sp,
            dz: cy * cp,
          });
          fireCd.current = 0.11 / Math.max(0.85, loadout.current.turretRate);
          shakeRef.current = Math.max(shakeRef.current, 0.18);
          playSfx("fire");
        }
      }

      if (!gunIsAi && seatRef.current === "gunner" && !isHost) {
        gunYaw.current -= lookQ.current.x * 0.0032;
        gunPitch.current = Math.max(-0.4, Math.min(0.9, gunPitch.current - lookQ.current.y * 0.0028));
        lookQ.current.x *= 0.08;
        lookQ.current.y *= 0.08;
        gunSendAcc.current += clamped;
        if (gunSendAcc.current > 0.05) {
          gunSendAcc.current = 0;
          emitMinigame(instanceId, "sky-escort", {
            type: "input",
            role: "gunner",
            yaw: gunYaw.current,
            pitch: gunPitch.current,
            fire: fireHeld.current,
          } satisfies InputMsg);
        }
      }

      for (const b of bullets.current) {
        b.x += b.dx * 72 * clamped;
        b.y += b.dy * 72 * clamped;
        b.z += b.dz * 72 * clamped;
      }
      for (const a of aliens.current) {
        const dist = Math.hypot(a.x - x.current, a.z - z.current);
        const diveMul = dist < 18 ? 1.55 : 1;
        a.x += (x.current - a.x) * 0.38 * diveMul * clamped;
        a.y += (1.6 - a.y) * 0.3 * diveMul * clamped;
        a.z += (z.current - a.z) * 0.48 * diveMul * clamped + 6.5 * clamped;
        for (const b of bullets.current) {
          if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1.75) {
            a.hp -= 1;
            b.z = 9999;
            addBlast(a.x, a.y, a.z);
            flashHit();
            playSfx("hit");
            shakeRef.current = Math.max(shakeRef.current, 0.35);
            if (a.hp <= 0) {
              streakT.current = 4.5;
              killStreak.current += 1;
              const mult = 1 + Math.min(4, Math.floor((killStreak.current - 1) / 3)) * 0.25;
              const pts = Math.round(120 * mult);
              addScore(pts, killStreak.current > 1 ? `${killStreak.current}x +${pts}` : `+${pts}`);
              playSfx("kill");
              shakeRef.current = Math.max(shakeRef.current, 0.75);
            }
          }
        }
        if (Math.hypot(a.x - x.current, a.z - z.current) < 1.9 && a.y < 2.6) {
          hurt(1);
          a.hp = 0;
          killStreak.current = 0;
          addBlast(x.current, y.current, z.current);
        }
      }
      streakT.current = Math.max(0, streakT.current - clamped);
      if (streakT.current <= 0) killStreak.current = 0;
      aliens.current = aliens.current.filter((a) => a.hp > 0 && a.z < z.current + 35);
      bullets.current = bullets.current.filter((b) => b.z > level.endZ - 30 && b.y > -6 && b.y < 50);

      invuln.current = Math.max(0, invuln.current - clamped);
      for (const bl of blasts.current) bl.age += clamped;
      blasts.current = blasts.current.filter((b) => b.age < 0.55);

      // Gate zone — near the winding finish, not a flat Z plane.
      const gate = pathAt(1);
      const gateDist = Math.hypot(gate.x - x.current, gate.z - z.current);
      if (!advancing.current && phaseRef.current === "run" && (gateDist < 10 || progress > 0.965)) {
        beginAdvance();
      }

      snapAcc.current += clamped;
      if (!instanceId.startsWith("local:") && phaseRef.current === "run" && snapAcc.current >= 1 / 15) {
        snapAcc.current = 0;
        emitMinigame(instanceId, "sky-escort", {
          type: "snap",
          phase: phaseRef.current,
          hull: hullRef.current,
          score: scoreRef.current,
          x: x.current,
          z: z.current,
          y: y.current,
          yaw: yaw.current,
          craters: craters.current.map((c) => ({ ...c })),
          meteors: meteors.current.map((m) => ({ ...m })),
          aliens: aliens.current.map((a) => ({ ...a })),
          blasts: blasts.current.map((b) => ({ ...b })),
          shake: shakeRef.current,
          driverId: driverIdRef.current,
          gunnerId: gunnerIdRef.current,
          levelId: level.id,
        } satisfies Snap);
      }
      remoteInput.current = null;
    }

    // Failsafe: solo / host-desync still advance when crossing the gate.
    if (
      !advancing.current &&
      phaseRef.current === "run" &&
      !pausedRef.current &&
      (solo || isHost)
    ) {
      const gate = pathAt(1);
      if (Math.hypot(gate.x - x.current, gate.z - z.current) < 10 || nearPath(x.current, z.current).pt.t > 0.965) {
        beginAdvance();
      }
    }

    if (phaseRef.current === "run" && !pausedRef.current && !isHost && seatRef.current === "gunner") {
      gunYaw.current -= lookQ.current.x * 0.0032;
      gunPitch.current = Math.max(-0.4, Math.min(0.9, gunPitch.current - lookQ.current.y * 0.0028));
      lookQ.current.x *= 0.08;
      lookQ.current.y *= 0.08;
    }

    if (hitFlashT.current > 0) {
      hitFlashT.current = Math.max(0, hitFlashT.current - clamped);
      if (hitFlashT.current <= 0 && hitFlash) setHitFlash(false);
    }

    shakeRef.current = Math.max(0, shakeRef.current - clamped * 1.8);
    fovKick.current = Math.max(0, fovKick.current - clamped * 1.4);

    if (buggy.current) {
      buggy.current.position.set(x.current, Math.max(y.current, -3), z.current);
      buggy.current.rotation.y = yaw.current;
      buggy.current.rotation.z = keys.current.steer * -0.14;
    }
    // World-space turret aim — independent of truck yaw (gunner free-look).
    if (gunMount.current) {
      let rel = gunYaw.current - yaw.current;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      gunMount.current.rotation.y = rel;
    }
    if (gunPitchMount.current) {
      gunPitchMount.current.rotation.x = -gunPitch.current;
      // Keep the world turret visible as a backup silhouette; FP viewmodel is the clear foreground.
      gunPitchMount.current.visible = true;
    }

    if (groundDirty.current || (groundMesh.current && groundMesh.current.geometry.attributes.position.count < 10)) {
      rebuildGroundSurface();
    }
    syncCraterMeshes();

    syncGroup(
      meteorGroup.current,
      meteors.current,
      (m, mesh) => {
        mesh.visible = m.y > -10;
        mesh.position.set(m.x, m.y, m.z);
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (loadout.current.radar) {
          mat.emissiveIntensity = 1.8 + Math.sin(performance.now() * 0.012 + m.id) * 0.4;
          mat.emissive.set("#ff6d00");
        } else {
          mat.emissiveIntensity = 0.55;
          mat.emissive.set("#ff6d00");
        }
      },
      () => new THREE.Mesh(new THREE.DodecahedronGeometry(0.55), mats.meteor.clone()),
    );

    syncGroup(
      alienGroup.current,
      aliens.current,
      (a, mesh) => {
        mesh.visible = true;
        mesh.position.set(a.x, a.y, a.z);
        mesh.rotation.y = performance.now() * 0.004 + a.id;
        mesh.rotation.x = Math.sin(performance.now() * 0.006 + a.id) * 0.35;
        const pulse = 1 + Math.sin(performance.now() * 0.01 + a.id) * 0.08;
        mesh.scale.set(1.15 * pulse, 0.85 * pulse, 1.45 * pulse);
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (loadout.current.radar) {
          mat.emissiveIntensity = 2.4 + Math.sin(performance.now() * 0.02 + a.id) * 0.6;
          mat.emissive.set("#ffab40");
        } else {
          mat.emissiveIntensity = 1.1;
          mat.emissive.set("#00e5ff");
        }
      },
      () =>
        new THREE.Mesh(
          new THREE.OctahedronGeometry(0.7, 0),
          new THREE.MeshStandardMaterial({
            color: "#7cfcff",
            emissive: "#00e5ff",
            emissiveIntensity: 1.6,
            metalness: 0.35,
            roughness: 0.35,
            flatShading: true,
          }),
        ),
    );

    syncGroup(
      bulletGroup.current,
      bullets.current,
      (b, mesh) => {
        mesh.visible = true;
        mesh.position.set(b.x, b.y, b.z);
      },
      () => new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), mats.bullet),
    );

    syncGroup(
      blastGroup.current,
      blasts.current,
      (b, mesh) => {
        mesh.visible = b.age < 0.55;
        mesh.position.set(b.x, b.y, b.z);
        mesh.scale.setScalar(0.4 + b.age * 6);
        (mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.75 - b.age * 1.4);
      },
      () => new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), mats.blast.clone()),
    );


    syncGroup(
      pickupGroup.current,
      pickups.current.filter((pk) => !pk.taken),
      (pk, mesh) => {
        mesh.visible = true;
        const bob = Math.sin(performance.now() * 0.005 + pk.id) * 0.22;
        mesh.position.set(pk.x, gy(pk.x, pk.z) + 1.15 + bob, pk.z);
        mesh.rotation.y += clamped * 2.2;
        const col = UPGRADE_COLOR[pk.kind];
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.color.set(col);
        mat.emissive.set(col);
        mat.emissiveIntensity = 1.8 + Math.sin(performance.now() * 0.01 + pk.id) * 0.5;
        mesh.scale.setScalar(1.15 + Math.sin(performance.now() * 0.008 + pk.id) * 0.08);
      },
      () =>
        new THREE.Mesh(
          new THREE.OctahedronGeometry(0.85),
          new THREE.MeshStandardMaterial({ color: "#ff7043", emissive: "#ff7043", emissiveIntensity: 1.8, metalness: 0.4, roughness: 0.25 }),
        ),
    );

    // Gate beacon + heading chevron — track the winding finish
    const gatePt = pathAt(1);
    if (gateBeacon.current) {
      gateBeacon.current.position.set(
        gatePt.x,
        gatePt.y + 4.5 + Math.sin(performance.now() * 0.003) * 0.35,
        gatePt.z,
      );
      gateBeacon.current.visible = phaseRef.current === "run" || phaseRef.current === "intro";
    }
    if (gateArch.current) {
      gateArch.current.position.set(gatePt.x, gatePt.y, gatePt.z);
      gateArch.current.rotation.y = gatePt.yaw;
      gateArch.current.visible = true;
    }
    if (headingArrow.current && phaseRef.current === "run") {
      const look = pathAt(Math.min(1, nearPath(x.current, z.current).pt.t + 0.06));
      const dx = look.x - x.current;
      const dz = look.z - z.current;
      const ang = Math.atan2(dx, dz);
      const dist = Math.hypot(gatePt.x - x.current, gatePt.z - z.current);
      const ahead = Math.min(14, Math.max(6, dist * 0.18));
      headingArrow.current.visible = dist > 12;
      headingArrow.current.position.set(
        x.current + Math.sin(ang) * ahead,
        y.current + 2.2,
        z.current + Math.cos(ang) * ahead,
      );
      headingArrow.current.rotation.set(0.35, ang, 0);
    } else if (headingArrow.current) {
      headingArrow.current.visible = false;
    }

    const sh = shakeRef.current;
    const ox = (Math.random() - 0.5) * sh;
    const oy = (Math.random() - 0.5) * sh;
    const persp = camera as THREE.PerspectiveCamera;

    // Level motion graphic: shared cinematic for BOTH seats (not turret POV).
    if (phaseRef.current === "intro" || phaseRef.current === "upgrade") {
      camera.layers.mask = 0xffffffff;
      if (fpGun.current) fpGun.current.visible = false;
      const tx = x.current - Math.sin(yaw.current) * 16;
      const ty = y.current + 9.5;
      const tz = z.current - Math.cos(yaw.current) * 16;
      camera.position.set(tx, ty, tz);
      camera.lookAt(x.current, y.current + 1.2, z.current - Math.cos(yaw.current) * 8);
      if (persp.isPerspectiveCamera) {
        persp.fov = 58;
        persp.updateProjectionMatrix();
      }
    } else if (seatRef.current === "gunner" && phaseRef.current === "run" && !pausedRef.current) {
      // Gunner free-look: cheek-weld behind the turret; aim is pure world yaw/pitch.
      const t = turretWorld();
      const cy = Math.cos(gunYaw.current);
      const sy = Math.sin(gunYaw.current);
      const cp = Math.cos(gunPitch.current);
      const sp = Math.sin(gunPitch.current);
      const dir = gunLookDir.current.set(sy * cp, sp, cy * cp);
      camera.position.set(
        t.x - dir.x * 0.45 + ox * 0.08,
        t.y + 0.42 + oy * 0.08,
        t.z - dir.z * 0.45,
      );
      camera.lookAt(
        camera.position.x + dir.x * 60,
        camera.position.y + dir.y * 60,
        camera.position.z + dir.z * 60,
      );
      // Layer 0 only (cab is on 1). Viewmodel is scene-synced onto this camera pose.
      camera.layers.set(0);
      if (persp.isPerspectiveCamera) {
        persp.fov = THREE.MathUtils.damp(persp.fov, hitFlash ? 72 : 65, 10, clamped);
        persp.near = 0.05;
        persp.updateProjectionMatrix();
      }
      if (fpGun.current) {
        // Place viewmodel in camera space without parenting (R3F-safe).
        camera.updateMatrixWorld();
        const offset = gunEyeLocal.current.set(0.06, -0.42, -0.55);
        offset.applyQuaternion(camera.quaternion);
        fpGun.current.visible = true;
        fpGun.current.position.copy(camera.position).add(offset);
        fpGun.current.quaternion.copy(camera.quaternion);
        fpGun.current.rotateX(0.06);
      }
    } else {
      camera.layers.mask = 0xffffffff;
      if (fpGun.current) fpGun.current.visible = false;
      if (persp.isPerspectiveCamera) {
        const boosting = boostTimer.current > 0 || fovKick.current > 0;
        const want = phaseRef.current === "ready" ? 58 : boosting ? 74 : 58;
        persp.fov = THREE.MathUtils.damp(persp.fov, want, 9, clamped);
        persp.near = 0.1;
        persp.updateProjectionMatrix();
      }
      const boostCam = boostTimer.current > 0 ? 0.85 : 1;
      const back = phaseRef.current === "ready" ? 15 : 10.5 * boostCam;
      const tx = x.current - Math.sin(yaw.current) * back;
      const ty = y.current + (phaseRef.current === "ready" ? 7.2 : 4.6 + (boostTimer.current > 0 ? 0.6 : 0));
      const tz = z.current - Math.cos(yaw.current) * back;
      if (phaseRef.current === "ready") {
        camera.position.set(tx, ty, tz);
        camera.lookAt(x.current + Math.sin(yaw.current) * 18, 0.8, z.current + Math.cos(yaw.current) * 18);
      } else {
        camera.position.x = THREE.MathUtils.damp(camera.position.x, tx + ox, 8, clamped);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, ty + oy, 8, clamped);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, tz, 8, clamped);
        camera.lookAt(x.current + Math.sin(yaw.current) * 14, 1.0, z.current + Math.cos(yaw.current) * 14);
      }
    }
  });

  return (
    <group>
      <color attach="background" args={["#140c08"]} />
      <fog attach="fog" args={["#1c100a", 28, 125]} />
      <ambientLight intensity={0.5} />
      <hemisphereLight args={["#ffcc80", "#1a1008", 0.7]} />
      <directionalLight
        position={[18, 32, 10]}
        intensity={1.35}
        color="#ffe0b2"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight position={[x.current, 10, z.current]} color="#ff6a00" intensity={28} distance={70} />

      {Array.from({ length: 30 }, (_, i) => (
        <mesh key={i} position={[(i % 8) * 7 - 24, 1.2 + (i % 5), -i * 3.4]}>
          <sphereGeometry args={[0.05, 4, 4]} />
          <meshBasicMaterial color="#ffab40" />
        </mesh>
      ))}

      <mesh position={[0, 2.2, level.startZ + 4]}>
        <boxGeometry args={[22, 5, 1.2]} />
        <meshStandardMaterial color="#3e2723" emissive={color} emissiveIntensity={0.2} />
      </mesh>
      {/* Finish arch follows the winding gate each frame */}
      <group ref={gateArch} position={[0, 1, level.endZ]}>
        <mesh position={[-7.5, 3.2, 0]} castShadow>
          <boxGeometry args={[1.2, 6.4, 1.2]} />
          <meshStandardMaterial color="#ffe082" emissive="#ffd54f" emissiveIntensity={1.1} />
        </mesh>
        <mesh position={[7.5, 3.2, 0]} castShadow>
          <boxGeometry args={[1.2, 6.4, 1.2]} />
          <meshStandardMaterial color="#ffe082" emissive="#ffd54f" emissiveIntensity={1.1} />
        </mesh>
        <mesh position={[0, 6.2, 0]} castShadow>
          <boxGeometry args={[16.2, 1.1, 1.2]} />
          <meshStandardMaterial color="#ffe082" emissive="#ffd54f" emissiveIntensity={1.25} />
        </mesh>
        <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[16, 10]} />
          <meshStandardMaterial color="#ffecb3" emissive="#ffd54f" emissiveIntensity={0.55} transparent opacity={0.85} />
        </mesh>
        <pointLight position={[0, 5, 0]} color="#ffe082" intensity={18} distance={28} />
      </group>
      <mesh ref={groundMesh} material={mats.ground} receiveShadow>
        <planeGeometry args={[10, 10, 1, 1]} />
      </mesh>
      <group ref={rampGroup} />
      <group ref={craterGroup} />
      <group ref={meteorGroup} />
      <group ref={alienGroup} />
      <group ref={bulletGroup} />
      <group ref={blastGroup} />
      <group ref={pickupGroup} />

      {/* Gate direction beacon — tall pulse so you always know where to drive */}
      <group ref={gateBeacon} position={[0, 6, level.endZ]}>
        <mesh>
          <cylinderGeometry args={[0.18, 0.35, 7, 8]} />
          <meshStandardMaterial color="#ffe082" emissive="#ffd54f" emissiveIntensity={1.6} transparent opacity={0.85} />
        </mesh>
        <mesh position={[0, 4.2, 0]}>
          <sphereGeometry args={[0.55, 12, 12]} />
          <meshStandardMaterial color="#fff8e1" emissive="#ffab40" emissiveIntensity={2.2} />
        </mesh>
        <pointLight color="#ffd54f" intensity={22} distance={36} />
      </group>

      {/* Floating chevron that points toward the gate */}
      <group ref={headingArrow} visible={false}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.7, 2.2, 3]} />
          <meshStandardMaterial color="#ffab40" emissive="#ff6d00" emissiveIntensity={1.5} />
        </mesh>
      </group>

      <group ref={buggy} position={[0, 0.85, level.startZ]} rotation={[0, Math.PI, 0]}>
        {/* Pickup truck: short low cab forward, open bed, ring turret aft */}
        {/* chassis rail */}
        <mesh position={[0, 0.32, -0.15]} castShadow>
          <boxGeometry args={[2.7, 0.42, 5.6]} />
          <meshStandardMaterial color="#1c1612" metalness={0.45} roughness={0.55} />
        </mesh>
        {/* Cab/hood on layer 1 — gunner camera only sees layer 0 so they never fill the frame */}
        <group ref={bindCabHide}>
          <mesh position={[0, 0.78, 1.55]} castShadow>
            <boxGeometry args={[2.35, 0.55, 1.55]} />
            <meshStandardMaterial color="#2a211a" metalness={0.4} roughness={0.5} />
          </mesh>
          <mesh position={[0, 1.15, 1.45]} castShadow>
            <boxGeometry args={[2.05, 0.55, 1.15]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.85} />
          </mesh>
          <mesh position={[0, 1.45, 1.4]}>
            <boxGeometry args={[1.85, 0.1, 1.0]} />
            <meshStandardMaterial color="#100c09" metalness={0.65} roughness={0.35} />
          </mesh>
          <mesh position={[0, 1.55, 1.85]}>
            <boxGeometry args={[1.9, 0.08, 0.12]} />
            <meshStandardMaterial color="#4e342e" metalness={0.5} />
          </mesh>
          <mesh position={[0, 1.05, 0.35]}>
            <boxGeometry args={[2.2, 0.85, 0.14]} />
            <meshStandardMaterial color="#241c16" metalness={0.45} />
          </mesh>
        </group>
        {/* open truck bed */}
        <mesh position={[0, 0.62, -1.15]} castShadow>
          <boxGeometry args={[2.45, 0.16, 2.85]} />
          <meshStandardMaterial color="#1a1410" metalness={0.55} roughness={0.6} />
        </mesh>
        {/* bed side rails — low, don't block gunner */}
        <mesh position={[-1.15, 0.95, -1.15]}>
          <boxGeometry args={[0.12, 0.55, 2.7]} />
          <meshStandardMaterial color="#3e2723" metalness={0.5} />
        </mesh>
        <mesh position={[1.15, 0.95, -1.15]}>
          <boxGeometry args={[0.12, 0.55, 2.7]} />
          <meshStandardMaterial color="#3e2723" metalness={0.5} />
        </mesh>
        <mesh position={[0, 0.95, -2.5]}>
          <boxGeometry args={[2.4, 0.5, 0.12]} />
          <meshStandardMaterial color="#3e2723" metalness={0.5} />
        </mesh>
        {[
          [-1.35, 0.12, 1.75],
          [1.35, 0.12, 1.75],
          [-1.35, 0.12, -1.85],
          [1.35, 0.12, -1.85],
        ].map((p, i) => (
          <mesh key={i} position={p as [number, number, number]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.58, 0.58, 0.45, 14]} />
            <meshStandardMaterial color="#0e0a08" roughness={0.95} />
          </mesh>
        ))}
        <mesh position={[0, 0.55, 2.35]}>
          <sphereGeometry args={[0.28, 12, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.6} />
        </mesh>
        <pointLight position={[0, 1.1, 2.1]} color={color} intensity={11} distance={15} />

        {/* bed ring + turret — pivot matches turretWorld (y≈1.65, z≈-2.45) */}
        <mesh position={[0, 0.78, -2.45]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.7, 1.05, 24]} />
          <meshStandardMaterial color="#5d4037" metalness={0.7} roughness={0.35} side={THREE.DoubleSide} />
        </mesh>
        <group ref={gunMount} position={[0, 1.65, -2.45]}>
          <mesh position={[0, -0.2, 0]}>
            <cylinderGeometry args={[0.48, 0.55, 0.35, 16]} />
            <meshStandardMaterial color="#3e2723" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, -0.55, 0]}>
            <cylinderGeometry args={[0.2, 0.32, 0.4, 8]} />
            <meshStandardMaterial color="#2c2118" metalness={0.5} />
          </mesh>
          <mesh position={[0, -0.7, -0.3]}>
            <boxGeometry args={[0.55, 0.12, 0.4]} />
            <meshStandardMaterial color="#1b1511" roughness={0.85} />
          </mesh>
          <group ref={gunPitchMount}>
            <mesh position={[0, 0.12, 0.28]}>
              <boxGeometry args={[0.95, 0.42, 0.08]} />
              <meshStandardMaterial color="#4e342e" metalness={0.55} roughness={0.45} />
            </mesh>
            <mesh position={[0, 0.08, 0.5]}>
              <boxGeometry args={[0.32, 0.26, 0.55]} />
              <meshStandardMaterial color="#efebe9" metalness={0.8} roughness={0.25} />
            </mesh>
            <mesh position={[0, 0.06, 1.35]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.08, 0.11, 1.7, 10]} />
              <meshStandardMaterial color="#d7ccc8" metalness={0.85} roughness={0.2} />
            </mesh>
            <mesh position={[0, 0.06, 2.2]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.13, 0.1, 0.2, 8]} />
              <meshStandardMaterial color="#ffab40" emissive="#ff6d00" emissiveIntensity={0.9} metalness={0.6} />
            </mesh>
            <mesh position={[-0.32, -0.08, 0.12]} rotation={[0.4, 0, 0.2]}>
              <cylinderGeometry args={[0.045, 0.045, 0.4, 6]} />
              <meshStandardMaterial color="#3e2723" />
            </mesh>
            <mesh position={[0.32, -0.08, 0.12]} rotation={[0.4, 0, -0.2]}>
              <cylinderGeometry args={[0.045, 0.045, 0.4, 6]} />
              <meshStandardMaterial color="#3e2723" />
            </mesh>
            <pointLight position={[0, 0.15, 1.0]} color="#ffab40" intensity={3.5} distance={7} />
          </group>
        </group>
      </group>

      <Html
        fullscreen
        zIndexRange={[100, 0]}
        style={{ pointerEvents: phase === "ready" || phase === "upgrade" || paused ? "auto" : "none" }}
      >
        <div className="sky-escort-hud">
          {phase === "intro" && introLevel && (
            <div className="sky-escort-intro" aria-live="polite">
              <div className="sky-escort-intro-scan" />
              <div className="sky-escort-intro-glow" />
              <p className="sky-escort-intro-kicker">Next sector</p>
              <p className="sky-escort-intro-num">LEVEL {introLevel.idx + 1}</p>
              <h2 className="sky-escort-intro-name">{introLevel.name}</h2>
              <p className="sky-escort-intro-sub">Sector locked — choose your upgrade next</p>
              <p className="sky-escort-intro-hint">Hold tight · Enter skips after lock</p>
              <div className="sky-escort-intro-bar">
                <span />
              </div>
            </div>
          )}
          {phase === "upgrade" && (
            <div className="sky-escort-upgrade" aria-live="polite">
              <p className="sky-escort-upgrade-kicker">Gate cleared</p>
              <h2 className="sky-escort-upgrade-title">PICK AN UPGRADE</h2>
              <p className="sky-escort-upgrade-sub">
                Level {introNextRef.current + 1} · {makeLevel(introNextRef.current).name}
              </p>
              <div className="sky-escort-upgrade-grid">
                {upgradeChoices.map((kind, i) => (
                  <button
                    key={`${kind}-${i}`}
                    type="button"
                    className="sky-escort-upgrade-card"
                    style={{ ["--up-color" as string]: UPGRADE_COLOR[kind] }}
                    onClick={() => chooseUpgrade(kind)}
                    disabled={!isHost && !solo}
                  >
                    <span className="sky-escort-upgrade-key">{i + 1}</span>
                    <strong>{UPGRADE_LABEL[kind]}</strong>
                    <em>{UPGRADE_BLURB[kind]}</em>
                  </button>
                ))}
              </div>
              <p className="sky-escort-upgrade-hint">
                {isHost || solo ? "Click a card or press 1 / 2 / 3" : "Waiting for host to pick…"}
              </p>
            </div>
          )}
          {paused && phase === "run" && (
            <div className="sky-escort-pause" aria-live="polite">
              <p className="sky-escort-pause-kicker">Paused</p>
              <h2 className="sky-escort-pause-title">HOLD UP</h2>
              <div className="sky-escort-pause-actions">
                <button type="button" className="primary" onClick={() => setPausedBoth(false)}>
                  Resume
                </button>
              </div>
              <p className="sky-escort-pause-hint">Esc / Space / Enter to resume</p>
            </div>
          )}
          {phase === "dead" && (
            <div className="sky-escort-dead" aria-live="assertive">
              <div className="sky-escort-dead-flash" />
              <div className="sky-escort-dead-vignette" />
              <p className="sky-escort-dead-kicker">Hull zero</p>
              <h2 className="sky-escort-dead-title">YOU&apos;RE DEAD</h2>
              <p className="sky-escort-dead-sub">Truck cooked — dive ship got you</p>
              <p className="sky-escort-dead-hint">Space / R / Enter to retry</p>
            </div>
          )}
          {phase === "run" && seat === "gunner" && (
            <div className={`sky-escort-crosshair${hitFlash ? " hit" : ""}`} aria-hidden>
              <span className="sky-escort-crosshair-ring" />
              <span className="sky-escort-crosshair-h" />
              <span className="sky-escort-crosshair-v" />
            </div>
          )}
          <div
            className="sky-escort-card"
            style={{ visibility: phase === "intro" || phase === "dead" || phase === "upgrade" || paused ? "hidden" : "visible" }}
          >
            <em>{level.name}</em>
            <strong>Sky Escort</strong>
            {phase === "ready" && (
              <>
                <p>
                  You’re the <b>{seat === "driver" ? "DRIVER" : "GUNNER"}</b>
                </p>
                <p className="sky-escort-hint">
                  {seat === "driver"
                    ? "Carve the winding road — bridge, corkscrew, upgrade pads — Shift-boost to the gate"
                    : "Free-look turret — mouse aims the sky, crosshair on dive-bombers"}
                </p>
                <div className="sky-escort-actions">
                  <button type="button" className={seat === "driver" ? "on" : ""} onClick={() => pickSeat("driver")}>
                    Driver
                  </button>
                  <button type="button" className={seat === "gunner" ? "on" : ""} onClick={() => pickSeat("gunner")}>
                    Gunner
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      if (!isHost) return;
                      const role = seatRef.current;
                      resetRun(role, levelIdxRef.current);
                      emitMinigame(instanceId, "sky-escort", {
                        type: "role",
                        driverId: role === "driver" ? selfId : "ai",
                        gunnerId:
                          role === "gunner" ? selfId : Object.values(players).find((pl) => pl.id !== selfId)?.id ?? "ai",
                        phase: "run",
                        levelId: activeLevel().id,
                      } satisfies RoleMsg);
                    }}
                  >
                    Roll out
                  </button>
                </div>
                <p className="sky-escort-hint">
                  Level {levelIdx + 1} · endless · Esc pauses · Space starts · Tab swaps seat
                </p>
              </>
            )}
            {phase === "run" && (
              <>
                <div className="sky-escort-loadout" aria-label="Loadout">
                  <span className={loadoutHud.boostCharges > 0 ? "on" : ""}>
                    BOOST {loadoutHud.boostCharges}/{loadoutHud.boostMax}
                  </span>
                  <span className={loadoutHud.armorBonus > 0 ? "on" : ""}>ARMOR {loadoutHud.armorBonus}</span>
                  <span className={loadoutHud.radar ? "on" : ""}>RADAR</span>
                  <span className={loadoutHud.turretRate > 1 ? "on" : ""}>
                    TURRET ×{loadoutHud.turretRate.toFixed(2)}
                  </span>
                </div>
                <p>
                  {seat === "driver" ? "DRIVER" : "GUNNER"} · {score} pts · hull {"♥".repeat(hull)}
                  {"♡".repeat(Math.max(0, level.hull + loadoutHud.armorBonus - hull))} · {hudDist}m
                </p>
                {clearBanner ? <p className="sky-escort-alert">{clearBanner}</p> : failCue ? <p className="sky-escort-alert">METEOR IMPACT</p> : null}
                <p className="sky-escort-hint">
                  {seat === "driver"
                    ? "WASD · Shift boost · Esc pause · stay on the ribbon"
                    : "Mouse free-look · hold fire · Esc pause · radar paints threats"}
                </p>
              </>
            )}
            {phase === "won" && (
              <p className="sky-escort-alert">
                {`Gate secured — deploying ${makeLevel(levelIdx + 1).name}`}
              </p>
            )}
          </div>
        </div>
      </Html>
    </group>
  );
}
