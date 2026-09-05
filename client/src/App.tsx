import { useEffect, useState } from "react";
import { AuthOverlay } from "./ui/AuthOverlay.tsx";
import { Hud } from "./ui/Hud.tsx";
import { Realm } from "./world/Realm.tsx";
import { clearToken, me, rememberGuest, savedToken, saveToken } from "./auth/api.ts";
import { connectSession, disconnectRealm, loadRuntimeConfig } from "./net/session.ts";
import { useGame } from "./state/store.ts";

export function App() {
  const user = useGame((s) => s.user);
  const token = useGame((s) => s.token);
  const hubReady = useGame((s) => s.hubReady);
  const [booting, setBooting] = useState(true);

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

  useEffect(() => {
    if (!token || !user) return;
    if (!useGame.getState().hubReady) connectSession(token, user);
    return () => {
      disconnectRealm();
    };
  }, [token, user]);

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
        <p>Loading the hub…</p>
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
