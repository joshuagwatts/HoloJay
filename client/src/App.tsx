import { useEffect, useRef, useState } from "react";
import { AuthOverlay } from "./ui/AuthOverlay.tsx";
import { Hud } from "./ui/Hud.tsx";
import { Realm } from "./world/Realm.tsx";
import { clearToken, me, rememberGuest, savedToken, saveToken } from "./auth/api.ts";
import { connectSession, loadRuntimeConfig } from "./net/session.ts";
import { useGame } from "./state/store.ts";

export function App() {
  const user = useGame((s) => s.user);
  const token = useGame((s) => s.token);
  const hubReady = useGame((s) => s.hubReady);
  const [booting, setBooting] = useState(true);
  const sessionStarted = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      await loadRuntimeConfig();
      const existing = savedToken();
      if (!existing) {
        if (!cancelled) setBooting(false);
        return;
      }

      try {
        const { user: next } = await me(existing);
        if (cancelled) return;
        saveToken(existing);
        rememberGuest(next);
        useGame.getState().setAuth(existing, next);
        connectSession(existing, next);
        sessionStarted.current = true;
      } catch {
        clearToken();
      } finally {
        if (!cancelled) setBooting(false);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fresh login from AuthOverlay — start plaza once (don't tear down on Strict Mode cleanup)
  useEffect(() => {
    if (!token || !user) {
      sessionStarted.current = false;
      return;
    }
    if (sessionStarted.current || useGame.getState().hubReady) return;
    sessionStarted.current = true;
    connectSession(token, user);
  }, [token, user]);

  if (booting) {
    return (
      <div className="boot">
        <p>Warming the plaza…</p>
      </div>
    );
  }

  if (!user) return <AuthOverlay />;

  // Solo startLocal is sync — hubReady should already be true. If multiplayer is linking, still show the world.
  if (!hubReady) {
    return (
      <div className="boot">
        <p>Opening the plaza…</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <Realm />
      <Hud />
    </div>
  );
}
