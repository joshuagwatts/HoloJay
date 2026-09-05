import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  CHECKPOINT_COUNT,
  CHECKPOINT_RANGE,
  MOVE_HZ,
  PORTAL_INTERACT_RANGE,
  checkpointPose,
  dist3,
  distXZ,
  dresserHatSlotPose,
  favoriteSlotPose,
  portalSlotPose,
} from "@holojay/shared";
import { isPadMoving, pad, setOnPadRelease } from "../inputPad.ts";
import { wearHat } from "../net/localRealm.ts";
import { emitEnter, emitLeave, emitLoopComplete, emitMove, emitPin, emitUnpin } from "../net/session.ts";
import { useGame } from "../state/store.ts";
import { voice } from "../voice/proximity.ts";
import { Orb } from "./Orb.tsx";

const HAT_INTERACT_RANGE = 2.4;

const keys = new Set<string>();
const MOVE_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "ShiftLeft",
  "ShiftRight",
  "KeyQ",
]);
const up = new THREE.Vector3(0, 1, 0);
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const camPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const desired = new THREE.Vector3();
const FLOOR_CAM_Y = 0.4;
const LOOK_SENS_KEY = "holojay.lookSens";

function minPitchForFloor(orbY: number, zoomDist: number) {
  const pivotY = orbY + 0.55;
  const minSin = (FLOOR_CAM_Y - pivotY) / Math.max(zoomDist, 0.01);
  return Math.asin(Math.max(-0.999, Math.min(0.999, minSin)));
}

/** Amplify tiny trackpad ticks without making big mouse flicks wild. */
function scaleLookDelta(d: number) {
  const a = Math.abs(d);
  if (a < 0.01) return 0;
  const gain = a <= 1.5 ? 2.8 : a <= 4 ? 2.1 : a <= 10 ? 1.35 : 1.05;
  return Math.sign(d) * a * gain;
}

function loadLookSens() {
  const n = Number(localStorage.getItem(LOOK_SENS_KEY));
  return Number.isFinite(n) && n > 0 ? Math.min(3, Math.max(0.35, n)) : 1;
}

function isKeyboardMoving() {
  for (const code of MOVE_KEYS) {
    if (keys.has(code)) return true;
  }
  return false;
}

function tryInteract() {
  const state = useGame.getState();
  if (state.nearbyHat) {
    wearHat(state.nearbyHat.hatId);
    return;
  }
  const near = state.nearby;
  if (!near) return;
  if (near.source === "return") emitLeave();
  else emitEnter(near.source, near.slot, near.gameId);
}

function tryFavorite() {
  const state = useGame.getState();
  const near = state.nearby;
  if (!near || near.source === "return") return;
  if (near.source === "favorite") emitUnpin(near.gameId);
  else emitPin(near.gameId);
}

