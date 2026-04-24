# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bolilla Garras es una quiniela de pronósticos de fútbol para la peña Garras Taldea de Sestao. Los usuarios pronostican resultados de partidos del Athletic Club, Athletic Femenino y Bilbao Athletic, y ganan puntos según la precisión.

## Commands

```bash
npm install          # Instalar dependencias
npm start            # Arrancar server.js en puerto 3000
vercel deploy        # Deploy preview
vercel --prod        # Deploy producción
```

No hay tests ni linter configurados. El backend Flask (`app.py`) es legacy y NO se usa en producción.

## Architecture

**Backend único**: `server.js` (Express + PostgreSQL en producción via Neon).

**Frontend SPA**: Vanilla JS en `public/` — sin build step, sin framework.

```
server.js          → Express backend (JWT auth, PostgreSQL via pg)
public/index.html  → SPA entry point
public/app.js      → Toda la lógica frontend (API calls, rendering, state)
public/podium.js   → Componente de podio para clasificación
public/styles.css  → Estilos
public/sw.js       → Service Worker (pass-through, no cache)
vercel.json        → Config de deploy (rutas, builds)
```

## Database

PostgreSQL en Neon. Tres tablas: `users`, `matches`, `predictions`.

**IMPORTANTE**: La tabla `predictions` en producción tiene una columna legacy `user_id` (NOT NULL) que NO está en el schema del código. El INSERT de predictions incluye `user_id` con fallback para schemas sin esa columna.

`predictions.player_name` almacena el **username** (no display_name). Cualquier query que cruce predictions con users debe hacer JOIN por `LOWER(player_name) = LOWER(username)`.

## Auth

JWT stateless. Token en `localStorage` como `bolilla_token`. No hay sesiones server-side.

- **Admin principal**: `GARRAS` / `GARRAS123`
- Admin se determina por lista estática `ADMIN_USERNAMES` O campo `is_admin` en DB
- Middleware chain: `requireAuth` (JWT verify) → `requireAdmin` (check admin)
- Emergency reset: `/api/admin/emergency-reset-garras?key=GARRAS_SECRET_RESET_2026`
- `JWT_SECRET` y `PASSWORD_ENCRYPTION_KEY` configurados como env vars en Vercel (no usar los defaults hardcoded)

## Password Storage

**Cada contraseña se guarda DOS veces** en `users`:
- `password_hash` — bcrypt, usado para autenticar (one-way).
- `password_encrypted` — AES-256-GCM, usado para que el admin vea el claro desde la pestaña Usuarios.

Clave de cifrado: env `PASSWORD_ENCRYPTION_KEY` (32 bytes base64). Si falta, `getEncryptionKey()` deriva una desde `JWT_SECRET` con SHA-256 — funciona pero acopla ambas claves.

Usuarios registrados antes de existir la columna `password_encrypted` la tienen en NULL: el login los actualiza de forma oportunista la primera vez que entran con la contraseña correcta. Hasta entonces, el admin los ve como "(no capturada)".

## Admin UI

Tres pestañas visibles solo si `currentUser.isAdmin`:
- **Admin** (`#tab-admin`): añadir partidos, gestionar partidos existentes (editar fecha/deadline, meter resultado, ver pronósticos por partido, borrar partido NO finalizado).
- **Usuarios** (`#tab-users`): tabla con todos los usuarios + acciones por fila: **🔎 Ver contraseña**, **✏️ Renombrar** (display_name), **🔑 Resetear** contraseña, **🗑️ Borrar** usuario (wipe también sus predictions). `GARRAS` y `admin` (ADMIN_USERNAMES) no se pueden borrar; un admin no puede auto-borrarse.
- **Seguimiento** (`#tab-tracker`): lista de partidos sin cerrar (`is_finished=0`), por cada uno muestra quién ha pronosticado (con su resultado) y quién falta. Incluye botón **🖨️ Imprimir / PDF** que abre una ventana nueva con un informe HTML imprimible **agrupado por usuario** (una sección por persona con todos sus pronósticos) — usa `window.print()` nativo, sin librerías.

## Points System

Implementado en `calculatePoints()` (server.js).

