import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { emitMinigame, onMinigame } from "../net/session.ts";
import { useGame } from "../state/store.ts";

const LANES = [-3.2, 0, 3.2];
const START_Z = 10;
const END_Z = -92;
const TILE_LEN = 6;
const TILE_COLS = 3;
const HULL_MAX = 3;
const TURRET: [number, number, number] = [0, 4.2, 14];

type Role = "driver" | "gunner";
type Phase = "ready" | "run" | "won" | "dead";

type Tile = { id: number; col: number; z: number; drop: number; gone: boolean };
type Meteor = { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number };
type Alien = { id: number; x: number; y: number; z: number; hp: number };
type Bullet = { id: number; x: number; y: number; z: number; dx: number; dy: number; dz: number };
type Blast = { id: number; x: number; y: number; z: number; age: number };

type Snap = {
  type: "snap";
  phase: Phase;
  hull: number;
  driverX: number;
  driverZ: number;
  driverLane: number;
  tiles: Tile[];
  meteors: Meteor[];
  aliens: Alien[];
  blasts: Blast[];
  shake: number;
  driverId: string | null;
  gunnerId: string | null;
};

type RoleMsg = { type: "role"; driverId: string | null; gunnerId: string | null; phase?: Phase };
type InputMsg = {
  type: "input";
  role: Role;
  lane?: number;
  yaw?: number;
  pitch?: number;
  fire?: boolean;
};

function hostIdFromInstance(instanceId: string): string {
  // remote: `${userId}:sky-escort:ts` · local: `local:sky-escort`
  if (instanceId.startsWith("local:")) return "local";
  return instanceId.split(":")[0] || "local";
}

