/* Messaging page logic — requires auth-profile.js + social-sdk.js loaded first */

const myUser = BluKaamAuth.getUser() || {};
const myId = myUser.id || myUser._id;
let activePartnerId = null;
let pollTimer = null;
let allConversations = [];
let availableProfiles = [];

document.addEventListener('DOMContentLoaded', async () => {
    if (!BluKaamAuth.requireAuth('login.html')) return;
    await loadConversations();

    // Support deep-linking: messages.html?to=USER_ID
    const params = new URLSearchParams(window.location.search);
    const target = params.get('to');
    if (target) {
        await startChatWithUser(target);
    }
});

function toggleMenu() {
    const el = document.getElementById('mobileMenu');
    if (el) el.classList.toggle('open');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// -------------------------------------------------------------
// Load Conversations List
// -------------------------------------------------------------
async function loadConversations() {
    const container = document.getElementById('chatListContainer');
    try {
        allConversations = await BluKaamAuth.getConversations();
        renderConversationList(allConversations);
    } catch (e) {
        console.error('Failed to load conversations:', e);
        container.innerHTML = '<div style="padding:16px; color:var(--gray-500); text-align:center; font-size:13px;">Failed to load conversations.</div>';
    }
}

function renderConversationList(convos) {
    const container = document.getElementById('chatListContainer');
    if (!convos || !convos.length) {
        container.innerHTML = `
            <div style="padding:24px 16px; text-align:center; color:var(--gray-500); font-size:13px;">
                <div style="font-size:24px; margin-bottom:6px;">✉️</div>
                No conversations yet.<br>
                <button onclick="openNewChatModal()" class="btn-new-chat" style="margin-top:10px; font-size:11.5px;">+ Start a Chat</button>
            </div>
        `;
        return;
    }

    container.innerHTML = convos.map(c => `
        <div class="chat-list-item ${String(c.partnerId) === String(activePartnerId) ? 'active' : ''}" 
             id="convo-${c.partnerId}" 
             onclick="openThread('${c.partnerId}', '${escapeHtml(c.name)}', '${c.avatar || ''}')">
            <img src="${c.avatar || 'logo-emblem.png'}" onerror="this.src='logo-emblem.png'" alt="Avatar">
            <div style="flex:1; min-width:0;">
                <div class="chat-list-name">${escapeHtml(c.name)}</div>
                <div class="chat-list-preview">${escapeHtml(c.lastMessage)}</div>
            </div>
            ${c.unread > 0 ? `<span class="bk-notif-badge" style="position:static; margin-left:6px;">${c.unread}</span>` : ''}
        </div>
    `).join('');
}

function filterConversationList(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) {
        renderConversationList(allConversations);
        return;
    }
    const filtered = allConversations.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.lastMessage || '').toLowerCase().includes(q)
    );
    renderConversationList(filtered);
}

// -------------------------------------------------------------
// Open Thread & Render Messages
// -------------------------------------------------------------
async function openThread(partnerId, name, avatar) {
    if (!partnerId) return;
    activePartnerId = partnerId;

    // Highlight active in list
    document.querySelectorAll('.chat-list-item').forEach(el => el.classList.remove('active'));
    const activeEl = document.getElementById(`convo-${partnerId}`);
    if (activeEl) activeEl.classList.add('active');

    document.getElementById('chatEmptyState').style.display = 'none';
    const activePanel = document.getElementById('chatActiveThread');
    activePanel.style.display = 'flex';

    // Populate header
    const nameEl = document.getElementById('threadPartnerName');
    const avatarEl = document.getElementById('threadPartnerAvatar');
    const subtitleEl = document.getElementById('threadPartnerSubtitle');
    const viewProfBtn = document.getElementById('threadViewProfileBtn');

    nameEl.textContent = name || 'Loading member...';
    avatarEl.src = avatar || 'logo-emblem.png';
    viewProfBtn.href = `profile.html?id=${partnerId}`;

    if (!name || name === 'Loading member...') {
        try {
            const p = await BluKaamAuth.getPublicProfile(partnerId);
            const pName = p.fullName || p.name || 'Member';
            nameEl.textContent = pName;
            subtitleEl.textContent = p.headline || p.role || 'BluKaam Member';
            avatarEl.src = p.avatarUrl || 'logo-emblem.png';
        } catch (e) {
            nameEl.textContent = 'BluKaam Member';
        }
    }

    await renderThread();
    await BluKaamAuth.markThreadRead(partnerId).catch(() => {});

    // Polling every 4 seconds for fresh messages
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(renderThread, 4000);
}

async function startChatWithUser(userId) {
    if (!userId || String(userId) === String(myId)) return;
    try {
        const p = await BluKaamAuth.getPublicProfile(userId);
        await openThread(userId, p.fullName || p.name || 'Member', p.avatarUrl || '');
    } catch (e) {
        await openThread(userId, 'Member', '');
    }
}

