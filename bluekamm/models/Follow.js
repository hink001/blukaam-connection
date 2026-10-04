const mongoose = require('mongoose');

const FollowSchema = new mongoose.Schema({
    followerId: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
        index: true
    },
    followingId: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
        index: true
    }
}, {
    timestamps: true
});

// A user can follow another user only once
FollowSchema.index({ followerId: 1, followingId: 1 }, { unique: true });

module.exports = mongoose.model('Follow', FollowSchema);
