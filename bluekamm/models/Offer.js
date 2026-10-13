const mongoose = require('mongoose');

const OFFER_STATUSES = ['pending', 'accepted', 'declined', 'expired', 'cancelled'];

const OfferSchema = new mongoose.Schema({
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
    workerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    contractorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: OFFER_STATUSES, default: 'pending', index: true },
    message: { type: String, default: '', trim: true, maxlength: 1000 },
    wage: { type: Number, required: true },
    wageType: { type: String, enum: ['daily', 'monthly'], required: true },
    startDate: { type: Date },
    expiresAt: { type: Date, required: true, index: true },
    respondedAt: { type: Date },
    reminderSent: { type: Boolean, default: false }
}, { timestamps: true });

// One open offer per application is guaranteed by the atomic application claim in offerRoutes
// (status pending|shortlisted -> offer_sent), so no partial unique index is needed.

module.exports = mongoose.model('Offer', OfferSchema);
module.exports.OFFER_STATUSES = OFFER_STATUSES;
