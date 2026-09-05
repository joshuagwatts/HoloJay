/**
 * Share your local multiplayer hub with a friend over the internet.
 * Keeps the Node hub on :3001 and prints a public URL via localtunnel.
 */
import { spawn } from "node:child_process";
import localtunnel from "localtunnel";

const PORT = Number(process.env.PORT ?? 3001);
const PAGES = "https://joshuagwatts.github.io/HoloJay/";

console.log(`Starting Portal Realm hub on :${PORT}…`);

const hub = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsx", "server/src/index.ts"],
  { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PORT: String(PORT) } },
);

hub.stdout?.on("data", (d) => process.stdout.write(d));
hub.stderr?.on("data", (d) => process.stderr.write(d));

await new Promise((r) => setTimeout(r, 1200));

const tunnel = await localtunnel({ port: PORT });
const hubUrl = tunnel.url.replace(/\/$/, "");
const friendLink = `${PAGES}?hub=${encodeURIComponent(hubUrl)}`;

console.log("");
console.log("══════════════════════════════════════════════");
console.log("  MULTIPLAYER SHARE");
console.log(`  Hub:    ${hubUrl}`);
console.log(`  Friend: ${friendLink}`);
console.log("  You:    open the same Friend link (or Pages with that ?hub=)");
console.log("  Keep this window open while you play.");
console.log("══════════════════════════════════════════════");
console.log("");

const shutdown = () => {
  tunnel.close();
  hub.kill();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

hub.on("exit", (code) => {
  console.log(`Hub exited (${code})`);
  tunnel.close();
  process.exit(code ?? 1);
});
