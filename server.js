require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Admin names (lowercase)
const ADMIN_NAMES = ['admin', 'aitor'];

function isAdmin(name) {
    return ADMIN_NAMES.includes(name?.toLowerCase());
}

// Security & Performance Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "'unsafe-inline'"],
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            "font-src": ["'self'", "https://fonts.gstatic.com"],
            "img-src": ["'self'", "data:", "https:"],
        },
    },
}));
app.use(compression());
app.use(morgan('dev'));

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api', limiter);

// Standard Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== DATABASE (Simple In-Memory + PostgreSQL) ====================

const IS_POSTGRES = !!process.env.DATABASE_URL;
let pool;

if (IS_POSTGRES) {
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    console.log('✅ PostgreSQL configured');

    // Initialize tables
    (async () => {
        try {
            await pool.query(`
        CREATE TABLE IF NOT EXISTS players (
          id SERIAL PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
            await pool.query(`
        CREATE TABLE IF NOT EXISTS matches (
          id SERIAL PRIMARY KEY,
          team TEXT NOT NULL,
          opponent TEXT NOT NULL,
          is_home INTEGER DEFAULT 1,
          match_date TIMESTAMP NOT NULL,
          deadline TIMESTAMP NOT NULL,
          home_goals INTEGER DEFAULT NULL,
          away_goals INTEGER DEFAULT NULL,
          is_finished INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
            await pool.query(`
        CREATE TABLE IF NOT EXISTS predictions (
          id SERIAL PRIMARY KEY,
          player_name TEXT NOT NULL,
          match_id INTEGER NOT NULL REFERENCES matches(id),
          home_goals INTEGER NOT NULL,
          away_goals INTEGER NOT NULL,
          points INTEGER DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(player_name, match_id)
        );
      `);
            console.log('✅ Tables initialized');
        } catch (err) {
            console.error('DB init error:', err);
        }
    })();
}

// Simple query helpers
async function query(sql, params = []) {
    if (!IS_POSTGRES) throw new Error('No database configured');
    const result = await pool.query(sql, params);
    return result.rows;
}

async function queryOne(sql, params = []) {
    const rows = await query(sql, params);
    return rows[0];
}

// ==================== API ROUTES ====================

// Register player (simple - just name)
app.post('/api/register-simple', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || name.length < 2) {
            return res.status(400).json({ error: 'Nombre inválido' });
        }

        if (IS_POSTGRES) {
            await pool.query(
                'INSERT INTO players (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
                [name]
            );
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.json({ success: true }); // Don't fail on duplicate
    }
});

