import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { emitMinigame, onMinigame } from "../net/session.ts";
import { useGame } from "../state/store.ts";

/** Wide collapsing plane — driver flies a craft across it, not lane-dodging. */
const START_Z = 12;
const END_Z = -110;
const PLANE_HALF = 22;
const TILE = 5;
const HULL_MAX = 3;
const TURRET: [number, number, number] = [0, 5.5, 18];
const CRAFT_SPEED = 22;
const CRAFT_STRAFE = 18;

type Role = "driver" | "gunner";
type Phase = "ready" | "run" | "won" | "dead";

type Tile = { id: number; ix: number; iz: number; x: number; z: number; drop: number; gone: boolean };
type Meteor = { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number };
type Alien = { id: number; x: number; y: number; z: number; hp: number };
type Bullet = { id: number; x: number; y: number; z: number; dx: number; dy: number; dz: number };
type Blast = { id: number; x: number; y: number; z: number; age: number };

type Snap = {
  type: "snap";
  phase: Phase;
  hull: number;
  craftX: number;
  craftZ: number;
  craftY: number;
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
  /** Driver stick: forward (-1..1 toward gate), strafe (-1..1) */
  forward?: number;
  strafe?: number;
  yaw?: number;
  pitch?: number;
  fire?: boolean;
};

