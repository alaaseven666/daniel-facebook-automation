# Implementation Plan: Facebook Pages Automation — Local App

> Based on `app-prd.md` — Part One: Local Interface

---

## Project Structure

```
facebook_automation/
├── server.js               # Main Express server entry point
├── db.js                   # SQLite database init & helper functions
├── routes/
│   ├── upload.js           # POST /api/upload — media staging
│   ├── queue.js            # GET/POST /api/queue — queue read/write
│   └── pages.js            # GET/POST /api/pages — page manager & token update
├── public/
│   └── index.html          # Single-page frontend (all 4 screens)
├── media/                  # Uploaded media files (served publicly)
├── data/
│   └── automation.db       # SQLite database file
├── package.json
└── .env                    # Environment variables
```

---

## Phase 1 — Project Scaffolding

**Goal:** Get the project structure, dependencies, and environment variables in place.

### Steps
1. Initialize the project:
   ```bash
   npm init -y
   ```

2. Install dependencies:
   ```bash
   npm install express better-sqlite3 multer uuid node-cron dotenv cors
   npm install --save-dev nodemon
   ```

3. Create `.env` file:
   ```env
   PORT=3000
   DB_PATH=./data/automation.db
   MEDIA_DIR=./media
   PUBLIC_MEDIA_URL=http://localhost:3000/media
   ```

4. Add `scripts` to `package.json`:
   ```json
   "scripts": {
     "start": "node server.js",
     "dev": "nodemon server.js"
   }
   ```

5. Create required directories: `routes/`, `public/`, `media/`, `data/`.

---

## Phase 2 — Database Setup (`db.js`)

**Goal:** Initialize SQLite and expose helper functions used by all routes.

### Tasks
- On startup, run `CREATE TABLE IF NOT EXISTS` for both tables.
- Export typed helper functions for CRUD operations.

### Table: `pages`
```sql
CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id TEXT NOT NULL UNIQUE,
    page_name TEXT NOT NULL,
    access_token TEXT NOT NULL,
    token_expires_at TEXT,
    active INTEGER DEFAULT 1
);
```

### Table: `post_queue`
```sql
CREATE TABLE IF NOT EXISTS post_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    slot_number INTEGER NOT NULL,
    content_type TEXT NOT NULL,       -- 'photo' | 'reel' | 'story'
    media_url TEXT,
    caption TEXT,
    first_comment TEXT,
    comment_delay INTEGER DEFAULT 60,
    scheduled_at TEXT NOT NULL,
    status TEXT DEFAULT 'pending',    -- pending | scheduled | uploading | published | comment_posted | error
    fb_post_id TEXT,
    comment_status TEXT DEFAULT 'pending',
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
```

