import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { authRouter } from "./auth.ts";
import { attachRealm } from "./realm.ts";
import "./db.ts";

const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"], credentials: true }));
app.use(express.json());
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: ["http://localhost:5173", "http://127.0.0.1:5173"], credentials: true },
});

attachRealm(io);

httpServer.listen(PORT, () => {
  console.log(`Portal Realm hub on http://127.0.0.1:${PORT}`);
});
