const Job = require('../models/Job');
const Offer = require('../models/Offer');
const Application = require('../models/Application');
const { notify } = require('./marketplaceNotify');

/** Give one reserved vacancy back to the job. Call exactly once per released offer. */
async function releaseSlot(jobId) {
    await Job.updateOne({ _id: jobId }, { $inc: { slotsLeft: 1 } });
}

/** Expire pending offers whose deadline passed. Safe to run repeatedly / concurrently. */
async function expireOffers() {
    const now = new Date();
    const due = await Offer.find({ status: 'pending', expiresAt: { $lte: now } }).limit(200);
    let n = 0;
    for (const o of due) {
        const done = await Offer.findOneAndUpdate({ _id: o._id, status: 'pending' }, { $set: { status: 'expired', respondedAt: now } });
        if (!done) continue;                       // someone else handled it
        n++;
        await releaseSlot(o.jobId);
        await Application.updateOne({ _id: o.applicationId, status: 'offer_sent' }, { $set: { status: 'shortlisted' } });
        const job = await Job.findById(o.jobId).select('title').lean();
        await notify({ userId: o.workerId, type: 'offer_expired', entityId: o._id, message: `Your offer for "${job?.title}" expired.`, link: 'worker-dashboard.html#offers' });
        await notify({ userId: o.contractorId, type: 'offer_expired', entityId: o._id, message: `An offer for "${job?.title}" expired without a response. The vacancy is open again.`, link: 'contractor-dashboard.html#offers' });
    }
    return n;
}

/** Remind both sides once when an offer is close to expiring (last 25% of its life, max 2h). */
async function sendOfferReminders() {
    const now = new Date();
    const pending = await Offer.find({ status: 'pending', reminderSent: false, expiresAt: { $gt: now } }).limit(200);
    let n = 0;
    for (const o of pending) {
        const life = o.expiresAt - o.createdAt;
        const window = Math.min(2 * 3600 * 1000, life * 0.25);
        if (o.expiresAt - now > window) continue;
        const claimed = await Offer.findOneAndUpdate({ _id: o._id, reminderSent: false, status: 'pending' }, { $set: { reminderSent: true } });
        if (!claimed) continue;
        n++;
        const job = await Job.findById(o.jobId).select('title').lean();
        await notify({ userId: o.workerId, type: 'offer_reminder', entityId: o._id, message: `Your offer for "${job?.title}" expires soon. Please respond.`, link: 'worker-dashboard.html#offers' });
        await notify({ userId: o.contractorId, type: 'offer_reminder', entityId: o._id, message: `An offer for "${job?.title}" is about to expire.`, link: 'contractor-dashboard.html#offers' });
    }
    return n;
}

module.exports = { releaseSlot, expireOffers, sendOfferReminders };
