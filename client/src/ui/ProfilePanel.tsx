import { ORB_COLORS, hatById } from "@holojay/shared";
import { useEffect, useState } from "react";
import { updateProfile } from "../auth/api.ts";
import { shareInvite } from "../invite.ts";
import { useGame } from "../state/store.ts";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function ProfilePanel({ open, onClose }: Props) {
  const user = useGame((s) => s.user);
  const favorites = useGame((s) => s.favorites);
  const loopCount = useGame((s) => s.loopCount);
  const wornHatId = useGame((s) => s.wornHatId);
  const offline = useGame((s) => s.offline);
  const [name, setName] = useState(user?.username ?? "");
  const [color, setColor] = useState(user?.color ?? ORB_COLORS[0]!);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user) return;
    setName(user.username);
    setColor(user.color);
    setMsg(null);
  }, [open, user]);

  if (!open || !user) return null;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const next = await updateProfile({ username: name.trim(), color });
      useGame.getState().setAuth(useGame.getState().token!, next);
      setMsg("Profile saved");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function invite(enter?: string) {
    if (!user) return;
    setBusy(true);
    try {
      const how = await shareInvite({ enter, title: `${user.username} invited you to HoloJay` });
      setMsg(how === "shared" ? "Invite sent" : "Invite link copied");
      useGame.getState().setNotice(how === "shared" ? "Invite shared" : "Invite link copied — send it to a friend");
    } catch {
      setMsg("Could not share");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-scrim" role="dialog" aria-modal="true" aria-label="Your profile">
      <div className="profile-card">
        <header className="profile-head">
          <div className="profile-orb" style={{ background: color }} aria-hidden />
          <div>
            <p className="profile-kicker">{user.guest ? "Guest orb" : "Member orb"}</p>
            <h2>{user.username}</h2>
            <p className="profile-sub">{offline ? "Solo plaza" : "Live hub"} · {favorites.length} pinned · loop {loopCount}</p>
          </div>
          <button type="button" className="profile-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <label className="profile-field">
          Display name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} autoComplete="nickname" />
        </label>

        <div className="profile-field">
          <span>Orb color</span>
          <div className="profile-swatches">
            {ORB_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={c === color ? "on" : ""}
                style={{ background: c }}
                aria-label={c}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <p className="profile-hat">
          {wornHatId
            ? `Wearing ${hatById(wornHatId)?.name ?? "a hat"}`
            : "No hat — try the dresser in the plaza"}
        </p>

        <div className="profile-actions">
          <button type="button" className="profile-primary" disabled={busy} onClick={() => void save()}>
            Save profile
          </button>
          <button type="button" className="profile-secondary" disabled={busy} onClick={() => void invite()}>
            Invite friends
          </button>
          <button type="button" className="profile-secondary" disabled={busy} onClick={() => void invite("boss-wave")}>
            Invite to Boss Wave
          </button>
        </div>

        {msg ? <p className="profile-msg">{msg}</p> : null}
        <p className="profile-hint">Friends open your link on phone or desktop — same plaza, Android · iPhone · PC.</p>
      </div>
    </div>
  );
}
