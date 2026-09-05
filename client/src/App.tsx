import { useEffect, useState } from "react";
import { AuthOverlay } from "./ui/AuthOverlay.tsx";
import { Hud } from "./ui/Hud.tsx";
import { Realm } from "./world/Realm.tsx";
import { clearToken, me, rememberGuest, savedToken, saveToken } from "./auth/api.ts";
import { connectSession, disconnectRealm } from "./net/session.ts";
import { useGame } from "./state/store.ts";

export function App() {
  const user = useGame((s) => s.user);
  const token = useGame((s) => s.token);
  const hubReady = useGame((s) => s.hubReady);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const existing = savedToken();
    if (!existing) {
      setBooting(false);
      return;
    }
    me(existing)
      .then(({ user: next }) => {
        saveToken(existing);
        rememberGuest(next);
        useGame.getState().setAuth(existing, next);
        // Hydrate the hub BEFORE the canvas mounts (local is sync; remote waits on welcome)
        connectSession(existing, next);
      })
      .catch(() => clearToken())
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (!token || !user) return;
    if (!useGame.getState().hubReady) connectSession(token, user);
    return () => {
      disconnectRealm();
      useGame.getState().setHubReady(false);
    };
  }, [token, user]);

  if (booting || (user && !hubReady)) {
    return (
      <div className="boot">
        <p>Loading the hub…</p>
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
