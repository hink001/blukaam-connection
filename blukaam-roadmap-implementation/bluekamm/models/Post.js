const mongoose = require('mongoose');

// Sub-schema: a single reaction on a post (Like / Celebrate / Support / Insightful)
const ReactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.Mixed, required: true }, // ObjectId (Mongo) or offline "usr_..." string
    name: { type: String, default: '' },
    type: {
        type: String,
        enum: ['like', 'celebrate', 'support', 'insightful'],
        default: 'like'
    },
    createdAt: { type: Date, default: Date.now }
}, { _id: false });

// Sub-schema: a comment (with lightweight author snapshot so we never need
// a populate() call — this keeps parity between MongoDB mode and offline JSON mode)
const CommentSchema = new mongoose.Schema({
    _id: { type: String, default: () => 'cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) },
    userId: { type: mongoose.Schema.Types.Mixed, required: true },
    authorName: { type: String, default: 'Member' },
    authorAvatar: { type: String, default: '' },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    createdAt: { type: Date, default: Date.now }
}, { _id: false });

const PostSchema = new mongoose.Schema({
    authorId: { type: mongoose.Schema.Types.Mixed, required: true, index: true },
    authorName: { type: String, default: 'Member' },
    authorHeadline: { type: String, default: '' },
    authorAvatar: { type: String, default: '' },

    content: { type: String, required: true, trim: true, maxlength: 5000 },
    mediaUrls: { type: [String], default: [] },
    tags: { type: [String], default: [] },

    // Repost support: when set, this post is a "share" of an original post
    originalPostId: { type: mongoose.Schema.Types.Mixed, default: null },

    reactions: { type: [ReactionSchema], default: [] },
    comments: { type: [CommentSchema], default: [] },

    likesCount: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
    sharesCount: { type: Number, default: 0 },

    visibility: { type: String, enum: ['public', 'connections'], default: 'public' }
}, {
    timestamps: true
});

// Keep counters in sync whenever a post is saved directly (defensive; routes also update these explicitly)
PostSchema.pre('save', function (next) {
    if (Array.isArray(this.reactions)) this.likesCount = this.reactions.length;
    if (Array.isArray(this.comments)) this.commentsCount = this.comments.length;
    next();
});

PostSchema.index({ createdAt: -1 });
PostSchema.index({ authorId: 1, createdAt: -1 });

module.exports = mongoose.model('Post', PostSchema);
