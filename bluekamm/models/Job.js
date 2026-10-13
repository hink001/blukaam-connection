const mongoose = require('mongoose');

const JOB_STATUSES = ['draft', 'active', 'paused', 'filled', 'closed', 'cancelled'];

const JobSchema = new mongoose.Schema({
    contractorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    contractorName: { type: String, default: '' },          // snapshot for public listing (business name only)
    contractorVerified: { type: Boolean, default: false },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', trim: true, maxlength: 4000 },
    category: { type: String, default: '', trim: true, index: true },
    skills: { type: [String], default: [], index: true },
    location: {
        city: { type: String, trim: true, default: '', index: true },
        state: { type: String, trim: true, default: '' },
        address: { type: String, trim: true, default: '' }
    },
    workersRequired: { type: Number, required: true, min: 1, max: 1000 },
    slotsLeft: { type: Number, required: true, min: 0 },     // vacancies not reserved by a pending/accepted offer
    hiredCount: { type: Number, default: 0, min: 0 },        // offers accepted by workers
    wage: { type: Number, required: true, min: 1 },
    wageType: { type: String, enum: ['daily', 'monthly'], required: true },
    paymentFrequency: { type: String, default: '', trim: true },
    experienceYears: { type: Number, default: 0, min: 0 },
    startDate: { type: Date },
    duration: { type: String, default: '', trim: true },
    schedule: { type: String, default: '', trim: true },
    applicationDeadline: { type: Date },
    additionalRequirements: { type: String, default: '', trim: true, maxlength: 2000 },
    status: { type: String, enum: JOB_STATUSES, default: 'active', index: true }
}, { timestamps: true });

JobSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Job', JobSchema);
module.exports.JOB_STATUSES = JOB_STATUSES;
