/* My Network & User Discovery page logic — requires auth-profile.js + social-sdk.js */

const myUser = BluKaamAuth.getUser() || {};
const myId = myUser.id || myUser._id;

let currentDiscoverPage = 1;
let currentDiscoverFilters = {};

document.addEventListener('DOMContentLoaded', () => {
    if (!BluKaamAuth.requireAuth('login.html')) return;
    loadAllNetworkData();

    // Check if query parameter specifies a tab (e.g. network.html?tab=discover)
    const params = new URLSearchParams(window.location.search);
    const activeTab = params.get('tab');
    if (activeTab) {
        switchTab(activeTab);
    }
});

function toggleMenu() {
    const el = document.getElementById('mobileMenu');
    if (el) el.classList.toggle('open');
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
    const panel = document.getElementById(`tab-${tab}`);
    if (panel) panel.style.display = 'block';

    if (tab === 'discover' && !document.getElementById('discoverGrid').dataset.loaded) {
        executeDiscoverSearch(1);
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function emptyState(msg) {
    return `<div style="grid-column:1/-1; text-align:center; color:var(--gray-500); padding:36px 0; font-size:14px;">${msg}</div>`;
}

async function loadAllNetworkData() {
    await Promise.all([
        loadConnections(),
        loadRequests(),
        loadFollowing(),
        loadFollowers()
    ]);
}

// -------------------------------------------------------------
// TAB 1: CONNECTIONS
// -------------------------------------------------------------
async function loadConnections() {
    const grid = document.getElementById('connectionsGrid');
    try {
        const list = await BluKaamAuth.getMyConnections();
        document.getElementById('tabCountConn').textContent = list.length;
        if (!list.length) {
            grid.innerHTML = emptyState('No connections yet. Click "Discover People" to connect with skilled workers and contractors.');
            return;
        }
        grid.innerHTML = list.map(c => `
            <div class="connection-card">
                <img src="${c.avatar || 'logo-emblem.png'}" onerror="this.src='logo-emblem.png'" alt="Avatar">
                <div class="name">${escapeHtml(c.name)}</div>
                <div class="meta" style="color:var(--green); font-weight:700;">● Connected</div>
                <div class="connection-card-actions" style="margin-top:12px; display:flex; gap:6px; justify-content:center; flex-wrap:wrap;">
                    <a href="profile.html?id=${encodeURIComponent(c.userId)}" class="btn-connect-sm" style="text-decoration:none;">Profile</a>
                    <a href="messages.html?to=${encodeURIComponent(c.userId)}" class="btn-connect-sm" style="background:var(--blue-mid); color:#fff; border-color:var(--blue-mid); text-decoration:none;">Message</a>
                    <button class="btn-connect-sm" style="border-color:#dc2626; color:#dc2626;" onclick="removeConn('${c.connectionId}')">Remove</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        grid.innerHTML = emptyState('Failed to load connections.');
    }
}

// -------------------------------------------------------------
// TAB 2: REQUESTS (PENDING & SENT)
// -------------------------------------------------------------
async function loadRequests() {
    const pendingGrid = document.getElementById('pendingGrid');
    const sentGrid = document.getElementById('sentGrid');

    try {
        const [pendingList, sentList] = await Promise.all([
            BluKaamAuth.getPendingConnections(),
            BluKaamAuth.getSentConnections()
        ]);

        document.getElementById('tabCountReq').textContent = pendingList.length;

        // Pending (Received)
        if (!pendingList.length) {
            pendingGrid.innerHTML = emptyState('No incoming connection invitations right now.');
        } else {
            pendingGrid.innerHTML = pendingList.map(c => `
                <div class="connection-card">
                    <img src="${c.avatar || 'logo-emblem.png'}" onerror="this.src='logo-emblem.png'" alt="Avatar">
                    <div class="name">${escapeHtml(c.name)}</div>
                    <div class="meta">Wants to connect with you</div>
                    <div class="connection-card-actions" style="margin-top:12px; display:flex; gap:8px; justify-content:center;">
                        <a href="profile.html?id=${encodeURIComponent(c.userId)}" class="btn-connect-sm" style="text-decoration:none;">View</a>
                        <button class="btn-connect-sm" style="background:var(--blue-mid); color:#fff; border-color:var(--blue-mid);" onclick="acceptConn('${c.connectionId}')">Accept</button>
                        <button class="btn-connect-sm" style="border-color:var(--gray-400); color:var(--gray-500);" onclick="rejectConn('${c.connectionId}')">Ignore</button>
                    </div>
                </div>
            `).join('');
        }

        // Sent
        if (!sentList.length) {
            sentGrid.innerHTML = emptyState('You have no sent invitations pending.');
        } else {
            sentGrid.innerHTML = sentList.map(c => `
                <div class="connection-card">
                    <img src="${c.avatar || 'logo-emblem.png'}" onerror="this.src='logo-emblem.png'" alt="Avatar">
                    <div class="name">${escapeHtml(c.name)}</div>
                    <div class="meta" style="color:var(--amber);">⏳ Invitation pending response</div>
                    <div class="connection-card-actions" style="margin-top:12px; display:flex; gap:8px; justify-content:center;">
                        <a href="profile.html?id=${encodeURIComponent(c.userId)}" class="btn-connect-sm" style="text-decoration:none;">Profile</a>
                        <button class="btn-connect-sm" style="border-color:var(--gray-400); color:var(--gray-500);" onclick="withdrawConn('${c.connectionId}')">Withdraw</button>
                    </div>
                </div>
            `).join('');
        }
    } catch (e) {
        pendingGrid.innerHTML = emptyState('Failed to load invitations.');
    }
}

// -------------------------------------------------------------
// TAB 3: FOLLOWING
// -------------------------------------------------------------
async function loadFollowing() {
    const grid = document.getElementById('followingGrid');
    try {
        const data = await BluKaamAuth.getFollowing(myId, 1, 50);
        const list = data.following || [];
        document.getElementById('tabCountFollowing').textContent = data.total || list.length;
        if (!list.length) {
            grid.innerHTML = emptyState('You are not following anyone yet. Discover and follow workers or contractors!');
            return;
        }
        grid.innerHTML = list.map(u => `
            <div class="connection-card">
                <img src="${u.avatar || 'logo-emblem.png'}" onerror="this.src='logo-emblem.png'" alt="Avatar">
                <div class="name">${escapeHtml(u.name)}</div>
                <div class="meta">${escapeHtml(u.headline || 'BluKaam Member')}</div>
                <div class="connection-card-actions" style="margin-top:12px; display:flex; gap:6px; justify-content:center;">
                    <a href="profile.html?id=${encodeURIComponent(u.userId)}" class="btn-connect-sm" style="text-decoration:none;">Profile</a>
                    <button class="btn-connect-sm" style="border-color:#dc2626; color:#dc2626;" onclick="unfollowFromTab('${u.userId}')">Unfollow</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        grid.innerHTML = emptyState('Failed to load following list.');
    }
}

// -------------------------------------------------------------
// TAB 4: FOLLOWERS
// -------------------------------------------------------------
async function loadFollowers() {
    const grid = document.getElementById('followersGrid');
    try {
        const data = await BluKaamAuth.getFollowers(myId, 1, 50);
        const list = data.followers || [];
        document.getElementById('tabCountFollowers').textContent = data.total || list.length;
        if (!list.length) {
            grid.innerHTML = emptyState('No followers yet. Keep your profile and bio complete to grow your audience!');
            return;
        }
        grid.innerHTML = list.map(u => `
            <div class="connection-card">
                <img src="${u.avatar || 'logo-emblem.png'}" onerror="this.src='logo-emblem.png'" alt="Avatar">
                <div class="name">${escapeHtml(u.name)}</div>
                <div class="meta">${escapeHtml(u.headline || 'BluKaam Member')}</div>
                <div class="connection-card-actions" style="margin-top:12px; display:flex; gap:6px; justify-content:center;">
                    <a href="profile.html?id=${encodeURIComponent(u.userId)}" class="btn-connect-sm" style="text-decoration:none;">Profile</a>
                    <button class="btn-connect-sm" onclick="followFromTab('${u.userId}', this)">+ Follow Back</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        grid.innerHTML = emptyState('Failed to load followers list.');
    }
}

// -------------------------------------------------------------
// TAB 5: DISCOVER PEOPLE (SEARCH + FILTERS + PAGINATION)
// -------------------------------------------------------------
function resetDiscoverFilters() {
    document.getElementById('discSearchInput').value = '';
    document.getElementById('discRoleSelect').value = '';
    document.getElementById('discSkillInput').value = '';
    document.getElementById('discCityInput').value = '';
    document.getElementById('discExpInput').value = '';
    executeDiscoverSearch(1);
}

async function executeDiscoverSearch(page = 1) {
    currentDiscoverPage = page;
    const grid = document.getElementById('discoverGrid');
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:30px; color:var(--gray-500);">Searching members...</div>';
    grid.dataset.loaded = 'true';

    const params = {
        page,
        limit: 12,
        search: document.getElementById('discSearchInput').value.trim(),
        role: document.getElementById('discRoleSelect').value,
        skill: document.getElementById('discSkillInput').value.trim(),
        city: document.getElementById('discCityInput').value.trim(),
        minExp: document.getElementById('discExpInput').value.trim()
    };
    currentDiscoverFilters = params;

    try {
        const res = await BluKaamAuth.discoverUsers(params);
        const users = res.users || [];
        if (!users.length) {
            grid.innerHTML = emptyState('No matching members found. Try changing your search filters.');
            document.getElementById('discoverPagination').innerHTML = '';
            return;
        }

        grid.innerHTML = users.map(u => {
            const skillsHtml = (u.skills || []).slice(0, 3).map(s => `
                <span class="tag" style="font-size:11px; padding:2px 8px;">${escapeHtml(s)}</span>
            `).join('');

            return `
                <div class="connection-card" style="display:flex; flex-direction:column; justify-content:space-between; text-align:center; padding:16px;">
                    <div>
                        <div style="position:relative; display:inline-block;">
                            <img src="${u.avatar}" style="width:64px; height:64px; border-radius:50%; object-fit:cover; margin-bottom:8px; background:var(--gray-100);" alt="Avatar">
                            ${u.isVerified ? `<span style="position:absolute; bottom:6px; right:0; background:var(--blue-mid); color:#fff; border-radius:50%; font-size:10px; width:18px; height:18px; display:flex; align-items:center; justify-content:center;" title="Verified Pro">✓</span>` : ''}
                        </div>
                        <div class="name" style="font-weight:800; font-size:15px; color:var(--gray-800);">${escapeHtml(u.name)}</div>
                        <div class="meta" style="font-size:12px; color:var(--gray-600); margin:2px 0 6px;">${escapeHtml(u.headline)}</div>
                        <div style="font-size:11.5px; color:var(--gray-400); margin-bottom:8px;">
                            📍 ${escapeHtml(u.city)}${u.state ? ', ' + escapeHtml(u.state) : ''} · ⏱️ ${u.experienceYears ? u.experienceYears + ' yrs' : 'Pro'}
                        </div>
                        <div style="display:flex; gap:4px; flex-wrap:wrap; justify-content:center; margin-bottom:12px;">
                            ${skillsHtml}
                        </div>
                    </div>
                    <div style="border-top:1px solid var(--gray-100); padding-top:10px; display:flex; flex-direction:column; gap:6px;">
                        <div style="display:flex; gap:6px; justify-content:center;">
                            <button class="btn-connect-sm" onclick="followFromDiscover('${u.userId}', this)">+ Follow</button>
                            <button class="btn-connect-sm" onclick="connectFromDiscover('${u.userId}', this)">🤝 Connect</button>
                        </div>
                        <div style="display:flex; gap:6px; justify-content:center;">
                            <a href="profile.html?id=${encodeURIComponent(u.userId)}" class="btn-connect-sm" style="flex:1; text-decoration:none; padding:4px 0;">Profile</a>
                            <a href="messages.html?to=${encodeURIComponent(u.userId)}" class="btn-connect-sm" style="flex:1; text-decoration:none; padding:4px 0; background:var(--blue-mid); color:#fff; border-color:var(--blue-mid);">💬 Chat</a>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        renderDiscoverPagination(res.page, res.totalPages);
    } catch (e) {
        console.error('Discover error:', e);
        grid.innerHTML = emptyState('Failed to load members.');
    }
}

function renderDiscoverPagination(page, totalPages) {
    const container = document.getElementById('discoverPagination');
    if (!totalPages || totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = `
        <button class="btn-secondary-li" style="padding:5px 14px; font-size:12px;" ${page <= 1 ? 'disabled' : ''} onclick="executeDiscoverSearch(${page - 1})">
            ← Previous
        </button>
        <span style="font-size:13px; font-weight:700; color:var(--gray-600);">Page ${page} of ${totalPages}</span>
        <button class="btn-secondary-li" style="padding:5px 14px; font-size:12px;" ${page >= totalPages ? 'disabled' : ''} onclick="executeDiscoverSearch(${page + 1})">
            Next →
        </button>
    `;
}

// -------------------------------------------------------------
// Action Handlers
// -------------------------------------------------------------
async function followFromDiscover(userId, btn) {
    try {
        btn.disabled = true;
        await BluKaamAuth.followUser(userId);
        btn.textContent = '✓ Following';
        btn.style.background = 'var(--blue-subtle)';
        btn.style.color = 'var(--blue-mid)';
        BluKaamAuth.showToast('Followed successfully!');
        loadFollowing();
    } catch (e) {
        btn.disabled = false;
        BluKaamAuth.showToast(e.message || 'Failed to follow', 'error');
    }
}

async function connectFromDiscover(userId, btn) {
    try {
        btn.disabled = true;
        await BluKaamAuth.sendConnectionRequest(userId);
        btn.textContent = '⏳ Sent';
        BluKaamAuth.showToast('Connection invitation sent!');
        loadRequests();
    } catch (e) {
        btn.disabled = false;
        BluKaamAuth.showToast(e.message || 'Failed to send request', 'error');
    }
}

async function followFromTab(userId, btn) {
    try {
        btn.disabled = true;
        await BluKaamAuth.followUser(userId);
        btn.textContent = '✓ Following';
        BluKaamAuth.showToast('Following user!');
        loadFollowing();
    } catch (e) {
        btn.disabled = false;
        BluKaamAuth.showToast(e.message || 'Action failed', 'error');
    }
}

async function unfollowFromTab(userId) {
    if (!confirm('Unfollow this user?')) return;
    try {
        await BluKaamAuth.unfollowUser(userId);
        BluKaamAuth.showToast('Unfollowed.');
        loadFollowing();
    } catch (e) {
        BluKaamAuth.showToast(e.message || 'Action failed', 'error');
    }
}

async function acceptConn(id) {
    try {
        await BluKaamAuth.acceptConnection(id);
        BluKaamAuth.showToast('Connection accepted!');
        loadRequests();
        loadConnections();
    } catch (e) {
        BluKaamAuth.showToast(e.message || 'Failed to accept', 'error');
    }
}

async function rejectConn(id) {
    try {
        await BluKaamAuth.rejectConnection(id);
        BluKaamAuth.showToast('Invitation ignored.');
        loadRequests();
    } catch (e) {
        BluKaamAuth.showToast(e.message || 'Failed to decline', 'error');
    }
}

async function withdrawConn(id) {
    try {
        await BluKaamAuth.withdrawConnection(id);
        BluKaamAuth.showToast('Invitation withdrawn.');
        loadRequests();
    } catch (e) {
        BluKaamAuth.showToast(e.message || 'Failed to withdraw', 'error');
    }
}

async function removeConn(id) {
    if (!confirm('Are you sure you want to remove this connection?')) return;
    try {
        await BluKaamAuth.removeConnection(id);
        BluKaamAuth.showToast('Connection removed.');
        loadConnections();
    } catch (e) {
        BluKaamAuth.showToast(e.message || 'Failed to remove connection', 'error');
    }
}