- Resultado exacto: **5 puntos**
- Parcial (máximo 3): signo correcto +1, diferencia goles +1, goles de un equipo +2

## Key Patterns

- **fetchWithRetry** (app.js): Inyecta Authorization header automáticamente. Los headers del caller se MERGEN (no sobreescriben) con el header de auth. Añade `_cb=Date.now()` para bust cache.
- **Deadline enforcement**: Frontend compara hora local, backend hora del servidor (UTC en Vercel). **Ojo**: la validación del servidor tiene bug de timezone — ver Known Issues.
- **Upsert predictions**: SELECT + INSERT/UPDATE manual (no ON CONFLICT) para compatibilidad con schema legacy.
- **Borrado de partidos**: `DELETE /api/matches/:id` **rechaza con 400 si `is_finished = 1`** para no perder los puntos ya sumados a la clasificación. Partidos sin resultado sí se pueden borrar (aún no puntúan).
- **Leaderboard agrega todas las ligas**: `/api/leaderboard` suma `points` de todas las predictions del usuario sin filtrar por liga ni jornada. Única tabla única para Athletic Club + Athletic Femenino + Bilbao Athletic.
- **Orden fijo por liga**: `/api/matches/upcoming` y `/api/admin/open-predictions` usan `ORDER BY CASE team WHEN 'Athletic Club' THEN 1 WHEN 'Athletic Femenino' THEN 2 WHEN 'Bilbao Athletic' THEN 3 END, match_date ASC` para mostrar siempre el primer equipo masculino → femenino → filial, por fecha ascendente dentro de cada grupo.
- **Timezone de match_date/deadline**: el driver `pg` devuelve los `TIMESTAMP` naive con sufijo `Z`, lo que hace que `new Date()` los interprete como UTC y `toLocaleString('es-ES')` los desplace +1/+2h. El helper `parseMatchDate(raw)` en `app.js` strippea la Z para parsear como local — úsalo siempre que muestres fechas de partido. El mismo bug afecta al check de deadline en el backend y sigue pendiente de arreglar.

## Deploy

Vercel con PostgreSQL en Neon. Auto-deploy al hacer `git push origin main` (integración GitHub). Variables de entorno en Vercel:
- `DATABASE_URL` — Connection string de Neon
- `JWT_SECRET` — Secret para firmar tokens JWT
- `PASSWORD_ENCRYPTION_KEY` — 32 bytes base64 para AES-GCM de `password_encrypted` (opcional; si falta, se deriva de JWT_SECRET)

## Teams Data

Equipos y rivales hardcodeados en `public/app.js` como `LEAGUE_TEAMS` (3 ligas). Escudos en `LOGO_MAP` con archivos en `public/logos/`.

## Known Issues (pending hardening)

Hallazgos del chaos testing (2026-04-23) aún sin resolver. Si vas a tocar auth/security, empieza por estos:

- **JWT_SECRET / PASSWORD_ENCRYPTION_KEY con fallback público**: `server.js:14` y `getEncryptionKey()` tienen valores por defecto hardcodeados. Si alguien olvida poner las env vars, cualquiera con acceso al repo forja tokens admin. Eliminar defaults y hacer que el server muera en startup si faltan.
- **Endpoint backdoor**: `GET /api/admin/emergency-reset-garras?key=GARRAS_SECRET_RESET_2026` (sin auth). La key está en el código. Eliminar.
- **Registro concede admin por nombre**: `POST /api/register` con `username='admin'` o `'garras'` da `is_admin=1` automáticamente. Quitar.
- **`/api/leaderboard` público sin auth**: expone usernames y display_names. Añadir `requireAuth`.
- **Timezone en deadline check del backend**: ver Key Patterns — el backend acepta pronósticos 1-2h después del deadline que el admin escribió.
- **XSS potencial en renderMatchCard**: `match.opponent` y `match.team` se inyectan en `innerHTML` sin escapar. Los otros renders admin sí tienen helper `esc()`.
- **No validación de `deadline <= matchDate`** al crear partidos (footgun admin, no riesgo).

Plan de trabajo completo en la task list de la sesión (`TaskList` tool).
