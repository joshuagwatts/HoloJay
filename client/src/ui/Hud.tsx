import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { CHECKPOINT_COUNT, gameById, hatById } from "@holojay/shared";
import { clearToken } from "../auth/api.ts";
import { setPadAxis, setPadSprint } from "../inputPad.ts";
import { shareInvite } from "../invite.ts";
import { wearHat } from "../net/localRealm.ts";
import { disconnectRealm, emitChat, emitEnter, emitFollow, emitLeave, emitPin, emitUnpin } from "../net/session.ts";
import { useGame } from "../state/store.ts";
import { isTouchUi, watchTouchUi } from "../touchUi.ts";
import { ChannelBadge } from "./ChannelBadge.tsx";
import { GameTouchControls } from "./GameTouchControls.tsx";
import { ProfilePanel } from "./ProfilePanel.tsx";

function holdAxis(axis: "forward" | "right" | "up", value: number) {
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setPadAxis(axis, value);
    },
    onPointerUp: () => setPadAxis(axis, 0),
    onPointerCancel: () => setPadAxis(axis, 0),
    onLostPointerCapture: () => setPadAxis(axis, 0),
  };
}

export function Hud() {
  const user = useGame((s) => s.user);
  const connected = useGame((s) => s.connected);
  const offline = useGame((s) => s.offline);
  const nearby = useGame((s) => s.nearby);
  const nearbyHat = useGame((s) => s.nearbyHat);
  const wornHatId = useGame((s) => s.wornHatId);
  const loopVisited = useGame((s) => s.loopVisited);
  const loopCount = useGame((s) => s.loopCount);
  const notice = useGame((s) => s.notice);
  const followInvite = useGame((s) => s.followInvite);
  const pointerLocked = useGame((s) => s.pointerLocked);
  const chatOpen = useGame((s) => s.chatOpen);
  const ptt = useGame((s) => s.ptt);
  const micReady = useGame((s) => s.micReady);
  const location = useGame((s) => s.location);
  const favorites = useGame((s) => s.favorites);
  const players = useGame((s) => s.players);
  const [draft, setDraft] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [touch, setTouch] = useState(() => (typeof window !== "undefined" ? isTouchUi() : false));
  const inputRef = useRef<HTMLInputElement>(null);

  const progress = loopVisited.filter(Boolean).length;
  const game = nearby ? gameById(nearby.gameId) : null;
  const nearHat = nearbyHat ? hatById(nearbyHat.hatId) : null;
  const others = Object.keys(players).length;
  const inHub = location.type === "hub";
  const inArcade =
    location.type === "game" &&
    (location.gameId === "boss-wave" || location.gameId === "sky-escort" || location.gameId === "lane-rush");

  useEffect(() => watchTouchUi(setTouch), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyT" && !useGame.getState().chatOpen && !e.repeat) {
        e.preventDefault();
        document.exitPointerLock();
        useGame.getState().setChatOpen(true);
      }
      if (e.code === "Escape") {
        useGame.getState().setChatOpen(false);
        setProfileOpen(false);
        document.exitPointerLock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (chatOpen) inputRef.current?.focus();
  }, [chatOpen]);

  function sendChat(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (text) emitChat(text);
    setDraft("");
    useGame.getState().setChatOpen(false);
  }

  function logout() {
    disconnectRealm();
    clearToken();
    useGame.getState().clearAuth();
  }

  function playNearby() {
    if (!nearby) return;
    if (nearby.source === "return") emitLeave();
    else emitEnter(nearby.source, nearby.slot, nearby.gameId);
  }

  function pinNearby() {
    if (!nearby || nearby.source === "return") return;
    if (nearby.source === "favorite") emitUnpin(nearby.gameId);
    else emitPin(nearby.gameId);
  }

  async function quickInvite() {
    try {
      const how = await shareInvite({
        enter: location.type === "game" ? location.gameId : undefined,
        title: `${user?.username ?? "A friend"} invited you to HoloJay`,
      });
      useGame.getState().setNotice(how === "shared" ? "Invite shared with a friend" : "Invite link copied");
    } catch {
      useGame.getState().setNotice("Could not create invite");
    }
  }

  return (
    <div className={`hud${touch ? " touch" : ""}`}>
      <header className="hud-top">
        <button type="button" className="hud-profile-btn" onClick={() => setProfileOpen(true)}>
          <i className="hud-orb" style={{ background: user?.color ?? "#5ce1ff" }} aria-hidden />
          <span>
            <p className="kicker">
              Portal Realm
              <ChannelBadge />
            </p>
            <strong>{user?.username}</strong>
            <span className={`dot ${connected || offline ? "on" : ""}`}>
              {offline ? "solo" : connected ? "multiplayer" : "linking"}
            </span>
          </span>
        </button>
        <div className="hud-meta">
          <span>{others} nearby orb{others === 1 ? "" : "s"}</span>
          <span>{favorites.length}/6 pinned</span>
          <span>loop {loopCount}</span>
          <button type="button" className="text" onClick={() => void quickInvite()}>
            invite
          </button>
          <button type="button" className="text" onClick={() => setProfileOpen(true)}>
            profile
          </button>
          <button type="button" className="text" onClick={logout}>
            leave
          </button>
        </div>
      </header>

      <div className="loop-rail">
        <span>Figure-8</span>
        <div className="rail">
          <i style={{ width: `${(progress / CHECKPOINT_COUNT) * 100}%` }} />
        </div>
        <b>
          {progress}/{CHECKPOINT_COUNT}
        </b>
      </div>

      {!pointerLocked && !chatOpen && !touch && inHub ? (
        <div className="hint-center">
          Click to capture look · while flying, two-finger swipe steers · Esc frees mouse
        </div>
      ) : null}
      {touch && inHub && !chatOpen ? (
        <div className="hint-center touch-hint">Drag left stick to move · right stick to look · Invite friends from Profile</div>
      ) : null}

      {notice ? <div className="notice">{notice}</div> : null}

      {followInvite ? (
        <div className="invite">
          <p>
            <strong>{followInvite.fromName}</strong> opened {gameById(followInvite.gameId)?.name ?? "a door"}
          </p>
          <button type="button" onClick={() => emitFollow(followInvite.instanceId)}>
            Follow in
          </button>
        </div>
      ) : null}

      {nearbyHat && nearHat ? (
        <div className="prompt">
          <p className="prompt-name">{nearHat.name}</p>
          <p className="prompt-tag">
            {wornHatId === nearHat.id ? "Already wearing — tap Remove" : "Try it on at the dresser"}
          </p>
          <div className="prompt-actions">
            <button type="button" className="prompt-btn" onClick={() => wearHat(nearHat.id)}>
              {wornHatId === nearHat.id ? "Remove" : "Wear"}
            </button>
          </div>
        </div>
      ) : nearby && game ? (
        <div className="prompt">
          <p className="prompt-name">{game.name}</p>
          <p className="prompt-tag">
            {nearby.source === "return"
              ? "Leave this chamber"
              : game.mode === "competitive"
                ? `${game.tagline} · scored`
                : game.tagline}
          </p>
          <div className="prompt-actions">
            <button type="button" className="prompt-btn" onClick={playNearby}>
              {nearby.source === "return" ? "Return" : "Play"}
            </button>
            {nearby.source !== "return" ? (
              <button type="button" className="prompt-btn ghost" onClick={pinNearby}>
                {nearby.source === "favorite" ? "Unpin" : "Pin"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Desktop fallback D-pad — touch uses analog sticks instead */}
      {!touch && !inArcade ? (
        <div className="move-pad" aria-label="Movement pad">
          <button type="button" className="pad-btn" {...holdAxis("up", 1)}>
            Up
          </button>
          <button type="button" className="pad-btn" {...holdAxis("forward", 1)}>
            ▲
          </button>
          <button type="button" className="pad-btn" {...holdAxis("up", -1)}>
            Dn
          </button>
          <button type="button" className="pad-btn" {...holdAxis("right", -1)}>
            ◀
          </button>
          <button type="button" className="pad-btn" {...holdAxis("forward", -1)}>
            ▼
          </button>
          <button type="button" className="pad-btn" {...holdAxis("right", 1)}>
            ▶
          </button>
          <button
            type="button"
            className="pad-btn sprint"
            onPointerDown={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              setPadSprint(true);
            }}
            onPointerUp={() => setPadSprint(false)}
            onPointerCancel={() => setPadSprint(false)}
            onLostPointerCapture={() => setPadSprint(false)}
          >
            Boost
          </button>
        </div>
      ) : null}

      {inHub ? <GameTouchControls mode="hub" /> : null}

      {chatOpen ? (
        <form className="chat" onSubmit={sendChat}>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Say something nearby…"
            maxLength={140}
            enterKeyHint="send"
          />
        </form>
      ) : null}

      <footer className="hud-bottom">
        <span>{touch ? "Touch sticks · tap Play on cabinets" : "Mouse / trackpad look · pad / WASD fly"}</span>
        <span className={ptt ? "live" : ""}>
          <kbd>V</kbd> talk {micReady ? (ptt ? "• live" : "• ready") : ""}
        </span>
        {location.type === "game" ? (
          <button type="button" className="text" onClick={() => emitLeave()}>
            return
          </button>
        ) : null}
      </footer>

      <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
