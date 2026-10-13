// Integration tests. Run: MONGO_TEST_URI=mongodb://127.0.0.1:27017/bk_test npm test
process.env.NODE_ENV = 'test';
process.env.BLUKAAM_NO_LISTEN = '1';
process.env.JWT_SECRET = 'test-secret';
process.env.MONGO_URI = '';          // never connect to a real DB from tests

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const app = require('../server');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Job = require('../models/Job');
const Application = require('../models/Application');
const Offer = require('../models/Offer');
const Notification = require('../models/Notification');
const { expireOffers } = require('../services/offerService');

let server, base;
const tok = (u) => jwt.sign({ userId: String(u._id), email: u.email, role: u.role }, 'test-secret', { expiresIn: '1h' });
const call = async (user, method, path, body) => {
    const r = await fetch(base + path, {
        method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: 'Bearer ' + tok(user) } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
};
const mkUser = async (name, role, extra = {}) => {
    const u = await User.create({ email: `${name.replace(/[^a-z0-9]/gi, "").toLowerCase()}.${Date.now()}${Math.random().toString(36).slice(2, 5)}@t.in`, password: 'secret123', role });
    await Profile.create({ userId: u._id, fullName: name, role, location: { city: 'Meerut', state: 'UP' }, ...extra });
    return u;
};
const jobBody = (o = {}) => ({ title: 'Electrician needed', skills: ['Electrician'], workersRequired: 2, wage: 700, wageType: 'daily', location: { city: 'Meerut', state: 'UP' }, ...o });

test.before(async () => {
    await mongoose.connect(process.env.MONGO_TEST_URI || 'mongodb://127.0.0.1:27017/bk_test', { serverSelectionTimeoutMS: 5000 });
    await mongoose.connection.dropDatabase();
    await Promise.all([Application, Offer, Job, User].map(m => m.syncIndexes()));
    server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await mongoose.disconnect(); });

test('REQUIRED E2E: 1 contractor, 4 workers, 2 electricians', async () => {
    const c = await mkUser('Sharma Builders', 'Contractor', { companyName: 'Sharma Builders' });
    const ws = [];
    for (const n of ['Amit', 'Bunty', 'Chetan', 'Deepak']) ws.push(await mkUser(n, 'Worker', { skills: ['Electrician'], experienceYears: 3 }));

    // role-gated posting
    assert.equal((await call(ws[0], 'POST', '/api/jobs', jobBody())).status, 403);
    const created = await call(c, 'POST', '/api/jobs', jobBody());
    assert.equal(created.status, 201);
    const jobId = created.body.job._id;

    // all four discover it
    for (const w of ws) {
        const r = await call(w, 'GET', '/api/jobs?skill=electric');
        assert.ok(r.body.jobs.some(j => j._id === jobId), 'worker should discover job');
        assert.equal(r.body.jobs[0].contractorId, undefined, 'contractor id must not leak');
    }
    // all four apply; duplicates blocked
    const apps = [];
    for (const w of ws) { const r = await call(w, 'POST', `/api/applications/jobs/${jobId}/apply`, {}); assert.equal(r.status, 201); apps.push(r.body.application); }
    assert.equal((await call(ws[0], 'POST', `/api/applications/jobs/${jobId}/apply`, {})).status, 409);
    const recv = await call(c, 'GET', '/api/applications/received');
    assert.equal(recv.body.total, 4);

    // contractor shortlists, sends 2 offers, 3rd is refused (no vacancy)
    assert.equal((await call(c, 'POST', `/api/applications/${apps[0]._id}/shortlist`)).status, 200);
    assert.equal((await call(c, 'POST', `/api/applications/${apps[1]._id}/shortlist`)).status, 200);
    const o1 = await call(c, 'POST', `/api/offers/applications/${apps[0]._id}`, { expiresInHours: 24 });
    const o2 = await call(c, 'POST', `/api/offers/applications/${apps[1]._id}`, { expiresInHours: 24 });
    assert.equal(o1.status, 201); assert.equal(o2.status, 201);
    assert.equal(o2.body.vacanciesLeft, 0);
    assert.equal((await call(c, 'POST', `/api/offers/applications/${apps[2]._id}`, { expiresInHours: 24 })).status, 409);

    // workers see offers; a non-selected worker sees none; others cannot accept
    assert.equal((await call(ws[0], 'GET', '/api/offers/mine')).body.length, 1);
    assert.equal((await call(ws[2], 'GET', '/api/offers/mine')).body.length, 0);
    assert.equal((await call(ws[2], 'POST', `/api/offers/${o1.body.offer._id}/accept`)).status, 404);

    // both accept
    assert.equal((await call(ws[0], 'POST', `/api/offers/${o1.body.offer._id}/accept`)).status, 200);
    assert.equal((await call(ws[1], 'POST', `/api/offers/${o2.body.offer._id}/accept`)).status, 200);
    assert.equal((await call(ws[0], 'POST', `/api/offers/${o1.body.offer._id}/accept`)).status, 409, 'double accept');

    const job = await Job.findById(jobId).lean();
    assert.equal(job.hiredCount, 2); assert.equal(job.slotsLeft, 0); assert.equal(job.status, 'filled');
    const st = Object.fromEntries((await Application.find({ jobId }).lean()).map(a => [String(a.workerId), a.status]));
    assert.equal(st[String(ws[0]._id)], 'accepted'); assert.equal(st[String(ws[1]._id)], 'accepted');
    assert.equal(st[String(ws[2]._id)], 'pending'); assert.equal(st[String(ws[3]._id)], 'pending');

    // notifications: right recipients, persistent read state, no leakage
    const cn = await call(c, 'GET', '/api/notifications');
    const types = cn.body.map(n => n.type);
    assert.ok(types.includes('application_submitted') && types.includes('offer_accepted') && types.includes('job_filled'));
    const wn = await call(ws[0], 'GET', '/api/notifications');
    assert.ok(wn.body.some(n => n.type === 'offer_received'));
    assert.ok(wn.body.every(n => String(n.userId) === String(ws[0]._id)));
    await call(ws[0], 'POST', `/api/notifications/${wn.body[0]._id}/read`);
    const after = await call(ws[0], 'GET', '/api/notifications/unread-count');
    assert.equal(after.body.count, wn.body.length - 1);

    // summary counts are real
    const sum = await call(c, 'GET', '/api/dashboard/summary');
    assert.equal(sum.body.confirmedHires, 2); assert.equal(sum.body.jobs.filled, 1);
});

test('concurrency: parallel offers on a 1-vacancy job never overbook', async () => {
    const c = await mkUser('RaceCo', 'Contractor');
    const ws = await Promise.all([1, 2, 3, 4, 5].map(i => mkUser('W' + i, 'Worker', { skills: ['Mason'] })));
    const jobId = (await call(c, 'POST', '/api/jobs', jobBody({ title: 'Mason', skills: ['Mason'], workersRequired: 1 }))).body.job._id;
    const apps = [];
    for (const w of ws) apps.push((await call(w, 'POST', `/api/applications/jobs/${jobId}/apply`, {})).body.application);
    const results = await Promise.all(apps.map(a => call(c, 'POST', `/api/offers/applications/${a._id}`, { expiresInHours: 2 })));
    assert.equal(results.filter(r => r.status === 201).length, 1);
    assert.equal((await Job.findById(jobId)).slotsLeft, 0);
});

test('concurrency: same offer accepted twice in parallel -> one hire', async () => {
    const c = await mkUser('RaceCo2', 'Contractor');
    const w = await mkUser('Solo', 'Worker');
    const jobId = (await call(c, 'POST', '/api/jobs', jobBody({ workersRequired: 1 }))).body.job._id;
    const app = (await call(w, 'POST', `/api/applications/jobs/${jobId}/apply`, {})).body.application;
    const offer = (await call(c, 'POST', `/api/offers/applications/${app._id}`, { expiresInHours: 4 })).body.offer;
    const rs = await Promise.all([1, 2, 3, 4].map(() => call(w, 'POST', `/api/offers/${offer._id}/accept`)));
    assert.equal(rs.filter(r => r.status === 200).length, 1);
    assert.equal((await Job.findById(jobId)).hiredCount, 1);
});

test('decline and expiry release the vacancy', async () => {
    const c = await mkUser('ReleaseCo', 'Contractor');
    const [w1, w2] = await Promise.all([mkUser('R1', 'Worker'), mkUser('R2', 'Worker')]);
    const jobId = (await call(c, 'POST', '/api/jobs', jobBody({ workersRequired: 1 }))).body.job._id;
    const a1 = (await call(w1, 'POST', `/api/applications/jobs/${jobId}/apply`, {})).body.application;
    const a2 = (await call(w2, 'POST', `/api/applications/jobs/${jobId}/apply`, {})).body.application;
    const o1 = (await call(c, 'POST', `/api/offers/applications/${a1._id}`, { expiresInHours: 2 })).body.offer;
    assert.equal((await Job.findById(jobId)).slotsLeft, 0);
    assert.equal((await call(w1, 'POST', `/api/offers/${o1._id}/decline`)).status, 200);
    assert.equal((await Job.findById(jobId)).slotsLeft, 1);
    const o2 = (await call(c, 'POST', `/api/offers/applications/${a2._id}`, { expiresInHours: 2 })).body.offer;
    await Offer.updateOne({ _id: o2._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await call(w2, 'POST', `/api/offers/${o2._id}/accept`)).status, 410, 'cannot accept expired');
    assert.equal(await expireOffers() >= 1, true);
    assert.equal((await Job.findById(jobId)).slotsLeft, 1);
    assert.equal((await Application.findById(a2._id)).status, 'shortlisted');
});

test('authorization: cross-contractor and cross-worker access is denied', async () => {
    const [c1, c2] = await Promise.all([mkUser('C1', 'Contractor'), mkUser('C2', 'Contractor')]);
    const [w1, w2] = await Promise.all([mkUser('X1', 'Worker'), mkUser('X2', 'Worker')]);
    const jobId = (await call(c1, 'POST', '/api/jobs', jobBody())).body.job._id;
    const app = (await call(w1, 'POST', `/api/applications/jobs/${jobId}/apply`, {})).body.application;
    assert.equal((await call(c2, 'PUT', `/api/jobs/${jobId}`, { title: 'hacked' })).status, 404);
    assert.equal((await call(c2, 'POST', `/api/jobs/${jobId}/status`, { action: 'close' })).status, 409);
    assert.equal((await call(c2, 'POST', `/api/applications/${app._id}/shortlist`)).status, 409);
    assert.equal((await call(c2, 'POST', `/api/offers/applications/${app._id}`, { expiresInHours: 4 })).status, 404);
    assert.equal((await call(w2, 'POST', `/api/applications/${app._id}/withdraw`)).status, 409);
    assert.equal((await call(w1, 'POST', `/api/applications/${app._id}/shortlist`)).status, 403, 'worker cannot shortlist self');
    assert.equal((await call(null, 'GET', '/api/jobs')).status, 401);
    assert.equal((await call(c2, 'GET', '/api/applications/received')).body.total, 0);
    // role is read from DB, so a token claiming Contractor for a Worker is still a Worker
    const forged = jwt.sign({ userId: String(w1._id), email: w1.email, role: 'Contractor' }, 'test-secret');
    const r = await fetch(base + '/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + forged }, body: JSON.stringify(jobBody()) });
    assert.equal(r.status, 403);
});

test('job validation, lifecycle, deadline, search', async () => {
    const c = await mkUser('ValCo', 'Contractor');
    const w = await mkUser('ValW', 'Worker');
    assert.equal((await call(c, 'POST', '/api/jobs', jobBody({ title: '' }))).status, 400);
    assert.equal((await call(c, 'POST', '/api/jobs', jobBody({ skills: [] }))).status, 400);
    assert.equal((await call(c, 'POST', '/api/jobs', jobBody({ workersRequired: 0 }))).status, 400);
    assert.equal((await call(c, 'POST', '/api/jobs', jobBody({ workersRequired: 1.5 }))).status, 400);
    assert.equal((await call(c, 'POST', '/api/jobs', jobBody({ wage: -5 }))).status, 400);
    assert.equal((await call(c, 'POST', '/api/jobs', jobBody({ applicationDeadline: '2020-01-01' }))).status, 400);
    assert.equal((await call(c, 'POST', '/api/jobs', jobBody({ title: '<script>alert(1)</script>Plumber' }))).body.job.title, 'Plumber', 'sanitised');

    const id = (await call(c, 'POST', '/api/jobs', jobBody({ title: 'Painter wanted', skills: ['Painter'], wage: 500 }))).body.job._id;
    assert.ok((await call(w, 'GET', '/api/jobs?q=painter&minWage=400&maxWage=600&wageType=daily')).body.jobs.some(j => j._id === id));
    assert.ok(!(await call(w, 'GET', '/api/jobs?q=painter&minWage=900')).body.jobs.some(j => j._id === id));
    assert.equal((await call(w, 'GET', '/api/jobs?q=zzzznothing')).body.total, 0);
    await call(c, 'POST', `/api/jobs/${id}/status`, { action: 'pause' });
    assert.ok(!(await call(w, 'GET', '/api/jobs?q=painter')).body.jobs.some(j => j._id === id), 'paused hidden');
    assert.equal((await call(w, 'POST', `/api/applications/jobs/${id}/apply`, {})).status, 409);
    await call(c, 'POST', `/api/jobs/${id}/status`, { action: 'resume' });
    assert.equal((await call(w, 'POST', `/api/applications/jobs/${id}/apply`, {})).status, 201);
    await Job.updateOne({ _id: id }, { $set: { applicationDeadline: new Date(Date.now() - 86400000) } });
    const w2 = await mkUser('Late', 'Worker');
    assert.equal((await call(w2, 'POST', `/api/applications/jobs/${id}/apply`, {})).status, 409, 'deadline passed');
    // withdraw then re-apply
    const mine = (await call(w, 'GET', '/api/applications/mine')).body.applications[0];
    assert.equal((await call(w, 'POST', `/api/applications/${mine._id}/withdraw`)).status, 200);
    // cannot shrink workersRequired below reserved
    const j2 = (await call(c, 'POST', '/api/jobs', jobBody({ workersRequired: 2 }))).body.job._id;
    const a = (await call(w2, 'POST', `/api/applications/jobs/${j2}/apply`, {})).body.application;
    await call(c, 'POST', `/api/offers/applications/${a._id}`, { expiresInHours: 4 });
    assert.equal((await call(c, 'PUT', `/api/jobs/${j2}`, { workersRequired: 0 })).status, 400);
    assert.equal((await call(c, 'PUT', `/api/jobs/${j2}`, { workersRequired: 1 })).status, 200);
    assert.equal((await call(c, 'PUT', `/api/jobs/${j2}`, { workersRequired: 1, ...{} })).status, 200);
});

test('messaging: only related users; role confirmation flow', async () => {
    const c = await mkUser('MsgCo', 'Contractor');
    const [w, stranger] = await Promise.all([mkUser('MsgW', 'Worker'), mkUser('Stranger', 'Worker')]);
    assert.equal((await call(w, 'POST', `/api/messages/send/${c._id}`, { text: 'hi' })).status, 403, 'no relationship yet');
    const jobId = (await call(c, 'POST', '/api/jobs', jobBody())).body.job._id;
    await call(w, 'POST', `/api/applications/jobs/${jobId}/apply`, {});
    assert.equal((await call(w, 'POST', `/api/messages/send/${c._id}`, { text: 'hello' })).status, 201);
    assert.equal((await call(c, 'GET', `/api/messages/thread/${w._id}`)).body.length, 1);
    assert.equal((await call(stranger, 'GET', `/api/messages/thread/${c._id}`)).body.length, 0, 'stranger sees nothing');
    assert.equal((await call(stranger, 'POST', `/api/messages/send/${c._id}`, { text: 'spam' })).status, 403);

    // legacy account (no roleConfirmed field) must confirm once
    const legacy = await mkUser('Legacy', 'Worker');
    await User.collection.updateOne({ _id: legacy._id }, { $unset: { roleConfirmed: '' } });
    assert.equal((await call(legacy, 'GET', '/api/dashboard/context')).body.roleConfirmed, false);
    const cr = await call(legacy, 'POST', '/api/dashboard/confirm-role', { role: 'Contractor' });
    assert.equal(cr.status, 200); assert.equal(cr.body.role, 'Contractor');
    assert.equal((await call(legacy, 'POST', '/api/dashboard/confirm-role', { role: 'Worker' })).status, 409, 'cannot flip again');
    assert.equal((await call(w, 'POST', '/api/dashboard/confirm-role', { role: 'Contractor' })).status, 409, 'confirmed accounts cannot switch');
});
