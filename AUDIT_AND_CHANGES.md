# BluKaam Connection — Audit & Marketplace Implementation (branch `ai-review-a`, based on `DEMO` @ ccd345a)

## 1. Audit (what the code actually does)
Stack found: static HTML/JS frontend on Firebase Hosting; Express 5 + MongoDB (Mongoose) API on Render; JWT sessions issued by the
Express API. Firebase is used only for Phone-OTP/Google *identity verification* (tokens are verified via Identity Toolkit, then a
Mongo `User` is created). Supabase is used for email/Google sign-in and is synced into Mongo (`/api/auth/supabase-sync`).
MongoDB is the single store for users/profiles/posts/messages; there is a JSON-file offline fallback for the social features.
Branches: `main` (1a19518) is 1 commit behind `DEMO` (ccd345a, index.html redesign). `project-workspace` is a separate, unrelated
lineage (friend's static React-style frontend) and was left untouched.

### Confirmed problems and root causes
| # | Problem | Root cause (file) |
|---|---------|-------------------|
| 1 | Worker and contractor see the same dashboard | `login.html` always redirects to `dashboard.html`; `dashboard.html` contains **no role logic at all** |
| 2 | No jobs, applications, offers exist | No Job/Application/Offer models or routes; `jobs.html` is **static hard-coded cards** with fake counts ("500+ Jobs", "24 Applied") |
| 3 | Role can be chosen by the browser | `/auth/google`, `/auth/phone`, `/supabase-sync` take `role` from the request body for new users (acceptable at signup, but nothing stops legacy users being all "Worker") |
| 4 | Legacy accounts all default to `Worker` | `User.role` default; no confirmation flow |
| 5 | Anyone could message anyone | `messageRoutes.js` silently **auto-created an accepted connection** for any pair of users |
| 6 | Profile has no marketplace fields | `Profile` lacked wage, wage type, service area, languages, work types etc.; profile PUT did not sanitise strings |
| 7 | CORS open to every origin | `app.use(cors())` |
| 8 | **Secrets committed to a public repo** | `bluekamm/.env.example` contained a real MongoDB Atlas URI *with password*, the reCAPTCHA **secret** key, and Supabase/Firebase keys |
| 9 | Stray build artifact committed | `blukaam-roadmap-implementation.zip` in repo root (ignored by hosting, should be deleted) |
| 10 | Data split | Firebase = identity only (no duplicate business data found); Supabase = auth only, mirrored into Mongo. No duplicated business records, but `bluekamm/schema.sql` exists and is unused by the code. |

Works already: registration/login paths, profile CRUD + avatar upload (Cloudinary), feed/posts/connections/follow/block/report,
notifications and messaging plumbing, rate limiting, helmet, input sanitiser.

## 2. What was implemented
**Backend (`bluekamm/`)** — all new marketplace data lives in MongoDB (single source of truth)
- Models: `Job`, `Application`, `Offer` (+ new notification types, `User.roleConfirmed`, extra `Profile` fields)
- `middleware/marketplace.js`: verifies JWT then **re-reads the role from the database** (a forged `role` claim is ignored)
- `routes/jobRoutes.js` `/api/jobs`: create/edit/draft, pause/resume/close/cancel, validated; DB-backed search with filters + pagination; public view hides contractor identifiers
- `routes/applicationRoutes.js` `/api/applications`: apply (role, active, deadline, no duplicates, re-apply after withdraw), withdraw, mine, received (filter/sort/paginate), shortlist, reject
- `routes/offerRoutes.js` `/api/offers`: send (2–72 h deadline), accept, decline, cancel, lists. **Vacancy reservation is atomic** (`slotsLeft` conditional `$inc`), accept is an atomic state change, so over-hiring is impossible; decline/expiry/cancel release the slot exactly once
- `services/offerService.js`: server-side expiry sweep + one-time reminders (runs every 60 s on the backend, not in the browser). Nothing is auto-rejected.
- `routes/dashboardRoutes.js`: trusted role/context, one-time **role confirmation** for legacy accounts, role summaries, recommendations
- Messaging now requires an existing connection **or** a worker↔contractor application; the silent auto-connect was removed
- CORS restricted to your hosting/Render origins (override with `ALLOWED_ORIGINS`)
- `.env.example` scrubbed of real secrets

**Frontend**
- `worker-dashboard.html/js` (blue `#2563EB`) and `contractor-dashboard.html/js` (green `#16A34A`), shared `marketplace.js/css`
- Worker: overview, find jobs (7 filters, sort, pagination), job detail + apply, applications (+withdraw), offers (accept/decline), profile (+photo), notifications, messages, settings
- Contractor: overview, post/edit job (full validation), manage jobs, applicants (filter/sort, shortlist/reject/offer), offers (withdraw), business profile, notifications, messages, settings
- Wrong-role visits redirect to the right dashboard; `dashboard.html` now redirects by role (`?view=profile` keeps the old page)

## 3. Tests actually run
`cd bluekamm && npm test` (Node test runner, 7 integration tests). **Run against a real MongoDB 3.6.8 `mongod`** (the sandbox could not
download 4.x+, so the suite was run with a Mongoose 6 copy; the Mongoose 9 driver in `package.json` requires MongoDB ≥ 4.2, which Atlas provides).
Result: **7/7 passing, 3 consecutive runs.** Covered: the exact 1 contractor + 4 workers + 2 electricians scenario (discover, apply, shortlist,
2 offers, 3rd offer refused, both accept, counts, statuses, notifications, read-state persistence); 5 parallel offers on 1 vacancy → exactly 1;
4 parallel accepts of one offer → exactly 1 hire; decline and expiry release vacancy; cross-contractor/cross-worker access denied; forged role claim
rejected; validation, deadline, pause/close, search/filters; messaging authorisation; role-confirmation flow.
UI smoke test (headless DOM against the live server): green/blue themes render, job visible to worker, **Apply button click** creates the
application, contractor sees it, wrong-role access blocked, no script errors.

## 4. NOT tested / owner action required
- **Rotate immediately:** the MongoDB Atlas password and the reCAPTCHA secret key were exposed in the public repo (they remain in git history; rotating is the only fix). Also review whether the Atlas IP allow-list is open.
- Real registration flows (Firebase phone OTP, Supabase, Google, email OTP) need your live credentials — not run.
- Not tested on real devices/browsers (mobile/tablet layouts are CSS-responsive but only checked via DOM, not visually). No screenshots taken.
- Atlas (MongoDB ≥ 4.2) with the Mongoose 9 driver was not available here; atomic-update behaviour was verified on 3.6 (same single-document guarantees).
- Marketplace needs a live MongoDB; if the DB is down it returns 503 (there is intentionally no JSON-file fallback, which cannot be atomic).
- Email/push/WhatsApp notifications: not implemented (in-app only, as scoped). Deadline reminders for *job* deadlines are not implemented; *offer* expiry reminders are.
- `jobs.html` (public marketing page) still shows static sample cards — replace or label before launch. Workers/real jobs are in the dashboards.
- Firebase/Supabase security rules and Supabase RLS were not viewable from the repo and were not audited.
- Real-time chat is the existing polling REST messaging; conversations list unread counts work, but no websocket.

## 5. Deploy
1. Rotate secrets (above); set env vars on Render (`MONGO_URI`, `JWT_SECRET`, optionally `ALLOWED_ORIGINS`).
2. `cd bluekamm && npm install && npm test` (needs `MONGO_TEST_URI` pointing at a *throwaway* DB — the tests drop it!).
3. Review this branch as a PR into `DEMO`/`main`; deploy backend to Render staging first, then `firebase deploy --only hosting`.
4. Existing users: on first dashboard visit they are asked once to confirm Worker or Contractor.
