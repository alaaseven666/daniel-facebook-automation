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
            posting_date TEXT,
            page_id TEXT NOT NULL,
            page_name TEXT,
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
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(batch_id, page_id, slot_number)
        )
    `).run();

    migratePostQueueSchema();

    // Table: settings
    db.prepare(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `).run();

    console.log('Database initialized successfully.');
}

function migratePostQueueSchema() {
    const columns = db.prepare(`PRAGMA table_info(post_queue)`).all().map((column) => column.name);
    const addColumn = (name, definition) => {
        if (!columns.includes(name)) {
            db.prepare(`ALTER TABLE post_queue ADD COLUMN ${name} ${definition}`).run();
        }
    };

    addColumn('posting_date', 'TEXT');
    addColumn('page_name', 'TEXT');
    addColumn('updated_at', 'TEXT');

    db.prepare(`
        UPDATE post_queue
        SET posting_date = substr(scheduled_at, 1, 10)
        WHERE posting_date IS NULL OR posting_date = ''
    `).run();

    db.prepare(`
        UPDATE post_queue
        SET page_name = (
            SELECT pages.page_name
            FROM pages
            WHERE pages.page_id = post_queue.page_id
        )
        WHERE page_name IS NULL OR page_name = ''
    `).run();

    db.prepare(`
        UPDATE post_queue
        SET updated_at = COALESCE(created_at, datetime('now'))
        WHERE updated_at IS NULL OR updated_at = ''
    `).run();

    try {
        db.prepare(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_post_queue_batch_page_slot
            ON post_queue(batch_id, page_id, slot_number)
        `).run();
    } catch (error) {
        console.warn('Could not create post_queue idempotency index. Remove duplicate batch/page/slot rows and restart the app.', error.message);
    }
}

// Helper Functions
const dbHelpers = {
    getAllPages: () => {
        return db.prepare(`SELECT * FROM pages WHERE active = 1`).all();
    },

    getAllPagesPublic: () => {
        return db.prepare(`
            SELECT id, page_id, page_name, token_expires_at, active
            FROM pages
            WHERE active = 1
            ORDER BY page_name ASC
        `).all();
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
            INSERT OR IGNORE INTO post_queue (
                batch_id, posting_date, page_id, page_name, slot_number, content_type, media_url, 
                caption, first_comment, comment_delay, scheduled_at, status, comment_status
            ) VALUES (
                @batch_id, @posting_date, @page_id, @page_name, @slot_number, @content_type, @media_url, 
                @caption, @first_comment, @comment_delay, @scheduled_at, 'pending', 'pending'
            )
        `);
        const find = db.prepare(`
            SELECT pq.*, COALESCE(pq.page_name, p.page_name) AS page_name
            FROM post_queue pq
            LEFT JOIN pages p ON pq.page_id = p.page_id
            WHERE pq.batch_id = @batch_id
              AND pq.page_id = @page_id
              AND pq.slot_number = @slot_number
        `);

        const insertMany = db.transaction((itemsToInsert) => {
            const rows = [];
            for (const item of itemsToInsert) {
                const result = insert.run(item);
                rows.push({
                    ...find.get(item),
                    was_inserted: result.changes === 1
                });
            }
            return rows;
        });

        return insertMany(items);
    },

    getQueueByDate: (dateStr) => {
        return db.prepare(`
            SELECT pq.*, COALESCE(pq.page_name, p.page_name) AS page_name
            FROM post_queue pq
            LEFT JOIN pages p ON pq.page_id = p.page_id
            WHERE COALESCE(pq.posting_date, substr(pq.scheduled_at, 1, 10)) = ?
            ORDER BY pq.scheduled_at ASC, p.page_name ASC
        `).all(dateStr);
    },

    getQueueItem: (id) => {
        return db.prepare(`
            SELECT pq.*, COALESCE(pq.page_name, p.page_name) AS page_name
            FROM post_queue pq
            LEFT JOIN pages p ON pq.page_id = p.page_id
            WHERE pq.id = ?
        `).get(id);
    },

    updateQueueStatus: (id, status, fbPostId = undefined, errorMessage = undefined, commentStatus = undefined) => {
        let sql = `UPDATE post_queue SET status = ?, updated_at = datetime('now')`;
        const params = [status];
        
        if (fbPostId !== undefined) {
            sql += `, fb_post_id = ?`;
            params.push(fbPostId);
        }
        
        if (errorMessage !== undefined) {
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

    updateQueueStatusByIdentity: (identity, status, fbPostId = undefined, errorMessage = undefined, commentStatus = undefined) => {
        let sql = `UPDATE post_queue SET status = ?, updated_at = datetime('now')`;
        const params = [status];

        if (fbPostId !== undefined) {
            sql += `, fb_post_id = ?`;
            params.push(fbPostId);
        }

        if (errorMessage !== undefined) {
            sql += `, error_message = ?`;
            params.push(errorMessage);
        }

        if (commentStatus !== undefined) {
            sql += `, comment_status = ?`;
            params.push(commentStatus);
        }

        sql += ` WHERE batch_id = ? AND page_id = ? AND slot_number = ?`;
        params.push(identity.batch_id, identity.page_id, identity.slot_number);

        return db.prepare(sql).run(...params);
    },

    updateQueueFields: (identity, fields) => {
        const assignments = ['updated_at = datetime(\'now\')'];
        const params = [];

        for (const [column, value] of Object.entries(fields)) {
            if (value !== undefined) {
                assignments.push(`${column} = ?`);
                params.push(value);
            }
        }

        let sql = `UPDATE post_queue SET ${assignments.join(', ')}`;
        if (identity.queue_id) {
            sql += ` WHERE id = ?`;
            params.push(identity.queue_id);
        } else {
            sql += ` WHERE batch_id = ? AND page_id = ? AND slot_number = ?`;
            params.push(identity.batch_id, identity.page_id, identity.slot_number);
        }

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
