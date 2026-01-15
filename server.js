require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const db = require('./database');

// Session Stores
const pgSession = require('connect-pg-simple')(session);
// const SqliteStore = require('better-sqlite3-session-store')(session); 
// Note: We use MemoryStore for local default to avoid complexity if better-sqlite3-session-store isn't compiled. 
// If user wants local persistence, they can uncomment and configure. For now, Postgres is the priority.

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

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
app.use(morgan('dev')); // Logging

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api', limiter); // Apply to API routes

// Standard Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session Configuration
let sessionStore;
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (connectionString) {
    // Production / Vercel with Postgres
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: connectionString,
        ssl: { rejectUnauthorized: false }
    });
    sessionStore = new pgSession({
        pool: pool,
        tableName: 'session'
    });
} else {
    // Local Development
    // Using MemoryStore by default for simplicity. 
    // To use SQLite persistence locally, install 'better-sqlite3-session-store' and configure here.
    sessionStore = new session.MemoryStore();
}

app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'bolilla-garras-secret-key-2025',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        secure: IS_PRODUCTION, // True in production (HTTPS)
        httpOnly: true
    }
}));

// Middleware de autenticación
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: 'No autenticado' });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user || !req.session.user.isAdmin) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    next();
}

// ==================== AUTH ROUTES ====================

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await db.validateUser(username, password);

        if (!user) {
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        }

        req.session.user = user;
        res.json({ success: true, user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.post('/api/register', async (req, res) => {
    try {
        const { username, password, displayName } = req.body;

        if (!username || !password || !displayName) {
            return res.status(400).json({ error: 'Todos los campos son obligatorios' });
        }

        if (password.length < 4) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
        }

        const result = await db.createUser(username, password, displayName);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        // Auto-login después de registro
        const user = await db.validateUser(username, password);
        req.session.user = user;
        res.json({ success: true, user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al registrar usuario' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'No autenticado' });
    }
    res.json(req.session.user);
});

// ==================== MATCHES ROUTES ====================

app.get('/api/matches', requireAuth, async (req, res) => {
    try {
        const matches = await db.getAllMatches();
        res.json(matches);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/matches/upcoming', requireAuth, async (req, res) => {
    try {
        const matches = await db.getUpcomingMatches();

        // Añadir predicción del usuario si existe
        const matchesWithPredictions = await Promise.all(matches.map(async match => {
            const prediction = await db.getUserPredictionForMatch(req.session.user.id, match.id);
            const now = new Date();
            const deadline = new Date(match.deadline);
            return {
                ...match,
                userPrediction: prediction,
                canPredict: now < deadline
            };
        }));

        res.json(matchesWithPredictions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/matches/:id', requireAuth, async (req, res) => {
    try {
        const match = await db.getMatch(parseInt(req.params.id));
        if (!match) {
            return res.status(404).json({ error: 'Partido no encontrado' });
        }
        res.json(match);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/matches', requireAdmin, async (req, res) => {
    try {
        const { team, opponent, isHome, matchDate, deadline } = req.body;

        if (!team || !opponent || !matchDate || !deadline) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }

        const id = await db.createMatch(team, opponent, isHome !== false, matchDate, deadline);
        res.json({ success: true, id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/matches/:id/result', requireAdmin, async (req, res) => {
    try {
        const { homeGoals, awayGoals } = req.body;
        const matchId = parseInt(req.params.id);

        if (homeGoals === undefined || awayGoals === undefined) {
            return res.status(400).json({ error: 'Faltan los goles' });
        }

        await db.setMatchResult(matchId, parseInt(homeGoals), parseInt(awayGoals));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/matches/:id', requireAdmin, async (req, res) => {
    try {
        await db.deleteMatch(parseInt(req.params.id));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/matches/:id/predictions', requireAdmin, async (req, res) => {
    try {
        const predictions = await db.getMatchPredictions(parseInt(req.params.id));
        res.json(predictions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== PREDICTIONS ROUTES ====================

app.post('/api/predictions', requireAuth, async (req, res) => {
    try {
        const { matchId, homeGoals, awayGoals } = req.body;

        if (matchId === undefined || homeGoals === undefined || awayGoals === undefined) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }

        const result = await db.savePrediction(
            req.session.user.id,
            parseInt(matchId),
            parseInt(homeGoals),
            parseInt(awayGoals)
        );

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/predictions', requireAuth, async (req, res) => {
    try {
        const predictions = await db.getUserPredictions(req.session.user.id);
        res.json(predictions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== LEADERBOARD ====================

app.get('/api/leaderboard', requireAuth, async (req, res) => {
    try {
        const leaderboard = await db.getLeaderboard();
        res.json(leaderboard);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== ADMIN: USERS ====================

app.get('/api/users', requireAdmin, async (req, res) => {
    try {
        const users = await db.getAllUsers();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== SERVE FRONTEND ====================

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
║  Modo: ${process.env.NODE_ENV || 'development'}                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
