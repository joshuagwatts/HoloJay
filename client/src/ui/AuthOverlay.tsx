import { useState } from "react";
import { ORB_COLORS } from "@holojay/shared";
import { guest, login, register, rememberGuest, saveToken } from "../auth/api.ts";
import { connectSession, loadRuntimeConfig } from "../net/session.ts";
import { useGame } from "../state/store.ts";

type Mode = "enter" | "login" | "register";

export function AuthOverlay() {
  const [mode, setMode] = useState<Mode>("enter");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [color, setColor] = useState<string>(ORB_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function finish(token: string, user: { id: string; username: string; color: string; guest: boolean }) {
    await loadRuntimeConfig();
    saveToken(token);
    rememberGuest(user);
    useGame.getState().setAuth(token, user);
    connectSession(token, user);
  }

  async function onGuest() {
    setBusy(true);
    setError(null);
    try {
      const res = await guest(username, color);
      await finish(res.token, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enter");
    } finally {
      setBusy(false);
    }
  }

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await login(username, password);
      await finish(res.token, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await register(username, password, color);
      await finish(res.token, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-mark" aria-hidden="true">
        <svg viewBox="0 0 200 100">
          <path
            d="M100 50 C100 20 55 20 55 50 C55 80 100 80 100 50 C100 20 145 20 145 50 C145 80 100 80 100 50"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
          />
        </svg>
      </div>
      <div className="auth-card">
        <p className="kicker">HoloJay</p>
        <h1>Portal Realm</h1>
        <p className="lede">
          Become a glowing orb. Drift the figure-eight. Pin the doors you love at the crossing — everything else
          reshuffles when you complete a loop.
        </p>

        {mode === "enter" && (
          <div className="stack">
            <label>
              Display name
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="optional for guests" maxLength={16} />
            </label>
            <ColorRow color={color} onChange={setColor} />
            <button className="primary" disabled={busy} onClick={() => void onGuest()}>
              {busy ? "Opening…" : "Drop in as guest"}
            </button>
            <div className="row-links">
              <button type="button" className="text" onClick={() => setMode("login")}>
                Log in
              </button>
              <button type="button" className="text" onClick={() => setMode("register")}>
                Create account
              </button>
            </div>
          </div>
        )}

        {mode === "login" && (
          <form className="stack" onSubmit={onLogin}>
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "Entering…" : "Enter the realm"}
            </button>
            <button type="button" className="text" onClick={() => setMode("enter")}>
              Back
            </button>
          </form>
        )}

        {mode === "register" && (
          <form className="stack" onSubmit={onRegister}>
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={16} />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} />
            </label>
            <ColorRow color={color} onChange={setColor} />
            <button className="primary" disabled={busy}>
              {busy ? "Forging…" : "Create account & enter"}
            </button>
            <button type="button" className="text" onClick={() => setMode("enter")}>
              Back
            </button>
          </form>
        )}

        {error ? <p className="error">{error}</p> : null}
        <p className="fine">
          Accounts keep your orb color and favorite doors in this browser (and on a hub server when one is running).
        </p>
      </div>
    </div>
  );
}

function ColorRow({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  return (
    <div className="colors">
      <span>Orb color</span>
      <div>
        {ORB_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={c === color ? "swatch on" : "swatch"}
            style={{ background: c }}
            onClick={() => onChange(c)}
            aria-label={c}
          />
        ))}
      </div>
    </div>
  );
}
