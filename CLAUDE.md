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
server.js             Express: JWT auth, rutas API, lógica de puntos
public/index.html     SPA entry point (scripts con ?v=5.2 para cache bust)
public/app.js         Toda la lógica frontend: API calls, render, estado, PWA
public/podium.js      Componente podio para la clasificación (top 3 con imágenes)
public/styles.css     Estilos
public/sw.js          Service Worker pass-through (no cache, respondWith)
public/manifest.json  PWA manifest (iconos en public/icons/)
public/icons/         icon-192.png, icon-512.png, icon-maskable-512.png (fondo blanco)
public/assets/        Logos e imágenes: garras-logo.png, trofeo.png,
                      garras-lion.png, lion-paw.png, athletic-logo.png
vercel.json           Config deploy: rutas, headers, builds
```

## Routing (vercel.json)

- `sw.js`, `app.js`, `podium.js`, `styles.css`, `index.html` → `no-cache, no-store`
- `/manifest.json` → `Content-Type: application/manifest+json`
- `/assets/(.*)` → `no-cache, no-store` (evita problemas al cambiar imágenes)
- `/api/(.*)` → `server.js`
- `(.*)` fallback → `server.js` (Express sirve el SPA)

**Cache busting de scripts**: los scripts se cargan con `?v=5.2` en index.html. Al modificar `app.js` o `podium.js` es suficiente con el header `no-cache`, pero si el navegador tiene caché previa de una versión anterior al no-cache, hay que incrementar la versión (`?v=5.3`, etc.).

**Imágenes en assets**: si se sustituye una imagen, usar siempre un **nombre de archivo nuevo** (ej. `trofeo-v2.png`). Vercel deduplica por hash de contenido — reemplazar el mismo fichero no garantiza invalidación en el CDN.

## Middleware stack (server.js)

Orden: `helmet` (CSP) → `compression` → `morgan` → `rateLimit` → `express.json` → rutas.

**CSP activa** — si añades un nuevo origen externo (script, font, imagen), añadirlo en la directiva de `helmet` en `server.js` Y en `<meta http-equiv="Content-Security-Policy">` de `index.html`.

**Rate limiting**: auth endpoints → 10 req/15 min. Resto de API → 100 req/15 min.

## Database

PostgreSQL en Neon. Tres tablas: `users`, `matches`, `predictions`. La conexión solo se activa si `DATABASE_URL` está presente (`IS_POSTGRES` flag). La inicialización es lazy: `dbInit()` se llama antes de cualquier query.

**Quirk crítico**: `predictions` en producción tiene columna legacy `user_id` (NOT NULL) que no está en el schema del código. El INSERT de predictions incluye `user_id` con fallback.

`predictions.player_name` almacena el **username** (no display_name). JOINs entre predictions y users deben usar `LOWER(player_name) = LOWER(username)`.

## Auth

JWT stateless, token en `localStorage` como `bolilla_token`. Duración: 24h. Middleware: `requireAuth` (JWT verify) → `requireAdmin`.

- Admin determinado por lista estática `ADMIN_USERNAMES` ['admin', 'garras'] O campo `is_admin` en DB.
- El JWT payload incluye `username` e `isAdmin`. En el frontend: `currentUser.isAdmin`.

**Contraseñas**: guardadas DOS veces — `password_hash` (bcrypt) y `password_encrypted` (AES-256-GCM). Clave: env `PASSWORD_ENCRYPTION_KEY` (32 bytes base64); si falta, se deriva de `JWT_SECRET`. Formato blob: `base64(iv):base64(tag):base64(ciphertext)`.

## Points System (`calculatePoints()` en server.js)

- Resultado exacto: **5 puntos**
- Parcial (máximo 3): signo correcto +1, diferencia de goles +1, goles de un equipo +2

## Clasificación (Leaderboard)

- **Tabla web**: columnas Rango / Jugador / Puntos / Plenos (sin columna Predicciones).
- **Iconos de puesto**: 1º `trofeo.png` (Copa del Rey), 2º `garras-lion.png` (león Athletic), 3º `lion-paw.png` (garra). Tamaño: 58px en tabla y podio. CSS en `.podium-crown-img` y `.rank-crown-img`.
- **PDF export** (solo admins): botón `#leaderboard-print-btn` visible si `currentUser.isAdmin`. Llama a `printLeaderboardReport()` que hace fetch de `/api/leaderboard` + `/api/leaderboard/detail` y genera HTML con `window.open`.
- **`/api/leaderboard/detail`** (requireAuth): devuelve predicciones de partidos `is_finished=1` con puntos por fila, para el PDF.

## PWA

La app es instalable como PWA:

- **manifest.json**: `display: standalone`, `theme_color: #E41E26`, `background_color: #ffffff`. Iconos PNG en `public/icons/` con fondo blanco (regenerar desde `assets/garras-logo.png` con `System.Drawing` en PowerShell si hacen falta).
- **sw.js**: pass-through. Tiene `install` (skipWaiting), `activate` (borra cachés antiguas), `fetch` con `event.respondWith(fetch(event.request))`. No cachea nada.
- **Install prompt (app.js)**:
  - Android: captura `beforeinstallprompt` → banner rojo con botón "Instalar". Guard: `display-mode: standalone`.
  - iOS: detecta `/iPhone|iPad|iPod/i` + `!navigator.standalone` → modal bottom sheet con pasos animados. Guard: `sessionStorage` para no repetir.

## Key Patterns

- **`fetchWithRetry`** (app.js): inyecta Authorization header + `_cb=Date.now()` anti-cache.
- **`parseMatchDate(raw)`** (app.js): strippea la `Z` de TIMESTAMP naive del driver `pg`. Úsalo siempre que muestres fechas de partido.
- **Upsert predictions**: SELECT + INSERT/UPDATE manual (no ON CONFLICT) por schema legacy.
- **Borrar partidos**: `DELETE /api/matches/:id` rechaza con 400 si `is_finished = 1`.
- **Orden fijo por liga**: Athletic Club → Athletic Femenino → Bilbao Athletic, luego fecha ASC.
- **Leaderboard agrega todas las ligas**: sin filtro por liga ni jornada.

## PDF Reports

Dos PDFs generados con `window.open` + `document.write`:

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

- **JWT_SECRET con fallback público**: `server.js:57` tiene default hardcodeado.
- **Backdoor sin auth**: `GET /api/admin/emergency-reset-garras?key=GARRAS_SECRET_RESET_2026`.
- **Registro concede admin por nombre**: username `admin` o `garras` da `is_admin=1`.
- **`/api/leaderboard` público**: expone usernames sin autenticación.
- **Timezone backend**: deadline check acepta pronósticos 1-2h tarde (bug TIMESTAMP naive + UTC).
- **XSS en renderMatchCard**: `match.opponent` y `match.team` en `innerHTML` sin escapar.

## Teams & Logos

Equipos hardcodeados en `LEAGUE_TEAMS` (app.js). Escudos en `LOGO_MAP`, archivos en `public/logos/` organizados por competición (laliga/, ligaf/, rfef/, segunda/).
