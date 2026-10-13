const express = require('express');
const router = express.Router();

const Job = require('../models/Job');
const Application = require('../models/Application');
const Offer = require('../models/Offer');
const Profile = require('../models/Profile');
const { authDb, requireRole, isId } = require('../middleware/marketplace');
const { notify } = require('../services/marketplaceNotify');
const { cleanText } = require('../utils/sanitize');
const { releaseSlot } = require('../services/offerService');

const workerSnapshot = (p) => p ? ({
    name: p.fullName || p.name || 'Worker', avatarUrl: p.avatarUrl || '',
    city: p.location?.city || p.city || '', state: p.location?.state || p.state || '',
    skills: p.skills || [], experienceYears: p.experienceYears || 0,
    expectedWage: p.expectedWage || null, wageType: p.wageType || '',
    availability: p.availability || '', headline: p.headline || '', isVerified: !!p.isVerified
}) : { name: 'Worker', skills: [] };

// POST /api/applications/jobs/:jobId/apply
router.post('/jobs/:jobId/apply', authDb, requireRole('Worker'), async (req, res) => {
    try {
        if (!isId(req.params.jobId)) return res.status(404).json({ error: 'Job not found.' });
        const job = await Job.findById(req.params.jobId);
        if (!job) return res.status(404).json({ error: 'Job not found.' });
        if (job.status !== 'active') return res.status(409).json({ error: 'This job is not accepting applications.' });
        if (job.applicationDeadline && job.applicationDeadline < new Date()) {
            return res.status(409).json({ error: 'The application deadline for this job has passed.' });
        }
        if (String(job.contractorId) === req.user.userId) return res.status(403).json({ error: 'You cannot apply to your own job.' });

        const coverNote = cleanText(req.body.coverNote || '').slice(0, 1000);
        const now = new Date();
        let application;
        try {
            application = await Application.create({
                jobId: job._id, workerId: req.user.userId, contractorId: job.contractorId, coverNote,
                history: [{ status: 'pending', by: req.user.userId, at: now }]
            });
        } catch (e) {
            if (e.code !== 11000) throw e;
            // Already applied. Only a previously withdrawn application may be re-activated.
            application = await Application.findOneAndUpdate(
                { jobId: job._id, workerId: req.user.userId, status: 'withdrawn' },
                { $set: { status: 'pending', coverNote }, $push: { history: { status: 'pending', by: req.user.userId, at: now } } },
                { new: true }
            );
            if (!application) return res.status(409).json({ error: 'You have already applied to this job.' });
        }

        const profile = await Profile.findOne({ userId: req.user.userId }).lean();
        await notify({
            userId: job.contractorId, type: 'application_submitted', fromUserId: req.user.userId,
            fromName: profile?.fullName || '', entityId: application._id,
            message: `${profile?.fullName || 'A worker'} applied for "${job.title}".`, link: 'contractor-dashboard.html#applicants'
        });
        await notify({
            userId: req.user.userId, type: 'application_submitted', entityId: application._id,
            message: `Your application for "${job.title}" was submitted.`, link: 'worker-dashboard.html#applications'
        });
        res.status(201).json({ message: 'Application submitted!', application });
    } catch (e) {
        console.error('apply:', e);
        res.status(500).json({ error: 'Failed to submit application.' });
    }
});

// POST /api/applications/:id/withdraw
router.post('/:id/withdraw', authDb, requireRole('Worker'), async (req, res) => {
    try {
        if (!isId(req.params.id)) return res.status(404).json({ error: 'Application not found.' });
        const app = await Application.findOneAndUpdate(
            { _id: req.params.id, workerId: req.user.userId, status: { $in: ['pending', 'shortlisted', 'offer_sent'] } },
            { $set: { status: 'withdrawn' }, $push: { history: { status: 'withdrawn', by: req.user.userId, at: new Date() } } },
            { new: true }
        );
        if (!app) return res.status(409).json({ error: 'This application can no longer be withdrawn.' });
        const open = await Offer.findOneAndUpdate({ applicationId: app._id, status: 'pending' }, { $set: { status: 'cancelled', respondedAt: new Date() } });
        if (open) await releaseSlot(open.jobId);
        const job = await Job.findById(app.jobId).select('title').lean();
        await notify({
            userId: app.contractorId, type: 'application_rejected', fromUserId: req.user.userId, entityId: app._id,
            message: `A worker withdrew their application for "${job?.title || 'your job'}".`, link: 'contractor-dashboard.html#applicants'
        });
        res.json({ message: 'Application withdrawn.', application: app });
    } catch (e) {
        res.status(500).json({ error: 'Failed to withdraw application.' });
    }
});

