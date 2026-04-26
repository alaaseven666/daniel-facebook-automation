require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const { dbHelpers } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve frontend
app.use('/media', express.static(path.join(__dirname, 'media'))); // Serve uploaded media files

// --- Routes ---
app.use('/api/upload', require('./routes/upload'));
app.use('/api/queue', require('./routes/queue'));
app.use('/api/pages', require('./routes/pages'));
app.use('/api/settings', require('./routes/settings'));

// --- Catch-all for SPA ---
app.get(/(.*)/, (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) {
        return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Cron Jobs ---
// Runs daily at 02:00 — deletes media files older than 24h
cron.schedule('0 2 * * *', () => {
    console.log('Running daily media cleanup cron job...');
    const mediaDir = path.join(__dirname, 'media');
    
    if (fs.existsSync(mediaDir)) {
        const files = fs.readdirSync(mediaDir);
        const now = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;

        files.forEach(file => {
            if (file === '.gitkeep') return; // Ignore .gitkeep if present
            
            const filePath = path.join(mediaDir, file);
            const stats = fs.statSync(filePath);
            
            if (now - stats.mtime.getTime() > ONE_DAY) {
                fs.unlinkSync(filePath);
                console.log(`Deleted old media file: ${file}`);
            }
        });
    }
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Facebook Pages Automation app listening at http://localhost:${PORT}`);
    
    // Seed default settings if they don't exist
    const defaults = {
        'n8n_webhook_url': '',
        'n8n_status_callback_url': '',
        'public_media_base_url': `http://localhost:${PORT}/media`,
        'default_comment_delay': '60',
        'default_first_post_time': '15:00'
    };
    
    for (const [key, value] of Object.entries(defaults)) {
        if (dbHelpers.getSetting(key) === null) {
            dbHelpers.setSetting(key, value);
        }
    }
});
