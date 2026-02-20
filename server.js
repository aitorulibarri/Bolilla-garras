require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const session = require('express-session');

const app = express();
app.set('trust proxy', 1); // Fix for express-rate-limit with Vercel
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-fallback-secret-change-in-production';

// Admin usernames (lowercase) - these users will have is_admin = true on registration
const ADMIN_USERNAMES = ['admin', 'aitor'];

function isAdminUsername(username) {
    return ADMIN_USERNAMES.includes(username?.toLowerCase());
}

// Check if user is admin from database
async function isAdmin(username) {
    if (!IS_POSTGRES || !username) return false;
    try {
        const user = await queryOne('SELECT is_admin FROM users WHERE LOWER(username) = LOWER($1)', [username]);
        return user?.is_admin === 1;
    } catch {
        return isAdminUsername(username); // Fallback to static list
    }
}

// Auth Middleware
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: 'No autenticado' });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user || !req.session.user.isAdmin) {
        return res.status(403).json({ error: 'Acceso denegado: Se requiere administrador' });
    }
    next();
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

// Rate Limiting - stricter for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10, // 10 attempts per 15 minutes for auth
    message: { error: 'Demasiados intentos. Espera 15 minutos.' }
});

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api', limiter);

// Session Middleware
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Standard Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== DATABASE (PostgreSQL) ====================

const IS_POSTGRES = !!process.env.DATABASE_URL;
let pool;
let dbReady = false;
let dbInitPromise = null;

if (IS_POSTGRES) {
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    console.log('✅ PostgreSQL configured');
}

// Lazy database initialization - runs once, awaited before any query
async function dbInit() {
    if (dbReady) return;
    if (dbInitPromise) return dbInitPromise;

    dbInitPromise = (async () => {
        try {
            // Check if we need to migrate the users table
            const checkColumn = await pool.query(`
                SELECT column_name FROM information_schema.columns 
                WHERE table_name = 'users' AND column_name = 'username'
            `);

            if (checkColumn.rows.length === 0) {
                console.log('⚠️ Migrating users table to new auth schema...');
                await pool.query('DROP TABLE IF EXISTS users CASCADE');
            }

            // users table with authentication
            await pool.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    display_name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    is_admin INTEGER DEFAULT 0,
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

            dbReady = true;
            console.log('✅ Tables initialized');
        } catch (err) {
            console.error('DB init error:', err);
            dbInitPromise = null; // Allow retry on next request
            throw err;
        }
    })();

    return dbInitPromise;
}

// Simple query helpers - ensure DB is initialized first
async function query(sql, params = []) {
    if (!IS_POSTGRES) throw new Error('No database configured');
    await dbInit();
    const result = await pool.query(sql, params);
    return result.rows;
}

async function queryOne(sql, params = []) {
    const rows = await query(sql, params);
    return rows[0];
}

// ==================== AUTH ROUTES ====================

// Register new user
app.post('/api/register', authLimiter, async (req, res) => {
    try {
        const { username, displayName, password } = req.body;

        // Validation
        if (!username || username.length < 3) {
            return res.status(400).json({ error: 'Usuario debe tener al menos 3 caracteres' });
        }
        if (!displayName || displayName.length < 2) {
            return res.status(400).json({ error: 'Nombre debe tener al menos 2 caracteres' });
        }
        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Contraseña debe tener al menos 8 caracteres' });
        }

        // Check username format (alphanumeric + underscore only)
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return res.status(400).json({ error: 'Usuario solo puede contener letras, números y guión bajo' });
        }

        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database configured' });

        // Check if username already exists
        const existing = await queryOne('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
        if (existing) {
            return res.status(400).json({ error: 'Este usuario ya existe' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // Determine if admin
        const isAdmin = isAdminUsername(username);

        // Create user
        const result = await pool.query(
            'INSERT INTO users (username, display_name, password_hash, is_admin) VALUES ($1, $2, $3, $4) RETURNING id, username, display_name, is_admin',
[username.toLowerCase(), displayName, passwordHash, isAdmin ? 1 : 0]
        );

        const user = result.rows[0];

        // Store user in session
        req.session.user = {
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            isAdmin: user.is_admin === 1
        };

        res.json({
            success: true,
            user: req.session.user
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Error al registrar usuario' });
    }
});

// Login
app.post('/api/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
        }

        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database configured' });

        // Find user
        const user = await queryOne('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
        if (!user) {
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        }

        // Store user in session
        req.session.user = {
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            isAdmin: user.is_admin === 1
        };

        res.json({
            success: true,
            user: req.session.user
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Error al iniciar sesión', detail: err.message });
    }
});

// Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Error al cerrar sesión' });
        }
        res.json({ success: true });
    });
});

