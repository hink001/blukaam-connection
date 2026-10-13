const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const Job = require('../models/Job');
const Application = require('../models/Application');
const Profile = require('../models/Profile');
const { authDb, requireRole, isId, escapeRegex } = require('../middleware/marketplace');
const { notify } = require('../services/marketplaceNotify');
const { cleanText } = require('../utils/sanitize');

// ---------- validation ----------
function parseJobInput(body, { partial = false } = {}) {
    const errors = [];
    const out = {};
    const has = (k) => body[k] !== undefined;

    if (!partial || has('title')) {
        const t = cleanText(body.title || '');
        if (!t) errors.push('Job title is required.'); else out.title = t.slice(0, 120);
    }
    if (!partial || has('skills')) {
        const raw = Array.isArray(body.skills) ? body.skills : String(body.skills || '').split(',');
        const skills = raw.map(s => cleanText(s)).filter(Boolean).slice(0, 15);
        if (!skills.length) errors.push('At least one required skill must be specified.'); else out.skills = skills;
    }
    if (!partial || has('workersRequired')) {
        const n = Number(body.workersRequired);
        if (!Number.isInteger(n) || n < 1 || n > 1000) errors.push('Workers required must be a whole number of 1 or more.');
        else out.workersRequired = n;
    }
    if (!partial || has('wage')) {
        const w = Number(body.wage);
        if (!Number.isFinite(w) || w <= 0) errors.push('Wage must be a positive number.'); else out.wage = w;
    }
    if (!partial || has('wageType')) {
        if (!['daily', 'monthly'].includes(body.wageType)) errors.push('Wage type must be daily or monthly.');
        else out.wageType = body.wageType;
    }
    const strFields = ['description', 'category', 'paymentFrequency', 'duration', 'schedule', 'additionalRequirements'];
    strFields.forEach(k => { if (has(k)) out[k] = cleanText(body[k] || ''); });
    if (has('experienceYears')) {
        const e = Number(body.experienceYears);
        if (!Number.isFinite(e) || e < 0 || e > 60) errors.push('Experience must be between 0 and 60 years.'); else out.experienceYears = e;
    }
    if (has('location')) {
        const l = body.location || {};
        out.location = { city: cleanText(l.city || ''), state: cleanText(l.state || ''), address: cleanText(l.address || '') };
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (has('startDate') && body.startDate) {
        const d = new Date(body.startDate);
        if (isNaN(d)) errors.push('Start date is invalid.'); else out.startDate = d;
    }
    if (has('applicationDeadline') && body.applicationDeadline) {
        const d = new Date(body.applicationDeadline);
        if (isNaN(d)) errors.push('Application deadline is invalid.'); else out.applicationDeadline = d;
    }
    if (out.applicationDeadline && out.applicationDeadline < today) errors.push('Application deadline cannot be in the past.');
    if (out.startDate && out.applicationDeadline && out.startDate < out.applicationDeadline) {
        errors.push('Start date cannot be before the application deadline.');
    }
    return { errors, out };
}

// Fields a worker may see. No contractor email/phone/userId beyond what's needed to apply.
const publicJob = (j) => ({
    _id: j._id, title: j.title, description: j.description, category: j.category, skills: j.skills,
    location: { city: j.location?.city, state: j.location?.state },
    workersRequired: j.workersRequired, vacanciesRemaining: Math.max(0, j.workersRequired - (j.hiredCount || 0)),
    wage: j.wage, wageType: j.wageType, paymentFrequency: j.paymentFrequency,
    experienceYears: j.experienceYears, startDate: j.startDate, duration: j.duration, schedule: j.schedule,
    applicationDeadline: j.applicationDeadline, additionalRequirements: j.additionalRequirements,
    contractorName: j.contractorName, contractorVerified: !!j.contractorVerified,
    status: j.status, createdAt: j.createdAt
});

// POST /api/jobs  — contractor creates a job
router.post('/', authDb, requireRole('Contractor'), async (req, res) => {
    try {
        const { errors, out } = parseJobInput(req.body);
        if (errors.length) return res.status(400).json({ error: errors[0], errors });
        const profile = await Profile.findOne({ userId: req.user.userId }).lean();
        const status = req.body.saveAsDraft ? 'draft' : 'active';
        const job = await Job.create({
            ...out,
            contractorId: req.user.userId,
            contractorName: profile?.companyName || profile?.fullName || 'Contractor',
            contractorVerified: !!profile?.isVerified,
            slotsLeft: out.workersRequired,
            status
        });
        res.status(201).json({ message: status === 'draft' ? 'Draft saved.' : 'Job published!', job });
    } catch (e) {
        console.error('create job:', e);
        res.status(500).json({ error: 'Failed to create job.' });
    }
});

// GET /api/jobs/mine — contractor's own jobs with applicant counts
router.get('/mine', authDb, requireRole('Contractor'), async (req, res) => {
    try {
        const filter = { contractorId: req.user.userId };
        if (req.query.status) filter.status = req.query.status;
        const jobs = await Job.find(filter).sort({ createdAt: -1 }).limit(200).lean();
        const counts = await Application.aggregate([
            { $match: { contractorId: new mongoose.Types.ObjectId(req.user.userId) } },
            { $group: { _id: '$jobId', total: { $sum: 1 } } }
        ]);
        const countMap = Object.fromEntries(counts.map(c => [String(c._id), c.total]));
        res.json(jobs.map(j => ({ ...j, applicationCount: countMap[String(j._id)] || 0 })));
    } catch (e) {
        console.error('my jobs:', e);
        res.status(500).json({ error: 'Failed to load your jobs.' });
    }
});

// GET /api/jobs — worker search over active jobs (database-backed, paginated)
router.get('/', authDb, async (req, res) => {
    try {
        const { q, skill, city, minWage, maxWage, wageType, maxExperience, sort = 'newest' } = req.query;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
        const now = new Date();
        const filter = {
            status: 'active',
            $and: [{ $or: [{ applicationDeadline: null }, { applicationDeadline: { $exists: false } }, { applicationDeadline: { $gte: now } }] }]
        };
        if (q) {
            const rx = new RegExp(escapeRegex(q), 'i');
            filter.$and.push({ $or: [{ title: rx }, { description: rx }, { skills: rx }] });
        }
        if (skill) filter.skills = new RegExp(escapeRegex(skill), 'i');
        if (city) filter['location.city'] = new RegExp(escapeRegex(city), 'i');
        if (['daily', 'monthly'].includes(wageType)) filter.wageType = wageType;
        if (minWage !== undefined && minWage !== '' && !isNaN(minWage)) filter.wage = { ...(filter.wage || {}), $gte: Number(minWage) };
        if (maxWage !== undefined && maxWage !== '' && !isNaN(maxWage)) filter.wage = { ...(filter.wage || {}), $lte: Number(maxWage) };
        if (maxExperience !== undefined && maxExperience !== '' && !isNaN(maxExperience)) filter.experienceYears = { $lte: Number(maxExperience) };

        const sortSpec = sort === 'wage_high' ? { wage: -1, createdAt: -1 } : { createdAt: -1 };
        const [jobs, total] = await Promise.all([
            Job.find(filter).sort(sortSpec).skip((page - 1) * limit).limit(limit).lean(),
            Job.countDocuments(filter)
        ]);

        const mine = await Application.find({ workerId: req.user.userId, jobId: { $in: jobs.map(j => j._id) } }).select('jobId status').lean();
        const appMap = Object.fromEntries(mine.map(a => [String(a.jobId), a.status]));
        res.json({
            jobs: jobs.map(j => ({ ...publicJob(j), myApplicationStatus: appMap[String(j._id)] || null })),
            page, limit, total, totalPages: Math.ceil(total / limit)
        });
    } catch (e) {
        console.error('search jobs:', e);
        res.status(500).json({ error: 'Failed to search jobs.' });
    }
});

// GET /api/jobs/:id
router.get('/:id', authDb, async (req, res) => {
    try {
        if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found.' });
        const job = await Job.findById(req.params.id).lean();
        if (!job) return res.status(404).json({ error: 'Job not found.' });
        if (String(job.contractorId) === req.user.userId) return res.json({ ...job, isOwner: true });
        if (job.status === 'draft') return res.status(404).json({ error: 'Job not found.' });
        const app = await Application.findOne({ jobId: job._id, workerId: req.user.userId }).select('status').lean();
        res.json({ ...publicJob(job), myApplicationStatus: app?.status || null, isOwner: false });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load job.' });
    }
});

// PUT /api/jobs/:id — owner edits
router.put('/:id', authDb, requireRole('Contractor'), async (req, res) => {
    try {
        if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found.' });
        const job = await Job.findOne({ _id: req.params.id, contractorId: req.user.userId });
        if (!job) return res.status(404).json({ error: 'Job not found.' });
        if (['closed', 'cancelled'].includes(job.status)) return res.status(409).json({ error: 'A closed or cancelled job cannot be edited.' });

        const { errors, out } = parseJobInput(req.body, { partial: true });
        if (errors.length) return res.status(400).json({ error: errors[0], errors });

        if (out.workersRequired !== undefined && out.workersRequired !== job.workersRequired) {
            const delta = out.workersRequired - job.workersRequired;
            // atomic: cannot shrink below vacancies already reserved/hired
            const upd = await Job.findOneAndUpdate(
                { _id: job._id, slotsLeft: { $gte: -delta } },
                { $inc: { slotsLeft: delta }, $set: { workersRequired: out.workersRequired } },
                { new: true }
            );
            if (!upd) return res.status(409).json({ error: 'You cannot reduce workers required below the offers already sent or accepted.' });
            delete out.workersRequired;
        }
        const updated = await Job.findOneAndUpdate({ _id: job._id }, { $set: out }, { new: true });

        const applicants = await Application.find({ jobId: job._id, status: { $in: ['pending', 'shortlisted', 'offer_sent', 'accepted'] } }).select('workerId').lean();
        await Promise.all(applicants.map(a => notify({
            userId: a.workerId, type: 'job_changed', fromUserId: req.user.userId, entityId: job._id,
            message: `"${updated.title}" was updated by the contractor.`, link: 'worker-dashboard.html#applications'
        })));
        res.json({ message: 'Job updated.', job: updated });
    } catch (e) {
        console.error('edit job:', e);
        res.status(500).json({ error: 'Failed to update job.' });
    }
});

// POST /api/jobs/:id/status  { action: publish | pause | resume | close | cancel }
const TRANSITIONS = {
    publish: { from: ['draft'], to: 'active' },
    pause:   { from: ['active'], to: 'paused' },
    resume:  { from: ['paused'], to: 'active' },
    close:   { from: ['active', 'paused', 'filled'], to: 'closed' },
    cancel:  { from: ['draft', 'active', 'paused', 'filled'], to: 'cancelled' }
};
router.post('/:id/status', authDb, requireRole('Contractor'), async (req, res) => {
    try {
        const t = TRANSITIONS[req.body.action];
        if (!t) return res.status(400).json({ error: 'Unknown action.' });
        if (!isId(req.params.id)) return res.status(404).json({ error: 'Job not found.' });
        const job = await Job.findOneAndUpdate(
            { _id: req.params.id, contractorId: req.user.userId, status: { $in: t.from } },
            { $set: { status: t.to } }, { new: true }
        );
        if (!job) return res.status(409).json({ error: `This job can't be changed with "${req.body.action}" right now.` });

        if (['close', 'cancel'].includes(req.body.action)) {
            const Offer = require('../models/Offer');
            const open = await Offer.find({ jobId: job._id, status: 'pending' });
            for (const o of open) {
                const done = await Offer.findOneAndUpdate({ _id: o._id, status: 'pending' }, { $set: { status: 'cancelled', respondedAt: new Date() } });
                if (done) await Application.updateOne({ _id: o.applicationId, status: 'offer_sent' }, { $set: { status: 'cancelled' } });
            }
            if (req.body.action === 'cancel') {
                await Application.updateMany({ jobId: job._id, status: { $in: ['pending', 'shortlisted', 'offer_sent'] } }, { $set: { status: 'cancelled' } });
            }
            const apps = await Application.find({ jobId: job._id }).select('workerId').lean();
            await Promise.all(apps.map(a => notify({
                userId: a.workerId, type: 'job_changed', fromUserId: req.user.userId, entityId: job._id,
                message: `"${job.title}" has been ${job.status}.`, link: 'worker-dashboard.html#applications'
            })));
        }
        res.json({ message: `Job ${job.status}.`, job });
    } catch (e) {
        console.error('job status:', e);
        res.status(500).json({ error: 'Failed to update job status.' });
    }
});

module.exports = router;
