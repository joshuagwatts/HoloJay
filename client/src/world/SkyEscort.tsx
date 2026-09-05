import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { emitMinigame, onMinigame } from "../net/session.ts";
import { useGame } from "../state/store.ts";

/** Halo-3-finale vibe: ground buggy trek A→B over a dying plain. Not a runner. Not a plane. */

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
    driveSpeed: 17 + Math.min(soft, 16) * 0.55,
    turnRate: 2.05,
    // Start sparse; ramp slowly. Level 0 ~3.4s between meteors.
    meteorEvery: Math.max(0.32, 4.2 - soft * 0.18),
    alienEvery: Math.max(0.55, 5.0 - soft * 0.2),
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

type Role = "driver" | "gunner";
type Phase = "ready" | "run" | "won" | "dead";

type Tile = { id: number; x: number; z: number; drop: number; gone: boolean; h: number; shade: number };
type Meteor = { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number };
type Alien = { id: number; x: number; y: number; z: number; hp: number };
type Bullet = { id: number; x: number; y: number; z: number; dx: number; dy: number; dz: number };
type Blast = { id: number; x: number; y: number; z: number; age: number };

type Snap = {
  type: "snap";
  phase: Phase;
  hull: number;
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
  const isHost = offline || hostIdFromInstance(instanceId) === selfId || instanceId.startsWith("local:");

  const [levelIdx, setLevelIdx] = useState(0);
  const levelIdxRef = useRef(0);
  const level = makeLevel(levelIdx);

  const [phase, setPhase] = useState<Phase>("ready");
  const [seat, setSeat] = useState<Role>("driver");
  const [hull, setHull] = useState(level.hull);
  const [hudDist, setHudDist] = useState(0);
  const [failCue, setFailCue] = useState(false);
  const failCueT = useRef(0);

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
  const gunPitch = useRef(-0.1);
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
  const tileGroup = useRef<THREE.Group>(null);
  const meteorGroup = useRef<THREE.Group>(null);
  const alienGroup = useRef<THREE.Group>(null);
  const bulletGroup = useRef<THREE.Group>(null);
  const blastGroup = useRef<THREE.Group>(null);

  const mats = useMemo(
    () => ({
      dirt: [
        new THREE.MeshStandardMaterial({
          color: "#3a2a1c",
          emissive: "#1a1008",
          emissiveIntensity: 0.12,
          roughness: 0.98,
          flatShading: true,
        }),
        new THREE.MeshStandardMaterial({
          color: "#2e2418",
          emissive: "#140e08",
          emissiveIntensity: 0.1,
          roughness: 1,
          flatShading: true,
        }),
        new THREE.MeshStandardMaterial({
          color: "#463522",
          emissive: "#1c140a",
          emissiveIntensity: 0.14,
          roughness: 0.96,
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
    if (hullRef.current <= 0) setPhaseBoth("dead");
  }

  function turretWorld() {
    const ox = Math.sin(yaw.current) * -1.35;
    const oz = Math.cos(yaw.current) * -1.35;
    return { x: x.current + ox, y: y.current + 1.35, z: z.current + oz };
  }

  function activeLevel() {
    return makeLevel(levelIdxRef.current);
  }

  function setLevel(idx: number) {
    const next = Math.max(0, Math.floor(idx));
    levelIdxRef.current = next;
    setLevelIdx(next);
  }

  function buildTerrain() {
    const L = activeLevel();
    const list: Tile[] = [];
    let id = 1;
    for (let zz = L.startZ + L.tile; zz > L.endZ - L.tile * 2; zz -= L.tile) {
      for (let xx = -L.halfW; xx <= L.halfW; xx += L.tile) {
        const n = terrainNoise(xx, zz);
        const h = 0.15 + n * 0.7;
        const shade = Math.floor(terrainNoise(xx + 9, zz - 4) * 4);
        list.push({ id: id++, x: xx, z: zz, drop: 0, gone: false, h, shade });
      }
    }
    tiles.current = list;
  }

  function snapSeatCam(role: Role) {
    if (role === "gunner") {
      gunYaw.current = 0;
      gunPitch.current = -0.1;
      const t = turretWorld();
      camera.position.set(t.x, t.y + 0.35, t.z);
      camera.lookAt(
        x.current + Math.sin(yaw.current) * 20,
        2,
        z.current + Math.cos(yaw.current) * 20,
      );
    } else {
      const back = 11;
      camera.position.set(
        x.current - Math.sin(yaw.current) * back,
        y.current + 5.2,
        z.current - Math.cos(yaw.current) * back,
      );
      camera.lookAt(
        x.current + Math.sin(yaw.current) * 14,
        1.0,
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
    y.current = 0.85;
    yaw.current = Math.PI;
    speed.current = 0;
    falling.current = false;
    invuln.current = 0;
    hullRef.current = L.hull;
    setHull(L.hull);
    keys.current = { throttle: 0, steer: 0 };
    meteors.current = [];
    aliens.current = [];
    bullets.current = [];
    blasts.current = [];
    meteorAcc.current = -Math.min(5, 2.5 + L.meteorEvery * 0.45);
    alienAcc.current = -Math.min(6, 3 + L.alienEvery * 0.4);
    buildTerrain();
    shakeRef.current = 0;
    failCueT.current = 0;
    setFailCue(false);
    snapSeatCam(asRole);
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
        if (data.phase === "run" && !isHost) {
          const L = activeLevel();
          buildTerrain();
          hullRef.current = L.hull;
          setHull(L.hull);
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
        x.current = data.x;
        z.current = data.z;
        y.current = data.y;
        yaw.current = data.yaw;
        tiles.current = data.tiles.map((t) => ({
          ...t,
          h: t.h ?? 0.35,
          shade: t.shade ?? 0,
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
        yaw.current += steer * level.turnRate * clamped * (0.55 + Math.min(1, Math.abs(speed.current) / 10));
        const target = throttle * level.driveSpeed * (0.85 + progress * 0.35);
        speed.current = THREE.MathUtils.damp(speed.current, target, 4.5, clamped);
        const crawl = throttle === 0 ? level.driveSpeed * 0.22 : 0;
        const v = speed.current + crawl;
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
          y.current = 0.85;
          hurt(1);
          const solid = tiles.current.find((t) => !t.gone && t.drop < 0.2 && Math.abs(t.z - z.current) < 16);
          if (solid) {
            x.current = solid.x;
            z.current = solid.z;
          }
        }
      } else {
        y.current = THREE.MathUtils.damp(y.current, 0.85, 12, clamped);
      }

      meteorAcc.current += clamped;
      // Soft mid-run ramp — early levels stay sparse.
      const meteorEvery = Math.max(0.32, level.meteorEvery - progress * Math.min(0.55, 0.12 + levelIdxRef.current * 0.04));
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
            if (t.gone || t.drop > 0) continue;
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

      const turret = turretWorld();
      fireCd.current = Math.max(0, fireCd.current - clamped);
      const gunIsAi = gunnerIdRef.current === "ai";

      if (gunIsAi && aliens.current[0] && fireCd.current <= 0) {
        const t = aliens.current[0];
        const dx = t.x - turret.x;
        const dy = t.y - turret.y;
        const dz = t.z - turret.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        bullets.current.push({
          id: nextId.current++,
          x: turret.x,
          y: turret.y,
          z: turret.z,
          dx: dx / len,
          dy: dy / len,
          dz: dz / len,
        });
        fireCd.current = 0.26;
      }

      if (!gunIsAi) {
        if (seatRef.current === "gunner") {
          gunYaw.current -= lookQ.current.x * 0.0024;
          gunPitch.current = Math.max(-1.0, Math.min(0.55, gunPitch.current - lookQ.current.y * 0.002));
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
          bullets.current.push({
            id: nextId.current++,
            x: turret.x,
            y: turret.y,
            z: turret.z,
            dx: sy * cp,
            dy: sp,
            dz: cy * cp,
          });
          fireCd.current = 0.14;
        }
      }

      if (!gunIsAi && seatRef.current === "gunner" && !isHost) {
        gunYaw.current -= lookQ.current.x * 0.0024;
        gunPitch.current = Math.max(-1.0, Math.min(0.55, gunPitch.current - lookQ.current.y * 0.002));
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
          }
        }
        if (Math.hypot(a.x - x.current, a.z - z.current) < 1.9 && a.y < 2.6) {
          hurt(1);
          a.hp = 0;
          addBlast(x.current, y.current, z.current);
        }
      }
      aliens.current = aliens.current.filter((a) => a.hp > 0 && a.z < z.current + 35);
      bullets.current = bullets.current.filter((b) => b.z > level.endZ - 30 && b.y > -6 && b.y < 50);

      invuln.current = Math.max(0, invuln.current - clamped);
      for (const bl of blasts.current) bl.age += clamped;
      blasts.current = blasts.current.filter((b) => b.age < 0.55);

      if (z.current <= level.endZ) setPhaseBoth("won");

      snapAcc.current += clamped;
      if (!instanceId.startsWith("local:") && snapAcc.current >= 1 / 15) {
        snapAcc.current = 0;
        emitMinigame(instanceId, "sky-escort", {
          type: "snap",
          phase: phaseRef.current,
          hull: hullRef.current,
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

    if (phaseRef.current === "run" && !isHost && seatRef.current === "gunner") {
      gunYaw.current -= lookQ.current.x * 0.0024;
      gunPitch.current = Math.max(-1.0, Math.min(0.55, gunPitch.current - lookQ.current.y * 0.002));
      lookQ.current.x *= 0.2;
      lookQ.current.y *= 0.2;
    }

    shakeRef.current = Math.max(0, shakeRef.current - clamped * 1.5);

    if (buggy.current) {
      buggy.current.position.set(x.current, Math.max(y.current, -3), z.current);
      buggy.current.rotation.y = yaw.current;
      buggy.current.rotation.z = keys.current.steer * -0.12;
    }

    syncGroup(
      tileGroup.current,
      tiles.current,
      (t, mesh) => {
        mesh.visible = !t.gone;
        const thick = 0.55 + (t.h ?? 0.3);
        // Full tile size with tiny overlap so slabs touch — no gaps.
        mesh.scale.set(level.tile * 1.01, thick, level.tile * 1.01);
        mesh.position.set(t.x, thick * 0.5 - t.drop, t.z);
        mesh.rotation.z = t.drop > 0 ? t.drop * 0.05 * Math.sign(t.x || 1) : 0;
        mesh.rotation.x = t.drop > 0 ? t.drop * 0.03 : (t.h ?? 0) * 0.04 - 0.02;
        if (t.drop > 0) mesh.material = mats.dirtHot;
        else if ((t.shade ?? 0) >= 3) mesh.material = mats.rock;
        else mesh.material = mats.dirt[(t.shade ?? 0) % mats.dirt.length];
      },
      () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats.dirt[0]),
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
        mesh.scale.set(1.25, 0.5, 1.6);
      },
      () => new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 5), mats.alien),
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

    const sh = shakeRef.current;
    const ox = (Math.random() - 0.5) * sh;
    const oy = (Math.random() - 0.5) * sh;
    if (seatRef.current === "gunner" && phaseRef.current !== "ready") {
      const t = turretWorld();
      const aimYaw = yaw.current + gunYaw.current;
      const cy = Math.cos(aimYaw);
      const sy = Math.sin(aimYaw);
      const cp = Math.cos(gunPitch.current);
      const sp = Math.sin(gunPitch.current);
      camera.position.set(t.x + ox * 0.2, t.y + 0.4 + oy * 0.2, t.z);
      camera.lookAt(t.x + sy * cp * 28, t.y + sp * 28, t.z + cy * cp * 28);
    } else {
      const back = phaseRef.current === "ready" ? 14 : 11;
      const tx = x.current - Math.sin(yaw.current) * back;
      const ty = y.current + (phaseRef.current === "ready" ? 7 : 5.1);
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
      <color attach="background" args={["#120806"]} />
      <fog attach="fog" args={["#120806", 55, 200]} />
      <ambientLight intensity={0.34} />
      <directionalLight position={[12, 24, 6]} intensity={0.95} color="#ffcc80" />
      <pointLight position={[x.current, 7, z.current]} color="#ff6a00" intensity={26} distance={55} />

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
      <mesh position={[0, 3.2, level.endZ - 1]}>
        <boxGeometry args={[18, 7, 0.8]} />
        <meshStandardMaterial color="#ffe082" emissive="#ffd54f" emissiveIntensity={1.2} />
      </mesh>

      <group ref={tileGroup} />
      <group ref={meteorGroup} />
      <group ref={alienGroup} />
      <group ref={bulletGroup} />
      <group ref={blastGroup} />

      <group ref={buggy} position={[0, 0.85, level.startZ]} rotation={[0, Math.PI, 0]}>
        {/* chunky offroad buggy — ground trek, not a plane */}
        <mesh position={[0, 0.4, 0]}>
          <boxGeometry args={[2.55, 0.7, 4.2]} />
          <meshStandardMaterial color="#2c2118" metalness={0.35} roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.95, 0.55]}>
          <boxGeometry args={[1.7, 0.7, 1.9]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.35} />
        </mesh>
        <mesh position={[0, 1.35, 0.2]}>
          <boxGeometry args={[1.55, 0.12, 1.5]} />
          <meshStandardMaterial color="#1a1410" metalness={0.6} roughness={0.4} />
        </mesh>
        {/* roll cage */}
        <mesh position={[-0.7, 1.55, 0.1]}>
          <boxGeometry args={[0.08, 0.9, 1.8]} />
          <meshStandardMaterial color="#4e342e" metalness={0.5} />
        </mesh>
        <mesh position={[0.7, 1.55, 0.1]}>
          <boxGeometry args={[0.08, 0.9, 1.8]} />
          <meshStandardMaterial color="#4e342e" metalness={0.5} />
        </mesh>
        <mesh position={[0, 1.95, 0.1]}>
          <boxGeometry args={[1.5, 0.08, 1.8]} />
          <meshStandardMaterial color="#4e342e" metalness={0.5} />
        </mesh>
        {[
          [-1.35, 0.15, 1.35],
          [1.35, 0.15, 1.35],
          [-1.35, 0.15, -1.35],
          [1.35, 0.15, -1.35],
        ].map((p, i) => (
          <mesh key={i} position={p as [number, number, number]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.55, 0.55, 0.42, 14]} />
            <meshStandardMaterial color="#14100c" roughness={0.95} />
          </mesh>
        ))}
        <mesh position={[0, 1.25, -1.55]}>
          <cylinderGeometry args={[0.35, 0.42, 0.5, 8]} />
          <meshStandardMaterial color="#5d4037" metalness={0.55} />
        </mesh>
        <mesh position={[0, 1.55, -1.75]} rotation={[0.35, 0, 0]}>
          <cylinderGeometry args={[0.09, 0.12, 1.25, 8]} />
          <meshStandardMaterial color="#efebe9" metalness={0.75} />
        </mesh>
        <mesh position={[0, 0.55, 2.05]}>
          <sphereGeometry args={[0.3, 12, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.8} />
        </mesh>
        <pointLight color={color} intensity={9} distance={12} />
      </group>

      <Html fullscreen style={{ pointerEvents: phase === "ready" ? "auto" : "none" }}>
        <div className="sky-escort-hud">
          <div className="sky-escort-card">
            <em>{level.name}</em>
            <strong>Sky Escort</strong>
            {phase === "ready" && (
              <>
                <p>
                  You’re the <b>{seat === "driver" ? "DRIVER" : "GUNNER"}</b>
                </p>
                <p className="sky-escort-hint">
                  {seat === "driver"
                    ? "Finale run — WASD drive the buggy across the plain; meteors punch holes in the ground"
                    : "Rear turret seat — click to aim, hold fire on dive-bombers"}
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
                  {seat === "driver" ? "DRIVER" : "GUNNER"} · hull {"♥".repeat(hull)}
                  {"♡".repeat(Math.max(0, level.hull - hull))} · {hudDist}m to gate
                </p>
                {failCue ? <p className="sky-escort-alert">METEOR IMPACT</p> : null}
                <p className="sky-escort-hint">
                  {seat === "driver" ? "WASD trek · dodge meteor craters" : "Mouse aim · click / Space fire"}
                </p>
              </>
            )}
            {phase === "won" && (
              <p className="sky-escort-alert">
                {`Gate secured — Space for ${makeLevel(levelIdx + 1).name}`}
              </p>
            )}
            {phase === "dead" && <p>Buggy cooked — Space to retry</p>}
          </div>
        </div>
      </Html>
    </group>
  );
}
