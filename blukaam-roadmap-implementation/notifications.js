/* Notifications page logic — requires auth-profile.js + social-sdk.js loaded first */

document.addEventListener('DOMContentLoaded', () => {
    if (!BluKaamAuth.requireAuth('login.html')) return;
    loadNotifications();
});

function toggleMenu() { document.getElementById('mobileMenu').classList.toggle('open'); }

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function timeAgo(dateStr) {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

async function loadNotifications() {
    const list = document.getElementById('notifList');
    try {
        const notifs = await BluKaamAuth.getNotifications(50);
        if (!notifs.length) {
            list.innerHTML = '<div style="padding:30px; text-align:center; color:var(--gray-500);">No notifications yet.</div>';
            return;
        }
        list.innerHTML = notifs.map(n => `
            <div class="notif-item ${n.isRead ? '' : 'unread'}" onclick="openNotif('${n._id}', '${n.link || 'feed.html'}')" style="cursor:pointer;">
                <img src="${n.fromAvatar || 'logo-emblem.png'}" onerror="this.src='logo-emblem.png'">
                <div>
                    <div class="notif-text">${escapeHtml(n.message)}</div>
                    <div class="notif-time">${timeAgo(n.createdAt)}</div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<div style="padding:30px; text-align:center; color:var(--gray-500);">Failed to load notifications.</div>';
    }
}

async function openNotif(id, link) {
    try { await BluKaamAuth.markNotificationRead(id); } catch (e) {}
    window.location.href = link || 'feed.html';
}

async function markAllRead() {
    try {
        await BluKaamAuth.markAllNotificationsRead();
        loadNotifications();
    } catch (e) {
        BluKaamAuth.showToast('Failed to update notifications', 'error');
    }
}
