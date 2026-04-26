# Implementation Plan: Facebook Pages Automation — n8n Workflows

> Based on `app-prd.md` — Part Two: n8n Workflows
> Assumes the local app (Part One) is already running and reachable.

---

## Workflow Map

```
n8n/
├── Workflow 1 — Ingest                  # Receives daily batch from local app
├── Workflow 2 — Publisher               # Hourly scheduler: photo / reel / story branches
├── Workflow 3 — Commenter               # Async: waits delay → posts first comment
├── Workflow 4 — Token Manager           # Weekly: refreshes all 20 Page Access Tokens
├── Workflow 5 — Page Sync               # On-demand: pulls page list from Meta → writes to app DB
└── Workflow 6 — Single Item Retry       # On-demand: re-runs one failed queue row
```

> **Naming convention:** Use these exact names in n8n. The implementation plan references them
> by name throughout. Consistent naming also makes reading the execution log easier.

---

## Phase 1 — n8n Instance Configuration

**Goal:** Prepare the n8n environment before building any workflow.

### 1.1 Timezone

This is the single most common source of scheduling bugs in n8n.

1. In n8n Cloud: go to **Settings → General → Timezone** and set it to your local timezone
   (e.g. `Africa/Cairo` for Egypt / EET). Save.
2. In self-hosted n8n: set the environment variable before starting the process:
   ```env
   GENERIC_TIMEZONE=Africa/Cairo
   ```
3. Verify: create a temporary Schedule Trigger node and confirm the "Next execution" preview
   shows the correct local time before proceeding.

### 1.2 n8n Version

Confirm you are on **n8n 1.x** (1.30+). Earlier versions have different Webhook and Wait node
behaviour. Check: **Settings → About n8n**.

### 1.3 Execution Mode

For self-hosted installs, ensure execution mode is set to `main` (the default). Do **not** use
`queue` mode — it requires a separate Redis instance and adds unnecessary complexity for this
workload.

```env
EXECUTIONS_PROCESS=main
```

### 1.4 Execution Data Retention

By default n8n saves all execution data forever. Set a retention window to prevent the database
from growing indefinitely:

- n8n Cloud: **Settings → Executions → Keep executions for: 30 days**
- Self-hosted:
  ```env
  EXECUTIONS_DATA_MAX_AGE=720    # hours — 30 days
  EXECUTIONS_DATA_PRUNE=true
  ```

---

## Phase 2 — Credentials Setup

**Goal:** Store all secrets in n8n's Credentials store. Never paste tokens directly into node
fields — always reference a saved credential.

> **Path in n8n:** Top-left menu → **Credentials** → **Add Credential**

### 2.1 Meta System User Token

| Field | Value |
| :--- | :--- |
| Credential Type | **Header Auth** |
| Name | `Meta API` |
| Header Name | `Authorization` |
| Header Value | `Bearer YOUR_SYSTEM_USER_TOKEN_HERE` |

This credential is used in every HTTP Request node that calls the Meta Graph API.

### 2.2 Webhook Shared Secret

| Field | Value |
| :--- | :--- |
| Credential Type | **Generic** |
| Name | `Webhook Secret` |
| Key | `secret` |
| Value | A randomly generated 32-character string |

The local app sends this as the `X-Webhook-Secret` header on every incoming POST to n8n. Each
webhook node validates it.

**Generating the secret (run once in your terminal):**
```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

Copy the output, paste it into both this credential and into your local app's `.env`:
```env
N8N_WEBHOOK_SECRET=your_generated_secret_here
```

### 2.3 Local App API Key

| Field | Value |
| :--- | :--- |
| Credential Type | **Header Auth** |
| Name | `Local App API` |
| Header Name | `X-API-Key` |
| Header Value | A second randomly generated 32-character string |

Used when n8n calls back to your local app (`POST /api/queue/status`, `POST /api/pages/token`).
The local app validates this key on every incoming request from n8n.

Add this to your app's `.env` too:
```env
N8N_API_KEY=your_second_generated_secret_here
```

---

## Phase 3 — Workflow 1: Ingest

**Purpose:** Receive the daily batch payload from the local app, validate it, and store it as n8n
static data (the execution queue) so the Publisher workflow can read it on demand.

**Trigger type:** Webhook (POST)

---

### Node 1 — Webhook

| Field | Value |
| :--- | :--- |
| Node type | **Webhook** |
| HTTP Method | POST |
| Path | `fb-ingest` |
| Authentication | **Header Auth** |
| Credential | `Webhook Secret` |
| Header Name | `X-Webhook-Secret` |
| Respond | **Using 'Respond to Webhook' Node** |

> After saving, copy the **Production URL** shown. Paste it into your local app's Settings screen
> as the `n8n_webhook_url`. Use the **Test URL** only during development.

---

### Node 2 — Validate Input

| Field | Value |
| :--- | :--- |
| Node type | **Code** |
| Language | JavaScript |
| Mode | Run Once for All Items |

```javascript
const body = $input.first().json;

// Required top-level fields
if (!body.batch_id) throw new Error('Missing batch_id');
if (!body.posting_date) throw new Error('Missing posting_date');
if (!Array.isArray(body.posts) || body.posts.length !== 6) {
  throw new Error(`Expected 6 posts, got ${body.posts?.length ?? 0}`);
}

