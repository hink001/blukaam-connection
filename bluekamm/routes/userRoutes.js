const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const Profile = require('../models/Profile');
const Follow = require('../models/Follow');
const Connection = require('../models/Connection');
const Block = require('../models/Block');
const authMiddleware = require('../middleware/auth');
const optionalAuthMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authMiddleware(req, res, next);
    }
    req.user = null;
    next();
};

const DB_FILE = path.join(__dirname, '..', 'local_database.json');
const isMongo = () => mongoose.connection.readyState === 1;

const getOfflineDb = () => {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], profiles: [], follows: [], connections: [], blocks: [] }));
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.profiles) data.profiles = [];
    if (!data.follows) data.follows = [];
    if (!data.connections) data.connections = [];
    if (!data.blocks) data.blocks = [];
    return data;
};

// -------------------------------------------------------------
// GET /api/users/discover (User Search & Discovery with Pagination)
// -------------------------------------------------------------
router.get(['/discover', '/search'], optionalAuthMiddleware, async (req, res) => {
    try {
        const {
            search,
            q,
            skill,
            role,
            city,
            state,
            minExp,
            maxExp,
            availability
        } = req.query;

        const currentUserId = req.user ? req.user.userId : null;
        const queryTerm = (search || q || '').trim();
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
        const skip = (page - 1) * limit;

        if (isMongo()) {
            const filter = {};

            // Exclude current user from search
            if (currentUserId) {
                filter.userId = { $ne: currentUserId };
            }

            if (role) {
                filter.role = new RegExp('^' + role + '$', 'i');
            }
            if (city) {
                filter.$or = [
                    { 'location.city': new RegExp(city, 'i') },
                    { city: new RegExp(city, 'i') }
                ];
            }
            if (state) {
                filter.$or = [
                    { 'location.state': new RegExp(state, 'i') },
                    { state: new RegExp(state, 'i') }
                ];
            }
            if (skill) {
                filter.skills = new RegExp(skill, 'i');
            }
            if (availability) {
                filter.availability = new RegExp('^' + availability + '$', 'i');
            }
            if (minExp !== undefined || maxExp !== undefined) {
                filter.experienceYears = {};
                if (minExp !== undefined && !isNaN(minExp)) filter.experienceYears.$gte = parseInt(minExp, 10);
                if (maxExp !== undefined && !isNaN(maxExp)) filter.experienceYears.$lte = parseInt(maxExp, 10);
            }

            if (queryTerm) {
                const regex = new RegExp(queryTerm, 'i');
                const termFilter = [
                    { fullName: regex },
                    { name: regex },
                    { headline: regex },
                    { skills: regex },
                    { workType: regex }
                ];
                if (filter.$or) {
                    filter.$and = [{ $or: filter.$or }, { $or: termFilter }];
                    delete filter.$or;
                } else {
                    filter.$or = termFilter;
                }
            }

            const total = await Profile.countDocuments(filter);
            const profiles = await Profile.find(filter)
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit);

            const safeUsers = profiles.map(p => ({
                userId: p.userId || p._id,
                name: p.fullName || p.name || 'Member',
                role: p.role || 'Worker',
                headline: p.headline || `${p.workType || 'Specialist'} in ${p.location?.city || p.city || 'India'}`,
                skills: p.skills || [],
                experienceYears: p.experienceYears || 0,
                city: (p.location && p.location.city) || p.city || 'India',
                state: (p.location && p.location.state) || p.state || '',
                avatar: p.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(p.fullName || 'Member')}&backgroundColor=0D2F6E&textColor=ffffff`,
                availability: p.availability || 'Available',
                isVerified: true
            }));

            return res.json({
                users: safeUsers,
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit) || 1
            });
        } else {
            const db = getOfflineDb();
            let all = [...db.profiles];

            if (currentUserId) {
                all = all.filter(p => String(p.userId) !== String(currentUserId));
            }
            if (role) {
                all = all.filter(p => (p.role || '').toLowerCase() === role.toLowerCase());
            }
            if (city) {
                all = all.filter(p => ((p.location && p.location.city) || p.city || '').toLowerCase().includes(city.toLowerCase()));
            }
            if (state) {
                all = all.filter(p => ((p.location && p.location.state) || p.state || '').toLowerCase().includes(state.toLowerCase()));
            }
            if (skill) {
                all = all.filter(p => (p.skills || []).some(s => s.toLowerCase().includes(skill.toLowerCase())));
            }
            if (availability) {
                all = all.filter(p => (p.availability || '').toLowerCase() === availability.toLowerCase());
            }
            if (minExp !== undefined && !isNaN(minExp)) {
                all = all.filter(p => (p.experienceYears || 0) >= parseInt(minExp, 10));
            }
            if (maxExp !== undefined && !isNaN(maxExp)) {
                all = all.filter(p => (p.experienceYears || 0) <= parseInt(maxExp, 10));
            }
            if (queryTerm) {
                const s = queryTerm.toLowerCase();
                all = all.filter(p =>
                    (p.fullName || p.name || '').toLowerCase().includes(s) ||
                    (p.headline || '').toLowerCase().includes(s) ||
                    (p.workType || '').toLowerCase().includes(s) ||
                    (p.skills || []).some(sk => sk.toLowerCase().includes(s))
                );
            }

            const total = all.length;
            const slice = all.slice(skip, skip + limit);
            const safeUsers = slice.map(p => ({
                userId: p.userId || p._id || p.id,
                name: p.fullName || p.name || 'Member',
                role: p.role || 'Worker',
                headline: p.headline || `${p.workType || 'Specialist'} in ${p.location?.city || p.city || 'India'}`,
                skills: p.skills || [],
                experienceYears: p.experienceYears || 0,
                city: (p.location && p.location.city) || p.city || 'India',
                state: (p.location && p.location.state) || p.state || '',
                avatar: p.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(p.fullName || 'Member')}&backgroundColor=0D2F6E&textColor=ffffff`,
                availability: p.availability || 'Available',
                isVerified: true
            }));

            return res.json({
                users: safeUsers,
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit) || 1
            });
        }
    } catch (err) {
        console.error('Discover users error:', err);
        return res.status(500).json({ error: 'Failed to discover users. ' + err.message });
    }
});

