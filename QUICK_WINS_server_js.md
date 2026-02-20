# QUICK_WINS - server.js (Backend Node.js)

## 🔴 CRÍTICOS (Arreglar ya)

| # | Línea | Problema | Fix |
|---|-------|----------|-----|
| 1 | - | Sin autenticación de sesión real | Implementar express-session |
| 2 | 130-137 | predictions usa player_name (string) sin ForeignKey | Cambiar a user_id |
| 3 | - | Cualquiera puede hacerse admin enviando adminName | Verificar sesión real |

## 🟠 MEDIOS

| # | Problema |
|---|----------|
| 4 | No hay endpoint /api/logout |
| 5 | No hay cambio de contraseña |
| 6 | 'unsafe-inline' en CSP permite XSS |
| 7 | Tipos INTEGER en lugar de BOOLEAN |

## ✅ MEJORAS RÁPIDAS

```javascript
// 1. Añadir express-session
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

app.use(session({
    store: new pgSession({ pool }),
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true, httpOnly: true }
}));

// 2. Middleware requireAuth
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: 'No autenticado' });
    }
    next();
}

// 3. Proteger rutas
app.get('/api/matches', requireAuth, async (req, res) => { ... });

// 4. Logout endpoint
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});
```

## 📊 Diferencias con Python

| Aspecto | Python | Node.js |
|---------|--------|---------|
| Sesiones | ✅ Flask sessions | ❌ No hay |
| Auth real | ✅ @require_auth | ❌ adminName en body |
| Predictions | user_id (FK) | player_name (string) |
| Logout | ✅ | ❌ |
| Admin check | Decorador | username en body |
