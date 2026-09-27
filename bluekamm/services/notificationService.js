const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');

const DB_FILE = path.join(__dirname, '..', 'local_database.json');

const getOfflineDb = () => {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], profiles: [], activityLogs: [], notifications: [] }));
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.notifications) data.notifications = [];
    return data;
};
const saveOfflineDb = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

/**
 * Create an in-app notification for a user. Works in both MongoDB and offline JSON mode.
 * Never throws — a failed notification should never break the action that triggered it.
 */
const createNotification = async ({ userId, type, fromUserId = null, fromName = '', fromAvatar = '', entityId = null, message, link = '' }) => {
    try {
        // Never notify a user about their own action
        if (userId && fromUserId && String(userId) === String(fromUserId)) return null;

        const entry = { userId, type, fromUserId, fromName, fromAvatar, entityId, message, link, isRead: false };

        if (mongoose.connection.readyState === 1) {
            return await Notification.create(entry);
        } else {
            const db = getOfflineDb();
            const offlineEntry = {
                _id: 'ntf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                ...entry,
                createdAt: new Date().toISOString()
            };
            db.notifications.unshift(offlineEntry);
            if (db.notifications.length > 300) db.notifications.length = 300;
            saveOfflineDb(db);
            return offlineEntry;
        }
    } catch (err) {
        console.error('Failed to create notification:', err.message);
        return null;
    }
};

module.exports = { createNotification };