async function renderThread() {
    if (!activePartnerId) return;
    try {
        const messages = await BluKaamAuth.getThread(activePartnerId);
        const box = document.getElementById('chatThreadMessages');
        if (!box) return;

        const wasNearBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 60;

        if (!messages.length) {
            box.innerHTML = `
                <div style="text-align:center; color:var(--gray-400); font-size:13px; margin:auto;">
                    👋 Say hello to start the conversation!
                </div>
            `;
            return;
        }

        box.innerHTML = messages.map(m => `
            <div class="chat-bubble ${String(m.senderId) === String(myId) ? 'mine' : 'theirs'}">
                ${escapeHtml(m.text)}
                <div style="font-size:10px; opacity:0.75; text-align:right; margin-top:2px;">
                    ${formatMessageTime(m.createdAt)}
                </div>
            </div>
        `).join('');

        if (wasNearBottom || messages.length <= 2) {
            box.scrollTop = box.scrollHeight;
        }
    } catch (e) {
        console.error('Failed to load thread:', e);
    }
}

// -------------------------------------------------------------
// Send Message
// -------------------------------------------------------------
async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || !activePartnerId) return;

    input.value = '';
    const box = document.getElementById('chatThreadMessages');

    // Optimistic UI append
    const tempBubble = document.createElement('div');
    tempBubble.className = 'chat-bubble mine';
    tempBubble.innerHTML = `
        ${escapeHtml(text)}
        <div style="font-size:10px; opacity:0.75; text-align:right; margin-top:2px;">Sending...</div>
    `;
    box.appendChild(tempBubble);
    box.scrollTop = box.scrollHeight;

    try {
        await BluKaamAuth.sendMessage(activePartnerId, text);
        await renderThread();
        await loadConversations();
    } catch (e) {
        BluKaamAuth.showToast(e.message || 'Failed to send message', 'error');
        tempBubble.remove();
    }
}

// -------------------------------------------------------------
// New Chat Modal & User Search
// -------------------------------------------------------------
async function openNewChatModal() {
    const modal = document.getElementById('newChatModal');
    modal.style.display = 'flex';
    document.getElementById('newChatSearchInput').value = '';

    const list = document.getElementById('newChatUserList');
    list.innerHTML = '<div style="text-align:center; color:var(--gray-400); padding:20px;">Loading members & workers...</div>';

    try {
        // Fetch public profiles to browse
        availableProfiles = await BluKaamAuth.listProfiles({});
        // Exclude self
        availableProfiles = availableProfiles.filter(p => {
            const pId = p.userId || p._id || p.id;
            return String(pId) !== String(myId);
        });
        renderNewChatList(availableProfiles);
    } catch (e) {
        list.innerHTML = '<div style="text-align:center; color:var(--gray-400); padding:20px;">Could not load members.</div>';
    }
}

function closeNewChatModal() {
    document.getElementById('newChatModal').style.display = 'none';
}

function handleNewChatSearch(val) {
    const q = (val || '').toLowerCase().trim();
    if (!q) {
        renderNewChatList(availableProfiles);
        return;
    }
    const filtered = availableProfiles.filter(p => {
        const name = (p.fullName || p.name || '').toLowerCase();
        const role = (p.role || '').toLowerCase();
        const trade = (p.workType || p.headline || '').toLowerCase();
        const city = ((p.location && p.location.city) || p.city || '').toLowerCase();
        return name.includes(q) || role.includes(q) || trade.includes(q) || city.includes(q);
    });
    renderNewChatList(filtered);
}

function renderNewChatList(users) {
    const list = document.getElementById('newChatUserList');
    if (!users || !users.length) {
        list.innerHTML = '<div style="text-align:center; color:var(--gray-400); padding:20px;">No matching members found.</div>';
        return;
    }

    list.innerHTML = users.map(u => {
        const uId = u.userId || u._id || u.id;
        const name = u.fullName || u.name || 'Member';
        const headline = u.headline || u.workType || `${u.role || 'Worker'} • ${u.city || 'India'}`;
        const avatar = u.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=0D2F6E&textColor=ffffff`;

        return `
            <div class="user-pick-item" onclick="selectUserForChat('${uId}', '${escapeHtml(name)}', '${avatar}')">
                <img src="${avatar}" class="user-pick-avatar" onerror="this.src='logo-emblem.png'">
                <div class="user-pick-info">
                    <div class="user-pick-name">${escapeHtml(name)}</div>
                    <div class="user-pick-headline">${escapeHtml(headline)}</div>
                </div>
                <button class="btn-connect-sm" style="font-size:11px; padding:4px 10px;">Chat</button>
            </div>
        `;
    }).join('');
}

function selectUserForChat(userId, name, avatar) {
    closeNewChatModal();
    openThread(userId, name, avatar);
}

function formatMessageTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
