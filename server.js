import express from "express";
import sqlite3 from "sqlite3";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Simple token storage (in production, use Redis or database)
const adminTokens = new Set();

// SQLite DB (inside container at /app/data/)
const db = new sqlite3.Database("/app/data/poker.db");

// Create tables
db.serialize(() => {
  // Games table
  db.run(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      players TEXT NOT NULL,
      seating_hash TEXT UNIQUE NOT NULL,
      winner TEXT,
      second_place TEXT,
      third_place TEXT
    )
  `, (err) => {
    if (err) console.error('Error creating games table:', err);
  });

  // Player stats table
  db.run(`
    CREATE TABLE IF NOT EXISTS player_stats (
      player TEXT PRIMARY KEY,
      games_played INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      total_buyins REAL DEFAULT 0,
      total_winnings REAL DEFAULT 0,
      net_profit REAL DEFAULT 0
    )
  `, (err) => {
    if (err) console.error('Error creating player_stats table:', err);
  });

  // Admin config table
  db.run(`
    CREATE TABLE IF NOT EXISTS admin_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating admin_config table:', err);
    } else {
      console.log('Admin config table ready');
    }
  });

  // Add winner column if it doesn't exist (for existing databases)
  setTimeout(() => {
    db.all(`PRAGMA table_info(games)`, [], (err, columns) => {
      if (err) {
        console.error('Error checking games table:', err);
        return;
      }

      if (columns) {
        const hasWinner = columns.some(col => col.name === 'winner');
        const hasSecondPlace = columns.some(col => col.name === 'second_place');
        const hasThirdPlace = columns.some(col => col.name === 'third_place');

        if (!hasWinner) {
          console.log('Adding winner column to existing database...');
          db.run(`ALTER TABLE games ADD COLUMN winner TEXT`, (err) => {
            if (err) console.error('Error adding winner column:', err);
            else console.log('Winner column added successfully');
          });
        }

        if (!hasSecondPlace) {
          console.log('Adding second_place column to existing database...');
          db.run(`ALTER TABLE games ADD COLUMN second_place TEXT`, (err) => {
            if (err) console.error('Error adding second_place column:', err);
            else console.log('Second place column added successfully');
          });
        }

        if (!hasThirdPlace) {
          console.log('Adding third_place column to existing database...');
          db.run(`ALTER TABLE games ADD COLUMN third_place TEXT`, (err) => {
            if (err) console.error('Error adding third_place column:', err);
            else console.log('Third place column added successfully');
          });
        }
      }
    });

    // Check player_stats for top3 column
    db.all(`PRAGMA table_info(player_stats)`, [], (err, columns) => {
      if (err) return;
      if (columns && !columns.some(col => col.name === 'top3')) {
        console.log('Adding top3 column to player_stats...');
        db.run(`ALTER TABLE player_stats ADD COLUMN top3 INTEGER DEFAULT 0`, async (err) => {
          if (!err) {
            // If we just added the column, we should recalculate stats to fill it
            console.log("Recalculating stats for new schema...");
            await recalculateStats();
          }
        });
      } else {
        // Always recalculate on startup to ensure consistency for now (fixes 0 stats issue)
        console.log("Ensuring stats consistency...");
        recalculateStats();
      }
    });

    // Check games table for buy_in column
    db.all(`PRAGMA table_info(games)`, [], (err, columns) => {
      if (err) return;
      if (columns && !columns.some(col => col.name === 'buy_in')) {
        console.log('Adding buy_in column to games...');
        db.run(`ALTER TABLE games ADD COLUMN buy_in REAL DEFAULT 0`, (err) => {
          if (err) console.error('Error adding buy_in column:', err);
        });
      }
    });

    // Check player_stats for financial columns
    db.all(`PRAGMA table_info(player_stats)`, [], (err, columns) => {
      if (err) return;
      const hasNetProfit = columns.some(col => col.name === 'net_profit');

      if (!hasNetProfit) {
        console.log('Adding financial columns to player_stats...');
        db.serialize(() => {
          db.run(`ALTER TABLE player_stats ADD COLUMN total_buyins REAL DEFAULT 0`);
          db.run(`ALTER TABLE player_stats ADD COLUMN total_winnings REAL DEFAULT 0`);
          db.run(`ALTER TABLE player_stats ADD COLUMN net_profit REAL DEFAULT 0`, async () => {
            console.log("Recalculating stats for financial schema...");
            await recalculateStats();
          });
        });
      }
    });

  }, 100);
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

