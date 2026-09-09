import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "three";
import { emitLeave } from "../net/session.ts";
import { useGame } from "../state/store.ts";

/**
 * Boss Wave — arena boss rush. Starter roster:
 * 1 Ash Skull · 2 Mire Slime · 3 Starlight Serpent
 * Loop with rising difficulty after wave 3; more bosses later.
 */

type Phase = "ready" | "intro" | "fight" | "clear" | "dead";
type BossKind = "skull" | "slime" | "serpent";

type WaveDef = {
  kind: BossKind;
  name: string;
  blurb: string;
  hp: number;
  color: string;
};

const ARENA_R = 16;
const PLAYER_SPEED = 18;
const PLAYER_HULL = 5;

const BASE_WAVES: WaveDef[] = [
  {
    kind: "skull",
    name: "Ash Skull",
    blurb: "A floating death-grin that spatters the arena with fireballs",
    hp: 42,
    color: "#ff7043",
  },
  {
    kind: "slime",
    name: "Mire Slime",
    blurb: "A bouncing jelly titan — slam shocks and acid globs",
    hp: 58,
    color: "#69f0ae",
  },
  {
    kind: "serpent",
    name: "Starlight Serpent",
    blurb: "Rainbow coil with a unicorn horn — lunges and star lances",
    hp: 72,
    color: "#e040fb",
  },
];

function waveDef(idx: number): WaveDef {
  const base = BASE_WAVES[idx % BASE_WAVES.length]!;
  const loop = Math.floor(idx / BASE_WAVES.length);
  const scale = 1 + loop * 0.35;
  return {
    ...base,
    name: loop === 0 ? base.name : `${base.name} +${loop}`,
    hp: Math.round(base.hp * scale),
  };
}

type Bullet = {
  id: number;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  speed: number;
  life: number;
  friendly: boolean;
  tint: string;
  scale: number;
  dmg: number;
};

type SfxKind = "fire" | "hurt" | "hit" | "kill" | "boom" | "intro";
let sfxCtx: AudioContext | null = null;
function playSfx(kind: SfxKind) {
  try {
    sfxCtx ??= new AudioContext();
    if (sfxCtx.state === "suspended") void sfxCtx.resume();
    const t0 = sfxCtx.currentTime;
    const o = sfxCtx.createOscillator();
    const g = sfxCtx.createGain();
    o.connect(g);
    g.connect(sfxCtx.destination);
    const table: Record<SfxKind, { f: number; f2: number; dur: number; type: OscillatorType; vol: number }> = {
      fire: { f: 480, f2: 160, dur: 0.05, type: "square", vol: 0.04 },
      hit: { f: 720, f2: 240, dur: 0.07, type: "triangle", vol: 0.05 },
      kill: { f: 520, f2: 1100, dur: 0.22, type: "sawtooth", vol: 0.07 },
      boom: { f: 80, f2: 35, dur: 0.28, type: "sine", vol: 0.09 },
      hurt: { f: 180, f2: 70, dur: 0.18, type: "square", vol: 0.07 },
      intro: { f: 330, f2: 660, dur: 0.35, type: "triangle", vol: 0.06 },
    };
    const s = table[kind];
    o.type = s.type;
    o.frequency.setValueAtTime(s.f, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, s.f2), t0 + s.dur);
    g.gain.setValueAtTime(s.vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + s.dur);
    o.start(t0);
    o.stop(t0 + s.dur + 0.02);
  } catch {
    /* optional */
  }
}

