# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Bolilla Garras — quiniela de pronósticos de fútbol + sistema de votación GARRAS SARIA para la peña Garras Taldea de Sestao. Los usuarios pronostican resultados de partidos del Athletic Club, Athletic Femenino y Bilbao Athletic, y votan al jugador/a con más garra de cada jornada.

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
server.js             Express: JWT auth, rutas API, lógica de puntos, GARRAS SARIA API
public/index.html     SPA entry point (scripts con ?v=6.6 para cache bust)
public/app.js         Toda la lógica frontend: API calls, render, estado, PWA, GARRAS SARIA UI
public/podium.js      Componente podio para la clasificación (top 3 con imágenes)
public/styles.css     Estilos (incluye módulo GARRAS SARIA al final)
public/sw.js          Service Worker pass-through (no cache, respondWith)
public/manifest.json  PWA manifest (iconos en public/icons/)
public/assets/        trofeo-v2.png (sin fondo), garras-lion.png, lion-paw.png, garras-logo.png
vercel.json           Config deploy: rutas, headers, builds
```

## Routing (vercel.json)

- `sw.js`, `app.js`, `podium.js`, `styles.css`, `index.html` → `no-cache, no-store`
- `/manifest.json` → `Content-Type: application/manifest+json`
- `/assets/(.*)` → `no-cache, no-store` (evita problemas al cambiar imágenes)
- `/api/(.*)` → `server.js`
- `(.*)` fallback → `server.js` (Express sirve el SPA)

**Cache busting de scripts**: los scripts se cargan con `?v=6.6` en index.html. Incrementar la versión cada vez que se modifique `app.js` o `podium.js`. Tras un push, los usuarios deben hacer **Ctrl+Shift+R** para forzar recarga del JS.

**Imágenes en assets**: si se sustituye una imagen, usar siempre un **nombre de archivo nuevo** (ej. `trofeo-v2.png`). Vercel deduplica por hash de contenido — reemplazar el mismo fichero no garantiza invalidación en el CDN.

## Middleware stack (server.js)

Orden: `helmet` (CSP) → `compression` → `morgan` → `rateLimit` → `express.json` → rutas.

**CSP activa** — si añades un nuevo origen externo (script, font, imagen), añadirlo en la directiva de `helmet` en `server.js` Y en `<meta http-equiv="Content-Security-Policy">` de `index.html`.

**Rate limiting**: auth endpoints → 10 req/15 min. Resto de API → 100 req/15 min.

## Database

PostgreSQL en Neon. Seis tablas: `users`, `matches`, `predictions`, `garras_players`, `garras_jornadas`, `garras_votes`. La conexión solo se activa si `DATABASE_URL` está presente (`IS_POSTGRES` flag). La inicialización es lazy: `dbInit()` se llama antes de cualquier query.

**Quirk crítico**: `predictions` en producción tiene columna legacy `user_id` (NOT NULL) que no está en el schema del código. El INSERT de predictions incluye `user_id` con fallback.

`predictions.player_name` almacena el **username** (no display_name). JOINs entre predictions y users deben usar `LOWER(player_name) = LOWER(username)`.

**Seed automático**: en `dbInit()`, si `garras_players` está vacía se insertan automáticamente 32 jugadores masculinos (Athletic Club) y 28 jugadoras femeninas (Athletic Femenino). Usar `pool.query` directamente dentro de `dbInit()` — NO usar los helpers `query()`/`queryOne()` porque llaman a `dbInit()` y causarían un deadlock.

## Auth

JWT stateless, token en `localStorage` como `bolilla_token`. Duración: 24h. Middleware: `requireAuth` (JWT verify) → `requireAdmin`.

- Admin determinado por lista estática `ADMIN_USERNAMES` ['admin', 'garras'] O campo `is_admin` en DB.
- El JWT payload incluye `username` e `isAdmin`. En el frontend: `currentUser.isAdmin`.

**Contraseñas**: guardadas DOS veces — `password_hash` (bcrypt) y `password_encrypted` (AES-256-GCM). Clave: env `PASSWORD_ENCRYPTION_KEY` (32 bytes base64); si falta, se deriva de `JWT_SECRET`. Formato blob: `base64(iv):base64(tag):base64(ciphertext)`.

## Points System (`calculatePoints()` en server.js)

- Resultado exacto: **5 puntos**
- Parcial (máximo 3): signo correcto +1, diferencia de goles +1, goles de un equipo +2

## GARRAS SARIA — Módulo de votación

Sistema de votación por jornada donde los miembros de la peña eligen al jugador/a con más garra. Visible para todos los usuarios (no solo admins).

### Tablas DB

```sql
garras_players   -- jugadores/as (name, category: 'masculino'|'femenino', dorsal, active)
garras_jornadas  -- jornadas de votación (numero, label, is_open, is_finished)
garras_votes     -- votos (username, jornada_id, player_id, category) — UNIQUE(username, jornada_id, category)
```

### Rutas API (server.js)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/garras/players?category=` | requireAuth | Lista jugadores activos |
| GET | `/api/garras/jornadas` | requireAuth | Lista todas las jornadas |
| GET | `/api/garras/jornadas/active` | requireAuth | Jornada abierta + votos del usuario |
| GET | `/api/garras/jornadas/:id/results` | requireAuth | Recuento de votos por jornada |
| GET | `/api/garras/ranking` | requireAuth | Ranking de temporada (jornadas ganadas) |
| POST | `/api/garras/vote` | requireAuth | Emitir/actualizar voto |
| GET | `/api/garras/admin/jornadas` | requireAdmin | Lista jornadas con conteo de votos |
| POST | `/api/garras/jornadas` | requireAdmin | Crear jornada |
| PUT | `/api/garras/jornadas/:id/open` | requireAdmin | Abrir votación (solo 1 abierta a la vez) |
| PUT | `/api/garras/jornadas/:id/close` | requireAdmin | Cerrar votación (is_finished=1) |
| DELETE | `/api/garras/jornadas/:id` | requireAdmin | Eliminar jornada (solo sin votos) |

