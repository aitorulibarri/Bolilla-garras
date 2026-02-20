# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bolilla Garras is a football prediction game ("quiniela") for the Garras Taldea peña from Sestao. Users predict match scores and earn points based on accuracy.

## Architecture

This is a **dual-backend** application with both Python (Flask) and Node.js (Express) implementations:

- **server.js** (Node.js/Express) - Primary backend, deployed to Vercel
- **app.py** (Flask) - Alternative backend, local development option
- **public/** - Frontend (vanilla JS, CSS, HTML)
- **bolilla.db** - SQLite database (local), PostgreSQL for production

### Database Schema

Three main tables:
- **players** (or users) - User accounts with username, display_name, password_hash, is_admin
- **matches** - Football matches with team, opponent, match_date, deadline, home_goals, away_goals, is_finished
- **predictions** - User predictions linking player_name to match_id with home_goals, away_goals, points

### Points System (Official Rules 25/26)

- Exact score: **5 points**
- Partial (max 3 points):
  - Correct sign: +1
  - Correct goal difference: +1
  - Correct goals (home OR away): +2

## Common Commands

### Node.js Backend (Primary/Production)
```bash
npm install          # Install dependencies
npm start            # Run server.js on port 3000
npm run dev          # Same as start (dev mode)
```

### Python Backend (Alternative/Local)
```bash
pip install -r requirements.txt
python app.py        # Run Flask on port 5000
```

### Deployment
```bash
vercel deploy        # Deploy to Vercel
vercel --prod       # Production deployment
```

## Environment Variables

Create a `.env` file based on `.env.example`:

```bash
PORT=3000
SESSION_SECRET=<generate-with-openssl-rand-base64-32>
DATABASE_URL=       # Leave empty for local SQLite, set for PostgreSQL (Vercel)
```

## Key Files

| File | Purpose |
|------|---------|
| server.js | Express backend with PostgreSQL |
| app.py | Flask backend with SQLite |
| public/index.html | Main SPA entry point |
| public/app.js | Frontend JavaScript (API calls, UI logic) |
| public/styles.css | Frontend styles |
| vercel.json | Vercel deployment configuration |

## Admin Access

- Default admin username: `GARRAS` (Python/Flask) or `admin`/`aitor` (Node.js)
- Default password: `GARRAS123`
- Emergency reset endpoint (Python): `/api/emergency-reset-garras?key=GARRAS_SECRET_RESET_2026`

## API Endpoints (Node.js/server.js)

- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/matches` - Get all matches
- `GET /api/matches/upcoming` - Get upcoming matches with user predictions
- `POST /api/matches` - Create match (admin)
- `PUT /api/matches/:id/result` - Set match result (admin)
- `GET /api/predictions` - Get user predictions
- `POST /api/predictions` - Submit prediction
- `GET /api/leaderboard` - Get standings

## Development Notes

- The frontend uses vanilla JavaScript with no build step
- Both backends share similar API structures but differ in database handling
- Admin users are created automatically or via special username patterns
- Predictions cannot be modified once submitted (enforced by deadline check)
