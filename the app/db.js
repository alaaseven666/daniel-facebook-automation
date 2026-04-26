const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.dirname(process.env.DB_PATH || './data/automation.db');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize SQLite database
const db = new Database(process.env.DB_PATH || './data/automation.db', { verbose: console.log });

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Initialize Tables
function initDb() {
    // Table: pages
    db.prepare(`
        CREATE TABLE IF NOT EXISTS pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id TEXT NOT NULL UNIQUE,
            page_name TEXT NOT NULL,
            access_token TEXT NOT NULL,
            token_expires_at TEXT,
            active INTEGER DEFAULT 1
        )
    `).run();

    // Table: post_queue
    db.prepare(`
        CREATE TABLE IF NOT EXISTS post_queue (
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
        )
    `).run();

    // Table: settings
    db.prepare(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `).run();

    console.log('Database initialized successfully.');
}

// Helper Functions
const dbHelpers = {
    getAllPages: () => {
        return db.prepare(`SELECT * FROM pages WHERE active = 1`).all();
    },

    upsertPage: (pageData) => {
        const stmt = db.prepare(`
            INSERT INTO pages (page_id, page_name, access_token, token_expires_at, active)
            VALUES (@page_id, @page_name, @access_token, @token_expires_at, 1)
            ON CONFLICT(page_id) DO UPDATE SET
                page_name = excluded.page_name,
                access_token = excluded.access_token,
                token_expires_at = excluded.token_expires_at,
                active = 1
        `);
        return stmt.run(pageData);
    },

    updatePageToken: (pageId, token, expiresAt) => {
        const stmt = db.prepare(`
            UPDATE pages 
            SET access_token = ?, token_expires_at = ? 
            WHERE page_id = ?
        `);
        return stmt.run(token, expiresAt, pageId);
    },

    insertQueueItems: (items) => {
        const insert = db.prepare(`
            INSERT INTO post_queue (
                batch_id, page_id, slot_number, content_type, media_url, 
                caption, first_comment, comment_delay, scheduled_at, status
            ) VALUES (
                @batch_id, @page_id, @slot_number, @content_type, @media_url, 
                @caption, @first_comment, @comment_delay, @scheduled_at, 'pending'
            )
        `);

        const insertMany = db.transaction((itemsToInsert) => {
            for (const item of itemsToInsert) {
                insert.run(item);
            }
        });

        insertMany(items);
    },

    getQueueByDate: (dateStr) => {
        return db.prepare(`
            SELECT pq.*, p.page_name 
            FROM post_queue pq
            JOIN pages p ON pq.page_id = p.page_id
            WHERE date(pq.scheduled_at) = ?
            ORDER BY pq.scheduled_at ASC, p.page_name ASC
        `).all(dateStr);
    },

    updateQueueStatus: (id, status, fbPostId = null, errorMessage = null, commentStatus = undefined) => {
        let sql = `UPDATE post_queue SET status = ?`;
        const params = [status];
        
        if (fbPostId !== null) {
            sql += `, fb_post_id = ?`;
            params.push(fbPostId);
        }
        
        if (errorMessage !== null) {
            sql += `, error_message = ?`;
            params.push(errorMessage);
        }

        if (commentStatus !== undefined) {
            sql += `, comment_status = ?`;
            params.push(commentStatus);
        }
        
        sql += ` WHERE id = ?`;
        params.push(id);
        
        return db.prepare(sql).run(...params);
    },

    getSetting: (key) => {
        const result = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
        return result ? result.value : null;
    },

    setSetting: (key, value) => {
        const stmt = db.prepare(`
            INSERT INTO settings (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `);
        return stmt.run(key, value);
    },

    getAllSettings: () => {
        const rows = db.prepare(`SELECT * FROM settings`).all();
        const settingsObj = {};
        for (const row of rows) {
            settingsObj[row.key] = row.value;
        }
        return settingsObj;
    }
};

// Initialize the database on module load
initDb();

module.exports = { db, dbHelpers };
