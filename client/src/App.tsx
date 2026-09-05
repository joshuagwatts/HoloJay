import { useEffect, useRef, useState } from "react";
import { AuthOverlay } from "./ui/AuthOverlay.tsx";
import { Hud } from "./ui/Hud.tsx";
import { Realm } from "./world/Realm.tsx";
import { clearToken, me, rememberGuest, savedToken, saveToken } from "./auth/api.ts";
import { clearHubOverride, hasMultiplayerHub } from "./net/config.ts";
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
      const safety = window.setTimeout(() => {
        if (!cancelled) setBooting(false);
      }, 2500);

      try {
        await Promise.race([
          loadRuntimeConfig(),
          new Promise<void>((resolve) => window.setTimeout(resolve, 1200)),
        ]);

        const existing = savedToken();
        if (!existing) return;

        try {
          const { user: next } = await Promise.race([
            me(existing),
            new Promise<never>((_, reject) => {
              window.setTimeout(() => reject(new Error("me timeout")), 2000);
            }),
          ]);
          if (cancelled) return;
          saveToken(existing);
          rememberGuest(next);
          useGame.getState().setAuth(existing, next);
          connectSession(existing, next);
          sessionStarted.current = true;
        } catch {
          if (hasMultiplayerHub()) clearHubOverride();
          clearToken();
        }
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

  // Never leave the user on "Opening…" — force solo plaza if hub didn't come up
  useEffect(() => {
    if (booting || !user || hubReady) return;
    const t = window.setTimeout(() => {
      if (!useGame.getState().hubReady && useGame.getState().user) {
        startLocal(useGame.getState().user!);
      }
    }, 800);
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
