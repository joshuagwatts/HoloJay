import { useEffect, useRef, useState } from "react";
import { AuthOverlay } from "./ui/AuthOverlay.tsx";
import { Hud } from "./ui/Hud.tsx";
import { Realm } from "./world/Realm.tsx";
import { clearToken, me, rememberGuest, savedToken, saveToken } from "./auth/api.ts";
import { connectSession, loadRuntimeConfig, startLocal } from "./net/session.ts";
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
      // Absolute last resort — never leave the splash up
      const safety = window.setTimeout(() => {
        if (!cancelled) setBooting(false);
      }, 2000);

      try {
        await loadRuntimeConfig().catch(() => undefined);

        const existing = savedToken();
        if (!existing) return;

        // Local solo tokens: resolve instantly, no network
        if (existing.startsWith("local.")) {
          const { user: next } = await me(existing);
          if (cancelled) return;
          saveToken(existing);
          rememberGuest(next);
          useGame.getState().setAuth(existing, next);
          startLocal(next);
          sessionStarted.current = true;
          return;
        }

        // JWT path (multiplayer hub)
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
        }
      } catch {
        /* show auth */
      } finally {
        window.clearTimeout(safety);
        if (!cancelled) setBooting(false);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!token || !user) {
      sessionStarted.current = false;
      return;
    }
    if (sessionStarted.current || useGame.getState().hubReady) return;
    sessionStarted.current = true;
    connectSession(token, user);
  }, [token, user]);

  useEffect(() => {
    if (booting || !user || hubReady) return;
    const t = window.setTimeout(() => {
      const u = useGame.getState().user;
      if (u && !useGame.getState().hubReady) startLocal(u);
    }, 600);
    return () => window.clearTimeout(t);
  }, [booting, user, hubReady]);

  if (booting) {
    return (
      <div className="boot">
        <p>Warming the plaza…</p>
      </div>
    );
  }

  if (!user) return <AuthOverlay />;

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
