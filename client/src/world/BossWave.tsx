import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "three";
import {
  consumeVehicleLook,
  resetVehiclePad,
  vehiclePad,
} from "../inputPad.ts";
import { emitLeave } from "../net/session.ts";
import { useGame } from "../state/store.ts";
import { isTouchUi } from "../touchUi.ts";
import { GameTouchControls } from "../ui/GameTouchControls.tsx";

/**
 * Boss Wave — central arena, escort-style truck (driver + bed gunner).
 * Gunner can LOCK onto the active boss or unlock for free-look.
 * Starter roster: Ash Skull · Mire Slime · Starlight Serpent
 */

type Phase = "ready" | "intro" | "fight" | "clear" | "dead";
type BossKind = "skull" | "slime" | "serpent";
type Role = "driver" | "gunner";

type WaveDef = {
  kind: BossKind;
  name: string;
  blurb: string;
  hp: number;
  color: string;
};

const ARENA_R = 160; // ~10× the original stadium
const DRIVE_SPEED = 34;
const TURN_RATE = 2.05;
const PLAYER_HULL = 5;
const TURRET_BACK = 2.35;
const BOSS_SCALE = 2.8;

type VehicleId = "hauler" | "buggy" | "wagon";
type TurretId = "mg" | "scatter" | "beam";
type BodyStyle = "stock" | "widebody" | "ratrod";

type PaintKit = { id: string; label: string; primary: string; emissive: string };

const PAINT_KITS: PaintKit[] = [
  { id: "ember", label: "Ember wrap", primary: "#ff7043", emissive: "#ff3d00" },
  { id: "violet", label: "Void violet", primary: "#b388ff", emissive: "#7c4dff" },
  { id: "mint", label: "Acid mint", primary: "#69f0ae", emissive: "#00e676" },
  { id: "ice", label: "Ice lance", primary: "#80d8ff", emissive: "#40c4ff" },
  { id: "gold", label: "Scrap gold", primary: "#ffd54f", emissive: "#ffb300" },
  { id: "ink", label: "Night ink", primary: "#37474f", emissive: "#90a4ae" },
];

const BODY_STYLES: BodyStyle[] = ["stock", "widebody", "ratrod"];

const VEHICLES: { id: VehicleId; label: string; blurb: string }[] = [
  { id: "hauler", label: "Hauler", blurb: "Balanced cab · steady gun bed" },
  { id: "buggy", label: "Dune buggy", blurb: "Snappy turn · lighter hull feel" },
  { id: "wagon", label: "Long wagon", blurb: "Wide bed · room to swing the gun" },
];

const TURRETS: { id: TurretId; label: string; blurb: string; color: string; rate: number }[] = [
  { id: "mg", label: "Auto MG", blurb: "Fast taps · lock-friendly", color: "#80d8ff", rate: 1 },
  { id: "scatter", label: "Scatter", blurb: "Close burst · shreds soft bosses", color: "#ffab40", rate: 0.72 },
  { id: "beam", label: "Beam lance", blurb: "Hard hits · slower cadence", color: "#e040fb", rate: 0.55 },
];

const GARAGE_KEY = "holojay.bossGarage";

type GarageState = {
  vehicle: VehicleId;
  paintIdx: number;
  kitIdx: number;
  turret: TurretId;
};

function loadGarage(): GarageState {
  try {
    const raw = localStorage.getItem(GARAGE_KEY);
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw) as Partial<GarageState>;
    const vehicle = VEHICLES.some((v) => v.id === parsed.vehicle) ? (parsed.vehicle as VehicleId) : "hauler";
    const turret = TURRETS.some((t) => t.id === parsed.turret) ? (parsed.turret as TurretId) : "mg";
    const paintIdx = Math.max(0, Math.min(PAINT_KITS.length - 1, Number(parsed.paintIdx) || 0));
    const kitIdx = Math.max(0, Math.min(BODY_STYLES.length - 1, Number(parsed.kitIdx) || 0));
    return { vehicle, paintIdx, kitIdx, turret };
  } catch {
    return { vehicle: "hauler", paintIdx: 0, kitIdx: 0, turret: "mg" };
  }
}

function saveGarage(g: GarageState) {
  try {
    localStorage.setItem(GARAGE_KEY, JSON.stringify(g));
  } catch {
    /* ignore */
  }
}

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

