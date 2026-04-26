# facebook-automation

The Express app owns queue creation and queue status. n8n is only the publishing/commenting executor.

## n8n Publisher Contract

Configure the app setting `n8n_webhook_url` to the publisher workflow webhook, for example:

```text
https://YOUR_N8N_HOST/webhook/fb-publisher
```

The app sends:

```json
{
  "batch_id": "...",
  "posting_date": "YYYY-MM-DD",
  "timezone": "Africa/Cairo",
  "callback_url": "/api/queue/status",
  "jobs": [
    {
      "queue_id": 123,
      "batch_id": "...",
      "slot_number": 1,
      "page_id": "...",
      "page_name": "...",
      "content_type": "photo",
      "media_url": "...",
      "caption": "...",
      "scheduled_time": "2026-04-26T15:00:00+03:00",
      "first_comment": "...",
      "comment_delay_seconds": 60
    }
  ]
}
```

n8n must not call `POST /api/queue`. It reports execution results to `POST /api/queue/status`.

## Required n8n Configuration

- `APP_BASE_URL`: public base URL for the Express app, used when `callback_url` is relative.
- `FB_PAGE_ACCESS_TOKENS`: JSON object mapping page ids to page access tokens, for example `{ "123": "token" }`.
- Optional alternative: one env var per page named `FB_PAGE_TOKEN_<page_id>`.
- Credential `Webhook Secret`: header auth for the app-to-n8n webhook.
- Credential `Local App API`: header auth for app status callbacks, if your Express app requires it.

Do not put page access tokens in the frontend payload.

## Meta Permissions

The Meta token used by n8n needs page publishing/commenting permissions appropriate for the app and Graph API version, typically:

- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`
- `pages_manage_engagement`
- `business_management` if using a Business/System User token and assigned page assets

Reels may require additional video/Reels publishing flow support. The current blueprint contains a clear TODO branch for reels and marks those queue rows as errors until implemented.
