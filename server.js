require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// ==================== PASSWORD REVERSIBLE ENCRYPTION ====================
// Guarda la contraseña cifrada con AES-256-GCM para que el admin pueda verla.
// Clave: env var PASSWORD_ENCRYPTION_KEY (32 bytes base64) o derivada de JWT_SECRET.
function getEncryptionKey() {
    const raw = process.env.PASSWORD_ENCRYPTION_KEY;
    if (raw) {
        try {
            const buf = Buffer.from(raw, 'base64');
            if (buf.length === 32) return buf;
        } catch {}
        console.warn('⚠️ PASSWORD_ENCRYPTION_KEY inválida (debe ser 32 bytes base64). Derivando de JWT_SECRET.');
    }
    return crypto.createHash('sha256').update(String(process.env.JWT_SECRET || 'bolilla-garras-secret-2026-seguro')).digest();
}

function encryptPassword(plaintext) {
    if (!plaintext) return null;
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Formato: base64(iv):base64(tag):base64(ciphertext)
    return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptPassword(blob) {
    if (!blob) return null;
    try {
        const [ivB64, tagB64, dataB64] = String(blob).split(':');
        if (!ivB64 || !tagB64 || !dataB64) return null;
        const key = getEncryptionKey();
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
        return decrypted.toString('utf8');
    } catch (err) {
        console.error('decryptPassword error:', err.message);
        return null;
    }
}

const app = express();
app.set('trust proxy', 1); // Fix for express-rate-limit with Vercel
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'bolilla-garras-secret-2026-seguro';
const TOKEN_EXPIRY = '24h';

// Admin usernames (lowercase) - these users will have is_admin = true on registration
const ADMIN_USERNAMES = ['admin', 'garras'];

function isAdminUsername(username) {
    return ADMIN_USERNAMES.includes(username?.toLowerCase());
}

// Check if user is admin from database OR static list
async function isAdmin(username) {
    // First check static list (always works)
    if (isAdminUsername(username)) return true;
    // Then check database
    if (!IS_POSTGRES || !username) return false;
    try {
        const user = await queryOne('SELECT is_admin FROM users WHERE LOWER(username) = LOWER($1)', [username]);
        return user?.is_admin === 1;
    } catch {
        return false;
    }
}

// Security & Performance Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            "script-src-elem": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
            "img-src": ["'self'", "data:", "https:"],
            "connect-src": ["'self'", "https://cdn.jsdelivr.net"],
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

// JWT Authentication Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'No autenticado' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(401).json({ error: 'Token inválido' });
        }
        req.user = user;
        next();
    });
}

// Convenience middleware for requireAuth (same as authenticateToken)
const requireAuth = authenticateToken;

// Convenience middleware for requireAdmin - checks user after auth
const requireAdmin = (req, res, next) => {
    // Check if user exists (set by authenticateToken middleware)
    if (!req.user) {
        // User not authenticated, run authenticateToken first
        return authenticateToken(req, res, () => {
            checkAdmin(req, res, next);
        });
    }
    checkAdmin(req, res, next);
};

function checkAdmin(req, res, next) {
    // Allow admin usernames
    const username = req.user.username?.toLowerCase();
    if (['garras', 'admin'].includes(username)) {
        return next();
    }
    // Also check isAdmin flag
    if (req.user.isAdmin === true || req.user.isAdmin === 1) {
        return next();
    }
    return res.status(403).json({ error: 'Acceso denegado: Se requiere administrador' });
}

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

            // Add player_name column if it doesn't exist (for old databases)
            try {
                await pool.query(`ALTER TABLE predictions ADD COLUMN IF NOT EXISTS player_name TEXT`);
            } catch (e) { /* ignore if exists */ }

            // Add password_encrypted column (para que el admin pueda ver contraseñas)
            try {
                await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_encrypted TEXT`);
            } catch (e) { /* ignore if exists */ }

            // Ensure UNIQUE constraint exists (required for ON CONFLICT upsert)
            try {
                await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS predictions_player_match_unique ON predictions(player_name, match_id)`);
            } catch (e) { /* ignore if exists */ }

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

        // Create user — guardamos también contraseña cifrada para el admin
        const encrypted = encryptPassword(password);
        let result;
        try {
            result = await pool.query(
                'INSERT INTO users (username, display_name, password_hash, is_admin, password_encrypted) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, display_name, is_admin',
                [username.toLowerCase(), displayName, passwordHash, isAdmin ? 1 : 0, encrypted]
            );
        } catch (insertErr) {
            // Fallback por si la columna no existe todavía en la DB
            result = await pool.query(
                'INSERT INTO users (username, display_name, password_hash, is_admin) VALUES ($1, $2, $3, $4) RETURNING id, username, display_name, is_admin',
                [username.toLowerCase(), displayName, passwordHash, isAdmin ? 1 : 0]
            );
        }

        const user = result.rows[0];

        // Generate JWT token
        const isUserAdmin = !!user.is_admin;
        const token = jwt.sign(
            { id: user.id, username: user.username, displayName: user.display_name, isAdmin: isUserAdmin },
            JWT_SECRET,
            { expiresIn: TOKEN_EXPIRY }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                displayName: user.display_name,
                isAdmin: isUserAdmin
            }
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

        // Captura oportunista: si el usuario no tiene password_encrypted todavía,
        // lo rellenamos ahora que tenemos la contraseña en claro (solo usuarios
        // antiguos registrados antes de existir esta columna).
        if (!user.password_encrypted) {
            try {
                const enc = encryptPassword(password);
                if (enc) {
                    await pool.query('UPDATE users SET password_encrypted = $1 WHERE id = $2', [enc, user.id]);
                }
            } catch (e) { /* columna puede no existir aún */ }
        }

        // Generate JWT token
        const isUserAdmin = !!user.is_admin;
        const token = jwt.sign(
            { id: user.id, username: user.username, displayName: user.display_name, isAdmin: isUserAdmin },
            JWT_SECRET,
            { expiresIn: TOKEN_EXPIRY }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                displayName: user.display_name,
                isAdmin: isUserAdmin
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Error al iniciar sesión' });
    }
});

