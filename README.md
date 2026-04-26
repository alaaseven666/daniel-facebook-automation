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

n8n receives one job per selected page per filled slot. A batch can contain 1 to 6 posts; empty UI slots are ignored, and `slot_number` stays tied to the visible slot number.

n8n responds immediately after validating the publisher webhook payload:

```json
{
  "accepted": true,
  "batch_id": "...",
  "jobs_received": 1
}
```

After that response, the workflow continues asynchronously: it splits jobs, waits until `scheduled_time`, publishes, posts comments, and sends status updates to `/api/queue/status`.

In the publisher workflow JSON, the `Webhook: App Jobs` node must use:

```json
"responseMode": "responseNode"
```

The `Respond: Jobs Accepted` node sends the response first, then `Load Validated Batch After Response` passes the validated payload into the async job-splitting path.

n8n must not call `POST /api/queue`. It reports execution results to `POST /api/queue/status`.

## Media URLs

Uploaded files are saved in `the app/media` and served publicly by Express at `/media/<filename>`.

Set `public_media_base_url` / `Public App Base URL` to the public origin of the app, for example:

```text
https://your-ngrok-domain.ngrok-free.app
```

The app sends media URLs to n8n as:

```text
<public_base_url>/media/<filename>
```

To test, open a generated `media_url` in a browser. It should display or download the raw image file and return an image content type such as `image/jpeg` or `image/png`, not the app HTML page.

## Queue Cleanup

The Queue Monitor includes cleanup tools for the selected date:

- `Clear Pending/Error` calls `DELETE /api/queue/test-pending?date=YYYY-MM-DD` and removes only `pending` or `error` queue rows.
- `Clear Queue for Selected Date` calls `DELETE /api/queue?date=YYYY-MM-DD` and removes all queue rows for that date.

Cleanup only deletes rows from `post_queue`. It does not delete pages, settings, uploads, or tokens.

## n8n Cloud Starter Setup

n8n Cloud Starter cannot use server environment variables or n8n Variables for this setup, so the publisher blueprint includes a workflow-local `Config` Set node.

After importing `the n8n workflows blueprint/the publisher.json`, configure:

- `Config` Set node: replace `REPLACE_WITH_PUBLIC_APP_URL` with the public base URL for the Express app, for example `https://your-app.example.com`.
- `Webhook Secret` credential: header auth for the app-to-n8n publisher webhook.
- App status callbacks are set to no authentication for local testing. Add auth to the `Notify App:*` nodes later if your public app endpoint requires it.
- `Meta Page Access Token (test page)` credential: HTTP Header Auth credential for one test page.

For the first test, use one page only. In n8n, create the `Meta Page Access Token (test page)` HTTP Header Auth credential with:

```text
Name: Authorization
Value: Bearer REPLACE_WITH_TEST_PAGE_ACCESS_TOKEN
```

Do not put page access tokens in the frontend payload or in workflow JSON.

The Page Sync blueprint also uses `REPLACE_WITH_PUBLIC_APP_URL/api/pages`; replace that placeholder before testing page sync.

For local/ngrok testing, the publisher workflow downloads `job.media_url` in n8n first and uploads the binary file to Meta. This avoids relying on Meta fetching ngrok-hosted media URLs directly.

Exact photo upload settings in the n8n publisher blueprint:

- `Download Media`: HTTP Request `GET` to `={{ $json.media_url }}`, response format `File`, binary property `media_file`, header `ngrok-skip-browser-warning: true`.
- `Verify Downloaded Media`: checks `binary.media_file`, requires `mimeType` starting with `image/`, and requires `fileSize`.
- `Publish Photo`: HTTP Request `POST` to `https://graph.facebook.com/v25.0/{{ $json.page_id }}/photos`, body content type `multipart/form-data`.
- `Publish Photo` body fields: binary form field `source` from input data field `media_file`, and text form field `caption` from `={{ $json.caption }}`.
- `Publish Photo` must not send `url` or a text `source` value.

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
