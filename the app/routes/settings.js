const express = require('express');
const router = express.Router();
const { dbHelpers } = require('../db');

// GET /api/settings
router.get('/', (req, res) => {
    try {
        const settings = dbHelpers.getAllSettings();
        res.json(settings);
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/settings
router.post('/', (req, res) => {
    try {
        const settingsToUpdate = req.body;
        
        if (typeof settingsToUpdate !== 'object' || settingsToUpdate === null) {
            return res.status(400).json({ error: 'Invalid settings payload' });
        }

        for (const [key, value] of Object.entries(settingsToUpdate)) {
            dbHelpers.setSetting(key, value.toString());
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
