import { io } from "socket.io-client";

const API = "http://127.0.0.1:3001";
const stamp = Date.now().toString().slice(-6);

function portalSlotPose(slot) {
  const t = ((slot + 0.5) / 8) * Math.PI * 2;
  const scale = 38;
  const x = scale * Math.sin(t);
  const z = scale * Math.sin(t) * Math.cos(t);
  const dx = scale * Math.cos(t);
  const dz = scale * Math.cos(2 * t);
  const len = Math.hypot(dx, dz) || 1;
  const nx = -(dz / len);
  const nz = dx / len;
  return { x: x + nx * 3.4, y: 1.55, z: z + nz * 3.4 };
}

async function json(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status}: ${data.message ?? JSON.stringify(data)}`);
  return data;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const sock = io(API, { auth: { token }, transports: ["websocket"] });
    const timer = setTimeout(() => reject(new Error("welcome timeout")), 5000);
    sock.once("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    sock.once("welcome", (welcome) => {
      clearTimeout(timer);
      resolve({ sock, welcome });
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function once(sock, event, ms, label) {
  return Promise.race([
    new Promise((resolve) => sock.once(event, resolve)),
    wait(ms).then(() => {
      throw new Error(`${label} timeout`);
    }),
  ]);
}

function ok(name, detail = "") {
  console.log(`OK  ${name}${detail ? " — " + detail : ""}`);
}

try {
  const health = await json("/api/health");
  if (!health.ok) throw new Error("health failed");
  ok("health");

  const one = await json("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username: `orb_${stamp}a`, password: "password1", color: "#5ce1ff" }),
  });
  const two = await json("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username: `orb_${stamp}b`, password: "password1", color: "#ff6bd6" }),
  });
  ok("register", `${one.user.username}, ${two.user.username}`);

  const login = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: one.user.username, password: "password1" }),
  });
  if (!login.token) throw new Error("login missing token");
  ok("login");

  const guest = await json("/api/auth/guest", {
    method: "POST",
    body: JSON.stringify({ username: `g_${stamp}`, color: "#ffd54f" }),
  });
  if (!guest.user.guest) throw new Error("guest not marked");
  ok("guest", guest.user.username);

  const me = await json("/api/auth/me", { headers: { Authorization: `Bearer ${one.token}` } });
  if (me.user.username !== one.user.username) throw new Error("me mismatch");
  ok("me");

  const a = await connect(one.token);
  const joined = once(a.sock, "playerJoined", 4000, "playerJoined");
  const b = await connect(two.token);
  const other = await joined;
  if (other.username !== two.user.username) throw new Error("did not see other orb");
  ok("presence", `${a.welcome.self.username} saw ${other.username}`);
  if (a.welcome.assignments.length !== 8) throw new Error("expected 8 portals");
  ok("assignments", a.welcome.assignments.map((x) => x.gameId).join(", "));

  const firstGame = a.welcome.assignments[0].gameId;
  const favs = once(a.sock, "favoritesUpdated", 3000, "pin");
  a.sock.emit("pin", { gameId: firstGame });
  const pinned = await favs;
  if (!pinned.favorites.some((f) => f.gameId === firstGame)) throw new Error("pin missing");
  ok("pin", firstGame);

  const reshuffled = once(a.sock, "assignments", 3000, "reshuffle");
  a.sock.emit("loopComplete");
  const next = await reshuffled;
  const before = a.welcome.assignments.map((x) => x.gameId).join("|");
  const after = next.assignments.map((x) => x.gameId).join("|");
  if (before === after) throw new Error("shuffle did not change doors");
  if (next.assignments.some((x) => x.gameId === firstGame)) throw new Error("favorite leaked onto path");
  ok("reshuffle", after);

  a.sock.emit("move", { position: { x: 0, y: 1.2, z: 0 }, rotY: 0 });
  b.sock.emit("move", { position: { x: 1, y: 1.2, z: 1 }, rotY: 0 });
  await wait(80);
  const chat = once(b.sock, "playerChat", 3000, "chat");
  a.sock.emit("chat", { text: "hello nearby" });
  const msg = await chat;
  if (msg.text !== "hello nearby") throw new Error("chat mismatch");
  ok("proximity text");

  const liveSlot = next.assignments[0];
  const pose = portalSlotPose(liveSlot.slot);
  a.sock.emit("move", { position: pose, rotY: 0 });
  b.sock.emit("move", { position: pose, rotY: 0 });
  await wait(80);

  const entered = once(a.sock, "entered", 3000, "enter");
  const invite = once(b.sock, "followInvite", 3000, "follow invite");
  a.sock.emit("enterPortal", { source: "path", slot: liveSlot.slot, gameId: liveSlot.gameId });
  const room = await entered;
  if (room.location.type !== "game") throw new Error("not in game");
  ok("enter portal", liveSlot.gameId);

  const followInvite = await invite;
  const bEntered = once(b.sock, "entered", 3000, "follow");
  b.sock.emit("follow", { instanceId: followInvite.instanceId });
  const bRoom = await bEntered;
  if (bRoom.location.instanceId !== room.location.instanceId) throw new Error("follow instance mismatch");
  ok("follow");

  a.sock.disconnect();
  b.sock.disconnect();

  const again = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: one.user.username, password: "password1" }),
  });
  const a2 = await connect(again.token);
  if (!a2.welcome.favorites.some((f) => f.gameId === firstGame)) throw new Error("favorites did not persist");
  ok("favorites persist after reconnect");
  a2.sock.disconnect();

  console.log("\nAll hub checks passed.");
} catch (err) {
  console.error("FAIL", err);
  process.exit(1);
}
