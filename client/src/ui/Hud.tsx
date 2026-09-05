import { useEffect, useRef, useState, type FormEvent } from "react";
import { CHECKPOINT_COUNT, gameById } from "@holojay/shared";
import { clearToken } from "../auth/api.ts";
import { disconnectRealm, emitChat, emitFollow, emitLeave } from "../net/session.ts";
import { useGame } from "../state/store.ts";

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

      {!pointerLocked && !chatOpen ? (
        <div className="hint-center">Click to look around · hold RMB to orbit · scroll to zoom</div>
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
          <p className="prompt-keys">
            {nearby.source === "return" ? (
              <kbd>E</kbd>
            ) : (
              <>
                <kbd>E</kbd> enter
                {nearby.source === "favorite" ? (
                  <>
                    {" "}
                    <kbd>F</kbd> unpin
                  </>
                ) : (
                  <>
                    {" "}
                    <kbd>F</kbd> pin to plaza
                  </>
                )}
              </>
            )}
          </p>
        </div>
      ) : null}

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
        <span>
          <kbd>WASD</kbd> fly with the camera <kbd>Space</kbd> up <kbd>Shift</kbd> down <kbd>Q</kbd> sprint
        </span>
        <span>
          <kbd>E</kbd> enter <kbd>F</kbd> favorite <kbd>T</kbd> chat
        </span>
        <span className={ptt ? "live" : ""}>
          <kbd>V</kbd> talk {micReady ? (ptt ? "• live" : "• ready") : "• hold to enable mic"}
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
