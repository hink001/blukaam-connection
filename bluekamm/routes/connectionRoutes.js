const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const Connection = require('../models/Connection');
const Profile = require('../models/Profile');
const Block = require('../models/Block');
const authMiddleware = require('../middleware/auth');
const { logActivity } = require('../services/activityService');
const { createNotification } = require('../services/notificationService');

const DB_FILE = path.join(__dirname, '..', 'local_database.json');
const isMongo = () => mongoose.connection.readyState === 1;

async function isBlocked(userA, userB) {
    if (isMongo()) {
        const blk = await Block.findOne({
            $or: [
                { blockerId: userA, blockedId: userB },
                { blockerId: userB, blockedId: userA }
            ]
        });
        return !!blk;
    } else {
        const db = getOfflineDb();
        return (db.blocks || []).some(b =>
            (b.blockerId === userA && b.blockedId === userB) ||
            (b.blockerId === userB && b.blockedId === userA)
        );
    }
}

const getOfflineDb = () => {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], profiles: [], connections: [] }));
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.connections) data.connections = [];
    return data;
};
const saveOfflineDb = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

async function getProfileSnapshot(userId) {
    if (isMongo()) {
        const p = await Profile.findOne({ userId });
        return p ? { name: p.fullName || p.name || 'Member', avatar: p.avatarUrl || '' } : { name: 'Member', avatar: '' };
    } else {
        const db = getOfflineDb();
        const p = db.profiles.find(pr => pr.userId === userId);
        return p ? { name: p.fullName || p.name || 'Member', avatar: p.avatarUrl || '' } : { name: 'Member', avatar: '' };
    }
}

// --------------------------------------------------------
// POST /api/connections/request/:userId
// Send a connection request to another user
// --------------------------------------------------------
router.post('/request/:userId', authMiddleware, async (req, res) => {
    try {
        const requesterId = req.user.userId;
        const recipientId = req.params.userId;

        if (String(requesterId) === String(recipientId)) {
            return res.status(400).json({ error: 'You cannot connect with yourself.' });
        }

        if (await isBlocked(requesterId, recipientId)) {
            return res.status(403).json({ error: 'Cannot connect with this user due to block restrictions.' });
        }

        if (isMongo()) {
            // Look for any existing record in either direction
            const existing = await Connection.findOne({
                $or: [
                    { requesterId, recipientId },
                    { requesterId: recipientId, recipientId: requesterId }
                ]
            });

            if (existing) {
                if (existing.status === 'accepted') {
                    return res.status(409).json({ error: 'You are already connected.' });
                }
                if (existing.status === 'pending') {
                    return res.status(409).json({ error: 'A connection request is already pending.' });
                }
                // Previously withdrawn/rejected — revive as a fresh pending request from this requester
                existing.requesterId = requesterId;
                existing.recipientId = recipientId;
                existing.status = 'pending';
                existing.respondedAt = null;
                await existing.save();
            } else {
                await Connection.create({ requesterId, recipientId, status: 'pending' });
            }
        } else {
            const db = getOfflineDb();
            const existing = db.connections.find(c =>
                (c.requesterId === requesterId && c.recipientId === recipientId) ||
                (c.requesterId === recipientId && c.recipientId === requesterId)
            );
            if (existing) {
                if (existing.status === 'accepted') return res.status(409).json({ error: 'You are already connected.' });
                if (existing.status === 'pending') return res.status(409).json({ error: 'A connection request is already pending.' });
                existing.requesterId = requesterId;
                existing.recipientId = recipientId;
                existing.status = 'pending';
                existing.respondedAt = null;
                existing.updatedAt = new Date().toISOString();
            } else {
                db.connections.push({
                    _id: 'conn_' + Date.now(),
                    requesterId, recipientId, status: 'pending',
                    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
                });
            }
            saveOfflineDb(db);
        }

        const snapshot = await getProfileSnapshot(requesterId);
        await createNotification({
            userId: recipientId,
            type: 'connection_request',
            fromUserId: requesterId,
            fromName: snapshot.name,
            fromAvatar: snapshot.avatar,
            message: `${snapshot.name} wants to connect with you.`,
            link: 'network.html'
        });

        await logActivity({ userId: requesterId, action: 'CONNECTION_REQUEST', description: 'Sent a connection request', req });

        return res.status(201).json({ message: 'Connection request sent!' });
    } catch (err) {
        console.error('Connection request error:', err);
        return res.status(500).json({ error: 'Failed to send connection request. ' + err.message });
    }
});

