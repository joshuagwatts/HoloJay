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
    startZ: 22 + Math.min(soft, 10) * 1.5,
    endZ: -(70 + soft * 36),
    halfW: 46 + Math.min(soft, 14) * 2,
    tile: 5,
    hull: 3 + (soft >= 6 ? 1 : 0) + (soft >= 14 ? 1 : 0),
    driveSpeed: 15 + Math.min(soft, 16) * 0.48,
    turnRate: 2.2,
    // Level 0 already has pressure; denser each clear.
    meteorEvery: Math.max(0.28, 1.15 - soft * 0.045),
    alienEvery: Math.max(0.42, 1.85 - soft * 0.06),
  };
}

function levelIndexFromId(id: string | undefined): number {
  if (!id) return 0;
  const m = /^run-(\d+)$/.exec(id);
  if (m) return parseInt(m[1], 10);
  if (id === "ash-run") return 0;
  if (id === "glass-plain") return 1;
  return 0;
}

function terrainNoise(x: number, z: number): number {
  const s = Math.sin(x * 0.21 + z * 0.17) * 43758.5453;
  return s - Math.floor(s);
}

/** Ten elevation bands with blended slopes between shelves. */
const TERRACE_COUNT = 10;
const TERRACE_STEP = 0.55;

/** Continuous terrace field 0..COUNT (floors = shelves, fractions = slopes). */
function terraceFloat(x: number, z: number, startZ: number, endZ: number): number {
  const span = Math.max(1, startZ - endZ);
  const along = (startZ - z) / span; // 0 start → 1 gate
  const wave =
    Math.sin(z * 0.024) * 0.38 +
    Math.sin(x * 0.018 + z * 0.007) * 0.32 +
    Math.sin((x * 0.45 + z) * 0.015) * 0.22 +
    Math.sin(z * 0.011 - x * 0.009) * 0.12;
  const raw = Math.min(0.999, Math.max(0, 0.22 + along * 0.28 + wave * 0.55));
  return raw * (TERRACE_COUNT - 1);
}

/** Softstep blend so shelves stay flat and transitions become angled slopes. */
function terraceBlended(x: number, z: number, startZ: number, endZ: number): number {
  const f = terraceFloat(x, z, startZ, endZ);
  const base = Math.floor(f);
  const frac = f - base;
  // Flat shelf for ~55% of band; slope blend in the outer edges
  let blend: number;
  if (frac < 0.22) blend = 0;
  else if (frac > 0.78) blend = 1;
  else {
    const t = (frac - 0.22) / 0.56;
    blend = t * t * (3 - 2 * t);
  }
  return base + blend;
}

function terraceTop(elev: number): number {
  // Slab thickness base 0.5 + elev*step → top face Y
  return 0.5 + elev * TERRACE_STEP;
}

function sampleGroundH(x: number, z: number, startZ: number, endZ: number): number {
  return terraceBlended(x, z, startZ, endZ) * TERRACE_STEP;
}

type Role = "driver" | "gunner";
type Phase = "ready" | "run" | "intro" | "won" | "dead";

type Tile = {
  id: number;
  x: number;
  z: number;
  drop: number;
  gone: boolean;
  h: number;
  shade: number;
  pitch: number;
  roll: number;
  /** Finish pad — never craters; solid ground under the gate. */
  safe?: boolean;
};
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

