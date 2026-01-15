const path = require('path');
const bcrypt = require('bcryptjs');

// Configuration
const IS_POSTGRES = !!process.env.DATABASE_URL;

let pool;
let sqliteDb;

if (IS_POSTGRES) {
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });
    console.log('✅ PostgreSQL configured');
} else {
    // Only try to load SQLite in local development
    try {
        const Database = require('better-sqlite3');
        sqliteDb = new Database(path.join(__dirname, 'bolilla.db'));
        console.log('✅ SQLite configured');
    } catch (e) {
        console.error('❌ DATABASE_URL not set and better-sqlite3 not available.');
        console.error('   Set DATABASE_URL environment variable for PostgreSQL.');
        // Don't crash immediately - let the app start but fail on DB operations
    }
}

// ==================== HELPERS ====================

function convertToPostgres(sql) {
    let i = 1;
    return sql.replace(/\?/g, () => `$${i++}`);
}

async function run(sql, params = []) {
    if (IS_POSTGRES) {
        sql = convertToPostgres(sql);
        // Handle INSERT returning ID for Postgres
        if (sql.trim().toUpperCase().startsWith('INSERT')) {
            sql += ' RETURNING id';
        }
        const result = await pool.query(sql, params);
        if (result.command === 'INSERT') {
            return { lastInsertRowid: result.rows[0]?.id, changes: result.rowCount };
        }
        return { changes: result.rowCount };
    } else {
        const stmt = sqliteDb.prepare(sql);
        return stmt.run(...params);
    }
}

async function get(sql, params = []) {
    if (IS_POSTGRES) {
        sql = convertToPostgres(sql);
        const result = await pool.query(sql, params);
        return result.rows[0];
    } else {
        return sqliteDb.prepare(sql).get(...params);
    }
}

async function all(sql, params = []) {
    if (IS_POSTGRES) {
        sql = convertToPostgres(sql);
        const result = await pool.query(sql, params);
        return result.rows;
    } else {
        return sqliteDb.prepare(sql).all(...params);
    }
}

// ==================== INIT ====================

async function initDb() {
    if (IS_POSTGRES) {
        console.log('Initializing PostgreSQL...');

        // Create session table for connect-pg-simple
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "session" (
                "sid" varchar NOT NULL PRIMARY KEY,
                "sess" json NOT NULL,
                "expire" timestamp(6) NOT NULL
            );
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
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
                user_id INTEGER NOT NULL REFERENCES users(id),
                match_id INTEGER NOT NULL REFERENCES matches(id),
                home_goals INTEGER NOT NULL,
                away_goals INTEGER NOT NULL,
                points INTEGER DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, match_id)
            );
        `);
    } else {
        console.log('Initializing SQLite...');
        sqliteDb.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                sid TEXT PRIMARY KEY,
                expired DATETIME NOT NULL,
                sess TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
                is_admin INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS matches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                team TEXT NOT NULL,
                opponent TEXT NOT NULL,
                is_home INTEGER DEFAULT 1,
                match_date DATETIME NOT NULL,
                deadline DATETIME NOT NULL,
                home_goals INTEGER DEFAULT NULL,
                away_goals INTEGER DEFAULT NULL,
                is_finished INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS predictions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                match_id INTEGER NOT NULL,
                home_goals INTEGER NOT NULL,
                away_goals INTEGER NOT NULL,
                points INTEGER DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (match_id) REFERENCES matches(id),
                UNIQUE(user_id, match_id)
            );
        `);
    }

    // Create Admin
    const adminExists = await get('SELECT id FROM users WHERE username = ?', ['admin']);
    if (!adminExists) {
        const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
        const hash = await bcrypt.hash(adminPass, 10);
        await run('INSERT INTO users (username, password_hash, display_name, is_admin) VALUES (?, ?, ?, 1)',
            ['admin', hash, 'Administrador']);
        console.log('✅ Usuario admin creado');
    }
}

// Call init immediately (or export it to be called)
initDb().catch(console.error);

// ==================== USUARIOS ====================

async function createUser(username, password, displayName) {
    const hash = await bcrypt.hash(password, 10);
    try {
        const result = await run('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
            [username, hash, displayName]);
        return { success: true, id: result.lastInsertRowid };
    } catch (err) {
        return { success: false, error: 'El usuario ya existe or DB error: ' + err.message };
    }
}

async function validateUser(username, password) {
    const user = await get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return null;

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return null;

    return { id: user.id, username: user.username, displayName: user.display_name, isAdmin: user.is_admin === 1 };
}

async function getAllUsers() {
    return all('SELECT id, username, display_name, is_admin, created_at FROM users ORDER BY display_name');
}

// ==================== PARTIDOS ====================

async function createMatch(team, opponent, isHome, matchDate, deadline) {
    const result = await run('INSERT INTO matches (team, opponent, is_home, match_date, deadline) VALUES (?, ?, ?, ?, ?)',
        [team, opponent, isHome ? 1 : 0, matchDate, deadline]);
    return result.lastInsertRowid;
}

async function getUpcomingMatches() {
    return all(`
    SELECT * FROM matches 
    WHERE is_finished = 0 
    ORDER BY match_date ASC
  `);
}