export function SkyEscort({ color }: { color: string }) {
  const { camera, gl } = useThree();
  const selfId = useGame((s) => s.selfId) ?? "local";
  const location = useGame((s) => s.location);
  const players = useGame((s) => s.players);
  const offline = useGame((s) => s.offline);

  const instanceId = location.type === "game" ? location.instanceId : "local:sky-escort";
  const isHost = offline || hostIdFromInstance(instanceId) === selfId || instanceId.startsWith("local:");

  const [phase, setPhase] = useState<Phase>("ready");
  const [localRole, setLocalRole] = useState<Role>("driver");
  const [hull, setHull] = useState(HULL_MAX);
  const [shakeUi, setShakeUi] = useState(0);
  const [hudDist, setHudDist] = useState(0);
  const [failCue, setFailCue] = useState(false);
  const [hudPct, setHudPct] = useState(0);

  const phaseRef = useRef<Phase>("ready");
  const roleRef = useRef<Role>("driver");
  const hullRef = useRef(HULL_MAX);
  const shakeRef = useRef(0);
  const hudAcc = useRef(0);
  const driverLane = useRef(1);
  const driverX = useRef(0);
  const driverZ = useRef(START_Z);
  const driverY = useRef(0.7);
  const falling = useRef(false);
  const invuln = useRef(0);
  const nextId = useRef(1);
  const meteorAcc = useRef(0);
  const alienAcc = useRef(0);
  const snapAcc = useRef(0);
  const gunSendAcc = useRef(0);
  const gunYaw = useRef(0);
  const gunPitch = useRef(-0.18);
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

  const convoy = useRef<THREE.Group>(null);
  const tileGroup = useRef<THREE.Group>(null);
  const meteorGroup = useRef<THREE.Group>(null);
  const alienGroup = useRef<THREE.Group>(null);
  const bulletGroup = useRef<THREE.Group>(null);
  const blastGroup = useRef<THREE.Group>(null);

  const mats = useMemo(
    () => ({
      road: new THREE.MeshStandardMaterial({ color: "#2a1c18", emissive: "#4a2010", emissiveIntensity: 0.35, roughness: 0.85 }),
      roadHot: new THREE.MeshStandardMaterial({ color: "#5a2818", emissive: color, emissiveIntensity: 0.7, roughness: 0.7 }),
      meteor: new THREE.MeshStandardMaterial({ color: "#5c4030", emissive: "#ff6a00", emissiveIntensity: 1.2 }),
      alien: new THREE.MeshStandardMaterial({ color: "#1b5e20", emissive: "#69f0ae", emissiveIntensity: 1.4 }),
      bullet: new THREE.MeshBasicMaterial({ color: "#ffe082" }),
      blast: new THREE.MeshBasicMaterial({ color: "#ff9100", transparent: true, opacity: 0.7 }),
      convoy: new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.4 }),
    }),
    [color],
  );

  function setPhaseBoth(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function hurt(amount = 1) {
    if (invuln.current > 0) return;
    hullRef.current = Math.max(0, hullRef.current - amount);
    setHull(hullRef.current);
    invuln.current = 1.1;
    shakeRef.current = Math.max(shakeRef.current, 0.55);
    addBlast(driverX.current, 1.2, driverZ.current);
    if (hullRef.current <= 0) setPhaseBoth("dead");
  }

  function addBlast(x: number, y: number, z: number) {
    blasts.current.push({ id: nextId.current++, x, y, z, age: 0 });
    if (blasts.current.length > 18) blasts.current.shift();
  }

  function buildTiles() {
    const list: Tile[] = [];
    let id = 1;
    for (let z = START_Z + 4; z > END_Z - 8; z -= TILE_LEN) {
      for (let col = 0; col < TILE_COLS; col += 1) {
        list.push({ id: id++, col, z, drop: 0, gone: false });
      }
    }
    tiles.current = list;
  }

  function resetRun(asRole: Role) {
    roleRef.current = asRole;
    setLocalRole(asRole);
    driverIdRef.current = asRole === "driver" ? selfId : "ai";
    gunnerIdRef.current = asRole === "gunner" ? selfId : "ai";
    // If a human peer exists, prefer them for the empty seat
    const peer = Object.values(useGame.getState().players).find((p) => p.id !== selfId);
    if (peer) {
      if (asRole === "driver") gunnerIdRef.current = peer.id;
      else driverIdRef.current = peer.id;
    }
    driverLane.current = 1;
    driverX.current = 0;
    driverZ.current = START_Z;
    driverY.current = 0.7;
    falling.current = false;
    invuln.current = 0;
    hullRef.current = HULL_MAX;
    setHull(HULL_MAX);
    meteors.current = [];
    aliens.current = [];
    bullets.current = [];
    blasts.current = [];
    meteorAcc.current = 0;
    alienAcc.current = 0;
    buildTiles();
    shakeRef.current = 0;
    setFailCue(false);
    setPhaseBoth("run");
  }

  // Cameras + pointer for gunner
  useEffect(() => {
    document.exitPointerLock?.();
    camera.near = 0.1;
    camera.far = 220;
    camera.position.set(0, 5, 18);
    camera.lookAt(0, 1, 0);
    camera.updateProjectionMatrix();
    return () => {
      camera.far = 220;
      camera.position.set(3, 4.2, 11);
      camera.lookAt(0, 1.2, 0);
      camera.updateProjectionMatrix();
    };
  }, [camera]);

  useEffect(() => {
    const others = Object.values(players).filter((p) => p.id !== selfId);
    if (instanceId.startsWith("local:") || offline || others.length === 0) {
      driverIdRef.current = localRole === "driver" ? selfId : "ai";
      gunnerIdRef.current = localRole === "gunner" ? selfId : "ai";
    } else if (isHost) {
      driverIdRef.current = selfId;
      gunnerIdRef.current = others[0]?.id ?? "ai";
    } else {
      driverIdRef.current = hostIdFromInstance(instanceId);
      gunnerIdRef.current = selfId;
      roleRef.current = "gunner";
      setLocalRole("gunner");
    }
  }, [players, selfId, instanceId, offline, isHost, localRole]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (useGame.getState().chatOpen) return;
      if (e.repeat) return;
      const p = phaseRef.current;
      if (p === "ready") {
        if (e.code === "Digit1" || e.code === "KeyQ") setLocalRole("driver");
        if (e.code === "Digit2" || e.code === "KeyE") setLocalRole("gunner");
        if (e.code === "Space" || e.code === "Enter") {
          e.preventDefault();
          if (isHost) {
            resetRun(localRole);
            emitMinigame(instanceId, "sky-escort", {
              type: "role",
              driverId: localRole === "driver" ? selfId : "ai",
              gunnerId: localRole === "gunner" ? selfId : Object.values(players).find((x) => x.id !== selfId)?.id ?? "ai",
              phase: "run",
            } satisfies RoleMsg);
          }
        }
        if (e.code === "KeyX") {
          setLocalRole((r) => (r === "driver" ? "gunner" : "driver"));
        }
        return;
      }
      if ((p === "dead" || p === "won") && (e.code === "Space" || e.code === "KeyR" || e.code === "Enter")) {
        e.preventDefault();
        if (isHost) resetRun(roleRef.current);
        return;
      }
      if (p !== "run") return;
      if (roleRef.current === "driver") {
        if (e.code === "KeyA" || e.code === "ArrowLeft") driverLane.current = Math.max(0, driverLane.current - 1);
        if (e.code === "KeyD" || e.code === "ArrowRight") driverLane.current = Math.min(2, driverLane.current + 1);
        if (!isHost) {
          emitMinigame(instanceId, "sky-escort", {
            type: "input",
            role: "driver",
            lane: driverLane.current,
          } satisfies InputMsg);
        }
      }
      if (roleRef.current === "gunner" && (e.code === "Space" || e.code === "KeyF")) {
        fireHeld.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "KeyF") fireHeld.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [isHost, instanceId, localRole, selfId, players]);

  useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: MouseEvent) => {
      if (phaseRef.current !== "run" || roleRef.current !== "gunner") return;
      lookQ.current.x += e.movementX;
      lookQ.current.y += e.movementY;
    };
    const onDown = () => {
      if (phaseRef.current !== "run" || roleRef.current !== "gunner") return;
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
        if (data.driverId === selfId) {
          roleRef.current = "driver";
          setLocalRole("driver");
        } else if (data.gunnerId === selfId) {
          roleRef.current = "gunner";
          setLocalRole("gunner");
        }
        if (data.phase === "run" && !isHost) {
          buildTiles();
          setPhaseBoth("run");
          hullRef.current = HULL_MAX;
          setHull(HULL_MAX);
        }
      }
      if (data.type === "input" && isHost) {
        remoteInput.current = data;
      }
      if (data.type === "snap" && !isHost) {
        phaseRef.current = data.phase;
        setPhase(data.phase);
        hullRef.current = data.hull;
        setHull(data.hull);
        driverX.current = data.driverX;
        driverZ.current = data.driverZ;
        driverLane.current = data.driverLane;
        tiles.current = data.tiles;
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
    const progress = Math.min(1, Math.max(0, (START_Z - driverZ.current) / (START_Z - END_Z)));
    hudAcc.current += clamped;
    if (hudAcc.current > 0.12) {
      hudAcc.current = 0;
      setHudDist(Math.max(0, Math.floor(driverZ.current - END_Z)));
      setHudPct(Math.floor(progress * 100));
      setShakeUi(shakeRef.current);
    }

    if (phaseRef.current === "run" && isHost) {
      // Apply remote driver lane
      const rin = remoteInput.current;
      if (rin?.role === "driver" && typeof rin.lane === "number") {
        driverLane.current = rin.lane;
      }

      // AI driver weave if needed
      if (driverIdRef.current === "ai") {
        const threat = meteors.current.find((m) => m.z < driverZ.current + 8 && m.z > driverZ.current - 2);
        if (threat && Math.abs(threat.x - driverX.current) < 2.2) {
          const prefer = threat.x > driverX.current ? 0 : 2;
          if (Math.random() < 0.04) driverLane.current = prefer;
        } else if (Math.random() < 0.008) {
          driverLane.current = Math.max(0, Math.min(2, driverLane.current + (Math.random() < 0.5 ? -1 : 1)));
        }
      }

      const targetX = LANES[driverLane.current];
      driverX.current += (targetX - driverX.current) * Math.min(1, 10 * clamped);

      const speed = 18 + progress * 14;
      if (!falling.current) driverZ.current -= speed * clamped;

      // Collapse tiles behind and sometimes ahead
      const aheadChance = 0.012 + progress * 0.04;
      for (const t of tiles.current) {
        if (t.gone) continue;
        const behind = t.z > driverZ.current + 4;
        const aheadGap = t.z < driverZ.current - 6 && t.z > driverZ.current - 28;
        if (behind && t.drop === 0 && Math.random() < 0.08 + progress * 0.12) {
          t.drop = 0.01;
          addBlast(LANES[t.col], 0.5, t.z);
          shakeRef.current = Math.max(shakeRef.current, 0.35);
          setFailCue(true);
        }
        if (aheadGap && t.drop === 0 && Math.random() < aheadChance * 0.15) {
          t.drop = 0.01;
          addBlast(LANES[t.col], 0.5, t.z);
          shakeRef.current = Math.max(shakeRef.current, 0.45);
          setFailCue(true);
        }
        if (t.drop > 0) {
          t.drop += clamped * (2.2 + progress * 2);
          if (t.drop > 8) t.gone = true;
        }
      }

      // Standing tile check
      const col = driverLane.current;
      const under = tiles.current.find(
        (t) => t.col === col && !t.gone && Math.abs(t.z - driverZ.current) < TILE_LEN * 0.55,
      );
      if (!under || under.drop > 1.2) {
        falling.current = true;
      }
      if (falling.current) {
        driverY.current -= 14 * clamped;
        if (driverY.current < -6) {
          falling.current = false;
          driverY.current = 0.7;
          hurt(1);
          // snap to nearest solid tile
          const solid = tiles.current.find((t) => !t.gone && t.drop < 0.2 && t.z < driverZ.current && t.z > driverZ.current - 12);
          if (solid) {
            driverLane.current = solid.col;
            driverZ.current = solid.z;
          }
        }
      } else {
        driverY.current += (0.7 - driverY.current) * Math.min(1, 12 * clamped);
      }

      // Meteors
      meteorAcc.current += clamped;
      const meteorEvery = Math.max(0.35, 1.05 - progress * 0.7);
      if (meteorAcc.current >= meteorEvery) {
        meteorAcc.current = 0;
        const lane = Math.floor(Math.random() * 3);
        meteors.current.push({
          id: nextId.current++,
          x: LANES[lane] + (Math.random() - 0.5) * 0.6,
          y: 14 + Math.random() * 6,
          z: driverZ.current - 18 - Math.random() * 22,
          vx: (Math.random() - 0.5) * 2,
          vy: -18 - progress * 10,
          vz: 4 + Math.random() * 4,
        });
      }
      for (const m of meteors.current) {
        m.x += m.vx * clamped;
        m.y += m.vy * clamped;
        m.z += m.vz * clamped;
        if (m.y < 0.4) {
          addBlast(m.x, 0.6, m.z);
          shakeRef.current = Math.max(shakeRef.current, 0.4);
          // crack tile under impact
          const hitTile = tiles.current.find(
            (t) => !t.gone && Math.abs(LANES[t.col] - m.x) < 2 && Math.abs(t.z - m.z) < TILE_LEN * 0.6,
          );
          if (hitTile && hitTile.drop === 0) hitTile.drop = 0.01;
          m.y = -99;
        }
        if (
          Math.abs(m.x - driverX.current) < 1.15 &&
          Math.abs(m.z - driverZ.current) < 1.3 &&
          m.y < 2.2 &&
          m.y > 0
        ) {
          hurt(1);
          m.y = -99;
          addBlast(driverX.current, 1, driverZ.current);
        }
      }
      meteors.current = meteors.current.filter((m) => m.y > -20 && m.z < driverZ.current + 30);

      // Aliens
      alienAcc.current += clamped;
      const alienEvery = Math.max(0.55, 1.4 - progress * 0.85);
      if (alienAcc.current >= alienEvery) {
        alienAcc.current = 0;
        aliens.current.push({
          id: nextId.current++,
          x: (Math.random() - 0.5) * 22,
          y: 6 + Math.random() * 8,
          z: driverZ.current - 30 - Math.random() * 40,
          hp: 2,
        });
      }

      // AI gunner
      const gunIsAi = gunnerIdRef.current === "ai";
      fireCd.current = Math.max(0, fireCd.current - clamped);
      if (gunIsAi && aliens.current.length && fireCd.current <= 0) {
        const target = aliens.current[0];
        const dx = target.x - TURRET[0];
        const dy = target.y - TURRET[1];
        const dz = target.z - TURRET[2];
        const len = Math.hypot(dx, dy, dz) || 1;
        bullets.current.push({
          id: nextId.current++,
          x: TURRET[0],
          y: TURRET[1],
          z: TURRET[2],
          dx: dx / len,
          dy: dy / len,
          dz: dz / len,
        });
        fireCd.current = 0.28;
      }

      // Human / remote gunner aim
      if (!gunIsAi) {
        if (roleRef.current === "gunner") {
          gunYaw.current -= lookQ.current.x * 0.0022;
          gunPitch.current = Math.max(-1.1, Math.min(0.55, gunPitch.current - lookQ.current.y * 0.002));
          lookQ.current.x *= 0.2;
          lookQ.current.y *= 0.2;
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
          bullets.current.push({
            id: nextId.current++,
            x: TURRET[0],
            y: TURRET[1],
            z: TURRET[2],
            dx: sy * cp,
            dy: sp,
            dz: -cy * cp,
          });
          fireCd.current = 0.16;
          if (!isHost || roleRef.current !== "gunner") {
            /* host fires from state */
          } else if (roleRef.current === "gunner" && !instanceId.startsWith("local:")) {
            emitMinigame(instanceId, "sky-escort", {
              type: "input",
              role: "gunner",
              yaw: gunYaw.current,
              pitch: gunPitch.current,
              fire: true,
            } satisfies InputMsg);
          }
        }
      }

      // If peer is gunner sending aim continuously
      if (!gunIsAi && roleRef.current === "gunner" && !isHost) {
        gunYaw.current -= lookQ.current.x * 0.0022;
        gunPitch.current = Math.max(-1.1, Math.min(0.55, gunPitch.current - lookQ.current.y * 0.002));
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
        b.x += b.dx * 55 * clamped;
        b.y += b.dy * 55 * clamped;
        b.z += b.dz * 55 * clamped;
      }
      for (const a of aliens.current) {
        // dive toward convoy
        a.x += (driverX.current - a.x) * 0.35 * clamped;
        a.y += (1.6 - a.y) * 0.25 * clamped;
        a.z += (driverZ.current - a.z) * 0.45 * clamped + 6 * clamped;
        for (const b of bullets.current) {
          if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1.35) {
            a.hp -= 1;
            b.z = 999;
            addBlast(a.x, a.y, a.z);
          }
        }
        if (Math.hypot(a.x - driverX.current, a.z - driverZ.current) < 1.6 && a.y < 2.5) {
          hurt(1);
          a.hp = 0;
          addBlast(driverX.current, 1.2, driverZ.current);
        }
      }
      aliens.current = aliens.current.filter((a) => a.hp > 0 && a.z < driverZ.current + 25);
      bullets.current = bullets.current.filter(
        (b) => b.z > END_Z - 20 && b.z < START_Z + 40 && b.y > -5 && b.y < 40,
      );

      invuln.current = Math.max(0, invuln.current - clamped);
      for (const bl of blasts.current) bl.age += clamped;
      blasts.current = blasts.current.filter((b) => b.age < 0.55);

      if (driverZ.current <= END_Z) setPhaseBoth("won");

      // Broadcast snap
      snapAcc.current += clamped;
      if (!instanceId.startsWith("local:") && snapAcc.current >= 1 / 15) {
        snapAcc.current = 0;
        const snap: Snap = {
          type: "snap",
          phase: phaseRef.current,
          hull: hullRef.current,
          driverX: driverX.current,
          driverZ: driverZ.current,
          driverLane: driverLane.current,
          tiles: tiles.current.map((t) => ({ ...t })),
          meteors: meteors.current.map((m) => ({ ...m })),
          aliens: aliens.current.map((a) => ({ ...a })),
          blasts: blasts.current.map((b) => ({ ...b })),
          shake: shakeRef.current,
          driverId: driverIdRef.current,
          gunnerId: gunnerIdRef.current,
        };
        emitMinigame(instanceId, "sky-escort", snap);
      }
      remoteInput.current = null;
    }

    // Non-host still updates gun look locally for camera
    if (phaseRef.current === "run" && !isHost && roleRef.current === "gunner") {
      gunYaw.current -= lookQ.current.x * 0.0022;
      gunPitch.current = Math.max(-1.1, Math.min(0.55, gunPitch.current - lookQ.current.y * 0.002));
      lookQ.current.x *= 0.2;
      lookQ.current.y *= 0.2;
    }

    shakeRef.current = Math.max(0, shakeRef.current - clamped * 1.6);

    // Sync meshes
    if (convoy.current) {
      convoy.current.position.set(driverX.current, Math.max(driverY.current, -4), driverZ.current);
    }
    syncInstanced(tileGroup.current, tiles.current, (t, mesh) => {
      mesh.visible = !t.gone;
      mesh.position.set(LANES[t.col], -t.drop, t.z);
      mesh.rotation.z = t.drop > 0 ? t.drop * 0.15 * (t.col - 1) : 0;
      mesh.material = t.drop > 0 ? mats.roadHot : mats.road;
      mesh.scale.set(2.8, 0.35, TILE_LEN * 0.92);
    }, () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats.road));

    syncInstanced(meteorGroup.current, meteors.current, (m, mesh) => {
      mesh.visible = m.y > -10;
      mesh.position.set(m.x, m.y, m.z);
      mesh.scale.setScalar(0.9);
    }, () => new THREE.Mesh(new THREE.DodecahedronGeometry(0.55), mats.meteor));

    syncInstanced(alienGroup.current, aliens.current, (a, mesh) => {
      mesh.visible = true;
      mesh.position.set(a.x, a.y, a.z);
      mesh.scale.set(1.2, 0.55, 1.6);
    }, () => new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 5), mats.alien));

    syncInstanced(bulletGroup.current, bullets.current, (b, mesh) => {
      mesh.visible = true;
      mesh.position.set(b.x, b.y, b.z);
    }, () => new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), mats.bullet));

    syncInstanced(blastGroup.current, blasts.current, (b, mesh) => {
      const s = 0.4 + b.age * 6;
      mesh.visible = b.age < 0.55;
      mesh.position.set(b.x, b.y, b.z);
      mesh.scale.setScalar(s);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, 0.75 - b.age * 1.4);
    }, () => new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), mats.blast.clone()));

    // Cameras
    const sh = shakeRef.current;
    const ox = (Math.random() - 0.5) * sh;
    const oy = (Math.random() - 0.5) * sh;
    if (roleRef.current === "driver" || phaseRef.current === "ready") {
      const tx = driverX.current * 0.4;
      const ty = 3.6 + driverY.current * 0.2;
      const tz = driverZ.current + 9;
      camera.position.x = THREE.MathUtils.damp(camera.position.x, tx + ox, 8, clamped);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, ty + oy, 8, clamped);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, tz, 8, clamped);
      camera.lookAt(driverX.current, 1.2, driverZ.current - 8);
    } else {
      const cy = Math.cos(gunYaw.current);
      const sy = Math.sin(gunYaw.current);
      const cp = Math.cos(gunPitch.current);
      const sp = Math.sin(gunPitch.current);
      camera.position.set(TURRET[0] + ox * 0.3, TURRET[1] + 0.35 + oy * 0.3, TURRET[2]);
      camera.lookAt(TURRET[0] + sy * cp * 20, TURRET[1] + sp * 20, TURRET[2] - cy * cp * 20);
    }
  });

  const totalDist = START_Z - END_Z;

  return (
    <group>
      <color attach="background" args={["#1a0a06"]} />
      <fog attach="fog" args={["#1a0a06", 28, 95]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[8, 18, 6]} intensity={0.85} color="#ffcc80" />
      <pointLight position={[0, 10, driverZ.current]} color="#ff6a00" intensity={30} distance={50} />
      <pointLight position={TURRET} color={color} intensity={24} distance={40} />

      {/* Ash embers */}
      {Array.from({ length: 24 }, (_, i) => (
        <mesh key={i} position={[(i % 8) * 4 - 14, 2 + (i % 5), -i * 3.5]}>
          <sphereGeometry args={[0.05, 4, 4]} />
          <meshBasicMaterial color="#ffab40" />
        </mesh>
      ))}

      {/* Turret nest */}
      <group position={TURRET}>
        <mesh position={[0, -1.6, 0]}>
          <cylinderGeometry args={[2.4, 2.8, 3.2, 8]} />
          <meshStandardMaterial color="#3e2723" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.2, 0]}>
          <boxGeometry args={[1.6, 0.5, 1.6]} />
          <meshStandardMaterial color="#5d4037" metalness={0.4} />
        </mesh>
        <mesh position={[0, 0.55, -0.4]} rotation={[0.2, 0, 0]}>
          <cylinderGeometry args={[0.12, 0.16, 1.8, 8]} />
          <meshStandardMaterial color="#efebe9" metalness={0.6} />
        </mesh>
      </group>

      {/* Gates */}
      <mesh position={[0, 2, START_Z + 2]}>
        <boxGeometry args={[10, 4, 0.4]} />
        <meshStandardMaterial color="#4e342e" emissive={color} emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, 2.5, END_Z - 1]}>
        <boxGeometry args={[12, 5, 0.5]} />
        <meshStandardMaterial color="#ffe082" emissive="#ffd54f" emissiveIntensity={1.2} />
      </mesh>

      <group ref={tileGroup} />
      <group ref={meteorGroup} />
      <group ref={alienGroup} />
      <group ref={bulletGroup} />
      <group ref={blastGroup} />

      <group ref={convoy} position={[0, 0.7, START_Z]}>
        <mesh>
          <sphereGeometry args={[0.55, 20, 20]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.6} />
        </mesh>
        <mesh position={[0, -0.35, 0.1]} rotation={[0.2, 0, 0]}>
          <boxGeometry args={[1.1, 0.25, 1.6]} />
          <meshStandardMaterial color="#3e2723" metalness={0.3} />
        </mesh>
        <pointLight color={color} intensity={8} distance={12} />
      </group>

      <Html position={[0, 7.5, START_Z]} center style={{ pointerEvents: phase === "ready" ? "auto" : "none" }}>
        <div className="room-title">
          <em>last road out</em>
          <strong>Sky Escort</strong>
          {phase === "ready" && (
            <>
              <span>
                Seat: <b>{localRole === "driver" ? "DRIVER" : "GUNNER"}</b> · 1/Q driver · 2/E gunner · X swap · Enter
                start
              </span>
              <span>Driver weaves the collapsing road · Gunner shoots the sky · Return in HUD leaves</span>
            </>
          )}
          {phase === "run" && (
            <>
              <span>
                {localRole.toUpperCase()} · hull {"♥".repeat(hull)}
                {"♡".repeat(Math.max(0, HULL_MAX - hull))} · {hudDist}m to gate
              </span>
              {failCue ? <span className="lb-best">ROAD FAILING</span> : null}
              <span style={{ opacity: 0.7 }}>
                {hudPct}% · shake {shakeUi > 0.05 ? "ON" : "—"} · meteors + aliens escalate
              </span>
            </>
          )}
          {phase === "won" && <span className="lb-best">You made the gate — Space to run it back</span>}
          {phase === "dead" && <span>Convoy down — Space to retry</span>}
        </div>
      </Html>

      {/* progress bar ghost */}
      <mesh position={[0, 0.05, (START_Z + END_Z) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.2, totalDist]} />
        <meshBasicMaterial color="#ffab40" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

function syncInstanced<T>(
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
