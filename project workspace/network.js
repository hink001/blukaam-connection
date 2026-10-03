/* My Network page logic — requires auth-profile.js + social-sdk.js loaded first */

document.addEventListener('DOMContentLoaded', () => {
    if (!BluKaamAuth.requireAuth('login.html')) return;
    loadConnections();
    loadPending();
    loadSent();
    loadSuggestions();
});

function toggleMenu() { document.getElementById('mobileMenu').classList.toggle('open'); }

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
    document.getElementById(`tab-${tab}`).style.display = 'block';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

async function loadConnections() {
    const grid = document.getElementById('connectionsGrid');
    try {
        const list = await BluKaamAuth.getMyConnections();
        if (!list.length) { grid.innerHTML = emptyState('No connections yet. Explore "People You May Know" to get started.'); return; }
        grid.innerHTML = list.map(c => `
            <div class="connection-card">
                <img src="${c.avatar || 'logo-emblem.png'}" onerror="this.src='logo-emblem.png'">
                <div class="name">${escapeHtml(c.name)}</div>
                <div class="meta">Connected</div>
                <div class="connection-card-actions">
                    <a href="messages.html?to=${encodeURIComponent(c.userId)}" class="btn-connect-sm" style="text-decoration:none; display:inline-block;">Message</a>
                    <button class="btn-connect-sm" style="border-color:#dc2626;color:#dc2626;" onclick="removeConn('${c.connectionId}')">Remove</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        grid.innerHTML = emptyState('Failed to load connections.');
    }
}

async function loadPending() {
    const grid = document.getElementById('pendingGrid');
    try {
        const list = await BluKaamAuth.getPendingConnections();
        if (!list.length) { grid.innerHTML = emptyState('No pending invitations.'); return; }
        grid.innerHTML = list.map(c => `
            <div class="connection-card">
                <img src="${c.avatar || 'logo-emblem.png'}" onerror="this.src='logo-emblem.png'">
                <div class="name">${escapeHtml(c.name)}</div>
                <div class="meta">Wants to connect</div>
                <div class="connection-card-actions">
                    <button class="btn-connect-sm" onclick="acceptConn('${c.connectionId}')">Accept</button>
                    <button class="btn-connect-sm" style="border-color:var(--gray-400);color:var(--gray-500);" onclick="rejectConn('${c.connectionId}')">Ignore</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        grid.innerHTML = emptyState('Failed to load invitations.');
    }
}

async function loadSent() {
    const grid = document.getElementById('sentGrid');
    try {
        const list = await BluKaamAuth.getSentConnections();
        if (!list.length) { grid.innerHTML = emptyState('You have no pending sent invitations.'); return; }
        grid.innerHTML = list.map(c => `
            <div class="connection-card">
                <img src="${c.avatar || 'logo-emblem.png'}" onerror="this.src='logo-emblem.png'">
                <div class="name">${escapeHtml(c.name)}</div>
                <div class="meta">Invitation pending</div>
                <div class="connection-card-actions">
                    <button class="btn-connect-sm" style="border-color:var(--gray-400);color:var(--gray-500);" onclick="withdrawConn('${c.connectionId}')">Withdraw</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        grid.innerHTML = emptyState('Failed to load sent invitations.');
    }
}

async function loadSuggestions() {
    const grid = document.getElementById('suggestionsGrid');
    try {
        const list = await BluKaamAuth.getConnectionSuggestions(20);
        if (!list.length) { grid.innerHTML = emptyState('No suggestions available right now.'); return; }
        grid.innerHTML = list.map(s => `
            <div class="connection-card">
                <img src="${s.avatar || 'logo-emblem.png'}" onerror="this.src='logo-emblem.png'">
                <div class="name">${escapeHtml(s.name)}</div>
                <div class="meta">${escapeHtml(s.trade || s.city || 'BluKaam Member')}</div>
                <div class="connection-card-actions">
                    <button class="btn-connect-sm" onclick="sendReq('${s.userId}', this)">Connect</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        grid.innerHTML = emptyState('Failed to load suggestions.');
    }
}

function emptyState(msg) {
    return `<div style="grid-column:1/-1; text-align:center; color:var(--gray-500); padding:30px 0;">${msg}</div>`;
}

async function sendReq(userId, btn) {
    try {
        btn.disabled = true;
        await BluKaamAuth.sendConnectionRequest(userId);
        btn.textContent = 'Pending';
        BluKaamAuth.showToast('Connection request sent!');
        loadSent();
    } catch (e) {
        btn.disabled = false;
        BluKaamAuth.showToast(e.message || 'Failed to send request', 'error');
    }
}

async function acceptConn(id) {
    try {
        await BluKaamAuth.acceptConnection(id);
        BluKaamAuth.showToast('Connection accepted!');
        loadPending(); loadConnections();
    } catch (e) { BluKaamAuth.showToast(e.message || 'Failed to accept', 'error'); }
}

async function rejectConn(id) {
    try {
        await BluKaamAuth.rejectConnection(id);
        loadPending();
    } catch (e) { BluKaamAuth.showToast(e.message || 'Failed to decline', 'error'); }
}

async function withdrawConn(id) {
    try {
        await BluKaamAuth.withdrawConnection(id);
        loadSent();
    } catch (e) { BluKaamAuth.showToast(e.message || 'Failed to withdraw', 'error'); }
}

async function removeConn(id) {
    if (!confirm('Remove this connection?')) return;
    try {
        await BluKaamAuth.removeConnection(id);
        loadConnections();
    } catch (e) { BluKaamAuth.showToast(e.message || 'Failed to remove connection', 'error'); }
}
