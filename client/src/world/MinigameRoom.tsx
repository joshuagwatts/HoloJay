import { Html } from "@react-three/drei";
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { gameById } from "@holojay/shared";
import { emitLeave } from "../net/session.ts";
import { useGame } from "../state/store.ts";
import { Portal } from "./Portal.tsx";
import { PlayerController } from "./PlayerController.tsx";
import { RemoteOrbs } from "./RemoteOrbs.tsx";
import { MagicShaderShell } from "./MagicRoomFx.tsx";
import { InfiniteRunner } from "./InfiniteRunner.tsx";

const ROOM_SPAWN: [number, number, number] = [0, 1.2, 4];

function MagicFogOff() {
  const { scene } = useThree();
  useEffect(() => {
    const prev = scene.fog;
    scene.fog = null;
    return () => {
      scene.fog = prev;
    };
  }, [scene]);
  return null;
}

function RunnerExitKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useGame.getState().chatOpen || e.repeat) return;
      if (e.code === "KeyE") emitLeave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

export function MinigameRoom() {
  const location = useGame((s) => s.location);
  const nearby = useGame((s) => s.nearby);
  if (location.type !== "game") return null;
  const game = gameById(location.gameId);
  if (!game) return null;

  if (location.gameId === "lane-rush") {
    return (
      <group>
        <RunnerExitKeys />
        <InfiniteRunner color={game.color} />
        <Html position={[0, -0.2, 6]} center style={{ pointerEvents: "none" }}>
          <div className="arcade-label">
            <strong>Return cabinet</strong>
            <span>Press E or use Return in the HUD</span>
          </div>
        </Html>
      </group>
    );
  }

  const isMagic = location.gameId === "magic-room";

  return (
    <group>
      {isMagic ? (
        <>
          <MagicFogOff />
          <MagicShaderShell color={game.color} />
          <pointLight position={[0, 4, 0]} color={game.color} intensity={28} distance={40} />
          <pointLight position={[6, 2, -4]} color="#ff4fd8" intensity={14} distance={24} />
          <pointLight position={[-5, 3, 5]} color="#4de1ff" intensity={14} distance={24} />
          <Html position={[0, 5.2, 0]} center style={{ pointerEvents: "none" }}>
            <div className="room-title">
              <em>shader sea</em>
              <strong>{game.name}</strong>
              <span>{game.tagline}</span>
            </div>
          </Html>
        </>
      ) : (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[14, 48]} />
            <meshStandardMaterial color="#0b0a12" emissive={game.color} emissiveIntensity={0.12} />
          </mesh>
          <mesh>
            <cylinderGeometry args={[14, 14, 10, 48, 1, true]} />
            <meshStandardMaterial
              color="#100c18"
              emissive={game.color}
              emissiveIntensity={0.18}
              side={THREE.BackSide}
              transparent
              opacity={0.9}
            />
          </mesh>
          <pointLight position={[0, 6, 0]} color={game.color} intensity={20} distance={30} />
          <Html position={[0, 4.2, 0]} center style={{ pointerEvents: "none" }}>
            <div className="room-title">
              <em>chamber</em>
              <strong>{game.name}</strong>
              <span>{game.tagline}</span>
            </div>
          </Html>
        </>
      )}
      <Portal
        position={[0, 0, -8]}
        yaw={0}
        gameId={game.id}
        highlight={nearby?.source === "return"}
        label="Return to the Portal Realm"
      />
      <PlayerController spawn={ROOM_SPAWN} />
      <RemoteOrbs />
    </group>
  );
}
