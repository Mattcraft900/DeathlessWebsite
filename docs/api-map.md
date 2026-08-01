# API Map

Base URL: `/api`. All endpoints return JSON unless noted. Session auth uses the `deathless_session` HTTP-only cookie set by `POST /api/auth/login`.

## Health

### `GET /api/health`

**Use case:** Liveness check for deploy platforms and local dev.

**Auth:** None

**Response 200:**
```json
{ "ok": true, "db": true }
```

**Response 503** (database unreachable):
```json
{ "ok": false, "db": false }
```

---

## Auth

### `GET /api/auth/me`

**Use case:** Determine whether the browser has a valid writer session; drives the “Writing as…” header.

**Auth:** Optional (reads cookie if present)

**Response 200:**
```json
{
  "writer": {
    "id": "uuid",
    "slug": "lucy",
    "displayName": "Lucy",
    "cssClass": "voice-lucy",
    "handwritingColor": "#6a2218",
    "handwritingFont": "Indie Flower",
    "isAdmin": true
  }
}
```
`writer` is `null` when not logged in. `handwritingColor` / `handwritingFont` are `null` until the writer saves custom values on Settings (font then falls back to the site paragraph font; color falls back to the voice CSS default).

---

### `GET /api/auth/writers`

**Use case:** Populate the login dropdown with available writer personas (no PINs); also used by Settings handwriting preview.

**Auth:** None

**Response 200:**
```json
{
  "writers": [
    {
      "id": "uuid",
      "slug": "lucy",
      "displayName": "Lucy",
      "cssClass": "voice-lucy",
      "handwritingColor": null,
      "handwritingFont": null,
      "isAdmin": true
    }
  ]
}
```

---

### `POST /api/auth/login`

**Use case:** Authenticate a writer with slug + PIN; sets session cookie.

**Auth:** None

**Body:**
```json
{ "slug": "lucy", "pin": "deathless" }
```

**Response 200:** same `writer` shape as `/me` (including handwriting fields).

---

### `POST /api/auth/logout`

**Use case:** Clear session cookie.

**Auth:** None (clears cookie regardless)

**Response 200:** `{ "ok": true }`

---

### `POST /api/auth/change-pin`

**Use case:** Logged-in writer rotates their own PIN.

**Auth:** Required (session cookie)

**Body:**
```json
{ "currentPin": "deathless", "newPin": "new-secret" }
```

**Response 200:** `{ "ok": true }`

**Response 400:** Invalid body (new PIN must be ≥ 4 characters)

**Response 401:** Wrong current PIN or not logged in

---

### `POST /api/auth/handwriting`

**Use case:** Logged-in writer updates their stylized handwriting color and Google Fonts family name (Settings page).

**Auth:** Required (session cookie)

**Body:**
```json
{ "color": "#7a3d62", "font": "Kalam" }
```
`font` may be `""` to clear a custom font (revert to paragraph font). `color` is required hex (`#rrggbb`).

**Response 200:**
```json
{
  "writer": {
    "id": "uuid",
    "slug": "nemah",
    "displayName": "Nemah",
    "cssClass": "voice-nemah",
    "handwritingColor": "#7a3d62",
    "handwritingFont": "Kalam",
    "isAdmin": false
  }
}
```

**Response 400:** Invalid color or font string

**Response 401:** Not logged in

---

## Characters

### `GET /api/characters`

**Use case:** Character gallery (home page party mugs, full character list page).

**Auth:** None

**Response 200:**
```json
{
  "characters": [
    {
      "id": "uuid",
      "slug": "lucy",
      "name": "Lucy",
      "fullName": "Lucy",
      "gender": "female",
      "species": "human",
      "age": "20-ish",
      "category": "party",
      "snippet": "Level 6 Warlock of the Fiend",
      "level": 6,
      "classes": [{ "class": "warlock", "level": 6, "subclass": "the fiend" }],
      "playerName": "Matthew"
    }
  ]
}
```

Ordered by `sortRank`.

---

### `GET /api/characters/:slug`

**Use case:** Single character detail page with biography blocks.

**Auth:** None

**Params:** `slug` — character slug (e.g. `lucy`)

