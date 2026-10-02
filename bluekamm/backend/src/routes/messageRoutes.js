const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const Message = require('../models/Message');
const Connection = require('../models/Connection');
const Profile = require('../models/Profile');
const authMiddleware = require('../middleware/auth');
const { cleanText } = require('../utils/sanitize');
const { createNotification } = require('../services/notificationService');

const DB_FILE = path.join(__dirname, '..', 'local_database.json');
const isMongo = () => mongoose.connection.readyState === 1;

const getOfflineDb = () => {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], profiles: [], connections: [], messages: [] }));
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.messages) data.messages = [];
    return data;
};
const saveOfflineDb = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

const sortedPair = (a, b) => [String(a), String(b)].sort();

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

async function areConnected(userA, userB) {
    if (isMongo()) {
        const c = await Connection.findOne({
            status: 'accepted',
            $or: [{ requesterId: userA, recipientId: userB }, { requesterId: userB, recipientId: userA }]
        });
        return !!c;
    } else {
        const db = getOfflineDb();
        return !!(db.connections || []).find(c =>
            c.status === 'accepted' &&
            ((c.requesterId === userA && c.recipientId === userB) || (c.requesterId === userB && c.recipientId === userA))
        );
    }
}

// --------------------------------------------------------
// POST /api/messages/send/:userId
// Contractors and workers must be connected before they can message each other,
// matching the roadmap's "discuss job details and hire workers" flow.
// --------------------------------------------------------
router.post('/send/:userId', authMiddleware, async (req, res) => {
    try {
        const senderId = req.user.userId;
        const recipientId = req.params.userId;
        const text = cleanText(req.body.text);

        if (!text) return res.status(400).json({ error: 'Message cannot be empty.' });
        if (String(senderId) === String(recipientId)) {
            return res.status(400).json({ error: 'You cannot message yourself.' });
        }

        const connected = await areConnected(senderId, recipientId);
        if (!connected) {
            return res.status(403).json({ error: 'You must be connected with this person before you can message them.' });
        }

        const messageData = {
            participants: sortedPair(senderId, recipientId),
            senderId,
            recipientId,
            text
        };

        let saved;
        if (isMongo()) {
            saved = await Message.create(messageData);
        } else {
            const db = getOfflineDb();
            saved = { _id: 'msg_' + Date.now(), ...messageData, readAt: null, createdAt: new Date().toISOString() };
            db.messages.push(saved);
            saveOfflineDb(db);
        }

        const snapshot = await getProfileSnapshot(senderId);
        await createNotification({
            userId: recipientId,
            type: 'new_message',
            fromUserId: senderId,
            fromName: snapshot.name,
            fromAvatar: snapshot.avatar,
            message: `New message from ${snapshot.name}.`,
            link: 'messages.html'
        });

        return res.status(201).json({ message: saved });
    } catch (err) {
        console.error('Send message error:', err);
        return res.status(500).json({ error: 'Failed to send message. ' + err.message });
    }
});

// --------------------------------------------------------
// GET /api/messages/thread/:userId
// Full message history with one specific user
// --------------------------------------------------------
router.get('/thread/:userId', authMiddleware, async (req, res) => {
    try {
        const myId = req.user.userId;
        const otherId = req.params.userId;
        const pair = sortedPair(myId, otherId);

        let messages;
        if (isMongo()) {
            messages = await Message.find({ participants: { $all: pair, $size: 2 } }).sort({ createdAt: 1 }).limit(200);
        } else {
            const db = getOfflineDb();
            messages = db.messages
                .filter(m => sortedPair(m.participants[0], m.participants[1]).join('|') === pair.join('|'))
                .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        }
        return res.json(messages);
    } catch (err) {
        console.error('Fetch thread error:', err);
        return res.status(500).json({ error: 'Failed to load conversation.' });
    }
});

// --------------------------------------------------------
// GET /api/messages/conversations
// One row per conversation partner, with the last message and unread count
// --------------------------------------------------------
router.get('/conversations', authMiddleware, async (req, res) => {
    try {
        const myId = req.user.userId;
        let all;

        if (isMongo()) {
            all = await Message.find({ participants: myId }).sort({ createdAt: -1 }).limit(500);
        } else {
            const db = getOfflineDb();
            all = db.messages
                .filter(m => m.participants.includes(myId))
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }

        const byPartner = new Map();
        for (const m of all) {
            const partnerId = String(m.senderId) === String(myId) ? m.recipientId : m.senderId;
            const key = String(partnerId);
            if (!byPartner.has(key)) {
                byPartner.set(key, { partnerId, lastMessage: m.text, lastAt: m.createdAt, unread: 0 });
            }
            if (String(m.recipientId) === String(myId) && !m.readAt) {
                byPartner.get(key).unread += 1;
            }
        }

        const results = [];
        for (const convo of byPartner.values()) {
            const snapshot = await getProfileSnapshot(convo.partnerId);
            results.push({ ...convo, name: snapshot.name, avatar: snapshot.avatar });
        }

        return res.json(results);
    } catch (err) {
        console.error('Fetch conversations error:', err);
        return res.status(500).json({ error: 'Failed to load conversations.' });
    }
});

// --------------------------------------------------------
// POST /api/messages/read/:userId — mark all messages from this user as read
// --------------------------------------------------------
router.post('/read/:userId', authMiddleware, async (req, res) => {
    try {
        const myId = req.user.userId;
        const otherId = req.params.userId;

        if (isMongo()) {
            await Message.updateMany(
                { senderId: otherId, recipientId: myId, readAt: null },
                { $set: { readAt: new Date() } }
            );
        } else {
            const db = getOfflineDb();
            db.messages.forEach(m => {
                if (m.senderId === otherId && m.recipientId === myId && !m.readAt) {
                    m.readAt = new Date().toISOString();
                }
            });
            saveOfflineDb(db);
        }
        return res.json({ message: 'Conversation marked as read.' });
    } catch (err) {
        console.error('Mark thread read error:', err);
        return res.status(500).json({ error: 'Failed to update conversation.' });
    }
});

module.exports = router;
