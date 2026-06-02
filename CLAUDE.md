# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Bolilla Garras — quiniela de pronósticos de fútbol + sistema de votación MVP por partido para la peña Garras Taldea de Sestao. Los usuarios pronostican resultados de partidos del Athletic Club, Athletic Femenino y Bilbao Athletic.

**Repo**: https://github.com/aitorulibarri/Bolilla-garras.git  
**Producción**: https://bolilla-garras-kwz7.vercel.app  
**Admin**: `garras` / `GARRAS123`

**La app es mobile-first** — diseñada principalmente para teléfono móvil. Todos los elementos interactivos deben tener `min-height: 44px`, `touch-action: manipulation` y estado `:active` (no solo `:hover`).

## Commands

```bash
npm install          # instalar dependencias
npm start            # arrancar server.js en puerto 3000
git push origin main # auto-deploy en Vercel vía GitHub integration
```

No hay tests ni linter configurados.

## Architecture

**Backend único**: `server.js` (Express + PostgreSQL via Neon).  
**Frontend SPA**: Vanilla JS en `public/` — sin build step, sin framework.  
**Backend legacy**: `app.py` (Flask) — NO se usa en producción, ignorar.

```
server.js             Express: JWT auth, rutas API, lógica de puntos, MVP voting API
public/index.html     SPA entry point (scripts con ?v=8.14 para cache bust)
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

**Cache busting**: incrementar `?v=X.Y` en `app.js` y `podium.js` en `index.html` cada vez que se modifiquen (versión actual: `v8.14`). Tras un push, los usuarios deben hacer **Ctrl+Shift+R**.

**Imágenes en assets**: usar siempre nombre de archivo nuevo al sustituir una imagen. Vercel deduplica por hash de contenido.

## Middleware stack (server.js)

Orden: `helmet` (CSP) → `compression` → `morgan` → `rateLimit` → `express.json` → rutas.

**CSP activa** — si añades un nuevo origen externo, añadirlo en `helmet` en `server.js` Y en `<meta http-equiv="Content-Security-Policy">` de `index.html`. La CSP actual permite `script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net`.

**Rate limiting**: auth endpoints → 10 req/15 min. Resto de API → 300 req/15 min.

## Database

PostgreSQL en Neon. Ocho tablas:

```
users               auth (username, display_name, password_hash, is_admin, password_encrypted)
matches             partidos (team, opponent, is_home, match_date, deadline, is_finished, mvp_voting_open)
predictions         pronósticos (player_name, match_id, home_goals, away_goals, points)
garras_players      jugadores/as (name, category: 'masculino'|'femenino', dorsal, active)
garras_jornadas     Sistema A legacy — no usado en frontend
garras_votes        Sistema A legacy — no usado en frontend
match_mvp_votes     votos MVP por partido (match_id, username TEXT, player_id)
match_mvp_players   jugadoras disponibles por partido femenino (match_id, player_id)
```

La conexión solo se activa si `DATABASE_URL` está presente (`IS_POSTGRES` flag). La inicialización es lazy: `dbInit()` se llama antes de cualquier query y reintenta 3 veces (backoff 2s/4s) para manejar el cold-start de Neon. Se llama también al arrancar el servidor (warm-up no bloqueante).

**Quirk crítico**: `predictions` en producción tiene columna legacy `user_id` (NOT NULL). El INSERT incluye `user_id` con fallback para compatibilidad.

**`predictions.player_name`** almacena el username (no display_name). JOINs deben usar `LOWER(player_name) = LOWER(username)`.

**Leaderboard query**: arranca desde `users` con LEFT JOIN a `predictions` para que todos los usuarios registrados aparezcan aunque tengan 0 puntos.

**Seed automático**: en `dbInit()`, si `garras_players` está vacía se insertan 32 jugadores masculinos y 28 femeninas. Usar `pool.query` directamente dentro de `dbInit()` — NO usar `query()`/`queryOne()` (deadlock).

**`match_mvp_votes.username`** es TEXT (no FK a `users`). Borrar un usuario no elimina sus votos MVP en cascada — usar `DELETE /api/mvp/admin/:id/votes` para limpiar si es necesario.

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

Tab activo en producción. El sistema MVP por partido (`/api/mvp/*`) es el único expuesto en frontend. El sistema por jornada (`/api/garras/*`) existe en server.js pero sin UI.

### API MVP por partido

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/ping` | — | Keep-warm: hace SELECT 1 a Neon. Sin auth. |
| GET | `/api/mvp/active` | requireAuth | Partidos con votación abierta + voto del usuario |
| POST | `/api/mvp/:id/vote` | requireAuth | Votar MVP (UPSERT — se puede cambiar el voto) |
| GET | `/api/mvp/history` | requireAuth | Últimos 20 partidos cerrados con podio completo |
| GET | `/api/mvp/ranking` | requireAuth | Ranking temporada separado por masculino/femenino |
| GET | `/api/mvp/admin/matches` | requireAdmin | Panel admin: últimos 30 partidos con estado votación |
| PUT | `/api/mvp/admin/:id/open` | requireAdmin | Abrir votación (femenino requiere `player_ids[]`) |
| PUT | `/api/mvp/admin/:id/close` | requireAdmin | Cerrar votación |
| DELETE | `/api/mvp/admin/:id/votes` | requireAdmin | Borrar todos los votos de un partido (limpieza) |

**Masculino**: jugadores = todos los activos de `garras_players` categoría masculino.  
**Femenino**: solo los de `match_mvp_players` para ese partido (admin los selecciona al abrir). El endpoint valida que todos los `player_ids` sean `category='femenino' AND active=1`.

**Ganador por partido**: jugador con más votos en `match_mvp_votes` para ese `match_id`. Empate: orden alfabético. La API de history devuelve `results[]` ordenado por `votes DESC, name ASC` — el frontend usa `results[0]` como ganador.

**Ranking de temporada**: CTE con 4 pasos — vote_counts → match_max → winners (jugadores que igualaron el máximo; si empate, ambos suman +1) → totals. Orden: `partidos_ganados DESC, total_votes DESC, name ASC`.

### Frontend Garras Saria (app.js)

- `loadGarrasSaria()` — punto de entrada del tab; llama a admin (si admin) + vote + history + ranking en paralelo
- `loadMvpVoteSection()` — partidos abiertos para votar; click en player card → `submitMvpVote()`
- `loadMvpHistory()` — historial con podio (🥇🥈🥉) + lista completa; guarda array en `_mvpHistoryMatches[]`
- `loadMvpRanking()` — tabla ranking con medallas top 3
- `loadMvpAdmin()` — panel admin; partidos agrupados por categoría (⚽ Masculino / 👟 Femenino)
- `_mvpAdminClick(e)` — event delegation para todos los botones del panel admin
- `_mvpMostrarSelectorFem(matchId)` — carga jugadoras y muestra selector en `#mvp-fem-panel`
- `exportMatchResult(match)` — genera PNG 900px con Canvas API: logo, podio, lista; descarga directa en Android/desktop, abre en nueva pestaña en iOS
- `_rrPath(ctx, x, y, w, h, r)` — helper: rounded rect path para canvas

**Cache in-memory**: `_mvpCache` (TTL 5 min) para `mvp_history` y `mvp_ranking`. Se invalida en `_mvpAdminClick` al cerrar votación. Funciones: `_mvpCacheGet(key)`, `_mvpCacheSet(key, data)`, `_mvpCacheClear(...keys)`.

**Tras abrir votación**: llama `Promise.all([loadMvpAdmin(), loadMvpVoteSection()])` — el admin ve el cambio sin recargar.  
**Tras cerrar votación**: llama `Promise.all([loadMvpAdmin(), loadMvpVoteSection(), loadMvpHistory(), loadMvpRanking()])` e invalida caché.

**Orden de rutas crítico** (server.js): `/api/garras/jornadas/active` debe estar definida ANTES de `/api/garras/jornadas/:id/results`.

## Frontend: UI Patterns clave

### Match cards (`renderMatchCard`)

La cabecera usa `.match-header-gemini` con `.badges-row`. El grid `.match-content-grid` tiene dos `.team-container` con `flex: 1 1 0; min-width: 0` — crítico para móvil.

Todos los datos de la API insertados en `innerHTML` deben pasar por `escapeHtml(str)` (definido al final de `app.js`).

### Guardar pronósticos

Un único botón "GUARDAR PRONÓSTICOS" al final del container. Handler: `saveAllPredictions(matchIds[])`. Los pronósticos no son modificables una vez enviados.

### Historial (`loadHistory`)

Primera subpestaña "Por jornada": `renderByWeek()` agrupa por semana lunes-domingo con `getMonday()` → `parseMatchDate`. Orden dentro de semana: Athletic Club → Athletic Femenino → Bilbao Athletic.

### Clasificación (Leaderboard)

- Iconos: 1º `trofeo-v2.png`, 2º `garras-lion.png`, 3º `lion-paw.png`
- PDF export (solo admins): `printLeaderboardReport()` y `printRankingOnly()`
- Todos los usuarios registrados aparecen aunque tengan 0 puntos

## PWA

- **sw.js**: pass-through total, no cachea nada.
- **Android**: banner de instalación capturando `beforeinstallprompt`. Guard: `display-mode: standalone`.
- **iOS**: modal bottom sheet detectando `/iPhone|iPad|iPod/i` + `!navigator.standalone`. Guard: `sessionStorage`.

## Key Patterns

- **`fetchWithRetry`** (app.js): inyecta Authorization header + `_cb=Date.now()` anti-cache. Reintenta en errores 5xx. Verificar `res.ok` antes de parsear JSON y `Array.isArray()` antes de `.map()`.
- **`parseMatchDate(raw)`** (app.js): elimina la `Z` de TIMESTAMP naive del driver `pg`. Usar siempre para fechas de partido.
- **`escapeHtml(str)`** (app.js): usar siempre al insertar datos de la API en `innerHTML`. Para canvas usar escape manual inline.
- **Deadline check** (server.js): usa `NOW() AT TIME ZONE 'Europe/Madrid' > deadline` — los deadlines se almacenan en hora de Madrid.
- **Upsert predictions**: SELECT + INSERT/UPDATE manual (no ON CONFLICT) por schema legacy.
- **Borrar partidos**: `DELETE /api/matches/:id` rechaza con 400 si `is_finished = 1`.
- **Orden fijo por liga**: Athletic Club → Athletic Femenino → Bilbao Athletic, luego fecha ASC.
- **Event delegation en admin MVP**: `container.addEventListener('click', _mvpAdminClick)` — nunca usar `onclick` en strings de `innerHTML` para botones del panel admin.

## Performance

**Neon cold start**: 300ms–2.6s. El free tier hiberna tras 5 min de inactividad. Mitigación:
- `GET /api/ping` hace `SELECT 1` sin auth — configurar cron externo (cron-job.org, gratis) para llamarlo cada 4 min.
- `DATABASE_URL` debe usar la URL del **Connection Pooler** de Neon (`-pooler.` en el hostname) — reduce latencia de conexión.
- Verificar que **Fluid Compute** está activo en Vercel → Settings → Functions.

## Admin endpoints relevantes

| Ruta | Descripción |
|---|---|
| `POST /api/admin/reset-season` | Borra pronósticos de partidos finalizados, conserva pendientes. |
| `GET /api/admin/open-predictions` | Tracker: quién ha pronosticado y quién falta por partido abierto |
| `GET /api/admin/users` | Lista usuarios (sin password_hash) |
| `GET /api/admin/users/:id/password` | Ver contraseña en claro (solo si tiene `password_encrypted`) |
| `PUT /api/admin/users/:id/password` | Resetear contraseña de un usuario |
| `DELETE /api/admin/users/:id` | Borrar usuario y sus predicciones |

## Exports

| Función | Pestaña | Formato | Fuente |
|---|---|---|---|
| `printTrackerReport()` | Seguimiento | `.xls` con colores | `/api/admin/open-predictions` |
| `exportLeaderboardCSV()` | Clasificación | `.xls` con colores | `/api/leaderboard` + `/api/leaderboard/detail` |
| `printRankingOnly()` | Clasificación | PDF via `window.print()` | `/api/leaderboard` |
| `exportMatchResult(match)` | Garras Saria historial | PNG via Canvas API | datos en memoria (`_mvpHistoryMatches`) |

**Formato Excel** (`.xls`): se genera como HTML con namespace Office. Usar MIME `application/vnd.ms-excel` y BOM `﻿`.

**Canvas PNG** (`exportMatchResult`): 900px ancho, alto dinámico según nº de votados. Logo `/assets/garras-logo.png` cargado con `crossOrigin='anonymous'`. En iOS abre nueva pestaña (el usuario guarda manualmente); en Android/desktop descarga directa.

## Env Vars (Vercel)

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Connection string Neon. Usar URL del **Connection Pooler** (`-pooler.` en hostname) |
| `JWT_SECRET` | Secret JWT. Si no está, usa fallback hardcodeado visible en repo — configurar en Vercel. |
| `PASSWORD_ENCRYPTION_KEY` | 32 bytes base64 para AES-GCM (opcional; si falta se deriva de JWT_SECRET) |

## Known Issues

- **JWT_SECRET fallback público**: si `JWT_SECRET` no está en Vercel, usa `'bolilla-garras-secret-2026-seguro'` (visible en repo). Configurar en Vercel → Settings → Environment Variables.
- **Registro concede admin por nombre**: username `admin` o `garras` recibe `is_admin=1`. Por diseño.
- **`saveAllPredictions`** usa `fetch()` nativo, no `fetchWithRetry` — sin retry en cold start de Neon.

## Teams & Logos

Equipos hardcodeados en `LEAGUE_TEAMS` (app.js). Escudos en `LOGO_MAP`, archivos en `public/logos/` organizados por competición (`laliga/`, `ligaf/`, `rfef/`, `segunda/`).
