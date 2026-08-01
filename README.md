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

- [Systems overview](docs/systems-overview.md) — pages, auth, voice-block editing, travelogue paging
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
- [x] Standardize white space between voice blocks
- [x] Margin disappears immediately on collapse Jump To menu (mobile)

### Wanted for MVP

- [x] Move the "Writing as" dropdown.
- [ ] Implement a route for players to change their PIN
- [x] Restore old site layouts
- [x] Test infinite scrolling/jump-to functions on the travelogue.
    - [x] Implement jump-to menu(s) for mobile
    - Will need to first generate tons of placeholder entries for the travelogue
- [x] Refactor the logo as SVG + get favicon files
- [ ] Figure out a better method of "simplified" styles for six different voices. 
    - Curently they're all just italicized except Lucy.
    - Possibly use some kind of brackets with character name in caps &lt;LUARK: like this, for example&gt;.


### Non-MVP

- [ ] Touch up page intro blurbs
- [ ] Rich-text/WYSIWYG editor while editing
    - At least include functionality for bold/italics/strikethrough
    - [ ] Include undo/redo buttons (primarily for mobile)
- [ ] On a *new branch*, try out pagination instead of infinite scroll on the travelogue page
- [ ] UX for adding new travelogue entries
- [ ] UX for adding new characters
- [x] UX for players to update their own font & color (same place as reset PIN?)
- [ ] "Dirty warnings" on navigation or reload while in Edit mode
- [ ] Allow players to edit/add their own character's stats on the character page

#### Style

- [x] Color palette overhaul
- [x] Find a good subheading font
- [x] Persistent header(s)
    - [ ] Sticky headings for travelogue session entries & character list categories
- [x] Box shadow around Deathless title
- [x] Travelogue sidebars:
    - remove/change coloring on format options section
    - Center checkbox vertically for hiding session names
    - Shrink/clamp text on right sidebar to remove the horizontal scroll
    - Add top margin for both so they don't look so high compared to the travelogue content
- [ ] Dark Mode

- [ ] Code practices standardizations:
    - [x] tab width from 2 -> 4
    - [x] COMMENT BLOCKS PLEASE
    - [x] Ensure aria tags are all appropriately assigned
    - [x] reorganize/standardize class selectors, et. al. to provide for more consistent formatting across the whole site
    - [ ] Get rid of dead code, streamline repetitive code
    

### Current task: 

#### List items:
