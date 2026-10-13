(async () => {
    const { esc, fmtDate, fmtTime, money, api, post, toast, statusPill, empty, guarded, modal, confirmBox } = MK;
    let ctx = await MK.boot('Contractor');
    if (!ctx) return;
    const reloadCtx = async () => { ctx = await api('/dashboard/context'); };

    async function renderOverview(main) {
        const s = await api('/dashboard/summary');
        const stat = (n, l) => `<div class="mk-stat"><b>${n}</b><span>${l}</span></div>`;
        main.innerHTML = `<div class="mk-card"><h2>Welcome, ${esc(ctx.profile?.companyName || ctx.profile?.fullName || 'Contractor')}</h2>
          <div class="mk-muted">Profile ${ctx.profileCompletion.pct}% complete · ${ctx.profile?.isVerified ? '✔ Verified' : 'Unverified account'}</div></div>
          <div class="mk-grid" style="margin-bottom:16px">${stat(s.jobs.active, 'Active jobs')}${stat(s.jobs.paused, 'Paused')}${stat(s.jobs.closed + s.jobs.filled, 'Closed / filled')}${stat(s.applications.total, 'Total applications')}
          ${stat(s.applications.pending, 'Pending decisions')}${stat(s.applications.shortlisted, 'Shortlisted')}${stat(s.offersAwaiting, 'Offers awaiting reply')}${stat(s.confirmedHires, 'Confirmed hires')}${stat(s.unreadNotifications, 'Unread notifications')}${stat(s.unreadMessages, 'Unread messages')}</div>
          <div class="mk-card"><button class="mk-btn" onclick="location.hash='post'">+ Post a new job</button></div>`;
    }

    const J = (j, k, d = '') => j && j[k] !== undefined && j[k] !== null ? j[k] : d;
    async function renderPost(main, job) {
        const edit = !!job; const d = (x) => x ? new Date(x).toISOString().slice(0, 10) : '';
        main.innerHTML = `<div class="mk-card"><h2>${edit ? 'Edit job' : 'Post a job'}</h2><form class="mk-form" id="jobf">
          <label class="full">Job title *<input name="title" required maxlength="120" value="${esc(J(job, 'title'))}"></label>
          <label class="full">Description<textarea name="description" rows="3">${esc(J(job, 'description'))}</textarea></label>
          <label>Required skills * (comma separated)<input name="skills" required value="${esc((job?.skills || []).join(', '))}"></label>
          <label>Work category<input name="category" value="${esc(J(job, 'category'))}"></label>
          <label>City<input name="city" value="${esc(job?.location?.city || ctx.profile?.location?.city || '')}"></label>
          <label>State<input name="state" value="${esc(job?.location?.state || ctx.profile?.location?.state || '')}"></label>
          <label class="full">Site address<input name="address" value="${esc(job?.location?.address || '')}"></label>
          <label>Workers required *<input name="workersRequired" type="number" min="1" step="1" required value="${esc(J(job, 'workersRequired', 1))}"></label>
          <label>Wage (₹) *<input name="wage" type="number" min="1" required value="${esc(J(job, 'wage'))}"></label>
          <label>Wage type *<select name="wageType"><option value="daily" ${job?.wageType === 'daily' ? 'selected' : ''}>Daily</option><option value="monthly" ${job?.wageType === 'monthly' ? 'selected' : ''}>Monthly</option></select></label>
          <label>Payment frequency<input name="paymentFrequency" placeholder="e.g. weekly" value="${esc(J(job, 'paymentFrequency'))}"></label>
          <label>Experience required (years)<input name="experienceYears" type="number" min="0" value="${esc(J(job, 'experienceYears', 0))}"></label>
          <label>Start date<input name="startDate" type="date" value="${d(job?.startDate)}"></label>
          <label>Estimated duration<input name="duration" placeholder="e.g. 2 months" value="${esc(J(job, 'duration'))}"></label>
          <label>Work schedule<input name="schedule" placeholder="e.g. 8am–5pm" value="${esc(J(job, 'schedule'))}"></label>
          <label>Application deadline<input name="applicationDeadline" type="date" value="${d(job?.applicationDeadline)}"></label>
          <label class="full">Additional requirements<textarea name="additionalRequirements" rows="2">${esc(J(job, 'additionalRequirements'))}</textarea></label>
          <div class="full mk-row"><button class="mk-btn" type="submit">${edit ? 'Save changes' : 'Publish job'}</button>${edit ? '' : '<button class="mk-btn ghost" type="button" id="draft">Save as draft</button>'}</div><div class="mk-err full" id="err"></div></form></div>`;
        const submit = (asDraft) => async (e) => {
            e && e.preventDefault && e.preventDefault();
            const form = main.querySelector('#jobf'); if (!form.reportValidity()) return;
            const fd = Object.fromEntries(new FormData(form).entries());
            const body = { title: fd.title, description: fd.description, skills: fd.skills, category: fd.category, workersRequired: Number(fd.workersRequired), wage: Number(fd.wage), wageType: fd.wageType,
                paymentFrequency: fd.paymentFrequency, experienceYears: Number(fd.experienceYears || 0), startDate: fd.startDate || undefined, duration: fd.duration, schedule: fd.schedule,
                applicationDeadline: fd.applicationDeadline || undefined, additionalRequirements: fd.additionalRequirements, location: { city: fd.city, state: fd.state, address: fd.address } };
            if (asDraft) body.saveAsDraft = true;
            const btn = e.target.tagName === 'BUTTON' ? e.target : form.querySelector('button[type=submit]');
            await guarded(btn, async () => {
                try { await api(edit ? '/jobs/' + job._id : '/jobs', { method: edit ? 'PUT' : 'POST', body: JSON.stringify(body) }); toast(edit ? 'Job updated' : asDraft ? 'Draft saved' : 'Job published!'); location.hash = 'jobs'; go('jobs'); }
                catch (err) { main.querySelector('#err').textContent = err.message; }
            });
        };
        main.querySelector('#jobf').onsubmit = submit(false);
        const dr = main.querySelector('#draft'); if (dr) dr.onclick = submit(true);
    }

    async function renderJobs(main) {
        const jobs = await api('/jobs/mine');
        main.innerHTML = `<div class="mk-card"><div class="mk-row"><h2 style="flex:1">My jobs</h2><button class="mk-btn sm" onclick="location.hash='post'">+ Post a job</button></div>
          ${jobs.length ? jobs.map(j => `<div class="mk-item"><div class="mk-row"><h4 style="flex:1">${esc(j.title)}</h4>${statusPill(j.status)}</div>
            <div class="mk-muted">📍 ${esc(j.location?.city || '—')} · ${money(j.wage, j.wageType)} · hired ${j.hiredCount}/${j.workersRequired} · remaining ${Math.max(0, j.workersRequired - j.hiredCount)} · ${j.applicationCount} applicant(s)</div>
            <div class="mk-row" style="margin-top:8px"><button class="mk-btn sm" data-app="${esc(j._id)}">View applicants</button>
            ${!['closed', 'cancelled'].includes(j.status) ? `<button class="mk-btn ghost sm" data-edit="${esc(j._id)}">Edit</button>` : ''}
            ${j.status === 'draft' ? `<button class="mk-btn ghost sm" data-act="publish" data-id="${esc(j._id)}">Publish</button>` : ''}
            ${j.status === 'active' ? `<button class="mk-btn ghost sm" data-act="pause" data-id="${esc(j._id)}">Pause</button>` : ''}
            ${j.status === 'paused' ? `<button class="mk-btn ghost sm" data-act="resume" data-id="${esc(j._id)}">Resume</button>` : ''}
            ${['active', 'paused', 'filled'].includes(j.status) ? `<button class="mk-btn ghost sm" data-act="close" data-id="${esc(j._id)}">Close</button>` : ''}
            ${['draft', 'active', 'paused', 'filled'].includes(j.status) ? `<button class="mk-btn danger sm" data-act="cancel" data-id="${esc(j._id)}">Cancel job</button>` : ''}</div></div>`).join('') : empty('You have not posted any jobs yet.')}</div>`;
        main.querySelectorAll('[data-app]').forEach(b => b.onclick = () => { sessionStorage.setItem('cjob', b.dataset.app); location.hash = 'applicants'; });
        main.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => { const j = await api('/jobs/' + b.dataset.edit); renderPost(main, j); });
        main.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
            if (['cancel', 'close'].includes(b.dataset.act) && !(await confirmBox(`Really ${b.dataset.act} this job? Workers will be notified.`))) return;
            guarded(b, async () => { await post(`/jobs/${b.dataset.id}/status`, { action: b.dataset.act }); toast('Job updated'); renderJobs(main); });
        });
    }

    async function renderApplicants(main) {
        const jobs = await api('/jobs/mine');
        const f = { jobId: sessionStorage.getItem('cjob') || '', status: main.dataset.st || '', sort: main.dataset.sort || 'newest' };
        const qs = new URLSearchParams({ limit: 50, sort: f.sort }); if (f.jobId) qs.set('jobId', f.jobId); if (f.status) qs.set('status', f.status);
        const r = await api('/applications/received?' + qs);
        main.innerHTML = `<div class="mk-card"><h2>Applicants</h2><div class="mk-filters">
          <select id="fj"><option value="">All jobs</option>${jobs.map(j => `<option value="${esc(j._id)}" ${j._id === f.jobId ? 'selected' : ''}>${esc(j.title)}</option>`).join('')}</select>
          <select id="fs">${['', 'pending', 'shortlisted', 'offer_sent', 'accepted', 'rejected', 'withdrawn', 'cancelled'].map(s => `<option value="${s}" ${s === f.status ? 'selected' : ''}>${s ? s.replace('_', ' ') : 'All statuses'}</option>`).join('')}</select>
          <select id="fo"><option value="newest">Newest first</option><option value="oldest" ${f.sort === 'oldest' ? 'selected' : ''}>Oldest first</option></select></div>
          ${r.applications.length ? r.applications.map(a => { const w = a.worker; return `<div class="mk-item"><div class="mk-row"><img src="${esc(w.avatarUrl || 'logo-emblem.png')}" alt="" style="width:44px;height:44px;border-radius:50%;object-fit:cover" onerror="this.src='logo-emblem.png'">
            <div style="flex:1"><h4 style="margin:0">${esc(w.name)}</h4><div class="mk-muted">${esc(a.job?.title || '')} · applied ${fmtDate(a.createdAt)}</div></div>${statusPill(a.status)}</div>
            <div class="mk-muted">📍 ${esc(w.city)} · ${w.experienceYears} yrs · ${w.expectedWage ? '₹' + w.expectedWage + ' ' + esc(w.wageType) : 'wage not set'} · ${esc(w.availability || '—')}</div>
            <div class="mk-tags">${(w.skills || []).map(s => `<span>${esc(s)}</span>`).join('')}</div>${a.coverNote ? `<p class="mk-muted">“${esc(a.coverNote)}”</p>` : ''}
            <div class="mk-row">${a.status === 'pending' ? `<button class="mk-btn ghost sm" data-sl="${esc(a._id)}">Shortlist</button>` : ''}
            ${['pending', 'shortlisted'].includes(a.status) ? `<button class="mk-btn sm" data-of="${esc(a._id)}" data-jt="${esc(a.job?.title || '')}" data-wn="${esc(w.name)}">Send offer</button><button class="mk-btn danger sm" data-rj="${esc(a._id)}">Reject</button>` : ''}
            <a class="mk-btn ghost sm" href="messages.html?to=${encodeURIComponent(a.workerId)}">Message</a></div></div>`; }).join('') : empty('No applications match. Applications appear here when workers apply to your jobs.')}</div>`;
        main.querySelector('#fj').onchange = (e) => { sessionStorage.setItem('cjob', e.target.value); renderApplicants(main); };
        main.querySelector('#fs').onchange = (e) => { main.dataset.st = e.target.value; renderApplicants(main); };
        main.querySelector('#fo').onchange = (e) => { main.dataset.sort = e.target.value; renderApplicants(main); };
        main.querySelectorAll('[data-sl]').forEach(b => b.onclick = () => guarded(b, async () => { await post(`/applications/${b.dataset.sl}/shortlist`); toast('Shortlisted'); renderApplicants(main); }));
        main.querySelectorAll('[data-rj]').forEach(b => b.onclick = async () => { if (await confirmBox('Reject this applicant?')) guarded(b, async () => { await post(`/applications/${b.dataset.rj}/reject`); toast('Applicant rejected'); renderApplicants(main); }); });
        main.querySelectorAll('[data-of]').forEach(b => b.onclick = () => {
            const m = modal(`<h3>Send offer to ${esc(b.dataset.wn)}</h3><p class="mk-muted">${esc(b.dataset.jt)}</p><form class="mk-form" id="of">
              <label>Response deadline<select name="h"><option value="2">2 hours (urgent)</option><option value="4">4 hours</option><option value="12">12 hours</option><option value="24" selected>24 hours</option><option value="48">48 hours</option><option value="72">72 hours</option></select></label>
              <label class="full">Message (optional)<textarea name="message" rows="2" maxlength="1000"></textarea></label><div class="full mk-row"><button class="mk-btn" type="submit">Send offer</button><button class="mk-btn ghost" type="button" id="x">Cancel</button></div><div class="mk-err full" id="err"></div></form>`);
            m.querySelector('#x').onclick = () => m.remove();
            m.querySelector('#of').onsubmit = (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target).entries());
                guarded(e.target.querySelector('button[type=submit]'), async () => { try { const r = await post(`/offers/applications/${b.dataset.of}`, { expiresInHours: Number(fd.h), message: fd.message }); toast(`Offer sent. ${r.vacanciesLeft} vacancy(ies) left.`); m.remove(); renderApplicants(main); } catch (err) { m.querySelector('#err').textContent = err.message; } }); };
        });
    }

    async function renderOffers(main) {
        const offers = await api('/offers/sent');
        main.innerHTML = `<div class="mk-card"><h2>Offers</h2>${offers.length ? offers.map(o => { const live = o.status === 'pending' && new Date(o.expiresAt) > Date.now();
            return `<div class="mk-item"><div class="mk-row"><h4 style="flex:1">${esc(o.workerName)} — ${esc(o.job?.title || '')}</h4>${statusPill(o.status === 'pending' && !live ? 'expired' : o.status)}</div>
            <div class="mk-muted">${money(o.wage, o.wageType)} · ${o.status === 'pending' ? 'respond by ' + fmtTime(o.expiresAt) : 'updated ' + fmtTime(o.respondedAt || o.updatedAt)}</div>
            ${live ? `<button class="mk-btn danger sm" data-c="${esc(o._id)}">Withdraw offer</button>` : ''}</div>`; }).join('') : empty('No offers sent yet.')}</div>`;
        main.querySelectorAll('[data-c]').forEach(b => b.onclick = async () => { if (await confirmBox('Withdraw this offer? The vacancy will open again.')) guarded(b, async () => { await post(`/offers/${b.dataset.c}/cancel`); toast('Offer withdrawn'); renderOffers(main); }); });
    }

    const go = await MK.shell(ctx, [
        { id: 'overview', label: 'Overview', render: renderOverview },
        { id: 'post', label: 'Post a job', render: (m) => renderPost(m) },
        { id: 'jobs', label: 'My jobs', render: renderJobs },
        { id: 'applicants', label: 'Applicants', render: renderApplicants },
        { id: 'offers', label: 'Offers & hires', render: renderOffers },
        { id: 'profile', label: 'Business profile', render: async (m) => { await reloadCtx(); MK.profileForm(m, ctx, [
            { k: 'companyName', label: 'Business / contractor name' }, { k: 'fullName', label: 'Contact person' }, { k: 'city', label: 'City' }, { k: 'state', label: 'State' },
            { k: 'serviceArea', label: 'Operating area' }, { k: 'workTypes', label: 'Types of work handled (comma separated)', list: true },
            { k: 'workerCategories', label: 'Worker categories needed (comma separated)', list: true }, { k: 'yearsInBusiness', label: 'Years in business', type: 'number', min: 0 },
            { k: 'website', label: 'Website' }, { k: 'bio', label: 'Business description', type: 'textarea' }], 'Business profile', () => go('profile')); } },
        { id: 'notifications', label: 'Notifications', render: MK.renderNotifications },
        { id: 'messages', label: 'Messages', render: MK.renderMessages },
        { id: 'settings', label: 'Settings', render: MK.renderSettings }
    ], 'Contractor');
})();
