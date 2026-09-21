const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const ActivityLog = require('../models/ActivityLog');
const authMiddleware = require('../middleware/auth');

const DB_FILE = path.join(__dirname, '..', 'local_database.json');

const getOfflineDb = () => {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], profiles: [], activityLogs: [] }));
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.activityLogs) data.activityLogs = [];
    return data;
};

// --------------------------------------------------------
// GET /api/activities/me
// Get authenticated user's recent activities
// --------------------------------------------------------
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        const limit = parseInt(req.query.limit, 10) || 20;

        if (mongoose.connection.readyState === 1) {
            const logs = await ActivityLog.find({ userId })
                .sort({ createdAt: -1 })
                .limit(limit);
            return res.json(logs);
        } else {
            const db = getOfflineDb();
            const logs = db.activityLogs
                .filter(l => l.userId === userId)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, limit);
            return res.json(logs);
        }
    } catch (err) {
        console.error('Fetch activities error:', err);
        return res.status(500).json({ error: 'Failed to retrieve activities.' });
    }
});

// --------------------------------------------------------
// GET /api/activities/user/:userId
// Get public activity feed for a user
// --------------------------------------------------------
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const limit = parseInt(req.query.limit, 10) || 15;

        // Filter out sensitive auth events for public feed
        const publicActions = ['PROFILE_UPDATE', 'AVATAR_UPDATE', 'SKILL_ADD', 'AUTH_REGISTER'];

        if (mongoose.connection.readyState === 1) {
            const logs = await ActivityLog.find({
                userId,
                action: { $in: publicActions }
            })
                .sort({ createdAt: -1 })
                .limit(limit);
            return res.json(logs);
        } else {
            const db = getOfflineDb();
            const logs = db.activityLogs
                .filter(l => l.userId === userId && publicActions.includes(l.action))
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, limit);
            return res.json(logs);
        }
    } catch (err) {
        console.error('Fetch user activities error:', err);
        return res.status(500).json({ error: 'Failed to retrieve activities.' });
    }
});

module.exports = router;
