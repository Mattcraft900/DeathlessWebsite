# Local vs cloud databases

This project can talk to **different Postgres databases** depending on what `DATABASE_URL` is set to in `.env` (locally) or in Render’s Environment settings (production).

The website code does not care which one you use. It only uses the connection string you give it.

## The three options

| Mode | `DATABASE_URL` points at | Start the DB with | Typical use |
|------|--------------------------|-------------------|-------------|
| **Embedded Postgres** | `postgresql://postgres:postgres@127.0.0.1:5433/postgres` | `npm run db:local` | Local coding without Docker |
| **Docker Postgres** | `postgresql://deathless:deathless@localhost:5432/deathless` | `docker compose up -d` | Local coding with a “real” Postgres box |
| **Neon (cloud)** | Your Neon string (`?sslmode=require`) | Nothing — Neon is always in the cloud | Live site on Render; also migrate/seed prod from your laptop |

Only **one** URL should be active in your local `.env` at a time.

## Mental model

```text
Your browser  →  the app (local :3000 OR deathless.onrender.com)
                      ↓
                 DATABASE_URL
                      ↓
         embedded / Docker / Neon  (whichever you configured)
```

- **https://deathless.onrender.com** always uses whatever `DATABASE_URL` is set to **on Render** (should be Neon).
- **http://localhost:3000** uses whatever is in **your laptop’s `.env`**.

Editing the live Render site does **not** change your embedded/Docker database, and vice versa, unless both are accidentally pointed at the same Neon URL.

---

## Embedded Postgres (no Docker)

### Why it exists

A Node package downloads/runs Postgres into the `.pgdata/` folder so you can develop without installing Docker or a system-wide Postgres.

### Day-to-day

1. In `.env`, set:
   ```env
   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres
   ```
2. Terminal 1: `npm run db:local`  
   Leave it open. You should see something like “Embedded Postgres running on port 5433”.
3. First time only (or after wiping `.pgdata`):
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
4. Terminal 2: `npm run dev`
5. Open http://localhost:3000

### Quitting and coming back

- Closing the `db:local` terminal may leave Postgres running, or leave a lock file. The script tries to reuse `.pgdata` and handle stale locks.
- After a full PC reboot, start again with `npm run db:local`, then `npm run dev`.
- You usually **do not** re-run seed unless you want to reset content.

### Wipe local embedded data

1. Stop `db:local` / any leftover postgres.
2. Delete the `.pgdata/` folder.
3. `npm run db:local` → `npm run db:migrate` → `npm run db:seed`.

---

## Docker Postgres (optional, later)

### Why it can help

- Closer to how many teams run “Postgres on my laptop”
- Skill transfers to other projects
- Sometimes fewer quirks than embedded helpers on Windows

### What you need

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and leave it running.
2. Confirm: `docker --version`

The repo already has `docker-compose.yml`.

### Day-to-day

1. In `.env`:
   ```env
   DATABASE_URL=postgresql://deathless:deathless@localhost:5432/deathless
   ```
2. `docker compose up -d`
3. First time: `npm run db:migrate` then `npm run db:seed`
4. `npm run dev` → http://localhost:3000
5. When done: `docker compose down`  
   (Data usually persists. `docker compose down -v` wipes the local DB volume.)

You do **not** need `npm run db:local` while using Docker.

---

## Neon + Render (live site)

- **Render** runs the Node app.
- **Neon** holds production data.
- Render’s dashboard env var `DATABASE_URL` must be the Neon string.

### Fill or reset Neon from your laptop

1. Put the Neon URL in **local** `.env` as `DATABASE_URL`.
2. Run:
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
3. Refresh https://deathless.onrender.com  

**Warning:** `db:seed` **wipes and reloads** wiki content on whatever database `.env` points at. Do not seed Neon casually if friends have already written real entries.

---

## How to test that wiki edits hit the database

### A) Test on the **live** site (Neon)

This is what you want if you’re checking Render.

1. Open https://deathless.onrender.com  
2. Header → **Writing as…** / **Log in** → pick a writer (e.g. Nemah) → PIN `deathless` (or your changed PIN).  
3. Go to **Campaign Log** or a character bio.  
4. You should see **Save** on editable entries.  
5. Click a passage in someone else’s voice to insert commentary (or edit your own text), type something unique you’ll recognize (e.g. `TEST EDIT 001`), click **Save**.  
6. Hard-refresh the page (Ctrl+F5). The text should still be there → it was stored in **Neon**.  
7. Optional: open the site in a private/incognito window (logged out) and confirm the same text is visible to guests.

You are **not** using the embedded DB for this test unless Render’s `DATABASE_URL` were somehow local (it can’t be — Render can’t see your laptop’s Postgres).

### B) Test on **localhost** (embedded or Docker)

1. Point `.env` at embedded (`5433`) or Docker (`5432`).  
2. Start that DB (`db:local` or `docker compose up -d`).  
3. `npm run dev` → http://localhost:3000  
4. Log in and edit/save the same way.  
5. Refresh — if it sticks, that **local** DB got the write.

To prove localhost and Neon are separate: make a silly edit only on localhost; it should **not** appear on deathless.onrender.com (and the reverse).

---

## Quick “which DB am I on?” checklist

| You’re looking at… | Database behind it |
|--------------------|--------------------|
| `deathless.onrender.com` | Neon (Render env) |
| `localhost:3000` + `.env` has `5433` | Embedded |
| `localhost:3000` + `.env` has `5432` + compose up | Docker |
| `localhost:3000` + `.env` has a Neon URL | Neon (same as prod — be careful) |

---

## Related commands

| Command | Meaning |
|---------|---------|
| `npm run db:local` | Start embedded Postgres |
| `docker compose up -d` | Start Docker Postgres |
| `npm run db:migrate` | Create/update tables on the DB in `.env` |
| `npm run db:seed` | Reset + load starter content on that DB |
| `npm run dev` | Run the app locally |
| `npm start` | Run the production build locally (after `npm run build`) |