// Logout (JWT es stateless — el frontend borra el token de localStorage)
app.post('/api/logout', (req, res) => {
    res.json({ success: true });
});

// Reset password for GARRAS (admin only)
app.get('/api/admin/reset-garras-password', requireAdmin, async (req, res) => {
    try {
        await dbInit();
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash('GARRAS123', salt);
        await pool.query('UPDATE users SET password_hash = $1 WHERE LOWER(username) = LOWER($2)', [passwordHash, 'GARRAS']);
        res.json({ success: true, message: 'Password reset done' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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

        res.json({ success: true, message: msg });
    } catch (err) {
        console.error('Emergency reset error:', err);
        res.status(500).json({ error: 'Error al resetear usuario: ' + err.message });
    }
});

// Debug endpoint to check current user (admin only)
app.get('/api/debug/me', requireAdmin, async (req, res) => {
    // Show secret info (only first few chars for security)
    const secretInfo = JWT_SECRET ? JWT_SECRET.substring(0, 10) + '...' : 'NOT SET';
    const envSecret = process.env.JWT_SECRET ? process.env.JWT_SECRET.substring(0, 10) + '...' : 'NOT SET';

    const token = req.query.token;
    if (!token) {
        // Try to get token from Authorization header
        const authHeader = req.headers['authorization'];
        const bearerToken = authHeader && authHeader.split(' ')[1];
        if (bearerToken) {
            try {
                const decoded = jwt.verify(bearerToken, JWT_SECRET);
                const isAdmin = decoded && (decoded.isAdmin === true || decoded.isAdmin === 1 || isAdminUsername(decoded.username));
                res.json({ user: decoded, isAdmin });
            } catch (err) {
                res.json({ error: 'Invalid token from header', detail: err.message, secretInfo, envSecret });
            }
            return;
        }
        return res.json({ error: 'No token provided', hint: 'Add ?token=YOUR_TOKEN', secretInfo, envSecret });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const isAdmin = decoded && (decoded.isAdmin === true || decoded.isAdmin === 1 || isAdminUsername(decoded.username));
        res.json({ user: decoded, isAdmin });
    } catch (err) {
        res.json({ error: 'Invalid token', detail: err.message, tokenPreview: token.substring(0, 50), secretInfo, envSecret });
    }
});

// Debug endpoint to list all users (admin only)
app.get('/api/debug/users', requireAdmin, async (req, res) => {
    try {
        await dbInit();
        const users = await query('SELECT id, username, display_name, is_admin, created_at FROM users ORDER BY id');
        res.json({ users });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Emergency: clear all matches and predictions (admin only)
app.get('/api/admin/clear-matches', requireAdmin, async (req, res) => {
    try {
        await dbInit();
        await pool.query('DELETE FROM predictions');
        await pool.query('DELETE FROM matches');
        res.json({ success: true, message: 'Todos los partidos y pronósticos han sido eliminados' });
    } catch (err) {
        console.error('Clear matches error:', err);
        res.status(500).json({ error: 'Error al eliminar partidos' });
    }
});

// Emergency: keep only GARRAS admin (admin only)
app.get('/api/admin/clean-users', requireAdmin, async (req, res) => {
    try {
        await dbInit();
        // Delete predictions from users being deleted
        await pool.query(`
            DELETE FROM predictions
            WHERE LOWER(player_name) NOT IN ('garras')
        `);
        // Delete all users except GARRAS
        await pool.query(`DELETE FROM users WHERE LOWER(username) != 'garras'`);
        res.json({ success: true, message: 'Usuarios eliminados (solo queda GARRAS)' });
    } catch (err) {
        console.error('Clean users error:', err);
        res.status(500).json({ error: 'Error al limpiar usuarios' });
    }
});


// ==================== API ROUTES ====================



// Get all matches
app.get('/api/matches', requireAuth, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json([]);
        const username = req.user.username;
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
        const username = req.user.username;
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
                WHERE LOWER(pr.player_name) = LOWER(p.username)
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

        const hg = parseInt(homeGoals);
        const ag = parseInt(awayGoals);
        if (isNaN(hg) || isNaN(ag) || hg < 0 || hg > 20 || ag < 0 || ag > 20) {
            return res.status(400).json({ error: 'Goles deben ser números entre 0 y 20' });
        }

        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });

        // Update match
        await pool.query(
            'UPDATE matches SET home_goals = $1, away_goals = $2, is_finished = 1 WHERE id = $3',
            [hg, ag, matchId]
        );

        // Calculate points for all predictions
        const predictions = await query('SELECT * FROM predictions WHERE match_id = $1', [matchId]);

        for (const pred of predictions) {
            const points = calculatePoints(pred.home_goals, pred.away_goals, hg, ag);
            await pool.query('UPDATE predictions SET points = $1 WHERE id = $2', [points, pred.id]);
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete match (admin only) — solo permitido si el partido NO está finalizado,
// para preservar los puntos ya sumados a la clasificación y el historial de usuarios.
app.delete('/api/matches/:id', requireAdmin, async (req, res) => {
    try {
        const matchId = parseInt(req.params.id);

        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });

        const match = await queryOne('SELECT is_finished FROM matches WHERE id = $1', [matchId]);
        if (!match) {
            return res.status(404).json({ error: 'Partido no encontrado' });
        }
        if (match.is_finished) {
            return res.status(400).json({
                error: 'No se puede eliminar un partido finalizado: se perderían los puntos de la clasificación y el historial de los usuarios.'
            });
        }

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
        const playerName = req.user.username;

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

        // Check if prediction already exists
        const userId = req.user.id;
        const existing = await queryOne(
            'SELECT id FROM predictions WHERE LOWER(player_name) = LOWER($1) AND match_id = $2',
            [playerName, matchId]
        );

        if (existing) {
            await pool.query(
                'UPDATE predictions SET home_goals = $1, away_goals = $2 WHERE id = $3',
                [homeGoalsNum, awayGoalsNum, existing.id]
            );
        } else {
            // Include user_id for legacy DB schemas that have this column
            try {
                await pool.query(
                    'INSERT INTO predictions (player_name, match_id, home_goals, away_goals, user_id) VALUES ($1, $2, $3, $4, $5)',
                    [playerName, matchId, homeGoalsNum, awayGoalsNum, userId]
                );
            } catch (insertErr) {
                // Fallback: try without user_id (for clean schemas)
                await pool.query(
                    'INSERT INTO predictions (player_name, match_id, home_goals, away_goals) VALUES ($1, $2, $3, $4)',
                    [playerName, matchId, homeGoalsNum, awayGoalsNum]
                );
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Prediction error:', err);
        res.status(500).json({ error: 'Error al guardar pronóstico' });
    }
});

// Get predictions for current user
app.get('/api/predictions', requireAuth, async (req, res) => {
    try {
        const playerName = req.user.username;

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
        pr.player_name as name,
        COALESCE(u.display_name, pr.player_name) as display_name,
        COALESCE(SUM(pr.points), 0) as total_points,
        COUNT(CASE WHEN pr.points = 5 THEN 1 END) as exact_predictions,
        COUNT(CASE WHEN pr.points IS NOT NULL THEN 1 END) as total_predictions
      FROM predictions pr
      LEFT JOIN users u ON LOWER(pr.player_name) = LOWER(u.username)
      GROUP BY pr.player_name, u.display_name
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

// List all users (admin only) — nunca devuelve password_hash
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json([]);
        const users = await query(
            'SELECT id, username, display_name, is_admin, created_at FROM users ORDER BY display_name ASC'
        );
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Ver contraseña en claro de un usuario (admin only)
// Solo funciona si el usuario se ha registrado / logueado / reseteado después de
// activar la columna password_encrypted. Los bcrypt antiguos no son recuperables.
app.get('/api/admin/users/:id/password', requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });

        let user;
        try {
            user = await queryOne('SELECT id, username, password_encrypted FROM users WHERE id = $1', [userId]);
        } catch (e) {
            return res.status(503).json({ error: 'Columna password_encrypted no disponible. Reinicia el servidor.' });
        }

        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        if (!user.password_encrypted) {
            return res.json({
                password: null,
                reason: 'no-capturada',
                message: 'Aún no tenemos la contraseña de este usuario en claro. Cuando haga login la próxima vez la capturaremos automáticamente. Si ha olvidado cuál era, resetéala.'
            });
        }

        const plain = decryptPassword(user.password_encrypted);
        if (plain === null) {
            return res.status(500).json({ error: 'Error al descifrar (clave cambiada?)' });
        }
        res.json({ password: plain });
    } catch (err) {
        console.error('View password error:', err);
        res.status(500).json({ error: 'Error al ver contraseña' });
    }
});

// Borrar usuario + todas sus predictions (admin only)
// Protecciones: no auto-borrado, no borrado de admins hardcodeados.
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });

        const target = await queryOne('SELECT id, username, display_name FROM users WHERE id = $1', [userId]);
        if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

        if (userId === req.user.id) {
            return res.status(400).json({ error: 'No puedes borrarte a ti mismo' });
        }
        if (isAdminUsername(target.username)) {
            return res.status(400).json({ error: `No se puede borrar al admin principal (${target.username})` });
        }

        // Borrado en dos pasos — predictions por player_name (case-insensitive) y luego el user
        const delPreds = await pool.query(
            'DELETE FROM predictions WHERE LOWER(player_name) = LOWER($1)',
            [target.username]
        );
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);

        res.json({
            success: true,
            username: target.username,
            displayName: target.display_name,
            deletedPredictions: delPreds.rowCount || 0
        });
    } catch (err) {
        console.error('Delete user error:', err);
        res.status(500).json({ error: 'Error al borrar usuario' });
    }
});

