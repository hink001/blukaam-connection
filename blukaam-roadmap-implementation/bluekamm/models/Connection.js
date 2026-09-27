const mongoose = require('mongoose');

const ConnectionSchema = new mongoose.Schema({
    requesterId: { type: mongoose.Schema.Types.Mixed, required: true, index: true },
    recipientId: { type: mongoose.Schema.Types.Mixed, required: true, index: true },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected', 'blocked', 'withdrawn'],
        default: 'pending',
        index: true
    },
    respondedAt: { type: Date }
}, {
    timestamps: true
});

// A requester can only have one active (non-withdrawn/rejected) request toward the same recipient
ConnectionSchema.index({ requesterId: 1, recipientId: 1 }, { unique: true });

module.exports = mongoose.model('Connection', ConnectionSchema);
