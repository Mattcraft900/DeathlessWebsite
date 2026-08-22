# DeathlessWebsite

Campaign log and character reference for the **Deathless** D&D home game in Mourne. Lucy’s travelogue (with Nemah’s bracketed asides) and party bios live in PostgreSQL and can be edited in-browser when logged in as a writer.

Built for the table: a shared place to read the campaign log, look up characters, and let each writer add their own voice without stepping on anyone else’s text.

**Live site:** [https://deathless.onrender.com](https://deathless.onrender.com)

The app is hosted on Render’s free tier, which spins the service down after inactivity. The first visit after idle can take **15–60 seconds** while it wakes up; refreshes after that should be normal. More detail: [docs/DEPLOY.md](docs/DEPLOY.md).

## Features

- **Travelogue** — Lucy’s session log with infinite scroll and jump-to navigation (including mobile)
- **Multi-voice blocks** — Entries are ordered voice blocks; writers edit their own text and can insert commentary into others’ passages
- **Characters** — Party gallery and per-character pages with editable bios
- **Writer auth** — PIN login, signed httpOnly session cookie, change-PIN and per-writer font/color settings
- **Edit chrome** — Floating edit controls tuned for desktop and mobile (including soft-keyboard behavior)
- **Concurrent saves** — Versioned updates with conflict detection and client-side merge on conflict

## Tech stack

- **Server:** Express + TypeScript
- **Client:** Vite multi-page app (HTML, CSS, JS)
- **Database:** PostgreSQL via Drizzle ORM
- **Auth:** Cookie sessions (PIN hashed with bcrypt)
- **Deploy:** Neon + Render (see [docs/DEPLOY.md](docs/DEPLOY.md))

## Pages

| URL | Description |
|-----|-------------|
| `/` | Home — Welcome to Mourne, party gallery |
| `/travelogue` | Lucy’s campaign log (infinite scroll) |
| `/characters` | Character gallery |
| `/characters/:slug` | Character detail + editable bio |

## Project layout

```
client/          Vite MPA (HTML, CSS, JS)
src/server/      Express API + auth
src/db/          Drizzle schema & migrations
scripts/         Database seed
docs/            API & deploy guides
```

More detail: [systems overview](docs/systems-overview.md), [API map](docs/api-map.md).

## Local development

**Prerequisites:** Node.js 20+, and PostgreSQL via embedded Postgres, Docker Compose, or a Neon connection string.

### Quick start (embedded Postgres)

```bash
npm install

# Terminal 1 — local Postgres on port 5433 (creates .env on first run)
npm run db:local

# Terminal 2
npm run db:setup
npm run dev
```

Open **http://localhost:3000**

Docker or Neon instead? See [docs/LOCAL-DATABASES.md](docs/LOCAL-DATABASES.md). Production deploy: [docs/DEPLOY.md](docs/DEPLOY.md).

### Default login

After seeding, writers share the PIN from `SEED_DEFAULT_PIN` (default **`deathless`**). Log in via **Writing as…** in the header; change your PIN after first login.

Writers: Lucy (admin), Nemah, Luark, Enza, Chesco, DM.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Build client + compile server |
| `npm start` | Run production server |
| `npm run db:migrate` | Apply Drizzle migrations |
| `npm run db:seed` | Reset and seed writers, characters, travelogue |
| `npm run db:setup` | Migrate + seed |

## Roadmap

See [TODO.md](TODO.md) for planned work.