### Table: `settings`
> Additional table (not in PRD but needed for the Settings screen)
```sql
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

### Helper Functions to Export
| Function | Description |
| :--- | :--- |
| `getAllPages()` | Returns all active pages |
| `upsertPage(pageData)` | Insert or update a page record |
| `updatePageToken(page_id, token)` | Update access token for a page |
| `insertQueueItems(items[])` | Bulk insert post_queue rows for a batch |
| `getQueueByDate(date)` | Fetch all queue rows for a given posting_date |
| `updateQueueStatus(id, status, extras)` | Update status, fb_post_id, error_message |
| `getSetting(key)` | Read a setting value |
| `setSetting(key, value)` | Write/update a setting value |

---

## Phase 3 — Express Server (`server.js`)

**Goal:** Wire up all middleware, routes, static file serving, and the cleanup cron job.

### Tasks

1. **Load env, init DB, create Express app.**

2. **Middleware:**
   - `cors()` — allow all origins (internal tool)
   - `express.json()` — parse JSON bodies
   - `express.static('public')` — serve `index.html`
   - `express.static('media', { root: './media' })` — serve uploaded files at `/media`

3. **Mount routes:**
   ```js
   app.use('/api/upload', require('./routes/upload'));
   app.use('/api/queue',  require('./routes/queue'));
   app.use('/api/pages',  require('./routes/pages'));
   app.use('/api/settings', require('./routes/settings'));  // bonus
   ```

4. **Catch-all route:** `GET *` → serve `public/index.html` (SPA fallback).

5. **Cron job — media cleanup:**
   ```js
   // Runs daily at 02:00 — deletes media files older than 24h
   cron.schedule('0 2 * * *', () => {
     // fs.readdirSync('./media') → filter by mtime > 24h → fs.unlinkSync
   });
   ```

6. **Start server** on `PORT` from env.

---

## Phase 4 — API Routes

### 4.1 `routes/upload.js` — `POST /api/upload`

**Purpose:** Receive a media file from the frontend, save it with a UUID name, return the public URL.

- Use `multer` with `diskStorage` pointing to `./media/`.
- Filename: `uuid() + original extension`.
- Validate MIME type: allow `image/jpeg`, `image/png`, `video/mp4`, `video/quicktime`.
- Return: `{ url: "https://your-public-url/media/<uuid>.mp4" }`.

### 4.2 `routes/queue.js` — Queue read/write

| Route | Method | Purpose |
| :--- | :--- | :--- |
| `GET /api/queue` | Read | Returns today's post_queue rows. Accepts `?date=YYYY-MM-DD` param. |
| `POST /api/queue` | Write | Receives the full batch payload from the frontend, writes to post_queue, then forwards to n8n webhook. |
| `POST /api/queue/status` | Status callback | Receives status updates from n8n (page_id, batch_id, slot, status, fb_post_id, error_message) and updates the DB. |
| `POST /api/queue/retry` | Retry | Receives `{ queue_id }`, resets status to `pending`, re-sends the single item to n8n. |

**Submit logic (`POST /api/queue`):**
1. Parse payload (batch_id, posting_date, posts[]).
2. Validate: all 6 slots present, media_url populated, pages list not empty.
3. Bulk insert one row per post per page into `post_queue`.
4. Forward the full payload to the n8n webhook URL (fetched from settings).
5. Return `{ success: true, queued: N }` to frontend.

### 4.3 `routes/pages.js` — Page Manager

| Route | Method | Purpose |
| :--- | :--- | :--- |
| `GET /api/pages` | Read | Returns all pages from DB. |
| `POST /api/pages/sync` | Sync | Triggers n8n "Sync from Meta" webhook, then waits for the callback to populate DB. |
| `POST /api/pages/token` | Token update | Receives `{ page_id, access_token, token_expires_at }` from n8n, updates DB. |
| `POST /api/pages/refresh-tokens` | Refresh | Triggers n8n "Refresh All Tokens" webhook. |

### 4.4 `routes/settings.js` — Settings CRUD

| Route | Method | Purpose |
| :--- | :--- | :--- |
| `GET /api/settings` | Read | Returns all key-value settings as a JSON object. |
| `POST /api/settings` | Write | Accepts `{ key, value }` and upserts to settings table. |

**Default settings to seed on first run:**

| Key | Default Value |
| :--- | :--- |
| `n8n_webhook_url` | `""` |
| `n8n_status_callback_url` | `""` |
| `public_media_base_url` | `http://localhost:3000/media` |
| `default_comment_delay` | `60` |
| `default_first_post_time` | `15:00` |

---

## Phase 5 — Frontend (`public/index.html`)

**Goal:** Single-page app with 4 tab-based screens. Vanilla JS, no frameworks.

