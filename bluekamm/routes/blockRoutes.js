const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const Block = require('../models/Block');
const Profile = require('../models/Profile');
const authMiddleware = require('../middleware/auth');

const DB_FILE = path.join(__dirname, '..', 'local_database.json');
const isMongo = () => mongoose.connection.readyState === 1;

const getOfflineDb = () => {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], profiles: [], blocks: [] }));
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.blocks) data.blocks = [];
    return data;
};
const saveOfflineDb = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

async function getProfileSnapshot(userId) {
    if (isMongo()) {
        const p = await Profile.findOne({ userId });
        return p ? { name: p.fullName || p.name || 'Member', avatar: p.avatarUrl || '' } : { name: 'Member', avatar: '' };
    } else {
        const db = getOfflineDb();
        const p = db.profiles.find(pr => pr.userId === userId || pr._id === userId || pr.id === userId);
        return p ? { name: p.fullName || p.name || 'Member', avatar: p.avatarUrl || '' } : { name: 'Member', avatar: '' };
    }
}

// -------------------------------------------------------------
// POST /api/blocks/:userId
// -------------------------------------------------------------
router.post('/:userId', authMiddleware, async (req, res) => {
    try {
        const blockerId = req.user.userId;
        const blockedId = req.params.userId;

        if (!blockedId) return res.status(400).json({ error: 'User ID is required.' });
        if (String(blockerId) === String(blockedId)) {
            return res.status(400).json({ error: 'You cannot block yourself.' });
        }

        if (isMongo()) {
            const existing = await Block.findOne({ blockerId, blockedId });
            if (existing) {
                return res.status(409).json({ error: 'User is already blocked.', isBlocked: true });
            }
            await Block.create({ blockerId, blockedId });
        } else {
            const db = getOfflineDb();
            const existing = db.blocks.find(b => b.blockerId === blockerId && b.blockedId === blockedId);
            if (existing) {
                return res.status(409).json({ error: 'User is already blocked.', isBlocked: true });
            }
            db.blocks.push({
                _id: 'blk_' + Date.now(),
                blockerId,
                blockedId,
                createdAt: new Date().toISOString()
            });
            saveOfflineDb(db);
        }

        return res.status(201).json({
            message: 'User blocked successfully.',
            isBlocked: true
        });
    } catch (err) {
        console.error('Block error:', err);
        return res.status(500).json({ error: 'Failed to block user. ' + err.message });
    }
});

// -------------------------------------------------------------
// DELETE /api/blocks/:userId (Unblock)
// -------------------------------------------------------------
router.delete('/:userId', authMiddleware, async (req, res) => {
    try {
        const blockerId = req.user.userId;
        const blockedId = req.params.userId;

        if (isMongo()) {
            await Block.deleteOne({ blockerId, blockedId });
        } else {
            const db = getOfflineDb();
            db.blocks = db.blocks.filter(b => !(b.blockerId === blockerId && b.blockedId === blockedId));
            saveOfflineDb(db);
        }

        return res.json({
            message: 'User unblocked successfully.',
            isBlocked: false
        });
    } catch (err) {
        console.error('Unblock error:', err);
        return res.status(500).json({ error: 'Failed to unblock user. ' + err.message });
    }
});

// -------------------------------------------------------------
// GET /api/blocks (List blocked users)
// -------------------------------------------------------------
router.get('/', authMiddleware, async (req, res) => {
    try {
        const blockerId = req.user.userId;
        let blockedIds = [];

        if (isMongo()) {
            const list = await Block.find({ blockerId }).sort({ createdAt: -1 });
            blockedIds = list.map(b => b.blockedId);
        } else {
            const db = getOfflineDb();
            blockedIds = db.blocks.filter(b => b.blockerId === blockerId).map(b => b.blockedId);
        }

        const blockedUsers = await Promise.all(blockedIds.map(async (bId) => {
            const snap = await getProfileSnapshot(bId);
            return {
                userId: bId,
                name: snap.name,
                avatar: snap.avatar
            };
        }));

        return res.json({ blockedUsers });
    } catch (err) {
        console.error('Get blocked users error:', err);
        return res.status(500).json({ error: 'Failed to load blocked users.' });
    }
});

// -------------------------------------------------------------
// GET /api/blocks/status/:userId
// -------------------------------------------------------------
router.get('/status/:userId', authMiddleware, async (req, res) => {
    try {
        const myId = req.user.userId;
        const otherId = req.params.userId;

        let blockedByMe = false;
        let blockedMe = false;

        if (isMongo()) {
            blockedByMe = !!(await Block.findOne({ blockerId: myId, blockedId: otherId }));
            blockedMe = !!(await Block.findOne({ blockerId: otherId, blockedId: myId }));
        } else {
            const db = getOfflineDb();
            blockedByMe = (db.blocks || []).some(b => b.blockerId === myId && b.blockedId === otherId);
            blockedMe = (db.blocks || []).some(b => b.blockerId === otherId && b.blockedId === myId);
        }

        return res.json({
            blockedByMe,
            blockedMe,
            isRestricted: blockedByMe || blockedMe
        });
    } catch (err) {
        console.error('Block status error:', err);
        return res.status(500).json({ error: 'Failed to check block status.' });
    }
});

module.exports = router;
