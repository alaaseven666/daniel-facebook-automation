# Facebook Automation App Contract

The Express app is the source of truth for queue creation and status. n8n should only execute publishing/commenting jobs and report results back to the app.

## App to n8n

The frontend submits batches to `POST /api/queue`. The app stores one queue row per selected page per post, then forwards one payload to the configured `n8n_webhook_url`.

A batch may contain 1 to 6 posts. The UI always displays six possible slots, but empty slots are ignored. `slot_number` remains the visible slot number, so filling only Slot 2 and Slot 4 sends jobs with `slot_number` 2 and 4.

```json
{
  "batch_id": "B-1777200000000",
  "posting_date": "2026-04-26",
  "timezone": "Africa/Cairo",
  "callback_url": "/api/queue/status",
  "jobs": [
    {
      "queue_id": 123,
      "batch_id": "B-1777200000000",
      "slot_number": 1,
      "page_id": "123456789",
      "page_name": "Example Page",
      "content_type": "photo",
      "media_url": "http://localhost:3000/media/example.jpg",
      "caption": "Caption text",
      "scheduled_time": "2026-04-26T15:00:00+03:00",
      "first_comment": "First comment text",
      "comment_delay_seconds": 60
    }
  ]
}
```

Required job fields are stable: `queue_id`, `batch_id`, `slot_number`, `page_id`, `page_name`, `content_type`, `media_url`, `caption`, `scheduled_time`, `first_comment`, and `comment_delay_seconds`.

`content_type` is limited to `photo` or `reel`. The default timezone is `Africa/Cairo`; the UI sends local wall-clock times and the backend normalizes them to an offset timestamp before n8n receives jobs.

## n8n to App

n8n must not call `POST /api/queue` after publishing. That endpoint creates queue rows and is reserved for app-created batches.

n8n should call `POST /api/queue/status` when a job changes state:

```json
{
  "queue_id": 123,
  "status": "published",
  "fb_post_id": "facebook-post-id",
  "comment_status": "published"
}
```

Comment-only updates are also accepted:

```json
{
  "queue_id": 123,
  "comment_status": "published"
}
```

If `queue_id` is unavailable, n8n may use the stable identity:

```json
{
  "batch_id": "B-1777200000000",
  "page_id": "123456789",
  "slot_number": 1,
  "status": "error",
  "error_message": "Meta API error text",
  "comment_status": "pending"
}
```

## Idempotency

The database enforces one queue row per `batch_id + page_id + slot_number`. If the frontend retries the same batch, existing rows are reused and duplicate jobs are not created.

## Token Boundary

Page access tokens stay in the backend database for n8n sync/update workflows. `GET /api/pages` returns page metadata only and does not expose access tokens to the frontend.
