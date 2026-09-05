import { useEffect, useState } from "react";
import { AuthOverlay } from "./ui/AuthOverlay.tsx";
import { Hud } from "./ui/Hud.tsx";
import { Realm } from "./world/Realm.tsx";
import { clearToken, me, rememberGuest, savedToken, saveToken } from "./auth/api.ts";
import { clearHubOverride } from "./net/config.ts";
import { connectSession, loadRuntimeConfig, startLocal } from "./net/session.ts";
import { useGame } from "./state/store.ts";

/**
 * Boot is intentionally dumb and fast:
 * - local.* tokens → solo plaza immediately (no network)
 * - anything else / failure → auth screen
 * - never block the UI on hubReady / sockets
 */
export function App() {
  const user = useGame((s) => s.user);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let alive = true;

    const release = () => {
      if (alive) setBooting(false);
    };
    // Hard cap — splash cannot outlive this
    const hardCap = window.setTimeout(release, 800);

    (async () => {
      try {
        await loadRuntimeConfig().catch(() => undefined);
        if (!alive) return;

        const token = savedToken();
        if (!token) return;

        if (token.startsWith("local.")) {
          clearHubOverride();
          const { user: next } = await me(token);
          if (!alive) return;
          saveToken(token);
          rememberGuest(next);
          useGame.getState().setAuth(token, next);
          startLocal(next);
          return;
        }

        // Stale JWT from a dead remote hub — don't wait on it
        clearToken();
        clearHubOverride();
      } catch {
        clearToken();
        clearHubOverride();
      } finally {
        window.clearTimeout(hardCap);
        release();
      }
    })();

    return () => {
      alive = false;
      window.clearTimeout(hardCap);
    };
  }, []);

  if (booting) {
    return (
      <div className="boot">
        <p>Warming the plaza…</p>
      </div>
    );
  }

  if (!user) return <AuthOverlay />;

  return (
    <div className="shell">
      <Realm />
      <Hud />
    </div>
  );
}
