const express = require('express');
const router = express.Router();

const Job = require('../models/Job');
const Application = require('../models/Application');
const Offer = require('../models/Offer');
const Profile = require('../models/Profile');
const { authDb, requireRole, isId } = require('../middleware/marketplace');
const { notify } = require('../services/marketplaceNotify');
const { releaseSlot } = require('../services/offerService');
const { cleanText } = require('../utils/sanitize');

const ALLOWED_HOURS = [2, 4, 12, 24, 48, 72];

// POST /api/offers/applications/:applicationId   (contractor)
router.post('/applications/:applicationId', authDb, requireRole('Contractor'), async (req, res) => {
    try {
        if (!isId(req.params.applicationId)) return res.status(404).json({ error: 'Application not found.' });
        const hours = Number(req.body.expiresInHours || 24);
        if (!ALLOWED_HOURS.includes(hours)) return res.status(400).json({ error: `Response deadline must be one of ${ALLOWED_HOURS.join(', ')} hours.` });

        const app = await Application.findOne({ _id: req.params.applicationId, contractorId: req.user.userId });
        if (!app) return res.status(404).json({ error: 'Application not found.' });
        if (!['pending', 'shortlisted'].includes(app.status)) return res.status(409).json({ error: 'An offer cannot be sent for this application in its current state.' });

        const jobCheck = await Job.findOne({ _id: app.jobId, contractorId: req.user.userId, status: 'active' }).lean();
        if (!jobCheck) return res.status(409).json({ error: 'Offers can only be sent for active jobs.' });

        // 1) Atomically reserve one vacancy. Fails if none left -> no overbooking even under concurrency.
        const job = await Job.findOneAndUpdate(
            { _id: app.jobId, contractorId: req.user.userId, status: 'active', slotsLeft: { $gt: 0 } },
            { $inc: { slotsLeft: -1 } }, { new: true }
        );
        if (!job) return res.status(409).json({ error: 'No vacancies left for this job. Cancel a pending offer first or increase workers required.' });

        // 2) Claim the application (only one concurrent offer can win).
        const claimed = await Application.findOneAndUpdate(
            { _id: app._id, status: { $in: ['pending', 'shortlisted'] } },
            { $set: { status: 'offer_sent' }, $push: { history: { status: 'offer_sent', by: req.user.userId, at: new Date() } } },
            { new: true }
        );
        if (!claimed) { await releaseSlot(job._id); return res.status(409).json({ error: 'This applicant already has an offer.' }); }

        let offer;
        try {
            offer = await Offer.create({
                jobId: job._id, applicationId: app._id, workerId: app.workerId, contractorId: app.contractorId,
                message: cleanText(req.body.message || '').slice(0, 1000),
                wage: Number(req.body.wage) > 0 ? Number(req.body.wage) : job.wage, wageType: job.wageType,
                startDate: req.body.startDate ? new Date(req.body.startDate) : job.startDate,
                expiresAt: new Date(Date.now() + hours * 3600 * 1000)
            });
        } catch (e) {
            await releaseSlot(job._id);
            await Application.updateOne({ _id: app._id }, { $set: { status: app.status } });
            throw e;
        }
        await notify({
            userId: app.workerId, type: 'offer_received', fromUserId: req.user.userId, entityId: offer._id,
            message: `You received an offer for "${job.title}" from ${job.contractorName}. Respond within ${hours} hours.`, link: 'worker-dashboard.html#offers'
        });
        res.status(201).json({ message: 'Offer sent.', offer, vacanciesLeft: job.slotsLeft });
    } catch (e) {
        console.error('send offer:', e);
        res.status(500).json({ error: 'Failed to send offer.' });
    }
});

// GET /api/offers/mine (worker)
router.get('/mine', authDb, requireRole('Worker'), async (req, res) => {
    try {
        const filter = { workerId: req.user.userId };
        if (req.query.status) filter.status = req.query.status;
        const offers = await Offer.find(filter).sort({ createdAt: -1 }).limit(100).lean();
        const jobs = await Job.find({ _id: { $in: offers.map(o => o.jobId) } }).select('title contractorName location duration').lean();
        const jm = Object.fromEntries(jobs.map(j => [String(j._id), j]));
        res.json(offers.map(o => ({ ...o, job: jm[String(o.jobId)] || null })));
    } catch (e) {
        res.status(500).json({ error: 'Failed to load offers.' });
    }
});

// GET /api/offers/sent (contractor)
router.get('/sent', authDb, requireRole('Contractor'), async (req, res) => {
    try {
        const filter = { contractorId: req.user.userId };
        if (req.query.status) filter.status = req.query.status;
        if (req.query.jobId && isId(req.query.jobId)) filter.jobId = req.query.jobId;
        const offers = await Offer.find(filter).sort({ createdAt: -1 }).limit(200).lean();
        const [jobs, profiles] = await Promise.all([
            Job.find({ _id: { $in: offers.map(o => o.jobId) } }).select('title').lean(),
            Profile.find({ userId: { $in: offers.map(o => o.workerId) } }).select('userId fullName name avatarUrl').lean()
        ]);
        const jm = Object.fromEntries(jobs.map(j => [String(j._id), j]));
        const pm = Object.fromEntries(profiles.map(p => [String(p.userId), p]));
        res.json(offers.map(o => ({ ...o, job: jm[String(o.jobId)] || null, workerName: pm[String(o.workerId)]?.fullName || pm[String(o.workerId)]?.name || 'Worker', workerAvatar: pm[String(o.workerId)]?.avatarUrl || '' })));
    } catch (e) {
        res.status(500).json({ error: 'Failed to load offers.' });
    }
});

