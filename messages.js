/* Messaging page logic — requires auth-profile.js + social-sdk.js loaded first */

const myUser = BluKaamAuth.getUser() || {};
const myId = myUser.id || myUser._id;
let activePartnerId = null;
let pollTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (!BluKaamAuth.requireAuth('login.html')) return;
    await loadConversations();

    // Support deep-linking from network.html ("Message" button): messages.html?to=USER_ID
    const params = new URLSearchParams(window.location.search);
    const target = params.get('to');
    if (target) openThread(target, null, null);
});

function toggleMenu() { document.getElementById('mobileMenu').classList.toggle('open'); }

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

async function loadConversations() {
    const list = document.getElementById('chatList');
    try {
        const convos = await BluKaamAuth.getConversations();
        if (!convos.length) {
            list.innerHTML = '<div style="padding:16px; color:var(--gray-500); font-size:13.5px;">No conversations yet. Message a connection from My Network.</div>';
            return;
        }
        list.innerHTML = convos.map(c => `
            <div class="chat-list-item" id="convo-${c.partnerId}" onclick="openThread('${c.partnerId}', '${escapeHtml(c.name)}', '${c.avatar || ''}')">
                <img src="${c.avatar || 'logo-emblem.png'}" onerror="this.src='logo-emblem.png'">
                <div style="flex:1; min-width:0;">
                    <div class="chat-list-name">${escapeHtml(c.name)}</div>
                    <div class="chat-list-preview">${escapeHtml(c.lastMessage)}</div>
                </div>
                ${c.unread > 0 ? `<span class="bk-notif-badge" style="position:static;">${c.unread}</span>` : ''}
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<div style="padding:16px; color:var(--gray-500);">Failed to load conversations.</div>';
    }
}

async function openThread(partnerId, name, avatar) {
    activePartnerId = partnerId;
    document.querySelectorAll('.chat-list-item').forEach(el => el.classList.remove('active'));
    const activeEl = document.getElementById(`convo-${partnerId}`);
    if (activeEl) activeEl.classList.add('active');

    document.getElementById('chatEmptyState').style.display = 'none';
    document.getElementById('chatActiveThread').style.display = 'flex';
    document.getElementById('chatThreadHeader').textContent = name || 'Conversation';

    await renderThread();
    await BluKaamAuth.markThreadRead(partnerId);

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(renderThread, 5000);
}

async function renderThread() {
    if (!activePartnerId) return;
    try {
        const messages = await BluKaamAuth.getThread(activePartnerId);
        const box = document.getElementById('chatThreadMessages');
        const wasNearBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
        box.innerHTML = messages.map(m => `
            <div class="chat-bubble ${String(m.senderId) === String(myId) ? 'mine' : 'theirs'}">${escapeHtml(m.text)}</div>
        `).join('');
        if (wasNearBottom) box.scrollTop = box.scrollHeight;
    } catch (e) {
        BluKaamAuth.showToast(e.message || 'Failed to load conversation', 'error');
    }
}

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || !activePartnerId) return;
    input.value = '';
    try {
        await BluKaamAuth.sendMessage(activePartnerId, text);
        await renderThread();
        loadConversations();
    } catch (e) {
        BluKaamAuth.showToast(e.message || 'Failed to send message. You may need to connect with this person first.', 'error');
    }
}
