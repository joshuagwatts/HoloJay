import { Html } from "@react-three/drei";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { gameById, isCompetitive } from "@holojay/shared";
import { useGame } from "../state/store.ts";

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
  const board = useGame((s) => s.leaderboards[gameId] ?? []);
  const color = game?.color ?? "#88ccff";
  const body = useMemo(() => shade(color, -0.42), [color]);
  const bodyDark = useMemo(() => shade(color, -0.55), [color]);
  const trim = useMemo(() => shade(color, 0.12), [color]);
  const screen = useRef<THREE.Mesh>(null);
  const marquee = useRef<THREE.Mesh>(null);
  const seed = useMemo(() => Math.random() * Math.PI * 2, []);
  const competitive = game ? isCompetitive(game.id) : false;

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

  const deckTilt = 0.52;

  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <mesh position={[0, 1.15, 0]} castShadow>
        <boxGeometry args={[1.55, 2.3, 1.05]} />
        <meshStandardMaterial color={body} roughness={0.55} metalness={0.15} />
      </mesh>

      <mesh position={[-0.79, 1.2, 0.05]}>
        <boxGeometry args={[0.04, 1.7, 0.85]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={highlight ? 1.4 : 0.55} roughness={0.4} />
      </mesh>
      <mesh position={[0.79, 1.2, 0.05]}>
        <boxGeometry args={[0.04, 1.7, 0.85]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={highlight ? 1.4 : 0.55} roughness={0.4} />
      </mesh>

      <mesh position={[0, 1.55, 0.48]}>
        <boxGeometry args={[1.28, 1.05, 0.12]} />
        <meshStandardMaterial color="#141018" roughness={0.7} />
      </mesh>

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
      <mesh position={[0, 1.55, 0.56]}>
        <planeGeometry args={[1.05, 0.82]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.18} />
      </mesh>

      <group position={[0, 1.02, 0.42]} rotation={[deckTilt, 0, 0]}>
        <mesh position={[0, 0, 0.32]}>
          <boxGeometry args={[1.42, 0.1, 0.7]} />
          <meshStandardMaterial color={bodyDark} roughness={0.45} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0.08, 0.02]}>
          <boxGeometry args={[1.35, 0.08, 0.08]} />
          <meshStandardMaterial color="#0e0c12" roughness={0.5} />
        </mesh>

        <mesh position={[-0.34, 0.12, 0.28]}>
          <cylinderGeometry args={[0.04, 0.05, 0.2, 10]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        <mesh position={[-0.34, 0.24, 0.28]}>
          <sphereGeometry args={[0.075, 12, 12]} />
          <meshStandardMaterial color={trim} emissive={trim} emissiveIntensity={0.8} />
        </mesh>

        {[0.06, 0.26, 0.46].map((x, i) => (
          <mesh key={i} position={[x, 0.08, 0.34]}>
            <cylinderGeometry args={[0.055, 0.055, 0.05, 12]} />
            <meshStandardMaterial
              color={i === 1 ? trim : color}
              emissive={i === 1 ? trim : color}
              emissiveIntensity={highlight ? 1.8 : 0.7}
            />
          </mesh>
        ))}
      </group>

      <mesh position={[0, 2.38, 0.28]}>
        <boxGeometry args={[1.62, 0.28, 0.55]} />
        <meshStandardMaterial color="#0c0a10" roughness={0.5} />
      </mesh>
      <mesh ref={marquee} position={[0, 2.38, 0.56]}>
        <planeGeometry args={[1.45, 0.18]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={highlight ? 3.4 : 1.8} />
      </mesh>

      <mesh position={[0, 0.22, 0.48]}>
        <boxGeometry args={[1.2, 0.35, 0.08]} />
        <meshStandardMaterial color="#1c1820" metalness={0.45} roughness={0.35} />
      </mesh>
      <mesh position={[0.18, 0.22, 0.53]}>
        <circleGeometry args={[0.05, 12]} />
        <meshStandardMaterial color="#c9a227" metalness={0.8} roughness={0.25} />
      </mesh>

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

      {competitive ? (
        <Html position={[0, 3.55, 0.15]} center distanceFactor={14} style={{ pointerEvents: "none" }}>
          <div className={`cabinet-lb ${highlight ? "hot" : ""}`}>
            <div className="cabinet-lb-title">Top runs</div>
            {board.length === 0 ? (
              <div className="cabinet-lb-empty">No scores yet</div>
            ) : (
              board.map((entry, i) => (
                <div key={`${entry.username}-${entry.at}`} className="cabinet-lb-row">
                  <b>{i + 1}</b>
                  <span>{entry.username}</span>
                  <em>{entry.score}m</em>
                </div>
              ))
            )}
          </div>
        </Html>
      ) : null}
    </group>
  );
}
