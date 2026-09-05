import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { hatById, type HatDef } from "@holojay/shared";

function HatMesh({ hat, highlight }: { hat: HatDef; highlight?: boolean }) {
  const spin = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!spin.current) return;
    if (hat.kind === "propeller") spin.current.rotation.y += dt * 8;
    if (hat.kind === "halo") spin.current.rotation.y += dt * 0.8;
    if (hat.kind === "ufo") spin.current.rotation.y += dt * 1.6;
    if (hat.kind === "jester") spin.current.rotation.y += dt * 1.2;
  });

  const emissive = highlight ? 1.8 : 0.35;

  switch (hat.kind) {
    case "top":
      return (
        <group>
          <mesh position={[0, 0.08, 0]}>
            <cylinderGeometry args={[0.38, 0.42, 0.08, 20]} />
            <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={emissive * 0.2} />
          </mesh>
          <mesh position={[0, 0.32, 0]}>
            <cylinderGeometry args={[0.22, 0.24, 0.4, 18]} />
            <meshStandardMaterial color={hat.color} roughness={0.4} />
          </mesh>
        </group>
      );
    case "crown":
      return (
        <group>
          {[0, 1, 2, 3, 4].map((i) => {
            const a = (i / 5) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.22, 0.28, Math.sin(a) * 0.22]}>
                <coneGeometry args={[0.07, 0.22, 5]} />
                <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={emissive} />
              </mesh>
            );
          })}
          <mesh position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.28, 0.3, 0.14, 16]} />
            <meshStandardMaterial color={hat.color} metalness={0.6} roughness={0.25} />
          </mesh>
        </group>
      );
    case "beanie":
      return (
        <group>
          <mesh position={[0, 0.18, 0]} scale={[1, 0.85, 1]}>
            <sphereGeometry args={[0.34, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
            <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={emissive * 0.4} />
          </mesh>
          <mesh position={[0, 0.42, 0]}>
            <sphereGeometry args={[0.07, 10, 10]} />
            <meshStandardMaterial color="#f4ecdc" />
          </mesh>
        </group>
      );
    case "cone":
      return (
        <mesh position={[0, 0.35, 0]}>
          <coneGeometry args={[0.28, 0.55, 16]} />
          <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={emissive} />
        </mesh>
      );
    case "propeller":
      return (
        <group>
          <mesh position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.3, 0.32, 0.12, 16]} />
            <meshStandardMaterial color={hat.color} />
          </mesh>
          <group ref={spin} position={[0, 0.28, 0]}>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <boxGeometry args={[0.55, 0.04, 0.08]} />
              <meshStandardMaterial color="#f4ecdc" emissive="#ffffff" emissiveIntensity={0.4} />
            </mesh>
            <mesh rotation={[0, Math.PI / 2, Math.PI / 2]}>
              <boxGeometry args={[0.55, 0.04, 0.08]} />
              <meshStandardMaterial color="#f4ecdc" emissive="#ffffff" emissiveIntensity={0.4} />
            </mesh>
          </group>
        </group>
      );
    case "cowboy":
      return (
        <group>
          <mesh position={[0, 0.08, 0]} rotation={[-0.15, 0, 0]}>
            <cylinderGeometry args={[0.48, 0.5, 0.05, 20]} />
            <meshStandardMaterial color={hat.color} />
          </mesh>
          <mesh position={[0, 0.24, 0]}>
            <cylinderGeometry args={[0.2, 0.26, 0.28, 16]} />
            <meshStandardMaterial color={hat.color} />
          </mesh>
        </group>
      );
    case "wizard":
      return (
        <group>
          <mesh position={[0, 0.45, 0]}>
            <coneGeometry args={[0.26, 0.75, 16]} />
            <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={emissive * 0.6} />
          </mesh>
          <mesh position={[0, 0.1, 0]}>
            <cylinderGeometry args={[0.3, 0.32, 0.08, 16]} />
            <meshStandardMaterial color="#2a1540" />
          </mesh>
        </group>
      );
    case "bow":
      return (
        <group position={[0, 0.2, 0]}>
          <mesh position={[-0.16, 0, 0]} rotation={[0, 0, 0.4]}>
            <sphereGeometry args={[0.14, 12, 10]} />
            <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={emissive} />
          </mesh>
          <mesh position={[0.16, 0, 0]} rotation={[0, 0, -0.4]}>
            <sphereGeometry args={[0.14, 12, 10]} />
            <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={emissive} />
          </mesh>
          <mesh>
            <boxGeometry args={[0.1, 0.1, 0.1]} />
            <meshStandardMaterial color="#f4ecdc" />
          </mesh>
        </group>
      );
    case "antenna":
      return (
        <group>
          <mesh position={[-0.12, 0.35, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.45, 8]} />
            <meshStandardMaterial color="#888" metalness={0.7} />
          </mesh>
          <mesh position={[0.12, 0.35, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.45, 8]} />
            <meshStandardMaterial color="#888" metalness={0.7} />
          </mesh>
          <mesh position={[-0.12, 0.58, 0]}>
            <sphereGeometry args={[0.07, 10, 10]} />
            <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={2.2} />
          </mesh>
          <mesh position={[0.12, 0.58, 0]}>
            <sphereGeometry args={[0.07, 10, 10]} />
            <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={2.2} />
          </mesh>
        </group>
      );
    case "flower":
      return (
        <group position={[0, 0.22, 0]}>
          {Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16]}>
                <sphereGeometry args={[0.1, 10, 10]} />
                <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={emissive * 0.5} />
              </mesh>
            );
          })}
          <mesh>
            <sphereGeometry args={[0.08, 10, 10]} />
            <meshStandardMaterial color="#ffd54f" emissive="#ffd54f" emissiveIntensity={1.2} />
          </mesh>
        </group>
      );
    case "fez":
      return (
        <group>
          <mesh position={[0, 0.22, 0]}>
            <cylinderGeometry args={[0.22, 0.26, 0.32, 16]} />
            <meshStandardMaterial color={hat.color} />
          </mesh>
          <mesh position={[0.18, 0.38, 0]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshStandardMaterial color="#ffd54f" />
          </mesh>
        </group>
      );
    case "halo":
      return (
        <group ref={spin} position={[0, 0.55, 0]} rotation={[0.4, 0, 0]}>
          <mesh>
            <torusGeometry args={[0.32, 0.04, 10, 28]} />
            <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={2.5} />
          </mesh>
        </group>
      );
    case "mushroom":
      return (
        <group>
          <mesh position={[0, 0.18, 0]}>
            <cylinderGeometry args={[0.1, 0.12, 0.22, 12]} />
            <meshStandardMaterial color="#f5f0e6" />
          </mesh>
          <mesh position={[0, 0.34, 0]}>
            <sphereGeometry args={[0.34, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
            <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={emissive * 0.5} />
          </mesh>
          {[0, 1, 2, 3, 4].map((i) => {
            const a = (i / 5) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.18, 0.4, Math.sin(a) * 0.18]}>
                <sphereGeometry args={[0.06, 8, 8]} />
                <meshStandardMaterial color="#ffffff" />
              </mesh>
            );
          })}
        </group>
      );
    case "cat":
      return (
        <group>
          <mesh position={[-0.18, 0.38, 0]} rotation={[0, 0, 0.35]}>
            <coneGeometry args={[0.12, 0.28, 3]} />
            <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={emissive * 0.4} />
          </mesh>
          <mesh position={[0.18, 0.38, 0]} rotation={[0, 0, -0.35]}>
            <coneGeometry args={[0.12, 0.28, 3]} />
            <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={emissive * 0.4} />
          </mesh>
          <mesh position={[-0.18, 0.32, 0.02]} rotation={[0, 0, 0.35]} scale={[0.55, 0.55, 0.55]}>
            <coneGeometry args={[0.12, 0.28, 3]} />
            <meshStandardMaterial color="#ff8a80" />
          </mesh>
          <mesh position={[0.18, 0.32, 0.02]} rotation={[0, 0, -0.35]} scale={[0.55, 0.55, 0.55]}>
            <coneGeometry args={[0.12, 0.28, 3]} />
            <meshStandardMaterial color="#ff8a80" />
          </mesh>
        </group>
      );
    case "unicorn":
      return (
        <group>
          <mesh position={[0, 0.48, 0.05]} rotation={[0.35, 0, 0]}>
            <coneGeometry args={[0.08, 0.55, 12]} />
            <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={emissive + 0.8} metalness={0.4} />
          </mesh>
          <mesh position={[0, 0.22, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.12, 0.025, 8, 16]} />
            <meshStandardMaterial color="#ffe082" emissive="#ffe082" emissiveIntensity={1.4} />
          </mesh>
        </group>
      );
    case "chef":
      return (
        <group>
          <mesh position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.28, 0.3, 0.1, 16]} />
            <meshStandardMaterial color="#eceff1" />
          </mesh>
          <mesh position={[0, 0.38, 0]} scale={[1, 1.15, 1]}>
            <sphereGeometry args={[0.32, 18, 14]} />
            <meshStandardMaterial color={hat.color} roughness={0.85} />
          </mesh>
          <mesh position={[0, 0.62, 0]} scale={[0.85, 0.55, 0.85]}>
            <sphereGeometry args={[0.28, 14, 12]} />
            <meshStandardMaterial color={hat.color} roughness={0.85} />
          </mesh>
        </group>
      );
    case "jester":
      return (
        <group ref={spin}>
          {[0, 1, 2].map((i) => {
            const a = (i / 3) * Math.PI * 2;
            const colors = [hat.color, "#ff4081", "#40c4ff"];
            return (
              <group key={i} rotation={[0, a, 0]}>
                <mesh position={[0.22, 0.32, 0]} rotation={[0, 0, 0.85]}>
                  <coneGeometry args={[0.1, 0.42, 8]} />
                  <meshStandardMaterial color={colors[i]} emissive={colors[i]} emissiveIntensity={emissive * 0.5} />
                </mesh>
                <mesh position={[0.38, 0.52, 0]}>
                  <sphereGeometry args={[0.07, 10, 10]} />
                  <meshStandardMaterial color="#ffd54f" emissive="#ffd54f" emissiveIntensity={1.5} />
                </mesh>
              </group>
            );
          })}
          <mesh position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.3, 0.32, 0.1, 16]} />
            <meshStandardMaterial color="#212121" />
          </mesh>
        </group>
      );
    case "ufo":
      return (
        <group ref={spin}>
          <mesh position={[0, 0.22, 0]} scale={[1, 0.28, 1]}>
            <sphereGeometry args={[0.42, 20, 14]} />
            <meshStandardMaterial color={hat.color} metalness={0.7} roughness={0.25} emissive={hat.color} emissiveIntensity={emissive} />
          </mesh>
          <mesh position={[0, 0.34, 0]}>
            <sphereGeometry args={[0.18, 16, 12]} />
            <meshStandardMaterial color="#e0f7fa" transparent opacity={0.85} emissive="#80deea" emissiveIntensity={1.2} />
          </mesh>
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const a = (i / 6) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.34, 0.18, Math.sin(a) * 0.34]}>
                <sphereGeometry args={[0.035, 8, 8]} />
                <meshStandardMaterial color="#ffea00" emissive="#ffea00" emissiveIntensity={2} />
              </mesh>
            );
          })}
        </group>
      );
    case "duck":
      return (
        <group>
          <mesh position={[0, 0.28, 0]} scale={[1, 0.85, 1.05]}>
            <sphereGeometry args={[0.28, 16, 14]} />
            <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={emissive * 0.35} />
          </mesh>
          <mesh position={[0, 0.22, 0.28]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.1, 0.22, 8]} />
            <meshStandardMaterial color="#ff9800" />
          </mesh>
          <mesh position={[-0.1, 0.34, 0.18]}>
            <sphereGeometry args={[0.035, 8, 8]} />
            <meshStandardMaterial color="#212121" />
          </mesh>
          <mesh position={[0.1, 0.34, 0.18]}>
            <sphereGeometry args={[0.035, 8, 8]} />
            <meshStandardMaterial color="#212121" />
          </mesh>
        </group>
      );
    case "headphones":
      return (
        <group>
          <mesh position={[0, 0.38, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.32, 0.03, 8, 24, Math.PI]} />
            <meshStandardMaterial color={hat.color} metalness={0.5} />
          </mesh>
          <mesh position={[-0.34, 0.18, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.14, 0.14, 0.1, 16]} />
            <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={emissive * 0.4} />
          </mesh>
          <mesh position={[0.34, 0.18, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.14, 0.14, 0.1, 16]} />
            <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={emissive * 0.4} />
          </mesh>
        </group>
      );
    case "devil":
      return (
        <group>
          <mesh position={[-0.16, 0.42, 0]} rotation={[0, 0, 0.45]}>
            <coneGeometry args={[0.08, 0.32, 8]} />
            <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={emissive + 0.6} />
          </mesh>
          <mesh position={[0.16, 0.42, 0]} rotation={[0, 0, -0.45]}>
            <coneGeometry args={[0.08, 0.32, 8]} />
            <meshStandardMaterial color={hat.color} emissive={hat.color} emissiveIntensity={emissive + 0.6} />
          </mesh>
        </group>
      );
    case "bucket":
      return (
        <group>
          <mesh position={[0, 0.28, 0]}>
            <cylinderGeometry args={[0.36, 0.28, 0.38, 18]} />
            <meshStandardMaterial color={hat.color} roughness={0.55} />
          </mesh>
          <mesh position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.34, 0.03, 8, 24]} />
            <meshStandardMaterial color="#004d40" />
          </mesh>
          <mesh position={[0, 0.48, 0]}>
            <cylinderGeometry args={[0.38, 0.38, 0.04, 18]} />
            <meshStandardMaterial color="#80cbc4" />
          </mesh>
        </group>
      );
    case "pirate":
      return (
        <group>
          <mesh position={[0, 0.22, 0]}>
            <cylinderGeometry args={[0.22, 0.28, 0.22, 16]} />
            <meshStandardMaterial color={hat.color} />
          </mesh>
          {[0, 1, 2].map((i) => {
            const a = -0.6 + i * 0.6;
            return (
              <mesh key={i} position={[Math.sin(a) * 0.32, 0.12, Math.cos(a) * 0.18]} rotation={[-0.4, a, 0]}>
                <boxGeometry args={[0.34, 0.05, 0.22]} />
                <meshStandardMaterial color={hat.color} />
              </mesh>
            );
          })}
          <mesh position={[0, 0.18, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.24, 0.02, 8, 20]} />
            <meshStandardMaterial color="#c9a227" metalness={0.6} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

export function OrbHat({ hatId, highlight }: { hatId: string | null | undefined; highlight?: boolean }) {
  const hat = useMemo(() => (hatId ? hatById(hatId) : undefined), [hatId]);
  if (!hat) return null;
  return (
    <group position={[0, 0.42, 0]}>
      <HatMesh hat={hat} highlight={highlight} />
    </group>
  );
}

export function StandaloneHat({ hatId, highlight }: { hatId: string; highlight?: boolean }) {
  const hat = hatById(hatId);
  if (!hat) return null;
  return <HatMesh hat={hat} highlight={highlight} />;
}

void THREE;
