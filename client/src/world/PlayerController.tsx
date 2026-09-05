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
  favoriteSlotPose,
  portalSlotPose,
} from "@holojay/shared";
import { pad } from "../inputPad.ts";
import { emitEnter, emitLeave, emitLoopComplete, emitMove, emitPin, emitUnpin } from "../net/session.ts";
import { useGame } from "../state/store.ts";
import { voice } from "../voice/proximity.ts";
import { Orb } from "./Orb.tsx";

const keys = new Set<string>();
const up = new THREE.Vector3(0, 1, 0);
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const camPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const desired = new THREE.Vector3();

function tryInteract() {
  const state = useGame.getState();
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
  const dragging = useRef(false);
  const dragButton = useRef(0);
  const dragDist = useRef(0);
  const { camera, gl } = useThree();
  const user = useGame((s) => s.user);
  const location = useGame((s) => s.location);
  const loopCount = useGame((s) => s.loopCount);
  const lastChat = useGame((s) => s.lastChat);
  const selfId = useGame((s) => s.selfId);
  const ptt = useGame((s) => s.ptt);

  useEffect(() => {
    pos.current.set(...spawn);
    if (group.current) group.current.position.copy(pos.current);
  }, [spawn, location]);

  useEffect(() => {
    loopSent.current = false;
  }, [loopCount]);

  useEffect(() => {
    const el = gl.domElement;
    const orbit = (dx: number, dy: number) => {
      yaw.current -= dx * 0.003;
      pitch.current = Math.max(-1.15, Math.min(1.32, pitch.current - dy * 0.0026));
    };

    const down = (e: KeyboardEvent) => {
      keys.add(e.code);
      const state = useGame.getState();
      if (state.chatOpen) return;
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
      if (e.code === "KeyC") {
        if (document.pointerLockElement === el) document.exitPointerLock();
        else void el.requestPointerLock();
      }
    };
    const upKey = (e: KeyboardEvent) => {
      keys.delete(e.code);
      if (e.code === "KeyV") {
        voice.setPtt(false);
        useGame.getState().setPtt(false);
      }
    };

    const pointerDown = (e: PointerEvent) => {
      if (useGame.getState().chatOpen) return;
      if (e.button !== 0 && e.button !== 2) return;
      dragging.current = true;
      dragButton.current = e.button;
      dragDist.current = 0;
      el.setPointerCapture(e.pointerId);
      useGame.getState().setPointerLocked(true);
    };
    const pointerUp = (e: PointerEvent) => {
      if (!dragging.current) return;
      const wasDrag = dragDist.current > 8;
      const button = dragButton.current;
      dragging.current = false;
      useGame.getState().setPointerLocked(false);
      // Short left-click near a cabinet = play (mouse-friendly)
      if (button === 0 && !wasDrag && !useGame.getState().chatOpen) {
        tryInteract();
      }
    };
    const pointerMove = (e: PointerEvent) => {
      if (useGame.getState().chatOpen) return;
      if (document.pointerLockElement === el) {
        orbit(e.movementX, e.movementY);
        return;
      }
      if (!dragging.current) return;
      dragDist.current += Math.abs(e.movementX) + Math.abs(e.movementY);
      orbit(e.movementX, e.movementY);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      // Two-finger scroll / mouse wheel = zoom
      zoom.current = Math.max(3.4, Math.min(18, zoom.current + Math.sign(e.deltaY) * 0.7));
    };
    const lock = () => {
      // Only treat real pointer-lock as sticky look mode
      if (document.pointerLockElement === el) useGame.getState().setPointerLocked(true);
    };
    const blockMenu = (e: Event) => e.preventDefault();

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", upKey);
    el.addEventListener("pointerdown", pointerDown);
    el.addEventListener("pointerup", pointerUp);
    el.addEventListener("pointercancel", pointerUp);
    el.addEventListener("pointermove", pointerMove);
    el.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("pointerlockchange", lock);
    el.addEventListener("contextmenu", blockMenu);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", upKey);
      el.removeEventListener("pointerdown", pointerDown);
      el.removeEventListener("pointerup", pointerUp);
      el.removeEventListener("pointercancel", pointerUp);
      el.removeEventListener("pointermove", pointerMove);
      el.removeEventListener("wheel", wheel);
      document.removeEventListener("pointerlockchange", lock);
      el.removeEventListener("contextmenu", blockMenu);
      keys.clear();
    };
  }, [gl]);

  useFrame((_, dt) => {
    const state = useGame.getState();
    const g = group.current;
    if (!g) return;

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
    const maxR = state.location.type === "hub" ? 72 : 12;
    if (radial > maxR) {
      const s = maxR / radial;
      pos.current.x *= s;
      pos.current.z *= s;
    }

    g.position.copy(pos.current);
    g.rotation.y = Math.atan2(fwd.x, fwd.z);

    const cp = Math.cos(pitch.current);
    camPos.set(
      pos.current.x + Math.sin(yaw.current) * cp * zoom.current,
      pos.current.y + 0.55 + Math.sin(pitch.current) * zoom.current,
      pos.current.z + Math.cos(yaw.current) * cp * zoom.current,
    );
    desired.copy(camPos);
    camera.position.lerp(desired, 1 - Math.exp(-10 * dt));
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
    if (state.location.type === "game") {
      const door = { x: 0, y: 1.1, z: -8 };
      const d = dist3(here, door);
      if (d < bestD) best = { source: "return", slot: 0, gameId: state.location.gameId };
    } else {
      for (const assignment of state.assignments) {
        const pose = portalSlotPose(assignment.slot);
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
    }
    const cur = state.nearby;
    const sameNear =
      (!cur && !best) ||
      (cur && best && cur.source === best.source && cur.slot === best.slot && cur.gameId === best.gameId);
    if (!sameNear) useGame.getState().setNearby(best);
  });

  if (!user) return null;
  const mine = selfId ? lastChat[selfId] : undefined;
  const live = mine && Date.now() - mine.at < 5000 ? mine.text : undefined;

  return (
    <group ref={group} position={spawn}>
      <Orb color={user.color} username={user.username} speaking={ptt} chat={live} local />
    </group>
  );
}
