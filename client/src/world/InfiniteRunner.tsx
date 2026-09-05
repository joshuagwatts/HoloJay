import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { submitScore } from "../net/scores.ts";
import { useGame } from "../state/store.ts";

const LANES = [-2.2, 0, 2.2];
const JUMP_V = 9.5;
const GRAVITY = 22;

type Obstacle = {
  id: number;
  z: number;
  lane: number;
  kind: "block" | "bar";
};

type Phase = "ready" | "run" | "dead";

export function InfiniteRunner({ color }: { color: string }) {
  const user = useGame((s) => s.user);
  const { camera } = useThree();
  const [phase, setPhase] = useState<Phase>("ready");
  const [score, setScore] = useState(0);
  const [bestFlash, setBestFlash] = useState<number | null>(null);
  const phaseRef = useRef<Phase>("ready");
  const camReady = useRef(false);

  const targetLane = useRef(1);
  const x = useRef(0);
  const y = useRef(0.5);
  const vy = useRef(0);
  const grounded = useRef(true);
  const dist = useRef(0);
  const speed = useRef(14);
  const spawnAcc = useRef(0);
  const nextId = useRef(1);
  const obstacles = useRef<Obstacle[]>([]);
  const orb = useRef<THREE.Group>(null);
  const submitted = useRef(false);
  const scroll = useRef(0);
  const scoreAcc = useRef(0);

  const mats = useMemo(
    () => ({
      block: new THREE.MeshStandardMaterial({ color: "#1a1220", emissive: color, emissiveIntensity: 0.55 }),
      bar: new THREE.MeshStandardMaterial({ color: "#2a1830", emissive: color, emissiveIntensity: 0.85 }),
      lane: new THREE.MeshStandardMaterial({ color: "#1a1424", emissive: "#3a2448", emissiveIntensity: 0.55 }),
    }),
    [color],
  );

  function setPhaseBoth(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function resetRun() {
    targetLane.current = 1;
    x.current = 0;
    y.current = 0.5;
    vy.current = 0;
    grounded.current = true;
    dist.current = 0;
    speed.current = 14;
    spawnAcc.current = 0;
    obstacles.current = [];
    submitted.current = false;
    setScore(0);
    setBestFlash(null);
    setPhaseBoth("run");
  }

  // Snap camera into the track immediately — hub orbit left it miles away
  useEffect(() => {
    camera.position.set(0, 3.6, 8);
    camera.near = 0.1;
    camera.far = 120;
    camera.lookAt(0, 1.1, -8);
    camera.updateProjectionMatrix();
    camReady.current = true;
    document.exitPointerLock?.();
    return () => {
      // Hand the scene back to the hub look when the runner unmounts
      camera.near = 0.1;
      camera.far = 220;
      camera.position.set(3, 4.2, 11);
      camera.lookAt(0, 1.2, 0);
      camera.updateProjectionMatrix();
    };
  }, [camera]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (useGame.getState().chatOpen) return;
      if (e.repeat) return;
      const p = phaseRef.current;
      if (p === "ready" && (e.code === "Space" || e.code === "KeyW" || e.code === "Enter")) {
        e.preventDefault();
        resetRun();
        return;
      }
      if (p === "dead" && (e.code === "Space" || e.code === "KeyR" || e.code === "Enter")) {
        e.preventDefault();
        resetRun();
        return;
      }
      if (p !== "run") return;
      if (e.code === "KeyA" || e.code === "ArrowLeft") {
        targetLane.current = Math.max(0, targetLane.current - 1);
      }
      if (e.code === "KeyD" || e.code === "ArrowRight") {
        targetLane.current = Math.min(2, targetLane.current + 1);
      }
      if ((e.code === "Space" || e.code === "KeyW" || e.code === "ArrowUp") && grounded.current) {
        e.preventDefault();
        vy.current = JUMP_V;
        grounded.current = false;
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [color]);

  useFrame((_, dt) => {
    if (!camReady.current) return;
    const clamped = Math.min(dt, 0.05);
    const targetX = LANES[targetLane.current];
    x.current += (targetX - x.current) * Math.min(1, 14 * clamped);

    if (phaseRef.current === "run") {
      speed.current = Math.min(34, 14 + dist.current * 0.035);
      dist.current += speed.current * clamped;
      scroll.current += speed.current * clamped;
      scoreAcc.current += clamped;
      if (scoreAcc.current > 0.1) {
        scoreAcc.current = 0;
        setScore(Math.floor(dist.current));
      }

      vy.current -= GRAVITY * clamped;
      y.current += vy.current * clamped;
      if (y.current <= 0.5) {
        y.current = 0.5;
        vy.current = 0;
        grounded.current = true;
      }

      spawnAcc.current += clamped;
      const spawnEvery = Math.max(0.55, 1.15 - dist.current * 0.004);
      if (spawnAcc.current >= spawnEvery) {
        spawnAcc.current = 0;
        const lanePick = Math.floor(Math.random() * 3);
        const kind: Obstacle["kind"] = Math.random() < 0.35 ? "bar" : "block";
        obstacles.current.push({ id: nextId.current++, z: -48, lane: lanePick, kind });
        if (Math.random() < 0.28) {
          const other = (lanePick + 1 + Math.floor(Math.random() * 2)) % 3;
          obstacles.current.push({
            id: nextId.current++,
            z: -48 - 3.5,
            lane: other,
            kind: Math.random() < 0.4 ? "bar" : "block",
          });
        }
      }

      for (const o of obstacles.current) o.z += speed.current * clamped;
      obstacles.current = obstacles.current.filter((o) => o.z < 8);

      const px = x.current;
      const py = y.current;
      for (const o of obstacles.current) {
        if (Math.abs(o.z) > 1.1) continue;
        const hitLane = Math.abs(LANES[o.lane] - px) < 0.95;
        if (!hitLane) continue;
        if (o.kind === "block" && py < 1.35) {
          setPhaseBoth("dead");
          setScore(Math.floor(dist.current));
          break;
        }
        if (o.kind === "bar" && py > 0.85 && py < 2.1) {
          setPhaseBoth("dead");
          setScore(Math.floor(dist.current));
          break;
        }
      }
    }

    if (orb.current) orb.current.position.set(x.current, y.current, 0);

    camera.position.x = THREE.MathUtils.damp(camera.position.x, x.current * 0.35, 8, clamped);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, 3.4 + y.current * 0.15, 8, clamped);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, 7.5, 8, clamped);
    camera.lookAt(x.current * 0.2, 1.1, -6);
  });

  useEffect(() => {
    if (phase !== "dead" || submitted.current || !user) return;
    submitted.current = true;
    const entries = submitScore("lane-rush", user.username, Math.floor(dist.current));
    useGame.getState().setLeaderboard("lane-rush", entries);
    if (entries[0] && entries[0].username === user.username && entries[0].score === Math.floor(dist.current)) {
      setBestFlash(Math.floor(dist.current));
    }
  }, [phase, user]);

  const groundTiles = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

  return (
    <group>
      <color attach="background" args={["#120818"]} />
      <fog attach="fog" args={["#120818", 22, 60]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 10, 6]} intensity={1.1} color="#ffe6f5" />
      <pointLight position={[0, 4, 2]} color={color} intensity={22} distance={36} />

      {/* Visible end-cap so the track never reads as an empty void */}
      <mesh position={[0, 0, 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[7, 32]} />
        <meshStandardMaterial color="#0d0a12" emissive={color} emissiveIntensity={0.08} />
      </mesh>

      <ScrollingGround tiles={groundTiles} scroll={scroll} material={mats.lane} />

      {LANES.map((lx, i) => (
        <mesh key={i} position={[lx, 0.03, -12]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.1, 44]} />
          <meshBasicMaterial color={color} transparent opacity={0.55} />
        </mesh>
      ))}

      <group ref={orb} position={[0, 0.5, 0]}>
        <mesh>
          <sphereGeometry args={[0.42, 28, 28]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.8} />
        </mesh>
        <pointLight color={color} intensity={6} distance={8} />
      </group>

      <ObstacleSync obstacles={obstacles} lanes={LANES} mats={mats} />

      <Html position={[0, 4.2, 0]} center style={{ pointerEvents: "none" }}>
        <div className="room-title">
          <em>infinite runner</em>
          <strong>Lane Rush</strong>
          <span>
            {phase === "ready" && "A / D change lanes · Space jump · Enter to start"}
            {phase === "run" && `${score} m`}
            {phase === "dead" && `Crashed at ${score} m · Space to retry`}
          </span>
          {bestFlash != null ? <span className="lb-best">New #1 — {bestFlash} m</span> : null}
        </div>
      </Html>
    </group>
  );
}

