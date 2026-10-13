/* Shared shell for the role dashboards. Requires auth-profile.js (BluKaamAuth). */
const MK = (() => {
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const fmtTime = (d) => d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    const money = (n, t) => `₹${Number(n).toLocaleString('en-IN')}/${t === 'monthly' ? 'month' : 'day'}`;
    const api = (path, opts) => BluKaamAuth.request(path, opts);
    const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });
    const toast = (m, t) => BluKaamAuth.showToast(esc(m), t);
    const statusPill = (s) => `<span class="mk-status ${esc(s)}">${esc(String(s).replace('_', ' '))}</span>`;
    const empty = (m) => `<div class="mk-empty">${esc(m)}</div>`;
    const loading = '<div class="mk-empty">Loading…</div>';

    // run an action once at a time (prevents double submits)
    async function guarded(btn, fn) {
        if (btn.disabled) return;
        btn.disabled = true;
        try { return await fn(); }
        catch (e) { toast(e.message || 'Something went wrong', 'error'); }
        finally { btn.disabled = false; }
    }

    function modal(html) {
        const bg = document.createElement('div');
        bg.className = 'mk-modal-bg';
        bg.innerHTML = `<div class="mk-modal" role="dialog" aria-modal="true">${html}</div>`;
        bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
        document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { bg.remove(); document.removeEventListener('keydown', onKey); } });
        document.body.appendChild(bg);
        return bg;
    }
    const confirmBox = (msg) => new Promise((resolve) => {
        const m = modal(`<p>${esc(msg)}</p><div class="mk-row"><button class="mk-btn danger" id="mkYes">Yes, continue</button><button class="mk-btn ghost" id="mkNo">Cancel</button></div>`);
        m.querySelector('#mkYes').onclick = () => { m.remove(); resolve(true); };
        m.querySelector('#mkNo').onclick = () => { m.remove(); resolve(false); };
    });

    // ----- boot: auth + trusted role + correct dashboard -----
    async function boot(expectedRole) {
        if (!BluKaamAuth.requireAuth('login.html')) return null;
        let ctx;
        try { ctx = await api('/dashboard/context'); }
        catch (e) {
            console.warn('Backend context fallback:', e.message);
            const u = BluKaamAuth.getUser() || {};
            const p = BluKaamAuth.getStoredProfile() || {};
            ctx = {
                userId: u.id || u.userId || 'me',
                role: u.role || expectedRole,
                roleConfirmed: true,
                hasProfile: !!(p.fullName || p.name),
                profile: p,
                profileCompletion: { pct: 85, missing: [] }
            };
        }
        if (!ctx.roleConfirmed) ctx = await askRole(ctx);
        if (ctx.role !== expectedRole) {
            location.replace(ctx.role === 'Contractor' ? 'contractor-dashboard.html' : 'worker-dashboard.html');
            return null;
        }
        return ctx;
    }
    function askRole(ctx) {
        return new Promise((resolve) => {
            const m = modal(`<h3>Confirm your account type</h3><p class="mk-muted">We need to know how you use BluKaam. You can do this only once.</p>
              <div class="mk-row"><button class="mk-btn" data-r="Worker" style="background:#2563EB">I am a Worker</button>
              <button class="mk-btn" data-r="Contractor" style="background:#16A34A">I am a Contractor / Business</button></div>`);
            m.querySelectorAll('button').forEach(b => b.onclick = async () => {
                try {
                    const r = await post('/dashboard/confirm-role', { role: b.dataset.r });
                    localStorage.setItem(BluKaamAuth.TOKEN_KEY, r.token);
                    m.remove(); resolve(await api('/dashboard/context'));
                } catch (e) { toast(e.message, 'error'); }
            });
        });
    }

    // ----- shell -----
    function shell(ctx, sections, roleLabel) {
        document.body.innerHTML = `
          <header class="mk-top"><a href="index.html"><img src="logo-emblem.png" alt="BluKaam" onerror="this.style.display='none'"></a>
            <span class="mk-brand">BluKaam Connection</span><span class="mk-role-pill">${esc(roleLabel)}</span><span class="mk-spacer"></span>
            <span class="mk-muted">${esc(ctx.profile?.fullName || '')}</span>
            <button class="mk-btn ghost sm" id="mkLogout">Log out</button></header>
          <div class="mk-layout"><nav class="mk-nav" aria-label="Dashboard">${sections.map(s => `<button data-s="${s.id}">${esc(s.label)}<span class="mk-badge" id="badge-${s.id}" style="display:none"></span></button>`).join('')}</nav>
            <main id="mkMain" aria-live="polite"></main></div>`;
        document.getElementById('mkLogout').onclick = () => BluKaamAuth.logout();
        const go = (id) => {
            const sec = sections.find(s => s.id === id) || sections[0];
            document.querySelectorAll('.mk-nav button').forEach(b => b.classList.toggle('active', b.dataset.s === sec.id));
            history.replaceState(null, '', '#' + sec.id);
            const main = document.getElementById('mkMain'); main.innerHTML = loading;
            Promise.resolve(sec.render(main)).catch(e => { main.innerHTML = `<div class="mk-card mk-err">${esc(e.message || 'Failed to load')}</div>`; });
        };
        document.querySelectorAll('.mk-nav button').forEach(b => b.onclick = () => go(b.dataset.s));
        window.addEventListener('hashchange', () => go(location.hash.slice(1)));
        go(location.hash.slice(1));
        refreshBadges();
        return go;
    }
    async function refreshBadges() {
        try {
            const s = await api('/dashboard/summary');
            const set = (id, n) => { const el = document.getElementById('badge-' + id); if (el) { el.textContent = n; el.style.display = n > 0 ? 'inline' : 'none'; } };
            set('notifications', s.unreadNotifications); set('messages', s.unreadMessages);
            return s;
        } catch (e) { return null; }
    }

    // ----- sections shared by both roles -----
    async function renderNotifications(main) {
        const list = await api('/notifications?limit=50');
        main.innerHTML = `<div class="mk-card"><div class="mk-row"><h2 style="flex:1">Notifications</h2><button class="mk-btn ghost sm" id="readAll">Mark all read</button></div>
          ${list.length ? list.map(n => `<div class="mk-item mk-notif ${n.isRead ? '' : 'unread'}" data-id="${esc(n._id)}" data-link="${esc(n.link || '')}" style="cursor:pointer">${esc(n.message)}<div class="mk-muted">${fmtTime(n.createdAt)}</div></div>`).join('') : empty('No notifications yet.')}</div>`;
        main.querySelector('#readAll').onclick = async (e) => guarded(e.target, async () => { await post('/notifications/read-all'); refreshBadges(); renderNotifications(main); });
        main.querySelectorAll('.mk-notif').forEach(el => el.onclick = async () => {
            await post(`/notifications/${el.dataset.id}/read`).catch(() => {});
            const link = el.dataset.link;
            if (link && link.includes('#') && link.startsWith(location.pathname.split('/').pop())) location.hash = link.split('#')[1];
            else { el.classList.remove('unread'); refreshBadges(); }
        });
    }
    async function renderMessages(main) {
        const convos = await api('/messages/conversations');
        main.innerHTML = `<div class="mk-card"><div class="mk-row"><h2 style="flex:1">Messages</h2><a class="mk-btn sm" href="messages.html">Open full messaging</a></div>
          ${convos.length ? convos.map(c => `<a class="mk-item" style="display:block;text-decoration:none;color:inherit" href="messages.html?to=${encodeURIComponent(c.partnerId)}"><b>${esc(c.name)}</b> ${c.unread ? `<span class="mk-badge">${c.unread}</span>` : ''}<div class="mk-muted">${esc(c.lastMessage)} · ${fmtTime(c.lastAt)}</div></a>`).join('')
            : empty('No conversations yet. You can message a person once you have a job application between you.')}</div>`;
    }
    function renderSettings(main) {
        main.innerHTML = `<div class="mk-card"><h2>Settings</h2><p class="mk-muted">Signed in as ${esc(BluKaamAuth.getUser()?.email || '')}</p>
          <p class="mk-muted">In-app notifications are always on. Email / push notifications are not enabled yet.</p>
          <button class="mk-btn danger" id="lo">Log out securely</button></div>`;
        main.querySelector('#lo').onclick = () => BluKaamAuth.logout();
    }
    // reusable profile form; fields = [{k,label,type,options,full}]
    function profileForm(main, ctx, fields, title, onSaved) {
        const p = ctx.profile || {};
        const get = (k) => k === 'city' ? (p.location?.city || p.city || '') : k === 'state' ? (p.location?.state || p.state || '') : Array.isArray(p[k]) ? p[k].join(', ') : (p[k] ?? '');
        const field = (f) => f.type === 'textarea' ? `<label class="full">${esc(f.label)}<textarea name="${f.k}" rows="3">${esc(get(f.k))}</textarea></label>`
            : f.type === 'select' ? `<label>${esc(f.label)}<select name="${f.k}">${f.options.map(o => `<option ${get(f.k) === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`
            : `<label>${esc(f.label)}<input name="${f.k}" type="${f.type || 'text'}" value="${esc(get(f.k))}" ${f.min !== undefined ? `min="${f.min}"` : ''}></label>`;
        main.innerHTML = `<div class="mk-card"><h2>${esc(title)}</h2>
          <div class="mk-row" style="margin-bottom:12px"><img src="${esc(p.avatarUrl || 'logo-emblem.png')}" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover" onerror="this.src='logo-emblem.png'">
            <label class="mk-btn ghost sm">Change photo<input type="file" id="photo" accept="image/png,image/jpeg,image/webp" hidden></label></div>
          <form class="mk-form" id="pf">${fields.map(field).join('')}<div class="full"><button class="mk-btn" type="submit">Save profile</button></div></form>
          <div class="mk-muted" style="margin-top:8px">Profile completion: <b>${ctx.profileCompletion.pct}%</b>${ctx.profileCompletion.missing.length ? ' · missing: ' + esc(ctx.profileCompletion.missing.join(', ')) : ''}</div></div>`;
        main.querySelector('#photo').onchange = async (e) => {
            const f = e.target.files[0]; if (!f) return;
            if (f.size > 5 * 1024 * 1024) return toast('Photo must be under 5 MB', 'error');
            try { await BluKaamAuth.uploadAvatar(f); toast('Photo updated'); onSaved(); } catch (err) { toast(err.message, 'error'); }
        };
        main.querySelector('#pf').onsubmit = async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            await guarded(btn, async () => {
                const fd = Object.fromEntries(new FormData(e.target).entries());
                const updates = { location: { city: fd.city || '', state: fd.state || '' } };
                fields.forEach(f => {
                    if (f.k === 'city' || f.k === 'state') return;
                    let v = fd[f.k];
                    if (f.list) v = String(v || '').split(',').map(x => x.trim()).filter(Boolean);
                    if (f.type === 'number') v = Number(v || 0);
                    updates[f.k] = v;
                });
                await BluKaamAuth.updateMyProfile(updates);
                toast('Profile saved'); onSaved();
            });
        };
    }
    return { esc, fmtDate, fmtTime, money, api, post, toast, statusPill, empty, loading, guarded, modal, confirmBox, boot, shell, refreshBadges, renderNotifications, renderMessages, renderSettings, profileForm };
})();
