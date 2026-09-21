const mongoose = require('mongoose');

const ActivityLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    action: {
        type: String,
        required: true,
        enum: [
            'AUTH_REGISTER',
            'AUTH_LOGIN',
            'AUTH_LOGOUT',
            'PROFILE_UPDATE',
            'AVATAR_UPDATE',
            'SKILL_ADD',
            'SKILL_REMOVE',
            'PROFILE_VIEW'
        ]
    },
    description: {
        type: String,
        required: true
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    ipAddress: {
        type: String,
        default: ''
    },
    userAgent: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

ActivityLogSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('ActivityLog', ActivityLogSchema);