// Validate each slot
for (const post of body.posts) {
  if (!post.slot) throw new Error(`Post missing slot number`);
  if (!post.media_url) throw new Error(`Slot ${post.slot}: missing media_url`);
  if (!post.caption) throw new Error(`Slot ${post.slot}: missing caption`);
  if (!post.first_comment) throw new Error(`Slot ${post.slot}: missing first_comment`);
  if (!Array.isArray(post.pages) || post.pages.length === 0) {
    throw new Error(`Slot ${post.slot}: pages array is empty`);
  }
}

// Pass through unchanged
return $input.all();
```

**Error handling:** In the node's **Settings** tab, set **On Error** = `Stop Workflow Execution`.
The Respond to Webhook node below handles sending the error back to the app.

---

### Node 3 — Store Batch in Static Data

| Field | Value |
| :--- | :--- |
| Node type | **Code** |
| Language | JavaScript |
| Mode | Run Once for All Items |

n8n Static Data persists between executions within the same workflow. You'll use it as the
inter-workflow message bus — the Publisher reads from here.

```javascript
const workflowStaticData = $getWorkflowStaticData('global');
const body = $input.first().json;

// Initialize queue store if it doesn't exist
if (!workflowStaticData.queue) {
  workflowStaticData.queue = {};
}

// Store batch keyed by batch_id
workflowStaticData.queue[body.batch_id] = {
  batch_id: body.batch_id,
  posting_date: body.posting_date,
  posts: body.posts,
  stories: body.stories || [],
  ingested_at: new Date().toISOString(),
  status: 'pending'
};

// Count total page-post pairs queued
const totalRows = body.posts.reduce((sum, p) => sum + p.pages.length, 0);

return [{ json: { success: true, batch_id: body.batch_id, queued: totalRows } }];
```

> **Note on Static Data vs. Google Sheets:** Static Data is the simplest approach and has zero
> external dependencies. If you prefer a more durable queue (survives n8n restarts), swap this
> node for an HTTP Request node that writes to your local app's `POST /api/queue` endpoint
> instead. The rest of the workflow is identical either way.

---

### Node 4 — Forward to Local App DB

| Field | Value |
| :--- | :--- |
| Node type | **HTTP Request** |
| Method | POST |
| URL | `http://localhost:3000/api/queue` |
| Authentication | **Predefined Credential Type** → `Local App API` |
| Body Content Type | JSON |

**Body (JSON):**
```json
{
  "source": "n8n",
  "batch_id": "={{ $('Store Batch in Static Data').item.json.batch_id }}",
  "queued": "={{ $('Store Batch in Static Data').item.json.queued }}"
}
```

This writes the confirmation into the local app's SQLite database so the Queue Monitor shows the
batch as "received". The actual per-row inserts are handled by the local app's own
`POST /api/queue` route (the app calls itself when it receives the n8n confirmation, or you can
expand this node to send the full payload).

> **Tip:** If your local app is not always running during n8n execution, wrap this node's
> **Settings → On Error** = `Continue` so that a local app outage does not fail the entire ingest.

---

### Node 5 — Respond to Webhook

| Field | Value |
| :--- | :--- |
| Node type | **Respond to Webhook** |
| Respond With | **JSON** |

**Response body:**
```json
{
  "success": true,
  "batch_id": "={{ $('Store Batch in Static Data').item.json.batch_id }}",
  "queued": "={{ $('Store Batch in Static Data').item.json.queued }}",
  "message": "Batch accepted. Publisher will run on schedule."
}
```

**Response code:** `200`

---

### Ingest Workflow — Error Path

Connect the **Error output** of the Validate Input node (the red connector) to a separate
**Respond to Webhook** node configured as:

| Field | Value |
| :--- | :--- |
| Respond With | **JSON** |
| Response Code | `400` |

**Response body:**
```json
{
  "success": false,
  "error": "={{ $input.first().json.message }}"
}
```

---

## Phase 4 — Workflow 2: Publisher

**Purpose:** Runs hourly from 15:00–20:00. For each hour, it reads the current slot's posts from
Static Data, then publishes each post to each of its 20 pages. Handles three content types:
photo, reel, and story — each with a different Meta API upload flow.

**Trigger type:** Schedule Trigger (×6) — one per post slot.

---

### Node 1 — Schedule Triggers (×6)

Create **6 separate Schedule Trigger nodes**, one per post slot. Connect all 6 to the same
next node (Determine Current Slot). n8n handles multiple triggers per workflow.

| Node Name | Cron Expression | Human Time |
| :--- | :--- | :--- |
| `Trigger 15:00` | `55 14 * * *` | Fires at 14:55 — publishes Slot 1 on time |
| `Trigger 16:00` | `55 15 * * *` | Fires at 15:55 — publishes Slot 2 on time |
| `Trigger 17:00` | `55 16 * * *` | Fires at 16:55 — publishes Slot 3 on time |
| `Trigger 18:00` | `55 17 * * *` | Fires at 17:55 — publishes Slot 4 on time |
| `Trigger 19:00` | `55 18 * * *` | Fires at 18:55 — publishes Slot 5 on time |
| `Trigger 20:00` | `55 19 * * *` | Fires at 19:55 — publishes Slot 6 on time |

> **Why 5 minutes early?** Triggering at :55 gives n8n time to loop through 20 pages and finish
> uploading all media before the :00 scheduled_publish_time. Meta publishes the scheduled post
> at exactly :00 on their end — you're just uploading the container in advance.

