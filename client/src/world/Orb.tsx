import { Html } from "@react-three/drei";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

type OrbProps = {
  color: string;
  username: string;
  speaking?: boolean;
  chat?: string;
  local?: boolean;
};

export function Orb({ color, username, speaking, chat, local }: OrbProps) {
  const core = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const pulse = speaking ? 1.18 + Math.sin(state.clock.elapsedTime * 14) * 0.08 : 1;
    if (core.current) core.current.scale.setScalar(pulse);
    if (halo.current) {
      const s = speaking ? 1.55 + Math.sin(state.clock.elapsedTime * 10) * 0.12 : 1.35;
      halo.current.scale.setScalar(s);
    }
  });

  return (
    <group>
      <mesh ref={core}>
        <sphereGeometry args={[0.46, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={speaking ? 4.6 : 2.2}
          roughness={0.18}
          metalness={0.1}
        />
      </mesh>
      <mesh ref={halo}>
        <sphereGeometry args={[0.46, 20, 20]} />
        <meshBasicMaterial color={color} transparent opacity={speaking ? 0.28 : 0.14} />
      </mesh>
      <pointLight color={color} intensity={speaking ? 8 : 3.6} distance={12} />
      <Html position={[0, 1.05, 0]} center distanceFactor={16} style={{ pointerEvents: "none" }}>
        <div className={`nameplate ${local ? "you" : ""}`}>
          {chat ? <div className="bubble">{chat}</div> : null}
          <span>{username}</span>
        </div>
      </Html>
    </group>
  );
}
