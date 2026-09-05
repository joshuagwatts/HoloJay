const channel = (import.meta.env.VITE_CHANNEL ?? "dev").toLowerCase();

export function ChannelBadge() {
  if (channel !== "alpha" && channel !== "beta") return null;

  const otherHref = channel === "alpha" ? "../" : "./alpha/";
  const otherLabel = channel === "alpha" ? "beta" : "alpha";

  return (
    <span className={`channel-badge ${channel}`}>
      <em>{channel}</em>
      <a href={otherHref}>{otherLabel}</a>
    </span>
  );
}
