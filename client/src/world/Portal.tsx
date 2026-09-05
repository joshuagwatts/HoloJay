import { Html } from "@react-three/drei";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { gameById } from "@holojay/shared";

type PortalProps = {
  position: [number, number, number];
  yaw: number;
  gameId: string;
  highlight?: boolean;
  label?: string;
};

export function Portal({ position, yaw, gameId, highlight, label }: PortalProps) {
  const game = gameById(gameId);
  const color = game?.color ?? "#88ccff";
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Mesh>(null);
  const seed = useMemo(() => Math.random() * Math.PI * 2, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (inner.current) {
      inner.current.rotation.z = t * 0.35 + seed;
      const s = 1 + Math.sin(t * 2 + seed) * 0.04;
      inner.current.scale.setScalar(s);
    }
    if (group.current) {
      group.current.position.y = position[1] + Math.sin(t * 1.4 + seed) * 0.08;
    }
  });

  if (!game) return null;

  return (
    <group ref={group} position={position} rotation={[0, yaw, 0]}>
      <mesh>
        <torusGeometry args={[1.22, 0.09, 10, 48]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={highlight ? 4.2 : 2.2} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[1.22, 0.035, 8, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.35} />
      </mesh>
      <mesh ref={inner}>
        <circleGeometry args={[1.12, 40]} />
        <meshBasicMaterial color={color} transparent opacity={highlight ? 0.42 : 0.28} side={THREE.DoubleSide} />
      </mesh>
      <pointLight color={color} intensity={highlight ? 7 : 3.4} distance={11} />
      <Html position={[0, 1.7, 0]} center distanceFactor={18} style={{ pointerEvents: "none" }}>
        <div className={`portal-label ${highlight ? "hot" : ""}`}>
          <strong>{game.name}</strong>
          <span>{label ?? game.tagline}</span>
        </div>
      </Html>
    </group>
  );
}
