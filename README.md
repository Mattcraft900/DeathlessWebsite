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
- [Deploy](docs/DEPLOY.md) — Neon + Render
- [Local databases](docs/LOCAL-DATABASES.md) — embedded vs Docker vs Neon, and how to test edits

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


## To-Do List Items


### Bug Fixes 

- [x] Fix multiple-user concurrency issues
- [x] Fix weird insert block position bugs
- [ ]

### Wanted for MVP

- [x] Move the "Writing as" dropdown.
- [ ] Standardize white space between voice blocks
- [ ] Implement a route for players to change their PIN
- [ ] Restore old site layouts
- [ ] Test infinite scrolling/jump-to functions on the travelogue.
    - Will need to first generate tons of placeholder entries for the travelogue
- [ ] Refactor the logo as SVG + get favicon files
- [ ] Figure out a better method of "simplified" styles for six different voices. 
    - Curently they're all just italicized except Lucy.
    - Possibly use some kind of brackets with character name in caps &lt;LUARK: like this, for example&gt;.


### Non-MVP

- [ ] Color palette overhaul
- [ ] Rich-text/WYSIWYG editor while editing
    - [ ] Include undo/redo buttons (primarily for mobile)
- [x] Persistent header(s)
- [ ] UX for adding new travelogue entries
- [ ] UX for adding new characters
- [ ] UX for players to update their own font & color (same place as reset PIN?)
- [ ] "Dirty warnings" on navigation or reload while in Edit mode



### Current task: "Writing as" move

#### List items:

I'd like to revamp the UX for the "Writing as..." selection.
First, let's change up how the writer gets selected entirely.
    - No more dropdown in the global header; instead, there will be a floating button in the corner of the screen (only on pages with entries, though) that has an Edit icon. This button leaves/returns based on scroll behavior, similar to the edit button in the Google Docs mobile app.
    - When the button is clicked, it THEN opens a small modal in the middle of the screen prompting the user to select a writer & enter password.
While in "Edit mode," (i.e. after entering a valid writer & password), the Edit button is replaced with a small, semi-persistent footer (again, affected by scroll behavior like Google Docs mobile app) containing two buttons: one that says "Save" and one that says "Cancel." 
    - Pressing the Save button saves the changes to the database, exactly the same as the current Save behavior.
    - Pressing the Cancel button will display a small modal with a brief confirmation message explaining that all unsaved changes will be lost (buttons on this modal are a sharp "Cancel" and backgroundless "Keep Editing", both given equal space). Hitting Cancel in the modal discards all changes made without touching the DB.
    - Both routes (Save or Cancel [if followed through]) cause the user to leave "Edit mode". If possible/viable, I'd like for the user to not have to re-enter their writer/password as long as they stay on the same page, after both Save and Cancel (i.e. pressing the Edit button again on the same page takes them staight to Edit mode, no modal).
Utilize mobile-first design principles while implementing all of these changes.