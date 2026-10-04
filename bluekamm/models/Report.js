const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
    reporterId: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
        index: true
    },
    reportedUserId: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
        index: true
    },
    reason: {
        type: String,
        enum: ['spam', 'harassment', 'fake profile', 'inappropriate content', 'scam', 'other'],
        required: true
    },
    description: {
        type: String,
        default: '',
        maxlength: 2000
    },
    status: {
        type: String,
        enum: ['pending', 'reviewed', 'resolved', 'dismissed'],
        default: 'pending',
        index: true
    }
}, {
    timestamps: true
});

ReportSchema.index({ reporterId: 1, reportedUserId: 1 });

module.exports = mongoose.model('Report', ReportSchema);