// --------------------------------------------------------
// POST /api/connections/:id/accept
// --------------------------------------------------------
router.post('/:id/accept', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        const { id } = req.params;

        let connection;
        if (isMongo()) {
            connection = await Connection.findById(id);
        } else {
            const db = getOfflineDb();
            connection = db.connections.find(c => c._id === id);
        }
        if (!connection) return res.status(404).json({ error: 'Connection request not found.' });
        if (String(connection.recipientId) !== String(userId)) {
            return res.status(403).json({ error: 'You can only accept requests sent to you.' });
        }

        connection.status = 'accepted';
        connection.respondedAt = new Date();

        if (isMongo()) {
            await connection.save();
        } else {
            connection.updatedAt = new Date().toISOString();
            connection.respondedAt = connection.respondedAt.toISOString();
            const db = getOfflineDb();
            saveOfflineDb(db);
        }

        const snapshot = await getProfileSnapshot(userId);
        await createNotification({
            userId: connection.requesterId,
            type: 'connection_accepted',
            fromUserId: userId,
            fromName: snapshot.name,
            fromAvatar: snapshot.avatar,
            message: `${snapshot.name} accepted your connection request.`,
            link: 'network.html'
        });

        await logActivity({ userId, action: 'CONNECTION_ACCEPT', description: 'Accepted a connection request', req });
        return res.json({ message: 'Connection accepted!', connection });
    } catch (err) {
        console.error('Accept connection error:', err);
        return res.status(500).json({ error: 'Failed to accept connection.' });
    }
});

// --------------------------------------------------------
// POST /api/connections/:id/reject
// --------------------------------------------------------
router.post('/:id/reject', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        const { id } = req.params;

        if (isMongo()) {
            const connection = await Connection.findById(id);
            if (!connection) return res.status(404).json({ error: 'Connection request not found.' });
            if (String(connection.recipientId) !== String(userId)) {
                return res.status(403).json({ error: 'You can only reject requests sent to you.' });
            }
            connection.status = 'rejected';
            connection.respondedAt = new Date();
            await connection.save();
        } else {
            const db = getOfflineDb();
            const connection = db.connections.find(c => c._id === id);
            if (!connection) return res.status(404).json({ error: 'Connection request not found.' });
            if (connection.recipientId !== userId) return res.status(403).json({ error: 'You can only reject requests sent to you.' });
            connection.status = 'rejected';
            connection.respondedAt = new Date().toISOString();
            saveOfflineDb(db);
        }

        return res.json({ message: 'Connection request declined.' });
    } catch (err) {
        console.error('Reject connection error:', err);
        return res.status(500).json({ error: 'Failed to decline connection.' });
    }
});

// --------------------------------------------------------
// POST /api/connections/:id/withdraw
// Requester cancels their own pending request
// --------------------------------------------------------
router.post('/:id/withdraw', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        const { id } = req.params;

        if (isMongo()) {
            const connection = await Connection.findById(id);
            if (!connection) return res.status(404).json({ error: 'Connection request not found.' });
            if (String(connection.requesterId) !== String(userId)) {
                return res.status(403).json({ error: 'You can only withdraw requests you sent.' });
            }
            connection.status = 'withdrawn';
            await connection.save();
        } else {
            const db = getOfflineDb();
            const connection = db.connections.find(c => c._id === id);
            if (!connection) return res.status(404).json({ error: 'Connection request not found.' });
            if (connection.requesterId !== userId) return res.status(403).json({ error: 'You can only withdraw requests you sent.' });
            connection.status = 'withdrawn';
            saveOfflineDb(db);
        }

        return res.json({ message: 'Connection request withdrawn.' });
    } catch (err) {
        console.error('Withdraw connection error:', err);
        return res.status(500).json({ error: 'Failed to withdraw connection.' });
    }
});

