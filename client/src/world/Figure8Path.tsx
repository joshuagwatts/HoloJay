import { useMemo } from "react";
import { Line, Sparkles } from "@react-three/drei";
import * as THREE from "three";
import { checkpointPose, CHECKPOINT_COUNT, pathSamples } from "@holojay/shared";
import { useGame } from "../state/store.ts";

export function Figure8Path() {
  const visited = useGame((s) => s.loopVisited);
  const points = useMemo(
    () => pathSamples(220).map((p) => new THREE.Vector3(p.x, p.y, p.z)),
    [],
  );
  const tube = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(points, true, "catmullrom", 0.12);
    return new THREE.TubeGeometry(curve, 280, 0.38, 10, true);
  }, [points]);

  return (
    <group>
      <mesh geometry={tube}>
        <meshStandardMaterial
          color="#14323c"
          emissive="#2ad6e6"
          emissiveIntensity={1.4}
          roughness={0.28}
          metalness={0.35}
        />
      </mesh>
      <Line points={points} color="#9af7ff" lineWidth={1.2} transparent opacity={0.55} />
      {Array.from({ length: CHECKPOINT_COUNT }, (_, i) => {
        const pose = checkpointPose(i);
        const on = visited[i];
        return (
          <mesh key={i} position={[pose.position.x, 0.55, pose.position.z]}>
            <sphereGeometry args={[on ? 0.28 : 0.18, 12, 12]} />
            <meshStandardMaterial
              color={on ? "#ffd38a" : "#3d6d78"}
              emissive={on ? "#ffb347" : "#1b4a55"}
              emissiveIntensity={on ? 2.4 : 0.6}
            />
          </mesh>
        );
      })}
      <Sparkles count={40} scale={[90, 4, 50]} size={3} speed={0.3} color="#7cf0ff" opacity={0.45} />
    </group>
  );
}
