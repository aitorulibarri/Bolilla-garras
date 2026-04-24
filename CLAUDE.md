# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Bolilla Garras — quiniela de pronósticos de fútbol para la peña Garras Taldea de Sestao. Los usuarios pronostican resultados de partidos del Athletic Club, Athletic Femenino y Bilbao Athletic.

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
server.js           Express: JWT auth, rutas API, lógica de puntos
public/index.html   SPA entry point
public/app.js       Toda la lógica frontend: API calls, render, estado
public/podium.js    Componente podio para la clasificación
public/styles.css   Estilos
public/sw.js        Service Worker pass-through (no cache, respondWith)
public/manifest.json  PWA manifest (iconos en public/icons/)
public/icons/       icon-192.png, icon-512.png, icon-maskable-512.png
vercel.json         Config deploy: rutas, headers, builds
```

### Routing (vercel.json)

- `/sw.js` → `public/sw.js` con `Service-Worker-Allowed: /` y `Cache-Control: no-cache`
- `/manifest.json` → `public/manifest.json` con `Content-Type: application/manifest+json`
- `app.js`, `styles.css`, `index.html` → `no-cache, no-store` (siempre frescos)
- `/api/(.*)` → `server.js`
- `(.*)` fallback → `server.js` (Express sirve el SPA)

### Middleware stack (server.js)

Orden: `helmet` (CSP) → `compression` → `morgan` → `rateLimit` → `express.json` → rutas.

**CSP activa** — si añades un nuevo origen externo (script, font, imagen), debes añadirlo también en la directiva correspondiente de `helmet` en `server.js` Y en el `<meta http-equiv="Content-Security-Policy">` de `index.html`.

**Rate limiting**: auth endpoints (`/api/login`, `/api/register`) → 10 req/15 min. Resto de API → 100 req/15 min.

## Database

PostgreSQL en Neon. Tres tablas: `users`, `matches`, `predictions`. La conexión solo se activa si `DATABASE_URL` está presente (`IS_POSTGRES` flag). La inicialización es lazy: `dbInit()` se llama antes de cualquier query y ejecuta las migraciones de schema si son necesarias.

**Quirk crítico**: `predictions` en producción tiene columna legacy `user_id` (NOT NULL) que no está en el schema del código. El INSERT de predictions incluye `user_id` con fallback.

`predictions.player_name` almacena el **username** (no display_name). JOINs entre predictions y users deben usar `LOWER(player_name) = LOWER(username)`.

## Auth

JWT stateless, token en `localStorage` como `bolilla_token`. Duración: 24h. Middleware: `requireAuth` (JWT verify) → `requireAdmin`.

- Admin determinado por lista estática `ADMIN_USERNAMES` ['admin', 'garras'] O campo `is_admin` en DB.
- El JWT payload incluye `username` e `isAdmin`.

**Contraseñas**: guardadas DOS veces — `password_hash` (bcrypt, para login) y `password_encrypted` (AES-256-GCM, para que el admin la vea en claro). Clave de cifrado: env `PASSWORD_ENCRYPTION_KEY` (32 bytes base64); si falta, se deriva de `JWT_SECRET`. Formato del blob cifrado: `base64(iv):base64(tag):base64(ciphertext)`.

## Points System (`calculatePoints()` en server.js)

- Resultado exacto: **5 puntos**
- Parcial (máximo 3): signo correcto +1, diferencia de goles +1, goles de un equipo +2

## Key Patterns

- **`fetchWithRetry`** (app.js): inyecta Authorization header + `_cb=Date.now()` anti-cache. Los headers del caller se mergean, no sobreescriben.
- **`parseMatchDate(raw)`** (app.js): strippea la `Z` que añade el driver `pg` a TIMESTAMP naive para evitar el desplazamiento UTC→local. Úsalo siempre que muestres fechas de partido.
- **Upsert predictions**: SELECT + INSERT/UPDATE manual (no ON CONFLICT) por compatibilidad con schema legacy.
- **Borrar partidos**: `DELETE /api/matches/:id` rechaza con 400 si `is_finished = 1`.
- **Orden fijo por liga**: upcoming y open-predictions ordenan Athletic Club → Athletic Femenino → Bilbao Athletic, luego fecha ASC dentro de cada grupo.
- **Leaderboard agrega todas las ligas**: suma points de todas las predictions sin filtrar por liga.

## PWA

La app es instalable como PWA. Componentes:

- `public/manifest.json`: `display: standalone`, `theme_color: #E41E26`, iconos PNG en `public/icons/` (192, 512, maskable-512 — generados desde `assets/garras-logo.png`).
- `public/sw.js`: Service Worker pass-through. Tiene `install` (skipWaiting), `activate` (borra cachés antiguas), y `fetch` con `event.respondWith(fetch(event.request))`. No cachea nada — crítico para que la API siempre vaya a red.
- **Install prompt en app.js**: captura `beforeinstallprompt` (Android/Chrome) y muestra banner rojo. En iOS detecta `/iPhone|iPad|iPod/i` + `!navigator.standalone` y muestra instrucciones manuales. El banner no aparece si ya instalado (`display-mode: standalone`) ni si el usuario lo cerró (`sessionStorage`).

## Env Vars (Vercel)

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Connection string Neon (PostgreSQL) |
| `JWT_SECRET` | Secret para firmar tokens JWT |
| `PASSWORD_ENCRYPTION_KEY` | 32 bytes base64 para AES-GCM (opcional, se deriva de JWT_SECRET si falta) |

## Known Issues (pendientes de arreglar)

- **JWT_SECRET con fallback público**: `server.js:57` tiene default hardcodeado. Si falta la env var, cualquiera con el repo puede forjar tokens admin.
- **Backdoor sin auth**: `GET /api/admin/emergency-reset-garras?key=GARRAS_SECRET_RESET_2026` — la key está en el código.
- **Registro concede admin por nombre**: registrarse con username `admin` o `garras` da `is_admin=1`.
- **`/api/leaderboard` público**: expone usernames sin autenticación.
- **Timezone backend**: el check de deadline en el servidor acepta pronósticos 1-2h tarde por bug de timezone (driver `pg` + TIMESTAMP naive).
- **XSS en renderMatchCard**: `match.opponent` y `match.team` se inyectan en `innerHTML` sin escapar. Los renders admin usan helper `esc()` — extender a renderMatchCard.

## Teams & Logos

Equipos hardcodeados en `LEAGUE_TEAMS` (app.js). Escudos en `LOGO_MAP` con archivos en `public/logos/` organizados por competición (laliga/, ligaf/, rfef/, segunda/).
