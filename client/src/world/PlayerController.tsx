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

export function PlayerController({ spawn }: { spawn: [number, number, number] }) {
  const group = useRef<THREE.Group>(null);
  const pos = useRef(new THREE.Vector3(...spawn));
  const yaw = useRef(0.35);
  const pitch = useRef(0.28);
  const zoom = useRef(8.2);
  const sendAcc = useRef(0);
  const loopSent = useRef(false);
  const dragging = useRef(false);
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
      yaw.current -= dx * 0.0024;
      pitch.current = Math.max(-1.15, Math.min(1.32, pitch.current - dy * 0.0021));
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
      if (e.code === "KeyE") {
        const near = state.nearby;
        if (!near) return;
        if (near.source === "return") emitLeave();
        else emitEnter(near.source, near.slot, near.gameId);
      }
      if (e.code === "KeyF") {
        const near = state.nearby;
        if (!near || near.source === "return") return;
        if (near.source === "favorite") emitUnpin(near.gameId);
        else emitPin(near.gameId);
      }
    };
    const upKey = (e: KeyboardEvent) => {
      keys.delete(e.code);
      if (e.code === "KeyV") {
        voice.setPtt(false);
        useGame.getState().setPtt(false);
      }
    };
    const click = (e: MouseEvent) => {
      if (useGame.getState().chatOpen) return;
      if (e.button === 0) el.requestPointerLock();
    };
    const pointerDown = (e: PointerEvent) => {
      if (e.button === 2 && !useGame.getState().chatOpen) {
        dragging.current = true;
        el.setPointerCapture(e.pointerId);
      }
    };
    const pointerUp = (e: PointerEvent) => {
      if (e.button === 2) dragging.current = false;
    };
    const move = (e: MouseEvent) => {
      if (useGame.getState().chatOpen) return;
      if (document.pointerLockElement === el || dragging.current) {
        orbit(e.movementX, e.movementY);
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom.current = Math.max(3.4, Math.min(18, zoom.current + Math.sign(e.deltaY) * 0.7));
    };
    const lock = () => useGame.getState().setPointerLocked(document.pointerLockElement === el);
    const blockMenu = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", upKey);
    el.addEventListener("click", click);
    el.addEventListener("pointerdown", pointerDown);
    el.addEventListener("pointerup", pointerUp);
    el.addEventListener("pointercancel", pointerUp);
    document.addEventListener("mousemove", move);
    el.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("pointerlockchange", lock);
    el.addEventListener("contextmenu", blockMenu);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", upKey);
      el.removeEventListener("click", click);
      el.removeEventListener("pointerdown", pointerDown);
      el.removeEventListener("pointerup", pointerUp);
      el.removeEventListener("pointercancel", pointerUp);
      document.removeEventListener("mousemove", move);
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
    const moveSpeed = keys.has("KeyQ") ? 22 : 14;
    if (!chatBlock) {
      if (keys.has("KeyW") || keys.has("ArrowUp")) pos.current.addScaledVector(fwd, moveSpeed * dt);
      if (keys.has("KeyS") || keys.has("ArrowDown")) pos.current.addScaledVector(fwd, -moveSpeed * dt);
      if (keys.has("KeyD") || keys.has("ArrowRight")) pos.current.addScaledVector(right, moveSpeed * dt);
      if (keys.has("KeyA") || keys.has("ArrowLeft")) pos.current.addScaledVector(right, -moveSpeed * dt);
      if (keys.has("Space")) pos.current.y += 9 * dt;
      if (keys.has("ShiftLeft") || keys.has("ShiftRight")) pos.current.y -= 9 * dt;
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
        const d = dist3(here, pose.position);
        if (d < bestD) {
          bestD = d;
          best = { source: "path", slot: assignment.slot, gameId: assignment.gameId };
        }
      }
      for (const fav of state.favorites) {
        const pose = favoriteSlotPose(fav.slot);
        const d = dist3(here, pose.position);
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
