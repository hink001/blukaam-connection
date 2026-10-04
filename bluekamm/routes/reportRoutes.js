const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const Report = require('../models/Report');
const authMiddleware = require('../middleware/auth');
const { cleanText } = require('../utils/sanitize');

const DB_FILE = path.join(__dirname, '..', 'local_database.json');
const isMongo = () => mongoose.connection.readyState === 1;

const getOfflineDb = () => {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], profiles: [], reports: [] }));
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.reports) data.reports = [];
    return data;
};
const saveOfflineDb = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

const VALID_REASONS = ['spam', 'harassment', 'fake profile', 'inappropriate content', 'scam', 'other'];

// -------------------------------------------------------------
// POST /api/reports/:userId (or POST /api/reports)
// -------------------------------------------------------------
router.post(['/:userId', '/'], authMiddleware, async (req, res) => {
    try {
        const reporterId = req.user.userId;
        const reportedUserId = req.params.userId || req.body.reportedUserId;
        let reason = (req.body.reason || 'other').toLowerCase().trim();
        const description = cleanText(req.body.description || '');

        if (!reportedUserId) {
            return res.status(400).json({ error: 'Reported user ID is required.' });
        }
        if (String(reporterId) === String(reportedUserId)) {
            return res.status(400).json({ error: 'You cannot report yourself.' });
        }

        if (!VALID_REASONS.includes(reason)) {
            reason = 'other';
        }

        const reportData = {
            reporterId,
            reportedUserId,
            reason,
            description,
            status: 'pending'
        };

        if (isMongo()) {
            await Report.create(reportData);
        } else {
            const db = getOfflineDb();
            db.reports.push({
                _id: 'rep_' + Date.now(),
                ...reportData,
                createdAt: new Date().toISOString()
            });
            saveOfflineDb(db);
        }

        return res.status(201).json({
            message: 'Report submitted successfully. Our safety team will review it.'
        });
    } catch (err) {
        console.error('Report error:', err);
        return res.status(500).json({ error: 'Failed to submit report. ' + err.message });
    }
});

module.exports = router;