function hashPassword(password) {
  return crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getAdminPassword() {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT value FROM admin_config WHERE key = 'admin_password_hash'",
      [],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.value : null);
      }
    );
  });
}

function setAdminPassword(passwordHash) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT OR REPLACE INTO admin_config (key, value) VALUES ('admin_password_hash', ?)",
      [passwordHash],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
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

function describePayouts(playerCount, buyIn) {
  const totalPot = playerCount * buyIn;
  if (totalPot === 0) return { first: 0, second: 0, third: 0 };

  // Determine payouts: Winner Takes All
  return { first: totalPot, second: 0, third: 0, totalPot };
}

function updatePlayerStats(players, buyIn = 0) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      players.forEach(player => {
        db.run(
          `INSERT INTO player_stats (player, games_played, wins, total_buyins, net_profit)
           VALUES (?, 1, 0, ?, ?)
           ON CONFLICT(player) DO UPDATE SET
           games_played = games_played + 1,
           total_buyins = total_buyins + ?,
           net_profit = net_profit - ?`,
          [player, buyIn, -buyIn, buyIn, buyIn]
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
        db.all('SELECT players, winner, second_place, third_place, buy_in FROM games', [], (err, games) => {
          if (err) {
            reject(err);
            return;
          }

          const stats = {};

          games.forEach(game => {
            let players = [];
            try { players = JSON.parse(game.players); } catch (e) { }

            players.forEach(player => {
              if (!stats[player]) {
                stats[player] = { games: 0, wins: 0, top3: 0, buyins: 0, winnings: 0 };
              }
              stats[player].games++;

              const buyIn = game.buy_in || 0;
              stats[player].buyins += buyIn;

              if (game.winner === player) {
                stats[player].wins++;
                stats[player].top3++;
              } else if (game.second_place === player || game.third_place === player) {
                stats[player].top3++;
              }
            });

            // Calculate winnings for this game
            const buyIn = game.buy_in || 0;
            if (buyIn > 0 && game.winner) {
              const payouts = describePayouts(players.length, buyIn);
              if (stats[game.winner]) stats[game.winner].winnings += payouts.first;
              if (game.second_place && stats[game.second_place]) stats[game.second_place].winnings += payouts.second;
              if (game.third_place && stats[game.third_place]) stats[game.third_place].winnings += payouts.third;
            }
          });

          // Insert recalculated stats
          const insertPromises = Object.entries(stats).map(([player, stat]) => {
            return new Promise((res, rej) => {
              db.run(
                'INSERT INTO player_stats (player, games_played, wins, top3, total_buyins, total_winnings, net_profit) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [player, stat.games, stat.wins, stat.top3, stat.buyins, stat.winnings, stat.winnings - stat.buyins],
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
app.get("/api/active-game", (req, res) => {
  db.get(
    "SELECT id, players, seating_hash, buy_in FROM games WHERE winner IS NULL ORDER BY id DESC LIMIT 1",
    [],
    (err, row) => {
      if (err) {
        console.error('Error checking active game:', err);
        return res.status(500).json({ error: "Database error" });
      }

      if (row) {
        // Found an active game
        try {
          const gameData = {
            id: row.id,
            seating: JSON.parse(row.players), // Note: The database stores 'players' as the ordered seating
            buyIn: row.buy_in || 0
          };
          res.json(gameData);
        } catch (parseError) {
          console.error('Error parsing active game players:', parseError);
          res.json(null);
        }
      } else {
        res.json(null);
      }
    }
  );
});

app.post("/api/generate", async (req, res) => {
  const players = req.body.players;
  const buyIn = Number(req.body.buyIn) || 0;

  if (!Array.isArray(players) || players.length < 2) {
    return res.status(400).json({ error: "Invalid players list" });
  }

  // Check for existing active game
  try {
    const hasActive = await new Promise((resolve, reject) => {
      db.get(
        "SELECT 1 FROM games WHERE winner IS NULL",
        [],
        (err, row) => {
          if (err) reject(err);
          else resolve(!!row);
        }
      );
    });

    if (hasActive) {
      return res.status(409).json({ error: "A game is already in progress! Finish it first." });
    }
  } catch (error) {
    console.error('Error checking active games:', error);
    return res.status(500).json({ error: "Server error checking active games" });
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
          "INSERT INTO games (players, seating_hash, buy_in) VALUES (?, ?, ?)",
          [JSON.stringify(seating), hash, buyIn],
          function (err) {
            if (err) reject(err);
            else resolve(this.lastID);
          }
        );
      });

      // Update player stats (games played)
      await updatePlayerStats(seating, buyIn);

      return res.json({ seating, gameId });
    }
  }

  res.status(409).json({ error: "Could not generate unique seating after 50 attempts" });
});

app.post("/api/results", async (req, res) => {
  const { gameId, first, second, third } = req.body;

  if (!gameId || !first) {
    return res.status(400).json({ error: "Missing gameId or first place winner" });
  }

  try {
    // Get game to verify it exists and get players
    const game = await new Promise((resolve, reject) => {
      db.get(
        "SELECT players, buy_in FROM games WHERE id = ?",
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

    // Validate all placements are in the game
    if (!players.includes(first)) {
      return res.status(400).json({ error: "First place not in game" });
    }
    if (second && !players.includes(second)) {
      return res.status(400).json({ error: "Second place not in game" });
    }
    if (third && !players.includes(third)) {
      return res.status(400).json({ error: "Third place not in game" });
    }

    // Update game with placements
    await new Promise((resolve, reject) => {
      db.run(
        "UPDATE games SET winner = ?, second_place = ?, third_place = ? WHERE id = ?",
        [first, second || null, third || null, gameId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Update winner's stats
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE player_stats SET wins = wins + 1, top3 = top3 + 1 WHERE player = ?`,
        [first],
        (err) => err ? reject(err) : resolve()
      );
    });

    // Update 2nd place stats
    if (second) {
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE player_stats SET top3 = top3 + 1 WHERE player = ?`,
          [second],
          (err) => err ? reject(err) : resolve()
        );
      });
    }

    // Update 3rd place stats
    if (third) {
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE player_stats SET top3 = top3 + 1 WHERE player = ?`,
          [third],
          (err) => err ? reject(err) : resolve()
        );
      });
    }

    res.json({ success: true });

  } catch (error) {
    console.error('Error recording results:', error);
    res.status(500).json({ error: "Failed to record results" });
  }
});

app.get("/api/stats", (_, res) => {
  db.all(
    "SELECT player, games_played, wins, top3, total_buyins, total_winnings, net_profit FROM player_stats ORDER BY net_profit DESC, wins DESC, games_played DESC",
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Failed to load stats" });
      }

      const stats = rows.map(row => ({
        player: row.player,
        gamesPlayed: row.games_played,
        wins: row.wins,
        top3: row.top3 || 0,
        buyins: row.total_buyins || 0,
        winnings: row.total_winnings || 0,
        netProfit: row.net_profit || 0,
        winRate: row.games_played > 0
          ? Math.round((row.wins / row.games_played) * 100)
          : 0,
        top3Rate: row.games_played > 0
          ? Math.round(((row.top3 || 0) / row.games_played) * 100)
          : 0
      }));

      res.json(stats);
    }
  );
});

app.get("/api/history", (req, res) => {
  db.all(
    "SELECT id, created_at, players, winner, second_place, third_place, buy_in FROM games ORDER BY id DESC LIMIT 20",
    [],
    (err, rows) => {
      if (err) {
        console.error('Database error in /api/history:', err);
        return res.status(500).json({ error: "Failed to load history", details: err.message });
      }

      if (!rows) {
        return res.json([]);
      }

      try {
        const games = rows.map(r => {
          let parsedPlayers;
          try {
            parsedPlayers = JSON.parse(r.players);
          } catch (parseError) {
            console.error('Error parsing players for game', r.id, ':', parseError);
            parsedPlayers = [];
          }

          return {
            id: r.id,
            created_at: r.created_at,
            players: parsedPlayers,
            winner: r.winner,
            second_place: r.second_place,
            second_place: r.second_place,
            third_place: r.third_place,
            buyIn: r.buy_in || 0,
            payouts: r.buy_in ? describePayouts(parsedPlayers.length, r.buy_in) : null
          };
        });

        res.json(games);
      } catch (error) {
        console.error('Error processing history:', error);
        res.status(500).json({ error: "Failed to process history", details: error.message });
      }
    }
  );
});

// Admin Routes
app.get("/api/admin/check-setup", async (req, res) => {
  try {
    const passwordHash = await getAdminPassword();
    res.json({ setupComplete: !!passwordHash });
  } catch (error) {
    console.error('Check setup error:', error);
    res.status(500).json({ error: "Failed to check setup status" });
  }
});

app.post("/api/admin/setup", async (req, res) => {
  const { password } = req.body;

  console.log('Admin setup attempt');

  if (!password || password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    const existingPassword = await getAdminPassword();
    if (existingPassword) {
      console.log('Setup blocked: password already exists');
      return res.status(400).json({ error: "Admin password already set" });
    }

    const passwordHash = hashPassword(password);
    console.log('Setting admin password...');
    await setAdminPassword(passwordHash);

    const token = generateToken();
    adminTokens.add(token);

    // Auto-expire token after 24 hours
    setTimeout(() => {
      adminTokens.delete(token);
    }, 24 * 60 * 60 * 1000);

    console.log('Admin password set successfully');
    res.json({ token, message: "Admin password set successfully" });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ error: "Failed to set admin password", details: error.message });
  }
});

app.post("/api/admin/login", async (req, res) => {
  const { password } = req.body;

  try {
    const storedHash = await getAdminPassword();

    if (!storedHash) {
      return res.status(400).json({ error: "Admin not set up. Please complete setup first.", needsSetup: true });
    }

    const passwordHash = hashPassword(password);

    if (passwordHash !== storedHash) {
      return res.status(401).json({ error: "Invalid password" });
    }

    const token = generateToken();
    adminTokens.add(token);

    // Auto-expire token after 24 hours
    setTimeout(() => {
      adminTokens.delete(token);
    }, 24 * 60 * 60 * 1000);

    res.json({ token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/api/admin/change-password", verifyAdminToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters" });
  }

  try {
    const storedHash = await getAdminPassword();
    const currentHash = hashPassword(currentPassword);

    if (currentHash !== storedHash) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const newHash = hashPassword(newPassword);
    await setAdminPassword(newHash);

    res.json({ message: "Password changed successfully" });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: "Failed to change password" });
  }
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
  const { winner, second_place, third_place } = req.body;

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

    // Validate placements if provided
    if (winner && !players.includes(winner)) return res.status(400).json({ error: "Winner not in game" });
    if (second_place && !players.includes(second_place)) return res.status(400).json({ error: "2nd place not in game" });
    if (third_place && !players.includes(third_place)) return res.status(400).json({ error: "3rd place not in game" });

    // Build update query dynamically
    let updateFields = [];
    let updateValues = [];

    if (winner !== undefined) { updateFields.push("winner = ?"); updateValues.push(winner || null); }
    if (second_place !== undefined) { updateFields.push("second_place = ?"); updateValues.push(second_place || null); }
    if (third_place !== undefined) { updateFields.push("third_place = ?"); updateValues.push(third_place || null); }

    if (updateFields.length > 0) {
      updateValues.push(gameId);
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE games SET ${updateFields.join(", ")} WHERE id = ?`,
          updateValues,
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      // Recalculate all player stats
      await recalculateStats();
    }

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
  console.log('Admin password is stored securely in database');
  console.log('Access the app and complete first-time setup to create admin password');
});