import { useEffect, useState } from "react";
import { AuthOverlay } from "./ui/AuthOverlay.tsx";
import { ErrorBoundary } from "./ui/ErrorBoundary.tsx";
import { Hud } from "./ui/Hud.tsx";
import { Realm } from "./world/Realm.tsx";
import { clearToken, me, rememberGuest, savedToken, saveToken } from "./auth/api.ts";
import { clearHubOverride } from "./net/config.ts";
import { loadRuntimeConfig, startLocal, emitEnterDirect } from "./net/session.ts";
import { useGame } from "./state/store.ts";
import { gameById } from "@holojay/shared";

export function App() {
  const user = useGame((s) => s.user);
  const hubReady = useGame((s) => s.hubReady);
  const location = useGame((s) => s.location);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let alive = true;
    const release = () => {
      if (alive) setBooting(false);
    };
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

  // Solo deep link: `?enter=sky-escort` (optional `&skyRadar=1` / `&skyIntro=1` for QA).
  // Persist into sessionStorage so guest auth / hub boot can't eat the query before Sky Escort mounts.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const enter = params.get("enter");
      if (enter && gameById(enter)) sessionStorage.setItem("holojay.enter", enter);
      if (params.get("skyRadar") === "1") sessionStorage.setItem("holojay.skyRadar", "1");
      if (params.get("skyIntro") === "1") sessionStorage.setItem("holojay.skyIntro", "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!user || !hubReady) return;
    try {
      const enter = sessionStorage.getItem("holojay.enter");
      if (!enter || !gameById(enter)) return;
      const loc = useGame.getState().location;
      if (loc.type === "game" && loc.gameId === enter) {
        sessionStorage.removeItem("holojay.enter");
        const params = new URLSearchParams(window.location.search);
        params.delete("enter");
        const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
        window.history.replaceState({}, "", next);
        return;
      }
      // Keep holojay.enter until we're actually in-room — socket `welcome` can
      // reset location to hub after the first attempt.
      emitEnterDirect(enter);
    } catch {
      /* ignore */
    }
  }, [user, hubReady, location]);

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
      <ErrorBoundary>
        <Realm />
      </ErrorBoundary>
      <Hud />
    </div>
  );
}