type Snap = {
  type: "snap";
  phase: Phase;
  hull: number;
  score: number;
  x: number;
  z: number;
  y: number;
  yaw: number;
  tiles: Tile[];
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
  const { camera, gl } = useThree();
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
  const introT = useRef(0);
  const advancing = useRef(false);
  const loadout = useRef<Loadout>(DEFAULT_LOADOUT());
  const [loadoutHud, setLoadoutHud] = useState<Loadout>(DEFAULT_LOADOUT());
  const pickups = useRef<Pickup[]>([]);
  const boostTimer = useRef(0);
  const pickupGroup = useRef<THREE.Group>(null);
  const gateBeacon = useRef<THREE.Group>(null);
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

  const tiles = useRef<Tile[]>([]);
  const meteors = useRef<Meteor[]>([]);
  const aliens = useRef<Alien[]>([]);
  const bullets = useRef<Bullet[]>([]);
  const blasts = useRef<Blast[]>([]);

  const buggy = useRef<THREE.Group>(null);
  const gunMount = useRef<THREE.Group>(null);
  const gunPitchMount = useRef<THREE.Group>(null);
  /** First-person gun hardware locked to camera — always fills the gunner FOV. */
  const fpGun = useRef<THREE.Group>(null);
  const tileGroup = useRef<THREE.Group>(null);
  const meteorGroup = useRef<THREE.Group>(null);
  const alienGroup = useRef<THREE.Group>(null);
  const bulletGroup = useRef<THREE.Group>(null);
  const blastGroup = useRef<THREE.Group>(null);

  const mats = useMemo(
    () => ({
      dirt: [
        new THREE.MeshStandardMaterial({
          color: "#2a1e14",
          emissive: "#120c08",
          emissiveIntensity: 0.1,
          roughness: 1,
          flatShading: true,
        }),
        new THREE.MeshStandardMaterial({
          color: "#3a2a1c",
          emissive: "#1a1008",
          emissiveIntensity: 0.12,
          roughness: 0.98,
          flatShading: true,
        }),
        new THREE.MeshStandardMaterial({
          color: "#463522",
          emissive: "#1c140a",
          emissiveIntensity: 0.14,
          roughness: 0.96,
          flatShading: true,
        }),
        new THREE.MeshStandardMaterial({
          color: "#4a3824",
          emissive: "#1e160c",
          emissiveIntensity: 0.12,
          roughness: 0.95,
          flatShading: true,
        }),
        new THREE.MeshStandardMaterial({
          color: "#52402a",
          emissive: "#20180e",
          emissiveIntensity: 0.1,
          roughness: 0.94,
          flatShading: true,
        }),
        new THREE.MeshStandardMaterial({
          color: "#5a4830",
          emissive: "#221a10",
          emissiveIntensity: 0.08,
          roughness: 0.93,
          flatShading: true,
        }),
      ,
        new THREE.MeshStandardMaterial({
          color: "#624e34",
          emissive: "#241c12",
          emissiveIntensity: 0.08,
          roughness: 0.92,
          flatShading: true,
        }),
        new THREE.MeshStandardMaterial({
          color: "#6a563c",
          emissive: "#261e14",
          emissiveIntensity: 0.07,
          roughness: 0.91,
          flatShading: true,
        }),
        new THREE.MeshStandardMaterial({
          color: "#725e44",
          emissive: "#282016",
          emissiveIntensity: 0.06,
          roughness: 0.9,
          flatShading: true,
        }),
        new THREE.MeshStandardMaterial({
          color: "#7a664c",
          emissive: "#2a2218",
          emissiveIntensity: 0.05,
          roughness: 0.89,
          flatShading: true,
        }),
],
      rock: new THREE.MeshStandardMaterial({
        color: "#4a4036",
        emissive: "#1a1612",
        emissiveIntensity: 0.08,
        roughness: 0.92,
        flatShading: true,
      }),
      finish: new THREE.MeshStandardMaterial({
        color: "#c9a227",
        emissive: "#ffd54f",
        emissiveIntensity: 0.75,
        roughness: 0.7,
        flatShading: true,
      }),
      dirtHot: new THREE.MeshStandardMaterial({
        color: "#6a3010",
        emissive: color,
        emissiveIntensity: 0.85,
        roughness: 0.7,
        flatShading: true,
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
      tiles: tiles.current.map((t) => ({ ...t })),
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
    invuln.current = 1.05;
    shakeRef.current = Math.max(shakeRef.current, 0.55);
    addBlast(x.current, y.current + 0.4, z.current);
    if (hullRef.current <= 0) {
      setPhaseBoth("dead");
      // Snaps only run during "run" — push one last death snap so gunner/clients see it.
      broadcastSnap();
    }
  }

  /** Bed-turret pivot — rear of open truck bed, above the rails. */
  function turretWorld() {
    const back = 2.35;
    const ox = Math.sin(yaw.current) * -back;
    const oz = Math.cos(yaw.current) * -back;
    return { x: x.current + ox, y: y.current + 1.85, z: z.current + oz };
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
  function muzzleWorld() {
    const t = turretWorld();
    const aimYaw = yaw.current + gunYaw.current;
    const cy = Math.cos(aimYaw);
    const sy = Math.sin(aimYaw);
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

  
  function spawnPickups(L: LevelDef) {
    const list: Pickup[] = [];
    // Sparse boost pads along the route — infrastructure for richer upgrades later.
    const pads = 2 + Math.min(3, Math.floor(levelIdxRef.current / 2));
    for (let i = 0; i < pads; i++) {
      const tAlong = 0.25 + (i / Math.max(1, pads)) * 0.55;
      const zz = L.startZ + (L.endZ - L.startZ) * tAlong;
      const xx = ((i % 2 === 0 ? 1 : -1) * (8 + (i % 3) * 5));
      const h = sampleGroundH(xx, zz, L.startZ, L.endZ);
      list.push({
        id: nextId.current++,
        kind: i === 0 && levelIdxRef.current > 0 ? (["boost", "armor", "radar", "turret"] as UpgradeId[])[levelIdxRef.current % 4] : "boost",
        x: xx,
        y: terraceTop(h / TERRACE_STEP) + 0.6,
        z: zz,
        taken: false,
      });
    }
    pickups.current = list;
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
      L.turretRate = Math.min(1.75, L.turretRate + 0.25);
    }
    setLoadoutHud({ ...L });
    setClearBanner(UPGRADE_LABEL[kind]);
    clearBannerT.current = 1.6;
  }

  function tryBoost() {
    if (phaseRef.current !== "run" || seatRef.current !== "driver") return;
    if (boostTimer.current > 0) return;
    if (loadout.current.boostCharges <= 0) return;
    loadout.current.boostCharges -= 1;
    boostTimer.current = 1.1;
    setLoadoutHud({ ...loadout.current });
    setClearBanner("BOOST");
    clearBannerT.current = 0.9;
  }

function buildTerrain() {
    const L = activeLevel();
    const list: Tile[] = [];
    let id = 1;
    const x0 = -Math.ceil(L.halfW / L.tile) * L.tile;
    const x1 = Math.ceil(L.halfW / L.tile) * L.tile;
    const z0 = Math.ceil((L.startZ + L.tile) / L.tile) * L.tile;
    const z1 = Math.floor((L.endZ - L.tile * 4) / L.tile) * L.tile;
    for (let zz = z0; zz >= z1; zz -= L.tile) {
      for (let xx = x0; xx <= x1; xx += L.tile) {
        const finish =
          zz <= L.endZ + L.tile * 1.5 && zz >= L.endZ - L.tile * 2.5 && Math.abs(xx) <= L.tile * 3;
        const nearStart = zz >= L.startZ - L.tile * 2;
        let elev = terraceBlended(xx, zz, L.startZ, L.endZ);
        if (finish || nearStart) elev = Math.min(elev, 1.05);
        const h = elev * TERRACE_STEP;
        // Slope from neighbor heights (angled ramps between shelves).
        const hn = sampleGroundH(xx, zz - L.tile, L.startZ, L.endZ);
        const hs = sampleGroundH(xx, zz + L.tile, L.startZ, L.endZ);
        const he = sampleGroundH(xx + L.tile, zz, L.startZ, L.endZ);
        const hw = sampleGroundH(xx - L.tile, zz, L.startZ, L.endZ);
        const pitch = finish || nearStart ? 0 : Math.atan2(hs - hn, L.tile * 2);
        const roll = finish || nearStart ? 0 : Math.atan2(hw - he, L.tile * 2);
        const shade = finish ? 0 : Math.min(TERRACE_COUNT - 1, Math.round(elev));
        list.push({ id: id++, x: xx, z: zz, drop: 0, gone: false, h, shade, pitch, roll, safe: finish });
      }
    }
    tiles.current = list;
    spawnPickups(L);
  }

  function snapSeatCam(role: Role) {
    if (role === "gunner") {
      gunYaw.current = 0;
      gunPitch.current = 0.12;
      const t = turretWorld();
      const eyeUp = 0.55;
      camera.position.set(t.x, t.y + eyeUp, t.z + 0.35);
      camera.lookAt(
        x.current + Math.sin(yaw.current) * 28,
        t.y + eyeUp + 2.5,
        z.current + Math.cos(yaw.current) * 28,
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


  function beginAdvance() {
    if (advancing.current || phaseRef.current !== "run") return;
    advancing.current = true;
    const next = levelIdxRef.current + 1;
    const nextL = makeLevel(next);
    // Freeze on the pad
    speed.current = 0;
    falling.current = false;
    keys.current = { throttle: 0, steer: 0 };
    z.current = Math.min(z.current, activeLevel().endZ);
    introT.current = 3.4;
    introNextRef.current = next;
    setIntroLevel({ idx: next, name: nextL.name });
    addScore(hullRef.current * 50 + 200, `GATE +${hullRef.current * 50 + 200}`);
    setPhaseBoth("intro");
    emitMinigame(instanceId, "sky-escort", {
      type: "role",
      driverId: driverIdRef.current,
      gunnerId: gunnerIdRef.current,
      phase: "intro",
      levelId: nextL.id,
    } satisfies RoleMsg);
  }

  function finishIntro() {
    const next = introNextRef.current;
    const role = seatRef.current;
    setIntroLevel(null);
    introT.current = 0;
    advancing.current = false;
    resetRun(role, next);
    emitMinigame(instanceId, "sky-escort", {
      type: "role",
      driverId: driverIdRef.current,
      gunnerId: gunnerIdRef.current,
      phase: "run",
      levelId: makeLevel(next).id,
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
    x.current = 0;
    z.current = L.startZ;
    y.current = terraceTop(1);
    yaw.current = Math.PI;
    speed.current = 0;
    falling.current = false;
    invuln.current = 0;
    hullRef.current = L.hull;
    setHull(L.hull);
    // Fresh attempt from ready / death resets score; level clears keep it.
    if (nextLevelIdx === 0 || phaseRef.current === "dead" || phaseRef.current === "ready") {
      if (phaseRef.current !== "intro") {
        scoreRef.current = 0;
        setScore(0);
        killStreak.current = 0;
      }
    }
    keys.current = { throttle: 0, steer: 0 };
    meteors.current = [];
    aliens.current = [];
    bullets.current = [];
    blasts.current = [];
    meteorAcc.current = -0.35;
    alienAcc.current = -0.8;
    boostTimer.current = 0;
    // Keep upgrades across levels; top off one boost charge each clear.
    loadout.current.boostCharges = Math.min(loadout.current.boostMax, loadout.current.boostCharges + 1);
    setLoadoutHud({ ...loadout.current });
    buildTerrain();
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
      camera.updateProjectionMatrix();
    };
  }, [camera]);

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
        e.preventDefault();
        finishIntro();
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
      if (phaseRef.current !== "run" || seatRef.current !== "gunner") return;
      lookQ.current.x += e.movementX;
      lookQ.current.y += e.movementY;
    };
    const onDown = () => {
      if (phaseRef.current !== "run" || seatRef.current !== "gunner") return;
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
          introT.current = 3.4;
          advancing.current = true;
          setPhaseBoth("intro");
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
        tiles.current = data.tiles.map((t) => ({
          ...t,
          h: t.h ?? 0.35,
          shade: t.shade ?? 0,
          safe: t.safe ?? false,
        }));
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
    const progress = Math.min(1, Math.max(0, (level.startZ - z.current) / (level.startZ - level.endZ)));
    hudAcc.current += clamped;
    if (hudAcc.current > 0.12) {
      hudAcc.current = 0;
      setHudDist(Math.max(0, Math.floor(z.current - level.endZ)));
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
      if (introT.current <= 0) finishIntro();
    }

    if (phaseRef.current === "run" && seatRef.current === "driver" && !isHost) {
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

    if (phaseRef.current === "run" && isHost) {
      let throttle = keys.current.throttle;
      let steer = keys.current.steer;
      const rin = remoteInput.current;
      if (driverIdRef.current !== selfId && rin?.role === "driver") {
        if (typeof rin.throttle === "number") throttle = rin.throttle;
        if (typeof rin.steer === "number") steer = rin.steer;
      }

      if (driverIdRef.current === "ai") {
        throttle = 0.9;
        const threat = meteors.current.find(
          (m) => m.z < z.current + 12 && m.z > z.current - 2 && Math.abs(m.x - x.current) < 5,
        );
        if (threat) steer = threat.x > x.current ? 1 : -1;
        else steer = x.current > 4 ? 0.4 : x.current < -4 ? -0.4 : 0;
      }

      if (!falling.current) {
        yaw.current += steer * level.turnRate * clamped * (0.55 + Math.min(1, Math.abs(speed.current) / 12));
        if (boostTimer.current > 0) boostTimer.current = Math.max(0, boostTimer.current - clamped);
        const boostMul = boostTimer.current > 0 ? 1.38 : 1;
        const target =
          throttle === 0
            ? 0
            : throttle * level.driveSpeed * boostMul * (0.88 + progress * 0.28);
        speed.current = THREE.MathUtils.damp(speed.current, target, throttle === 0 ? 2.8 : 7.2, clamped);
        const v = speed.current;
        x.current += Math.sin(yaw.current) * v * clamped;
        z.current += Math.cos(yaw.current) * v * clamped;
        x.current = THREE.MathUtils.clamp(x.current, -level.halfW + 2.5, level.halfW - 2.5);
      }

      // Terrain only blows when meteors land — no random collapse.
      for (const t of tiles.current) {
        if (t.gone) continue;
        if (t.drop > 0) {
          t.drop += clamped * (2.1 + progress * 2.4);
          if (t.drop > 9) t.gone = true;
        }
      }

      const under = tiles.current.find(
        (t) =>
          !t.gone &&
          Math.abs(t.x - x.current) < level.tile * 0.55 &&
          Math.abs(t.z - z.current) < level.tile * 0.55,
      );
      if (!under || under.drop > 1.35) falling.current = true;
      if (falling.current) {
        y.current -= 14 * clamped;
        if (y.current < -4) {
          falling.current = false;
          hurt(1);
          const solid = tiles.current.find((t) => !t.gone && t.drop < 0.2 && Math.abs(t.z - z.current) < 16);
          if (solid) {
            x.current = solid.x;
            z.current = solid.z;
            y.current = terraceTop(Math.round((solid.h ?? 0) / TERRACE_STEP));
          } else {
            y.current = terraceTop(1);
          }
        }
      } else {
        const elev = under ? (under.h ?? 0) / TERRACE_STEP : 1;
        const targetY = under ? terraceTop(elev) + Math.tan(under.pitch ?? 0) * 0.15 : terraceTop(1);
        y.current = THREE.MathUtils.damp(y.current, targetY, 14, clamped);
        if (under && buggy.current && !falling.current) {
          buggy.current.rotation.x = THREE.MathUtils.damp(buggy.current.rotation.x, under.pitch ?? 0, 9, clamped);
        }
      }

      
      // Pickup pads (boost / upgrade scaffolding)
      for (const pk of pickups.current) {
        if (pk.taken) continue;
        if (Math.hypot(pk.x - x.current, pk.z - z.current) < 2.2) {
          pk.taken = true;
          applyPickup(pk.kind);
          addBlast(pk.x, pk.y, pk.z);
        }
      }

      meteorAcc.current += clamped;
      const meteorEvery = Math.max(0.28, level.meteorEvery - progress * Math.min(0.45, 0.2 + levelIdxRef.current * 0.03));
      if (meteorAcc.current >= meteorEvery) {
        meteorAcc.current = 0;
        meteors.current.push({
          id: nextId.current++,
          x: x.current + (Math.random() - 0.5) * level.halfW * 1.6,
          y: 15 + Math.random() * 10,
          z: z.current - 8 - Math.random() * 48,
          vx: (Math.random() - 0.5) * 4,
          vy: -15 - progress * 12,
          vz: 2 + Math.random() * 5,
        });
      }
      for (const m of meteors.current) {
        m.x += m.vx * clamped;
        m.y += m.vy * clamped;
        m.z += m.vz * clamped;
        if (m.y < 0.3) {
          addBlast(m.x, 0.45, m.z);
          shakeRef.current = Math.max(shakeRef.current, 0.55);
          failCueT.current = 1.4;
          setFailCue(true);
          // Crater: impact tile + neighbors
          const craterR = level.tile * 1.15;
          for (const t of tiles.current) {
            if (t.gone || t.drop > 0 || t.safe) continue;
            if (Math.hypot(t.x - m.x, t.z - m.z) < craterR) t.drop = 0.01;
          }
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
      if (alienAcc.current >= Math.max(0.45, level.alienEvery - progress * 0.7)) {
        alienAcc.current = 0;
        aliens.current.push({
          id: nextId.current++,
          x: x.current + (Math.random() - 0.5) * level.halfW * 1.2,
          y: 6 + Math.random() * 9,
          z: z.current - 20 - Math.random() * 50,
          hp: 2,
        });
      }

      const muzzle = muzzleWorld();
      fireCd.current = Math.max(0, fireCd.current - clamped);
      const gunIsAi = gunnerIdRef.current === "ai";

      if (gunIsAi && aliens.current[0] && fireCd.current <= 0) {
        const t = aliens.current[0];
        const dx = t.x - muzzle.x;
        const dy = t.y - muzzle.y;
        const dz = t.z - muzzle.z;
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
        fireCd.current = 0.26;
      }

      if (!gunIsAi) {
        if (seatRef.current === "gunner") {
          gunYaw.current -= lookQ.current.x * 0.0024;
          gunPitch.current = Math.max(-0.35, Math.min(0.85, gunPitch.current - lookQ.current.y * 0.002));
          lookQ.current.x *= 0.2;
          lookQ.current.y *= 0.2;
        }
        if (rin?.role === "gunner") {
          if (typeof rin.yaw === "number") gunYaw.current = rin.yaw;
          if (typeof rin.pitch === "number") gunPitch.current = rin.pitch;
          if (rin.fire) fireHeld.current = true;
        }
        if (fireHeld.current && fireCd.current <= 0) {
          const aimYaw = yaw.current + gunYaw.current;
          const cy = Math.cos(aimYaw);
          const sy = Math.sin(aimYaw);
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
          fireCd.current = 0.14 / Math.max(0.85, loadout.current.turretRate);
        }
      }

      if (!gunIsAi && seatRef.current === "gunner" && !isHost) {
        gunYaw.current -= lookQ.current.x * 0.0024;
        gunPitch.current = Math.max(-0.35, Math.min(0.85, gunPitch.current - lookQ.current.y * 0.002));
        lookQ.current.x *= 0.2;
        lookQ.current.y *= 0.2;
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
        b.x += b.dx * 60 * clamped;
        b.y += b.dy * 60 * clamped;
        b.z += b.dz * 60 * clamped;
      }
      for (const a of aliens.current) {
        a.x += (x.current - a.x) * 0.32 * clamped;
        a.y += (1.8 - a.y) * 0.24 * clamped;
        a.z += (z.current - a.z) * 0.42 * clamped + 5 * clamped;
        for (const b of bullets.current) {
          if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1.4) {
            a.hp -= 1;
            b.z = 9999;
            addBlast(a.x, a.y, a.z);
            if (a.hp <= 0) {
              streakT.current = 4;
              killStreak.current += 1;
              const mult = 1 + Math.min(4, Math.floor((killStreak.current - 1) / 3)) * 0.25;
              const pts = Math.round(100 * mult);
              addScore(pts, killStreak.current > 1 ? `${killStreak.current}x +${pts}` : `+${pts}`);
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

      // Gate zone — generous trigger, then motion-graphic intro (auto, no Space).
      const gateReach = level.endZ + level.tile * 2.5;
      if (!advancing.current && phaseRef.current === "run" && z.current <= gateReach) {
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
          tiles: tiles.current.map((t) => ({ ...t })),
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
      (solo || isHost) &&
      z.current <= activeLevel().endZ + activeLevel().tile * 2.5
    ) {
      beginAdvance();
    }

    if (phaseRef.current === "run" && !isHost && seatRef.current === "gunner") {
      gunYaw.current -= lookQ.current.x * 0.0024;
      gunPitch.current = Math.max(-0.35, Math.min(0.85, gunPitch.current - lookQ.current.y * 0.002));
      lookQ.current.x *= 0.2;
      lookQ.current.y *= 0.2;
    }

    shakeRef.current = Math.max(0, shakeRef.current - clamped * 1.5);

    if (buggy.current) {
      buggy.current.position.set(x.current, Math.max(y.current, -3), z.current);
      buggy.current.rotation.y = yaw.current;
      buggy.current.rotation.z = keys.current.steer * -0.06;
    }
    if (gunMount.current) gunMount.current.rotation.y = gunYaw.current;
    if (gunPitchMount.current) {
      gunPitchMount.current.rotation.x = -gunPitch.current;
      // Local gunner uses the camera-locked FP gun — hide world barrel to avoid double mesh.
      gunPitchMount.current.visible = !(seatRef.current === "gunner" && phaseRef.current !== "ready");
    }

    syncGroup(
      tileGroup.current,
      tiles.current,
      (t, mesh) => {
        mesh.visible = !t.gone;
        const elev = (t.h ?? 0) / TERRACE_STEP;
        const elevRound = Math.min(TERRACE_COUNT - 1, Math.max(0, Math.round(elev)));
        const thick = terraceTop(elev); // continuous height incl. slope blend
        mesh.scale.set(level.tile * 1.01, Math.max(0.45, thick), level.tile * 1.01);
        mesh.position.set(t.x, Math.max(0.45, thick) * 0.5 - t.drop, t.z);
        // Angled slopes between terrace shelves
        mesh.rotation.x = t.drop > 0 ? t.drop * 0.02 : (t.pitch ?? 0);
        mesh.rotation.z = t.drop > 0 ? t.drop * 0.04 * Math.sign(t.x || 1) : (t.roll ?? 0);
        if (t.drop > 0) mesh.material = mats.dirtHot;
        else if (t.safe) mesh.material = mats.finish;
        else if (elevRound >= TERRACE_COUNT - 2) mesh.material = mats.rock;
        else mesh.material = mats.dirt[elevRound % mats.dirt.length]!;
      },
      () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats.dirt[0]!),
    );

    syncGroup(
      meteorGroup.current,
      meteors.current,
      (m, mesh) => {
        mesh.visible = m.y > -10;
        mesh.position.set(m.x, m.y, m.z);
      },
      () => new THREE.Mesh(new THREE.DodecahedronGeometry(0.55), mats.meteor),
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
        mesh.position.set(pk.x, pk.y + Math.sin(performance.now() * 0.004 + pk.id) * 0.15, pk.z);
        mesh.rotation.y += clamped * 1.8;
      },
      () => {
        const m = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.55),
          new THREE.MeshStandardMaterial({ color: "#80d8ff", emissive: "#40c4ff", emissiveIntensity: 1.4 }),
        );
        return m;
      },
    );

    // Gate beacon + heading chevron — always show where to drive
    if (gateBeacon.current) {
      const gh = terraceTop(sampleGroundH(0, level.endZ, level.startZ, level.endZ) / TERRACE_STEP);
      gateBeacon.current.position.set(0, gh + 4.5 + Math.sin(performance.now() * 0.003) * 0.35, level.endZ);
      gateBeacon.current.visible = phaseRef.current === "run" || phaseRef.current === "intro";
    }
    if (headingArrow.current && phaseRef.current === "run") {
      const dx = 0 - x.current;
      const dz = level.endZ - z.current;
      const ang = Math.atan2(dx, dz);
      const dist = Math.hypot(dx, dz);
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
    const gunnerLive = seatRef.current === "gunner" && phaseRef.current !== "ready";
    if (gunnerLive) {
      // Standing in the truck bed behind the ring — clear sightlines over the low cab.
      const t = turretWorld();
      const aimYaw = yaw.current + gunYaw.current;
      const cy = Math.cos(aimYaw);
      const sy = Math.sin(aimYaw);
      const cp = Math.cos(gunPitch.current);
      const sp = Math.sin(gunPitch.current);
      const eyeBack = 0.62;
      const eyeUp = 0.55;
      camera.position.set(
        t.x - sy * eyeBack + ox * 0.12,
        t.y + eyeUp + oy * 0.12,
        t.z - cy * eyeBack,
      );
      camera.lookAt(t.x + sy * cp * 42, t.y + eyeUp + sp * 42, t.z + cy * cp * 42);
      if (persp.isPerspectiveCamera) {
        persp.fov = 62;
        persp.updateProjectionMatrix();
      }
      if (fpGun.current) {
        if (fpGun.current.parent !== camera) camera.add(fpGun.current);
        fpGun.current.visible = true;
        fpGun.current.position.set(0, -0.52, -0.82);
        fpGun.current.rotation.set(0, 0, 0);
      }
    } else {
      if (fpGun.current) {
        fpGun.current.visible = false;
        if (fpGun.current.parent === camera) camera.remove(fpGun.current);
      }
      if (persp.isPerspectiveCamera && persp.fov !== 60) {
        persp.fov = 60;
        persp.updateProjectionMatrix();
      }
      const back = phaseRef.current === "ready" ? 15 : 12;
      const tx = x.current - Math.sin(yaw.current) * back;
      const ty = y.current + (phaseRef.current === "ready" ? 7.2 : 5.4);
      const tz = z.current - Math.cos(yaw.current) * back;
      if (phaseRef.current === "ready") {
        camera.position.set(tx, ty, tz);
        camera.lookAt(x.current + Math.sin(yaw.current) * 18, 0.8, z.current + Math.cos(yaw.current) * 18);
      } else {
        camera.position.x = THREE.MathUtils.damp(camera.position.x, tx + ox, 7, clamped);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, ty + oy, 7, clamped);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, tz, 7, clamped);
        camera.lookAt(x.current + Math.sin(yaw.current) * 12, 1.0, z.current + Math.cos(yaw.current) * 12);
      }
    }
  });

  return (
    <group>
      <color attach="background" args={["#1a0e0a"]} />
      <fog attach="fog" args={["#1a0e0a", 48, 175]} />
      <ambientLight intensity={0.42} />
      <hemisphereLight args={["#ffcc80", "#2a1810", 0.55]} />
      <directionalLight
        position={[14, 28, 8]}
        intensity={1.15}
        color="#ffe0b2"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight position={[x.current, 8, z.current]} color="#ff6a00" intensity={22} distance={60} />

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
      {/* Drive-through finish arch + lit pad (not a solid wall you clip into). */}
      <mesh position={[-7.5, 3.2, level.endZ]} castShadow>
        <boxGeometry args={[1.2, 6.4, 1.2]} />
        <meshStandardMaterial color="#ffe082" emissive="#ffd54f" emissiveIntensity={1.1} />
      </mesh>
      <mesh position={[7.5, 3.2, level.endZ]} castShadow>
        <boxGeometry args={[1.2, 6.4, 1.2]} />
        <meshStandardMaterial color="#ffe082" emissive="#ffd54f" emissiveIntensity={1.1} />
      </mesh>
      <mesh position={[0, 6.2, level.endZ]} castShadow>
        <boxGeometry args={[16.2, 1.1, 1.2]} />
        <meshStandardMaterial color="#ffe082" emissive="#ffd54f" emissiveIntensity={1.25} />
      </mesh>
      <mesh position={[0, 0.08, level.endZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[16, 10]} />
        <meshStandardMaterial color="#ffecb3" emissive="#ffd54f" emissiveIntensity={0.55} transparent opacity={0.85} />
      </mesh>
      <pointLight position={[0, 5, level.endZ]} color="#ffe082" intensity={18} distance={28} />

      <group ref={tileGroup} />
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
        {/* low cab — short so bed gunner sees over it */}
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
        {/* windshield lip only — no roll-cage roof */}
        <mesh position={[0, 1.55, 1.85]}>
          <boxGeometry args={[1.9, 0.08, 0.12]} />
          <meshStandardMaterial color="#4e342e" metalness={0.5} />
        </mesh>
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
        {/* cab bulkhead between cab and bed */}
        <mesh position={[0, 1.05, 0.35]}>
          <boxGeometry args={[2.2, 0.85, 0.14]} />
          <meshStandardMaterial color="#241c16" metalness={0.45} />
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

        {/* bed ring + turret — high enough to clear the low cab */}
        <mesh position={[0, 0.78, -2.35]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.7, 1.05, 24]} />
          <meshStandardMaterial color="#5d4037" metalness={0.7} roughness={0.35} side={THREE.DoubleSide} />
        </mesh>
        <group ref={gunMount} position={[0, 1.85, -2.35]}>
          <mesh position={[0, -0.2, 0]}>
            <cylinderGeometry args={[0.48, 0.55, 0.32, 16]} />
            <meshStandardMaterial color="#3e2723" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, -0.55, -0.35]}>
            <boxGeometry args={[0.55, 0.14, 0.45]} />
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

      {/* FP turret — attached to camera while gunning so the seat always feels usable */}
      <group ref={fpGun} visible={false}>
        {/* low side cheeks — frame, don't block */}
        <mesh position={[-0.7, -0.18, 0.1]}>
          <boxGeometry args={[0.28, 0.42, 0.5]} />
          <meshStandardMaterial color="#3e2723" metalness={0.55} roughness={0.45} />
        </mesh>
        <mesh position={[0.7, -0.18, 0.1]}>
          <boxGeometry args={[0.28, 0.42, 0.5]} />
          <meshStandardMaterial color="#3e2723" metalness={0.55} roughness={0.45} />
        </mesh>
        {/* wide gun shield with tall sight notch */}
        <mesh position={[-0.36, -0.08, -0.08]}>
          <boxGeometry args={[0.48, 0.32, 0.06]} />
          <meshStandardMaterial color="#5d4037" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0.36, -0.08, -0.08]}>
          <boxGeometry args={[0.48, 0.32, 0.06]} />
          <meshStandardMaterial color="#5d4037" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.12, -0.06]}>
          <boxGeometry args={[0.28, 0.1, 0.05]} />
          <meshStandardMaterial color="#6d4c41" metalness={0.55} />
        </mesh>
        {/* iron sight post */}
        <mesh position={[0, 0.02, -0.2]}>
          <boxGeometry args={[0.035, 0.08, 0.035]} />
          <meshStandardMaterial color="#ffab40" emissive="#ff6d00" emissiveIntensity={1.1} />
        </mesh>
        {/* receiver */}
        <mesh position={[0, -0.14, 0.02]}>
          <boxGeometry args={[0.26, 0.2, 0.42]} />
          <meshStandardMaterial color="#efebe9" metalness={0.8} roughness={0.25} />
        </mesh>
        {/* barrel — camera looks down -Z */}
        <mesh position={[0, -0.12, -0.85]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.048, 0.065, 1.45, 10]} />
          <meshStandardMaterial color="#d7ccc8" metalness={0.85} roughness={0.2} />
        </mesh>
        <mesh position={[0, -0.12, -1.58]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.085, 0.065, 0.16, 8]} />
          <meshStandardMaterial color="#ffab40" emissive="#ff6d00" emissiveIntensity={1.2} metalness={0.6} />
        </mesh>
        {/* grips */}
        <mesh position={[-0.2, -0.28, 0.12]} rotation={[0.55, 0, 0.25]}>
          <cylinderGeometry args={[0.032, 0.032, 0.28, 6]} />
          <meshStandardMaterial color="#3e2723" />
        </mesh>
        <mesh position={[0.2, -0.28, 0.12]} rotation={[0.55, 0, -0.25]}>
          <cylinderGeometry args={[0.032, 0.032, 0.28, 6]} />
          <meshStandardMaterial color="#3e2723" />
        </mesh>
        <pointLight position={[0, -0.05, -0.5]} color="#ffab40" intensity={3} distance={3.5} />
      </group>

      <Html fullscreen zIndexRange={[100, 0]} style={{ pointerEvents: phase === "ready" ? "auto" : "none" }}>
        <div className="sky-escort-hud">
          {phase === "intro" && introLevel && (
            <div className="sky-escort-intro" aria-live="polite">
              <div className="sky-escort-intro-scan" />
              <div className="sky-escort-intro-glow" />
              <p className="sky-escort-intro-kicker">Next sector</p>
              <p className="sky-escort-intro-num">LEVEL {introLevel.idx + 1}</p>
              <h2 className="sky-escort-intro-name">{introLevel.name}</h2>
              <p className="sky-escort-intro-sub">Sector locked — rolling out</p>
              <div className="sky-escort-intro-bar">
                <span />
              </div>
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
            <div className="sky-escort-crosshair" aria-hidden>
              <span className="sky-escort-crosshair-h" />
              <span className="sky-escort-crosshair-v" />
              <span className="sky-escort-crosshair-ring" />
            </div>
          )}
          <div
            className="sky-escort-card"
            style={{ visibility: phase === "intro" || phase === "dead" ? "hidden" : "visible" }}
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
                    ? "WASD the pickup across terraced ash plains — meteors punch craters, follow the beacon"
                    : "Bed turret — mouse aim over the open bed, hold fire on dive-bombers for points"}
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
                  Level {levelIdx + 1} · endless · Space / Enter starts · Tab swaps seat · Return leaves
                </p>
              </>
            )}
            {phase === "run" && (
              <>
                <p>
                  {seat === "driver" ? "DRIVER" : "GUNNER"} · {score} pts · hull {"♥".repeat(hull)}
                  {"♡".repeat(Math.max(0, level.hull - hull))} · {hudDist}m
                </p>
                {clearBanner ? <p className="sky-escort-alert">{clearBanner}</p> : failCue ? <p className="sky-escort-alert">METEOR IMPACT</p> : null}
                <p className="sky-escort-hint">
                  {seat === "driver"
                    ? `WASD · Shift boost (${loadoutHud.boostCharges}/${loadoutHud.boostMax}) · ramps & beacon`
                    : "Mouse aim · click / Space fire · +100 per dive ship"}
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