---

### Node 2 — Determine Current Slot

| Field | Value |
| :--- | :--- |
| Node type | **Code** |
| Mode | Run Once for All Items |

```javascript
const hour = new Date().getHours(); // local time (make sure n8n timezone is correct)

// Map current hour to slot number
// Triggers fire at :55 of the PREVIOUS hour
const slotMap = {
  14: 1,  // 14:55 → Slot 1 (publishes at 15:00)
  15: 2,
  16: 3,
  17: 4,
  18: 5,
  19: 6,
};

const slotNumber = slotMap[hour];
if (!slotNumber) {
  throw new Error(`No slot mapped for hour ${hour}. Check trigger configuration.`);
}

// Calculate the scheduled_publish_time for this slot (Unix timestamp)
const today = new Date();
today.setHours(hour + 1, 0, 0, 0); // e.g. 15:00 for slot 1
const scheduledUnixTime = Math.floor(today.getTime() / 1000);

return [{ json: { slot_number: slotNumber, scheduled_unix_time: scheduledUnixTime } }];
```

---

### Node 3 — Load Batch from Static Data

| Field | Value |
| :--- | :--- |
| Node type | **Code** |
| Mode | Run Once for All Items |

```javascript
const workflowStaticData = $getWorkflowStaticData('global');
const slotNumber = $input.first().json.slot_number;
const scheduledUnixTime = $input.first().json.scheduled_unix_time;

// Find today's batch
const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
const batches = Object.values(workflowStaticData.queue || {});
const todaysBatch = batches.find(b => b.posting_date === today);

if (!todaysBatch) {
  return [{ json: { skip: true, reason: `No batch found for ${today}` } }];
}

// Find the post for this slot
const post = todaysBatch.posts.find(p => p.slot === slotNumber);
if (!post) {
  return [{ json: { skip: true, reason: `No post found for slot ${slotNumber}` } }];
}

// Inject scheduled time
post.scheduled_unix_time = scheduledUnixTime;
post.batch_id = todaysBatch.batch_id;

return [{ json: post }];
```

---

### Node 4 — Check if Skip

| Field | Value |
| :--- | :--- |
| Node type | **IF** |
| Condition | `{{ $json.skip }}` **is equal to** `true` |

- **True branch** → connect to a **No-Op** node (or simply end here). Nothing to do.
- **False branch** → continue to Node 5.

---

### Node 5 — Split by Page

| Field | Value |
| :--- | :--- |
| Node type | **Split In Batches** |
| Batch Size | `1` |
| Options → Reset | Off |

This iterates over `$json.pages`, processing one page at a time. Each page object has:
```json
{ "page_id": "123456789", "access_token": "EAA..." }
```

**Before this node**, add a **Code** node to flatten the pages array into individual items
so Split In Batches can iterate them:

```javascript
// Node name: "Flatten Pages"
const post = $input.first().json;
return post.pages.map(page => ({
  json: {
    page_id: page.page_id,
    access_token: page.access_token,
    // carry post data forward
    slot_number: post.slot,
    batch_id: post.batch_id,
    content_type: post.content_type,
    media_url: post.media_url,
    caption: post.caption,
    first_comment: post.first_comment,
    comment_delay_seconds: post.comment_delay_seconds,
    scheduled_unix_time: post.scheduled_unix_time,
  }
}));
```

---

### Node 6 — Route by Content Type

| Field | Value |
| :--- | :--- |
| Node type | **Switch** |
| Mode | Rules |
| Input field | `{{ $json.content_type }}` |

| Output | Condition | Value |
| :--- | :--- | :--- |
| Output 1 | equals | `photo` |
| Output 2 | equals | `reel` |
| Output 3 | equals | `story` |

Connect Output 1 → Photo Branch, Output 2 → Reel Branch, Output 3 → Story Branch.

---

### Photo Branch (Nodes 7A–9A)

#### Node 7A — Upload Photo to Page

| Field | Value |
| :--- | :--- |
| Node type | **HTTP Request** |
| Method | POST |
| URL | `https://graph.facebook.com/v25.0/{{ $json.page_id }}/photos` |
| Authentication | **Predefined Credential Type** → `Meta API` |
| Body Content Type | **Form-Data** |

**Form fields:**
| Key | Value |
| :--- | :--- |
| `url` | `={{ $json.media_url }}` |
| `caption` | `={{ $json.caption }}` |
| `published` | `false` |
| `scheduled_publish_time` | `={{ $json.scheduled_unix_time }}` |
| `access_token` | `={{ $json.access_token }}` |

> **Why Form-Data instead of JSON?** The `/photos` endpoint requires form-data encoding when
> passing `url`. Using JSON body returns a malformed request error.

**Expected response:**
```json
{ "id": "123456789_987654321", "post_id": "123456789_987654321" }
```

**On Error:** Set **Continue on Error** in node Settings. The error is handled in Node 8A.

---

#### Node 8A — Check Photo Upload Result

| Field | Value |
| :--- | :--- |
| Node type | **IF** |
| Condition | `{{ $json.error }}` **exists** |

- **True (error)** → Node 9A-Error
- **False (success)** → Node 9A-Success

---

#### Node 9A-Success — Notify App: Published

