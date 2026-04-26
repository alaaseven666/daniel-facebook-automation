# Facebook Pages Automation System - App PRD

## System Overview
The Facebook Pages Automation System replaces a manual daily workflow of publishing 6 posts + 2 stories across 20 Facebook Pages, each followed by a first comment containing a partner link. The system consists of three integrated layers:

| Feature | Description |
| :--- | :--- |
| **Goal** | Eliminate 2+ hours of manual daily work while maintaining full control over scheduling, content, and timing. |
| **Scope** | 20 Facebook Pages. 6 feed posts + 2 stories per page per day. Each post followed by a delayed first comment with a link. |
| **Post Window** | 15:00 to 20:00 local time. One post per hour, published simultaneously across all 20 pages. |
| **Content Types** | Photos (images with caption), Reels (short-form video), Stories (photo or video). |
| **Revenue Logic** | First comment contains a link to partner site where readers finish the story — this drives affiliate/partner traffic. |
| **Infrastructure** | Local PC runs a lightweight web app. n8n (cloud or self-hosted) runs the automation. Meta Graph API handles publishing. |

> [!NOTE]
> **Groups vs. Pages**
> This system targets Facebook Pages only. The Facebook Groups API was deprecated by Meta in April 2024 and cannot be used for automation. All 20 of your accounts must be Facebook Pages, not Groups.

---

# PART ONE: Local Interface
**The control panel application running on your PC**

## 1.1 Purpose and Technology Stack
The local app is a lightweight single-page web interface that runs on your PC via a Node.js server. You open it in a browser at localhost. It collects all the information needed for each batch of posts and sends it to your n8n instance via an HTTP webhook. It also serves as a media staging server — temporarily hosting uploaded files at a public URL that Meta's API can access during upload.

### Recommended Technology Stack
*   **Runtime:** Node.js 20+
*   **Server:** Express.js (minimal, ~50 lines to configure)
*   **Frontend:** Single HTML file with vanilla JavaScript — no build step needed
*   **Database:** SQLite via better-sqlite3 (stores queue history, page list, tokens)
*   **Media Staging:** Express static file server exposing /media at your public IP or via ngrok tunnel
*   **IDE:** Google Project IDX or VS Code
*   **Packaging:** Optional: pkg or nexe to bundle into a single executable

> **Why not a React app?**
> A single HTML file with vanilla JS is faster to set up, requires no build step, runs instantly, and is trivial to maintain. For a single-user internal tool of this scope, it is the right choice.

## 1.2 Application Screens

### Screen 1 — Daily Post Queue Builder
This is the main screen used every day. It is a structured form that defines the full day's batch. On submission, it sends a single payload to n8n.

**Fields — Post Slots (repeat 6 times)**
*   **Post Slot Label:** "Post 1" through "Post 6" with the auto-calculated publish time shown (e.g. 15:00, 16:00, ...).
*   **Content Type:** dropdown — Photo, Reel, Story.
*   **Media File:** file upload input. Accepted formats: JPEG, PNG, MP4, MOV. Max size: 500 MB.
*   **Caption:** multi-line text area with character counter. Max 63,206 characters (Meta limit).
*   **First Comment:** single-line text input. This is where the partner link goes.
*   **Comment Delay:** number input in seconds. Default: 60. Range: 30 to 3600.
*   **Page Selector:** a multi-checkbox list of all 20 pages pulled from local SQLite. Default is all 20 selected.

**Fields — Global Settings (top of form)**
*   **Posting Date:** date picker. Defaults to today.
*   **First Post Time:** time picker. Defaults to 15:00. The app auto-calculates the remaining 5 post times at 1-hour intervals.
*   **Story Slot:** checkbox to mark which of the 6 slots (if any) should also include stories.

**Behaviour on Submit**
1.  Client-side validates all 6 slots are filled.
2.  Uploads all media files to the local /media staging endpoint and receives back public URLs.
3.  Assembles a JSON payload (schema defined in Part 2) and POSTs it to the n8n webhook URL stored in settings.
4.  Displays a confirmation screen showing the queue status returned by n8n.