function ScrollingGround({
  tiles,
  scroll,
  material,
}: {
  tiles: number[];
  scroll: MutableRefObject<number>;
  material: THREE.MeshStandardMaterial;
}) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!group.current) return;
    const off = scroll.current % 4;
    group.current.children.forEach((child, i) => {
      child.position.z = -i * 4 + off;
    });
  });
  return (
    <group ref={group}>
      {tiles.map((i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -i * 4]} material={material}>
          <planeGeometry args={[9, 3.8]} />
        </mesh>
      ))}
    </group>
  );
}

function ObstacleSync({
  obstacles,
  lanes,
  mats,
}: {
  obstacles: MutableRefObject<Obstacle[]>;
  lanes: number[];
  mats: { block: THREE.MeshStandardMaterial; bar: THREE.MeshStandardMaterial };
}) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    while (g.children.length < obstacles.current.length) {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.4, 1.2), mats.block));
    }
    while (g.children.length > obstacles.current.length) {
      const last = g.children[g.children.length - 1] as THREE.Mesh;
      g.remove(last);
      last.geometry.dispose();
    }
    obstacles.current.forEach((o, i) => {
      const mesh = g.children[i] as THREE.Mesh;
      mesh.position.set(lanes[o.lane], o.kind === "bar" ? 1.55 : 0.7, o.z);
      mesh.scale.set(o.kind === "bar" ? 1.05 : 1, o.kind === "bar" ? 0.25 : 1, 1);
      mesh.material = o.kind === "bar" ? mats.bar : mats.block;
    });
  });
  return <group ref={group} />;
}
