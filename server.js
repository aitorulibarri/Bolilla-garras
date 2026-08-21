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
if (!process.env.JWT_SECRET) {
    console.warn('⚠️  JWT_SECRET no configurado en env. Usando valor por defecto. Configura JWT_SECRET en Vercel para mayor seguridad.');
}
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
    max: 300,
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
        ssl: { rejectUnauthorized: false },
        max: 3,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 15000, // Neon free tier puede tardar ~10s en despertar
    });
    console.log('✅ PostgreSQL configured');
}

// Lazy database initialization - runs once, awaited before any query
// Retries up to 3 times to handle Neon cold-start latency
async function dbInit() {
    if (dbReady) return;
    if (dbInitPromise) return dbInitPromise;

    dbInitPromise = (async () => {
        for (let attempt = 1; attempt <= 3; attempt++) {
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

            // ==================== GARRAS SARIA TABLES ====================
            await pool.query(`
                CREATE TABLE IF NOT EXISTS garras_players (
                    id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL,
                    category TEXT NOT NULL CHECK (category IN ('masculino','femenino')),
                    dorsal INTEGER,
                    active INTEGER DEFAULT 1
                );
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS garras_jornadas (
                    id SERIAL PRIMARY KEY,
                    numero INTEGER NOT NULL,
                    label TEXT,
                    is_open INTEGER DEFAULT 0,
                    is_finished INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS garras_votes (
                    id SERIAL PRIMARY KEY,
                    username TEXT NOT NULL,
                    jornada_id INTEGER NOT NULL REFERENCES garras_jornadas(id) ON DELETE CASCADE,
                    player_id INTEGER NOT NULL REFERENCES garras_players(id),
                    category TEXT NOT NULL CHECK (category IN ('masculino','femenino')),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(username, jornada_id, category)
                );
            `);

            // ==================== MVP VOTING TABLES ====================
            await pool.query(`
                CREATE TABLE IF NOT EXISTS match_mvp_votes (
                    id SERIAL PRIMARY KEY,
                    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
                    username TEXT NOT NULL,
                    player_id INTEGER NOT NULL REFERENCES garras_players(id),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(match_id, username)
                );
            `);
            await pool.query(`
                CREATE TABLE IF NOT EXISTS match_mvp_players (
                    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
                    player_id INTEGER NOT NULL REFERENCES garras_players(id),
                    PRIMARY KEY(match_id, player_id)
                );
            `);
            try {
                await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS mvp_voting_open INTEGER DEFAULT 0`);
            } catch (e) { /* ignore if exists */ }

            // Roster masculino canónico (dorsales verificados en athletic-club.eus, temporada 2026-27).
            // Usado tanto para el seed inicial (tabla vacía) como para el sync idempotente de abajo
            // (que corrige dorsales/altas/bajas en una DB ya poblada, ya que no hay CRUD admin para garras_players).
            const MASCULINO_ROSTER = [
                { name: 'Unai Simón', dorsal: 1 },
                { name: 'Andoni Gorosabel', dorsal: 2 },
                { name: 'Dani Vivian', dorsal: 3 },
                { name: 'Aitor Paredes', dorsal: 4 },
                { name: 'Yeray Álvarez', dorsal: 5 },
                { name: 'Beñat Prados', dorsal: 6 },
                { name: 'Alex Berenguer', dorsal: 7 },
                { name: 'Oihan Sancet', dorsal: 8 },
                { name: 'Iñaki Williams', dorsal: 9 },
                { name: 'Nico Williams', dorsal: 10 },
                { name: 'Gorka Guruzeta', dorsal: 11 },
                { name: 'Jesús Areso', dorsal: 12 },
                { name: 'Alex Padilla', dorsal: 13 },
                { name: 'Aymeric Laporte', dorsal: 14 },
                { name: 'Hugo Rincón', dorsal: 15 },
                { name: 'Iñigo R. De Galarreta', dorsal: 16 },
                { name: 'Yuri Berchiche', dorsal: 17 },
                { name: 'Mikel Jauregizar', dorsal: 18 },
                { name: 'Adama Boiro', dorsal: 19 },
                { name: 'Alejandro Rego', dorsal: 20 },
                { name: 'Maroan Sannadi', dorsal: 21 },
                { name: 'Nico Serrano', dorsal: 22 },
                { name: 'Robert Navarro', dorsal: 23 },
                { name: 'Beñat Gerenabarrena', dorsal: 24 },
                { name: 'Álvaro Djaló', dorsal: 25 },
                { name: 'Peio Canales', dorsal: 28 },
                // Central del primer equipo, de baja por lesión de rodilla — sin dorsal asignado
                // en este tramo de temporada (ver nota oficial citada abajo)
                { name: 'Unai Egiluz', dorsal: null },
                // Jugadores del Bilbao Athletic inscritos en LaLiga con el primer equipo
                // (dorsales oficiales: ver "Dorsales del Athletic Club 2026/27", athletic-club.eus 17/08/2026)
                { name: 'Mikel Santos', dorsal: 26 },
                { name: 'Elijah Gift', dorsal: 27 },
                { name: 'Asier Hierro', dorsal: 29 },
                { name: 'Iker Monreal', dorsal: 30 },
                { name: 'Johaneko Louis-Jean', dorsal: 31 },
                { name: 'Selton Sánchez', dorsal: 44 }
            ];

            // Seed players if table is empty (use pool.query directly — queryOne calls dbInit which would deadlock)
            const playerCountResult = await pool.query('SELECT COUNT(*) as count FROM garras_players');
            if (parseInt(playerCountResult.rows[0].count) === 0) {
                for (const p of MASCULINO_ROSTER) {
                    await pool.query('INSERT INTO garras_players (name, category, dorsal) VALUES ($1, $2, $3)', [p.name, 'masculino', p.dorsal]);
                }
                const femeninoPlayers = [
                    { name: 'Olatz Santana Amado', dorsal: 1 },
                    { name: 'Adriana Nanclares Romero', dorsal: 13 },
                    { name: 'Ziara Vega Uribarri', dorsal: 26 },
                    { name: 'Maddi Torre Larrañaga', dorsal: 2 },
                    { name: 'Naia Landaluze Marquínez', dorsal: 3 },
                    { name: 'Bibiane Schulze Solano', dorsal: 4 },
                    { name: 'Nerea Nevado Gómez', dorsal: 17 },
                    { name: 'Ane Elexpuru Añorga', dorsal: 20 },
                    { name: 'Eider Arana Mugueta', dorsal: 23 },
                    { name: 'Nerea Benito Zaldibar', dorsal: 27 },
                    { name: 'Laida Balerdi Beloki', dorsal: 28 },
                    { name: 'Irati Alfaro Nagore', dorsal: 32 },
                    { name: 'Maite Valero Elía', dorsal: 5 },
                    { name: 'Irene Oguiza Martínez', dorsal: 6 },
                    { name: 'Maite Zubieta Aranbarri', dorsal: 8 },
                    { name: 'Leire Baños Indakoetxea', dorsal: 14 },
                    { name: 'Clara Pinedo Castresana', dorsal: 15 },
                    { name: 'Alejandra Estefanía Díaz', dorsal: 16 },
                    { name: 'Ane Bordagaray Casado', dorsal: 34 },
                    { name: 'Jone Amezaga Martínez', dorsal: 7 },
                    { name: 'Patricia Zugasti Oses', dorsal: 10 },
                    { name: 'Ane Azkona Fuente', dorsal: 11 },
                    { name: 'Sara Ortega Ruiz', dorsal: 18 },
                    { name: 'Maitane Vilariño Mendinueta', dorsal: 19 },
                    { name: 'Ane Campos Andueza', dorsal: 21 },
                    { name: 'Daniela Agote Helguera', dorsal: 22 },
                    { name: 'Oihana Agirregomezkorta García', dorsal: 29 },
                    { name: 'Elene Gurtubay Loyo', dorsal: 33 }
                ];
                for (const p of femeninoPlayers) {
                    await pool.query('INSERT INTO garras_players (name, category, dorsal) VALUES ($1, $2, $3)', [p.name, 'femenino', p.dorsal]);
                }
                console.log('✅ Garras players seeded');
            } else {
                // Tabla ya poblada (producción): sincroniza altas/bajas/dorsales del roster masculino
                // en cada arranque. Idempotente — no hay endpoint admin para editar garras_players a mano.
                for (const p of MASCULINO_ROSTER) {
                    const existing = await pool.query(
                        'SELECT id FROM garras_players WHERE category = $1 AND LOWER(name) = LOWER($2)',
                        ['masculino', p.name]
                    );
                    if (existing.rows.length > 0) {
                        await pool.query(
                            'UPDATE garras_players SET dorsal = $1, active = 1 WHERE id = $2',
                            [p.dorsal, existing.rows[0].id]
                        );
                    } else {
                        await pool.query(
                            'INSERT INTO garras_players (name, category, dorsal, active) VALUES ($1, $2, $3, 1)',
                            [p.name, 'masculino', p.dorsal]
                        );
                    }
                }
                // Baja: Mikel Vesga ya no está en la plantilla. Soft-delete (active=0) para conservar
                // su histórico en match_mvp_votes / match_mvp_players (FK a garras_players.id).
                await pool.query(
                    `UPDATE garras_players SET active = 0 WHERE category = 'masculino' AND LOWER(name) = LOWER('Mikel Vesga')`
                );
            }

            dbReady = true;
            console.log('✅ Tables initialized');
            return;
        } catch (err) {
            console.error(`DB init attempt ${attempt}/3 failed:`, err.message);
            if (attempt < 3) {
                await new Promise(r => setTimeout(r, 2000 * attempt));
            } else {
                dbInitPromise = null; // Allow retry on next incoming request
                throw err;
            }
        }
        } // end for
    })();

    return dbInitPromise;
}

// Warm up DB connection proactively on server start (non-blocking)
// Reduces first-request latency by pre-establishing the Neon connection
if (IS_POSTGRES) {
    dbInit().catch(err => console.error('Proactive DB warm-up failed:', err.message));
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
        if (displayName.length > 30) {
            return res.status(400).json({ error: 'El nombre no puede tener más de 30 caracteres' });
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

// Reset de temporada: borra pronósticos de partidos finalizados (admin only)
// Los pronósticos pendientes (is_finished=0) se conservan.
// Usar al inicio de cada temporada o para limpiar el historial de prueba.
app.post('/api/admin/reset-season', requireAdmin, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });
        const result = await pool.query(`
            DELETE FROM predictions
            WHERE match_id IN (SELECT id FROM matches WHERE is_finished = 1)
        `);
        res.json({
            success: true,
            deleted: result.rowCount,
            message: `${result.rowCount} pronósticos de partidos finalizados eliminados. Los pronósticos pendientes se conservan.`
        });
    } catch (err) {
        console.error('Reset season error:', err);
        res.status(500).json({ error: 'Error al resetear temporada' });
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

// Reset completo de temporada: borra partidos, pronósticos y MVP para empezar de cero
// (admin only). A diferencia de reset-season (solo pronósticos de partidos finalizados)
// y clear-matches (partidos+pronósticos), este también limpia Garras Saria.
// Users y garras_players (roster) se conservan intactos.
app.post('/api/admin/reset-full-season', requireAdmin, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });
        await dbInit();
        const mvpVotes = await pool.query('DELETE FROM match_mvp_votes');
        const mvpPlayers = await pool.query('DELETE FROM match_mvp_players');
        const predictions = await pool.query('DELETE FROM predictions');
        const matches = await pool.query('DELETE FROM matches');
        console.log(`Reset full season ejecutado por ${req.user.username} — matches: ${matches.rowCount}, predictions: ${predictions.rowCount}, mvp_votes: ${mvpVotes.rowCount}, mvp_players: ${mvpPlayers.rowCount}`);
        res.json({
            success: true,
            deleted: {
                matches: matches.rowCount,
                predictions: predictions.rowCount,
                mvp_votes: mvpVotes.rowCount,
                mvp_players: mvpPlayers.rowCount
            },
            message: 'Temporada reseteada: partidos, pronósticos y votaciones de Garras Saria eliminados. Usuarios y jugadores conservados.'
        });
    } catch (err) {
        console.error('Reset full season error:', err);
        res.status(500).json({ error: 'Error al resetear la temporada' });
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
            ORDER BY
                CASE m.team
                    WHEN 'Athletic Club' THEN 1
                    WHEN 'Athletic Femenino' THEN 2
                    WHEN 'Bilbao Athletic' THEN 3
                    ELSE 4
                END,
                m.match_date ASC
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
            LIMIT 200
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

        // Check deadline (deadline stored as Madrid time, compare consistently in DB)
        const match = await queryOne(
            `SELECT id, (NOW() AT TIME ZONE 'Europe/Madrid') > deadline AS past_deadline FROM matches WHERE id = $1`,
            [matchId]
        );
        if (!match) return res.status(404).json({ error: 'Partido no encontrado' });
        if (match.past_deadline) {
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

// Get leaderboard detail (per-prediction breakdown, finished matches only)
app.get('/api/leaderboard/detail', requireAuth, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json([]);
        const lastJornada = req.query.last_jornada === '1';
        const weekFilter = lastJornada
            ? `AND m.match_date >= (SELECT MAX(match_date) - INTERVAL '2 days' FROM matches WHERE is_finished = 1)`
            : '';
        const rows = await query(`
            SELECT
                pr.player_name,
                COALESCE(u.display_name, pr.player_name) as display_name,
                m.team, m.opponent, m.is_home, m.match_date,
                pr.home_goals as pred_home, pr.away_goals as pred_away,
                m.home_goals as real_home, m.away_goals as real_away,
                COALESCE(pr.points, 0) as points
            FROM predictions pr
            JOIN matches m ON pr.match_id = m.id
            LEFT JOIN users u ON LOWER(pr.player_name) = LOWER(u.username)
            WHERE m.is_finished = 1 ${weekFilter}
            ORDER BY COALESCE(u.display_name, pr.player_name),
                     CASE m.team
                         WHEN 'Athletic Club' THEN 1
                         WHEN 'Athletic Femenino' THEN 2
                         WHEN 'Bilbao Athletic' THEN 3
                         ELSE 4
                     END,
                     m.match_date ASC
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get leaderboard
app.get('/api/leaderboard', requireAuth, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json([]);

        const leaderboard = await query(`
      SELECT
        u.username as name,
        u.display_name,
        COALESCE(SUM(pr.points), 0) as total_points,
        COUNT(CASE WHEN pr.points = 5 THEN 1 END) as exact_predictions,
        COUNT(CASE WHEN pr.points IS NOT NULL THEN 1 END) as total_predictions
      FROM users u
      LEFT JOIN predictions pr ON LOWER(pr.player_name) = LOWER(u.username)
      GROUP BY u.username, u.display_name
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

// Seguimiento: pronósticos por partido abierto (admin only)
// Para cada partido is_finished=0, devuelve quién ha pronosticado y quién falta.
app.get('/api/admin/open-predictions', requireAdmin, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json({ matches: [] });

        const matches = await query(`
            SELECT id, team, opponent, is_home, match_date, deadline
            FROM matches
            WHERE is_finished = 0
            ORDER BY
                CASE team
                    WHEN 'Athletic Club' THEN 1
                    WHEN 'Athletic Femenino' THEN 2
                    WHEN 'Bilbao Athletic' THEN 3
                    ELSE 4
                END,
                match_date ASC
        `);

        const allUsers = await query('SELECT username, display_name FROM users ORDER BY display_name ASC');

        const result = [];
        for (const m of matches) {
            const preds = await query(`
                SELECT p.player_name, p.home_goals, p.away_goals,
                       COALESCE(u.display_name, p.player_name) AS display_name
                FROM predictions p
                LEFT JOIN users u ON LOWER(u.username) = LOWER(p.player_name)
                WHERE p.match_id = $1
                ORDER BY display_name ASC
            `, [m.id]);

            const deadlineRow = await queryOne(
                `SELECT (NOW() AT TIME ZONE 'Europe/Madrid') > deadline AS passed FROM matches WHERE id = $1`,
                [m.id]
            );

            const predictedSet = new Set(preds.map(p => p.player_name.toLowerCase()));
            const missing = allUsers.filter(u => !predictedSet.has(u.username.toLowerCase()));

            result.push({
                id: m.id,
                team: m.team,
                opponent: m.opponent,
                is_home: m.is_home,
                match_date: m.match_date,
                deadline: m.deadline,
                deadline_passed: deadlineRow?.passed ?? false,
                predictions: preds.map(p => ({
                    username: p.player_name,
                    display_name: p.display_name,
                    home_goals: p.home_goals,
                    away_goals: p.away_goals
                })),
                missing: missing.map(u => ({ username: u.username, display_name: u.display_name }))
            });
        }

        res.json({ matches: result, totalUsers: allUsers.length });
    } catch (err) {
        console.error('Open predictions error:', err);
        res.status(500).json({ error: err.message });
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

// ==================== GARRAS SARIA API ====================

// GET /api/garras/players — list active players, optionally filtered by category
app.get('/api/garras/players', requireAuth, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json([]);
        const { category } = req.query;
        let rows;
        if (category && ['masculino', 'femenino'].includes(category)) {
            rows = await query('SELECT * FROM garras_players WHERE active = 1 AND category = $1 ORDER BY name ASC', [category]);
        } else {
            rows = await query('SELECT * FROM garras_players WHERE active = 1 ORDER BY category ASC, name ASC');
        }
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/garras/jornadas — list all jornadas
app.get('/api/garras/jornadas', requireAuth, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json([]);
        const rows = await query('SELECT * FROM garras_jornadas ORDER BY numero DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/garras/jornadas/active — currently open jornada + user vote status
app.get('/api/garras/jornadas/active', requireAuth, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json(null);
        const jornada = await queryOne('SELECT * FROM garras_jornadas WHERE is_open = 1 LIMIT 1');
        if (!jornada) return res.json(null);

        const username = req.user.username;
        const votes = await query(
            'SELECT gv.category, gv.player_id, gp.name as player_name FROM garras_votes gv JOIN garras_players gp ON gv.player_id = gp.id WHERE gv.username = $1 AND gv.jornada_id = $2',
            [username, jornada.id]
        );
        const userVotes = {};
        for (const v of votes) {
            userVotes[v.category] = { player_id: v.player_id, player_name: v.player_name };
        }
        res.json({ ...jornada, userVotes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/garras/jornadas/:id/results — vote counts for a finished or open jornada
app.get('/api/garras/jornadas/:id/results', requireAuth, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json([]);
        const jornadaId = parseInt(req.params.id);
        const jornada = await queryOne('SELECT * FROM garras_jornadas WHERE id = $1', [jornadaId]);
        if (!jornada) return res.status(404).json({ error: 'Jornada no encontrada' });

        const results = await query(`
            SELECT gp.id, gp.name, gp.category, COUNT(gv.id) as votes
            FROM garras_players gp
            LEFT JOIN garras_votes gv ON gp.id = gv.player_id AND gv.jornada_id = $1
            WHERE gp.active = 1
            GROUP BY gp.id, gp.name, gp.category
            ORDER BY gp.category ASC, votes DESC, gp.name ASC
        `, [jornadaId]);

        res.json({ jornada, results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/garras/ranking — season ranking: jornadas won per player
app.get('/api/garras/ranking', requireAuth, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json({ masculino: [], femenino: [] });

        // For each finished jornada, the player with the most votes in each category scores 1 point
        const rows = await query(`
            WITH vote_counts AS (
                SELECT gv.jornada_id, gv.player_id, gv.category, COUNT(*) as votes
                FROM garras_votes gv
                JOIN garras_jornadas gj ON gv.jornada_id = gj.id
                WHERE gj.is_finished = 1
                GROUP BY gv.jornada_id, gv.player_id, gv.category
            ),
            max_per_jornada AS (
                SELECT jornada_id, category, MAX(votes) as max_votes
                FROM vote_counts
                GROUP BY jornada_id, category
            ),
            winners AS (
                SELECT vc.player_id, vc.category, COUNT(*) as jornadas_won, SUM(vc.votes) as total_votes
                FROM vote_counts vc
                JOIN max_per_jornada mpj ON vc.jornada_id = mpj.jornada_id AND vc.category = mpj.category AND vc.votes = mpj.max_votes
                GROUP BY vc.player_id, vc.category
            )
            SELECT gp.name, gp.category, COALESCE(w.jornadas_won, 0) as jornadas_won, COALESCE(w.total_votes, 0) as total_votes
            FROM garras_players gp
            LEFT JOIN winners w ON gp.id = w.player_id AND gp.category = w.category
            WHERE gp.active = 1 AND (w.jornadas_won > 0)
            ORDER BY gp.category ASC, jornadas_won DESC, total_votes DESC
        `);

        const masculino = rows.filter(r => r.category === 'masculino');
        const femenino = rows.filter(r => r.category === 'femenino');
        res.json({ masculino, femenino });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/garras/vote — submit a vote
app.post('/api/garras/vote', requireAuth, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });
        const { jornada_id, player_id, category } = req.body;
        const username = req.user.username;

        if (!jornada_id || !player_id || !['masculino', 'femenino'].includes(category)) {
            return res.status(400).json({ error: 'Datos incompletos o categoría inválida' });
        }

        const jornada = await queryOne('SELECT is_open FROM garras_jornadas WHERE id = $1', [jornada_id]);
        if (!jornada) return res.status(404).json({ error: 'Jornada no encontrada' });
        if (!jornada.is_open) return res.status(400).json({ error: 'La votación no está abierta' });

        const player = await queryOne('SELECT id, category FROM garras_players WHERE id = $1 AND active = 1', [player_id]);
        if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });
        if (player.category !== category) return res.status(400).json({ error: 'El jugador no pertenece a la categoría indicada' });

        // Upsert vote
        const existing = await queryOne(
            'SELECT id FROM garras_votes WHERE username = $1 AND jornada_id = $2 AND category = $3',
            [username, jornada_id, category]
        );
        if (existing) {
            await pool.query('UPDATE garras_votes SET player_id = $1 WHERE id = $2', [player_id, existing.id]);
        } else {
            await pool.query(
                'INSERT INTO garras_votes (username, jornada_id, player_id, category) VALUES ($1, $2, $3, $4)',
                [username, jornada_id, player_id, category]
            );
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Garras vote error:', err);
        res.status(500).json({ error: 'Error al guardar voto' });
    }
});

// POST /api/garras/jornadas — create jornada (admin)
app.post('/api/garras/jornadas', requireAdmin, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });
        const { numero, label } = req.body;
        if (!numero) return res.status(400).json({ error: 'El número de jornada es obligatorio' });

        const result = await pool.query(
            'INSERT INTO garras_jornadas (numero, label) VALUES ($1, $2) RETURNING *',
            [parseInt(numero), label || null]
        );
        res.json({ success: true, jornada: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/garras/jornadas/:id/open — open a jornada (admin)
app.put('/api/garras/jornadas/:id/open', requireAdmin, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });
        const jornadaId = parseInt(req.params.id);

        // Only one jornada can be open at a time
        const alreadyOpen = await queryOne('SELECT id, numero FROM garras_jornadas WHERE is_open = 1');
        if (alreadyOpen && alreadyOpen.id !== jornadaId) {
            return res.status(400).json({ error: `La jornada ${alreadyOpen.numero} ya está abierta. Ciérrala primero.` });
        }

        await pool.query('UPDATE garras_jornadas SET is_open = 1, is_finished = 0 WHERE id = $1', [jornadaId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/garras/jornadas/:id/close — close a jornada (admin)
app.put('/api/garras/jornadas/:id/close', requireAdmin, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });
        const jornadaId = parseInt(req.params.id);
        await pool.query('UPDATE garras_jornadas SET is_open = 0, is_finished = 1 WHERE id = $1', [jornadaId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/garras/jornadas/:id — delete jornada (admin, only if no votes)
app.delete('/api/garras/jornadas/:id', requireAdmin, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });
        const jornadaId = parseInt(req.params.id);

        const voteCount = await queryOne('SELECT COUNT(*) as count FROM garras_votes WHERE jornada_id = $1', [jornadaId]);
        if (parseInt(voteCount.count) > 0) {
            return res.status(400).json({ error: 'No se puede eliminar una jornada con votos registrados' });
        }

        await pool.query('DELETE FROM garras_jornadas WHERE id = $1', [jornadaId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/garras/admin/jornadas — list all jornadas with vote counts (admin)
app.get('/api/garras/admin/jornadas', requireAdmin, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json([]);
        const rows = await query(`
            SELECT gj.*,
                COUNT(CASE WHEN gv.category = 'masculino' THEN 1 END) as votes_masc,
                COUNT(CASE WHEN gv.category = 'femenino' THEN 1 END) as votes_fem
            FROM garras_jornadas gj
            LEFT JOIN garras_votes gv ON gj.id = gv.jornada_id
            GROUP BY gj.id
            ORDER BY gj.numero DESC
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/ping — keep-warm: mantiene Neon y la función serverless activos
app.get('/api/ping', async (req, res) => {
    try {
        if (IS_POSTGRES) await queryOne('SELECT 1 AS ok');
        res.json({ ok: true, ts: Date.now() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ==================== MVP VOTING (MEJOR JUGADOR DEL PARTIDO) ====================

// GET /api/mvp/active — open matches + available players + user's vote
app.get('/api/mvp/active', requireAuth, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json([]);
        const username = req.user.username;
        const matches = await query(`
            SELECT id, team, opponent, is_home, match_date
            FROM matches
            WHERE mvp_voting_open = 1
              AND team IN ('Athletic Club', 'Athletic Femenino')
            ORDER BY match_date DESC
        `);
        const result = [];
        for (const match of matches) {
            const category = match.team === 'Athletic Club' ? 'masculino' : 'femenino';
            let players;
            if (category === 'masculino') {
                players = await query(`SELECT id, name, dorsal FROM garras_players WHERE active = 1 AND category = 'masculino' ORDER BY name ASC`);
            } else {
                players = await query(`
                    SELECT gp.id, gp.name, gp.dorsal
                    FROM garras_players gp
                    JOIN match_mvp_players mmp ON gp.id = mmp.player_id
                    WHERE mmp.match_id = $1
                    ORDER BY gp.name ASC
                `, [match.id]);
            }
            const userVote = await queryOne(`
                SELECT mmv.player_id, gp.name AS player_name
                FROM match_mvp_votes mmv
                JOIN garras_players gp ON mmv.player_id = gp.id
                WHERE mmv.match_id = $1 AND mmv.username = $2
            `, [match.id, username]);
            result.push({ ...match, category, players, userVote: userVote || null });
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/mvp/:id/vote — cast or update vote
app.post('/api/mvp/:id/vote', requireAuth, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });
        const matchId = parseInt(req.params.id);
        const { player_id } = req.body;
        const username = req.user.username;
        if (!player_id) return res.status(400).json({ error: 'Falta player_id' });
        const match = await queryOne('SELECT mvp_voting_open, team FROM matches WHERE id = $1', [matchId]);
        if (!match) return res.status(404).json({ error: 'Partido no encontrado' });
        if (!match.mvp_voting_open) return res.status(400).json({ error: 'La votación no está abierta' });
        const player = await queryOne('SELECT id FROM garras_players WHERE id = $1 AND active = 1', [parseInt(player_id)]);
        if (!player) return res.status(400).json({ error: 'Jugador/a no válido/a' });
        if (match.team === 'Athletic Femenino') {
            const allowed = await queryOne('SELECT 1 FROM match_mvp_players WHERE match_id = $1 AND player_id = $2', [matchId, parseInt(player_id)]);
            if (!allowed) return res.status(400).json({ error: 'Jugadora no disponible para este partido' });
        }
        const existing = await queryOne('SELECT id FROM match_mvp_votes WHERE match_id = $1 AND username = $2', [matchId, username]);
        if (existing) {
            await pool.query('UPDATE match_mvp_votes SET player_id = $1 WHERE id = $2', [parseInt(player_id), existing.id]);
        } else {
            await pool.query('INSERT INTO match_mvp_votes (match_id, username, player_id) VALUES ($1, $2, $3)', [matchId, username, parseInt(player_id)]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/mvp/history — closed matches with vote results
app.get('/api/mvp/history', requireAuth, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json([]);
        const matches = await query(`
            SELECT m.id, m.team, m.opponent, m.is_home, m.match_date,
                   COUNT(mmv.id) AS total_votes
            FROM matches m
            JOIN match_mvp_votes mmv ON m.id = mmv.match_id
            WHERE m.mvp_voting_open = 0
              AND m.team IN ('Athletic Club', 'Athletic Femenino')
            GROUP BY m.id
            ORDER BY m.match_date DESC
            LIMIT 20
        `);
        const result = [];
        for (const match of matches) {
            const results = await query(`
                SELECT gp.id, gp.name, COUNT(mmv.id) AS votes
                FROM match_mvp_votes mmv
                JOIN garras_players gp ON mmv.player_id = gp.id
                WHERE mmv.match_id = $1
                GROUP BY gp.id, gp.name
                ORDER BY votes DESC, gp.name ASC
            `, [match.id]);
            result.push({ ...match, results });
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/mvp/ranking — season ranking by matches won + total votes
app.get('/api/mvp/ranking', requireAuth, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json({ masculino: [], femenino: [] });
        const rows = await query(`
            WITH vote_counts AS (
                SELECT mmv.match_id, mmv.player_id, COUNT(*) AS votes
                FROM match_mvp_votes mmv
                JOIN matches m ON mmv.match_id = m.id
                WHERE m.mvp_voting_open = 0
                GROUP BY mmv.match_id, mmv.player_id
            ),
            match_max AS (
                SELECT match_id, MAX(votes) AS max_votes
                FROM vote_counts GROUP BY match_id
            ),
            winners AS (
                SELECT vc.player_id, COUNT(*) AS partidos_ganados
                FROM vote_counts vc
                JOIN match_max mm ON vc.match_id = mm.match_id AND vc.votes = mm.max_votes
                GROUP BY vc.player_id
            ),
            totals AS (
                SELECT player_id, SUM(votes) AS total_votes
                FROM vote_counts GROUP BY player_id
            )
            SELECT gp.id, gp.name, gp.category,
                   COALESCE(w.partidos_ganados, 0) AS partidos_ganados,
                   COALESCE(t.total_votes, 0) AS total_votes
            FROM garras_players gp
            JOIN totals t ON gp.id = t.player_id
            LEFT JOIN winners w ON gp.id = w.player_id
            ORDER BY partidos_ganados DESC, total_votes DESC, gp.name ASC
        `);
        res.json({
            masculino: rows.filter(r => r.category === 'masculino'),
            femenino: rows.filter(r => r.category === 'femenino')
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/mvp/admin/matches — recent matches for admin MVP panel
app.get('/api/mvp/admin/matches', requireAdmin, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.json([]);
        const rows = await query(`
            SELECT m.id, m.team, m.opponent, m.is_home, m.match_date, m.mvp_voting_open,
                   COUNT(mmv.id) AS vote_count
            FROM matches m
            LEFT JOIN match_mvp_votes mmv ON m.id = mmv.match_id
            WHERE m.team IN ('Athletic Club', 'Athletic Femenino')
            GROUP BY m.id
            ORDER BY m.match_date DESC
            LIMIT 30
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/mvp/admin/:id/open — open MVP voting (femenino requires player_ids)
app.put('/api/mvp/admin/:id/open', requireAdmin, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });
        const matchId = parseInt(req.params.id);
        const { player_ids } = req.body;
        const match = await queryOne('SELECT id, team FROM matches WHERE id = $1', [matchId]);
        if (!match) return res.status(404).json({ error: 'Partido no encontrado' });
        if (match.team === 'Athletic Femenino') {
            if (!Array.isArray(player_ids) || player_ids.length === 0)
                return res.status(400).json({ error: 'Selecciona al menos una jugadora' });
            const parsedIds = player_ids.map(pid => parseInt(pid)).filter(pid => !isNaN(pid));
            if (parsedIds.length === 0)
                return res.status(400).json({ error: 'IDs de jugadoras inválidos' });
            const playerRows = await query(
                `SELECT id FROM garras_players WHERE id = ANY($1) AND category = 'femenino' AND active = 1`,
                [parsedIds]
            );
            if (playerRows.length !== parsedIds.length)
                return res.status(400).json({ error: 'Una o más jugadoras no son válidas o no pertenecen al equipo femenino' });
            await pool.query('DELETE FROM match_mvp_players WHERE match_id = $1', [matchId]);
            for (const pid of parsedIds)
                await pool.query('INSERT INTO match_mvp_players (match_id, player_id) VALUES ($1, $2)', [matchId, pid]);
        }
        await pool.query('UPDATE matches SET mvp_voting_open = 1 WHERE id = $1', [matchId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/mvp/admin/:id/close — close MVP voting
app.put('/api/mvp/admin/:id/close', requireAdmin, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });
        const matchId = parseInt(req.params.id);
        await pool.query('UPDATE matches SET mvp_voting_open = 0 WHERE id = $1', [matchId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/mvp/admin/:id/votes — reset all votes for a match (admin)
app.delete('/api/mvp/admin/:id/votes', requireAdmin, async (req, res) => {
    try {
        if (!IS_POSTGRES) return res.status(500).json({ error: 'No database' });
        const matchId = parseInt(req.params.id);
        if (isNaN(matchId)) return res.status(400).json({ error: 'ID inválido' });
        const match = await queryOne('SELECT id FROM matches WHERE id = $1', [matchId]);
        if (!match) return res.status(404).json({ error: 'Partido no encontrado' });
        const result = await pool.query('DELETE FROM match_mvp_votes WHERE match_id = $1', [matchId]);
        res.json({ success: true, deleted: result.rowCount });
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