// POST /api/offers/:id/accept (worker)
router.post('/:id/accept', authDb, requireRole('Worker'), async (req, res) => {
    try {
        if (!isId(req.params.id)) return res.status(404).json({ error: 'Offer not found.' });
        const now = new Date();
        // Atomic state change: succeeds for exactly one concurrent request, only if still pending & unexpired.
        const offer = await Offer.findOneAndUpdate(
            { _id: req.params.id, workerId: req.user.userId, status: 'pending', expiresAt: { $gt: now } },
            { $set: { status: 'accepted', respondedAt: now } }, { new: true }
        );
        if (!offer) {
            const existing = await Offer.findOne({ _id: req.params.id, workerId: req.user.userId }).lean();
            if (!existing) return res.status(404).json({ error: 'Offer not found.' });
            if (existing.status === 'pending') return res.status(410).json({ error: 'This offer has expired.' });
            return res.status(409).json({ error: `This offer was already ${existing.status}.` });
        }
        // The vacancy was reserved when the offer was sent, so hired can never exceed workersRequired.
        const job = await Job.findOneAndUpdate({ _id: offer.jobId }, { $inc: { hiredCount: 1 } }, { new: true });
        await Application.updateOne({ _id: offer.applicationId }, { $set: { status: 'accepted' }, $push: { history: { status: 'accepted', by: req.user.userId, at: now } } });
        if (job.hiredCount >= job.workersRequired) {
            const filled = await Job.findOneAndUpdate({ _id: job._id, status: 'active' }, { $set: { status: 'filled' } }, { new: true });
            if (filled) await notify({ userId: job.contractorId, type: 'job_filled', entityId: job._id, message: `"${job.title}" is fully staffed — all ${job.workersRequired} workers confirmed.`, link: 'contractor-dashboard.html#jobs' });
        }
        const profile = await Profile.findOne({ userId: req.user.userId }).select('fullName name').lean();
        await notify({ userId: offer.contractorId, type: 'offer_accepted', fromUserId: req.user.userId, fromName: profile?.fullName || '', entityId: offer._id, message: `${profile?.fullName || 'A worker'} accepted your offer for "${job.title}".`, link: 'contractor-dashboard.html#offers' });
        res.json({ message: 'Offer accepted. You are hired!', offer });
    } catch (e) {
        console.error('accept offer:', e);
        res.status(500).json({ error: 'Failed to accept offer.' });
    }
});

async function closePendingOffer(req, res, { newStatus, who, appStatus, notifyUser, type, text }) {
    try {
        if (!isId(req.params.id)) return res.status(404).json({ error: 'Offer not found.' });
        const ownerKey = who === 'worker' ? { workerId: req.user.userId } : { contractorId: req.user.userId };
        const offer = await Offer.findOneAndUpdate(
            { _id: req.params.id, ...ownerKey, status: 'pending' },
            { $set: { status: newStatus, respondedAt: new Date() } }, { new: true }
        );
        if (!offer) return res.status(409).json({ error: 'This offer is no longer pending.' });
        await releaseSlot(offer.jobId);
        await Application.updateOne({ _id: offer.applicationId, status: 'offer_sent' }, { $set: { status: appStatus }, $push: { history: { status: appStatus, by: req.user.userId, at: new Date() } } });
        const job = await Job.findById(offer.jobId).select('title').lean();
        await notify({ userId: offer[notifyUser], type, fromUserId: req.user.userId, entityId: offer._id, message: text(job?.title || 'a job'), link: who === 'worker' ? 'contractor-dashboard.html#offers' : 'worker-dashboard.html#offers' });
        res.json({ message: `Offer ${newStatus}.`, offer });
    } catch (e) {
        console.error('close offer:', e);
        res.status(500).json({ error: 'Failed to update offer.' });
    }
}

router.post('/:id/decline', authDb, requireRole('Worker'), (req, res) => closePendingOffer(req, res, {
    newStatus: 'declined', who: 'worker', appStatus: 'cancelled', notifyUser: 'contractorId', type: 'offer_declined',
    text: (t) => `A worker declined your offer for "${t}". The vacancy is open again.`
}));
router.post('/:id/cancel', authDb, requireRole('Contractor'), (req, res) => closePendingOffer(req, res, {
    newStatus: 'cancelled', who: 'contractor', appStatus: 'shortlisted', notifyUser: 'workerId', type: 'job_changed',
    text: (t) => `Your offer for "${t}" was withdrawn by the contractor.`
}));

module.exports = router;
