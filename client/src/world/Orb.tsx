import { Html, Trail } from "@react-three/drei";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { OrbHat } from "./Hat.tsx";

type OrbProps = {
  color: string;
  username: string;
  speaking?: boolean;
  chat?: string;
  local?: boolean;
  hatId?: string | null;
  trails?: boolean;
};

export function Orb({ color, username, speaking, chat, local, hatId, trails }: OrbProps) {
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

  const glow = (
    <group>
      <mesh ref={core}>
        <sphereGeometry args={[0.46, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={speaking ? 4.6 : trails ? 3.2 : 2.2}
          roughness={0.18}
          metalness={0.1}
        />
      </mesh>
      <mesh ref={halo}>
        <sphereGeometry args={[0.46, 20, 20]} />
        <meshBasicMaterial color={color} transparent opacity={speaking ? 0.28 : trails ? 0.22 : 0.14} />
      </mesh>
      <pointLight color={color} intensity={speaking ? 8 : trails ? 6 : 3.6} distance={12} />
    </group>
  );

  return (
    <group>
      {trails ? (
        <Trail width={2.6} length={12} color={color} attenuation={(t) => t * t} stride={0.04} interval={1}>
          {glow}
        </Trail>
      ) : (
        glow
      )}
      <OrbHat hatId={hatId} />
      <Html position={[0, 1.05, 0]} center distanceFactor={16} style={{ pointerEvents: "none" }}>
        <div className={`nameplate ${local ? "you" : ""}`}>
          {chat ? <div className="bubble">{chat}</div> : null}
          <span>{username}</span>
        </div>
      </Html>
    </group>
  );
}
