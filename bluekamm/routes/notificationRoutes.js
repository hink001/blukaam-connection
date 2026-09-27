const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const Notification = require('../models/Notification');
const authMiddleware = require('../middleware/auth');

const DB_FILE = path.join(__dirname, '..', 'local_database.json');
const isMongo = () => mongoose.connection.readyState === 1;

const getOfflineDb = () => {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], profiles: [], notifications: [] }));
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.notifications) data.notifications = [];
    return data;
};
const saveOfflineDb = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

// GET /api/notifications  — recent notifications for the logged-in user
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

        if (isMongo()) {
            const notifications = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(limit);
            return res.json(notifications);
        } else {
            const db = getOfflineDb();
            const notifications = db.notifications
                .filter(n => n.userId === userId)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, limit);
            return res.json(notifications);
        }
    } catch (err) {
        console.error('Fetch notifications error:', err);
        return res.status(500).json({ error: 'Failed to load notifications.' });
    }
});

// GET /api/notifications/unread-count
router.get('/unread-count', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        if (isMongo()) {
            const count = await Notification.countDocuments({ userId, isRead: false });
            return res.json({ count });
        } else {
            const db = getOfflineDb();
            const count = db.notifications.filter(n => n.userId === userId && !n.isRead).length;
            return res.json({ count });
        }
    } catch (err) {
        console.error('Unread count error:', err);
        return res.status(500).json({ error: 'Failed to load unread count.' });
    }
});

// POST /api/notifications/:id/read
router.post('/:id/read', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        const { id } = req.params;
        if (isMongo()) {
            await Notification.updateOne({ _id: id, userId }, { $set: { isRead: true } });
        } else {
            const db = getOfflineDb();
            const n = db.notifications.find(x => x._id === id && x.userId === userId);
            if (n) { n.isRead = true; saveOfflineDb(db); }
        }
        return res.json({ message: 'Marked as read.' });
    } catch (err) {
        console.error('Mark notification read error:', err);
        return res.status(500).json({ error: 'Failed to update notification.' });
    }
});

// POST /api/notifications/read-all
router.post('/read-all', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        if (isMongo()) {
            await Notification.updateMany({ userId, isRead: false }, { $set: { isRead: true } });
        } else {
            const db = getOfflineDb();
            db.notifications.forEach(n => { if (n.userId === userId) n.isRead = true; });
            saveOfflineDb(db);
        }
        return res.json({ message: 'All notifications marked as read.' });
    } catch (err) {
        console.error('Mark all notifications read error:', err);
        return res.status(500).json({ error: 'Failed to update notifications.' });
    }
});

module.exports = router;