// Get all matches
app.get('/api/matches', async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json([]);
        const matches = await query('SELECT * FROM matches ORDER BY match_date DESC');
        res.json(matches);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get upcoming matches
app.get('/api/matches/upcoming', async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json([]);
        const matches = await query('SELECT * FROM matches WHERE is_finished = 0 ORDER BY match_date ASC');
        res.json(matches);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create match (admin only)
app.post('/api/matches', async (req, res) => {
    try {
        const { team, opponent, isHome, matchDate, deadline, adminName } = req.body;

        if (!isAdmin(adminName)) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        if (!team || !opponent || !matchDate || !deadline) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }

        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });

        const result = await pool.query(
            'INSERT INTO matches (team, opponent, is_home, match_date, deadline) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [team, opponent, isHome ? 1 : 0, matchDate, deadline]
        );

        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Set match result (admin only)
app.put('/api/matches/:id/result', async (req, res) => {
    try {
        const { homeGoals, awayGoals, adminName } = req.body;
        const matchId = parseInt(req.params.id);

        if (!isAdmin(adminName)) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });

        // Update match
        await pool.query(
            'UPDATE matches SET home_goals = $1, away_goals = $2, is_finished = 1 WHERE id = $3',
            [homeGoals, awayGoals, matchId]
        );

        // Calculate points for all predictions
        const predictions = await query('SELECT * FROM predictions WHERE match_id = $1', [matchId]);

        for (const pred of predictions) {
            const points = calculatePoints(pred.home_goals, pred.away_goals, homeGoals, awayGoals);
            await pool.query('UPDATE predictions SET points = $1 WHERE id = $2', [points, pred.id]);
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete match (admin only)
app.delete('/api/matches/:id', async (req, res) => {
    try {
        const { adminName } = req.query;
        const matchId = parseInt(req.params.id);

        if (!isAdmin(adminName)) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });

        await pool.query('DELETE FROM predictions WHERE match_id = $1', [matchId]);
        await pool.query('DELETE FROM matches WHERE id = $1', [matchId]);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Save prediction
app.post('/api/predictions', async (req, res) => {
    try {
        const { playerName, matchId, homeGoals, awayGoals } = req.body;

        if (!playerName || matchId === undefined || homeGoals === undefined || awayGoals === undefined) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }

        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });

        // Check deadline
        const match = await queryOne('SELECT deadline FROM matches WHERE id = $1', [matchId]);
        if (!match) return res.status(404).json({ error: 'Partido no encontrado' });

        const now = new Date();
        const deadline = new Date(match.deadline);
        if (now > deadline) {
            return res.status(400).json({ error: 'El plazo para pronósticos ha terminado' });
        }

        // Upsert prediction
        await pool.query(`
      INSERT INTO predictions (player_name, match_id, home_goals, away_goals) 
      VALUES ($1, $2, $3, $4)
      ON CONFLICT(player_name, match_id) DO UPDATE SET home_goals = $3, away_goals = $4
    `, [playerName, matchId, homeGoals, awayGoals]);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get predictions for a player
app.get('/api/predictions/:playerName', async (req, res) => {
    try {
        const playerName = decodeURIComponent(req.params.playerName);

        if (!IS_POSTGRES) return res.json([]);

        const predictions = await query(`
      SELECT p.*, m.team, m.opponent, m.is_home, m.match_date, 
             m.home_goals as real_home, m.away_goals as real_away, m.is_finished
      FROM predictions p
      JOIN matches m ON p.match_id = m.id
      WHERE p.player_name = $1
      ORDER BY m.match_date DESC
    `, [playerName]);

        res.json(predictions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json([]);

        const leaderboard = await query(`
      SELECT 
        player_name as name,
        COALESCE(SUM(points), 0) as total_points,
        COUNT(CASE WHEN points = 5 THEN 1 END) as exact_predictions,
        COUNT(CASE WHEN points IS NOT NULL THEN 1 END) as total_predictions
      FROM predictions
      GROUP BY player_name
      ORDER BY total_points DESC, exact_predictions DESC
    `);

        res.json(leaderboard);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Points calculation
function calculatePoints(predHome, predAway, realHome, realAway) {
    // Exact result = 5 points
    if (predHome === realHome && predAway === realAway) {
        return 5;
    }

    let points = 0;

    // Correct goals for one team = 2 points
    if (predHome === realHome || predAway === realAway) {
        points += 2;
    }

    // Correct winner/draw = 1 point
    const predResult = predHome > predAway ? 'H' : (predHome < predAway ? 'A' : 'D');
    const realResult = realHome > realAway ? 'H' : (realHome < realAway ? 'A' : 'D');
    if (predResult === realResult) {
        points += 1;
    }

    // Correct goal difference = 1 point
    if ((predHome - predAway) === (realHome - realAway)) {
        points += 1;
    }

    return Math.min(points, 3); // Max 3 if not exact
}

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                   🦁 BOLILLA GARRAS 🦁                    ║
║                  Peña Garras Taldea Sestao                ║
╠═══════════════════════════════════════════════════════════╣
║  Servidor iniciado en: http://localhost:${PORT}              ║
║  Modo: ${process.env.NODE_ENV || 'development'}                                      ║
║  Base de datos: ${IS_POSTGRES ? 'PostgreSQL' : 'No configurada'}                     ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
