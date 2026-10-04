const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const Follow = require('../models/Follow');
const Block = require('../models/Block');
const Profile = require('../models/Profile');
const authMiddleware = require('../middleware/auth');
const { createNotification } = require('../services/notificationService');

const DB_FILE = path.join(__dirname, '..', 'local_database.json');
const isMongo = () => mongoose.connection.readyState === 1;

const getOfflineDb = () => {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], profiles: [], follows: [], blocks: [], connections: [] }));
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.follows) data.follows = [];
    if (!data.blocks) data.blocks = [];
    if (!data.connections) data.connections = [];
    return data;
};
const saveOfflineDb = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

async function getProfileSnapshot(userId) {
    if (isMongo()) {
        const p = await Profile.findOne({ userId });
        return p ? { name: p.fullName || p.name || 'Member', avatar: p.avatarUrl || '', headline: p.headline || p.workType || 'BluKaam Member' } : { name: 'Member', avatar: '', headline: 'BluKaam Member' };
    } else {
        const db = getOfflineDb();
        const p = db.profiles.find(pr => pr.userId === userId || pr._id === userId || pr.id === userId);
        return p ? { name: p.fullName || p.name || 'Member', avatar: p.avatarUrl || '', headline: p.headline || p.workType || 'BluKaam Member' } : { name: 'Member', avatar: '', headline: 'BluKaam Member' };
    }
}

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

// -------------------------------------------------------------
// POST /follow/:id (or /:id/follow)
// -------------------------------------------------------------
router.post(['/:id/follow', '/:id'], authMiddleware, async (req, res) => {
    try {
        const followerId = req.user.userId;
        const followingId = req.params.id;

        if (!followingId) {
            return res.status(400).json({ error: 'Target user ID is required.' });
        }

        if (String(followerId) === String(followingId)) {
            return res.status(400).json({ error: 'You cannot follow yourself.' });
        }

        // Check if blocked
        if (await isBlocked(followerId, followingId)) {
            return res.status(403).json({ error: 'Action not allowed due to block restriction.' });
        }

        let created = false;
        if (isMongo()) {
            const existing = await Follow.findOne({ followerId, followingId });
            if (existing) {
                return res.status(409).json({ error: 'You are already following this user.', following: true });
            }
            await Follow.create({ followerId, followingId });
            created = true;
        } else {
            const db = getOfflineDb();
            const existing = db.follows.find(f => f.followerId === followerId && f.followingId === followingId);
            if (existing) {
                return res.status(409).json({ error: 'You are already following this user.', following: true });
            }
            db.follows.push({
                _id: 'flw_' + Date.now(),
                followerId,
                followingId,
                createdAt: new Date().toISOString()
            });
            saveOfflineDb(db);
            created = true;
        }

        // Send notification
        const mySnapshot = await getProfileSnapshot(followerId);
        await createNotification({
            userId: followingId,
            type: 'follow',
            fromUserId: followerId,
            fromName: mySnapshot.name,
            fromAvatar: mySnapshot.avatar,
            message: `${mySnapshot.name} started following you.`,
            link: `profile.html?id=${followerId}`
        });

        // Compute updated followers count for target
        let followersCount = 0;
        if (isMongo()) {
            followersCount = await Follow.countDocuments({ followingId });
        } else {
            const db = getOfflineDb();
            followersCount = db.follows.filter(f => f.followingId === followingId).length;
        }

        return res.status(201).json({
            message: 'Successfully followed user!',
            following: true,
            followersCount
        });
    } catch (err) {
        console.error('Follow error:', err);
        return res.status(500).json({ error: 'Failed to follow user. ' + err.message });
    }
});

// -------------------------------------------------------------
// DELETE /follow/:id (or /:id/follow)
// -------------------------------------------------------------
router.delete(['/:id/follow', '/:id'], authMiddleware, async (req, res) => {
    try {
        const followerId = req.user.userId;
        const followingId = req.params.id;

        if (String(followerId) === String(followingId)) {
            return res.status(400).json({ error: 'Cannot unfollow yourself.' });
        }

        if (isMongo()) {
            await Follow.deleteOne({ followerId, followingId });
        } else {
            const db = getOfflineDb();
            db.follows = db.follows.filter(f => !(f.followerId === followerId && f.followingId === followingId));
            saveOfflineDb(db);
        }

        let followersCount = 0;
        if (isMongo()) {
            followersCount = await Follow.countDocuments({ followingId });
        } else {
            const db = getOfflineDb();
            followersCount = db.follows.filter(f => f.followingId === followingId).length;
        }

        return res.json({
            message: 'Successfully unfollowed user.',
            following: false,
            followersCount
        });
    } catch (err) {
        console.error('Unfollow error:', err);
        return res.status(500).json({ error: 'Failed to unfollow user. ' + err.message });
    }
});

// -------------------------------------------------------------
// GET /:id/followers
// -------------------------------------------------------------
router.get('/:id/followers', async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const skip = (page - 1) * limit;

        let total = 0;
        let followerIds = [];

        if (isMongo()) {
            total = await Follow.countDocuments({ followingId: targetUserId });
            const list = await Follow.find({ followingId: targetUserId })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);
            followerIds = list.map(f => f.followerId);
        } else {
            const db = getOfflineDb();
            const all = db.follows.filter(f => f.followingId === targetUserId)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            total = all.length;
            followerIds = all.slice(skip, skip + limit).map(f => f.followerId);
        }

        const profiles = await Promise.all(followerIds.map(async (fId) => {
            const snap = await getProfileSnapshot(fId);
            return {
                userId: fId,
                name: snap.name,
                avatar: snap.avatar,
                headline: snap.headline
            };
        }));

        return res.json({
            followers: profiles,
            total,
            page,
            totalPages: Math.ceil(total / limit) || 1
        });
    } catch (err) {
        console.error('Get followers error:', err);
        return res.status(500).json({ error: 'Failed to get followers.' });
    }
});

// -------------------------------------------------------------
// GET /:id/following
// -------------------------------------------------------------
router.get('/:id/following', async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const skip = (page - 1) * limit;

        let total = 0;
        let followingIds = [];

        if (isMongo()) {
            total = await Follow.countDocuments({ followerId: targetUserId });
            const list = await Follow.find({ followerId: targetUserId })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);
            followingIds = list.map(f => f.followingId);
        } else {
            const db = getOfflineDb();
            const all = db.follows.filter(f => f.followerId === targetUserId)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            total = all.length;
            followingIds = all.slice(skip, skip + limit).map(f => f.followingId);
        }

        const profiles = await Promise.all(followingIds.map(async (fId) => {
            const snap = await getProfileSnapshot(fId);
            return {
                userId: fId,
                name: snap.name,
                avatar: snap.avatar,
                headline: snap.headline
            };
        }));

        return res.json({
            following: profiles,
            total,
            page,
            totalPages: Math.ceil(total / limit) || 1
        });
    } catch (err) {
        console.error('Get following error:', err);
        return res.status(500).json({ error: 'Failed to get following list.' });
    }
});

module.exports = router;