| Field | Value |
| :--- | :--- |
| Node type | **HTTP Request** |
| Method | POST |
| URL | `http://localhost:3000/api/queue/status` |
| Authentication | `Local App API` |
| Body Content Type | JSON |

```json
{
  "batch_id": "={{ $('Flatten Pages').item.json.batch_id }}",
  "page_id": "={{ $('Flatten Pages').item.json.page_id }}",
  "slot_number": "={{ $('Flatten Pages').item.json.slot_number }}",
  "status": "published",
  "fb_post_id": "={{ $json.id }}"
}
```

Then connect to **Node 10 — Trigger Commenter** (shared by all branches, see below).

---

#### Node 9A-Error — Notify App: Error

| Field | Value |
| :--- | :--- |
| Node type | **HTTP Request** |
| Method | POST |
| URL | `http://localhost:3000/api/queue/status` |
| Authentication | `Local App API` |
| Body Content Type | JSON |

```json
{
  "batch_id": "={{ $('Flatten Pages').item.json.batch_id }}",
  "page_id": "={{ $('Flatten Pages').item.json.page_id }}",
  "slot_number": "={{ $('Flatten Pages').item.json.slot_number }}",
  "status": "error",
  "error_message": "={{ $json.error.message }}"
}
```

End here. Do not trigger Commenter on error.

---

### Reel Branch (Nodes 7B–9B)

Reel upload is a 4-step process: init session → upload binary → poll status → publish.

#### Node 7B — Initialize Upload Session

| Field | Value |
| :--- | :--- |
| Node type | **HTTP Request** |
| Method | POST |
| URL | `https://graph.facebook.com/v25.0/{{ $json.page_id }}/videos` |
| Authentication | `Meta API` |
| Body Content Type | JSON |

```json
{
  "upload_phase": "start",
  "access_token": "={{ $json.access_token }}"
}
```

> **Note:** The `file_size` param is required if you know the byte size of the video.
> If your app records file sizes at upload time, include it here:
> `"file_size": "={{ $json.file_size_bytes }}"`. If not, omit it — Meta will accept the
> upload without it but may be slower.

**Saves:** `upload_session_id` and `video_id` for use in the next node.

---

#### Node 7B-2 — Fetch Video Binary

| Field | Value |
| :--- | :--- |
| Node type | **HTTP Request** |
| Method | GET |
| URL | `={{ $('Flatten Pages').item.json.media_url }}` |
| Response Format | **File** |

This downloads the video file from your local media staging server as a binary buffer.
n8n stores it as a binary attachment on the item.

---

#### Node 7B-3 — Upload to Resumable Endpoint

| Field | Value |
| :--- | :--- |
| Node type | **HTTP Request** |
| Method | POST |
| URL | `https://rupload.facebook.com/video-upload/v25.0/{{ $('Initialize Upload Session').item.json.upload_session_id }}` |
| Send Headers | On |
| Send Body | On |
| Body Content Type | **Binary** |
| Input Data Field Name | `data` (the binary field from the Fetch step) |

**Headers:**
| Name | Value |
| :--- | :--- |
| `Authorization` | `OAuth {{ $('Flatten Pages').item.json.access_token }}` |
| `offset` | `0` |
| `file_size` | `={{ $('Fetch Video Binary').item.binary.data.fileSize }}` |

---

#### Node 7B-4 — Wait for Processing (First Wait)

| Field | Value |
| :--- | :--- |
| Node type | **Wait** |
| Resume | After Time Interval |
| Wait Amount | `30` |
| Unit | Seconds |

---

#### Node 7B-5 — Poll Processing Status

| Field | Value |
| :--- | :--- |
| Node type | **HTTP Request** |
| Method | GET |
| URL | `https://graph.facebook.com/v25.0/{{ $('Initialize Upload Session').item.json.video_id }}` |
| Authentication | `Meta API` |
| Query Parameters | `fields=status`, `access_token={{ $('Flatten Pages').item.json.access_token }}` |

**Expected response when ready:**
```json
{
  "status": { "processing_progress": 100, "video_status": "ready" },
  "id": "video_id_here"
}
```

---

#### Node 7B-6 — Check Processing Progress

| Field | Value |
| :--- | :--- |
| Node type | **IF** |
| Condition | `{{ $json.status.processing_progress }}` **≥** `100` |

- **True** → Node 7B-7 (Publish Reel)
- **False** → Connect back to a second **Wait** node (15 seconds), then back to Poll Status.
  Add a **Code** node before the loop-back to increment a retry counter and throw an error
  if retries exceed 10 (5 minutes total wait).

**Retry counter Code node:**
```javascript
const item = $input.first().json;
const retries = (item._poll_retries || 0) + 1;
if (retries > 10) {
  throw new Error(`Video ${item.id} still processing after 10 polls. Manual check required.`);
}
return [{ json: { ...item, _poll_retries: retries } }];
```

---

#### Node 7B-7 — Publish Reel

| Field | Value |
| :--- | :--- |
| Node type | **HTTP Request** |
| Method | POST |
| URL | `https://graph.facebook.com/v25.0/{{ $('Flatten Pages').item.json.page_id }}/videos` |
| Authentication | `Meta API` |
| Body Content Type | JSON |

