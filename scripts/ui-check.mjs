import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9333;
const child = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-webgl",
    `--remote-debugging-port=${PORT}`,
    "--user-data-dir=D:\\tmp\\edge-profile",
    "--no-first-run",
    "--no-default-browser-check",
    "http://localhost:5173/",
  ],
  { stdio: "ignore" },
);

function json(url) {
  return fetch(url).then((res) => res.json());
}

async function waitForTarget() {
  for (let i = 0; i < 25; i += 1) {
    try {
      const list = await json(`http://127.0.0.1:${PORT}/json`);
      const page = list.find((t) => t.type === "page" && /5173/.test(t.url)) ?? list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // starting
    }
    await sleep(300);
  }
  throw new Error("no CDP target");
}

async function cdp(ws, method, params = {}, sessionId) {
  const id = cdp.nextId++;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`cdp timeout ${method}`)), 8000);
    const onMessage = (event) => {
      const raw = typeof event.data === "string" ? event.data : event.data.toString();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }
      if (data.id === id) {
        clearTimeout(timer);
        ws.removeEventListener("message", onMessage);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      }
    };
    ws.addEventListener("message", onMessage);
  });
}
cdp.nextId = 1;

try {
  const target = await waitForTarget();
  console.log("TARGET", target.title, target.url);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });

  await cdp(ws, "Page.enable");
  await cdp(ws, "Runtime.enable");
  await cdp(ws, "Page.navigate", { url: "http://localhost:5173/" });
  await sleep(4000);

  const before = await cdp(ws, "Runtime.evaluate", {
    expression: "({ url: location.href, text: document.body.innerText, html: document.body.innerHTML.slice(0, 400) })",
    returnByValue: true,
  });
  console.log("AUTH:\n", before.result.value);

  await cdp(ws, "Runtime.evaluate", {
    expression: `document.querySelector("button.primary")?.click()`,
    userGesture: true,
  });
  await sleep(4000);

  const after = await cdp(ws, "Runtime.evaluate", {
    expression: `({
      text: document.body.innerText,
      canvas: !!document.querySelector("canvas"),
      hud: !!document.querySelector(".hud"),
      errors: window.__errors || null
    })`,
    returnByValue: true,
  });
  console.log("\nHUB STATE:\n", JSON.stringify(after.result.value, null, 2));

  const hasCanvas = after.result.value.canvas;
  const text = after.result.value.text || "";
  if (!hasCanvas) throw new Error("canvas missing after guest enter");
  if (!/linked|linking|Portal Realm/i.test(text)) throw new Error("hud missing");
  console.log("\nUI check passed.");
  ws.close();
} catch (err) {
  console.error("FAIL", err);
  process.exitCode = 1;
} finally {
  child.kill();
}