### Screen 2 — Queue Monitor
A real-time status board showing all scheduled and in-progress posts for the current day.
*   One row per post per page. Columns: Page Name, Post Slot, Scheduled Time, Status, Post ID, Comment Status.
*   Status values: Scheduled, Uploading, Published, Comment Posted, Error.
*   Status is polled from the local SQLite database every 10 seconds (n8n writes back to it via a second webhook).
*   Error rows shown in red with the raw error message from the Meta API.
*   Manual "Retry" button per row for error recovery.

### Screen 3 — Page Manager
A configuration screen used once during setup and occasionally when pages are added or removed.
*   Lists all pages stored in the local database with their Facebook Page ID and access token status.
*   "Sync from Meta" button: calls a dedicated n8n webhook that fetches the current list of pages from the Meta Graph API using the System User token, then writes them to SQLite.
*   Token status indicator: green if the stored Page Access Token is valid, red if expired or missing.
*   "Refresh All Tokens" button: triggers the n8n token refresh workflow.

### Screen 4 — Settings
*   n8n Webhook URL: text input.
*   n8n Status Callback URL: the URL n8n calls to write status back to the local app.
*   Public Media Base URL: the base URL of your media staging server (e.g. `https://your-ngrok.io/media`).
*   Default Comment Delay (seconds): global default for all first comment delays.
*   Default First Post Time: global default for the start of the daily window.

## 1.3 Media Staging Server
The Meta Graph API requires all media files to be accessible via a direct, public, unauthenticated HTTP URL at upload time.

**Implementation**
*   Express serves a /media route that maps to a local folder.
*   When a file is uploaded through the web UI, it is saved to this folder with a UUID filename.
*   The app constructs a public URL: `https://your-public-url/media/<uuid>.mp4` and returns it to the frontend.
*   n8n uses this URL in the Meta API upload call.
*   Automatic cleanup: a daily cron job inside the app deletes media files older than 24 hours.

### Making Localhost Public
*   **Option A — Static public IP:** Port forward port 3000 to your PC.
*   **Option B — ngrok tunnel:** Run `ngrok http 3000` to get a temporary public HTTPS URL.

## 1.4 Local SQLite Database Schema

### Table: pages
```sql
CREATE TABLE pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id TEXT NOT NULL UNIQUE,
    page_name TEXT NOT NULL,
    access_token TEXT NOT NULL,
    token_expires_at TEXT,
    active INTEGER DEFAULT 1
);
```

### Table: post_queue
```sql
CREATE TABLE post_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    slot_number INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    media_url TEXT,
    caption TEXT,
    first_comment TEXT,
    comment_delay INTEGER DEFAULT 60,
    scheduled_at TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    fb_post_id TEXT,
    comment_status TEXT DEFAULT 'pending',
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
```

## 1.5 Webhook Payload Schema
JSON structure sent to n8n on form submission:
```json
{
  "batch_id": "2026-04-25-001",
  "posting_date": "2026-04-25",
  "posts": [
    {
      "slot": 1,
      "scheduled_time": "2026-04-25T15:00:00+02:00",
      "content_type": "photo",
      "media_url": "https://your-host/media/uuid.jpg",
      "caption": "Story headline here...",
      "first_comment": "https://partner-site.com/full-story",
      "comment_delay_seconds": 60,
      "pages": [
        { "page_id": "123456789", "access_token": "EAA..." },
        { "page_id": "987654321", "access_token": "EAA..." }
      ]
    }
  ],
  "stories": []
}
```

---

## Implementation Checklist: Part 1 — Local App
1.  Initialize Node.js project: `npm init`, install `express`, `better-sqlite3`, `multer`, `uuid`, `node-cron`.
2.  Create SQLite database and run CREATE TABLE scripts for `pages` and `post_queue`.
3.  Build Express server with routes:
    *   `GET /` (serve HTML)
    *   `POST /api/upload` (media staging)
    *   `POST /api/queue` (write from n8n)
    *   `GET /api/queue` (read for queue monitor)
    *   `POST /api/pages/token` (token update from n8n)
4.  Build the HTML frontend: Queue Builder form, Queue Monitor table (auto-refresh), Page Manager, Settings.
5.  Configure media staging: serve /media static folder, implement 24-hour cleanup cron.
6.  Set up ngrok or port forwarding and test that Meta can reach a file at your public URL.
7.  Test the full form submission: submit form, verify payload appears in n8n execution log.
