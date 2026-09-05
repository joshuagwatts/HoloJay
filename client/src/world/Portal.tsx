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

function shade(hex: string, amount: number) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amount);
  return `#${c.getHexString()}`;
}

export function Portal({ position, yaw, gameId, highlight, label }: PortalProps) {
  const game = gameById(gameId);
  const color = game?.color ?? "#88ccff";
  const body = useMemo(() => shade(color, -0.42), [color]);
  const bodyDark = useMemo(() => shade(color, -0.55), [color]);
  const trim = useMemo(() => shade(color, 0.12), [color]);
  const group = useRef<THREE.Group>(null);
  const screen = useRef<THREE.Mesh>(null);
  const marquee = useRef<THREE.Mesh>(null);
  const seed = useMemo(() => Math.random() * Math.PI * 2, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (screen.current) {
      const mat = screen.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = (highlight ? 2.8 : 1.6) + Math.sin(t * 6 + seed) * 0.25;
    }
    if (marquee.current) {
      const mat = marquee.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = (highlight ? 3.4 : 1.8) + Math.sin(t * 3.2 + seed) * 0.35;
    }
  });

  if (!game) return null;

  return (
    <group ref={group} position={position} rotation={[0, yaw, 0]}>
      {/* Cabinet body */}
      <mesh position={[0, 1.15, 0]} castShadow>
        <boxGeometry args={[1.55, 2.3, 1.05]} />
        <meshStandardMaterial color={body} roughness={0.55} metalness={0.15} />
      </mesh>

      {/* Side art panels */}
      <mesh position={[-0.79, 1.2, 0.05]}>
        <boxGeometry args={[0.04, 1.7, 0.85]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={highlight ? 1.4 : 0.55} roughness={0.4} />
      </mesh>
      <mesh position={[0.79, 1.2, 0.05]}>
        <boxGeometry args={[0.04, 1.7, 0.85]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={highlight ? 1.4 : 0.55} roughness={0.4} />
      </mesh>

      {/* CRT bezel */}
      <mesh position={[0, 1.55, 0.48]}>
        <boxGeometry args={[1.28, 1.05, 0.12]} />
        <meshStandardMaterial color="#141018" roughness={0.7} />
      </mesh>

      {/* Glowing screen */}
      <mesh ref={screen} position={[0, 1.55, 0.55]}>
        <planeGeometry args={[1.05, 0.82]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={highlight ? 2.8 : 1.6}
          roughness={0.25}
          metalness={0.05}
        />
      </mesh>
      {/* Scanline vibe */}
      <mesh position={[0, 1.55, 0.56]}>
        <planeGeometry args={[1.05, 0.82]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.18} />
      </mesh>

      {/* Control deck */}
      <mesh position={[0, 0.78, 0.62]} rotation={[-0.42, 0, 0]}>
        <boxGeometry args={[1.4, 0.12, 0.55]} />
        <meshStandardMaterial color={bodyDark} roughness={0.45} metalness={0.2} />
      </mesh>

      {/* Joystick stub */}
      <mesh position={[-0.32, 0.92, 0.72]}>
        <cylinderGeometry args={[0.04, 0.05, 0.22, 10]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      <mesh position={[-0.32, 1.05, 0.72]}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshStandardMaterial color={trim} emissive={trim} emissiveIntensity={0.8} />
      </mesh>

      {/* Arcade buttons */}
      {[0.08, 0.28, 0.48].map((x, i) => (
        <mesh key={i} position={[x, 0.9, 0.7]} rotation={[-0.42, 0, 0]}>
          <cylinderGeometry args={[0.055, 0.055, 0.05, 12]} />
          <meshStandardMaterial
            color={i === 1 ? trim : color}
            emissive={i === 1 ? trim : color}
            emissiveIntensity={highlight ? 1.8 : 0.7}
          />
        </mesh>
      ))}

      {/* Marquee header */}
      <mesh position={[0, 2.38, 0.28]}>
        <boxGeometry args={[1.62, 0.28, 0.55]} />
        <meshStandardMaterial color="#0c0a10" roughness={0.5} />
      </mesh>
      <mesh ref={marquee} position={[0, 2.38, 0.56]}>
        <planeGeometry args={[1.45, 0.18]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={highlight ? 3.4 : 1.8} />
      </mesh>

      {/* Kickplate / coin door */}
      <mesh position={[0, 0.22, 0.48]}>
        <boxGeometry args={[1.2, 0.35, 0.08]} />
        <meshStandardMaterial color="#1c1820" metalness={0.45} roughness={0.35} />
      </mesh>
      <mesh position={[0.18, 0.22, 0.53]}>
        <circleGeometry args={[0.05, 12]} />
        <meshStandardMaterial color="#c9a227" metalness={0.8} roughness={0.25} />
      </mesh>

      {/* Floor shadow blob */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0.1]}>
        <circleGeometry args={[1.05, 24]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.35} />
      </mesh>

      <pointLight position={[0, 1.55, 1.1]} color={color} intensity={highlight ? 9 : 4.2} distance={10} />

      <Html position={[0, 2.72, 0.2]} center distanceFactor={16} style={{ pointerEvents: "none" }}>
        <div className={`arcade-label ${highlight ? "hot" : ""}`}>
          <strong>{game.name}</strong>
          <span>{label ?? game.tagline}</span>
        </div>
      </Html>
    </group>
  );
}
