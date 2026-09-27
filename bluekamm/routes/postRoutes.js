const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const Post = require('../models/Post');
const Profile = require('../models/Profile');
const Connection = require('../models/Connection');
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');
const { uploadImageBuffer } = require('../services/cloudinary');
const { logActivity } = require('../services/activityService');
const { createNotification } = require('../services/notificationService');
const { cleanText } = require('../utils/sanitize');

const DB_FILE = path.join(__dirname, '..', 'local_database.json');

// --------------------------------------------------------
// Offline JSON helpers (same pattern used across the codebase)
// --------------------------------------------------------
const getOfflineDb = () => {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], profiles: [], activityLogs: [], posts: [] }));
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.posts) data.posts = [];
    return data;
};
const saveOfflineDb = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
const isMongo = () => mongoose.connection.readyState === 1;

// Build a lightweight author snapshot so the feed never needs populate()
async function getAuthorSnapshot(userId) {
    try {
        if (isMongo()) {
            const profile = await Profile.findOne({ userId });
            if (profile) {
                return {
                    authorName: profile.fullName || profile.name || 'Member',
                    authorHeadline: profile.headline || '',
                    authorAvatar: profile.avatarUrl || ''
                };
            }
        } else {
            const db = getOfflineDb();
            const profile = db.profiles.find(p => p.userId === userId);
            if (profile) {
                return {
                    authorName: profile.fullName || profile.name || 'Member',
                    authorHeadline: profile.headline || '',
                    authorAvatar: profile.avatarUrl || ''
                };
            }
        }
    } catch (e) { /* fall through to default */ }
    return { authorName: 'Member', authorHeadline: '', authorAvatar: '' };
}

// --------------------------------------------------------
// POST /api/posts/upload-media
// Upload one or more images for a post, straight to Cloudinary (same pattern as avatar upload)
// --------------------------------------------------------
router.post('/upload-media', authMiddleware, upload.array('media', 4), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No media files uploaded.' });
        }
        const urls = await Promise.all(
            req.files.map(file => uploadImageBuffer(file.buffer, 'blukaam/posts'))
        );
        return res.json({ mediaUrls: urls });
    } catch (err) {
        console.error('Post media upload error:', err);
        return res.status(500).json({ error: 'Failed to upload media. ' + err.message });
    }
});

// --------------------------------------------------------
// POST /api/posts
// Create a new post (text + optional photos, job announcements, etc.)
// --------------------------------------------------------
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        const { content, mediaUrls = [], tags = [], visibility = 'public' } = req.body;

        const cleanContent = cleanText(content);
        if (!cleanContent) {
            return res.status(400).json({ error: 'Post content cannot be empty.' });
        }

        const snapshot = await getAuthorSnapshot(userId);

        const postData = {
            authorId: userId,
            ...snapshot,
            content: cleanContent,
            mediaUrls: Array.isArray(mediaUrls) ? mediaUrls.slice(0, 4) : [],
            tags: Array.isArray(tags) ? tags.map(cleanText).slice(0, 10) : [],
            visibility: visibility === 'connections' ? 'connections' : 'public'
        };

        let saved;
        if (isMongo()) {
            saved = await new Post(postData).save();
        } else {
            const db = getOfflineDb();
            saved = {
                _id: 'post_' + Date.now(),
                ...postData,
                reactions: [],
                comments: [],
                likesCount: 0,
                commentsCount: 0,
                sharesCount: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            db.posts.unshift(saved);
            saveOfflineDb(db);
        }

        await logActivity({ userId, action: 'POST_CREATE', description: 'Created a new feed post', req });

        return res.status(201).json({ message: 'Post published!', post: saved });
    } catch (err) {
        console.error('Create post error:', err);
        return res.status(500).json({ error: 'Failed to publish post. ' + err.message });
    }
});

// --------------------------------------------------------
// GET /api/posts/feed
// Cursor-paginated feed: ?limit=10&before=<ISO timestamp>
// --------------------------------------------------------
router.get('/feed', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 30);
        const before = req.query.before ? new Date(req.query.before) : null;

        if (isMongo()) {
            const filter = before ? { createdAt: { $lt: before } } : {};
            const posts = await Post.find(filter).sort({ createdAt: -1 }).limit(limit);
            const nextCursor = posts.length === limit ? posts[posts.length - 1].createdAt : null;
            return res.json({ posts, nextCursor });
        } else {
            const db = getOfflineDb();
            let all = [...db.posts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            if (before) all = all.filter(p => new Date(p.createdAt) < before);
            const posts = all.slice(0, limit);
            const nextCursor = posts.length === limit ? posts[posts.length - 1].createdAt : null;
            return res.json({ posts, nextCursor });
        }
    } catch (err) {
        console.error('Fetch feed error:', err);
        return res.status(500).json({ error: 'Failed to load feed.' });
    }
});