### 5.1 Design Principles
- Single `index.html` with all CSS in a `<style>` block and all JS in a `<script>` block.
- Tab navigation: `<nav>` with 4 buttons that show/hide `<section>` panels.
- Dark, premium design (consistent with the user's existing tool suite).

### 5.2 Screen 1 — Daily Post Queue Builder

**Layout:**
- **Top row (Global Settings):** Date picker, First Post Time picker. The app auto-displays the 6 calculated times (15:00 → 20:00).
- **6 Post Slot Cards** (accordion or card layout):
  - Slot label + auto-calculated time badge (read-only)
  - Content Type dropdown (Photo / Reel / Story)
  - Story checkbox (flag this slot as a story)
  - Media upload input + preview thumbnail
  - Caption textarea + live character counter (`X / 63,206`)
  - First Comment input
  - Comment Delay input (default from settings)
- **Page Selector:** Scrollable multi-checkbox list loaded from `GET /api/pages`.
  - "Select All" / "Deselect All" toggle buttons.
- **Submit button:** "Queue Posts"

**Submit flow (JS):**
1. Validate all 6 slots have content_type + media file + caption + first_comment.
2. Loop through slots: `POST /api/upload` for each media file → get public URL back.
3. Build JSON payload per schema in PRD §1.5.
4. `POST /api/queue` with full payload.
5. Show success toast or navigate to Queue Monitor.

### 5.3 Screen 2 — Queue Monitor

**Layout:**
- Date filter bar (defaults to today).
- Status summary row: badges showing count per status (Scheduled: N, Published: N, Error: N).
- Sortable table:
  | Page Name | Slot | Scheduled Time | Status | FB Post ID | Comment Status | Actions |
  | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
- Status color coding:
  - `pending/scheduled` → grey
  - `uploading` → blue
  - `published` → green
  - `comment_posted` → teal
  - `error` → red (show error message on hover/expand)
- **Retry button** per error row.
- **Auto-refresh:** `setInterval(() => fetchQueue(), 10000)`.

### 5.4 Screen 3 — Page Manager

**Layout:**
- Table of all pages: Page Name, Page ID, Token Status (green/red badge), Expires At.
- **"Sync from Meta"** button → `POST /api/pages/sync` → reload table.
- **"Refresh All Tokens"** button → `POST /api/pages/refresh-tokens`.
- Individual **"Edit Token"** inline input per row (manual override for emergency).

### 5.5 Screen 4 — Settings

**Layout:**
- Form with 5 labeled inputs (loaded from `GET /api/settings`).
- Each field has a **"Save"** button (or a single global Save).
- Public Media URL field shows the currently active URL with a copy button.
- Inline validation for URL fields.

---

## Phase 6 — Media Staging & Public Access

### Tasks

1. **Static serving:** Already handled by `express.static('media')` in server.js.
2. **ngrok setup:**
   - Install ngrok globally or via `npm install ngrok`.
   - Run `ngrok http 3000` before starting the daily workflow.
   - Copy the `https://*.ngrok.io` URL and paste it into the Settings → Public Media Base URL field.
3. **Automatic URL construction in upload route:**
   - Read `public_media_base_url` from settings at upload time.
   - Return `${baseUrl}/${filename}`.
4. **Cleanup cron:** Already wired in server.js (Phase 3, Step 5).

---

## Phase 7 — Testing Checklist

| # | Test | Expected Result |
| :--- | :--- | :--- |
| 1 | Run `npm run dev`, open `http://localhost:3000` | App loads, all 4 tabs visible |
| 2 | Navigate to Settings, save all 5 settings | Values persist after page refresh |
| 3 | Navigate to Page Manager, add a page manually | Page appears in the list with green token badge |
| 4 | Navigate to Queue Builder, fill all 6 slots, select 2 pages | Form validates without errors |
| 5 | Submit form with a test image | Upload completes, public URL returned, payload sent to n8n |
| 6 | Check n8n execution log | Full JSON payload visible with correct schema |
| 7 | Simulate n8n status callback (`POST /api/queue/status`) | Queue Monitor reflects status change within 10s |
| 8 | Simulate error row | Row appears in red; Retry button sends item back to n8n |
| 9 | Test public media URL from a phone/external network | File loads at the ngrok URL |
| 10 | Wait for 02:00 cron (or manually trigger cleanup) | Files older than 24h are deleted from `/media` |

---

## Implementation Order (Recommended)

```
Phase 1 → Phase 2 → Phase 3 → Phase 4.1 → Phase 4.2 (GET) → Phase 5.3 (Monitor shell)
→ Phase 5.1 (Queue Builder) → Phase 4.2 (POST) → Phase 5.4 (Settings)
→ Phase 4.3 (Pages) → Phase 5.4 (Page Manager) → Phase 6 → Phase 7
```

The key principle: **build the read path before the write path** so you always have a visible UI to test against.

---

## Dependencies Reference

| Package | Purpose |
| :--- | :--- |
| `express` | HTTP server |
| `better-sqlite3` | SQLite (sync API, ideal for single-user tools) |
| `multer` | Multipart file upload handling |
| `uuid` | UUID v4 for media filenames |
| `node-cron` | Scheduled cron jobs (media cleanup) |
| `dotenv` | Environment variable loading |
| `cors` | CORS middleware (optional for local use) |
| `nodemon` | Dev auto-restart (devDependency) |