type SfxKind = "fire" | "hurt" | "hit" | "kill" | "boom" | "intro" | "lock";
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
      lock: { f: 880, f2: 1320, dur: 0.08, type: "sine", vol: 0.045 },
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
  const [seat, setSeat] = useState<Role>("driver");
  const seatRef = useRef<Role>("driver");
  const [garage, setGarage] = useState<GarageState>(() => loadGarage());
  const garageRef = useRef(garage);
  garageRef.current = garage;
  const [lockedHud, setLockedHud] = useState(true);
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
  const pz = useRef(Math.min(55, ARENA_R * 0.35));
  const py = useRef(0.85);
  const yaw = useRef(Math.PI);
  const speed = useRef(0);
  const gunYaw = useRef(Math.PI);
  const gunPitch = useRef(0.1);
  const lockedOn = useRef(true);
  const keys = useRef({ throttle: 0, steer: 0 });
  const fireHeld = useRef(false);
  const fireCd = useRef(0);
  const invuln = useRef(0);
  const lookQ = useRef({ x: 0, y: 0 });
  const nextId = useRef(1);
  const bullets = useRef<Bullet[]>([]);
  const bulletGroup = useRef<THREE.Group>(null);
  const truck = useRef<THREE.Group>(null);
  const gunMount = useRef<THREE.Group>(null);
  const gunPitchMount = useRef<THREE.Group>(null);
  const bossGroup = useRef<THREE.Group>(null);
  const serpentGroup = useRef<THREE.Group>(null);
  const bossKind = useRef<BossKind>("skull");
  const [bossKindHud, setBossKindHud] = useState<BossKind>("skull");
  const bossHpRef = useRef(0);
  const bossAge = useRef(0);
  const bossCd = useRef(1.2);
  const bossPhase = useRef(0);
  const slimeHop = useRef(0);
  const slimeVy = useRef(0);
  const slimeY = useRef(2.4);
  const serpentSegs = useRef<{ x: number; y: number; z: number }[]>([]);
  /** >0 while charging the truck; telegraph when between -0.55 and 0. */
  const serpentLungeT = useRef(0);
  const serpentLungeDir = useRef({ x: 0, y: 0, z: 1 });
  const serpentHitLatch = useRef(false);
  const clearT = useRef(0);
  const introT = useRef(0);
  const shake = useRef(0);
  const hudRoot = useRef<Root | null>(null);
  const aiSteer = useRef(0);

  const wave = waveDef(waveIdx);

  function setPhaseBoth(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function pickSeat(role: Role) {
    seatRef.current = role;
    setSeat(role);
  }

  function patchGarage(patch: Partial<GarageState>) {
    setGarage((prev) => {
      const next = { ...prev, ...patch };
      saveGarage(next);
      return next;
    });
  }

  function toggleLock() {
    lockedOn.current = !lockedOn.current;
    setLockedHud(lockedOn.current);
    playSfx("lock");
    flash(lockedOn.current ? "BOSS LOCK ON" : "LOCK OFF · FREE LOOK", 1.1);
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
    setBossHp(w.hp);
    setBossMax(w.hp);
    bossAge.current = 0;
    bossCd.current = 1.1;
    bossPhase.current = 0;
    slimeY.current = 6.5;
    slimeVy.current = 0;
    slimeHop.current = 0;
    if (w.kind === "serpent") {
      serpentSegs.current = Array.from({ length: 16 }, (_, i) => ({
        x: Math.sin(i * 0.35) * 18,
        y: 4.5 + Math.sin(i * 0.5) * 1.2,
        z: -18 - i * 3.2,
      }));
      serpentLungeT.current = -1.4;
      serpentHitLatch.current = false;
    } else {
      serpentSegs.current = [];
      serpentLungeT.current = 0;
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
    pz.current = Math.min(55, ARENA_R * 0.35);
    py.current = 0.85;
    yaw.current = Math.PI;
    speed.current = 0;
    gunYaw.current = Math.PI;
    gunPitch.current = 0.1;
    lockedOn.current = true;
    setLockedHud(true);
    bullets.current = [];
    invuln.current = 0;
    fireCd.current = 0;
    keys.current = { throttle: 0, steer: 0 };
    waveIdxRef.current = 0;
    setWaveIdx(0);
    let start = 0;
    try {
      const kind = sessionStorage.getItem("holojay.bossKind");
      if (kind === "serpent") start = 2;
      else if (kind === "slime") start = 1;
      else if (kind === "skull") start = 0;
    } catch {
      /* ignore */
    }
    beginWave(start);
  }

  function bossCenter(): { x: number; y: number; z: number } {
    if (bossKind.current === "serpent" && serpentSegs.current[0]) return serpentSegs.current[0]!;
    if (bossKind.current === "slime") {
      return {
        x: Math.sin(bossAge.current * 0.35) * 42,
        y: slimeY.current,
        z: -12 + Math.cos(bossAge.current * 0.28) * 28,
      };
    }
    return {
      x: Math.sin(bossAge.current * 0.42) * 48,
      y: 6.5 + Math.sin(bossAge.current * 1.1) * 1.4,
      z: -16 + Math.cos(bossAge.current * 0.36) * 36,
    };
  }

  function turretWorld() {
    const ox = Math.sin(yaw.current) * -TURRET_BACK;
    const oz = Math.cos(yaw.current) * -TURRET_BACK;
    return { x: px.current + ox, y: py.current + 0.8, z: pz.current + oz };
  }

  function muzzleWorld() {
    const t = turretWorld();
    const cy = Math.cos(gunYaw.current);
    const sy = Math.sin(gunYaw.current);
    const cp = Math.cos(gunPitch.current);
    const sp = Math.sin(gunPitch.current);
    const len = 1.85;
    return {
      x: t.x + sy * cp * len,
      y: t.y + sp * len,
      z: t.z + cy * cp * len,
    };
  }

  function fireBossShot(
    from: { x: number; y: number; z: number },
    towardPlayer: boolean,
    tint: string,
    spd = 16,
    dmg = 1,
  ) {
    let dx = 0;
    let dy = 0;
    let dz = 0;
    if (towardPlayer) {
      dx = px.current - from.x;
      dy = py.current + 0.6 - from.y;
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
      speed: spd,
      life: 3.5,
      friendly: false,
      tint,
      scale: 1.4,
      dmg,
    });
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
      const paint = PAINT_KITS[garage.paintIdx] ?? PAINT_KITS[0]!;
      root.render(
        <div className="sky-escort-garage boss-wave-garage" aria-live="polite">
          <p className="sky-escort-garage-kicker">Boss Wave · Garage</p>
          <h2 className="sky-escort-garage-title">CUSTOMIZE</h2>
          <p className="sky-escort-garage-sub">
            Kit the truck and turret, pick a seat, then roll into the arena
          </p>

          <div className="sky-escort-garage-cols">
            <section className="sky-escort-garage-panel">
              <header>
                <strong>Vehicle</strong>
                <span>Driver</span>
              </header>
              <div className="sky-escort-garage-grid">
                {VEHICLES.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`sky-escort-garage-card${garage.vehicle === v.id ? " on" : ""}`}
                    onClick={() => patchGarage({ vehicle: v.id })}
                  >
                    <strong>{v.label}</strong>
                    <em>{v.blurb}</em>
                  </button>
                ))}
              </div>
              <p className="sky-escort-garage-label">Paint wrap</p>
              <div className="sky-escort-garage-swatches">
                {PAINT_KITS.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    title={p.label}
                    className={`sky-escort-garage-swatch${garage.paintIdx === i ? " on" : ""}`}
                    style={{
                      background: p.primary,
                      boxShadow: garage.paintIdx === i ? `0 0 0 2px #f4ecdc, 0 0 12px ${p.emissive}` : undefined,
                    }}
                    onClick={() => patchGarage({ paintIdx: i })}
                  />
                ))}
              </div>
              <p className="sky-escort-garage-paintname">{paint.label}</p>
              <p className="sky-escort-garage-label">Body kit</p>
              <div className="sky-escort-garage-grid kit">
                {BODY_STYLES.map((kit, i) => (
                  <button
                    key={kit}
                    type="button"
                    className={`sky-escort-garage-card slim${garage.kitIdx === i ? " on" : ""}`}
                    onClick={() => patchGarage({ kitIdx: i })}
                  >
                    <strong>{kit}</strong>
                  </button>
                ))}
              </div>
            </section>

            <section className="sky-escort-garage-panel">
              <header>
                <strong>Turret</strong>
                <span>Gunner</span>
              </header>
              <div className="sky-escort-garage-grid">
                {TURRETS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`sky-escort-garage-card${garage.turret === t.id ? " on" : ""}`}
                    style={{ ["--up-color" as string]: t.color }}
                    onClick={() => patchGarage({ turret: t.id })}
                  >
                    <strong>{t.label}</strong>
                    <em>{t.blurb}</em>
                  </button>
                ))}
              </div>
              <p className="sky-escort-garage-label">Tonight&apos;s giants</p>
              <ol className="boss-wave-roster compact">
                {BASE_WAVES.map((w, i) => (
                  <li key={w.kind} style={{ ["--bw-color" as string]: w.color }}>
                    <strong>
                      {i + 1}. {w.name}
                    </strong>
                    <span>{w.blurb}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <div className="sky-escort-garage-seat">
            <button type="button" className={seat === "driver" ? "on" : ""} onClick={() => pickSeat("driver")}>
              Driver
            </button>
            <button type="button" className={seat === "gunner" ? "on" : ""} onClick={() => pickSeat("gunner")}>
              Gunner
            </button>
            <button type="button" className="primary" onClick={() => resetAll()}>
              Roll out
            </button>
          </div>
          <p className="sky-escort-garage-hint">Tap a card · pick Driver or Gunner · Roll out · Space starts · Tab swaps seat</p>
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
            <span>{seat === "driver" ? "DRIVER" : "GUNNER"}</span>
            <span className={lockedHud ? "boss-wave-lock on" : "boss-wave-lock"}>
              {lockedHud ? "LOCK ON" : "FREE AIM"}
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
          {seat === "gunner" ? (
            <div className={`boss-wave-crosshair${lockedHud ? " locked" : ""}`}>
              <span />
              <span />
              {lockedHud ? <i className="boss-wave-lockring" /> : null}
            </div>
          ) : null}
          <GameTouchControls
            mode={seat === "driver" ? "vehicle-driver" : "vehicle-gunner"}
            onLock={() => toggleLock()}
            onSeat={() => pickSeat(seatRef.current === "driver" ? "gunner" : "driver")}
          />
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
  }, [
    phase,
    introWave,
    waveIdx,
    hull,
    bossHp,
    bossMax,
    banner,
    wave.name,
    wave.color,
    seat,
    lockedHud,
    garage,
  ]);

  useEffect(() => {
    camera.position.set(0, 48, 72);
    camera.lookAt(0, 4, 0);
    camera.near = 0.1;
    camera.far = 520;
    camera.updateProjectionMatrix();
    return () => {
      document.exitPointerLock?.();
      resetVehiclePad();
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

      if (p === "ready") {
        if (e.code === "Digit1") pickSeat("driver");
        if (e.code === "Digit2") pickSeat("gunner");
        if (e.code === "Tab") {
          e.preventDefault();
          pickSeat(seatRef.current === "driver" ? "gunner" : "driver");
        }
        if (e.code === "Space" || e.code === "Enter") {
          e.preventDefault();
          resetAll();
        }
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

      if (e.code === "Tab") {
        e.preventDefault();
        pickSeat(seatRef.current === "driver" ? "gunner" : "driver");
        return;
      }
      if (e.code === "KeyQ" || e.code === "KeyL") {
        e.preventDefault();
        toggleLock();
        return;
      }

      if (seatRef.current === "driver") {
        if (e.code === "KeyW" || e.code === "ArrowUp") keys.current.throttle = 1;
        if (e.code === "KeyS" || e.code === "ArrowDown") keys.current.throttle = -1;
        if (e.code === "KeyA" || e.code === "ArrowLeft") keys.current.steer = 1;
        if (e.code === "KeyD" || e.code === "ArrowRight") keys.current.steer = -1;
      }
      if (seatRef.current === "gunner" && (e.code === "Space" || e.code === "KeyF")) {
        fireHeld.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "KeyW" || e.code === "ArrowUp") {
        if (keys.current.throttle > 0) keys.current.throttle = 0;
      }
      if (e.code === "KeyS" || e.code === "ArrowDown") {
        if (keys.current.throttle < 0) keys.current.throttle = 0;
      }
      if (e.code === "KeyA" || e.code === "ArrowLeft") {
        if (keys.current.steer > 0) keys.current.steer = 0;
      }
      if (e.code === "KeyD" || e.code === "ArrowRight") {
        if (keys.current.steer < 0) keys.current.steer = 0;
      }
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
      if (phaseRef.current !== "fight" || seatRef.current !== "gunner") return;
      if (lockedOn.current) return; // lock owns aim
      lookQ.current.x += e.movementX;
      lookQ.current.y += e.movementY;
    };
    const onDown = (e: MouseEvent) => {
      if (phaseRef.current !== "fight") return;
      if (e.button === 1) {
        e.preventDefault();
        toggleLock();
        return;
      }
      if (seatRef.current !== "gunner") return;
      if (!isTouchUi() && document.pointerLockElement !== el) void el.requestPointerLock();
      fireHeld.current = true;
    };
    const onUp = () => {
      fireHeld.current = false;
    };
    const onContext = (e: Event) => e.preventDefault();
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    el.addEventListener("contextmenu", onContext);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      el.removeEventListener("contextmenu", onContext);
    };
  }, [gl]);

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
      if (clearT.current <= 0) beginWave(waveIdxRef.current + 1);
    }

    const fighting = phaseRef.current === "fight";
    const bc = bossCenter();

    if (fighting) {
      // —— Drive (player or AI if you're on the gun) ——
      let throttle = keys.current.throttle;
      let steer = keys.current.steer;
      if (seatRef.current === "driver") {
        if (Math.abs(vehiclePad.throttle) > 0.08) throttle = vehiclePad.throttle;
        if (Math.abs(vehiclePad.steer) > 0.08) steer = vehiclePad.steer;
      }
      if (seatRef.current === "gunner") {
        // AI driver orbits the arena and keeps distance from the boss.
        const want = Math.atan2(bc.x - px.current, bc.z - pz.current) + Math.PI * 0.55;
        let err = want - yaw.current;
        while (err > Math.PI) err -= Math.PI * 2;
        while (err < -Math.PI) err += Math.PI * 2;
        aiSteer.current = THREE.MathUtils.damp(aiSteer.current, THREE.MathUtils.clamp(err * 1.8, -1, 1), 6, clamped);
        steer = aiSteer.current;
        const dist = Math.hypot(bc.x - px.current, bc.z - pz.current);
        throttle = dist < 28 ? -0.35 : dist > 55 ? 0.95 : 0.55;
      }

      const g = garageRef.current;
      const driveMul = g.vehicle === "buggy" ? 1.18 : g.vehicle === "wagon" ? 0.88 : 1;
      const turnMul = g.vehicle === "buggy" ? 1.2 : g.vehicle === "wagon" ? 0.85 : 1;
      yaw.current += steer * TURN_RATE * turnMul * clamped * (0.7 + Math.min(0.4, Math.abs(speed.current) / 28));
      const target = throttle * DRIVE_SPEED * driveMul;
      speed.current = THREE.MathUtils.damp(speed.current, target, throttle === 0 ? 2.2 : 7, clamped);
      px.current += Math.sin(yaw.current) * speed.current * clamped;
      pz.current += Math.cos(yaw.current) * speed.current * clamped;
      const r = Math.hypot(px.current, pz.current);
      if (r > ARENA_R - 4) {
        const s = (ARENA_R - 4) / r;
        px.current *= s;
        pz.current *= s;
        speed.current *= 0.65;
      }

      // —— Gun aim: lock-on tracks boss, else free-look (player gunner or AI) ——
      const wantLock = lockedOn.current;
      if (wantLock) {
        const tw = turretWorld();
        const dx = bc.x - tw.x;
        const dy = bc.y - tw.y;
        const dz = bc.z - tw.z;
        const targetYaw = Math.atan2(dx, dz);
        const dist = Math.hypot(dx, dz) || 1;
        const targetPitch = Math.atan2(dy, dist);
        let dyaw = targetYaw - gunYaw.current;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        gunYaw.current += dyaw * Math.min(1, 10 * clamped);
        gunPitch.current = THREE.MathUtils.damp(gunPitch.current, THREE.MathUtils.clamp(targetPitch, -0.35, 0.7), 10, clamped);
      } else if (seatRef.current === "gunner") {
        const stick = vehiclePad.stickX || vehiclePad.stickY;
        if (stick) {
          lookQ.current.x += vehiclePad.stickX * 22;
          lookQ.current.y += vehiclePad.stickY * 18;
        }
        const flicked = consumeVehicleLook();
        lookQ.current.x += flicked.x;
        lookQ.current.y += flicked.y;
        gunYaw.current -= lookQ.current.x * 0.0032;
        gunPitch.current = Math.max(-0.4, Math.min(0.75, gunPitch.current - lookQ.current.y * 0.0028));
        lookQ.current.x *= 0.08;
        lookQ.current.y *= 0.08;
      } else {
        // AI gunner always locks when you're driving
        if (!lockedOn.current) {
          lockedOn.current = true;
          setLockedHud(true);
        }
        const tw = turretWorld();
        const dx = bc.x - tw.x;
        const dy = bc.y - tw.y;
        const dz = bc.z - tw.z;
        gunYaw.current = Math.atan2(dx, dz);
        gunPitch.current = Math.atan2(dy, Math.hypot(dx, dz) || 1);
      }

      // Fire — player gunner or AI gunner
      fireCd.current = Math.max(0, fireCd.current - clamped);
      const aiFire = seatRef.current === "driver";
      const shouldFire =
        seatRef.current === "gunner" ? fireHeld.current || vehiclePad.fire : aiFire && fireCd.current <= 0;
      if (shouldFire && fireCd.current <= 0) {
        const tip = muzzleWorld();
        const cy = Math.cos(gunYaw.current);
        const sy = Math.sin(gunYaw.current);
        const cp = Math.cos(gunPitch.current);
        const sp = Math.sin(gunPitch.current);
        // Slight lead assist only while locked
        let dx = sy * cp;
        let dy = sp;
        let dz = cy * cp;
        if (lockedOn.current && aiFire) {
          // AI keeps tight lock shots
          const tw = tip;
          const len = Math.hypot(bc.x - tw.x, bc.y - tw.y, bc.z - tw.z) || 1;
          dx = (bc.x - tw.x) / len;
          dy = (bc.y - tw.y) / len;
          dz = (bc.z - tw.z) / len;
        }
        const turret = garageRef.current.turret;
        const tipColor = TURRETS.find((t) => t.id === turret)?.color ?? "#80d8ff";
        const dmg = turret === "beam" ? 2 : 1;
        if (turret === "scatter") {
          for (let i = 0; i < 5; i++) {
            const jx = (Math.random() - 0.5) * 0.18;
            const jy = (Math.random() - 0.5) * 0.14;
            const jz = (Math.random() - 0.5) * 0.18;
            let sdx = dx + jx;
            let sdy = dy + jy;
            let sdz = dz + jz;
            const len = Math.hypot(sdx, sdy, sdz) || 1;
            bullets.current.push({
              id: nextId.current++,
              x: tip.x,
              y: tip.y,
              z: tip.z,
              dx: sdx / len,
              dy: sdy / len,
              dz: sdz / len,
              speed: 40,
              life: 1.1,
              friendly: true,
              tint: tipColor,
              scale: 0.85,
              dmg: 1,
            });
          }
        } else {
          bullets.current.push({
            id: nextId.current++,
            x: tip.x,
            y: tip.y,
            z: tip.z,
            dx,
            dy,
            dz,
            speed: turret === "beam" ? 62 : 48,
            life: turret === "beam" ? 2.1 : 1.7,
            friendly: true,
            tint: lockedOn.current ? tipColor : "#ffe082",
            scale: turret === "beam" ? 1.55 : 1,
            dmg,
          });
        }
        fireCd.current = (aiFire ? 0.22 : 0.11) / (TURRETS.find((t) => t.id === turret)?.rate ?? 1);
        playSfx("fire");
      }

      // Boss AI (unchanged patterns)
      bossAge.current += clamped;
      bossCd.current = Math.max(0, bossCd.current - clamped);
      const kind = bossKind.current;

      if (kind === "skull") {
        if (bossCd.current <= 0) {
          const burst = 3 + Math.floor(bossPhase.current % 2);
          for (let i = 0; i < burst; i++) {
            fireBossShot({ x: bc.x + (i - 1) * 0.6, y: bc.y - 0.3, z: bc.z }, true, "#ff6d00", 14 + i, 1);
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
          slimeY.current = 6.2;
          if (slimeVy.current < -4) {
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
          const segGap = 1.05 * BOSS_SCALE;
          const lungeHitR = 2.8 * BOSS_SCALE;

          // Telegraph (negative) → lunge (positive) → brief rest, then re-arm
          if (serpentLungeT.current < 0) {
            serpentLungeT.current = Math.min(0, serpentLungeT.current + clamped);
            if (serpentLungeT.current >= 0) {
              const dx = px.current - head.x;
              const dy = py.current + 1.1 - head.y;
              const dz = pz.current - head.z;
              const len = Math.hypot(dx, dy, dz) || 1;
              serpentLungeDir.current = { x: dx / len, y: dy / len, z: dz / len };
              serpentLungeT.current = 0.95;
              serpentHitLatch.current = false;
              shake.current = Math.max(shake.current, 0.35);
              flash("SERPENT LUNGE", 0.85);
              playSfx("boom");
            }
          } else if (serpentLungeT.current > 0) {
            const rush = 58;
            head.x += serpentLungeDir.current.x * rush * clamped;
            head.y += serpentLungeDir.current.y * rush * clamped;
            head.z += serpentLungeDir.current.z * rush * clamped;
            // Slight home-in so it still tracks a moving truck
            head.x += (px.current - head.x) * 1.1 * clamped;
            head.z += (pz.current - head.z) * 1.1 * clamped;
            serpentLungeT.current -= clamped;
            if (
              !serpentHitLatch.current &&
              Math.hypot(px.current - head.x, pz.current - head.z) < lungeHitR &&
              Math.abs(py.current + 0.5 - head.y) < lungeHitR * 0.85
            ) {
              serpentHitLatch.current = true;
              hurt(2);
              shake.current = Math.max(shake.current, 0.85);
              playSfx("hurt");
            }
            if (serpentLungeT.current <= 0) {
              serpentLungeT.current = -(2.4 - Math.min(0.9, waveIdxRef.current * 0.08));
            }
          }

          // Orbit when not mid-lunge charge
          if (serpentLungeT.current <= 0) {
            const orbit = 38 + Math.sin(t * 0.25) * 8;
            const targetX = Math.sin(t * 0.55) * orbit;
            const targetZ = -10 + Math.cos(t * 0.42) * orbit * 0.75;
            const targetY = 7 + Math.sin(t * 1.1) * 2.2;
            // Wind-up: rear back and face the truck before the charge
            if (serpentLungeT.current > -0.55 && serpentLungeT.current < 0) {
              const awayX = head.x - px.current;
              const awayZ = head.z - pz.current;
              const al = Math.hypot(awayX, awayZ) || 1;
              head.x += (awayX / al) * 12 * clamped;
              head.z += (awayZ / al) * 12 * clamped;
              head.y += 6 * clamped;
            } else {
              head.x += (targetX - head.x) * 1.4 * clamped;
              head.z += (targetZ - head.z) * 1.4 * clamped;
              head.y += (targetY - head.y) * 1.8 * clamped;
            }
          }

          // Soft arena clamp so a miss doesn't leave the map
          const hr = Math.hypot(head.x, head.z);
          if (hr > ARENA_R - 6) {
            const s = (ARENA_R - 6) / hr;
            head.x *= s;
            head.z *= s;
          }

          for (let i = 1; i < segs.length; i++) {
            const prev = segs[i - 1]!;
            const cur = segs[i]!;
            const dx = prev.x - cur.x;
            const dy = prev.y - cur.y;
            const dz = prev.z - cur.z;
            const d = Math.hypot(dx, dy, dz) || 1;
            cur.x = prev.x - (dx / d) * segGap;
            cur.y = prev.y - (dy / d) * segGap;
            cur.z = prev.z - (dz / d) * segGap;
          }
        }
        if (bossCd.current <= 0 && serpentLungeT.current <= 0) {
          const head = serpentSegs.current[0] ?? bc;
          fireBossShot(head, true, "#e040fb", 22, 1);
          if (bossPhase.current % 3 === 0) {
            fireBossShot(head, true, "#80d8ff", 24, 1);
            fireBossShot(head, false, "#ff80ab", 16, 1);
          }
          bossCd.current = Math.max(0.45, 1.0 - waveIdxRef.current * 0.04);
          bossPhase.current += 1;
          playSfx("fire");
        }
      }

      if (kind !== "serpent") {
        const hitR = (kind === "slime" ? 3.4 : 2.6) * BOSS_SCALE;
        if (Math.hypot(px.current - bc.x, pz.current - bc.z) < hitR && Math.abs(py.current + 0.4 - bc.y) < hitR) {
          hurt(1);
        }
      }
    }

    for (const b of bullets.current) {
      b.x += b.dx * b.speed * clamped;
      b.y += b.dy * b.speed * clamped;
      b.z += b.dz * b.speed * clamped;
      b.life -= clamped;
      if (b.friendly && phaseRef.current === "fight") {
        const hit = bossCenter();
        const hitR =
          (bossKind.current === "slime" ? 3.4 : bossKind.current === "serpent" ? 1.6 : 2.5) * BOSS_SCALE;
        if (Math.hypot(b.x - hit.x, b.y - hit.y, b.z - hit.z) < hitR) {
          damageBoss(b.dmg);
          b.life = -1;
        }
        if (bossKind.current === "serpent") {
          for (const seg of serpentSegs.current) {
            if (Math.hypot(b.x - seg.x, b.y - seg.y, b.z - seg.z) < 1.35 * BOSS_SCALE) {
              damageBoss(b.dmg);
              b.life = -1;
              break;
            }
          }
        }
      } else if (!b.friendly && phaseRef.current === "fight") {
        if (Math.hypot(b.x - px.current, b.y - (py.current + 0.7), b.z - pz.current) < 1.35) {
          hurt(b.dmg);
          b.life = -1;
        }
      }
    }
    bullets.current = bullets.current.filter((b) => b.life > 0 && Math.hypot(b.x, b.z) < ARENA_R + 24);

    syncGroup(
      bulletGroup.current,
      bullets.current,
      (b, mesh) => {
        mesh.visible = true;
        mesh.position.set(b.x, b.y, b.z);
        (mesh.material as THREE.MeshBasicMaterial).color.set(b.tint);
        mesh.scale.setScalar(b.scale);
      },
      () => new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshBasicMaterial({ color: "#ffe082" })),
    );

    if (truck.current) {
      truck.current.position.set(px.current, py.current, pz.current);
      truck.current.rotation.y = yaw.current;
      const pulse = invuln.current > 0 ? 0.5 + Math.sin(performance.now() * 0.03) * 0.25 : 1;
      truck.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.material && "opacity" in (m.material as THREE.Material)) {
          const mat = m.material as THREE.MeshStandardMaterial;
          if (mat.transparent || invuln.current > 0) {
            mat.transparent = true;
            mat.opacity = pulse;
          }
        }
      });
    }
    if (gunMount.current) {
      let rel = gunYaw.current - yaw.current;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      gunMount.current.rotation.y = rel;
    }
    if (gunPitchMount.current) gunPitchMount.current.rotation.x = -gunPitch.current;

    if (bossGroup.current) {
      const g = bossGroup.current;
      const c = bossCenter();
      g.position.set(c.x, c.y, c.z);
      g.visible =
        bossKind.current !== "serpent" &&
        (phaseRef.current === "fight" || phaseRef.current === "intro" || phaseRef.current === "clear");
      g.rotation.y = Math.atan2(px.current - c.x, pz.current - c.z);
      if (bossKind.current === "skull") g.rotation.z = Math.sin(bossAge.current * 2) * 0.12;
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
          if (i === 0 && segs[1]) child.lookAt(segs[1].x, segs[1].y, segs[1].z);
          else if (i > 0) child.lookAt(segs[i - 1]!.x, segs[i - 1]!.y, segs[i - 1]!.z);
        }
      }
    }

    // Camera — driver chase vs gunner cheek-weld (pulls toward lock target)
    const ox = (Math.random() - 0.5) * shake.current * 0.35;
    const oy = (Math.random() - 0.5) * shake.current * 0.25;
    const persp = camera as THREE.PerspectiveCamera;
    if (phaseRef.current === "ready") {
      camera.position.set(ox, 52, 78);
      camera.lookAt(0, 3, 0);
    } else if (seatRef.current === "gunner" && (phaseRef.current === "fight" || phaseRef.current === "intro" || phaseRef.current === "clear")) {
      const t = turretWorld();
      const cy = Math.cos(gunYaw.current);
      const sy = Math.sin(gunYaw.current);
      const cp = Math.cos(gunPitch.current);
      const sp = Math.sin(gunPitch.current);
      // Raised over-shoulder — close cheek-weld clipped inside the bed rails
      const back = lockedOn.current ? 2.6 : 2.1;
      const lift = 1.45;
      camera.position.set(t.x - sy * cp * back + ox, t.y + lift + oy, t.z - cy * cp * back);
      if (lockedOn.current) {
        camera.lookAt(bc.x, bc.y, bc.z);
      } else {
        camera.lookAt(camera.position.x + sy * cp * 40, camera.position.y + sp * 40, camera.position.z + cy * cp * 40);
      }
      if (persp.isPerspectiveCamera) {
        persp.fov = THREE.MathUtils.damp(persp.fov, lockedOn.current ? 56 : 66, 8, clamped);
        persp.updateProjectionMatrix();
      }
    } else {
      const back = 18;
      const tx = px.current - Math.sin(yaw.current) * back;
      const ty = py.current + 7.2;
      const tz = pz.current - Math.cos(yaw.current) * back;
      camera.position.x = THREE.MathUtils.damp(camera.position.x, tx + ox, 7, clamped);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, ty + oy, 7, clamped);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, tz, 7, clamped);
      camera.lookAt(px.current + Math.sin(yaw.current) * 14, 2.2, pz.current + Math.cos(yaw.current) * 14);
      if (persp.isPerspectiveCamera) {
        persp.fov = THREE.MathUtils.damp(persp.fov, 58, 8, clamped);
        persp.updateProjectionMatrix();
      }
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

  const paint = PAINT_KITS[garage.paintIdx] ?? PAINT_KITS[0]!;
  const turretDef = TURRETS.find((t) => t.id === garage.turret) ?? TURRETS[0]!;
  const kit = BODY_STYLES[garage.kitIdx] ?? "stock";
  const bodyW = kit === "widebody" ? 1.12 : kit === "ratrod" ? 0.92 : 1;
  const cabColor = paint.primary || color;

  return (
    <group>
      <color attach="background" args={["#0a0610"]} />
      <fog attach="fog" args={["#120818", 55, 260]} />
      <ambientLight intensity={0.45} />
      <hemisphereLight args={["#e1bee7", "#1a1020", 0.65]} />
      <directionalLight position={[40, 60, 28]} intensity={1.15} color="#ffe0b2" />
      <pointLight position={[0, 28, 0]} color={color} intensity={48} distance={220} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={mats.arena}>
        <circleGeometry args={[ARENA_R, 96]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[ARENA_R - 1.2, ARENA_R, 96]} />
        <meshStandardMaterial color="#b388ff" emissive="#7c4dff" emissiveIntensity={0.9} />
      </mesh>
      <mesh material={mats.rim}>
        <cylinderGeometry args={[ARENA_R + 0.6, ARENA_R + 0.6, 8, 64, 1, true]} />
      </mesh>

      <group ref={bulletGroup} />

      {/* Escort truck — driver cab + bed turret */}
      <group ref={truck} position={[0, 0.85, Math.min(55, ARENA_R * 0.35)]} rotation={[0, Math.PI, 0]} scale={[bodyW, 1, garage.vehicle === "wagon" ? 1.12 : garage.vehicle === "buggy" ? 0.9 : 1]}>
        <mesh position={[0, 0.28, -0.1]} castShadow>
          <boxGeometry args={[2.6, 0.4, 5.2]} />
          <meshStandardMaterial color="#1c1612" metalness={0.45} roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.85, 1.45]} castShadow>
          <boxGeometry args={[2.15, 0.9, 1.4]} />
          <meshStandardMaterial color={cabColor} emissive={paint.emissive || color} emissiveIntensity={0.55} />
        </mesh>
        <mesh position={[0, 0.55, -1.1]} castShadow>
          <boxGeometry args={[2.35, 0.18, 2.6]} />
          <meshStandardMaterial color="#1a1410" metalness={0.5} />
        </mesh>
        <mesh position={[-1.1, 0.85, -1.1]}>
          <boxGeometry args={[0.12, 0.5, 2.5]} />
          <meshStandardMaterial color="#3e2723" />
        </mesh>
        <mesh position={[1.1, 0.85, -1.1]}>
          <boxGeometry args={[0.12, 0.5, 2.5]} />
          <meshStandardMaterial color="#3e2723" />
        </mesh>
        {[
          [-1.2, 0.05, 1.55],
          [1.2, 0.05, 1.55],
          [-1.2, 0.05, -1.7],
          [1.2, 0.05, -1.7],
        ].map((p, i) => (
          <mesh key={i} position={p as [number, number, number]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.52, 0.52, 0.4, 12]} />
            <meshStandardMaterial color="#0e0a08" roughness={0.95} />
          </mesh>
        ))}
        <mesh position={[0, 0.78, -TURRET_BACK]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.55, 0.9, 20]} />
          <meshStandardMaterial color="#5d4037" metalness={0.7} side={THREE.DoubleSide} />
        </mesh>
        <group ref={gunMount} position={[0, 1.55, -TURRET_BACK]}>
          <mesh position={[0, -0.15, 0]}>
            <cylinderGeometry args={[0.4, 0.48, 0.3, 14]} />
            <meshStandardMaterial color="#3e2723" metalness={0.6} />
          </mesh>
          <group ref={gunPitchMount}>
            <mesh position={[0, 0.08, 0.45]}>
              <boxGeometry args={[0.35, 0.28, 0.55]} />
              <meshStandardMaterial color="#efebe9" metalness={0.8} />
            </mesh>
            <mesh position={[0, 0.06, 1.35]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.09, 0.12, 1.7, 10]} />
              <meshStandardMaterial color="#d7ccc8" metalness={0.85} />
            </mesh>
            <mesh position={[0, 0.06, 2.2]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.14, 0.1, 0.22, 8]} />
              <meshStandardMaterial color={turretDef.color} emissive={turretDef.color} emissiveIntensity={1.1} />
            </mesh>
            <pointLight position={[0, 0.2, 1]} color={turretDef.color} intensity={4} distance={7} />
          </group>
        </group>
        <pointLight position={[0, 1.2, 2]} color={cabColor} intensity={8} distance={12} />
      </group>

      <group ref={bossGroup} scale={[BOSS_SCALE, BOSS_SCALE, BOSS_SCALE]}>
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

      <group ref={serpentGroup} visible={false} scale={[BOSS_SCALE, BOSS_SCALE, BOSS_SCALE]}>
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
                  {/* Unicorn horn — ~4× the old stub so it reads as a weapon */}
                  <mesh position={[0, 2.35, 0.55]} rotation={[0.55, 0, 0]}>
                    <coneGeometry args={[0.72, 4.4, 8]} />
                    <meshStandardMaterial color="#fff8e1" emissive="#ffe082" emissiveIntensity={1.85} metalness={0.75} roughness={0.22} />
                  </mesh>
                  <mesh position={[0, 0.55, 0.15]} rotation={[0.55, 0, 0]}>
                    <cylinderGeometry args={[0.55, 0.7, 0.55, 8]} />
                    <meshStandardMaterial color="#ffe082" emissive="#ffd54f" emissiveIntensity={1.1} metalness={0.6} />
                  </mesh>
                  <pointLight position={[0, 3.2, 1.2]} color="#ffe082" intensity={22} distance={28} />
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