async function getAllMatches() {
    return all('SELECT * FROM matches ORDER BY match_date DESC');
}

async function getMatch(id) {
    return get('SELECT * FROM matches WHERE id = ?', [id]);
}

async function setMatchResult(matchId, homeGoals, awayGoals) {
    await run('UPDATE matches SET home_goals = ?, away_goals = ?, is_finished = 1 WHERE id = ?',
        [homeGoals, awayGoals, matchId]);

    // Calcular puntos de todos los pronósticos para este partido
    await calculatePointsForMatch(matchId, homeGoals, awayGoals);
}

async function deleteMatch(matchId) {
    await run('DELETE FROM predictions WHERE match_id = ?', [matchId]);
    await run('DELETE FROM matches WHERE id = ?', [matchId]);
}

// ==================== PRONÓSTICOS ====================

async function savePrediction(userId, matchId, homeGoals, awayGoals) {
    // Verificar que el partido no haya pasado el deadline
    const match = await get('SELECT deadline FROM matches WHERE id = ?', [matchId]);
    if (!match) return { success: false, error: 'Partido no encontrado' };

    const now = new Date();
    const deadline = new Date(match.deadline);
    if (now > deadline) {
        return { success: false, error: 'El plazo para enviar pronósticos ha terminado' };
    }

    try {
        if (IS_POSTGRES) {
            // Postgres ON CONFLICT
            await run(`
                INSERT INTO predictions (user_id, match_id, home_goals, away_goals) 
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, match_id) DO UPDATE SET home_goals = EXCLUDED.home_goals, away_goals = EXCLUDED.away_goals
            `, [userId, matchId, homeGoals, awayGoals]);
        } else {
            // SQLite ON CONFLICT
            await run(`
                INSERT INTO predictions (user_id, match_id, home_goals, away_goals) 
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, match_id) DO UPDATE SET home_goals = ?, away_goals = ?
            `, [userId, matchId, homeGoals, awayGoals, homeGoals, awayGoals]);
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function getUserPredictions(userId) {
    return all(`
    SELECT p.*, m.team, m.opponent, m.is_home, m.match_date, m.home_goals as real_home, m.away_goals as real_away, m.is_finished
    FROM predictions p
    JOIN matches m ON p.match_id = m.id
    WHERE p.user_id = ?
    ORDER BY m.match_date DESC
  `, [userId]);
}

async function getMatchPredictions(matchId) {
    return all(`
    SELECT p.*, u.display_name
    FROM predictions p
    JOIN users u ON p.user_id = u.id
    WHERE p.match_id = ?
    ORDER BY u.display_name
  `, [matchId]);
}

async function getUserPredictionForMatch(userId, matchId) {
    return get('SELECT * FROM predictions WHERE user_id = ? AND match_id = ?', [userId, matchId]);
}

// ==================== CÁLCULO DE PUNTOS ====================

function calculatePoints(predHome, predAway, realHome, realAway) {
    // Resultado exacto = 5 puntos
    if (predHome === realHome && predAway === realAway) {
        return 5;
    }

    let points = 0;

    // Acertar goles de un equipo = 2 puntos
    if (predHome === realHome || predAway === realAway) {
        points += 2;
    }

    // Acertar ganador/empate = 1 punto
    const predResult = predHome > predAway ? 'H' : (predHome < predAway ? 'A' : 'D');
    const realResult = realHome > realAway ? 'H' : (realHome < realAway ? 'A' : 'D');
    if (predResult === realResult) {
        points += 1;
    }

    // Acertar diferencia de goles = 1 punto
    if ((predHome - predAway) === (realHome - realAway)) {
        points += 1;
    }

    return Math.min(points, 3); // Máximo 3 puntos si no es exacto
}

async function calculatePointsForMatch(matchId, homeGoals, awayGoals) {
    const predictions = await all('SELECT * FROM predictions WHERE match_id = ?', [matchId]);

    for (const pred of predictions) {
        const points = calculatePoints(pred.home_goals, pred.away_goals, homeGoals, awayGoals);
        await run('UPDATE predictions SET points = ? WHERE id = ?', [points, pred.id]);
    }
}

// ==================== CLASIFICACIÓN ====================

async function getLeaderboard() {
    return all(`
    SELECT 
      u.id,
      u.display_name,
      COALESCE(SUM(p.points), 0) as total_points,
      COUNT(CASE WHEN p.points = 5 THEN 1 END) as exact_predictions,
      COUNT(CASE WHEN p.points IS NOT NULL THEN 1 END) as total_predictions
    FROM users u
    LEFT JOIN predictions p ON u.id = p.user_id
    WHERE u.is_admin = 0
    GROUP BY u.id
    ORDER BY total_points DESC, exact_predictions DESC
  `);
}

module.exports = {
    initDb,
    createUser,
    validateUser,
    getAllUsers,
    createMatch,
    getUpcomingMatches,
    getAllMatches,
    getMatch,
    setMatchResult,
    deleteMatch,
    savePrediction,
    getUserPredictions,
    getMatchPredictions,
    getUserPredictionForMatch,
    getLeaderboard,
    calculatePoints
};