export function PlayerController({ spawn }: { spawn: [number, number, number] }) {
  const group = useRef<THREE.Group>(null);
  const pos = useRef(new THREE.Vector3(...spawn));
  const yaw = useRef(0.35);
  const pitch = useRef(0.28);
  const zoom = useRef(8.2);
  const sendAcc = useRef(0);
  const loopSent = useRef(false);
  const lookQueueX = useRef(0);
  const lookQueueY = useRef(0);
  const lookSens = useRef(loadLookSens());
  const { camera, gl } = useThree();
  const user = useGame((s) => s.user);
  const location = useGame((s) => s.location);
  const loopCount = useGame((s) => s.loopCount);
  const lastChat = useGame((s) => s.lastChat);
  const selfId = useGame((s) => s.selfId);
  const ptt = useGame((s) => s.ptt);
  const wornHatId = useGame((s) => s.wornHatId);
  const inMagic = location.type === "game" && location.gameId === "magic-room";

  useEffect(() => {
    pos.current.set(...spawn);
    if (group.current) group.current.position.copy(pos.current);
  }, [spawn, location]);

  useEffect(() => {
    loopSent.current = false;
  }, [loopCount]);

  useEffect(() => {
    const el = gl.domElement;
    const tryRelock = () => {
      if (useGame.getState().chatOpen) return;
      if (document.pointerLockElement === el) return;
      void el.requestPointerLock().catch(() => {
        /* browser may require a fresh click */
      });
    };

    // After using the on-screen pad, grab mouse look again so rotate keeps working mid-flight
    setOnPadRelease(() => {
      window.setTimeout(tryRelock, 0);
    });

    const down = (e: KeyboardEvent) => {
      keys.add(e.code);
      const state = useGame.getState();
      if (state.chatOpen) return;
      if (MOVE_KEYS.has(e.code)) tryRelock();
      if (e.repeat) return;
      if (e.code === "KeyV") {
        e.preventDefault();
        void voice
          .ensureMic()
          .then(() => {
            useGame.getState().setMicReady(true);
            voice.setPtt(true);
            useGame.getState().setPtt(true);
          })
          .catch(() => useGame.getState().setNotice("Mic permission denied"));
      }
      if (e.code === "KeyE") tryInteract();
      if (e.code === "KeyF") tryFavorite();
      if (e.code === "BracketLeft" || e.code === "Minus") {
        lookSens.current = Math.max(0.35, lookSens.current - 0.15);
        localStorage.setItem(LOOK_SENS_KEY, String(lookSens.current));
        useGame.getState().setNotice(`Look sens ${lookSens.current.toFixed(2)}`);
        window.setTimeout(() => {
          if (useGame.getState().notice?.startsWith("Look sens")) useGame.getState().setNotice(null);
        }, 1400);
      }
      if (e.code === "BracketRight" || e.code === "Equal") {
        lookSens.current = Math.min(3, lookSens.current + 0.15);
        localStorage.setItem(LOOK_SENS_KEY, String(lookSens.current));
        useGame.getState().setNotice(`Look sens ${lookSens.current.toFixed(2)}`);
        window.setTimeout(() => {
          if (useGame.getState().notice?.startsWith("Look sens")) useGame.getState().setNotice(null);
        }, 1400);
      }
      if (e.code === "Escape" && document.pointerLockElement === el) {
        document.exitPointerLock();
      }
    };
    const upKey = (e: KeyboardEvent) => {
      keys.delete(e.code);
      if (e.code === "KeyV") {
        voice.setPtt(false);
        useGame.getState().setPtt(false);
      }
    };

    const click = () => {
      if (useGame.getState().chatOpen) return;
      if (document.pointerLockElement !== el) void el.requestPointerLock();
    };
    const mouseMove = (e: MouseEvent) => {
      if (useGame.getState().chatOpen) return;
      const locked = document.pointerLockElement === el;
      // While flying, still accept deltas if the browser keeps sending them without lock
      if (!locked && !isKeyboardMoving() && !isPadMoving()) return;
      if (!locked && (e.movementX === 0 && e.movementY === 0)) return;
      lookQueueX.current += scaleLookDelta(e.movementX);
      lookQueueY.current += scaleLookDelta(e.movementY);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (useGame.getState().chatOpen) return;
      const ax = Math.abs(e.deltaX);
      const ay = Math.abs(e.deltaY);
      const moving = isKeyboardMoving() || isPadMoving();
      const locked = document.pointerLockElement === el;
      // Two-finger trackpad pan steers while moving (palm rejection often kills one-finger look)
      if (moving || ax > ay * 1.15) {
        lookQueueX.current += scaleLookDelta(e.deltaX * 0.75);
        lookQueueY.current += scaleLookDelta(e.deltaY * 0.75);
        if (moving) return;
      }
      if (locked && ax > 2 && ax > ay) {
        lookQueueX.current += scaleLookDelta(e.deltaX * 0.75);
        return;
      }
      const step = Math.abs(e.deltaY) > 40 ? Math.sign(e.deltaY) * 0.85 : e.deltaY * 0.02;
      zoom.current = Math.max(3.4, Math.min(18, zoom.current + step));
    };
    const lockChange = () => {
      useGame.getState().setPointerLocked(document.pointerLockElement === el);
      // Don't wipe the look queue — clearing it mid-move made rotate feel "dead" until click
    };
    const blockMenu = (e: Event) => e.preventDefault();

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", upKey);
    el.addEventListener("click", click);
    document.addEventListener("mousemove", mouseMove);
    window.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("pointerlockchange", lockChange);
    el.addEventListener("contextmenu", blockMenu);
    return () => {
      setOnPadRelease(null);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", upKey);
      el.removeEventListener("click", click);
      document.removeEventListener("mousemove", mouseMove);
      window.removeEventListener("wheel", wheel);
      document.removeEventListener("pointerlockchange", lockChange);
      el.removeEventListener("contextmenu", blockMenu);
      keys.clear();
    };
  }, [gl]);

  useFrame((_, dt) => {
    const state = useGame.getState();
    const g = group.current;
    if (!g) return;

    // Smooth look apply — helps choppy trackpad reports
    const lx = lookQueueX.current;
    const ly = lookQueueY.current;
    lookQueueX.current *= 0.28;
    lookQueueY.current *= 0.28;
    if (Math.abs(lookQueueX.current) < 0.01) lookQueueX.current = 0;
    if (Math.abs(lookQueueY.current) < 0.01) lookQueueY.current = 0;
    if (lx || ly) {
      const sens = lookSens.current;
      yaw.current -= lx * 0.0024 * sens;
      const next = pitch.current - ly * 0.002 * sens;
      const floorPitch = minPitchForFloor(pos.current.y, zoom.current);
      pitch.current = Math.max(floorPitch, Math.min(1.32, next));
    }

    camera.getWorldDirection(fwd);
    right.crossVectors(fwd, up);
    if (right.lengthSq() < 0.0001) {
      right.set(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
    } else {
      right.normalize();
    }

    const chatBlock = state.chatOpen;
    const sprint = keys.has("KeyQ") || pad.sprint;
    const moveSpeed = sprint ? 22 : 14;
    if (!chatBlock) {
      let f = pad.forward;
      let r = pad.right;
      let u = pad.up;
      if (keys.has("KeyW") || keys.has("ArrowUp")) f += 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) f -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) r += 1;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) r -= 1;
      if (keys.has("Space")) u += 1;
      if (keys.has("ShiftLeft") || keys.has("ShiftRight")) u -= 1;
      f = Math.max(-1, Math.min(1, f));
      r = Math.max(-1, Math.min(1, r));
      u = Math.max(-1, Math.min(1, u));
      if (f || r || u) {
        pos.current.addScaledVector(fwd, f * moveSpeed * dt);
        pos.current.addScaledVector(right, r * moveSpeed * dt);
        pos.current.y += u * 9 * dt;
      }
    }
    pos.current.y = Math.max(0.5, Math.min(22, pos.current.y));
    const radial = Math.hypot(pos.current.x, pos.current.z);
    const maxR = state.location.type === "hub" ? 72 : state.location.gameId === "magic-room" ? 16 : 12;
    if (radial > maxR) {
      const s = maxR / radial;
      pos.current.x *= s;
      pos.current.z *= s;
    }

    g.position.copy(pos.current);
    g.rotation.y = Math.atan2(fwd.x, fwd.z);

    // Keep orbit above the floor as height / zoom change
    pitch.current = Math.max(minPitchForFloor(pos.current.y, zoom.current), Math.min(1.32, pitch.current));

    const cp = Math.cos(pitch.current);
    camPos.set(
      pos.current.x + Math.sin(yaw.current) * cp * zoom.current,
      pos.current.y + 0.55 + Math.sin(pitch.current) * zoom.current,
      pos.current.z + Math.cos(yaw.current) * cp * zoom.current,
    );
    desired.copy(camPos);
    desired.y = Math.max(FLOOR_CAM_Y, desired.y);
    camera.position.lerp(desired, 1 - Math.exp(-10 * dt));
    camera.position.y = Math.max(FLOOR_CAM_Y, camera.position.y);
    lookAt.set(pos.current.x, pos.current.y + 0.25, pos.current.z);
    camera.lookAt(lookAt);

    sendAcc.current += dt;
    if (sendAcc.current >= 1 / MOVE_HZ) {
      sendAcc.current = 0;
      emitMove({ x: pos.current.x, y: pos.current.y, z: pos.current.z }, g.rotation.y);
      useGame.getState().setLocalPos({ x: pos.current.x, y: pos.current.y, z: pos.current.z });
    }

    const here = { x: pos.current.x, y: pos.current.y, z: pos.current.z };
    voice.updateListener(here, g.rotation.y);
    for (const player of Object.values(state.players)) {
      if (player.id === state.selfId) continue;
      const same =
        (state.location.type === "hub" && player.location.type === "hub") ||
        (state.location.type === "game" &&
          player.location.type === "game" &&
          player.location.instanceId === state.location.instanceId);
      voice.updatePeer(player.id, player.position, same);
    }

    if (state.location.type === "hub") {
      for (let i = 0; i < CHECKPOINT_COUNT; i += 1) {
        if (distXZ(here, checkpointPose(i).position) < CHECKPOINT_RANGE) {
          const done = state.markCheckpoint(i);
          if (done && !loopSent.current) {
            loopSent.current = true;
            emitLoopComplete();
          }
        }
      }
    }

    let best: typeof state.nearby = null;
    let bestD = PORTAL_INTERACT_RANGE;
    let bestHat: typeof state.nearbyHat = null;
    let bestHatD = HAT_INTERACT_RANGE;
    if (state.location.type === "game") {
      const door = { x: 0, y: 1.1, z: -8 };
      const d = dist3(here, door);
      if (d < bestD) best = { source: "return", slot: 0, gameId: state.location.gameId };
    } else {
      for (const assignment of state.assignments) {
        const pose = portalSlotPose(assignment.slot, state.assignments.length);
        const mid = { x: pose.position.x, y: 1.1, z: pose.position.z };
        const d = dist3(here, mid);
        if (d < bestD) {
          bestD = d;
          best = { source: "path", slot: assignment.slot, gameId: assignment.gameId };
        }
      }
      for (const fav of state.favorites) {
        const pose = favoriteSlotPose(fav.slot);
        const mid = { x: pose.position.x, y: 1.1, z: pose.position.z };
        const d = dist3(here, mid);
        if (d < bestD) {
          bestD = d;
          best = { source: "favorite", slot: fav.slot, gameId: fav.gameId };
        }
      }
      const total = state.dresserHats.length;
      for (let slot = 0; slot < total; slot += 1) {
        const hatId = state.dresserHats[slot];
        const pose = dresserHatSlotPose(slot, total);
        const d = dist3(here, pose.position);
        if (d < bestHatD) {
          bestHatD = d;
          bestHat = { hatId, slot };
        }
      }
    }
    const cur = state.nearby;
    const sameNear =
      (!cur && !best) ||
      (cur && best && cur.source === best.source && cur.slot === best.slot && cur.gameId === best.gameId);
    if (!sameNear) useGame.getState().setNearby(best);
    const curHat = state.nearbyHat;
    const sameHat =
      (!curHat && !bestHat) ||
      (curHat && bestHat && curHat.hatId === bestHat.hatId && curHat.slot === bestHat.slot);
    if (!sameHat) useGame.getState().setNearbyHat(bestHat);
  });

  if (!user) return null;
  const mine = selfId ? lastChat[selfId] : undefined;
  const live = mine && Date.now() - mine.at < 5000 ? mine.text : undefined;

  return (
    <group ref={group} position={spawn}>
      <Orb
        color={user.color}
        username={user.username}
        speaking={ptt}
        chat={live}
        local
        hatId={wornHatId}
        trails={inMagic}
      />
    </group>
  );
}
