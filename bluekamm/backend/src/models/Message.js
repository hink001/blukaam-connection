const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    // Sorted array of the two participant IDs, e.g. [idA, idB] — always stored in a
    // consistent order so a thread can be queried with one simple filter.
    participants: {
        type: [mongoose.Schema.Types.Mixed],
        required: true,
        validate: v => Array.isArray(v) && v.length === 2
    },
    senderId: { type: mongoose.Schema.Types.Mixed, required: true },
    recipientId: { type: mongoose.Schema.Types.Mixed, required: true },
    text: { type: String, required: true, trim: true, maxlength: 4000 },
    readAt: { type: Date, default: null }
}, {
    timestamps: true
});

MessageSchema.index({ participants: 1, createdAt: -1 });

module.exports = mongoose.model('Message', MessageSchema);
