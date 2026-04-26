const express = require('express');
const router = express.Router();
const { dbHelpers } = require('../db');

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
        const { batch_id, posting_date, posts, stories } = req.body;

        if (!batch_id || !posting_date || !posts) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const itemsToInsert = [];

        // Parse posts
        for (const post of posts) {
            if (!post.pages || post.pages.length === 0) continue;
            for (const page of post.pages) {
                itemsToInsert.push({
                    batch_id: batch_id,
                    page_id: page.page_id,
                    slot_number: post.slot,
                    content_type: post.content_type,
                    media_url: post.media_url,
                    caption: post.caption,
                    first_comment: post.first_comment,
                    comment_delay: post.comment_delay_seconds || 60,
                    scheduled_at: post.scheduled_time
                });
            }
        }

        // Parse stories (if any)
        if (stories && stories.length > 0) {
            for (const story of stories) {
                if (!story.pages || story.pages.length === 0) continue;
                 for (const page of story.pages) {
                     itemsToInsert.push({
                        batch_id: batch_id,
                        page_id: page.page_id,
                        slot_number: story.slot || 0, // Stories might not have a strict slot
                        content_type: story.content_type,
                        media_url: story.media_url,
                        caption: '', // Stories usually don't use this caption field in the same way
                        first_comment: '',
                        comment_delay: 0,
                        scheduled_at: story.scheduled_time
                    });
                 }
            }
        }

        if (itemsToInsert.length === 0) {
             return res.status(400).json({ error: 'No valid posts found in payload' });
        }

        // Insert into DB
        dbHelpers.insertQueueItems(itemsToInsert);

        // Forward to n8n webhook
        const webhookUrl = dbHelpers.getSetting('n8n_webhook_url');
        if (webhookUrl) {
            // In a real scenario, you'd use fetch or axios here to send req.body to webhookUrl.
            // Using dynamic import for fetch as it's built-in in Node 18+
            try {
                 const response = await fetch(webhookUrl, {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify(req.body)
                 });
                 if (!response.ok) {
                     console.error(`Warning: n8n webhook returned status ${response.status}`);
                 }
            } catch (webhookErr) {
                 console.error('Failed to forward to n8n webhook:', webhookErr.message);
                 // We don't fail the request if n8n is down, it's in the queue now.
                 // The monitor will show it as pending.
            }
        } else {
             console.log('n8n_webhook_url not set in settings. Skipping forward.');
        }

        res.json({ success: true, queued: itemsToInsert.length });
    } catch (error) {
        console.error('Error submitting queue:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/queue/status (Callback from n8n)
router.post('/status', (req, res) => {
    try {
        const { queue_id, status, fb_post_id, error_message, comment_status } = req.body;
        
        if (!queue_id || !status) {
             return res.status(400).json({ error: 'Missing queue_id or status' });
        }

        dbHelpers.updateQueueStatus(queue_id, status, fb_post_id, error_message, comment_status);
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

        // Reset status to pending
        dbHelpers.updateQueueStatus(queue_id, 'pending', null, null, 'pending');
        
        // TODO: In a complete implementation, you might need to trigger a specific n8n workflow here,
        // or let the hourly publisher pick it up again if it looks for 'pending' posts in the past.
        
        res.json({ success: true });
    } catch (error) {
         console.error('Error retrying queue item:', error);
         res.status(500).json({ error: error.message });
    }
});

module.exports = router;