// Cambiar display_name de un usuario (admin only)
app.put('/api/admin/users/:id/display-name', requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { displayName } = req.body;

        if (!displayName || typeof displayName !== 'string' || displayName.trim().length < 2) {
            return res.status(400).json({ error: 'El nombre debe tener al menos 2 caracteres' });
        }
        if (displayName.length > 30) {
            return res.status(400).json({ error: 'El nombre no puede tener más de 30 caracteres' });
        }

        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });

        const target = await queryOne('SELECT id, username FROM users WHERE id = $1', [userId]);
        if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

        await pool.query('UPDATE users SET display_name = $1 WHERE id = $2', [displayName.trim(), userId]);

        res.json({ success: true, username: target.username, displayName: displayName.trim() });
    } catch (err) {
        console.error('Rename error:', err);
        res.status(500).json({ error: 'Error al cambiar el nombre' });
    }
});

// Reset a user's password (admin only) — el admin escribe la nueva contraseña
app.put('/api/admin/users/:id/password', requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { newPassword } = req.body;

        if (!newPassword || typeof newPassword !== 'string') {
            return res.status(400).json({ error: 'La contraseña no puede estar vacía' });
        }

        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });

        const target = await queryOne('SELECT id, username FROM users WHERE id = $1', [userId]);
        if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(newPassword, salt);
        const encrypted = encryptPassword(newPassword);

        try {
            await pool.query('UPDATE users SET password_hash = $1, password_encrypted = $2 WHERE id = $3', [passwordHash, encrypted, userId]);
        } catch (e) {
            await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
        }

        res.json({ success: true, username: target.username });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: 'Error al cambiar la contraseña' });
    }
});

// Get all predictions for a specific match (admin only)
app.get('/api/admin/matches/:id/predictions', requireAdmin, async (req, res) => {
    try {
        const matchId = parseInt(req.params.id);
        if (!IS_POSTGRES) return res.json([]);

        const predictions = await query(
            `SELECT id, player_name, home_goals, away_goals, points, created_at
             FROM predictions
             WHERE match_id = $1
             ORDER BY player_name ASC`,
            [matchId]
        );

        res.json(predictions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete a single prediction by ID (admin only)
app.delete('/api/admin/predictions/:id', requireAdmin, async (req, res) => {
    try {
        const predId = parseInt(req.params.id);
        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });

        const deleted = await pool.query(
            'DELETE FROM predictions WHERE id = $1 RETURNING id, player_name',
            [predId]
        );

        if (deleted.rows.length === 0) {
            return res.status(404).json({ error: 'Pronóstico no encontrado' });
        }

        res.json({ success: true, deleted: deleted.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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
