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

## n8n Cloud Starter Setup

n8n Cloud Starter cannot use server environment variables or n8n Variables for this setup, so the publisher blueprint includes a workflow-local `Config` Set node.

After importing `the n8n workflows blueprint/the publisher.json`, configure:

- `Config` Set node: replace `REPLACE_WITH_PUBLIC_APP_URL` with the public base URL for the Express app, for example `https://your-app.example.com`.
- `Webhook Secret` credential: header auth for the app-to-n8n publisher webhook.
- `Local App API` credential: header auth for app status callbacks, if your Express app or tunnel requires it.
- `Meta Page Access Token (test page)` credential: HTTP Header Auth credential for one test page.

For the first test, use one page only. In n8n, create the `Meta Page Access Token (test page)` HTTP Header Auth credential with:

```text
Name: Authorization
Value: Bearer REPLACE_WITH_TEST_PAGE_ACCESS_TOKEN
```

Do not put page access tokens in the frontend payload or in workflow JSON.

The Page Sync blueprint also uses `REPLACE_WITH_PUBLIC_APP_URL/api/pages`; replace that placeholder before testing page sync.

## Future Multi-Page Token Lookup

The current Starter-plan publisher blueprint intentionally does not use `$env`, `$vars`, or JSON token maps. It is prepared for one test page through an n8n credential. For multi-page publishing, add a secure token lookup flow inside n8n, or use a credential strategy appropriate for your n8n plan, while keeping tokens out of the app frontend payload.

## Meta Permissions

The Meta token used by n8n needs page publishing/commenting permissions appropriate for the app and Graph API version, typically:

- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`
- `pages_manage_engagement`
- `business_management` if using a Business/System User token and assigned page assets

Reels may require additional video/Reels publishing flow support. The current blueprint contains a clear TODO branch for reels and marks those queue rows as errors until implemented.
