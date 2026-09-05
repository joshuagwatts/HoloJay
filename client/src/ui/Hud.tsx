import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { CHECKPOINT_COUNT, gameById } from "@holojay/shared";
import { clearToken } from "../auth/api.ts";
import { setPadAxis, setPadSprint } from "../inputPad.ts";
import { disconnectRealm, emitChat, emitEnter, emitFollow, emitLeave, emitPin, emitUnpin } from "../net/session.ts";
import { useGame } from "../state/store.ts";

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
  const [hintGone, setHintGone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const progress = loopVisited.filter(Boolean).length;
  const game = nearby ? gameById(nearby.gameId) : null;
  const others = Object.keys(players).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyT" && !useGame.getState().chatOpen && !e.repeat) {
        e.preventDefault();
        document.exitPointerLock();
        useGame.getState().setChatOpen(true);
      }
      if (e.code === "Escape") {
        useGame.getState().setChatOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (chatOpen) inputRef.current?.focus();
  }, [chatOpen]);

  useEffect(() => {
    if (pointerLocked) setHintGone(true);
  }, [pointerLocked]);

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

  return (
    <div className="hud">
      <header className="hud-top">
        <div>
          <p className="kicker">Portal Realm</p>
          <strong>{user?.username}</strong>
          <span className={`dot ${connected || offline ? "on" : ""}`}>
            {offline ? "solo" : connected ? "linked" : "linking"}
          </span>
        </div>
        <div className="hud-meta">
          <span>{others} nearby orb{others === 1 ? "" : "s"}</span>
          <span>{favorites.length}/6 pinned</span>
          <span>loop {loopCount}</span>
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

      {!hintGone && !chatOpen ? (
        <div className="hint-center">
          Drag to look · scroll to zoom · use the pad to fly · tap a cabinet to play
        </div>
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

      {nearby && game ? (
        <div className="prompt">
          <p className="prompt-name">{game.name}</p>
          <p className="prompt-tag">{nearby.source === "return" ? "Leave this chamber" : game.tagline}</p>
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

      {chatOpen ? (
        <form className="chat" onSubmit={sendChat}>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Say something nearby…"
            maxLength={140}
          />
        </form>
      ) : null}

      <footer className="hud-bottom">
        <span>Drag look · scroll zoom · pad / WASD fly</span>
        <span>
          Click cabinet or <kbd>E</kbd> play · <kbd>C</kbd> sticky look
        </span>
        <span className={ptt ? "live" : ""}>
          <kbd>V</kbd> talk {micReady ? (ptt ? "• live" : "• ready") : ""}
        </span>
        {location.type === "game" ? (
          <button type="button" className="text" onClick={() => emitLeave()}>
            return
          </button>
        ) : null}
      </footer>
    </div>
  );
}
