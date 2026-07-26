# Deployment Guide

DeathlessWebsite is a Node.js Express app with a Vite-built static client and a PostgreSQL database (Drizzle ORM).

## Architecture

| Component | Recommended host | Notes |
|-----------|------------------|-------|
| PostgreSQL | [Neon](https://neon.tech) | Serverless Postgres; use connection string with `?sslmode=require` |
| App (API + static) | [Render](https://render.com) Web Service | Docker or Node build; serves API and built client |

## Environment variables

Set these on Render (and in local `.env`):

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `SESSION_SECRET` | Yes (prod) | Long random string for signed session cookies |
| `PORT` | No | Default `3000` (Render sets this automatically) |
| `NODE_ENV` | Prod | Set to `production` on Render |
| `SEED_DEFAULT_PIN` | Seed only | Default writer PIN when running `npm run db:seed` (default `deathless`) |

Copy `.env.example` to `.env` for local development.

## Local development without Docker

If Docker is not installed, use the embedded Postgres helper:

```bash
npm run db:local   # keeps Postgres alive on port 5433; Ctrl+C to stop
```

Point `DATABASE_URL` at `postgresql://postgres:postgres@127.0.0.1:5433/postgres` (written automatically into `.env` on first run), then `npm run db:setup`.

## Local development with Docker Postgres

```bash
# Start Postgres
docker compose up -d

# Configure env
cp .env.example .env
# DATABASE_URL=postgresql://deathless:deathless@localhost:5432/deathless

# Install & migrate & seed
npm install
npm run db:setup

# Run dev server (Express + Vite middleware)
npm run dev
```

Open http://localhost:3000

## Neon setup

1. Create a Neon project and database.
2. Copy the pooled or direct connection string.
3. Append `?sslmode=require` if not already present.
4. Paste into `DATABASE_URL` on Render and in local `.env` for remote dev.

Run migrations against Neon:

```bash
npm run db:migrate
npm run db:seed   # first deploy or when resetting content
```

## Render setup

1. Connect the GitHub repository.
2. **Build command:** `npm install && npm run build`
3. **Start command:** `npm start`
4. Add environment variables (`DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`).
5. After first deploy, run migrations/seed from your machine pointing at Neon, or use a one-off Render shell:

   ```bash
   npm run db:migrate && npm run db:seed
   ```

### Cold starts

Render free/starter tiers spin down after inactivity. The first request after idle may take **15–60 seconds** while the container starts. Symptoms:

- Slow first page load
- `/api/health` temporarily unreachable

Mitigations:

- Use a paid instance with always-on, or
- Set up an external uptime ping to `/api/health` every few minutes (optional; be aware of Neon/Render costs).

The health endpoint verifies database connectivity:

```
GET /api/health → { "ok": true, "db": true }
```

## PIN rotation

Each writer logs in with their slug + PIN. After seeding, all writers share `SEED_DEFAULT_PIN` (default `deathless`).

**Each player should:**

1. Log in as their writer via the header “Writing as…” control.
2. Click **Change PIN** and set a unique PIN (minimum 4 characters).

Admins (`lucy`) can edit any travelogue block; other writers can only edit their own voice blocks.

If a PIN is forgotten, an admin with database access can reset `writers.pin_hash` using bcrypt, or re-run the seed (which **wipes all content**).

## Production build output

- Client: `dist/client/` (Vite MPA: `index.html`, `travelogue.html`, etc.)
- Server: `dist/server/index.js`

Express serves static assets from `dist/client` in production and falls back to `client/` if needed.

## Docker Compose reference

`docker-compose.yml` runs Postgres 16 only:

```yaml
services:
  db:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: deathless
      POSTGRES_PASSWORD: deathless
      POSTGRES_DB: deathless
```

The app itself is not containerized in-repo; run it with `npm run dev` or deploy to Render.

## Static assets

Character portraits and site images live in `client/public/images/`. The seed script copies them from the legacy WDD131 project when available. Ensure these exist before deploy:

- `client/public/images/characters/{lucy,nemah,luark,enza,chesco}.jpg`
- `client/public/images/graveyard.jpg`
- `client/public/images/deathless_symbol.png`

## Troubleshooting

| Issue | Check |
|-------|-------|
| 503 on `/api/health` | `DATABASE_URL`, Neon IP allowlist, SSL mode |
| Login fails after seed | Confirm `SEED_DEFAULT_PIN`; cookies require same origin |
| Blank travelogue | Run `npm run db:seed` |
| Session lost in prod | `SESSION_SECRET` must be stable across deploys; cookie `secure` requires HTTPS |
