# Systems overview

High-level map of how the Deathless site fits together. For nitty-gritty “why” comments, see the source files (especially `client/js/blocks.js`). For endpoint shapes, see [api-map.md](api-map.md).

## Pages ↔ modules

| Page | HTML | Main JS | CSS |
|------|------|---------|-----|
| Home | `client/index.html` | `home.js` + `header.js` | `home.css` |
| Travelogue | `client/travelogue.html` | `travelogue.js` + `edit-chrome.js` + `blocks.js` | `travelogue.css` |
| Characters index | `client/characters.html` | `characters.js` + `header.js` | `characters.css` |
| Character detail | `client/character.html` | `character.js` + `edit-chrome.js` + `blocks.js` | `character.css` |

Shared client pieces:

- `api.js` — `/api` fetch + cookie credentials; errors expose `.status` / `.data`
- `auth-ui.js` — cookie restore, login, account / discard modals
- `blocks.js` — multi-voice entry render + edit + merge/save
- `edit-chrome.js` — floating Edit FAB + Save/Cancel footer
- `shared.css` — tokens, header, auth, edit chrome, cards, voice styles

## Auth

1. Writer logs in with slug + PIN → signed httpOnly cookie (`deathless_session`).
2. `initAuth()` calls `/api/auth/me` once per page; `getCurrentWriter()` mirrors that in memory.
3. Mutating APIs use `requireWriter` / `requireAdmin` on the server.
4. Edit FAB long-press opens the account sheet (log out / change writer).

## Voice-block editing

An **entry** (game-date chunk or character bio) is an ordered list of **blocks**. Each block has a writer, trimmed `body`, fractional `sortRank`, and `startsParagraph`.

- Display: client inserts a space between adjacent blocks, or a paragraph break when the next block starts a paragraph.
- Own voice (or admin): `contentEditable`; Enter is handled in JS (boundary flag flips vs mid-text split).
- Foreign voice: click inserts an empty commentary block at that point (may shorten the foreign block and create a continuation).
- Save: PUT with expected `version`. On **409**, client 3-way-merges `base` (edit-enter snapshot) + `local` DOM + `remote` payload and retries. Footer Save walks every editable entry on the page **one PUT at a time** (no batch transaction).
- Seed data still authors paragraphs as string arrays; the seed parser sets `startsParagraph` on the first block of each paragraph (see `scripts/seed.ts`).

Details live in `client/js/blocks.js` and `src/server/routes/entries.ts`.

## Edit chrome (mobile-aware)

- Tap FAB → edit (or login first); long-press → account.
- While typing, the site header can hide so the soft keyboard has room; scroll / blur / keyboard close restores it.
- Scroll direction hides/shows the FAB/footer.

See `client/js/edit-chrome.js`.

## Travelogue paging & Jump-to

- Sessions load in small pages (`limit=3`) with cursor `after` = last session `sortRank`.
- Infinite scroll watches a sentinel; Jump-to / `#entry-…` deep links call `ensureEntryInDom` (load until found).
- TOC omits prologue as a duplicate date row in the Jump-to list.

See `client/js/travelogue.js` and `src/server/routes/travelogue.ts`.

## Data model (short)

- `writers` — PIN hash, CSS voice class, admin flag
- `characters` — party / opc / npc metadata
- `entries` — session | game_date | character_bio; `version` for concurrency
- `blocks` — voice text under an entry; ordered by `sortRank` (COLLATE "C")

Fractional ranks let you insert between two neighbors without renumbering the whole list (`fractional-indexing` / `src/server/ranks.ts`).
