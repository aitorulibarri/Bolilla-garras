# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Bolilla Garras — quiniela de pronósticos de fútbol + sistema de votación MVP por partido para la peña Garras Taldea de Sestao. Los usuarios pronostican resultados de partidos del Athletic Club, Athletic Femenino y Bilbao Athletic.

**Repo**: https://github.com/aitorulibarri/Bolilla-garras.git  
**Producción**: https://bolilla-garras-kwz7.vercel.app  
**Admin**: `GARRAS` / `GARRAS123`

## Commands

```bash
npm install       # instalar dependencias
npm start         # arrancar server.js en puerto 3000
vercel deploy     # deploy preview
vercel --prod     # deploy producción
```

Auto-deploy al hacer `git push origin main` (integración GitHub → Vercel). No hay tests ni linter configurados.

## Architecture

**Backend único**: `server.js` (Express + PostgreSQL via Neon).  
**Frontend SPA**: Vanilla JS en `public/` — sin build step, sin framework.  
**Backend legacy**: `app.py` (Flask) — NO se usa en producción, ignorar.

```
server.js             Express: JWT auth, rutas API, lógica de puntos, MVP voting API
public/index.html     SPA entry point (scripts con ?v=8.3 para cache bust)
public/app.js         Toda la lógica frontend: API calls, render, estado, PWA, MVP UI
public/podium.js      Componente podio para la clasificación (top 3 con imágenes)
public/styles.css     Estilos (incluye módulo Garras Saria al final)
public/sw.js          Service Worker pass-through (no cache)
public/manifest.json  PWA manifest (iconos en public/icons/)
public/assets/        trofeo-v2.png, garras-lion.png, lion-paw.png, garras-logo.png
vercel.json           Config deploy: rutas, headers, builds
```

## Routing (vercel.json)

- `sw.js`, `app.js`, `podium.js`, `styles.css`, `index.html` → `no-cache, no-store`
- `/manifest.json` → `Content-Type: application/manifest+json`
- `/assets/(.*)` → `no-cache, no-store`
- `/api/(.*)` → `server.js`
- `(.*)` fallback → `server.js` (Express sirve el SPA)

**Cache busting**: incrementar `?v=X.Y` en `app.js` y `podium.js` en `index.html` cada vez que se modifiquen. Tras un push, los usuarios deben hacer **Ctrl+Shift+R**.

**Imágenes en assets**: usar siempre nombre de archivo nuevo al sustituir una imagen. Vercel deduplica por hash de contenido.

## Middleware stack (server.js)

Orden: `helmet` (CSP) → `compression` → `morgan` → `rateLimit` → `express.json` → rutas.

**CSP activa** — si añades un nuevo origen externo, añadirlo en `helmet` en `server.js` Y en `<meta http-equiv="Content-Security-Policy">` de `index.html`.

**Rate limiting**: auth endpoints → 10 req/15 min. Resto de API → 300 req/15 min.

## Database

PostgreSQL en Neon. Ocho tablas:

```
users               auth (username, display_name, password_hash, is_admin, password_encrypted)
matches             partidos (team, opponent, is_home, match_date, deadline, is_finished, mvp_voting_open)
predictions         pronósticos (player_name, match_id, home_goals, away_goals, points)
garras_players      jugadores/as (name, category: 'masculino'|'femenino', dorsal, active)
garras_jornadas     jornadas de votación GARRAS SARIA (numero, label, is_open, is_finished)
garras_votes        votos GARRAS SARIA (username, jornada_id, player_id, category)
match_mvp_votes     votos MVP por partido (match_id, username, player_id)
match_mvp_players   plantilla de jugadoras disponibles por partido femenino (match_id, player_id)
```

La conexión solo se activa si `DATABASE_URL` está presente (`IS_POSTGRES` flag). La inicialización es lazy: `dbInit()` se llama antes de cualquier query y reintenta 3 veces (backoff 2s/4s) para manejar el cold-start de Neon. Se llama también al arrancar el servidor (warm-up no bloqueante).

**Quirk crítico**: `predictions` en producción tiene columna legacy `user_id` (NOT NULL). El INSERT incluye `user_id` con fallback para compatibilidad.

**`predictions.player_name`** almacena el username (no display_name). JOINs deben usar `LOWER(player_name) = LOWER(username)`.

**Leaderboard query**: arranca desde `users` con LEFT JOIN a `predictions` para que todos los usuarios registrados aparezcan aunque tengan 0 puntos.

**Seed automático**: en `dbInit()`, si `garras_players` está vacía se insertan 32 jugadores masculinos y 28 femeninas. Usar `pool.query` directamente dentro de `dbInit()` — NO usar `query()`/`queryOne()` (deadlock).

## Auth

JWT stateless, token en **`sessionStorage`** como `bolilla_token`. Duración: 24h. Middleware: `requireAuth` → `requireAdmin`.

- Admin: lista estática `ADMIN_USERNAMES` ['admin', 'garras'] O campo `is_admin` en DB.
- JWT payload: `{ id, username, displayName, isAdmin }`. En frontend: `currentUser.isAdmin`.
- **Token en sessionStorage**: se borra al cerrar el navegador. Los usuarios deben hacer login cada vez que abren una nueva sesión.

**Contraseñas**: guardadas DOS veces — `password_hash` (bcrypt) y `password_encrypted` (AES-256-GCM). Clave: env `PASSWORD_ENCRYPTION_KEY`; si falta, se deriva de `JWT_SECRET`.

## Points System (`calculatePoints()` en server.js)

- Resultado exacto: **5 puntos**
- Parcial (máximo 3): signo correcto +1, diferencia de goles +1, goles de un equipo +2

## GARRAS SARIA — Módulo de votación MVP

**Estado actual**: pestaña oculta en `index.html` (botón comentado + `style="display:none"` en la sección). Para activarla: descomentar el botón, quitar el `display:none`, incrementar versión de `app.js`.

El tab usa el sistema **MVP por partido** (`/api/mvp/*`), no el sistema GARRAS SARIA por jornada (`/api/garras/*`). Ambas APIs existen en server.js pero el frontend solo expone MVP.

