const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const ActivityLog = require('../models/ActivityLog');

const DB_FILE = path.join(__dirname, '..', 'local_database.json');

/**
 * Log a user action to MongoDB or offline database
 * @param {Object} options
 * @param {String} options.userId - The ID of the user performing the action
 * @param {String} options.action - Action identifier e.g. AUTH_LOGIN, PROFILE_UPDATE
 * @param {String} options.description - Human readable summary
 * @param {Object} [options.metadata] - Extra structured metadata
 * @param {Object} [options.req] - Express request object for IP and UserAgent
 */
const logActivity = async ({ userId, action, description, metadata = {}, req = null }) => {
    try {
        let ipAddress = '';
        let userAgent = '';

        if (req) {
            ipAddress = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
            userAgent = req.headers['user-agent'] || '';
        }

        const logEntry = {
            userId,
            action,
            description,
            metadata,
            ipAddress,
            userAgent,
            createdAt: new Date()
        };

        if (mongoose.connection.readyState === 1) {
            // MongoDB is connected
            const created = await ActivityLog.create(logEntry);
            return created;
        } else {
            // Offline fallback
            if (!fs.existsSync(DB_FILE)) {
                fs.writeFileSync(DB_FILE, JSON.stringify({ profiles: [], users: [], activityLogs: [] }));
            }
            const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            if (!db.activityLogs) db.activityLogs = [];
            
            const offlineEntry = {
                ...logEntry,
                _id: 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)
            };
            db.activityLogs.unshift(offlineEntry);
            // Keep last 200 logs offline
            if (db.activityLogs.length > 200) db.activityLogs.length = 200;

            fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
            return offlineEntry;
        }
    } catch (err) {
        console.error('Failed to log activity:', err.message);
        return null;
    }
};

module.exports = {
    logActivity
};