// Legacy endpoint for backward compatibility (will be removed later)
app.post('/api/register-simple', async (req, res) => {
    res.json({ success: true, message: 'Use /api/register instead' });
});

// Emergency admin reset endpoint
app.get('/api/admin/emergency-reset-garras', async (req, res) => {
    try {
        const key = req.query.key;
        if (key !== 'GARRAS_SECRET_RESET_2026') {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        if (!IS_POSTGRES) {
            return res.status(500).json({ error: 'No database configured' });
        }
        // Ensure DB is ready
        await dbInit();

        // Create GARRAS admin
        const salt = await bcrypt.genSalt(10);
        const passwordHash1 = await bcrypt.hash('GARRAS123', salt);
        const existing = await queryOne('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', ['garras']);
        let msg;
        if (existing) {
            await pool.query('UPDATE users SET password_hash = $1, is_admin = 1 WHERE LOWER(username) = LOWER($2)', [passwordHash1, 'garras']);
            msg = 'GARRAS actualizado. ';
        } else {
            await pool.query('INSERT INTO users (username, display_name, password_hash, is_admin) VALUES ($1, $2, $3, 1)', ['garras', 'Admin Garras', passwordHash1]);
            msg = 'GARRAS creado. ';
        }

        // Create aitoruli admin
        const passwordHash2 = await bcrypt.hash('1234', salt);
        const existing2 = await queryOne('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', ['aitoruli']);
        if (existing2) {
            await pool.query('UPDATE users SET password_hash = $1, is_admin = 1 WHERE LOWER(username) = LOWER($2)', [passwordHash2, 'aitoruli']);
            msg += 'aitoruli actualizado.';
        } else {
            await pool.query('INSERT INTO users (username, display_name, password_hash, is_admin) VALUES ($1, $2, $3, 1)', ['aitoruli', 'Aitor Ulibarri', passwordHash2]);
            msg += 'aitoruli creado.';
        }

        res.json({ success: true, message: msg });
    } catch (err) {
        console.error('Emergency reset error:', err);
        res.status(500).json({ error: 'Error al resetear usuario: ' + err.message });
    }
});

// Emergency: clear all predictions (no auth required for emergency)
app.get('/api/admin/clear-predictions', async (req, res) => {
    try {
        await dbInit();
        await pool.query('DELETE FROM predictions');
        res.json({ success: true, message: 'Todos los pronósticos han sido eliminados' });
    } catch (err) {
        console.error('Clear predictions error:', err);
        res.status(500).json({ error: 'Error al eliminar pronósticos' });
    }
});


// ==================== API ROUTES ====================



// Get all matches
app.get('/api/matches', requireAuth, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json([]);
        const username = req.session.user.username;
        let matches;
        matches = await query(`
            SELECT m.*,
                   p.id as prediction_id, p.home_goals as pred_home, p.away_goals as pred_away, p.points as prediction_points
            FROM matches m
            LEFT JOIN predictions p ON m.id = p.match_id AND LOWER(p.player_name) = LOWER($1)
            ORDER BY m.match_date DESC
        `, [username]);
        matches = matches.map(m => ({
            ...m,
            userPrediction: m.prediction_id ? {
                home_goals: m.pred_home,
                away_goals: m.pred_away,
                points: m.prediction_points
            } : null
        }));
        res.json(matches);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get upcoming matches
app.get('/api/matches/upcoming', requireAuth, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json([]);
        const username = req.session.user.username;
        let matches;
        matches = await query(`
            SELECT m.*,
                   p.id as prediction_id, p.home_goals as pred_home, p.away_goals as pred_away, p.points as prediction_points
            FROM matches m
            LEFT JOIN predictions p ON m.id = p.match_id AND LOWER(p.player_name) = LOWER($1)
            WHERE m.is_finished = 0
            ORDER BY m.match_date ASC
        `, [username]);
        // Transform to userPrediction format
        matches = matches.map(m => ({
            ...m,
            userPrediction: m.prediction_id ? {
                home_goals: m.pred_home,
                away_goals: m.pred_away,
                points: m.prediction_points
            } : null
        }));
        res.json(matches);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get admin statistics
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json({ totalUsers: 0, upcomingMatches: [], usersWithoutPredictions: [] });

        // Total active users
        const totalUsers = await queryOne('SELECT COUNT(*) as count FROM users');

        // Upcoming matches with prediction stats
        const upcomingMatches = await query(`
            SELECT 
                m.id,
                m.team,
                m.opponent,
                m.is_home,
                m.match_date,
                m.deadline,
                (SELECT COUNT(DISTINCT player_name) FROM predictions WHERE match_id = m.id) as predictions_count
            FROM matches m
            WHERE m.is_finished = 0 AND m.deadline > NOW()
            ORDER BY m.deadline ASC
            LIMIT 5
        `);

        // Calculate participation percentage for each match
        const matchesWithStats = upcomingMatches.map(match => ({
            ...match,
            participation: totalUsers.count > 0
                ? Math.round((match.predictions_count / totalUsers.count) * 100)
                : 0
        }));

        // Users who haven't predicted for any upcoming match
        const usersWithoutPredictions = await query(`
            SELECT DISTINCT p.display_name, p.username
            FROM users p
            WHERE NOT EXISTS (
                SELECT 1
                FROM predictions pr
                JOIN matches m ON pr.match_id = m.id
                WHERE pr.player_name = p.display_name
                  AND m.is_finished = 0 
                  AND m.deadline > NOW()
            )
            ORDER BY p.display_name
            LIMIT 10
        `);

        res.json({
            totalUsers: totalUsers.count,
            upcomingMatches: matchesWithStats,
            usersWithoutPredictions
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create match (admin only)
app.post('/api/matches', requireAdmin, async (req, res) => {
    try {
        const { team, opponent, isHome, matchDate, deadline } = req.body;

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

// Edit match metadata (admin only, before match is finished)
app.put('/api/matches/:id', requireAdmin, async (req, res) => {
    try {
        const { matchDate, deadline } = req.body;
        const matchId = parseInt(req.params.id);

        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });

        // Check if match is already finished
        const match = await queryOne('SELECT is_finished FROM matches WHERE id = $1', [matchId]);
        if (!match) {
            return res.status(404).json({ error: 'Partido no encontrado' });
        }
        if (match.is_finished) {
            return res.status(400).json({ error: 'No se puede editar un partido finalizado' });
        }

        // Update match
        await pool.query(
            'UPDATE matches SET match_date = $1, deadline = $2 WHERE id = $3',
            [matchDate, deadline, matchId]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Set match result (admin only)
app.put('/api/matches/:id/result', requireAdmin, async (req, res) => {
    try {
        const { homeGoals, awayGoals } = req.body;
        const matchId = parseInt(req.params.id);

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
app.delete('/api/matches/:id', requireAdmin, async (req, res) => {
    try {
        const matchId = parseInt(req.params.id);

        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });

        await pool.query('DELETE FROM predictions WHERE match_id = $1', [matchId]);
        await pool.query('DELETE FROM matches WHERE id = $1', [matchId]);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Save prediction
app.post('/api/predictions', requireAuth, async (req, res) => {
    try {
        const { matchId, homeGoals, awayGoals } = req.body;
        const playerName = req.session.user.username;

        // Validation
        if (matchId === undefined || homeGoals === undefined || awayGoals === undefined) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }

        // Validate goal values
        const homeGoalsNum = parseInt(homeGoals);
        const awayGoalsNum = parseInt(awayGoals);
        if (isNaN(homeGoalsNum) || isNaN(awayGoalsNum) || homeGoalsNum < 0 || homeGoalsNum > 20 || awayGoalsNum < 0 || awayGoalsNum > 20) {
            return res.status(400).json({ error: 'Los goles deben ser números entre 0 y 20' });
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
    `, [playerName, matchId, homeGoalsNum, awayGoalsNum]);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error al guardar pronóstico' });
    }
});

// Get predictions for current user
app.get('/api/predictions', requireAuth, async (req, res) => {
    try {
        const playerName = req.session.user.username;

        if (!IS_POSTGRES) return res.json([]);

        const predictions = await query(`
      SELECT p.*, m.team, m.opponent, m.is_home, m.match_date,
             m.home_goals as real_home, m.away_goals as real_away, m.is_finished
      FROM predictions p
      JOIN matches m ON p.match_id = m.id
      WHERE LOWER(p.player_name) = LOWER($1)
      ORDER BY m.match_date DESC
    `, [playerName]);

        res.json(predictions);
    } catch (err) {
        res.status(500).json({ error: 'Error al cargar historial' });
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
