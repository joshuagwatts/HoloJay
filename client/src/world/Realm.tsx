import { Stars } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import * as THREE from "three";
import { portalSlotPose } from "@holojay/shared";
import { useGame } from "../state/store.ts";
import { FavoritesPlaza } from "./FavoritesPlaza.tsx";
import { Figure8Path } from "./Figure8Path.tsx";
import { HatDresser } from "./HatDresser.tsx";
import { MinigameRoom } from "./MinigameRoom.tsx";
import { PlayerController } from "./PlayerController.tsx";
import { Portal } from "./Portal.tsx";
import { RemoteOrbs } from "./RemoteOrbs.tsx";

const HUB_SPAWN: [number, number, number] = [0, 1.2, 3.2];

function Hub() {
  const assignments = useGame((s) => s.assignments);
  const nearby = useGame((s) => s.nearby);
  const total = Math.max(1, assignments.length);

  return (
    <>
      <hemisphereLight args={["#b9d7ff", "#1a1224", 0.62]} />
      <directionalLight position={[18, 28, 12]} intensity={0.7} color="#fff1d6" />
      <Stars radius={120} depth={50} count={1200} factor={2.8} saturation={0} fade speed={0.4} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
        <planeGeometry args={[240, 240]} />
        <meshStandardMaterial color="#07060d" />
      </mesh>
      <Figure8Path />
      <FavoritesPlaza />
      <HatDresser />
      {assignments.map((assignment) => {
        const pose = portalSlotPose(assignment.slot, total);
        const hot = nearby?.source === "path" && nearby.slot === assignment.slot;
        return (
          <Portal
            key={`${assignment.slot}-${assignment.gameId}`}
            position={[pose.position.x, pose.position.y, pose.position.z]}
            yaw={pose.yaw}
            gameId={assignment.gameId}
            highlight={hot}
          />
        );
      })}
      <PlayerController spawn={HUB_SPAWN} />
      <RemoteOrbs />
    </>
  );
}

function Scene() {
  const location = useGame((s) => s.location);
  const hubReady = useGame((s) => s.hubReady);
  // Hub always wins until it's ready — never mount a minigame first
  if (!hubReady || location.type === "hub") return <Hub />;
  return <MinigameRoom />;
}

export function Realm() {
  return (
    <Canvas
      camera={{ fov: 64, near: 0.1, far: 220, position: [3, 4.2, 11] }}
      dpr={[1, 1.5]}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        powerPreference: "high-performance",
        failIfMajorPerformanceCaveat: false,
      }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener(
          "webglcontextlost",
          (e) => {
            e.preventDefault();
          },
          false,
        );
      }}
    >
      <color attach="background" args={["#06050c"]} />
      <fog attach="fog" args={["#06050c", 32, 100]} />
      <Suspense fallback={null}>
        <Scene />
      </Suspense>
    </Canvas>
  );
}