**Response 200:**
```json
{
  "character": {
    "id": "uuid",
    "slug": "lucy",
    "name": "Lucy",
    "fullName": "Lucy",
    "gender": "female",
    "species": "human",
    "age": "20-ish",
    "category": "party",
    "snippet": "...",
    "level": 6,
    "classes": [],
    "playerName": "Matthew",
    "locationHome": null,
    "locationLast": null
  },
  "bio": {
    "id": "uuid",
    "type": "character_bio",
    "version": 1,
    "blocks": [
      {
        "id": "uuid",
        "entryId": "uuid",
        "writerId": "uuid",
        "body": "...",
        "sortRank": "a0",
        "writerSlug": "lucy",
        "writerCssClass": "voice-lucy",
        "writerDisplayName": "Lucy",
        "writerHandwritingColor": null,
        "writerHandwritingFont": null
      }
    ]
  }
}
```

`bio` is `null` if no biography entry exists.

**Response 404:** Unknown slug

---

## Travelogue

### `GET /api/travelogue/toc`

**Use case:** Table of contents for the travelogue “Jump to…” list (sessions with nested unique in-game dates, in document order).

**Auth:** None

**Response 200:**
```json
{
  "sessions": [
    {
      "id": "uuid",
      "title": "6.13.26 - \"Saint Dane\"",
      "sortRank": "a0",
      "dates": [
        {
          "dateKey": "568-07-13",
          "title": "7 / 13 / 568",
          "anchorEntryId": "uuid"
        }
      ]
    }
  ]
}
```

---

### `GET /api/travelogue/sessions`

**Use case:** Paginated session loader for infinite scroll on the travelogue page.

**Auth:** None

**Query params:**

| Param | Default | Description |
|-------|---------|-------------|
| `limit` | `3` | Sessions per page (max 20) |
| `after` | — | `sortRank` cursor from previous page's `nextCursor` |

**Response 200:**
```json
{
  "sessions": [
    {
      "id": "uuid",
      "type": "travelogue_session",
      "title": "Prologue",
      "sortRank": "a0",
      "gameDates": [
        {
          "id": "uuid",
          "type": "game_date",
          "title": null,
          "dateKey": "prologue",
          "showHeading": false,
          "version": 1,
          "sortRank": "a0",
          "blocks": [ /* same shape as character bio blocks */ ]
        }
      ]
    }
  ],
  "nextCursor": "a2"
}
```

`nextCursor` is `null` when there are no more sessions.

---

### `POST /api/travelogue/sessions`

**Use case:** Admin creates a new real-world session (optionally with an empty game-date chunk).

**Auth:** Admin session required

**Body:**
```json
{
  "title": "7.11.26 - \"Example\"",
  "createEmptyDate": true,
  "dateKey": "568-08-01",
  "dateTitle": "8 / 1 / 568",
  "showHeading": true
}
```

**Response 201:**
```json
{
  "session": { /* entry row */ },
  "gameDate": { /* entry row or null */ }
}
```

**Response 400:** Missing title

**Response 401 / 403:** Not logged in or not admin

---

## Entries

### `GET /api/entries/:id`

**Use case:** Fetch a single entry with blocks (game-date chunk or character bio).

**Auth:** None

**Response 200:**
```json
{
  "entry": {
    "id": "uuid",
    "type": "game_date",
    "title": "7 / 13 / 568",
    "parentId": "uuid",
    "characterId": null,
    "dateKey": "568-07-13",
    "sortRank": "a0",
    "showHeading": true,
    "version": 1,
    "blocks": [ /* block rows with writer metadata */ ]
  }
}
```

**Response 404:** Unknown id

---

### `PUT /api/entries/:id/blocks`

**Use case:** Save edited blocks for a game-date entry or character bio. Optimistic concurrency via `version`.

**Auth:** Writer session required

**Body:**
```json
{
  "version": 1,
  "blocks": [
    {
      "id": "uuid",
      "writerId": "uuid",
      "body": "Updated text",
      "sortRank": "a0"
    },
    {
      "writerId": "uuid",
      "body": "New block",
      "sortRank": "a1"
    }
  ]
}
```

New blocks omit `id`. Blocks omitted from the array are deleted (if permitted).

**Permissions:**

- Non-admin writers may only create blocks with their own `writerId`.
- Non-admin writers may only edit or delete their own existing blocks.
- Admin (`lucy`) may edit any block.

**Response 200:** `{ "entry": { ...entry, blocks: [...] } }` with incremented `version`

**Response 400:** Invalid payload, unknown block id, or saving blocks on a session entry

**Response 401:** Not logged in

**Response 403:** Permission violation

**Response 409:** Version conflict — body includes fresh `entry` + `blocks` for merge/retry

---

## Error shape

Most errors:
```json
{ "error": "Human-readable message" }
```

Version conflicts additionally include the current entry snapshot (see `PUT /api/entries/:id/blocks`).