function hostIdFromInstance(instanceId: string): string {
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
  const [seat, setSeat] = useState<Role>("driver");
  const [hull, setHull] = useState(HULL_MAX);
  const [hudDist, setHudDist] = useState(0);
  const [failCue, setFailCue] = useState(false);

  const phaseRef = useRef<Phase>("ready");
  const seatRef = useRef<Role>("driver");
  const hullRef = useRef(HULL_MAX);
  const shakeRef = useRef(0);
  const hudAcc = useRef(0);

  const craftX = useRef(0);
  const craftZ = useRef(START_Z);
  const craftY = useRef(1.4);
  const craftYaw = useRef(0);
  const falling = useRef(false);
  const invuln = useRef(0);

  const keys = useRef({ f: 0, s: 0 });
  const nextId = useRef(1);
  const meteorAcc = useRef(0);
  const alienAcc = useRef(0);
  const snapAcc = useRef(0);
  const gunSendAcc = useRef(0);
  const gunYaw = useRef(0);
  const gunPitch = useRef(-0.2);
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

  const craft = useRef<THREE.Group>(null);
  const tileGroup = useRef<THREE.Group>(null);
  const meteorGroup = useRef<THREE.Group>(null);
  const alienGroup = useRef<THREE.Group>(null);
  const bulletGroup = useRef<THREE.Group>(null);
  const blastGroup = useRef<THREE.Group>(null);

  const mats = useMemo(
    () => ({
      road: new THREE.MeshStandardMaterial({ color: "#2a1c18", emissive: "#4a2010", emissiveIntensity: 0.3, roughness: 0.9 }),
      roadHot: new THREE.MeshStandardMaterial({ color: "#5a2810", emissive: color, emissiveIntensity: 0.75, roughness: 0.7 }),
      meteor: new THREE.MeshStandardMaterial({ color: "#5c4030", emissive: "#ff6a00", emissiveIntensity: 1.25 }),
      alien: new THREE.MeshStandardMaterial({ color: "#1b5e20", emissive: "#69f0ae", emissiveIntensity: 1.4 }),
      bullet: new THREE.MeshBasicMaterial({ color: "#ffe082" }),
      blast: new THREE.MeshBasicMaterial({ color: "#ff9100", transparent: true, opacity: 0.7 }),
      craft: new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2 }),
    }),
    [color],
  );

  function setPhaseBoth(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function hurt(n = 1) {
    if (invuln.current > 0) return;
    hullRef.current = Math.max(0, hullRef.current - n);
    setHull(hullRef.current);
    invuln.current = 1.05;
    shakeRef.current = Math.max(shakeRef.current, 0.5);
    addBlast(craftX.current, craftY.current, craftZ.current);
    if (hullRef.current <= 0) setPhaseBoth("dead");
  }

  function addBlast(x: number, y: number, z: number) {
    blasts.current.push({ id: nextId.current++, x, y, z, age: 0 });
    if (blasts.current.length > 20) blasts.current.shift();
  }

  function buildPlane() {
    const list: Tile[] = [];
    let id = 1;
    for (let z = START_Z + TILE; z > END_Z - TILE * 2; z -= TILE) {
      for (let x = -PLANE_HALF; x <= PLANE_HALF; x += TILE) {
        list.push({
          id: id++,
          ix: Math.round(x / TILE),
          iz: Math.round(z / TILE),
          x,
          z,
          drop: 0,
          gone: false,
        });
      }
    }
    tiles.current = list;
  }

  function snapSeatCam(role: Role) {
    if (role === "gunner") {
      gunYaw.current = 0;
      gunPitch.current = -0.18;
      camera.position.set(TURRET[0], TURRET[1] + 0.5, TURRET[2]);
      camera.lookAt(0, 2, craftZ.current - 30);
    } else {
      camera.position.set(craftX.current, craftY.current + 5.5, craftZ.current + 14);
      camera.lookAt(craftX.current, 1.2, craftZ.current - 18);
    }
    camera.near = 0.1;
    camera.far = 260;
    camera.updateProjectionMatrix();
  }

  function pickSeat(role: Role) {
    seatRef.current = role;
    setSeat(role);
    snapSeatCam(role);
  }

  function resetRun(asRole: Role) {
    seatRef.current = asRole;
    setSeat(asRole);
    driverIdRef.current = asRole === "driver" ? selfId : "ai";
    gunnerIdRef.current = asRole === "gunner" ? selfId : "ai";
    const peer = Object.values(useGame.getState().players).find((p) => p.id !== selfId);
    if (peer) {
      if (asRole === "driver") gunnerIdRef.current = peer.id;
      else driverIdRef.current = peer.id;
    }
    craftX.current = 0;
    craftZ.current = START_Z;
    craftY.current = 1.4;
    craftYaw.current = 0;
    falling.current = false;
    invuln.current = 0;
    hullRef.current = HULL_MAX;
    setHull(HULL_MAX);
    keys.current = { f: 0, s: 0 };
    meteors.current = [];
    aliens.current = [];
    bullets.current = [];
    blasts.current = [];
    meteorAcc.current = 0;
    alienAcc.current = 0;
    buildPlane();
    shakeRef.current = 0;
    setFailCue(false);
    snapSeatCam(asRole);
    setPhaseBoth("run");
  }

  useEffect(() => {
    document.exitPointerLock?.();
    buildPlane();
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
          resetRun(role);
          emitMinigame(instanceId, "sky-escort", {
            type: "role",
            driverId: role === "driver" ? selfId : "ai",
            gunnerId: role === "gunner" ? selfId : Object.values(players).find((x) => x.id !== selfId)?.id ?? "ai",
            phase: "run",
          } satisfies RoleMsg);
        }
        return;
      }

      if ((p === "dead" || p === "won") && (e.code === "Space" || e.code === "KeyR" || e.code === "Enter")) {
        e.preventDefault();
        if (isHost) resetRun(seatRef.current);
        return;
      }

      if (p !== "run") return;

      if (seatRef.current === "driver") {
        if (e.code === "KeyW" || e.code === "ArrowUp") keys.current.f = 1;
        if (e.code === "KeyS" || e.code === "ArrowDown") keys.current.f = -1;
        if (e.code === "KeyA" || e.code === "ArrowLeft") keys.current.s = -1;
        if (e.code === "KeyD" || e.code === "ArrowRight") keys.current.s = 1;
      }
      if (seatRef.current === "gunner" && (e.code === "Space" || e.code === "KeyF")) {
        fireHeld.current = true;
      }
    };

    const up = (e: KeyboardEvent) => {
      if (e.code === "KeyW" || e.code === "ArrowUp" || e.code === "KeyS" || e.code === "ArrowDown") {
        if (seatRef.current === "driver") keys.current.f = 0;
      }
      if (e.code === "KeyA" || e.code === "ArrowLeft" || e.code === "KeyD" || e.code === "ArrowRight") {
        if (seatRef.current === "driver") keys.current.s = 0;
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
        if (data.driverId === selfId) pickSeat("driver");
        else if (data.gunnerId === selfId) pickSeat("gunner");
        if (data.phase === "run" && !isHost) {
          buildPlane();
          hullRef.current = HULL_MAX;
          setHull(HULL_MAX);
          setPhaseBoth("run");
        }
      }
      if (data.type === "input" && isHost) remoteInput.current = data;
      if (data.type === "snap" && !isHost) {
        phaseRef.current = data.phase;
        setPhase(data.phase);
        hullRef.current = data.hull;
        setHull(data.hull);
        craftX.current = data.craftX;
        craftZ.current = data.craftZ;
        craftY.current = data.craftY;
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
    const progress = Math.min(1, Math.max(0, (START_Z - craftZ.current) / (START_Z - END_Z)));
    hudAcc.current += clamped;
    if (hudAcc.current > 0.12) {
      hudAcc.current = 0;
      setHudDist(Math.max(0, Math.floor(craftZ.current - END_Z)));
    }

    // Send driver stick when we're the non-host driver
    if (phaseRef.current === "run" && seatRef.current === "driver" && !isHost) {
      snapAcc.current += clamped;
      if (snapAcc.current > 0.05) {
        snapAcc.current = 0;
        emitMinigame(instanceId, "sky-escort", {
          type: "input",
          role: "driver",
          forward: keys.current.f,
          strafe: keys.current.s,
        } satisfies InputMsg);
      }
    }

    if (phaseRef.current === "run" && isHost) {
      let forward = keys.current.f;
      let strafe = keys.current.s;
      const rin = remoteInput.current;
      if (driverIdRef.current !== selfId && rin?.role === "driver") {
        if (typeof rin.forward === "number") forward = rin.forward;
        if (typeof rin.strafe === "number") strafe = rin.strafe;
      }

      // AI pilot: push toward gate, dodge meteors loosely
      if (driverIdRef.current === "ai") {
        forward = 0.85;
        const threat = meteors.current.find(
          (m) => m.z < craftZ.current + 10 && m.z > craftZ.current - 4 && Math.abs(m.x - craftX.current) < 4,
        );
        if (threat) strafe = threat.x > craftX.current ? -1 : 1;
        else strafe *= 0.9;
      }

      // Free plane flight — always some cruise toward the gate, stick steers
      const cruise = 0.55 + progress * 0.25;
      const f = THREE.MathUtils.clamp(cruise + forward * 0.55, 0.2, 1.35);
      if (!falling.current) {
        craftZ.current -= CRAFT_SPEED * f * clamped;
        craftX.current += strafe * CRAFT_STRAFE * clamped;
        craftX.current = THREE.MathUtils.clamp(craftX.current, -PLANE_HALF + 2, PLANE_HALF - 2);
        craftYaw.current = THREE.MathUtils.damp(craftYaw.current, -strafe * 0.45, 8, clamped);
      }

      // Collapse chaos on the plane
      const aheadChance = 0.01 + progress * 0.035;
      for (const t of tiles.current) {
        if (t.gone) continue;
        const behind = t.z > craftZ.current + 6;
        const nearAhead = t.z < craftZ.current - 4 && t.z > craftZ.current - 32;
        if (behind && t.drop === 0 && Math.random() < 0.05 + progress * 0.1) {
          t.drop = 0.01;
          addBlast(t.x, 0.4, t.z);
          shakeRef.current = Math.max(shakeRef.current, 0.3);
          setFailCue(true);
        }
        if (nearAhead && t.drop === 0 && Math.random() < aheadChance * 0.12) {
          // leave a path — don't collapse directly under craft as often
          if (Math.hypot(t.x - craftX.current, t.z - craftZ.current) > 7) {
            t.drop = 0.01;
            addBlast(t.x, 0.4, t.z);
            shakeRef.current = Math.max(shakeRef.current, 0.4);
            setFailCue(true);
          }
        }
        if (t.drop > 0) {
          t.drop += clamped * (2 + progress * 2.2);
          if (t.drop > 9) t.gone = true;
        }
      }

      const under = tiles.current.find(
        (t) => !t.gone && Math.abs(t.x - craftX.current) < TILE * 0.55 && Math.abs(t.z - craftZ.current) < TILE * 0.55,
      );
      if (!under || under.drop > 1.4) falling.current = true;
      if (falling.current) {
        craftY.current -= 12 * clamped;
        if (craftY.current < -5) {
          falling.current = false;
          craftY.current = 1.4;
          hurt(1);
          const solid = tiles.current.find(
            (t) => !t.gone && t.drop < 0.2 && Math.abs(t.z - craftZ.current) < 14,
          );
          if (solid) {
            craftX.current = solid.x;
            craftZ.current = solid.z;
          }
        }
      } else {
        craftY.current = THREE.MathUtils.damp(craftY.current, 1.4, 10, clamped);
      }

      // Meteors across the plane
      meteorAcc.current += clamped;
      const meteorEvery = Math.max(0.32, 1.0 - progress * 0.65);
      if (meteorAcc.current >= meteorEvery) {
        meteorAcc.current = 0;
        meteors.current.push({
          id: nextId.current++,
          x: craftX.current + (Math.random() - 0.5) * 28,
          y: 16 + Math.random() * 8,
          z: craftZ.current - 12 - Math.random() * 30,
          vx: (Math.random() - 0.5) * 3,
          vy: -16 - progress * 12,
          vz: 3 + Math.random() * 5,
        });
      }
      for (const m of meteors.current) {
        m.x += m.vx * clamped;
        m.y += m.vy * clamped;
        m.z += m.vz * clamped;
        if (m.y < 0.35) {
          addBlast(m.x, 0.5, m.z);
          shakeRef.current = Math.max(shakeRef.current, 0.38);
          const hit = tiles.current.find(
            (t) => !t.gone && Math.abs(t.x - m.x) < TILE * 0.7 && Math.abs(t.z - m.z) < TILE * 0.7,
          );
          if (hit && hit.drop === 0) hit.drop = 0.01;
          m.y = -99;
        }
        if (Math.hypot(m.x - craftX.current, m.z - craftZ.current) < 1.6 && m.y < 2.4 && m.y > 0) {
          hurt(1);
          m.y = -99;
          addBlast(craftX.current, craftY.current, craftZ.current);
        }
      }
      meteors.current = meteors.current.filter((m) => m.y > -20 && m.z < craftZ.current + 35);

      // Aliens for the turret
      alienAcc.current += clamped;
      if (alienAcc.current >= Math.max(0.5, 1.35 - progress * 0.8)) {
        alienAcc.current = 0;
        aliens.current.push({
          id: nextId.current++,
          x: (Math.random() - 0.5) * 36,
          y: 7 + Math.random() * 10,
          z: craftZ.current - 25 - Math.random() * 45,
          hp: 2,
        });
      }

      fireCd.current = Math.max(0, fireCd.current - clamped);
      const gunIsAi = gunnerIdRef.current === "ai";

      if (gunIsAi && aliens.current[0] && fireCd.current <= 0) {
        const t = aliens.current[0];
        const dx = t.x - TURRET[0];
        const dy = t.y - TURRET[1];
        const dz = t.z - TURRET[2];
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

      if (!gunIsAi) {
        if (seatRef.current === "gunner") {
          gunYaw.current -= lookQ.current.x * 0.0022;
          gunPitch.current = Math.max(-1.1, Math.min(0.5, gunPitch.current - lookQ.current.y * 0.002));
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
          fireCd.current = 0.15;
        }
      }

      if (!gunIsAi && seatRef.current === "gunner" && !isHost) {
        gunYaw.current -= lookQ.current.x * 0.0022;
        gunPitch.current = Math.max(-1.1, Math.min(0.5, gunPitch.current - lookQ.current.y * 0.002));
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
        b.x += b.dx * 58 * clamped;
        b.y += b.dy * 58 * clamped;
        b.z += b.dz * 58 * clamped;
      }
      for (const a of aliens.current) {
        a.x += (craftX.current - a.x) * 0.3 * clamped;
        a.y += (2 - a.y) * 0.22 * clamped;
        a.z += (craftZ.current - a.z) * 0.4 * clamped + 5 * clamped;
        for (const b of bullets.current) {
          if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1.4) {
            a.hp -= 1;
            b.z = 999;
            addBlast(a.x, a.y, a.z);
          }
        }
        if (Math.hypot(a.x - craftX.current, a.z - craftZ.current) < 1.8 && a.y < 2.8) {
          hurt(1);
          a.hp = 0;
          addBlast(craftX.current, craftY.current, craftZ.current);
        }
      }
      aliens.current = aliens.current.filter((a) => a.hp > 0 && a.z < craftZ.current + 30);
      bullets.current = bullets.current.filter((b) => b.z > END_Z - 20 && b.y > -5 && b.y < 45);

      invuln.current = Math.max(0, invuln.current - clamped);
      for (const bl of blasts.current) bl.age += clamped;
      blasts.current = blasts.current.filter((b) => b.age < 0.55);

      if (craftZ.current <= END_Z) setPhaseBoth("won");

      snapAcc.current += clamped;
      if (!instanceId.startsWith("local:") && snapAcc.current >= 1 / 15) {
        snapAcc.current = 0;
        emitMinigame(instanceId, "sky-escort", {
          type: "snap",
          phase: phaseRef.current,
          hull: hullRef.current,
          craftX: craftX.current,
          craftZ: craftZ.current,
          craftY: craftY.current,
          tiles: tiles.current.map((t) => ({ ...t })),
          meteors: meteors.current.map((m) => ({ ...m })),
          aliens: aliens.current.map((a) => ({ ...a })),
          blasts: blasts.current.map((b) => ({ ...b })),
          shake: shakeRef.current,
          driverId: driverIdRef.current,
          gunnerId: gunnerIdRef.current,
        } satisfies Snap);
      }
      remoteInput.current = null;
    }

    if (phaseRef.current === "run" && !isHost && seatRef.current === "gunner") {
      gunYaw.current -= lookQ.current.x * 0.0022;
      gunPitch.current = Math.max(-1.1, Math.min(0.5, gunPitch.current - lookQ.current.y * 0.002));
      lookQ.current.x *= 0.2;
      lookQ.current.y *= 0.2;
    }

    shakeRef.current = Math.max(0, shakeRef.current - clamped * 1.5);

    if (craft.current) {
      craft.current.position.set(craftX.current, Math.max(craftY.current, -3), craftZ.current);
      craft.current.rotation.y = craftYaw.current;
      craft.current.rotation.z = craftYaw.current * 0.65;
    }

    syncGroup(tileGroup.current, tiles.current, (t, mesh) => {
      mesh.visible = !t.gone;
      mesh.position.set(t.x, -t.drop, t.z);
      mesh.rotation.z = t.drop > 0 ? t.drop * 0.08 * Math.sign(t.x || 1) : 0;
      mesh.material = t.drop > 0 ? mats.roadHot : mats.road;
      mesh.scale.set(TILE * 0.92, 0.32, TILE * 0.92);
    }, () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats.road));

    syncGroup(meteorGroup.current, meteors.current, (m, mesh) => {
      mesh.visible = m.y > -10;
      mesh.position.set(m.x, m.y, m.z);
      mesh.scale.setScalar(0.95);
    }, () => new THREE.Mesh(new THREE.DodecahedronGeometry(0.55), mats.meteor));

    syncGroup(alienGroup.current, aliens.current, (a, mesh) => {
      mesh.visible = true;
      mesh.position.set(a.x, a.y, a.z);
      mesh.scale.set(1.3, 0.55, 1.7);
    }, () => new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 5), mats.alien));

    syncGroup(bulletGroup.current, bullets.current, (b, mesh) => {
      mesh.visible = true;
      mesh.position.set(b.x, b.y, b.z);
    }, () => new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), mats.bullet));

    syncGroup(blastGroup.current, blasts.current, (b, mesh) => {
      mesh.visible = b.age < 0.55;
      mesh.position.set(b.x, b.y, b.z);
      mesh.scale.setScalar(0.4 + b.age * 6);
      (mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.75 - b.age * 1.4);
    }, () => new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), mats.blast.clone()));

    // Cameras — snap firm on ready, chase on run
    const sh = shakeRef.current;
    const ox = (Math.random() - 0.5) * sh;
    const oy = (Math.random() - 0.5) * sh;
    if (seatRef.current === "gunner" && phaseRef.current !== "ready") {
      const cy = Math.cos(gunYaw.current);
      const sy = Math.sin(gunYaw.current);
      const cp = Math.cos(gunPitch.current);
      const sp = Math.sin(gunPitch.current);
      camera.position.set(TURRET[0] + ox * 0.25, TURRET[1] + 0.4 + oy * 0.25, TURRET[2]);
      camera.lookAt(TURRET[0] + sy * cp * 24, TURRET[1] + sp * 24, TURRET[2] - cy * cp * 24);
    } else {
      const tx = craftX.current;
      const ty = craftY.current + 5.2;
      const tz = craftZ.current + 13;
      if (phaseRef.current === "ready") {
        camera.position.set(tx, ty + 2, tz + 4);
        camera.lookAt(tx, 1, craftZ.current - 20);
      } else {
        camera.position.x = THREE.MathUtils.damp(camera.position.x, tx + ox, 7, clamped);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, ty + oy, 7, clamped);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, tz, 7, clamped);
        camera.lookAt(craftX.current, 1.3, craftZ.current - 16);
      }
    }
  });

  return (
    <group>
      <color attach="background" args={["#140806"]} />
      <fog attach="fog" args={["#140806", 35, 110]} />
      <ambientLight intensity={0.32} />
      <directionalLight position={[10, 22, 8]} intensity={0.9} color="#ffcc80" />
      <pointLight position={[craftX.current, 8, craftZ.current]} color="#ff6a00" intensity={28} distance={55} />
      <pointLight position={TURRET} color={color} intensity={22} distance={45} />

      {Array.from({ length: 28 }, (_, i) => (
        <mesh key={i} position={[(i % 7) * 6 - 18, 1.5 + (i % 4), -i * 3.2]}>
          <sphereGeometry args={[0.05, 4, 4]} />
          <meshBasicMaterial color="#ffab40" />
        </mesh>
      ))}

      <group position={TURRET}>
        <mesh position={[0, -2, 0]}>
          <cylinderGeometry args={[2.6, 3.1, 4, 8]} />
          <meshStandardMaterial color="#3e2723" roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.15, 0]}>
          <boxGeometry args={[1.8, 0.55, 1.8]} />
          <meshStandardMaterial color="#5d4037" metalness={0.45} />
        </mesh>
        <mesh position={[0, 0.5, -0.5]} rotation={[0.25, 0, 0]}>
          <cylinderGeometry args={[0.14, 0.18, 2.1, 8]} />
          <meshStandardMaterial color="#efebe9" metalness={0.65} />
        </mesh>
      </group>

      <mesh position={[0, 3, START_Z + 3]}>
        <boxGeometry args={[18, 6, 0.5]} />
        <meshStandardMaterial color="#4e342e" emissive={color} emissiveIntensity={0.25} />
      </mesh>
      <mesh position={[0, 3.5, END_Z - 1]}>
        <boxGeometry args={[20, 7, 0.6]} />
        <meshStandardMaterial color="#ffe082" emissive="#ffd54f" emissiveIntensity={1.15} />
      </mesh>

      <group ref={tileGroup} />
      <group ref={meteorGroup} />
      <group ref={alienGroup} />
      <group ref={bulletGroup} />
      <group ref={blastGroup} />

      <group ref={craft} position={[0, 1.4, START_Z]}>
        {/* Wide plane / hauler silhouette */}
        <mesh rotation={[0.05, 0, 0]}>
          <boxGeometry args={[2.8, 0.35, 4.2]} />
          <meshStandardMaterial color="#3e2723" metalness={0.35} roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.35, -0.2]}>
          <boxGeometry args={[1.2, 0.55, 2.2]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.6} />
        </mesh>
        <mesh position={[-1.8, 0, 0.2]} rotation={[0, 0, 0.15]}>
          <boxGeometry args={[1.6, 0.12, 1.1]} />
          <meshStandardMaterial color="#5d4037" />
        </mesh>
        <mesh position={[1.8, 0, 0.2]} rotation={[0, 0, -0.15]}>
          <boxGeometry args={[1.6, 0.12, 1.1]} />
          <meshStandardMaterial color="#5d4037" />
        </mesh>
        <mesh position={[0, 0.15, 2.1]}>
          <sphereGeometry args={[0.35, 12, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.8} />
        </mesh>
        <pointLight color={color} intensity={10} distance={14} />
      </group>

      <Html fullscreen style={{ pointerEvents: phase === "ready" ? "auto" : "none" }}>
        <div className="sky-escort-hud">
          <div className="sky-escort-card">
            <em>last road out</em>
            <strong>Sky Escort</strong>
            {phase === "ready" && (
              <>
                <p>
                  You’re the <b>{seat === "driver" ? "PILOT" : "GUNNER"}</b>
                </p>
                <p className="sky-escort-hint">
                  {seat === "driver"
                    ? "Fly the hauler across the collapsing plane — WASD steer · reach the far gate"
                    : "Click to aim · hold fire on inbound ships while the plane falls apart"}
                </p>
                <div className="sky-escort-actions">
                  <button type="button" className={seat === "driver" ? "on" : ""} onClick={() => pickSeat("driver")}>
                    Pilot
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
                      resetRun(role);
                      emitMinigame(instanceId, "sky-escort", {
                        type: "role",
                        driverId: role === "driver" ? selfId : "ai",
                        gunnerId:
                          role === "gunner" ? selfId : Object.values(players).find((x) => x.id !== selfId)?.id ?? "ai",
                        phase: "run",
                      } satisfies RoleMsg);
                    }}
                  >
                    Launch
                  </button>
                </div>
                <p className="sky-escort-hint">Space / Enter also launches · Tab swaps seat · Return in HUD leaves</p>
              </>
            )}
            {phase === "run" && (
              <>
                <p>
                  {seat === "driver" ? "PILOT" : "GUNNER"} · hull {"♥".repeat(hull)}
                  {"♡".repeat(Math.max(0, HULL_MAX - hull))} · {hudDist}m to gate
                </p>
                {failCue ? <p className="sky-escort-alert">PLANE BREAKING UP</p> : null}
                <p className="sky-escort-hint">
                  {seat === "driver" ? "WASD fly the plane · dodge meteors & voids" : "Mouse aim · click / Space fire"}
                </p>
              </>
            )}
            {phase === "won" && <p className="sky-escort-alert">Gate reached — Space to run it back</p>}
            {phase === "dead" && <p>Hauler down — Space to retry</p>}
          </div>
        </div>
      </Html>
    </group>
  );
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