// --------------------------------------------------------
// GET /api/posts/user/:userId
// Posts authored by a specific user (used on public profile pages)
// --------------------------------------------------------
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        if (isMongo()) {
            const posts = await Post.find({ authorId: userId }).sort({ createdAt: -1 }).limit(50);
            return res.json(posts);
        } else {
            const db = getOfflineDb();
            const posts = db.posts.filter(p => p.authorId === userId)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            return res.json(posts);
        }
    } catch (err) {
        console.error('Fetch user posts error:', err);
        return res.status(500).json({ error: 'Failed to load posts.' });
    }
});

// --------------------------------------------------------
// POST /api/posts/:id/react
// Toggle a reaction (like/celebrate/support/insightful). Sending the same
// type again removes it; sending a different type switches it.
// --------------------------------------------------------
router.post('/:id/react', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        const { id } = req.params;
        const type = ['like', 'celebrate', 'support', 'insightful'].includes(req.body.type) ? req.body.type : 'like';
        const snapshot = await getAuthorSnapshot(userId);

        if (isMongo()) {
            const post = await Post.findById(id);
            if (!post) return res.status(404).json({ error: 'Post not found.' });

            const existingIdx = post.reactions.findIndex(r => String(r.userId) === String(userId));
            let action = 'added';
            if (existingIdx > -1) {
                if (post.reactions[existingIdx].type === type) {
                    post.reactions.splice(existingIdx, 1);
                    action = 'removed';
                } else {
                    post.reactions[existingIdx].type = type;
                    action = 'changed';
                }
            } else {
                post.reactions.push({ userId, name: snapshot.authorName, type });
            }
            post.likesCount = post.reactions.length;
            await post.save();

            if (action !== 'removed' && String(post.authorId) !== String(userId)) {
                await createNotification({
                    userId: post.authorId,
                    type: 'post_reaction',
                    fromUserId: userId,
                    fromName: snapshot.authorName,
                    fromAvatar: snapshot.authorAvatar,
                    entityId: post._id,
                    message: `${snapshot.authorName} reacted to your post.`,
                    link: 'feed.html'
                });
            }

            return res.json({ likesCount: post.likesCount, reactions: post.reactions, action });
        } else {
            const db = getOfflineDb();
            const post = db.posts.find(p => p._id === id);
            if (!post) return res.status(404).json({ error: 'Post not found.' });
            if (!post.reactions) post.reactions = [];

            const existingIdx = post.reactions.findIndex(r => r.userId === userId);
            let action = 'added';
            if (existingIdx > -1) {
                if (post.reactions[existingIdx].type === type) {
                    post.reactions.splice(existingIdx, 1);
                    action = 'removed';
                } else {
                    post.reactions[existingIdx].type = type;
                    action = 'changed';
                }
            } else {
                post.reactions.push({ userId, name: snapshot.authorName, type, createdAt: new Date().toISOString() });
            }
            post.likesCount = post.reactions.length;
            saveOfflineDb(db);

            if (action !== 'removed' && post.authorId !== userId) {
                await createNotification({
                    userId: post.authorId,
                    type: 'post_reaction',
                    fromUserId: userId,
                    fromName: snapshot.authorName,
                    fromAvatar: snapshot.authorAvatar,
                    entityId: post._id,
                    message: `${snapshot.authorName} reacted to your post.`,
                    link: 'feed.html'
                });
            }

            return res.json({ likesCount: post.likesCount, reactions: post.reactions, action });
        }
    } catch (err) {
        console.error('React to post error:', err);
        return res.status(500).json({ error: 'Failed to react to post.' });
    }
});

