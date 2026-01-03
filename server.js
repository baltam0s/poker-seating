import express from "express";
import sqlite3 from "sqlite3";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Admin password - CHANGE THIS TO YOUR OWN PASSWORD
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "poker2025";

// Simple token storage (in production, use Redis or database)
const adminTokens = new Set();

// SQLite DB (inside container at /app/data/)
const db = new sqlite3.Database("/app/data/poker.db");

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      players TEXT NOT NULL,
      seating_hash TEXT UNIQUE NOT NULL,
      winner TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS player_stats (
      player TEXT PRIMARY KEY,
      games_played INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0
    )
  `);
});

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

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function verifyAdminToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.substring(7);

  if (!adminTokens.has(token)) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  next();
}

function updatePlayerStats(players, winner = null) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      players.forEach(player => {
        db.run(
          `INSERT INTO player_stats (player, games_played, wins)
           VALUES (?, 1, ?)
           ON CONFLICT(player) DO UPDATE SET
           games_played = games_played + 1,
           wins = wins + ?`,
          [player, player === winner ? 1 : 0, player === winner ? 1 : 0]
        );
      });
      resolve();
    });
  });
}

function recalculateStats() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Reset all stats
      db.run('DELETE FROM player_stats', (err) => {
        if (err) {
          reject(err);
          return;
        }

        // Recalculate from games
        db.all('SELECT players, winner FROM games', [], (err, games) => {
          if (err) {
            reject(err);
            return;
          }

          const stats = {};

          games.forEach(game => {
            const players = JSON.parse(game.players);
            players.forEach(player => {
              if (!stats[player]) {
                stats[player] = { games: 0, wins: 0 };
              }
              stats[player].games++;
              if (game.winner === player) {
                stats[player].wins++;
              }
            });
          });

          // Insert recalculated stats
          const insertPromises = Object.entries(stats).map(([player, stat]) => {
            return new Promise((res, rej) => {
              db.run(
                'INSERT INTO player_stats (player, games_played, wins) VALUES (?, ?, ?)',
                [player, stat.games, stat.wins],
                (err) => err ? rej(err) : res()
              );
            });
          });

          Promise.all(insertPromises).then(() => resolve()).catch(reject);
        });
      });
    });
  });
}

// API Routes
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
      const gameId = await new Promise((resolve, reject) => {
        db.run(
          "INSERT INTO games (players, seating_hash) VALUES (?, ?)",
          [JSON.stringify(seating), hash],
          function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
          }
        );
      });

      // Update player stats (games played)
      await updatePlayerStats(seating);

      return res.json({ seating, gameId });
    }
  }

  res.status(409).json({ error: "Could not generate unique seating after 50 attempts" });
});

app.post("/api/winner", async (req, res) => {
  const { gameId, winner } = req.body;

  if (!gameId || !winner) {
    return res.status(400).json({ error: "Missing gameId or winner" });
  }

  try {
    // Get game to verify it exists and get players
    const game = await new Promise((resolve, reject) => {
      db.get(
        "SELECT players FROM games WHERE id = ?",
        [gameId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    const players = JSON.parse(game.players);

    if (!players.includes(winner)) {
      return res.status(400).json({ error: "Winner not in game" });
    }

    // Update game with winner
    await new Promise((resolve, reject) => {
      db.run(
        "UPDATE games SET winner = ? WHERE id = ?",
        [winner, gameId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Update winner's stats
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE player_stats SET wins = wins + 1 WHERE player = ?`,
        [winner],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ success: true });

  } catch (error) {
    console.error('Error recording winner:', error);
    res.status(500).json({ error: "Failed to record winner" });
  }
});

app.get("/api/stats", (_, res) => {
  db.all(
    "SELECT player, games_played, wins FROM player_stats ORDER BY wins DESC, games_played DESC",
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Failed to load stats" });
      }

      const stats = rows.map(row => ({
        player: row.player,
        gamesPlayed: row.games_played,
        wins: row.wins,
        winRate: row.games_played > 0
          ? Math.round((row.wins / row.games_played) * 100)
          : 0
      }));

      res.json(stats);
    }
  );
});

app.get("/api/history", (_, res) => {
  db.all(
    "SELECT id, created_at, players, winner FROM games ORDER BY id DESC LIMIT 20",
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Failed to load history" });
      }

      res.json(
        rows.map(r => ({
          id: r.id,
          created_at: r.created_at,
          players: JSON.parse(r.players),
          winner: r.winner
        }))
      );
    }
  );
});

// Admin Routes
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid password" });
  }

  const token = generateToken();
  adminTokens.add(token);

  // Auto-expire token after 24 hours
  setTimeout(() => {
    adminTokens.delete(token);
  }, 24 * 60 * 60 * 1000);

  res.json({ token });
});

app.get("/api/admin/verify", verifyAdminToken, (req, res) => {
  res.json({ valid: true });
});

app.delete("/api/admin/game/:id", verifyAdminToken, async (req, res) => {
  const gameId = req.params.id;

  try {
    await new Promise((resolve, reject) => {
      db.run("DELETE FROM games WHERE id = ?", [gameId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Recalculate all player stats
    await recalculateStats();

    res.json({ success: true });

  } catch (error) {
    console.error('Error deleting game:', error);
    res.status(500).json({ error: "Failed to delete game" });
  }
});

app.patch("/api/admin/game/:id", verifyAdminToken, async (req, res) => {
  const gameId = req.params.id;
  const { winner } = req.body;

  try {
    // Get game to verify it exists
    const game = await new Promise((resolve, reject) => {
      db.get("SELECT players FROM games WHERE id = ?", [gameId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    const players = JSON.parse(game.players);

    // Validate winner if provided
    if (winner && !players.includes(winner)) {
      return res.status(400).json({ error: "Winner not in game" });
    }

    // Update game
    await new Promise((resolve, reject) => {
      db.run(
        "UPDATE games SET winner = ? WHERE id = ?",
        [winner || null, gameId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Recalculate all player stats
    await recalculateStats();

    res.json({ success: true });

  } catch (error) {
    console.error('Error updating game:', error);
    res.status(500).json({ error: "Failed to update game" });
  }
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
  console.log(`Admin password: ${ADMIN_PASSWORD}`);
});