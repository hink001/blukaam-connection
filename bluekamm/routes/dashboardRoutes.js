const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const User = require('../models/User');
const Profile = require('../models/Profile');
const Job = require('../models/Job');
const Application = require('../models/Application');
const Offer = require('../models/Offer');
const Notification = require('../models/Notification');
const Message = require('../models/Message');
const { authDb } = require('../middleware/marketplace');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-blukaam-key';

function completion(role, p) {
    if (!p) return { pct: 0, missing: ['profile'] };
    const common = [['fullName', p.fullName], ['city', p.location?.city || p.city], ['state', p.location?.state || p.state], ['bio', p.bio], ['photo', p.avatarUrl && !p.avatarUrl.includes('dicebear')]];
    const specific = role === 'Contractor'
        ? [['companyName', p.companyName], ['workTypes', (p.workTypes || []).length], ['workersNeeded', (p.workerCategories || []).length]]
        : [['skills', (p.skills || []).length], ['experience', p.experienceYears > 0], ['expectedWage', p.expectedWage > 0], ['availability', p.availability]];
    const all = [...common, ...specific];
    const missing = all.filter(([, v]) => !v).map(([k]) => k);
    return { pct: Math.round(((all.length - missing.length) / all.length) * 100), missing };
}

// GET /api/dashboard/context — who am I (trusted role), and do I need to confirm it?
router.get('/context', authDb, async (req, res) => {
    try {
        let raw = null;
        let profile = null;
        if (mongoose.connection.readyState === 1) {
            raw = await User.findById(req.user.userId).select('role roleConfirmed createdAt').lean();
            profile = await Profile.findOne({ userId: req.user.userId }).lean();
        }
        const role = raw?.role || req.user.role || 'Worker';
        res.json({
            userId: req.user.userId, role: role, roleConfirmed: raw ? raw.roleConfirmed === true : true,
            hasProfile: !!profile, profile: profile || null, createdAt: raw?.createdAt || new Date(),
            profileCompletion: completion(role, profile)
        });
    } catch (e) {
        res.json({
            userId: req.user.userId, role: req.user.role || 'Worker', roleConfirmed: true,
            hasProfile: false, profile: null, createdAt: new Date(),
            profileCompletion: { pct: 80, missing: [] }
        });
    }
});

// POST /api/dashboard/confirm-role { role }
router.post('/confirm-role', authDb, async (req, res) => {
    const role = req.body.role;
    if (!['Worker', 'Contractor'].includes(role)) return res.status(400).json({ error: 'Role must be Worker or Contractor.' });
    if (mongoose.connection.readyState === 1) {
        await User.updateOne(
            { _id: req.user.userId },
            { $set: { role, roleConfirmed: true } }
        );
        await Profile.updateOne({ userId: req.user.userId }, { $set: { role } });
    }
    const token = jwt.sign({ userId: req.user.userId, email: req.user.email, role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: 'Role confirmed.', role, token });
});

// POST /api/dashboard/switch-role { role }
router.post('/switch-role', authDb, async (req, res) => {
    const role = req.body.role;
    if (!['Worker', 'Contractor'].includes(role)) return res.status(400).json({ error: 'Role must be Worker or Contractor.' });
    if (mongoose.connection.readyState === 1) {
        await User.updateOne(
            { _id: req.user.userId },
            { $set: { role, roleConfirmed: true } }
        );
        await Profile.updateOne({ userId: req.user.userId }, { $set: { role } });
    }
    const token = jwt.sign({ userId: req.user.userId, email: req.user.email, role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: `Switched to ${role} dashboard.`, role, token });
});

// GET /api/dashboard/summary
router.get('/summary', authDb, async (req, res) => {
    try {
        const uid = req.user.userId;
        let unreadNotifications = 0, unreadMessages = 0;
        if (mongoose.connection.readyState === 1) {
            [unreadNotifications, unreadMessages] = await Promise.all([
                Notification.countDocuments({ userId: uid, isRead: false }).catch(() => 0),
                Message.countDocuments({ recipientId: uid, readAt: null }).catch(() => 0)
            ]);
        }
        if (req.user.role === 'Contractor') {
            let j = {}, a = {}, o = {};
            if (mongoose.connection.readyState === 1) {
                const [jobsByStatus, appsByStatus, offersByStatus] = await Promise.all([
                    Job.aggregate([{ $match: { contractorId: new (require('mongoose').Types.ObjectId)(uid) } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).catch(() => []),
                    Application.aggregate([{ $match: { contractorId: new (require('mongoose').Types.ObjectId)(uid) } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).catch(() => []),
                    Offer.aggregate([{ $match: { contractorId: new (require('mongoose').Types.ObjectId)(uid) } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).catch(() => [])
                ]);
                const m = (arr) => Object.fromEntries(arr.map(x => [x._id, x.n]));
                j = m(jobsByStatus); a = m(appsByStatus); o = m(offersByStatus);
            }
            return res.json({
                role: 'Contractor', unreadNotifications, unreadMessages,
                jobs: { active: j.active || 0, paused: j.paused || 0, closed: j.closed || 0, filled: j.filled || 0, draft: j.draft || 0, cancelled: j.cancelled || 0 },
                applications: { total: Object.values(a).reduce((s, n) => s + n, 0), pending: a.pending || 0, shortlisted: a.shortlisted || 0 },
                offersAwaiting: o.pending || 0, confirmedHires: o.accepted || 0
            });
        }
        let a = {}, pendingOffers = 0;
        if (mongoose.connection.readyState === 1) {
            const wid = new mongoose.Types.ObjectId(uid);
            const [appsByStatus, po] = await Promise.all([
                Application.aggregate([{ $match: { workerId: wid } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).catch(() => []),
                Offer.countDocuments({ workerId: uid, status: 'pending', expiresAt: { $gt: new Date() } }).catch(() => 0)
            ]);
            a = Object.fromEntries(appsByStatus.map(x => [x._id, x.n]));
            pendingOffers = po;
        }
        res.json({ role: 'Worker', unreadNotifications, unreadMessages, applications: a, pendingOffers });
    } catch (e) {
        res.json({ role: req.user.role || 'Worker', unreadNotifications: 0, unreadMessages: 0, applications: {}, pendingOffers: 0 });
    }
});

// GET /api/dashboard/recommended — worker: active jobs matching skills/city
router.get('/recommended', authDb, async (req, res) => {
    try {
        const p = await Profile.findOne({ userId: req.user.userId }).lean();
        const skills = (p?.skills || []).map(s => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        const city = p?.location?.city || p?.city;
        const or = [];
        if (skills.length) or.push({ skills: { $in: skills } });
        if (city) or.push({ 'location.city': new RegExp('^' + String(city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') });
        const filter = { status: 'active' };
        if (or.length) filter.$or = or;
        const jobs = await Job.find(filter).sort({ createdAt: -1 }).limit(6)
            .select('title contractorName location wage wageType skills createdAt').lean();
        res.json(jobs);
    } catch (e) { res.status(500).json({ error: 'Failed to load recommendations.' }); }
});

module.exports = router;
