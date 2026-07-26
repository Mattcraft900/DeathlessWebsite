# DeathlessWebsite

Campaign log and character reference for the **Deathless** D&D home game in Mourne. Lucy’s travelogue (with Nemah’s bracketed asides) and party bios are stored in PostgreSQL and edited in-browser when logged in as a writer.

## Prerequisites

- Node.js 20+
- PostgreSQL via one of:
  - **Embedded Postgres** (no Docker): `npm run db:local` in a separate terminal
  - **Docker Compose**: `docker compose up -d`
  - **Neon** cloud connection string in `.env`

## Quick start (local)

### Option A — Embedded Postgres (no Docker)

```bash
npm install

# Terminal 1 — local Postgres on port 5433 (creates .env on first run)
npm run db:local

# Terminal 2
npm run db:setup
npm run dev
```

### Option B — Docker Postgres

```bash
docker compose up -d
cp .env.example .env
# DATABASE_URL=postgresql://deathless:deathless@localhost:5432/deathless

npm install
npm run db:setup
npm run dev
```

Open **http://localhost:3000**

### Default login

After seeding, every writer uses the PIN from `SEED_DEFAULT_PIN` (default **`deathless`**). Log in via **Writing as…** in the header. Change your PIN after first login.

Writers: Lucy (admin), Nemah, Luark, Enza, Chesco, DM.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Build client + compile server |
| `npm start` | Run production server |
| `npm run db:migrate` | Apply Drizzle migrations |
| `npm run db:seed` | Reset and seed writers, characters, travelogue |
| `npm run db:setup` | Migrate + seed |

## Pages

| URL | Description |
|-----|-------------|
| `/` | Home — Welcome to Mourne, party gallery |
| `/travelogue` | Lucy’s campaign log (infinite scroll) |
| `/characters` | Character gallery |
| `/characters/:slug` | Character detail + editable bio |

## Documentation

- [API map](docs/api-map.md) — REST endpoints
- [Deployment](docs/DEPLOY.md) — Neon, Render, env vars, cold starts

## Project layout

```
client/          Vite MPA (HTML, CSS, JS)
src/server/      Express API + auth
src/db/          Drizzle schema & migrations
scripts/         Database seed
docs/            API & deploy guides
```

## Remote database (Neon)

Set `DATABASE_URL` to your Neon connection string (with `sslmode=require`), then:

```bash
npm run db:setup
npm run dev
```

See [docs/DEPLOY.md](docs/DEPLOY.md) for production deployment on Render.
