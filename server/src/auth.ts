import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { ORB_COLORS, type AuthUser } from "@holojay/shared";
import { findUserById, findUserByUsername, insertUser, listFavorites } from "./db.ts";

const JWT_SECRET = process.env.JWT_SECRET ?? "holojay-dev-secret";
const USERNAME_RE = /^[a-zA-Z0-9_]{3,16}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

type TokenPayload = {
  sub: string;
  username: string;
  color: string;
  guest: boolean;
};

export function signUser(user: AuthUser): string {
  return jwt.sign(
    { sub: user.id, username: user.username, color: user.color, guest: user.guest } satisfies TokenPayload,
    JWT_SECRET,
    { expiresIn: "7d" },
  );
}

export function verifyToken(token: string): AuthUser {
  const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
  if (!payload.sub || !payload.username) {
    throw new Error("Invalid token");
  }
  return {
    id: payload.sub,
    username: payload.username,
    color: payload.color,
    guest: Boolean(payload.guest),
  };
}

function pickColor(input: unknown): string {
  if (typeof input === "string" && COLOR_RE.test(input)) return input;
  return ORB_COLORS[Math.floor(Math.random() * ORB_COLORS.length)];
}

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const color = pickColor(req.body?.color);

  if (!USERNAME_RE.test(username)) {
    res.status(400).json({ message: "Username must be 3-16 letters, numbers, or _" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ message: "Password must be at least 8 characters" });
    return;
  }
  if (findUserByUsername(username)) {
    res.status(409).json({ message: "That name is already taken" });
    return;
  }

  const user = {
    id: randomUUID(),
    username,
    password_hash: await bcrypt.hash(password, 10),
    color,
    created_at: Date.now(),
  };
  insertUser(user);
  const publicUser: AuthUser = { id: user.id, username, color, guest: false };
  res.json({ token: signUser(publicUser), user: publicUser });
});

authRouter.post("/login", async (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const row = findUserByUsername(username);
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    res.status(401).json({ message: "Wrong username or password" });
    return;
  }
  const publicUser: AuthUser = {
    id: row.id,
    username: row.username,
    color: row.color,
    guest: false,
  };
  res.json({ token: signUser(publicUser), user: publicUser });
});

authRouter.post("/guest", (req, res) => {
  const requested = String(req.body?.username ?? "").trim();
  const color = pickColor(req.body?.color);
  let username = USERNAME_RE.test(requested) ? requested : `guest_${Math.floor(1000 + Math.random() * 9000)}`;
  if (findUserByUsername(username)) {
    username = `${username}_${Math.floor(Math.random() * 99)}`;
  }
  const publicUser: AuthUser = {
    id: `guest_${randomUUID()}`,
    username,
    color,
    guest: true,
  };
  res.json({ token: signUser(publicUser), user: publicUser });
});

authRouter.get("/me", (req, res) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const user = verifyToken(token);
    if (!user.guest) {
      const row = findUserById(user.id);
      if (!row) {
        res.status(401).json({ message: "Account no longer exists" });
        return;
      }
      user.username = row.username;
      user.color = row.color;
    }
    res.json({
      user,
      favorites: user.guest ? [] : listFavorites(user.id).map((f) => ({ slot: f.slot, gameId: f.game_id })),
    });
  } catch {
    res.status(401).json({ message: "Invalid session" });
  }
});
