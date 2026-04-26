const express = require('express');
const router = express.Router();
const { dbHelpers } = require('../db');

const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'Africa/Cairo';

function normalizeContentType(value) {
    const type = String(value || '').toLowerCase();
    if (type === 'photo' || type === 'reel') return type;
    throw new Error(`Unsupported content_type "${value}". Expected photo or reel.`);
}

function normalizeDelaySeconds(value) {
    const delay = Number.parseInt(value, 10);
    if (!Number.isFinite(delay) || delay < 0) return 60;
    return delay;
}

function getOffsetSuffix(timeZone, date) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'shortOffset',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).formatToParts(date);
    const value = parts.find((part) => part.type === 'timeZoneName')?.value;
    if (!value) {
        throw new Error(`Could not determine timezone offset for ${timeZone}`);
    }
    const match = value.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (!match) {
        throw new Error(`Could not determine timezone offset for ${timeZone}`);
    }

    const hours = match[2].padStart(2, '0');
    const minutes = (match[3] || '00').padStart(2, '0');
    return `${match[1]}${hours}:${minutes}`;
}

function normalizeScheduledTime(value, postingDate, timeZone) {
    if (!value) {
        throw new Error('scheduled_time is required for every post.');
    }

    const raw = String(value).trim();
    if (/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)) {
        return raw;
    }

    const localDateTime = raw.includes('T') ? raw : `${postingDate}T${raw}`;
    const match = localDateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) {
        throw new Error(`Invalid scheduled_time "${value}". Use YYYY-MM-DDTHH:mm:ss or include an offset.`);
    }

    const [, year, month, day, hour, minute, second = '00'] = match;
    const utcGuess = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
    return `${year}-${month}-${day}T${hour}:${minute}:${second}${getOffsetSuffix(timeZone, utcGuess)}`;
}

function toN8nJob(row) {
    return {
        queue_id: row.id,
        batch_id: row.batch_id,
        slot_number: row.slot_number,
        page_id: row.page_id,
        page_name: row.page_name,
        content_type: row.content_type,
        media_url: row.media_url,
        caption: row.caption || '',
        scheduled_time: row.scheduled_at,
        first_comment: row.first_comment || '',
        comment_delay_seconds: row.comment_delay
    };
}

// GET /api/queue?date=YYYY-MM-DD
router.get('/', (req, res) => {
    try {
        const date = req.query.date || new Date().toISOString().split('T')[0];
        const queueItems = dbHelpers.getQueueByDate(date);
        res.json(queueItems);
    } catch (error) {
        console.error('Error fetching queue:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/queue (Submit batch)
router.post('/', async (req, res) => {
    try {
        const { batch_id, posting_date, posts, timezone } = req.body;

        if (!batch_id || !posting_date || !Array.isArray(posts)) {
            return res.status(400).json({
                error: 'Missing required fields. Expected batch_id, posting_date, and posts[].',
                hint: 'n8n should call /api/queue/status, not /api/queue. /api/queue is only for app-created batches.'
            });
        }

        const batchTimezone = timezone || DEFAULT_TIMEZONE;
        const itemsToInsert = [];

        for (const post of posts) {
            if (!post.pages || post.pages.length === 0) continue;

            const slotNumber = Number.parseInt(post.slot_number || post.slot, 10);
            if (!Number.isInteger(slotNumber) || slotNumber < 1) {
                return res.status(400).json({ error: 'Every post must include a positive slot or slot_number.' });
            }

            for (const page of post.pages) {
                if (!page.page_id) {
                    return res.status(400).json({ error: 'Every selected page must include page_id.' });
                }

                itemsToInsert.push({
                    batch_id,
                    posting_date,
                    page_id: page.page_id,
                    page_name: page.page_name || null,
                    slot_number: slotNumber,
                    content_type: normalizeContentType(post.content_type),
                    media_url: post.media_url || null,
                    caption: post.caption || '',
                    first_comment: post.first_comment || '',
                    comment_delay: normalizeDelaySeconds(post.comment_delay_seconds),
                    scheduled_at: normalizeScheduledTime(post.scheduled_time, posting_date, batchTimezone)
                });
            }
        }

        if (itemsToInsert.length === 0) {
             return res.status(400).json({ error: 'No valid posts found in payload' });
        }

        const queueRows = dbHelpers.insertQueueItems(itemsToInsert);
        const jobs = queueRows.map(toN8nJob);
        const newJobs = queueRows.filter((row) => row.was_inserted).map(toN8nJob);

        const webhookUrl = dbHelpers.getSetting('n8n_webhook_url');
        let n8nStatus = 'skipped';
        if (webhookUrl && newJobs.length > 0) {
            try {
                 const response = await fetch(webhookUrl, {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({
                        batch_id,
                        posting_date,
                        timezone: batchTimezone,
                        callback_url: dbHelpers.getSetting('n8n_status_callback_url') || '/api/queue/status',
                        jobs: newJobs
                     })
                 });
                 if (!response.ok) {
                     console.error(`Warning: n8n webhook returned status ${response.status}`);
                     n8nStatus = `error:${response.status}`;
                 } else {
                     n8nStatus = 'sent';
                 }
            } catch (webhookErr) {
                 console.error('Failed to forward to n8n webhook:', webhookErr.message);
                 n8nStatus = 'error';
            }
        } else {
             console.log(newJobs.length === 0 ? 'No new jobs to forward to n8n.' : 'n8n_webhook_url not set in settings. Skipping forward.');
        }

        res.json({ success: true, queued: newJobs.length, total_jobs: jobs.length, n8n_status: n8nStatus, jobs });
    } catch (error) {
        console.error('Error submitting queue:', error);
        res.status(400).json({ error: error.message });
    }
});

// POST /api/queue/status (Callback from n8n)
router.post('/status', (req, res) => {
    try {
        const { queue_id, status, fb_post_id, error_message, comment_status } = req.body;
        
        if (!status && comment_status === undefined && error_message === undefined && fb_post_id === undefined) {
             return res.status(400).json({ error: 'Missing status, comment_status, fb_post_id, or error_message' });
        }

        const { batch_id, page_id, slot_number } = req.body;
        if (!queue_id && (!batch_id || !page_id || !slot_number)) {
            return res.status(400).json({
                error: 'Missing queue_id or fallback identity fields batch_id, page_id, and slot_number'
            });
        }

        const result = dbHelpers.updateQueueFields(
            queue_id ? { queue_id } : { batch_id, page_id, slot_number },
            {
                status,
                fb_post_id,
                error_message,
                comment_status
            }
        );

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Queue item not found' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating queue status:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/queue/retry
router.post('/retry', (req, res) => {
    try {
        const { queue_id } = req.body;
        if (!queue_id) {
             return res.status(400).json({ error: 'Missing queue_id' });
        }

        const result = dbHelpers.updateQueueStatus(queue_id, 'pending', null, null, 'pending');
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Queue item not found' });
        }
        
        res.json({ success: true });
    } catch (error) {
         console.error('Error retrying queue item:', error);
         res.status(500).json({ error: error.message });
    }
});

module.exports = router;
