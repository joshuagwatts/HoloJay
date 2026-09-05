import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dataDir = path.join(import.meta.dirname, "../data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "realm.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS favorites (
    user_id TEXT NOT NULL,
    game_id TEXT NOT NULL,
    slot INTEGER NOT NULL,
    PRIMARY KEY (user_id, slot),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

export type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  color: string;
  created_at: number;
};

export function findUserByUsername(username: string): UserRow | undefined {
  return db
    .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
    .get(username) as UserRow | undefined;
}

export function findUserById(id: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function insertUser(user: UserRow): void {
  db.prepare(
    "INSERT INTO users (id, username, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(user.id, user.username, user.password_hash, user.color, user.created_at);
}

export function listFavorites(userId: string): { game_id: string; slot: number }[] {
  return db
    .prepare("SELECT game_id, slot FROM favorites WHERE user_id = ? ORDER BY slot ASC")
    .all(userId) as { game_id: string; slot: number }[];
}

export function replaceFavorites(userId: string, favorites: { gameId: string; slot: number }[]): void {
  const del = db.prepare("DELETE FROM favorites WHERE user_id = ?");
  const ins = db.prepare("INSERT INTO favorites (user_id, game_id, slot) VALUES (?, ?, ?)");
  db.exec("BEGIN IMMEDIATE");
  try {
    del.run(userId);
    for (const fav of favorites) {
      ins.run(userId, fav.gameId, fav.slot);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
