import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { authRouter } from "./auth.ts";
import { attachRealm } from "./realm.ts";
import "./db.ts";

const PORT = Number(process.env.PORT ?? 3001);

const defaultOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "https://joshuagwatts.github.io",
];

const origins = (process.env.CLIENT_ORIGINS ?? defaultOrigins.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || origins.includes(origin) || origins.includes("*")) cb(null, true);
      else cb(null, origins[0] ?? true);
    },
    credentials: true,
  }),
);
app.use(express.json());
app.get("/api/health", (_req, res) => res.json({ ok: true, multiplayer: true }));
app.use("/api/auth", authRouter);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: origins.includes("*") ? true : origins,
    credentials: true,
  },
});

attachRealm(io);

httpServer.listen(PORT, () => {
  console.log(`Portal Realm hub on http://127.0.0.1:${PORT}`);
  console.log(`CORS origins: ${origins.join(", ")}`);
});