// --------------------------------------------------------
// DELETE /api/connections/:id
// Remove an existing accepted connection (either side)
// --------------------------------------------------------
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        const { id } = req.params;

        if (isMongo()) {
            const connection = await Connection.findById(id);
            if (!connection) return res.status(404).json({ error: 'Connection not found.' });
            if (![String(connection.requesterId), String(connection.recipientId)].includes(String(userId))) {
                return res.status(403).json({ error: 'You are not part of this connection.' });
            }
            await Connection.findByIdAndDelete(id);
        } else {
            const db = getOfflineDb();
            const idx = db.connections.findIndex(c => c._id === id);
            if (idx === -1) return res.status(404).json({ error: 'Connection not found.' });
            const c = db.connections[idx];
            if (![c.requesterId, c.recipientId].includes(userId)) {
                return res.status(403).json({ error: 'You are not part of this connection.' });
            }
            db.connections.splice(idx, 1);
            saveOfflineDb(db);
        }
        return res.json({ message: 'Connection removed.' });
    } catch (err) {
        console.error('Remove connection error:', err);
        return res.status(500).json({ error: 'Failed to remove connection.' });
    }
});

// --------------------------------------------------------
// GET /api/connections/my (and /api/connections) — accepted connections
// --------------------------------------------------------
router.get(['/my', '/'], authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        let records;

        if (isMongo()) {
            records = await Connection.find({
                status: 'accepted',
                $or: [{ requesterId: userId }, { recipientId: userId }]
            }).sort({ respondedAt: -1 });
        } else {
            const db = getOfflineDb();
            records = db.connections.filter(c =>
                c.status === 'accepted' && (c.requesterId === userId || c.recipientId === userId)
            );
        }

        const results = [];
        for (const c of records) {
            const otherId = String(c.requesterId) === String(userId) ? c.recipientId : c.requesterId;
            const snapshot = await getProfileSnapshot(otherId);
            results.push({ connectionId: c._id, userId: otherId, name: snapshot.name, avatar: snapshot.avatar, since: c.respondedAt });
        }

        return res.json(results);
    } catch (err) {
        console.error('List connections error:', err);
        return res.status(500).json({ error: 'Failed to load connections.' });
    }
});

// --------------------------------------------------------
// GET /api/connections/pending (and /api/connections/requests) — incoming requests
// --------------------------------------------------------
router.get(['/pending', '/requests'], authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        let records;

        if (isMongo()) {
            records = await Connection.find({ recipientId: userId, status: 'pending' }).sort({ createdAt: -1 });
        } else {
            const db = getOfflineDb();
            records = db.connections.filter(c => c.recipientId === userId && c.status === 'pending');
        }

        const results = [];
        for (const c of records) {
            const snapshot = await getProfileSnapshot(c.requesterId);
            results.push({ connectionId: c._id, userId: c.requesterId, name: snapshot.name, avatar: snapshot.avatar, requestedAt: c.createdAt });
        }
        return res.json(results);
    } catch (err) {
        console.error('List pending connections error:', err);
        return res.status(500).json({ error: 'Failed to load pending requests.' });
    }
});