**Orden de rutas crítico**: `/api/garras/jornadas/active` debe estar definida ANTES de `/api/garras/jornadas/:id/results` en server.js para evitar que Express interprete "active" como un `:id`.

### Frontend (app.js)

Funciones principales del módulo:
- `loadGarrasSaria()` — punto de entrada al hacer click en el tab
- `loadGarrasVoteSection()` — carga la jornada activa y los jugadores para votar
- `renderVoteCategory(category, title, players, votedPlayer, jornadaId)` — renderiza las cards de jugadores
- `loadGarrasHistory()` — historial de jornadas cerradas con ganadores
- `loadGarrasRanking()` — ranking acumulado de temporada
- `loadGarrasAdminJornadas()` — panel admin de gestión de jornadas
- `showGarrasCreateModal()` — muestra formulario inline para crear jornada (NO usar prompt())
- `escapeHtml(str)` — helper XSS definido al final de app.js; usar siempre para datos de la API en innerHTML

**Sección admin**: `#garras-admin-section` arranca con `display:none` en el HTML; `loadGarrasSaria()` lo hace visible si `currentUser.isAdmin`. Integrado en el tab "🏅 Garras Saria", no en el tab Admin.

**Ranking**: un jugador gana 1 punto por jornada en la que recibe más votos. La query CTE en `/api/garras/ranking` calcula esto via `vote_counts → max_per_jornada → winners`.

## Frontend: UI Patterns clave

### Match cards (`renderMatchCard`)

La cabecera usa `.match-header-gemini` (flexbox columna) con `.badges-row` dentro:
- `.badges-row`: fila con enlace de clasificación (izquierda) y badge de liga (derecha)
- El grid de partido (`.match-content-grid`) tiene dos `.team-container` con `flex: 1 1 0; min-width: 0` — crítico para que los escudos no se salgan en móvil

### Guardar pronósticos

No hay botón por partido. `loadMatches()` añade un único botón "GUARDAR PRONÓSTICOS" al final del container si hay partidos pendientes. El handler es `saveAllPredictions(matchIds[])` que recorre los inputs, muestra confirmación con todos los resultados juntos y hace un POST por partido.

### Historial (`loadHistory`)

