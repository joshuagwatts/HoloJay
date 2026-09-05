import { Html } from "@react-three/drei";
import { favoriteSlotPose } from "@holojay/shared";
import { useGame } from "../state/store.ts";
import { Portal } from "./Portal.tsx";

export function FavoritesPlaza() {
  const favorites = useGame((s) => s.favorites);
  const nearby = useGame((s) => s.nearby);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[8.4, 64]} />
        <meshStandardMaterial color="#120e1c" metalness={0.4} roughness={0.5} emissive="#2a1540" emissiveIntensity={0.35} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[7.6, 8.05, 64]} />
        <meshBasicMaterial color="#f0c37a" transparent opacity={0.55} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[2.1, 2.35, 48]} />
        <meshBasicMaterial color="#7cf0ff" transparent opacity={0.7} />
      </mesh>
      <Html position={[0, 0.2, 0]} center style={{ pointerEvents: "none" }}>
        <div className="plaza-title">Favorites Plaza</div>
      </Html>
      {favorites.map((fav) => {
        const pose = favoriteSlotPose(fav.slot);
        const hot = nearby?.source === "favorite" && nearby.slot === fav.slot;
        return (
          <Portal
            key={fav.gameId}
            position={[pose.position.x, pose.position.y, pose.position.z]}
            yaw={pose.yaw}
            gameId={fav.gameId}
            highlight={hot}
            label="Pinned — stays through reshuffles"
          />
        );
      })}
    </group>
  );
}