// -------------------------------------------------------------
// GET /api/users/:id/relationship (Follow, Connection & Block State + Counters)
// -------------------------------------------------------------
router.get('/:id/relationship', optionalAuthMiddleware, async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const currentUserId = req.user ? req.user.userId : null;
        const isSelf = currentUserId && String(currentUserId) === String(targetUserId);

        let isFollowing = false;
        let isFollower = false;
        let connectionStatus = 'none'; // 'none' | 'pending_sent' | 'pending_received' | 'accepted' | 'rejected' | 'blocked'
        let connectionId = null;
        let isBlocked = false;
        let hasBlockedMe = false;

        let followersCount = 0;
        let followingCount = 0;
        let connectionsCount = 0;

        if (isMongo()) {
            followersCount = await Follow.countDocuments({ followingId: targetUserId });
            followingCount = await Follow.countDocuments({ followerId: targetUserId });
            connectionsCount = await Connection.countDocuments({
                status: 'accepted',
                $or: [{ requesterId: targetUserId }, { recipientId: targetUserId }]
            });

            if (currentUserId && !isSelf) {
                // Follow relationship
                const followDoc = await Follow.findOne({ followerId: currentUserId, followingId: targetUserId });
                isFollowing = !!followDoc;

                const followerDoc = await Follow.findOne({ followerId: targetUserId, followingId: currentUserId });
                isFollower = !!followerDoc;

                // Connection relationship
                const conn = await Connection.findOne({
                    $or: [
                        { requesterId: currentUserId, recipientId: targetUserId },
                        { requesterId: targetUserId, recipientId: currentUserId }
                    ]
                });
                if (conn) {
                    connectionId = conn._id;
                    if (conn.status === 'accepted') {
                        connectionStatus = 'accepted';
                    } else if (conn.status === 'pending') {
                        connectionStatus = String(conn.requesterId) === String(currentUserId) ? 'pending_sent' : 'pending_received';
                    } else {
                        connectionStatus = conn.status;
                    }
                }

                // Block state
                isBlocked = !!(await Block.findOne({ blockerId: currentUserId, blockedId: targetUserId }));
                hasBlockedMe = !!(await Block.findOne({ blockerId: targetUserId, blockedId: currentUserId }));
            }
        } else {
            const db = getOfflineDb();
            followersCount = db.follows.filter(f => String(f.followingId) === String(targetUserId)).length;
            followingCount = db.follows.filter(f => String(f.followerId) === String(targetUserId)).length;
            connectionsCount = db.connections.filter(c =>
                c.status === 'accepted' && (String(c.requesterId) === String(targetUserId) || String(c.recipientId) === String(targetUserId))
            ).length;

            if (currentUserId && !isSelf) {
                isFollowing = db.follows.some(f => String(f.followerId) === String(currentUserId) && String(f.followingId) === String(targetUserId));
                isFollower = db.follows.some(f => String(f.followerId) === String(targetUserId) && String(f.followingId) === String(currentUserId));

                const conn = db.connections.find(c =>
                    (String(c.requesterId) === String(currentUserId) && String(c.recipientId) === String(targetUserId)) ||
                    (String(c.requesterId) === String(targetUserId) && String(c.recipientId) === String(currentUserId))
                );
                if (conn) {
                    connectionId = conn._id;
                    if (conn.status === 'accepted') {
                        connectionStatus = 'accepted';
                    } else if (conn.status === 'pending') {
                        connectionStatus = String(conn.requesterId) === String(currentUserId) ? 'pending_sent' : 'pending_received';
                    } else {
                        connectionStatus = conn.status;
                    }
                }

                isBlocked = db.blocks.some(b => String(b.blockerId) === String(currentUserId) && String(b.blockedId) === String(targetUserId));
                hasBlockedMe = db.blocks.some(b => String(b.blockerId) === String(targetUserId) && String(b.blockedId) === String(currentUserId));
            }
        }

        const canMessage = !isSelf && !isBlocked && !hasBlockedMe;

        return res.json({
            targetUserId,
            isSelf,
            isFollowing,
            isFollower,
            connectionStatus,
            connectionId,
            isBlocked,
            hasBlockedMe,
            canMessage,
            followersCount,
            followingCount,
            connectionsCount
        });
    } catch (err) {
        console.error('Relationship fetch error:', err);
        return res.status(500).json({ error: 'Failed to retrieve relationship state.' });
    }
});

module.exports = router;