Primera subpestaña: **"Por jornada"** — `renderByWeek()` agrupa predicciones por semana (lunes-domingo) usando `getMonday(raw)` → `parseMatchDate`. Orden dentro de cada semana: Athletic Club → Athletic Femenino → Bilbao Athletic.

Resto de subpestañas por equipo: `renderList(team)`. Tabla `.hist-table`. Puntos: `.hist-pts-5` (verde), `.hist-pts-3` (amarillo), `.hist-pts-1` (gris), `.hist-pts-0` (rojo).

### Clasificación (Leaderboard)

- **Iconos de puesto**: 1º `trofeo-v2.png`, 2º `garras-lion.png`, 3º `lion-paw.png`. CSS en `.podium-crown-img` y `.rank-crown-img`.
- **PDF export** (solo admins): `printLeaderboardReport()` → fetch `/api/leaderboard` + `/api/leaderboard/detail` → `window.open`.

### Mobile CSS (`@media max-width: 768px`)

Overrides críticos:
- `.team-container`: `min-width: 0; flex: 1 1 0` — sin esto los escudos se salen del recuadro
- `.big-shield`: 46px, `.score-box`: 44×52px, `.score-container`: `flex-shrink: 0`
- Garras Saria: `.garras-vote-grid` y `.garras-ranking-grid` pasan a `grid-template-columns: 1fr`

## PWA

- **manifest.json**: `display: standalone`, `theme_color: #E41E26`.
- **sw.js**: pass-through total. No cachea nada.
- **Android**: captura `beforeinstallprompt` → banner rojo. Guard: `display-mode: standalone`.
- **iOS**: detecta `/iPhone|iPad|iPod/i` + `!navigator.standalone` → modal bottom sheet con pasos. Guard: `sessionStorage`.

## Key Patterns

- **`fetchWithRetry`** (app.js): inyecta Authorization header + `_cb=Date.now()` anti-cache. Siempre verificar `res.ok` antes de parsear JSON y validar que arrays sean `Array.isArray()` antes de llamar `.map()`.
- **`parseMatchDate(raw)`** (app.js): strippea la `Z` de TIMESTAMP naive del driver `pg`. Úsalo siempre que muestres fechas de partido.
- **Upsert predictions**: SELECT + INSERT/UPDATE manual (no ON CONFLICT) por schema legacy.
- **Borrar partidos**: `DELETE /api/matches/:id` rechaza con 400 si `is_finished = 1`.
- **Orden fijo por liga**: Athletic Club → Athletic Femenino → Bilbao Athletic, luego fecha ASC.

## PDF Reports

| Función | Pestaña | Quién puede | Fuente de datos |
|---|---|---|---|
| `printTrackerReport()` | Seguimiento | Admin | `_trackerData` (en memoria) |
| `printLeaderboardReport()` | Clasificación | Admin | `/api/leaderboard` + `/api/leaderboard/detail` |

## Env Vars (Vercel)

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Connection string Neon (PostgreSQL) |
| `JWT_SECRET` | Secret para firmar tokens JWT |
| `PASSWORD_ENCRYPTION_KEY` | 32 bytes base64 para AES-GCM (opcional) |

## Known Issues (pendientes de arreglar)

- **GARRAS SARIA en producción**: el tab muestra "Error al cargar la votación" en la primera visita. Causa pendiente de confirmar — puede ser timing de dbInit o cache de Vercel. Hacer Ctrl+Shift+R suele resolverlo.
- **JWT_SECRET con fallback público**: `server.js:57` tiene default hardcodeado.
- **Backdoor sin auth**: `GET /api/admin/emergency-reset-garras?key=GARRAS_SECRET_RESET_2026`.
- **Registro concede admin por nombre**: username `admin` o `garras` da `is_admin=1`.
- **`/api/leaderboard` público**: expone usernames sin autenticación.
- **Timezone backend**: deadline check acepta pronósticos 1-2h tarde (bug TIMESTAMP naive + UTC).
- **XSS en renderMatchCard**: `match.opponent` y `match.team` en `innerHTML` sin escapar.

## Teams & Logos

Equipos hardcodeados en `LEAGUE_TEAMS` (app.js). Escudos en `LOGO_MAP`, archivos en `public/logos/` organizados por competición (laliga/, ligaf/, rfef/, segunda/).
