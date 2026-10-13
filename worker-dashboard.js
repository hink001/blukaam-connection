(async () => {
    const { esc, fmtDate, fmtTime, money, api, post, toast, statusPill, empty, guarded, modal, confirmBox } = MK;
    let ctx = await MK.boot('Worker');
    if (!ctx) return;
    const reloadCtx = async () => { ctx = await api('/dashboard/context'); };

    const jobCard = (j) => `<div class="mk-item"><div class="mk-row"><h4 style="flex:1">${esc(j.title)}</h4>${j.myApplicationStatus ? statusPill(j.myApplicationStatus) : ''}</div>
        <div class="mk-muted">${esc(j.contractorName)}${j.contractorVerified ? ' · ✔ verified' : ' · unverified'} · 📍 ${esc(j.location?.city || '—')} · ${money(j.wage, j.wageType)} · ${j.vacanciesRemaining} of ${j.workersRequired} vacancies</div>
        <div class="mk-tags">${(j.skills || []).map(s => `<span>${esc(s)}</span>`).join('')}</div>
        <button class="mk-btn sm" data-view="${esc(j._id)}">View details</button></div>`;

    async function showJob(id) {
        const j = await api('/jobs/' + id);
        const applied = j.myApplicationStatus && j.myApplicationStatus !== 'withdrawn';
        const m = modal(`<h3>${esc(j.title)}</h3><div class="mk-muted">${esc(j.contractorName)}${j.contractorVerified ? ' · ✔ verified' : ' · unverified'}</div>
          <p>${esc(j.description) || '<i>No description.</i>'}</p>
          <div class="mk-tags">${(j.skills || []).map(s => `<span>${esc(s)}</span>`).join('')}</div>
          <ul class="mk-muted"><li>Location: ${esc(j.location?.city || '—')}, ${esc(j.location?.state || '')}</li><li>Wage: ${money(j.wage, j.wageType)} ${esc(j.paymentFrequency)}</li>
          <li>Workers required: ${j.workersRequired} (${j.vacanciesRemaining} open)</li><li>Experience: ${j.experienceYears}+ years</li><li>Start: ${fmtDate(j.startDate)} · Duration: ${esc(j.duration) || '—'}</li>
          <li>Schedule: ${esc(j.schedule) || '—'}</li><li>Apply by: ${fmtDate(j.applicationDeadline)}</li></ul>
          ${j.additionalRequirements ? `<p class="mk-muted">${esc(j.additionalRequirements)}</p>` : ''}
          ${applied ? `<p>Your application status: ${statusPill(j.myApplicationStatus)}</p>` : `<label class="mk-form" style="display:block"><textarea id="note" rows="2" maxlength="1000" placeholder="Short note to the contractor (optional)" style="width:100%"></textarea></label><button class="mk-btn" id="apply" ${j.status !== 'active' ? 'disabled' : ''}>Apply for this job</button>`}
          <button class="mk-btn ghost" id="close" style="margin-left:6px">Close</button>`);
        m.querySelector('#close').onclick = () => m.remove();
        const ap = m.querySelector('#apply');
        if (ap) ap.onclick = () => guarded(ap, async () => { await post(`/applications/jobs/${id}/apply`, { coverNote: m.querySelector('#note').value }); toast('Application submitted!'); m.remove(); go('jobs'); MK.refreshBadges(); });
    }

    let jobPage = 1;
    async function renderJobs(main) {
        const f = JSON.parse(sessionStorage.getItem('wjf') || '{}');
        main.innerHTML = `<div class="mk-card"><h2>Find jobs</h2>
          <form class="mk-filters" id="jf"><input name="q" placeholder="Job title or keyword" value="${esc(f.q || '')}"><input name="skill" placeholder="Skill" value="${esc(f.skill || '')}"><input name="city" placeholder="City" value="${esc(f.city || '')}">
          <input name="minWage" type="number" min="0" placeholder="Min wage" style="width:110px" value="${esc(f.minWage || '')}"><input name="maxWage" type="number" min="0" placeholder="Max wage" style="width:110px" value="${esc(f.maxWage || '')}">
          <select name="wageType"><option value="">Daily or monthly</option><option value="daily" ${f.wageType === 'daily' ? 'selected' : ''}>Daily</option><option value="monthly" ${f.wageType === 'monthly' ? 'selected' : ''}>Monthly</option></select>
          <input name="maxExperience" type="number" min="0" placeholder="My experience (yrs)" style="width:150px" value="${esc(f.maxExperience || '')}">
          <select name="sort"><option value="newest">Newest</option><option value="wage_high" ${f.sort === 'wage_high' ? 'selected' : ''}>Highest wage</option></select>
          <button class="mk-btn" type="submit">Search</button><button class="mk-btn ghost" type="button" id="reset">Reset</button></form><div id="jl">${MK.loading}</div></div>`;
        const load = async () => {
            const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')), page: jobPage, limit: 8 });
            const r = await api('/jobs?' + qs);
            const jl = main.querySelector('#jl');
            jl.innerHTML = (r.jobs.length ? r.jobs.map(jobCard).join('') : empty('No jobs match your search yet. Try fewer filters.')) +
                (r.totalPages > 1 ? `<div class="mk-row"><button class="mk-btn ghost sm" id="prev" ${r.page <= 1 ? 'disabled' : ''}>← Prev</button><span class="mk-muted">Page ${r.page} of ${r.totalPages} (${r.total} jobs)</span><button class="mk-btn ghost sm" id="next" ${r.page >= r.totalPages ? 'disabled' : ''}>Next →</button></div>` : '');
            jl.querySelectorAll('[data-view]').forEach(b => b.onclick = () => showJob(b.dataset.view).catch(e => toast(e.message, 'error')));
            const pv = jl.querySelector('#prev'), nx = jl.querySelector('#next');
            if (pv) pv.onclick = () => { jobPage--; load(); }; if (nx) nx.onclick = () => { jobPage++; load(); };
        };
        main.querySelector('#jf').onsubmit = (e) => { e.preventDefault(); Object.assign(f, Object.fromEntries(new FormData(e.target).entries())); sessionStorage.setItem('wjf', JSON.stringify(f)); jobPage = 1; load(); };
        main.querySelector('#reset').onclick = () => { sessionStorage.removeItem('wjf'); jobPage = 1; renderJobs(main); };
        await load();
    }

    async function renderApplications(main) {
        const st = main.dataset.st || '';
        const r = await api('/applications/mine?limit=50' + (st ? '&status=' + st : ''));
        main.innerHTML = `<div class="mk-card"><h2>My applications</h2>
          <div class="mk-filters"><select id="stf">${['', 'pending', 'shortlisted', 'offer_sent', 'accepted', 'rejected', 'withdrawn', 'cancelled'].map(s => `<option value="${s}" ${s === st ? 'selected' : ''}>${s ? s.replace('_', ' ') : 'All statuses'}</option>`).join('')}</select></div>
          ${r.applications.length ? r.applications.map(a => `<div class="mk-item"><div class="mk-row"><h4 style="flex:1">${esc(a.job?.title || 'Job removed')}</h4>${statusPill(a.status)}</div>
            <div class="mk-muted">${esc(a.job?.contractorName || '')} · applied ${fmtDate(a.createdAt)}</div>
            ${['pending', 'shortlisted', 'offer_sent'].includes(a.status) ? `<button class="mk-btn danger sm" data-wd="${esc(a._id)}">Withdraw</button>` : ''}</div>`).join('') : empty('You have not applied to any jobs yet. Use "Find jobs" to get started.')}</div>`;
        main.querySelector('#stf').onchange = (e) => { main.dataset.st = e.target.value; renderApplications(main); };
        main.querySelectorAll('[data-wd]').forEach(b => b.onclick = async () => { if (await confirmBox('Withdraw this application?')) guarded(b, async () => { await post(`/applications/${b.dataset.wd}/withdraw`); toast('Application withdrawn'); renderApplications(main); }); });
    }

    async function renderOffers(main) {
        const offers = await api('/offers/mine');
        const now = Date.now();
        main.innerHTML = `<div class="mk-card"><h2>My offers</h2>${offers.length ? offers.map(o => {
            const live = o.status === 'pending' && new Date(o.expiresAt) > now;
            return `<div class="mk-item"><div class="mk-row"><h4 style="flex:1">${esc(o.job?.title || 'Job')}</h4>${statusPill(o.status === 'pending' && !live ? 'expired' : o.status)}</div>
              <div class="mk-muted">${esc(o.job?.contractorName || '')} · ${money(o.wage, o.wageType)} · start ${fmtDate(o.startDate)} · respond by ${fmtTime(o.expiresAt)}</div>
              ${o.message ? `<p>${esc(o.message)}</p>` : ''}
              ${live ? `<div class="mk-row"><button class="mk-btn sm" data-acc="${esc(o._id)}">Accept offer</button><button class="mk-btn ghost sm" data-dec="${esc(o._id)}">Decline</button></div>` : ''}</div>`;
        }).join('') : empty('No offers yet. Contractors will send offers after reviewing your applications.')}</div>`;
        main.querySelectorAll('[data-acc]').forEach(b => b.onclick = async () => { if (await confirmBox('Accept this offer and confirm the job?')) guarded(b, async () => { await post(`/offers/${b.dataset.acc}/accept`); toast('Offer accepted — you are hired!'); renderOffers(main); MK.refreshBadges(); }); });
        main.querySelectorAll('[data-dec]').forEach(b => b.onclick = async () => { if (await confirmBox('Decline this offer?')) guarded(b, async () => { await post(`/offers/${b.dataset.dec}/decline`); toast('Offer declined'); renderOffers(main); }); });
    }

    async function renderOverview(main) {
        const [s, rec] = await Promise.all([api('/dashboard/summary'), api('/dashboard/recommended')]);
        const a = s.applications || {}; const total = Object.values(a).reduce((x, y) => x + y, 0);
        main.innerHTML = `<div class="mk-card"><h2>Welcome, ${esc((ctx.profile?.fullName || '').split(' ')[0] || 'Worker')} 👋</h2>
          <div class="mk-muted">Profile ${ctx.profileCompletion.pct}% complete${ctx.profileCompletion.pct < 100 ? ' — <a href="#profile">finish your profile</a> to get better matches' : ''}</div></div>
          <div class="mk-grid" style="margin-bottom:16px"><div class="mk-stat"><b>${total}</b><span>Applications</span></div><div class="mk-stat"><b>${a.shortlisted || 0}</b><span>Shortlisted</span></div>
          <div class="mk-stat"><b>${s.pendingOffers}</b><span>Pending offers</span></div><div class="mk-stat"><b>${s.unreadNotifications}</b><span>Unread notifications</span></div><div class="mk-stat"><b>${s.unreadMessages}</b><span>Unread messages</span></div></div>
          <div class="mk-card"><h3>Recommended for you</h3>${rec.length ? rec.map(j => `<div class="mk-item"><h4>${esc(j.title)}</h4><div class="mk-muted">${esc(j.contractorName)} · ${esc(j.location?.city || '')} · ${money(j.wage, j.wageType)}</div></div>`).join('') + '<a class="mk-btn sm" href="#jobs">See all jobs</a>' : empty('No jobs posted yet. Check back soon.')}</div>`;
    }

    const go = await MK.shell(ctx, [
        { id: 'overview', label: 'Overview', render: renderOverview },
        { id: 'jobs', label: 'Find jobs', render: renderJobs },
        { id: 'applications', label: 'My applications', render: renderApplications },
        { id: 'offers', label: 'My offers', render: renderOffers },
        { id: 'profile', label: 'My profile', render: async (m) => { await reloadCtx(); MK.profileForm(m, ctx, [
            { k: 'fullName', label: 'Full name' }, { k: 'headline', label: 'Headline' }, { k: 'city', label: 'City' }, { k: 'state', label: 'State' }, { k: 'serviceArea', label: 'Service area' },
            { k: 'skills', label: 'Skills (comma separated)', list: true }, { k: 'experienceYears', label: 'Years of experience', type: 'number', min: 0 },
            { k: 'expectedWage', label: 'Expected wage (₹)', type: 'number', min: 0 }, { k: 'wageType', label: 'Wage type', type: 'select', options: ['daily', 'monthly', 'negotiable'] },
            { k: 'availability', label: 'Availability', type: 'select', options: ['Available', 'Busy', 'On Job', 'Not Looking'] }, { k: 'languages', label: 'Languages (comma separated)', list: true },
            { k: 'bio', label: 'About you', type: 'textarea' }], 'My profile', () => go('profile')); } },
        { id: 'notifications', label: 'Notifications', render: MK.renderNotifications },
        { id: 'messages', label: 'Messages', render: MK.renderMessages },
        { id: 'settings', label: 'Settings', render: MK.renderSettings }
    ], 'Worker');
})();
