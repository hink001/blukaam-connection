const mongoose = require('mongoose');

const APPLICATION_STATUSES = ['pending', 'shortlisted', 'offer_sent', 'accepted', 'rejected', 'withdrawn', 'cancelled'];

const ApplicationSchema = new mongoose.Schema({
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    workerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    contractorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: APPLICATION_STATUSES, default: 'pending', index: true },
    coverNote: { type: String, default: '', trim: true, maxlength: 1000 },
    history: [{
        _id: false,
        status: String,
        by: mongoose.Schema.Types.ObjectId,
        at: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

// One application per worker per job, ever. Re-applying after withdrawal reuses the same document.
ApplicationSchema.index({ jobId: 1, workerId: 1 }, { unique: true });

module.exports = mongoose.model('Application', ApplicationSchema);
module.exports.APPLICATION_STATUSES = APPLICATION_STATUSES;
