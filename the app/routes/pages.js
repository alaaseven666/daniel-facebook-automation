const express = require("express");
const router = express.Router();
const { dbHelpers } = require("../db");

// GET /api/pages - Fetch all synced pages for the frontend
router.get("/", (req, res) => {
  try {
    const pages = dbHelpers.getAllPages();
    res.json(pages);
  } catch (error) {
    console.error("Error fetching pages:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/pages - Receive automated Page Sync data from n8n
router.post("/", (req, res) => {
  try {
    const { page_id, page_name, access_token, active } = req.body;

    if (!page_id || !page_name || !access_token) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Use the existing database helper to insert or update the page
    dbHelpers.upsertPage({
      page_id: page_id,
      page_name: page_name,
      access_token: access_token,
      active: active || 1,
      token_expires_at: null,
    });

    res
      .status(200)
      .json({ success: true, message: "Page synced successfully from n8n" });
  } catch (error) {
    console.error("Error saving page to database from n8n:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/pages/token - Update token from n8n (for future refresh workflows)
router.post("/token", (req, res) => {
  try {
    const { page_id, access_token, token_expires_at } = req.body;

    if (!page_id || !access_token) {
      return res.status(400).json({ error: "Missing page_id or access_token" });
    }

    dbHelpers.updatePageToken(page_id, access_token, token_expires_at || null);
    res.json({ success: true });
  } catch (error) {
    console.error("Error updating page token:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/pages/sync - Trigger n8n sync from the frontend button
router.post("/sync", (req, res) => {
  // In a real implementation, you would trigger the n8n webhook here.
  if (
    req.body &&
    req.body.page_id &&
    req.body.page_name &&
    req.body.access_token
  ) {
    try {
      dbHelpers.upsertPage({
        page_id: req.body.page_id,
        page_name: req.body.page_name,
        access_token: req.body.access_token,
        token_expires_at: req.body.token_expires_at || null,
      });
      return res.json({ success: true, message: "Page synced manually" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.json({ success: true, message: "Sync triggered" });
});

module.exports = router;