// GET /api/applications/mine — worker's applications
router.get('/mine', authDb, requireRole('Worker'), async (req, res) => {
    try {
        const filter = { workerId: req.user.userId };
        if (req.query.status) filter.status = req.query.status;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);
        const [apps, total] = await Promise.all([
            Application.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            Application.countDocuments(filter)
        ]);
        const jobs = await Job.find({ _id: { $in: apps.map(a => a.jobId) } }).select('title contractorName location wage wageType status').lean();
        const jm = Object.fromEntries(jobs.map(j => [String(j._id), j]));
        res.json({ applications: apps.map(a => ({ ...a, job: jm[String(a.jobId)] || null })), page, total, totalPages: Math.ceil(total / limit) });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load applications.' });
    }
});

// GET /api/applications/received — contractor's applicants across own jobs
router.get('/received', authDb, requireRole('Contractor'), async (req, res) => {
    try {
        const filter = { contractorId: req.user.userId };
        if (req.query.jobId) { if (!isId(req.query.jobId)) return res.json({ applications: [], total: 0, page: 1, totalPages: 0 }); filter.jobId = req.query.jobId; }
        if (req.query.status) filter.status = req.query.status;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);
        const sort = req.query.sort === 'oldest' ? { createdAt: 1 } : { createdAt: -1 };
        const [apps, total] = await Promise.all([
            Application.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
            Application.countDocuments(filter)
        ]);
        const [profiles, jobs] = await Promise.all([
            Profile.find({ userId: { $in: apps.map(a => a.workerId) } }).lean(),
            Job.find({ _id: { $in: apps.map(a => a.jobId) } }).select('title workersRequired hiredCount slotsLeft status').lean()
        ]);
        const pm = Object.fromEntries(profiles.map(p => [String(p.userId), p]));
        const jm = Object.fromEntries(jobs.map(j => [String(j._id), j]));
        res.json({
            applications: apps.map(a => ({ ...a, worker: { userId: a.workerId, ...workerSnapshot(pm[String(a.workerId)]) }, job: jm[String(a.jobId)] || null })),
            page, total, totalPages: Math.ceil(total / limit)
        });
    } catch (e) {
        console.error('received:', e);
        res.status(500).json({ error: 'Failed to load applicants.' });
    }
});

// shortlist / reject — contractor only, own jobs only, valid transitions only
const DECISIONS = {
    shortlist: { from: ['pending'], to: 'shortlisted', type: 'application_shortlisted', text: (t) => `You were shortlisted for "${t}".` },
    reject:    { from: ['pending', 'shortlisted'], to: 'rejected', type: 'application_rejected', text: (t) => `Your application for "${t}" was not selected.` }
};
Object.entries(DECISIONS).forEach(([action, d]) => {
    router.post(`/:id/${action}`, authDb, requireRole('Contractor'), async (req, res) => {
        try {
            if (!isId(req.params.id)) return res.status(404).json({ error: 'Application not found.' });
            const app = await Application.findOneAndUpdate(
                { _id: req.params.id, contractorId: req.user.userId, status: { $in: d.from } },
                { $set: { status: d.to }, $push: { history: { status: d.to, by: req.user.userId, at: new Date() } } },
                { new: true }
            );
            if (!app) return res.status(409).json({ error: `This application can't be ${d.to} right now.` });
            const job = await Job.findById(app.jobId).select('title').lean();
            await notify({ userId: app.workerId, type: d.type, fromUserId: req.user.userId, entityId: app._id, message: d.text(job?.title || 'a job'), link: 'worker-dashboard.html#applications' });
            res.json({ message: `Application ${d.to}.`, application: app });
        } catch (e) {
            res.status(500).json({ error: 'Failed to update application.' });
        }
    });
});

module.exports = router;
