const mongoose = require('mongoose');

const BlockSchema = new mongoose.Schema({
    blockerId: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
        index: true
    },
    blockedId: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
        index: true
    }
}, {
    timestamps: true
});

// A user can block another user only once
BlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });

module.exports = mongoose.model('Block', BlockSchema);
