import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { useGame } from "../state/store.ts";
import { Orb } from "./Orb.tsx";

export function RemoteOrbs() {
  const selfId = useGame((s) => s.selfId);
  const players = useGame((s) => s.players);
  const location = useGame((s) => s.location);
  const lastChat = useGame((s) => s.lastChat);
  const now = Date.now();

  return (
    <>
      {Object.values(players).map((player) => {
        if (player.id === selfId) return null;
        if (location.type === "hub" && player.location.type !== "hub") return null;
        if (
          location.type === "game" &&
          (player.location.type !== "game" || player.location.instanceId !== location.instanceId)
        ) {
          return null;
        }
        const chat = lastChat[player.id];
        const live = chat && now - chat.at < 5000 ? chat.text : undefined;
        return (
          <InterpolatedOrb
            key={player.id}
            playerId={player.id}
            chat={live}
            trails={location.type === "game" && location.gameId === "magic-room"}
          />
        );
      })}
    </>
  );
}

function InterpolatedOrb({ playerId, chat, trails }: { playerId: string; chat?: string; trails?: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const player = useGame((s) => s.players[playerId]);

  useFrame((_, dt) => {
    const p = useGame.getState().players[playerId];
    if (!p || !ref.current) return;
    ref.current.position.lerp(new THREE.Vector3(p.position.x, p.position.y, p.position.z), 1 - Math.exp(-10 * dt));
    ref.current.rotation.y = p.rotY;
  });

  if (!player) return null;

  return (
    <group ref={ref} position={[player.position.x, player.position.y, player.position.z]}>
      <Orb
        color={player.color}
        username={player.username}
        speaking={player.speaking}
        chat={chat}
        trails={trails}
      />
    </group>
  );
}
