const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.Mixed, required: true, index: true }, // recipient
    type: {
        type: String,
        enum: [
            'follow',
            'connection_request',
            'connection_accepted',
            'post_reaction',
            'post_comment',
            'post_share',
            'new_message',
            'message'
        ],
        required: true
    },
    fromUserId: { type: mongoose.Schema.Types.Mixed, default: null },
    fromName: { type: String, default: '' },
    fromAvatar: { type: String, default: '' },
    entityId: { type: mongoose.Schema.Types.Mixed, default: null }, // postId / connectionId / etc.
    message: { type: String, required: true },
    link: { type: String, default: '' },
    isRead: { type: Boolean, default: false }
}, {
    timestamps: true
});

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, isRead: 1 });

module.exports = mongoose.model('Notification', NotificationSchema);
