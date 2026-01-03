import express from "express";
import sqlite3 from "sqlite3";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// SQLite DB (inside container at /app/data/)
const db = new sqlite3.Database("/app/data/poker.db");

db.run(`
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    players TEXT NOT NULL,
    seating_hash TEXT UNIQUE NOT NULL
  )
`);

// Utilities
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function hashSeating(seating) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(seating))
    .digest("hex");
}

// API Routes BEFORE static files
app.post("/api/generate", async (req, res) => {
  const players = req.body.players;

  if (!Array.isArray(players) || players.length < 2) {
    return res.status(400).json({ error: "Invalid players list" });
  }

  let attempts = 0;
  while (attempts < 50) {
    attempts++;

    const seating = shuffle([...players]);
    const hash = hashSeating(seating);

    const exists = await new Promise(resolve => {
      db.get(
        "SELECT 1 FROM games WHERE seating_hash = ?",
        [hash],
        (_, row) => resolve(!!row)
      );
    });

    if (!exists) {
      db.run(
        "INSERT INTO games (players, seating_hash) VALUES (?, ?)",
        [JSON.stringify(seating), hash]
      );
      return res.json({ seating });
    }
  }

  res.status(409).json({ error: "Could not generate unique seating after 50 attempts" });
});

app.get("/api/history", (_, res) => {
  db.all(
    "SELECT id, created_at, players FROM games ORDER BY id DESC LIMIT 10",
    [],
    (_, rows) => {
      res.json(
        rows.map(r => ({
          ...r,
          players: JSON.parse(r.players)
        }))
      );
    }
  );
});

// Serve static files AFTER API routes
app.use(express.static(path.join(__dirname, "public")));

// Catch-all route for SPA - serves index.html for any non-API route
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Poker seating app listening on port ${PORT}`);
});