### API MVP por partido

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/mvp/active` | requireAuth | Partidos con votación abierta + voto del usuario |
| POST | `/api/mvp/:id/vote` | requireAuth | Votar MVP de un partido |
| GET | `/api/mvp/history` | requireAuth | Historial de partidos cerrados con resultados |
| GET | `/api/mvp/ranking` | requireAuth | Ranking de temporada |
| GET | `/api/mvp/admin/matches` | requireAdmin | Panel admin: últimos 30 partidos con estado votación |
| PUT | `/api/mvp/admin/:id/open` | requireAdmin | Abrir votación (femenino requiere `player_ids[]`) |
| PUT | `/api/mvp/admin/:id/close` | requireAdmin | Cerrar votación |

**Masculino**: jugadores disponibles = todos los activos de `garras_players` categoría masculino.  
**Femenino**: solo los jugadores en `match_mvp_players` para ese partido (el admin los selecciona al abrir).

### API GARRAS SARIA por jornada (backend disponible, no expuesto en frontend)

`/api/garras/players`, `/api/garras/jornadas`, `/api/garras/vote`, etc. — rutas completas en server.js pero sin UI activa.

**Orden de rutas crítico**: `/api/garras/jornadas/active` debe estar definida ANTES de `/api/garras/jornadas/:id/results`.

### Frontend MVP (app.js)

- `loadGarrasSaria()` — punto de entrada del tab
- `loadMvpVoteSection()` — carga partidos abiertos para votar; si falla muestra botón Reintentar
- `loadMvpHistory()` — historial de ganadores
- `loadMvpRanking()` — ranking temporada
- `loadMvpAdmin()` — panel admin

## Frontend: UI Patterns clave

### Match cards (`renderMatchCard`)

La cabecera usa `.match-header-gemini` con `.badges-row` (enlace clasificación + badge liga). El grid `.match-content-grid` tiene dos `.team-container` con `flex: 1 1 0; min-width: 0` — crítico para móvil.

Todos los datos de la API insertados en `innerHTML` deben pasar por `escapeHtml(str)` (definido al final de `app.js`).

### Guardar pronósticos

Un único botón "GUARDAR PRONÓSTICOS" al final del container. Handler: `saveAllPredictions(matchIds[])`. Los pronósticos no son modificables una vez enviados.

### Historial (`loadHistory`)

Primera subpestaña "Por jornada": `renderByWeek()` agrupa por semana lunes-domingo con `getMonday()` → `parseMatchDate`. Orden dentro de semana: Athletic Club → Athletic Femenino → Bilbao Athletic.

### Clasificación (Leaderboard)

- Iconos: 1º `trofeo-v2.png`, 2º `garras-lion.png`, 3º `lion-paw.png`
- PDF export (solo admins): `printLeaderboardReport()` y `printRankingOnly()`
- Todos los usuarios registrados aparecen aunque tengan 0 puntos

### Mobile CSS (`@media max-width: 768px`)

`.team-container`: `min-width: 0; flex: 1 1 0` es crítico — sin esto los escudos se salen. `.big-shield`: 46px.

## PWA

- **sw.js**: pass-through total, no cachea nada.
- **Android**: banner de instalación capturando `beforeinstallprompt`. Guard: `display-mode: standalone`.
- **iOS**: modal bottom sheet detectando `/iPhone|iPad|iPod/i` + `!navigator.standalone`. Guard: `sessionStorage`.

## Key Patterns

- **`fetchWithRetry`** (app.js): inyecta Authorization header + `_cb=Date.now()` anti-cache. Reintenta en errores 5xx. Verificar `res.ok` antes de parsear JSON y `Array.isArray()` antes de `.map()`.
- **`parseMatchDate(raw)`** (app.js): elimina la `Z` de TIMESTAMP naive del driver `pg`. Usar siempre para fechas de partido.
- **`escapeHtml(str)`** (app.js): usar siempre al insertar datos de la API en `innerHTML`.
- **Deadline check** (server.js): usa `NOW() AT TIME ZONE 'Europe/Madrid' > deadline` — los deadlines se almacenan en hora de Madrid.
- **Upsert predictions**: SELECT + INSERT/UPDATE manual (no ON CONFLICT) por schema legacy.
- **Borrar partidos**: `DELETE /api/matches/:id` rechaza con 400 si `is_finished = 1`.
- **Orden fijo por liga**: Athletic Club → Athletic Femenino → Bilbao Athletic, luego fecha ASC.

## Admin endpoints relevantes

| Ruta | Descripción |
|---|---|
| `POST /api/admin/reset-season` | Borra pronósticos de partidos finalizados, conserva pendientes. Usar al inicio de temporada. |
| `GET /api/admin/open-predictions` | Tracker: quién ha pronosticado y quién falta por partido abierto |
| `GET /api/admin/users` | Lista usuarios (sin password_hash) |
| `GET /api/admin/users/:id/password` | Ver contraseña en claro (solo si tiene `password_encrypted`) |
| `PUT /api/admin/users/:id/password` | Resetear contraseña de un usuario |
| `DELETE /api/admin/users/:id` | Borrar usuario y sus predicciones |

## PDF Reports

| Función | Pestaña | Fuente |
|---|---|---|
| `printTrackerReport()` | Seguimiento | `_trackerData` (en memoria) |
| `printLeaderboardReport()` | Clasificación | `/api/leaderboard` + `/api/leaderboard/detail` |
| `printRankingOnly()` | Clasificación | `/api/leaderboard` |

## Env Vars (Vercel)

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Connection string Neon. Usar URL del **Connection Pooler** (`-pooler.` en hostname) para alta carga |
| `JWT_SECRET` | Secret JWT. Si no está, usa fallback hardcodeado (funcional pero inseguro) |
| `PASSWORD_ENCRYPTION_KEY` | 32 bytes base64 para AES-GCM (opcional; si falta se deriva de JWT_SECRET) |

## Known Issues

- **JWT_SECRET fallback público**: si `JWT_SECRET` no está en Vercel, usa `'bolilla-garras-secret-2026-seguro'` (visible en repo). Configurar en Vercel → Settings → Environment Variables.
- **Registro concede admin por nombre**: username `admin` o `garras` recibe `is_admin=1`. Por diseño.
- **Neon Connection Pooler**: usar URL pooled en `DATABASE_URL` para mayor estabilidad bajo carga simultánea alta.

## Teams & Logos

Equipos hardcodeados en `LEAGUE_TEAMS` (app.js). Escudos en `LOGO_MAP`, archivos en `public/logos/` organizados por competición (`laliga/`, `ligaf/`, `rfef/`, `segunda/`).