```json
{
  "video_id": "={{ $('Initialize Upload Session').item.json.video_id }}",
  "description": "={{ $('Flatten Pages').item.json.caption }}",
  "published": false,
  "scheduled_publish_time": "={{ $('Flatten Pages').item.json.scheduled_unix_time }}",
  "content_tags": [],
  "access_token": "={{ $('Flatten Pages').item.json.access_token }}"
}
```

Then connect to **Node 9B-Success** (same pattern as Photo branch's 9A-Success).
Use the same Error path (9B-Error) for failures.

---

### Story Branch (Nodes 7C–9C)

Stories cannot be scheduled — they publish immediately when the API call is made. This means
the story branch should be triggered separately (not by the hourly slots). Best practice:

- Add a **7th Schedule Trigger** for stories if you want a specific story time (e.g. 09:00).
- Or: handle stories as a separate check inside the existing triggers for slots that are
  flagged as stories.

The implementation below posts immediately.

#### Node 7C — Post Photo Story

| Field | Value |
| :--- | :--- |
| Node type | **HTTP Request** |
| Method | POST |
| URL | `https://graph.facebook.com/v25.0/{{ $json.page_id }}/photo_stories` |
| Authentication | `Meta API` |
| Body Content Type | **Form-Data** |

**Form fields:**
| Key | Value |
| :--- | :--- |
| `url` | `={{ $json.media_url }}` |
| `access_token` | `={{ $json.access_token }}` |

For **video stories**, use `/video_stories` instead of `/photo_stories` and pass `video_id`
from a completed upload session (same upload flow as Reel, minus the publish step).

Connect to **Node 9C-Success** (notify app, status = `published`). Stories have no first
comment requirement (comments are disabled on stories), so do **not** trigger the Commenter.

---

### Node 10 — Trigger Commenter Workflow (shared by Photo + Reel)

| Field | Value |
| :--- | :--- |
| Node type | **HTTP Request** |
| Method | POST |
| URL | `https://your-n8n-url/webhook/fb-comment` |
| Body Content Type | JSON |
| Headers | `X-Webhook-Secret: {{ $credentials.webhookSecret.secret }}` |

```json
{
  "post_id": "={{ $('Upload Photo to Page').item.json.id }}",
  "page_id": "={{ $('Flatten Pages').item.json.page_id }}",
  "access_token": "={{ $('Flatten Pages').item.json.access_token }}",
  "comment_text": "={{ $('Flatten Pages').item.json.first_comment }}",
  "delay_seconds": "={{ $('Flatten Pages').item.json.comment_delay_seconds }}",
  "batch_id": "={{ $('Flatten Pages').item.json.batch_id }}",
  "slot_number": "={{ $('Flatten Pages').item.json.slot_number }}"
}
```

> Reference the photo's post ID from the Upload node using `$('Upload Photo to Page').item.json.id`.
> For the Reel branch, reference `$('Publish Reel').item.json.id` instead. Use the Switch node
> output branch to determine which node name to reference.

---

### Node 11 — Inter-Page Delay

| Field | Value |
| :--- | :--- |
| Node type | **Wait** |
| Resume | After Time Interval |
| Wait Amount | `2` |
| Unit | Seconds |

Place this **after** Node 10 and **before the loop-back** to Split In Batches. This adds a
2-second pause between each of the 20 pages, spreading the burst across ~40 seconds.

---

### Publisher Workflow — Final Connection Map

```
[Trigger 15:00] ─┐
[Trigger 16:00] ─┤
[Trigger 17:00] ─┤→ [Determine Current Slot] → [Load Batch] → [Check Skip]
[Trigger 18:00] ─┤                                                    │
[Trigger 19:00] ─┤                                              [Flatten Pages]
[Trigger 20:00] ─┘                                                    │
                                                             [Split In Batches]
                                                                    │
                                                        [Route by Content Type]
                                                       /          |          \
                                                  [Photo]       [Reel]     [Story]
                                                   branch        branch      branch
                                                       \          |
                                                    [Trigger Commenter]
                                                            │
                                                     [Inter-Page Delay]
                                                            │
                                                   (loop back to Split)
```

---

## Phase 5 — Workflow 3: Commenter

**Purpose:** Receives a trigger from the Publisher with post details, immediately acknowledges
it, then waits the configured delay and posts the first comment. Running this as a separate
workflow means the Publisher is never blocked by the wait time.

**Trigger type:** Webhook (POST), respond immediately.

---

### Node 1 — Webhook

| Field | Value |
| :--- | :--- |
| Node type | **Webhook** |
| HTTP Method | POST |
| Path | `fb-comment` |
| Authentication | **Header Auth** → `Webhook Secret` |
| Respond | **Immediately** ← **Critical setting** |

> **"Respond Immediately"** is the key setting here. Without it, n8n holds the HTTP connection
> open until the workflow finishes — which could be 60+ seconds (the delay). The Publisher's
> HTTP Request node would time out. With Respond Immediately, n8n returns 200 at once and
> continues the workflow asynchronously in the background.

In n8n 1.x, this is set in the Webhook node under **"When to respond"** → **Immediately**.

---

### Node 2 — Wait

| Field | Value |
| :--- | :--- |
| Node type | **Wait** |
| Resume | After Time Interval |
| Wait Amount | `={{ $json.delay_seconds }}` |
| Unit | Seconds |

This is a dynamic wait — the delay value comes from the incoming payload. The default is 60
seconds but can be any value the local app sends.

> **n8n Cloud note:** The Wait node survives n8n restarts in Cloud. In self-hosted, if n8n
> restarts during the wait window, the execution resumes when n8n comes back online.

---

### Node 3 — Post Comment

| Field | Value |
| :--- | :--- |
| Node type | **HTTP Request** |
| Method | POST |
| URL | `https://graph.facebook.com/v25.0/{{ $json.post_id }}/comments` |
| Authentication | `Meta API` |
| Body Content Type | JSON |

```json
{
  "message": "={{ $json.comment_text }}",
  "access_token": "={{ $json.access_token }}"
}
```

**Expected response:**
```json
{ "id": "comment_id_here" }
```

**On Error:** Set **Continue on Error** in node Settings. Node 4 handles the result check.

---

### Node 4 — Check Comment Result

| Field | Value |
| :--- | :--- |
| Node type | **IF** |
| Condition | `{{ $json.id }}` **exists** |

- **True** → Node 5-Success
- **False** → Node 5-Error

---

### Node 5-Success — Notify App: Comment Posted

| Field | Value |
| :--- | :--- |
| Node type | **HTTP Request** |
| Method | POST |
| URL | `http://localhost:3000/api/queue/status` |
| Authentication | `Local App API` |
| Body Content Type | JSON |

```json
{
  "batch_id": "={{ $('Webhook').item.json.batch_id }}",
  "page_id": "={{ $('Webhook').item.json.page_id }}",
  "slot_number": "={{ $('Webhook').item.json.slot_number }}",
  "comment_status": "posted",
  "comment_id": "={{ $('Post Comment').item.json.id }}"
}
```

---

### Node 5-Error — Notify App: Comment Error

Same structure as 5-Success but:

```json
{
  "batch_id": "={{ $('Webhook').item.json.batch_id }}",
  "page_id": "={{ $('Webhook').item.json.page_id }}",
  "slot_number": "={{ $('Webhook').item.json.slot_number }}",
  "comment_status": "error",
  "error_message": "={{ $('Post Comment').item.json.error.message }}"
}
```

---

## Phase 6 — Workflow 4: Token Manager

**Purpose:** Runs every Monday morning. Uses the System User Token to fetch fresh Page Access
Tokens for all 20 pages and writes them back to the local app's database.

**Trigger type:** Schedule Trigger (weekly)

---

### Node 1 — Schedule Trigger

| Field | Value |
| :--- | :--- |
| Node type | **Schedule Trigger** |
| Rule | **Weeks** |
| Day | Monday |
| Time | 09:00 |
| Timezone | Confirmed to match n8n instance timezone |

---

### Node 2 — Fetch All Pages from Meta

| Field | Value |
| :--- | :--- |
| Node type | **HTTP Request** |
| Method | GET |
| URL | `https://graph.facebook.com/v25.0/me/accounts` |
| Authentication | `Meta API` |
| Query Parameters | `limit=50` |

> The `Meta API` credential already contains the System User Token as a Bearer header.
> Setting `limit=50` ensures all 20 pages are returned in one call (default limit is 25).

**Expected response:**
```json
{
  "data": [
    { "name": "Page Name", "access_token": "EAA...", "id": "123456789" },
    ...
  ]
}
```

---

### Node 3 — Extract Pages Array

| Field | Value |
| :--- | :--- |
| Node type | **Code** |
| Mode | Run Once for All Items |

```javascript
const response = $input.first().json;
const pages = response.data;

if (!pages || pages.length === 0) {
  throw new Error('Meta API returned no pages. Check System User token and asset assignments.');
}

// Return each page as a separate item for the Split loop
return pages.map(page => ({
  json: {
    page_id: page.id,
    page_name: page.name,
    access_token: page.access_token,
  }
}));
```

---

### Node 4 — Split In Batches

| Field | Value |
| :--- | :--- |
| Node type | **Split In Batches** |
| Batch Size | `1` |

---

### Node 5 — Update Token in Local App

| Field | Value |
| :--- | :--- |
| Node type | **HTTP Request** |
| Method | POST |
| URL | `http://localhost:3000/api/pages/token` |
| Authentication | `Local App API` |
| Body Content Type | JSON |

```json
{
  "page_id": "={{ $json.page_id }}",
  "page_name": "={{ $json.page_name }}",
  "access_token": "={{ $json.access_token }}"
}
```

---

### Node 6 — Log Summary

| Field | Value |
| :--- | :--- |
| Node type | **Code** |
| Mode | Run Once for All Items (after loop ends) |

```javascript
const items = $input.all();
const count = items.length;
console.log(`[Token Manager] Refreshed ${count} page tokens at ${new Date().toISOString()}`);
return [{ json: { refreshed: count, timestamp: new Date().toISOString() } }];
```

---

## Phase 7 — Workflow 5: Page Sync

**Purpose:** On-demand. Called when you click "Sync from Meta" in the local app's Page Manager
screen. Fetches the page list from Meta and writes all pages (name + ID + token) to the local
app's database, creating records for any new pages it finds.

**Trigger type:** Webhook (POST)

---

### Node 1 — Webhook

| Field | Value |
| :--- | :--- |
| Path | `fb-sync-pages` |
| Respond | **Using 'Respond to Webhook' Node** |
| Authentication | `Webhook Secret` |

---

### Node 2 — Fetch Pages (same as Token Manager Node 2)

Identical configuration to Token Manager Node 2. Reuse the same Meta API credential.

---

### Node 3 — Upsert Each Page in Local App

| Field | Value |
| :--- | :--- |
| Node type | **HTTP Request** |
| Method | POST |
| URL | `http://localhost:3000/api/pages` |
| Authentication | `Local App API` |
| Body Content Type | JSON |

```json
{
  "page_id": "={{ $json.id }}",
  "page_name": "={{ $json.name }}",
  "access_token": "={{ $json.access_token }}",
  "active": 1
}
```

---

### Node 4 — Respond to Webhook

```json
{
  "success": true,
  "synced": "={{ $input.all().length }} pages"
}
```

---

## Phase 8 — Workflow 6: Single Item Retry

**Purpose:** On-demand. Called when you click "Retry" on an error row in the Queue Monitor.
Receives one queue row and re-runs the publish + comment flow for that specific post + page
combination without re-running the full batch.

**Trigger type:** Webhook (POST)

---

### Node 1 — Webhook

| Field | Value |
| :--- | :--- |
| Path | `fb-retry` |
| Respond | **Immediately** |
| Authentication | `Webhook Secret` |

**Incoming payload from local app:**
```json
{
  "queue_id": 42,
  "page_id": "123456789",
  "access_token": "EAA...",
  "content_type": "photo",
  "media_url": "https://your-host/media/uuid.jpg",
  "caption": "...",
  "first_comment": "https://partner-site.com/...",
  "comment_delay_seconds": 60,
  "batch_id": "2026-04-25-001",
  "slot_number": 3
}
```

---

### Node 2 — Reset Status in Local App

Before attempting the retry, mark the row as `pending` so the Queue Monitor shows it as
in-progress:

| Field | Value |
| :--- | :--- |
| Node type | **HTTP Request** |
| Method | POST |
| URL | `http://localhost:3000/api/queue/status` |
| Body | `{ "queue_id": "={{ $json.queue_id }}", "status": "pending" }` |

---

### Node 3 — Route by Content Type

Same Switch node configuration as Publisher Workflow Node 6. Connect to the same Photo, Reel,
and Story branch node templates (you can duplicate those sub-graphs here).

After success, trigger the Commenter webhook the same way as Publisher Node 10.

---

## Phase 9 — Expressions & Variable Reference

This section lists the most commonly used n8n expression patterns across all workflows.

### Referencing Previous Node Output

```
{{ $json.field_name }}                          ← current node's input
{{ $('Node Name').item.json.field_name }}       ← specific upstream node
{{ $('Node Name').all()[0].json.field_name }}   ← first item of a multi-item node
```

### Getting Current Date/Time

```javascript
// ISO date string: YYYY-MM-DD
new Date().toISOString().split('T')[0]

// Unix timestamp (seconds)
Math.floor(Date.now() / 1000)

// Unix timestamp for specific time today (e.g. 15:00)
const d = new Date();
d.setHours(15, 0, 0, 0);
Math.floor(d.getTime() / 1000)
```

### Accessing Credentials in Code Nodes

You cannot directly access credential values in Code nodes. Pass them through via the incoming
item's JSON instead. Example: the Publisher passes `access_token` in every page object, so Code
nodes can access it as `$json.access_token`.

### Static Data Read/Write Pattern

```javascript
// Read
const data = $getWorkflowStaticData('global');
const myValue = data.myKey;

// Write
const data = $getWorkflowStaticData('global');
data.myKey = 'new value';
// No need to call a save function — changes persist automatically
```

---

## Phase 10 — Testing Checklist

Test each workflow in order. Use n8n's **"Test Workflow"** button with the Test webhook URL
during development, then switch to Production URLs when going live.

| # | Workflow | Test | Expected Result |
| :--- | :--- | :--- | :--- |
| 1 | Ingest | Send sample payload via curl to Test webhook URL | Execution appears in n8n log; Static Data shows batch stored |
| 2 | Ingest | Send payload with missing slot | n8n returns 400; local app Queue Monitor shows no new rows |
| 3 | Ingest | Send valid payload | Local app Queue Monitor shows 120 rows (6 slots × 20 pages) as pending |
| 4 | Publisher | Manually trigger with a test page (1 page only) for photo | Photo appears on test page; Queue Monitor shows `published` |
| 5 | Publisher | Manually trigger for reel | Reel appears on test page after processing; poll loop works |
| 6 | Publisher | Simulate reel processing timeout (10 polls) | Queue Monitor shows `error` with timeout message |
| 7 | Commenter | Manually POST to `/webhook/fb-comment` with a real post_id | n8n returns 200 immediately; after delay, comment appears on post |
| 8 | Commenter | Use an invalid post_id | After delay, Queue Monitor shows `comment_status: error` |
| 9 | Token Manager | Manually trigger | All page tokens refreshed; check local app Page Manager for green badges |
| 10 | Page Sync | Click "Sync from Meta" in local app | Page Manager table populated with all pages from Meta |
| 11 | Retry | Trigger an error row, then click Retry in Queue Monitor | Row resets to pending, publishes successfully, comment posted |
| 12 | Full end-to-end | Submit a real 6-slot batch via Queue Builder | All 6 posts publish at correct times across all 20 pages with first comments |

### Curl Commands for Manual Testing

**Test Ingest webhook:**
```bash
curl -X POST https://your-n8n-url/webhook-test/fb-ingest \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: YOUR_SECRET" \
  -d '{
    "batch_id": "test-001",
    "posting_date": "2026-04-25",
    "posts": [
      {
        "slot": 1,
        "scheduled_time": "2026-04-25T15:00:00+02:00",
        "content_type": "photo",
        "media_url": "https://your-host/media/test.jpg",
        "caption": "Test caption",
        "first_comment": "https://partner-site.com/test",
        "comment_delay_seconds": 30,
        "pages": [
          { "page_id": "TEST_PAGE_ID", "access_token": "TEST_TOKEN" }
        ]
      },
      { "slot": 2, "content_type": "photo", "media_url": "https://your-host/media/t2.jpg", "caption": "Cap 2", "first_comment": "https://p.com/2", "comment_delay_seconds": 30, "pages": [{ "page_id": "TEST_PAGE_ID", "access_token": "TEST_TOKEN" }] },
      { "slot": 3, "content_type": "photo", "media_url": "https://your-host/media/t3.jpg", "caption": "Cap 3", "first_comment": "https://p.com/3", "comment_delay_seconds": 30, "pages": [{ "page_id": "TEST_PAGE_ID", "access_token": "TEST_TOKEN" }] },
      { "slot": 4, "content_type": "photo", "media_url": "https://your-host/media/t4.jpg", "caption": "Cap 4", "first_comment": "https://p.com/4", "comment_delay_seconds": 30, "pages": [{ "page_id": "TEST_PAGE_ID", "access_token": "TEST_TOKEN" }] },
      { "slot": 5, "content_type": "photo", "media_url": "https://your-host/media/t5.jpg", "caption": "Cap 5", "first_comment": "https://p.com/5", "comment_delay_seconds": 30, "pages": [{ "page_id": "TEST_PAGE_ID", "access_token": "TEST_TOKEN" }] },
      { "slot": 6, "content_type": "photo", "media_url": "https://your-host/media/t6.jpg", "caption": "Cap 6", "first_comment": "https://p.com/6", "comment_delay_seconds": 30, "pages": [{ "page_id": "TEST_PAGE_ID", "access_token": "TEST_TOKEN" }] }
    ],
    "stories": []
  }'
```

**Test Commenter webhook:**
```bash
curl -X POST https://your-n8n-url/webhook/fb-comment \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: YOUR_SECRET" \
  -d '{
    "post_id": "YOUR_REAL_POST_ID",
    "page_id": "YOUR_PAGE_ID",
    "access_token": "YOUR_PAGE_TOKEN",
    "comment_text": "https://partner-site.com/full-story",
    "delay_seconds": 10,
    "batch_id": "test-001",
    "slot_number": 1
  }'
```

---

## Implementation Order (Recommended)

```
Phase 1 (Instance config) → Phase 2 (Credentials)
→ Phase 7 (Page Sync) → verify pages populate in local app
→ Phase 6 (Token Manager) → verify tokens refresh correctly
→ Phase 3 (Ingest) → test with curl → verify Static Data stores batch
→ Phase 5, Photo branch only → manual trigger → verify 1 page posts
→ Phase 5, full loop (20 pages) → verify all 20 post
→ Phase 4 (Commenter) → verify comment appears after delay
→ Phase 5, Reel branch → upload + poll loop
→ Phase 5, Story branch → immediate publish
→ Phase 8 (Retry workflow)
→ Phase 10 (Full testing checklist)
```

The key principle: **test with a single page before enabling all 20**. This keeps test content
off your live pages while you validate the workflow logic.

---

## Node Count Reference

| Workflow | Node Count | Estimated Build Time |
| :--- | :--- | :--- |
| 1 — Ingest | 5 nodes | 1 hour |
| 2 — Publisher | ~22 nodes (all branches) | 3–4 hours |
| 3 — Commenter | 6 nodes | 45 minutes |
| 4 — Token Manager | 6 nodes | 30 minutes |
| 5 — Page Sync | 4 nodes | 20 minutes |
| 6 — Retry | ~5 nodes + reused branches | 30 minutes |
| **Total** | **~48 nodes** | **~7 hours** |

---

## Common n8n Pitfalls for This Workflow

| Issue | Cause | Fix |
| :--- | :--- | :--- |
| Publisher fires but no batch found | n8n timezone differs from local time | Re-check Phase 1.1. Compare `new Date().getHours()` in a Code node against wall clock. |
| Commenter blocks Publisher for 60 seconds | Webhook "Respond" set to "Last Node" instead of "Immediately" | Change Commenter webhook node → "When to respond" → "Immediately" |
| Static Data empty on Publisher run | Ingest ran in a different execution than Publisher reads | Static Data is per-workflow. Ensure Ingest and Publisher are in **separate** workflows. |
| Meta API 190 token error | Access token expired or wrong token used | Run Token Manager manually. Verify the `pages` array in the payload contains Page tokens, not the System User token. |
| Video upload hangs | Binary fetch from media URL returned empty body | Confirm the media file exists at the URL. Test by opening the URL in a browser from outside your network. |
| All 20 pages fail simultaneously | Meta rate limit burst | Add the 2-second Wait node between page iterations (Node 11 in Publisher). |
| Split In Batches loops forever | Loop-back connected to wrong node | The loop-back must connect to the Split In Batches node input, not to a node before it. |