// --------------------------------------------------------
// GET /api/connections/sent — my outgoing pending requests
// --------------------------------------------------------
router.get('/sent', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        let records;

        if (isMongo()) {
            records = await Connection.find({ requesterId: userId, status: 'pending' }).sort({ createdAt: -1 });
        } else {
            const db = getOfflineDb();
            records = db.connections.filter(c => c.requesterId === userId && c.status === 'pending');
        }

        const results = [];
        for (const c of records) {
            const snapshot = await getProfileSnapshot(c.recipientId);
            results.push({ connectionId: c._id, userId: c.recipientId, name: snapshot.name, avatar: snapshot.avatar, requestedAt: c.createdAt });
        }
        return res.json(results);
    } catch (err) {
        console.error('List sent connections error:', err);
        return res.status(500).json({ error: 'Failed to load sent requests.' });
    }
});

// --------------------------------------------------------
// GET /api/connections/status/:userId — my connection status with a specific user
// --------------------------------------------------------
router.get('/status/:userId', authMiddleware, async (req, res) => {
    try {
        const myId = req.user.userId;
        const otherId = req.params.userId;

        let connection;
        if (isMongo()) {
            connection = await Connection.findOne({
                $or: [{ requesterId: myId, recipientId: otherId }, { requesterId: otherId, recipientId: myId }]
            });
        } else {
            const db = getOfflineDb();
            connection = db.connections.find(c =>
                (c.requesterId === myId && c.recipientId === otherId) ||
                (c.requesterId === otherId && c.recipientId === myId)
            );
        }

        if (!connection || ['rejected', 'withdrawn'].includes(connection.status)) {
            return res.json({ status: 'none' });
        }
        return res.json({
            status: connection.status,
            connectionId: connection._id,
            isRequester: String(connection.requesterId) === String(myId)
        });
    } catch (err) {
        console.error('Connection status error:', err);
        return res.status(500).json({ error: 'Failed to check connection status.' });
    }
});

// --------------------------------------------------------
// GET /api/connections/suggestions — "People You May Know"
// Ranks other profiles by shared city / trade (workType or industry), excluding
// the current user and anyone already connected/pending with them.
// --------------------------------------------------------
router.get('/suggestions', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 20);

        let myProfile, allProfiles, myConnections;
        if (isMongo()) {
            myProfile = await Profile.findOne({ userId });
            allProfiles = await Profile.find({ userId: { $ne: userId } }).limit(300);
            myConnections = await Connection.find({
                $or: [{ requesterId: userId }, { recipientId: userId }],
                status: { $in: ['accepted', 'pending'] }
            });
        } else {
            const db = getOfflineDb();
            myProfile = db.profiles.find(p => p.userId === userId);
            allProfiles = db.profiles.filter(p => p.userId !== userId);
            myConnections = db.connections.filter(c =>
                (c.requesterId === userId || c.recipientId === userId) &&
                ['accepted', 'pending'].includes(c.status)
            );
        }

        const excludedIds = new Set(
            myConnections.map(c => String(c.requesterId) === String(userId) ? String(c.recipientId) : String(c.requesterId))
        );

        const myCity = (myProfile?.location?.city || myProfile?.city || '').toLowerCase();
        const myTrade = (myProfile?.workType || myProfile?.industry || '').toLowerCase();

        const scored = allProfiles
            .filter(p => !excludedIds.has(String(p.userId)))
            .map(p => {
                let score = 0;
                const city = (p.location?.city || p.city || '').toLowerCase();
                const trade = (p.workType || p.industry || '').toLowerCase();
                if (myCity && city === myCity) score += 2;
                if (myTrade && trade === myTrade) score += 3;
                return { p, score };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(({ p }) => ({
                userId: p.userId,
                name: p.fullName || p.name || 'Member',
                headline: p.headline || '',
                avatar: p.avatarUrl || '',
                city: p.location?.city || p.city || '',
                trade: p.workType || p.industry || ''
            }));

        return res.json(scored);
    } catch (err) {
        console.error('Connection suggestions error:', err);
        return res.status(500).json({ error: 'Failed to load suggestions.' });
    }
});

module.exports = router;