function syncGroup<T>(
  group: THREE.Group | null,
  items: T[],
  apply: (item: T, mesh: THREE.Mesh) => void,
  make: () => THREE.Mesh,
) {
  if (!group) return;
  while (group.children.length < items.length) group.add(make());
  while (group.children.length > items.length) {
    const last = group.children[group.children.length - 1] as THREE.Mesh;
    group.remove(last);
    last.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
  items.forEach((item, i) => apply(item, group.children[i] as THREE.Mesh));
}

export function BossWave({ color }: { color: string }) {
  const { camera, gl } = useThree();
  const [phase, setPhase] = useState<Phase>("ready");
  const phaseRef = useRef<Phase>("ready");
  const [waveIdx, setWaveIdx] = useState(0);
  const waveIdxRef = useRef(0);
  const [hull, setHull] = useState(PLAYER_HULL);
  const hullRef = useRef(PLAYER_HULL);
  const [bossHp, setBossHp] = useState(0);
  const [bossMax, setBossMax] = useState(1);
  const [banner, setBanner] = useState<string | null>(null);
  const bannerT = useRef(0);
  const [introWave, setIntroWave] = useState<WaveDef | null>(null);

  const px = useRef(0);
  const pz = useRef(6);
  const py = useRef(0.55);
  const yaw = useRef(Math.PI);
  const aimYaw = useRef(Math.PI);
  const aimPitch = useRef(0.08);
  const keys = useRef({ x: 0, z: 0 });
  const fireHeld = useRef(false);
  const fireCd = useRef(0);
  const invuln = useRef(0);
  const lookQ = useRef({ x: 0, y: 0 });
  const nextId = useRef(1);
  const bullets = useRef<Bullet[]>([]);
  const bulletGroup = useRef<THREE.Group>(null);
  const playerGroup = useRef<THREE.Group>(null);
  const bossGroup = useRef<THREE.Group>(null);
  const serpentGroup = useRef<THREE.Group>(null);
  const bossKind = useRef<BossKind>("skull");
  const [bossKindHud, setBossKindHud] = useState<BossKind>("skull");
  const bossHpRef = useRef(0);
  const bossMaxRef = useRef(1);
  const bossAge = useRef(0);
  const bossCd = useRef(1.2);
  const bossPhase = useRef(0);
  const slimeHop = useRef(0);
  const slimeVy = useRef(0);
  const slimeY = useRef(2.4);
  const serpentSegs = useRef<{ x: number; y: number; z: number }[]>([]);
  const clearT = useRef(0);
  const introT = useRef(0);
  const shake = useRef(0);
  const hudRoot = useRef<Root | null>(null);

  const wave = waveDef(waveIdx);

  function setPhaseBoth(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function flash(msg: string, dur = 1.4) {
    setBanner(msg);
    bannerT.current = dur;
  }

  function hurt(n = 1) {
    if (invuln.current > 0 || phaseRef.current !== "fight") return;
    hullRef.current = Math.max(0, hullRef.current - n);
    setHull(hullRef.current);
    invuln.current = 1.05;
    shake.current = Math.max(shake.current, 0.55);
    playSfx("hurt");
    if (hullRef.current <= 0) {
      setPhaseBoth("dead");
      flash("YOU'RE DEAD", 2.5);
      playSfx("boom");
    }
  }

  function damageBoss(n: number) {
    if (phaseRef.current !== "fight") return;
    bossHpRef.current = Math.max(0, bossHpRef.current - n);
    setBossHp(bossHpRef.current);
    playSfx("hit");
    shake.current = Math.max(shake.current, 0.22);
    if (bossHpRef.current <= 0) {
      playSfx("kill");
      flash(`${waveDef(waveIdxRef.current).name.toUpperCase()} DOWN`, 2);
      clearT.current = 2.2;
      setPhaseBoth("clear");
      bullets.current = [];
    }
  }

  function spawnBoss(idx: number) {
    const w = waveDef(idx);
    bossKind.current = w.kind;
    setBossKindHud(w.kind);
    bossHpRef.current = w.hp;
    bossMaxRef.current = w.hp;
    setBossHp(w.hp);
    setBossMax(w.hp);
    bossAge.current = 0;
    bossCd.current = 1.1;
    bossPhase.current = 0;
    slimeY.current = 2.4;
    slimeVy.current = 0;
    slimeHop.current = 0;
    if (w.kind === "serpent") {
      serpentSegs.current = Array.from({ length: 14 }, (_, i) => ({
        x: Math.sin(i * 0.35) * 4,
        y: 2.2 + Math.sin(i * 0.5) * 0.4,
        z: -4 - i * 1.15,
      }));
    } else {
      serpentSegs.current = [];
    }
  }

  function beginWave(idx: number) {
    waveIdxRef.current = idx;
    setWaveIdx(idx);
    const w = waveDef(idx);
    setIntroWave(w);
    introT.current = 2.6;
    spawnBoss(idx);
    bullets.current = [];
    playSfx("intro");
    setPhaseBoth("intro");
  }

  function startFight() {
    setIntroWave(null);
    introT.current = 0;
    setPhaseBoth("fight");
  }

  function resetAll() {
    hullRef.current = PLAYER_HULL;
    setHull(PLAYER_HULL);
    px.current = 0;
    pz.current = 6;
    py.current = 0.55;
    yaw.current = Math.PI;
    aimYaw.current = Math.PI;
    aimPitch.current = 0.08;
    bullets.current = [];
    invuln.current = 0;
    fireCd.current = 0;
    waveIdxRef.current = 0;
    setWaveIdx(0);
    beginWave(0);
  }

  useEffect(() => {
    const host = document.createElement("div");
    host.id = "boss-wave-hud-root";
    document.body.appendChild(host);
    hudRoot.current = createRoot(host);
    return () => {
      hudRoot.current?.unmount();
      hudRoot.current = null;
      host.remove();
    };
  }, []);

  useEffect(() => {
    const root = hudRoot.current;
    if (!root) return;

    if (phase === "intro" && introWave) {
      root.render(
        <div className="boss-wave-intro" aria-live="polite">
          <p className="boss-wave-intro-kicker">Wave {waveIdx + 1}</p>
          <h2 className="boss-wave-intro-name" style={{ color: introWave.color }}>
            {introWave.name}
          </h2>
          <p className="boss-wave-intro-sub">{introWave.blurb}</p>
          <p className="boss-wave-intro-hint">Hold tight · Space skips</p>
        </div>,
      );
      return;
    }

    if (phase === "ready") {
      root.render(
        <div className="boss-wave-ready" aria-live="polite">
          <p className="boss-wave-ready-kicker">Arena unlocked</p>
          <h2 className="boss-wave-ready-title">BOSS WAVE</h2>
          <p className="boss-wave-ready-sub">Giant bosses · survive the roster · design more later</p>
          <ol className="boss-wave-roster">
            {BASE_WAVES.map((w, i) => (
              <li key={w.kind} style={{ ["--bw-color" as string]: w.color }}>
                <strong>
                  {i + 1}. {w.name}
                </strong>
                <span>{w.blurb}</span>
              </li>
            ))}
          </ol>
          <button type="button" className="boss-wave-go" onClick={() => resetAll()}>
            Enter the arena
          </button>
          <p className="boss-wave-ready-hint">WASD move · mouse aim · hold fire · Esc returns</p>
        </div>,
      );
      return;
    }

    if (phase === "fight" || phase === "clear") {
      const pct = Math.max(0, bossHp / Math.max(1, bossMax));
      root.render(
        <div className="boss-wave-hud" aria-hidden>
          <div className="boss-wave-vitals">
            <span>
              {"♥".repeat(hull)}
              {"♡".repeat(Math.max(0, PLAYER_HULL - hull))}
            </span>
            <span>WAVE {waveIdx + 1}</span>
            {banner ? <span className="boss-wave-banner">{banner}</span> : null}
          </div>
          <div className="boss-wave-bossbar">
            <div className="boss-wave-bossbar-meta">
              <strong>{wave.name}</strong>
              <em>
                {Math.max(0, Math.ceil(bossHp))} / {bossMax}
              </em>
            </div>
            <div className="boss-wave-bossbar-track">
              <i style={{ width: `${pct * 100}%`, background: wave.color }} />
            </div>
          </div>
          <div className={`boss-wave-crosshair${invuln.current > 0 ? " hurt" : ""}`}>
            <span />
            <span />
          </div>
        </div>,
      );
      return;
    }

    if (phase === "dead") {
      root.render(
        <div className="boss-wave-dead" aria-live="assertive">
          <p className="boss-wave-ready-kicker">Hull zero</p>
          <h2 className="boss-wave-ready-title">YOU&apos;RE DEAD</h2>
          <p className="boss-wave-ready-sub">
            Fell on wave {waveIdx + 1} · {wave.name}
          </p>
          <button type="button" className="boss-wave-go" onClick={() => resetAll()}>
            Retry from wave 1
          </button>
          <p className="boss-wave-ready-hint">Space / R to retry · Esc leaves</p>
        </div>,
      );
      return;
    }

    root.render(null);
  }, [phase, introWave, waveIdx, hull, bossHp, bossMax, banner, wave.name, wave.color]);

  useEffect(() => {
    camera.position.set(0, 8, 14);
    camera.lookAt(0, 2, 0);
    camera.near = 0.1;
    camera.far = 200;
    camera.updateProjectionMatrix();
    return () => {
      document.exitPointerLock?.();
    };
  }, [camera]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (useGame.getState().chatOpen) return;
      if (e.repeat) return;
      const p = phaseRef.current;

      if (e.code === "Escape") {
        e.preventDefault();
        emitLeave();
        return;
      }

      if (p === "ready" && (e.code === "Space" || e.code === "Enter")) {
        e.preventDefault();
        resetAll();
        return;
      }
      if (p === "intro" && (e.code === "Space" || e.code === "Enter")) {
        e.preventDefault();
        startFight();
        return;
      }
      if (p === "dead" && (e.code === "Space" || e.code === "KeyR" || e.code === "Enter")) {
        e.preventDefault();
        resetAll();
        return;
      }
      if (p !== "fight") return;
      if (e.code === "KeyW" || e.code === "ArrowUp") keys.current.z = -1;
      if (e.code === "KeyS" || e.code === "ArrowDown") keys.current.z = 1;
      if (e.code === "KeyA" || e.code === "ArrowLeft") keys.current.x = -1;
      if (e.code === "KeyD" || e.code === "ArrowRight") keys.current.x = 1;
      if (e.code === "Space" || e.code === "KeyF") fireHeld.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "KeyW" || e.code === "ArrowUp") keys.current.z = keys.current.z < 0 ? 0 : keys.current.z;
      if (e.code === "KeyS" || e.code === "ArrowDown") keys.current.z = keys.current.z > 0 ? 0 : keys.current.z;
      if (e.code === "KeyA" || e.code === "ArrowLeft") keys.current.x = keys.current.x < 0 ? 0 : keys.current.x;
      if (e.code === "KeyD" || e.code === "ArrowRight") keys.current.x = keys.current.x > 0 ? 0 : keys.current.x;
      if (e.code === "Space" || e.code === "KeyF") fireHeld.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: MouseEvent) => {
      if (phaseRef.current !== "fight") return;
      lookQ.current.x += e.movementX;
      lookQ.current.y += e.movementY;
    };
    const onDown = () => {
      if (phaseRef.current !== "fight") return;
      if (document.pointerLockElement !== el) void el.requestPointerLock();
      fireHeld.current = true;
    };
    const onUp = () => {
      fireHeld.current = false;
    };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, [gl]);

  function bossCenter(): { x: number; y: number; z: number } {
    if (bossKind.current === "serpent" && serpentSegs.current[0]) {
      return serpentSegs.current[0]!;
    }
    if (bossKind.current === "slime") {
      return { x: Math.sin(bossAge.current * 0.55) * 5, y: slimeY.current, z: -2 + Math.cos(bossAge.current * 0.4) * 3 };
    }
    // skull floats
    return {
      x: Math.sin(bossAge.current * 0.7) * 6,
      y: 3.2 + Math.sin(bossAge.current * 1.4) * 0.6,
      z: -3 + Math.cos(bossAge.current * 0.55) * 4,
    };
  }

  function fireBossShot(from: { x: number; y: number; z: number }, towardPlayer: boolean, tint: string, speed = 16, dmg = 1) {
    let dx = 0;
    let dy = 0;
    let dz = 0;
    if (towardPlayer) {
      dx = px.current - from.x;
      dy = py.current + 0.4 - from.y;
      dz = pz.current - from.z;
    } else {
      const a = Math.random() * Math.PI * 2;
      dx = Math.sin(a);
      dy = -0.15;
      dz = Math.cos(a);
    }
    const len = Math.hypot(dx, dy, dz) || 1;
    bullets.current.push({
      id: nextId.current++,
      x: from.x,
      y: from.y,
      z: from.z,
      dx: dx / len,
      dy: dy / len,
      dz: dz / len,
      speed,
      life: 3.5,
      friendly: false,
      tint,
      scale: 1.4,
      dmg,
    });
  }

  useFrame((_, dt) => {
    const clamped = Math.min(dt, 0.05);
    if (bannerT.current > 0) {
      bannerT.current = Math.max(0, bannerT.current - clamped);
      if (bannerT.current <= 0) setBanner(null);
    }
    shake.current = Math.max(0, shake.current - clamped * 2.2);
    invuln.current = Math.max(0, invuln.current - clamped);

    if (phaseRef.current === "intro") {
      introT.current -= clamped;
      if (introT.current <= 0) startFight();
    }

    if (phaseRef.current === "clear") {
      clearT.current -= clamped;
      if (clearT.current <= 0) {
        beginWave(waveIdxRef.current + 1);
      }
    }

    const fighting = phaseRef.current === "fight";

    if (fighting) {
      aimYaw.current -= lookQ.current.x * 0.003;
      aimPitch.current = Math.max(-0.35, Math.min(0.55, aimPitch.current - lookQ.current.y * 0.0026));
      lookQ.current.x *= 0.08;
      lookQ.current.y *= 0.08;

      const mx = keys.current.x;
      const mz = keys.current.z;
      const len = Math.hypot(mx, mz) || 1;
      const fx = Math.sin(aimYaw.current);
      const fz = Math.cos(aimYaw.current);
      const rx = Math.cos(aimYaw.current);
      const rz = -Math.sin(aimYaw.current);
      const vx = ((fx * -mz + rx * mx) / len) * PLAYER_SPEED;
      const vz = ((fz * -mz + rz * mx) / len) * PLAYER_SPEED;
      px.current += vx * clamped;
      pz.current += vz * clamped;
      const r = Math.hypot(px.current, pz.current);
      if (r > ARENA_R - 1.2) {
        const s = (ARENA_R - 1.2) / r;
        px.current *= s;
        pz.current *= s;
      }
      yaw.current = aimYaw.current;

      fireCd.current = Math.max(0, fireCd.current - clamped);
      if (fireHeld.current && fireCd.current <= 0) {
        const cy = Math.cos(aimYaw.current);
        const sy = Math.sin(aimYaw.current);
        const cp = Math.cos(aimPitch.current);
        const sp = Math.sin(aimPitch.current);
        bullets.current.push({
          id: nextId.current++,
          x: px.current + sy * cp * 0.8,
          y: py.current + 0.55 + sp * 0.4,
          z: pz.current + cy * cp * 0.8,
          dx: sy * cp,
          dy: sp,
          dz: cy * cp,
          speed: 42,
          life: 1.6,
          friendly: true,
          tint: "#ffe082",
          scale: 1,
          dmg: 1,
        });
        fireCd.current = 0.12;
        playSfx("fire");
      }

      // Boss AI
      bossAge.current += clamped;
      bossCd.current = Math.max(0, bossCd.current - clamped);
      const bc = bossCenter();
      const kind = bossKind.current;

      if (kind === "skull") {
        if (bossCd.current <= 0) {
          const burst = 3 + Math.floor(bossPhase.current % 2);
          for (let i = 0; i < burst; i++) {
            const from = { x: bc.x + (i - 1) * 0.6, y: bc.y - 0.3, z: bc.z };
            fireBossShot(from, true, "#ff6d00", 14 + i, 1);
          }
          bossCd.current = Math.max(0.55, 1.35 - waveIdxRef.current * 0.05);
          bossPhase.current += 1;
          playSfx("boom");
        }
      } else if (kind === "slime") {
        slimeHop.current += clamped;
        if (slimeY.current <= 2.2 && slimeVy.current <= 0 && slimeHop.current > 1.4) {
          slimeVy.current = 11;
          slimeHop.current = 0;
        }
        slimeVy.current -= 28 * clamped;
        slimeY.current += slimeVy.current * clamped;
        if (slimeY.current < 2.2) {
          slimeY.current = 2.2;
          if (slimeVy.current < -4) {
            // slam shock — ring of globs
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2;
              bullets.current.push({
                id: nextId.current++,
                x: bc.x,
                y: 1.2,
                z: bc.z,
                dx: Math.sin(a),
                dy: 0.05,
                dz: Math.cos(a),
                speed: 12,
                life: 2.2,
                friendly: false,
                tint: "#69f0ae",
                scale: 1.6,
                dmg: 1,
              });
            }
            shake.current = Math.max(shake.current, 0.45);
            playSfx("boom");
            if (Math.hypot(px.current - bc.x, pz.current - bc.z) < 5.5) hurt(1);
          }
          slimeVy.current = 0;
        }
        if (bossCd.current <= 0) {
          fireBossShot({ x: bc.x, y: bc.y + 1.2, z: bc.z }, true, "#b9f6ca", 13, 1);
          bossCd.current = 0.85;
        }
      } else if (kind === "serpent") {
        const segs = serpentSegs.current;
        if (segs.length) {
          const head = segs[0]!;
          const t = bossAge.current;
          const targetX = Math.sin(t * 0.9) * 7 + Math.sin(t * 0.3) * 2;
          const targetZ = -2 + Math.cos(t * 0.7) * 5;
          const targetY = 2.4 + Math.sin(t * 1.6) * 0.8;
          head.x += (targetX - head.x) * 1.8 * clamped;
          head.z += (targetZ - head.z) * 1.8 * clamped;
          head.y += (targetY - head.y) * 2.2 * clamped;
          // Lunge toward player occasionally
          if (bossPhase.current % 5 === 2 && bossCd.current > 0.9) {
            head.x += (px.current - head.x) * 2.5 * clamped;
            head.z += (pz.current - head.z) * 2.5 * clamped;
          }
          for (let i = 1; i < segs.length; i++) {
            const prev = segs[i - 1]!;
            const cur = segs[i]!;
            const dx = prev.x - cur.x;
            const dy = prev.y - cur.y;
            const dz = prev.z - cur.z;
            const d = Math.hypot(dx, dy, dz) || 1;
            const want = 1.05;
            cur.x = prev.x - (dx / d) * want;
            cur.y = prev.y - (dy / d) * want;
            cur.z = prev.z - (dz / d) * want;
          }
          if (Math.hypot(px.current - head.x, pz.current - head.z) < 2.2 && Math.abs(py.current - head.y) < 2) {
            hurt(1);
          }
        }
        if (bossCd.current <= 0) {
          const head = serpentSegs.current[0] ?? bc;
          fireBossShot(head, true, "#e040fb", 18, 1);
          if (bossPhase.current % 3 === 0) {
            fireBossShot(head, true, "#80d8ff", 20, 1);
            fireBossShot(head, false, "#ff80ab", 14, 1);
          }
          bossCd.current = Math.max(0.45, 1.0 - waveIdxRef.current * 0.04);
          bossPhase.current += 1;
          playSfx("fire");
        }
      }

      // Contact damage vs skull / slime body
      if (kind !== "serpent") {
        const hitR = kind === "slime" ? 3.2 : 2.4;
        if (Math.hypot(px.current - bc.x, pz.current - bc.z) < hitR && Math.abs(py.current + 0.4 - bc.y) < hitR) {
          hurt(1);
        }
      }
    }

    // Bullets
    for (const b of bullets.current) {
      b.x += b.dx * b.speed * clamped;
      b.y += b.dy * b.speed * clamped;
      b.z += b.dz * b.speed * clamped;
      b.life -= clamped;
      if (b.friendly && phaseRef.current === "fight") {
        const bc = bossCenter();
        const hitR = bossKind.current === "slime" ? 3.4 : bossKind.current === "serpent" ? 1.6 : 2.5;
        if (Math.hypot(b.x - bc.x, b.y - bc.y, b.z - bc.z) < hitR) {
          damageBoss(b.dmg);
          b.life = -1;
        }
        // Serpent body hits
        if (bossKind.current === "serpent") {
          for (const seg of serpentSegs.current) {
            if (Math.hypot(b.x - seg.x, b.y - seg.y, b.z - seg.z) < 1.35) {
              damageBoss(b.dmg);
              b.life = -1;
              break;
            }
          }
        }
      } else if (!b.friendly && phaseRef.current === "fight") {
        if (Math.hypot(b.x - px.current, b.y - (py.current + 0.5), b.z - pz.current) < 1.1) {
          hurt(b.dmg);
          b.life = -1;
        }
      }
    }
    bullets.current = bullets.current.filter((b) => b.life > 0 && Math.hypot(b.x, b.z) < ARENA_R + 8);

    syncGroup(
      bulletGroup.current,
      bullets.current,
      (b, mesh) => {
        mesh.visible = true;
        mesh.position.set(b.x, b.y, b.z);
        (mesh.material as THREE.MeshBasicMaterial).color.set(b.tint);
        mesh.scale.setScalar(b.scale);
      },
      () =>
        new THREE.Mesh(
          new THREE.SphereGeometry(0.18, 8, 8),
          new THREE.MeshBasicMaterial({ color: "#ffe082" }),
        ),
    );

    if (playerGroup.current) {
      playerGroup.current.position.set(px.current, py.current, pz.current);
      playerGroup.current.rotation.y = yaw.current;
      const pulse = invuln.current > 0 ? 0.45 + Math.sin(performance.now() * 0.03) * 0.25 : 1;
      playerGroup.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.material && "opacity" in (m.material as THREE.Material)) {
          (m.material as THREE.MeshStandardMaterial).opacity = pulse;
          (m.material as THREE.MeshStandardMaterial).transparent = true;
        }
      });
    }

    // Boss visual sync
    if (bossGroup.current) {
      const g = bossGroup.current;
      const bc = bossCenter();
      g.position.set(bc.x, bc.y, bc.z);
      g.visible =
        bossKind.current !== "serpent" &&
        (phaseRef.current === "fight" || phaseRef.current === "intro" || phaseRef.current === "clear");
      g.rotation.y = Math.atan2(px.current - bc.x, pz.current - bc.z);
      if (bossKind.current === "skull") {
        g.rotation.z = Math.sin(bossAge.current * 2) * 0.12;
      }
    }
    if (serpentGroup.current) {
      const show =
        bossKind.current === "serpent" &&
        (phaseRef.current === "fight" || phaseRef.current === "intro" || phaseRef.current === "clear");
      serpentGroup.current.visible = show;
      if (show) {
        const segs = serpentSegs.current;
        for (let i = 0; i < serpentGroup.current.children.length; i++) {
          const child = serpentGroup.current.children[i]!;
          const seg = segs[i];
          if (!seg) {
            child.visible = false;
            continue;
          }
          child.visible = true;
          child.position.set(seg.x, seg.y, seg.z);
          if (i === 0 && segs[1]) {
            child.lookAt(segs[1].x, segs[1].y, segs[1].z);
          } else if (i > 0) {
            const prev = segs[i - 1]!;
            child.lookAt(prev.x, prev.y, prev.z);
          }
        }
      }
    }

    // Camera
    const ox = (Math.random() - 0.5) * shake.current * 0.35;
    const oy = (Math.random() - 0.5) * shake.current * 0.25;
    if (phaseRef.current === "ready") {
      camera.position.set(0 + ox, 9, 16);
      camera.lookAt(0, 2, -2);
    } else {
      const back = 9.5;
      const tx = px.current - Math.sin(aimYaw.current) * back;
      const ty = py.current + 5.2;
      const tz = pz.current - Math.cos(aimYaw.current) * back;
      camera.position.x = THREE.MathUtils.damp(camera.position.x, tx + ox, 7, clamped);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, ty + oy, 7, clamped);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, tz, 7, clamped);
      const look = bossCenter();
      camera.lookAt(
        THREE.MathUtils.damp(look.x, px.current, 2, clamped) * 0.35 + px.current * 0.65,
        2.2,
        THREE.MathUtils.damp(look.z, pz.current, 2, clamped) * 0.35 + pz.current * 0.65,
      );
    }
  });

  const mats = useMemo(
    () => ({
      arena: new THREE.MeshStandardMaterial({
        color: "#140c18",
        emissive: color,
        emissiveIntensity: 0.18,
        metalness: 0.35,
        roughness: 0.65,
      }),
      rim: new THREE.MeshStandardMaterial({
        color: "#1a1020",
        emissive: "#7c4dff",
        emissiveIntensity: 0.35,
        side: THREE.DoubleSide,
      }),
    }),
    [color],
  );

  return (
    <group>
      <color attach="background" args={["#0a0610"]} />
      <fog attach="fog" args={["#120818", 22, 70]} />
      <ambientLight intensity={0.45} />
      <hemisphereLight args={["#e1bee7", "#1a1020", 0.65]} />
      <directionalLight position={[12, 22, 8]} intensity={1.15} color="#ffe0b2" />
      <pointLight position={[0, 10, 0]} color={color} intensity={22} distance={50} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={mats.arena}>
        <circleGeometry args={[ARENA_R, 64]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[ARENA_R - 0.35, ARENA_R, 64]} />
        <meshStandardMaterial color="#b388ff" emissive="#7c4dff" emissiveIntensity={0.9} />
      </mesh>
      <mesh material={mats.rim}>
        <cylinderGeometry args={[ARENA_R + 0.2, ARENA_R + 0.2, 3.5, 48, 1, true]} />
      </mesh>

      <group ref={bulletGroup} />

      <group ref={playerGroup} position={[0, 0.55, 6]}>
        <mesh castShadow>
          <sphereGeometry args={[0.55, 16, 16]} />
          <meshStandardMaterial color="#eceff1" emissive={color} emissiveIntensity={0.85} metalness={0.4} />
        </mesh>
        <mesh position={[0, 0.15, 0.55]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.12, 0.18, 0.7, 8]} />
          <meshStandardMaterial color="#ffd54f" emissive="#ffab40" emissiveIntensity={1.1} />
        </mesh>
        <pointLight color={color} intensity={6} distance={8} />
      </group>

      <group ref={bossGroup}>
        {bossKindHud === "skull" && (
          <group>
            <mesh castShadow>
              <sphereGeometry args={[2.2, 20, 16]} />
              <meshStandardMaterial color="#efebe9" emissive="#ff7043" emissiveIntensity={0.35} flatShading />
            </mesh>
            <mesh position={[-0.7, 0.35, 1.6]}>
              <sphereGeometry args={[0.45, 10, 10]} />
              <meshStandardMaterial color="#120808" emissive="#ff1744" emissiveIntensity={1.4} />
            </mesh>
            <mesh position={[0.7, 0.35, 1.6]}>
              <sphereGeometry args={[0.45, 10, 10]} />
              <meshStandardMaterial color="#120808" emissive="#ff1744" emissiveIntensity={1.4} />
            </mesh>
            <mesh position={[0, -0.55, 1.7]}>
              <boxGeometry args={[1.4, 0.35, 0.5]} />
              <meshStandardMaterial color="#1a1010" emissive="#ff6d00" emissiveIntensity={0.6} />
            </mesh>
            <pointLight position={[0, 0, 2]} color="#ff6d00" intensity={14} distance={18} />
          </group>
        )}
        {bossKindHud === "slime" && (
          <group>
            <mesh castShadow>
              <sphereGeometry args={[2.6, 24, 18]} />
              <meshStandardMaterial
                color="#69f0ae"
                emissive="#00e676"
                emissiveIntensity={0.75}
                transparent
                opacity={0.82}
                metalness={0.1}
                roughness={0.25}
              />
            </mesh>
            <mesh position={[-0.7, 0.9, 1.8]}>
              <sphereGeometry args={[0.35, 8, 8]} />
              <meshStandardMaterial color="#1b5e20" emissive="#76ff03" emissiveIntensity={0.8} />
            </mesh>
            <mesh position={[0.7, 0.9, 1.8]}>
              <sphereGeometry args={[0.35, 8, 8]} />
              <meshStandardMaterial color="#1b5e20" emissive="#76ff03" emissiveIntensity={0.8} />
            </mesh>
            <pointLight color="#69f0ae" intensity={12} distance={16} />
          </group>
        )}
      </group>

      <group ref={serpentGroup} visible={false}>
        {Array.from({ length: 14 }, (_, i) => {
          const hue = (i / 14) * 360;
          const col = `hsl(${hue} 90% 65%)`;
          const isHead = i === 0;
          return (
            <group key={`seg-${i}`}>
              <mesh castShadow>
                <sphereGeometry args={[isHead ? 1.15 : Math.max(0.45, 0.85 - i * 0.025), 12, 12]} />
                <meshStandardMaterial color={col} emissive={col} emissiveIntensity={1.2} metalness={0.35} roughness={0.3} />
              </mesh>
              {isHead && (
                <>
                  <mesh position={[0, 0.85, 0.2]} rotation={[0.4, 0, 0]}>
                    <coneGeometry args={[0.18, 1.1, 6]} />
                    <meshStandardMaterial color="#fff8e1" emissive="#ffe082" emissiveIntensity={1.6} metalness={0.7} />
                  </mesh>
                  <mesh position={[-0.35, 0.25, 0.85]}>
                    <sphereGeometry args={[0.18, 8, 8]} />
                    <meshStandardMaterial color="#120018" emissive="#e040fb" emissiveIntensity={1.5} />
                  </mesh>
                  <mesh position={[0.35, 0.25, 0.85]}>
                    <sphereGeometry args={[0.18, 8, 8]} />
                    <meshStandardMaterial color="#120018" emissive="#40c4ff" emissiveIntensity={1.5} />
                  </mesh>
                  <pointLight color="#e040fb" intensity={16} distance={20} />
                </>
              )}
            </group>
          );
        })}
      </group>

      <Html fullscreen zIndexRange={[80, 0]} style={{ pointerEvents: "none" }}>
        <div className="boss-wave-leave">
          <button type="button" onClick={() => emitLeave()}>
            Return
          </button>
        </div>
      </Html>
    </group>
  );
}
