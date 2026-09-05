import { Html } from "@react-three/drei";
import * as THREE from "three";
import { gameById } from "@holojay/shared";
import { useGame } from "../state/store.ts";
import { Portal } from "./Portal.tsx";
import { PlayerController } from "./PlayerController.tsx";
import { RemoteOrbs } from "./RemoteOrbs.tsx";

const ROOM_SPAWN: [number, number, number] = [0, 1.2, 4];

export function MinigameRoom() {
  const location = useGame((s) => s.location);
  const nearby = useGame((s) => s.nearby);
  if (location.type !== "game") return null;
  const game = gameById(location.gameId);
  if (!game) return null;

  return (
    <group>
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
          <em>placeholder chamber</em>
          <strong>{game.name}</strong>
          <span>{game.tagline}</span>
        </div>
      </Html>
      <Portal
        position={[0, 1.5, -8]}
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
