import { Html } from "@react-three/drei";
import { dresserPose, hatById } from "@holojay/shared";
import { useGame } from "../state/store.ts";
import { StandaloneHat } from "./Hat.tsx";

export function HatDresser() {
  const dresserHats = useGame((s) => s.dresserHats);
  const nearbyHat = useGame((s) => s.nearbyHat);
  const wornHatId = useGame((s) => s.wornHatId);
  const pose = dresserPose();

  return (
    <group position={[pose.position.x, pose.position.y, pose.position.z]} rotation={[0, pose.yaw, 0]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[3.2, 1.1, 0.85]} />
        <meshStandardMaterial color="#3b2a1d" roughness={0.65} metalness={0.05} />
      </mesh>
      <mesh position={[0, 1.12, 0]}>
        <boxGeometry args={[3.35, 0.08, 0.95]} />
        <meshStandardMaterial color="#5a4330" roughness={0.45} />
      </mesh>
      <mesh position={[0, 1.85, -0.35]}>
        <boxGeometry args={[3.1, 1.4, 0.12]} />
        <meshStandardMaterial color="#2a1f16" />
      </mesh>
      <mesh position={[0, 1.85, -0.28]}>
        <planeGeometry args={[2.6, 1.05]} />
        <meshStandardMaterial color="#8ec8ff" metalness={0.9} roughness={0.1} transparent opacity={0.35} />
      </mesh>
      {[
        [-1.4, 0.15, 0.3],
        [1.4, 0.15, 0.3],
        [-1.4, 0.15, -0.3],
        [1.4, 0.15, -0.3],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]}>
          <boxGeometry args={[0.12, 0.3, 0.12]} />
          <meshStandardMaterial color="#2a1f16" />
        </mesh>
      ))}

      <Html position={[0, 2.7, 0]} center distanceFactor={18} style={{ pointerEvents: "none" }}>
        <div className="plaza-title">Hat Dresser</div>
      </Html>
      <Html position={[0, 0.2, 0.55]} center distanceFactor={20} style={{ pointerEvents: "none" }}>
        <div className="arcade-label">
          <span>Loop reshuffles the hats · E to wear</span>
        </div>
      </Html>

      {dresserHats.map((hatId, slot) => {
        const localX = (slot - (dresserHats.length - 1) / 2) * 0.58;
        const hot = nearbyHat?.slot === slot;
        const hat = hatById(hatId);
        const worn = wornHatId === hatId;
        return (
          <group key={`${hatId}-${slot}`} position={[localX, 1.28, 0.15]}>
            <StandaloneHat hatId={hatId} highlight={hot || worn} />
            {hot && hat ? (
              <Html position={[0, 0.85, 0]} center distanceFactor={14} style={{ pointerEvents: "none" }}>
                <div className={`arcade-label hot`}>
                  <strong>{hat.name}</strong>
                  <span>{worn ? "E to remove" : "Press E to wear"}</span>
                </div>
              </Html>
            ) : null}
          </group>
        );
      })}
    </group>
  );
}
