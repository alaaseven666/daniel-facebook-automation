const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { dbHelpers } = require('../db');

// Setup multer storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, './media/');
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${uuidv4()}${ext}`);
    }
});

// Setup multer upload filter
const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'];
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, MP4, and MOV are allowed.'), false);
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 500 * 1024 * 1024, // 500 MB max size
    },
    fileFilter: fileFilter
});

// POST /api/upload
router.post('/', upload.single('media_file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded or invalid file format' });
        }

        const baseUrl = dbHelpers.getSetting('public_media_base_url');
        // Ensure there's no trailing slash on baseUrl, and append filename
        const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        const publicUrl = `${cleanBaseUrl}/${req.file.filename}`;

        res.json({ url: publicUrl });
    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