// --------------------------------------------------------
// POST /api/posts/:id/comment
// --------------------------------------------------------
router.post('/:id/comment', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        const { id } = req.params;
        const text = cleanText(req.body.text);
        if (!text) return res.status(400).json({ error: 'Comment cannot be empty.' });

        const snapshot = await getAuthorSnapshot(userId);
        const comment = {
            _id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            userId,
            authorName: snapshot.authorName,
            authorAvatar: snapshot.authorAvatar,
            text,
            createdAt: new Date().toISOString()
        };

        let post;
        if (isMongo()) {
            post = await Post.findByIdAndUpdate(
                id,
                { $push: { comments: comment }, $inc: { commentsCount: 1 } },
                { new: true }
            );
        } else {
            const db = getOfflineDb();
            post = db.posts.find(p => p._id === id);
            if (post) {
                if (!post.comments) post.comments = [];
                post.comments.push(comment);
                post.commentsCount = post.comments.length;
                saveOfflineDb(db);
            }
        }
        if (!post) return res.status(404).json({ error: 'Post not found.' });

        if (String(post.authorId) !== String(userId)) {
            await createNotification({
                userId: post.authorId,
                type: 'post_comment',
                fromUserId: userId,
                fromName: snapshot.authorName,
                fromAvatar: snapshot.authorAvatar,
                entityId: post._id,
                message: `${snapshot.authorName} commented on your post.`,
                link: 'feed.html'
            });
        }

        await logActivity({ userId, action: 'POST_COMMENT', description: 'Commented on a feed post', req });
        return res.status(201).json({ comment, commentsCount: post.commentsCount });
    } catch (err) {
        console.error('Comment on post error:', err);
        return res.status(500).json({ error: 'Failed to add comment.' });
    }
});

// --------------------------------------------------------
// POST /api/posts/:id/share
// Repost: creates a new post that references the original
// --------------------------------------------------------
router.post('/:id/share', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        const { id } = req.params;
        const comment = cleanText(req.body.comment || '');
        const snapshot = await getAuthorSnapshot(userId);

        let original;
        if (isMongo()) {
            original = await Post.findById(id);
        } else {
            const db = getOfflineDb();
            original = db.posts.find(p => p._id === id);
        }
        if (!original) return res.status(404).json({ error: 'Original post not found.' });

        const repostData = {
            authorId: userId,
            ...snapshot,
            content: comment || `Shared a post from ${original.authorName || 'a member'}.`,
            mediaUrls: [],
            tags: [],
            originalPostId: original._id,
            visibility: 'public'
        };

        let saved;
        if (isMongo()) {
            saved = await new Post(repostData).save();
            await Post.findByIdAndUpdate(id, { $inc: { sharesCount: 1 } });
        } else {
            const db = getOfflineDb();
            saved = {
                _id: 'post_' + Date.now(),
                ...repostData,
                reactions: [], comments: [], likesCount: 0, commentsCount: 0, sharesCount: 0,
                createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
            };
            db.posts.unshift(saved);
            const orig = db.posts.find(p => p._id === id);
            if (orig) orig.sharesCount = (orig.sharesCount || 0) + 1;
            saveOfflineDb(db);
        }

        if (String(original.authorId) !== String(userId)) {
            await createNotification({
                userId: original.authorId,
                type: 'post_share',
                fromUserId: userId,
                fromName: snapshot.authorName,
                fromAvatar: snapshot.authorAvatar,
                entityId: original._id,
                message: `${snapshot.authorName} shared your post.`,
                link: 'feed.html'
            });
        }

        return res.status(201).json({ message: 'Post shared!', post: saved });
    } catch (err) {
        console.error('Share post error:', err);
        return res.status(500).json({ error: 'Failed to share post.' });
    }
});

// --------------------------------------------------------
// DELETE /api/posts/:id
// Author-only delete
// --------------------------------------------------------
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        const { id } = req.params;

        if (isMongo()) {
            const post = await Post.findById(id);
            if (!post) return res.status(404).json({ error: 'Post not found.' });
            if (String(post.authorId) !== String(userId) && req.user.role !== 'Admin') {
                return res.status(403).json({ error: 'You can only delete your own posts.' });
            }
            await Post.findByIdAndDelete(id);
        } else {
            const db = getOfflineDb();
            const idx = db.posts.findIndex(p => p._id === id);
            if (idx === -1) return res.status(404).json({ error: 'Post not found.' });
            if (db.posts[idx].authorId !== userId && req.user.role !== 'Admin') {
                return res.status(403).json({ error: 'You can only delete your own posts.' });
            }
            db.posts.splice(idx, 1);
            saveOfflineDb(db);
        }

        return res.json({ message: 'Post deleted.' });
    } catch (err) {
        console.error('Delete post error:', err);
        return res.status(500).json({ error: 'Failed to delete post.' });
    }
});

module.exports = router;
