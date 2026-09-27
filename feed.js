/* Feed page logic — requires auth-profile.js + social-sdk.js loaded first */

let nextCursor = null;
let pendingMediaUrls = [];
const myUser = BluKaamAuth.getUser() || {};
const myId = myUser.id || myUser._id;

document.addEventListener('DOMContentLoaded', async () => {
    if (!BluKaamAuth.requireAuth('login.html')) return;

    await loadSidebarProfile();
    await loadSuggestions();
    await loadFeed(true);

    document.getElementById('mediaInput').addEventListener('change', handleMediaSelect);
});

function toggleMenu() {
    document.getElementById('mobileMenu').classList.toggle('open');
}

async function loadSidebarProfile() {
    try {
        const profile = await BluKaamAuth.getMyProfile();
        document.getElementById('sidebarAvatar').src = profile.avatarUrl || 'logo-emblem.png';
        document.getElementById('sidebarName').textContent = profile.fullName || profile.name || 'Member';
        document.getElementById('sidebarHeadline').textContent = profile.headline || 'Skilled Professional';

        const connections = await BluKaamAuth.getMyConnections();
        document.getElementById('sidebarConnCount').textContent = connections.length;
    } catch (e) {
        console.error('Failed to load sidebar profile', e);
    }
}

async function loadSuggestions() {
    const container = document.getElementById('suggestionsContainer');
    try {
        const suggestions = await BluKaamAuth.getConnectionSuggestions(5);
        if (suggestions.length === 0) {
            container.innerHTML = '<div style="font-size:13px;color:var(--gray-500);">No suggestions right now.</div>';
            return;
        }
        container.innerHTML = suggestions.map(s => `
            <div class="suggestion-row">
                <img src="${s.avatar || 'logo-emblem.png'}" onerror="this.src='logo-emblem.png'">
                <div>
                    <div class="suggestion-name">${escapeHtml(s.name)}</div>
                    <div class="suggestion-meta">${escapeHtml(s.trade || s.city || '')}</div>
                </div>
                <button class="btn-connect-sm" onclick="connectWith('${s.userId}', this)">Connect</button>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = '<div style="font-size:13px;color:var(--gray-500);">Could not load suggestions.</div>';
    }
}

async function connectWith(userId, btn) {
    try {
        btn.disabled = true;
        await BluKaamAuth.sendConnectionRequest(userId);
        btn.textContent = 'Pending';
        BluKaamAuth.showToast('Connection request sent!');
    } catch (e) {
        btn.disabled = false;
        BluKaamAuth.showToast(e.message || 'Failed to send request', 'error');
    }
}

async function loadFeed(reset = false) {
    try {
        if (reset) {
            nextCursor = null;
            document.getElementById('feedContainer').innerHTML = '';
        }
        const { posts, nextCursor: cursor } = await BluKaamAuth.getFeed(nextCursor);
        nextCursor = cursor;
        document.getElementById('btnLoadMore').style.display = nextCursor ? 'inline-block' : 'none';

        if (reset && posts.length === 0) {
            document.getElementById('feedContainer').innerHTML =
                '<div class="post-card" style="text-align:center;color:var(--gray-500);">No posts yet. Be the first to share an update!</div>';
            return;
        }

        posts.forEach(post => renderPost(post));
    } catch (e) {
        console.error('Failed to load feed', e);
        BluKaamAuth.showToast('Failed to load the feed', 'error');
    }
}

function loadMore() { loadFeed(false); }

function renderPost(post) {
    const el = document.createElement('div');
    el.className = 'post-card';
    el.id = `post-${post._id}`;

    const myReaction = (post.reactions || []).find(r => String(r.userId) === String(myId));
    const canDelete = String(post.authorId) === String(myId);

    el.innerHTML = `
        ${post.originalPostId ? `<div class="post-repost-tag">🔁 Reposted</div>` : ''}
        <div class="post-card-header">
            <img class="post-avatar" src="${post.authorAvatar || 'logo-emblem.png'}" onerror="this.src='logo-emblem.png'">
            <div style="flex:1;">
                <div class="post-author-name">${escapeHtml(post.authorName || 'Member')}</div>
                <div class="post-author-headline">${escapeHtml(post.authorHeadline || '')}</div>
                <div class="post-time">${timeAgo(post.createdAt)}</div>
            </div>
            ${canDelete ? `<button onclick="deletePost('${post._id}')" style="background:none;border:none;cursor:pointer;color:var(--gray-400);">✕</button>` : ''}
        </div>
        <div class="post-content">${escapeHtml(post.content)}</div>
        ${(post.mediaUrls && post.mediaUrls.length) ? `
            <div class="post-media-grid">
                ${post.mediaUrls.map(u => `<img src="${u}" alt="Post photo">`).join('')}
            </div>` : ''}
        <div class="post-stats-row">
            <span>👍 ${post.likesCount || 0} reactions</span>
            <span>${post.commentsCount || 0} comments · ${post.sharesCount || 0} shares</span>
        </div>
        <div class="post-action-row">
            <button class="post-action-btn ${myReaction ? 'active' : ''}" onclick="reactToPost('${post._id}', 'like')">
                👍 ${myReaction ? capitalize(myReaction.type) : 'Like'}
            </button>
            <button class="post-action-btn" onclick="toggleComments('${post._id}')">💬 Comment</button>
            <button class="post-action-btn" onclick="sharePost('${post._id}')">🔁 Share</button>
        </div>
        <div class="post-comments" id="comments-${post._id}" style="display:none;">
            <div id="commentList-${post._id}">
                ${(post.comments || []).map(c => renderComment(c)).join('')}
            </div>
            <div class="comment-input-row">
                <input type="text" id="commentInput-${post._id}" placeholder="Write a comment..." onkeydown="if(event.key==='Enter') submitComment('${post._id}')">
                <button class="btn-post" onclick="submitComment('${post._id}')">Send</button>
            </div>
        </div>
    `;
    document.getElementById('feedContainer').appendChild(el);
}

function renderComment(c) {
    return `
        <div class="comment-item">
            <img class="post-avatar" style="width:32px;height:32px;" src="${c.authorAvatar || 'logo-emblem.png'}" onerror="this.src='logo-emblem.png'">
            <div class="comment-bubble">
                <div class="comment-author">${escapeHtml(c.authorName || 'Member')}</div>
                <div class="comment-text">${escapeHtml(c.text)}</div>
            </div>
        </div>
    `;
}

function toggleComments(postId) {
    const box = document.getElementById(`comments-${postId}`);
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function reactToPost(postId, type) {
    try {
        const res = await BluKaamAuth.reactToPost(postId, type);
        const card = document.getElementById(`post-${postId}`);
        card.querySelector('.post-stats-row span').textContent = `👍 ${res.likesCount} reactions`;
        const btn = card.querySelector('.post-action-btn');
        if (res.action === 'removed') {
            btn.classList.remove('active');
            btn.innerHTML = '👍 Like';
        } else {
            btn.classList.add('active');
            btn.innerHTML = `👍 ${capitalize(type)}`;
        }
    } catch (e) {
        BluKaamAuth.showToast(e.message || 'Failed to react', 'error');
    }
}

async function submitComment(postId) {
    const input = document.getElementById(`commentInput-${postId}`);
    const text = input.value.trim();
    if (!text) return;
    try {
        const { comment, commentsCount } = await BluKaamAuth.commentOnPost(postId, text);
        document.getElementById(`commentList-${postId}`).insertAdjacentHTML('beforeend', renderComment(comment));
        input.value = '';
        const card = document.getElementById(`post-${postId}`);
        card.querySelector('.post-stats-row span:last-child').textContent =
            `${commentsCount} comments · ${card.dataset.shares || 0} shares`;
    } catch (e) {
        BluKaamAuth.showToast(e.message || 'Failed to add comment', 'error');
    }
}

async function sharePost(postId) {
    try {
        await BluKaamAuth.sharePost(postId);
        BluKaamAuth.showToast('Post shared to your feed!');
        loadFeed(true);
    } catch (e) {
        BluKaamAuth.showToast(e.message || 'Failed to share post', 'error');
    }
}

async function deletePost(postId) {
    if (!confirm('Delete this post?')) return;
    try {
        await BluKaamAuth.deletePost(postId);
        document.getElementById(`post-${postId}`).remove();
    } catch (e) {
        BluKaamAuth.showToast(e.message || 'Failed to delete post', 'error');
    }
}

async function handleMediaSelect(e) {
    const files = e.target.files;
    if (!files.length) return;
    try {
        const { mediaUrls } = await BluKaamAuth.uploadPostMedia(files);
        pendingMediaUrls = pendingMediaUrls.concat(mediaUrls).slice(0, 4);
        renderMediaPreview();
    } catch (err) {
        BluKaamAuth.showToast(err.message || 'Failed to upload media', 'error');
    }
}

function renderMediaPreview() {
    document.getElementById('mediaPreview').innerHTML =
        pendingMediaUrls.map(u => `<img src="${u}">`).join('');
}

async function publishPost() {
    const content = document.getElementById('postContent').value.trim();
    if (!content) { BluKaamAuth.showToast('Write something before posting', 'error'); return; }
    const btn = document.getElementById('btnPublish');
    btn.disabled = true;
    try {
        await BluKaamAuth.createPost(content, pendingMediaUrls);
        document.getElementById('postContent').value = '';
        pendingMediaUrls = [];
        renderMediaPreview();
        BluKaamAuth.showToast('Post published!');
        loadFeed(true);
    } catch (e) {
        BluKaamAuth.showToast(e.message || 'Failed to publish post', 'error');
    } finally {
        btn.disabled = false;
    }
}

// ---------- small helpers ----------
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function timeAgo(dateStr) {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}
