/**
 * BluKaam Connection — Social Layer SDK (Phases 1, 2, 4, 5)
 * Extends the existing window.BluKaamAuth object with Posts, Connections,
 * Messages and Notifications endpoints, plus a small nav injector for the
 * new Feed / My Network / Messages links and the notification bell.
 *
 * IMPORTANT: Load this file AFTER auth-profile.js on every page that uses it:
 *   <script src="auth-profile.js"></script>
 *   <script src="social-sdk.js"></script>
 */
(function () {
    if (!window.BluKaamAuth) {
        console.error('social-sdk.js requires auth-profile.js to be loaded first.');
        return;
    }

    const BK = window.BluKaamAuth;

    // -------------------------------------------------------------
    // Phase 1: Posts / Feed
    // -------------------------------------------------------------
    BK.createPost = async function (content, mediaUrls = [], tags = []) {
        return this.request('/posts', { method: 'POST', body: JSON.stringify({ content, mediaUrls, tags }) });
    };

    BK.uploadPostMedia = async function (files) {
        const formData = new FormData();
        Array.from(files).slice(0, 4).forEach(f => formData.append('media', f));
        return this.request('/posts/upload-media', { method: 'POST', body: formData });
    };

    BK.getFeed = async function (before = null, limit = 10) {
        const params = new URLSearchParams({ limit });
        if (before) params.set('before', before);
        return this.request(`/posts/feed?${params.toString()}`);
    };

    BK.getUserPosts = async function (userId) {
        return this.request(`/posts/user/${encodeURIComponent(userId)}`);
    };

    BK.reactToPost = async function (postId, type = 'like') {
        return this.request(`/posts/${postId}/react`, { method: 'POST', body: JSON.stringify({ type }) });
    };

    BK.commentOnPost = async function (postId, text) {
        return this.request(`/posts/${postId}/comment`, { method: 'POST', body: JSON.stringify({ text }) });
    };

    BK.sharePost = async function (postId, comment = '') {
        return this.request(`/posts/${postId}/share`, { method: 'POST', body: JSON.stringify({ comment }) });
    };

    BK.deletePost = async function (postId) {
        return this.request(`/posts/${postId}`, { method: 'DELETE' });
    };

    // -------------------------------------------------------------
    // Phase 2: Connections / Networking
    // -------------------------------------------------------------
    BK.sendConnectionRequest = async function (userId) {
        return this.request(`/connections/request/${encodeURIComponent(userId)}`, { method: 'POST' });
    };

    BK.acceptConnection = async function (connectionId) {
        return this.request(`/connections/${connectionId}/accept`, { method: 'POST' });
    };

    BK.rejectConnection = async function (connectionId) {
        return this.request(`/connections/${connectionId}/reject`, { method: 'POST' });
    };

    BK.withdrawConnection = async function (connectionId) {
        return this.request(`/connections/${connectionId}/withdraw`, { method: 'POST' });
    };

    BK.removeConnection = async function (connectionId) {
        return this.request(`/connections/${connectionId}`, { method: 'DELETE' });
    };

    BK.getMyConnections = async function () {
        return this.request('/connections/my');
    };

    BK.getPendingConnections = async function () {
        return this.request('/connections/pending');
    };

    BK.getSentConnections = async function () {
        return this.request('/connections/sent');
    };

    BK.getConnectionStatus = async function (userId) {
        return this.request(`/connections/status/${encodeURIComponent(userId)}`);
    };

    BK.getConnectionSuggestions = async function (limit = 10) {
        return this.request(`/connections/suggestions?limit=${limit}`);
    };

    // -------------------------------------------------------------
    // Phase 5: Direct Messaging
    // -------------------------------------------------------------
    BK.sendMessage = async function (userId, text) {
        return this.request(`/messages/send/${encodeURIComponent(userId)}`, { method: 'POST', body: JSON.stringify({ text }) });
    };

    BK.getThread = async function (userId) {
        return this.request(`/messages/thread/${encodeURIComponent(userId)}`);
    };

    BK.getConversations = async function () {
        return this.request('/messages/conversations');
    };

    BK.markThreadRead = async function (userId) {
        return this.request(`/messages/read/${encodeURIComponent(userId)}`, { method: 'POST' });
    };

    // -------------------------------------------------------------
    // Phase 5: Notifications
    // -------------------------------------------------------------
    BK.getNotifications = async function (limit = 20) {
        return this.request(`/notifications?limit=${limit}`);
    };

    BK.getUnreadNotificationCount = async function () {
        return this.request('/notifications/unread-count');
    };

    BK.markNotificationRead = async function (id) {
        return this.request(`/notifications/${id}/read`, { method: 'POST' });
    };

    BK.markAllNotificationsRead = async function () {
        return this.request('/notifications/read-all', { method: 'POST' });
    };

    // -------------------------------------------------------------
    // Nav injector: adds Feed / My Network / Messages + notification bell
    // to the existing .nav-links bar without touching auth-profile.js.
    // Safe to call multiple times; it de-dupes on class name.
    // -------------------------------------------------------------
    BK.injectSocialNav = function () {
        const navLinks = document.querySelector('.nav-links');
        if (!navLinks || !this.isAuthenticated()) return;
        if (navLinks.querySelector('.social-nav-item')) return; // already injected

        const homeLink = navLinks.querySelector('a[href="index.html"], a[href="/"]');
        const snippet = document.createElement('div');
        snippet.style.display = 'contents';
        snippet.innerHTML = `
            <a href="feed.html" class="social-nav-item">Feed</a>
            <a href="network.html" class="social-nav-item">My Network</a>
            <a href="messages.html" class="social-nav-item">Messaging</a>
            <a href="javascript:void(0)" id="bkNotifBell" class="social-nav-item bk-notif-bell" title="Notifications">
                🔔<span id="bkNotifBadge" class="bk-notif-badge" style="display:none;">0</span>
            </a>
        `;
        if (homeLink && homeLink.nextSibling) {
            navLinks.insertBefore(snippet, homeLink.nextSibling);
        } else {
            navLinks.insertBefore(snippet, navLinks.firstChild);
        }

        const bell = document.getElementById('bkNotifBell');
        if (bell) {
            bell.addEventListener('click', () => { window.location.href = 'notifications.html'; });
        }

        this.refreshNotifBadge();
        setInterval(() => this.refreshNotifBadge(), 30000);
    };

    BK.refreshNotifBadge = async function () {
        try {
            const { count } = await this.getUnreadNotificationCount();
            const badge = document.getElementById('bkNotifBadge');
            if (!badge) return;
            if (count > 0) {
                badge.style.display = 'inline-flex';
                badge.textContent = count > 9 ? '9+' : String(count);
            } else {
                badge.style.display = 'none';
            }
        } catch (e) { /* silent — non-critical */ }
    };

    document.addEventListener('DOMContentLoaded', () => {
        BK.injectSocialNav();
    });
})();
