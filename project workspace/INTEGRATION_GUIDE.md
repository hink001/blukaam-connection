# BluKaam Connection — Roadmap Implementation: Integration Guide

This package implements Phases 1–5 of your roadmap (Social Feed, Connections,
Direct Messaging, Security Hardening, and a 3-column LinkedIn-style layout)
**on top of your existing code**. Nothing in your current design, auth flow,
database models, or deployment config was rewritten — everything below is
either a **new file** or a **drop-in replacement** of a file that only had
lines *added*, never removed.

Give this whole folder to Antigravity (or copy manually) with the instruction:
"Copy every file into the matching path in my repo, overwriting the files
listed under 'Replace' below, then run the install command."

---

## 1. Files to ADD (brand new, no conflicts)

Copy these into your repo at the exact same relative paths:

```
bluekamm/models/Post.js
bluekamm/models/Connection.js
bluekamm/models/Message.js
bluekamm/models/Notification.js
bluekamm/routes/postRoutes.js
bluekamm/routes/connectionRoutes.js
bluekamm/routes/messageRoutes.js
bluekamm/routes/notificationRoutes.js
bluekamm/middleware/security.js
bluekamm/middleware/rbac.js
bluekamm/utils/sanitize.js
bluekamm/services/notificationService.js

feed.html
feed.js
network.html
network.js
messages.html
messages.js
notifications.html
notifications.js
social-sdk.js
social.css
```

(The `frontend/` prefix in this delivery folder is just for organization —
the 10 frontend files above go in your **repo root**, next to `index.html`,
`dashboard.html`, `style.css`, `auth-profile.js`, etc.)

## 2. Files to REPLACE (existing files, additive changes only)

- `bluekamm/server.js` → replaces your current one. Diff summary: adds
  `helmet`, mounts rate limiters on `/api` and the auth endpoints, requires
  and mounts the four new route modules. Every existing route, the offline
  JSON fallback, the Mongo sync logic, and the legacy OTP endpoints are
  untouched.
- `bluekamm/package.json` → adds three dependencies (`helmet`,
  `express-rate-limit`, `sanitize-html`). Nothing removed or version-bumped.
- `package.json` (repo root) → same three dependencies added, so `npm run
  build` (which installs both root and `bluekamm`) keeps working exactly as
  before.

## 3. Install the new dependencies

```bash
cd bluekamm && npm install
cd .. && npm install
```

No new environment variables are required. Cloudinary, MongoDB, JWT secret,
and email settings all keep working exactly as configured today — post
photos reuse the same `uploadImageBuffer` helper and Cloudinary folder
pattern as profile photos (just a different folder: `blukaam/posts`).

## 4. Wire the new pages into navigation (already mostly automatic)

`social-sdk.js` automatically injects **Feed / My Network / Messaging** links
and a notification bell into any page's existing `.nav-links` bar — as long
as the page loads it *after* `auth-profile.js`:

```html
<script src="auth-profile.js"></script>
<script src="social-sdk.js"></script>
```

Add those two lines (in that order) plus `<link rel="stylesheet" href="social.css">`
(after your existing `style.css` link) to any page where you want the Feed/
Network/Messaging nav links and bell to appear — typically `dashboard.html`,
`index.html`, `profile.html`, `workers.html`, `jobs.html`, `training.html`.
This is the only touch to those files, and it's additive (two `<script>`
tags + one `<link>` tag) — no existing markup changes.

## 5. What each phase maps to

| Roadmap Phase | Files |
|---|---|
| **Phase 1** — Social Feed & Posts | `Post.js`, `postRoutes.js`, `feed.html`/`feed.js`, `notificationService.js` |
| **Phase 2** — Connections & Networking | `Connection.js`, `connectionRoutes.js`, `network.html`/`network.js` |
| **Phase 3** — Interface Overhaul | `feed.html`'s 3-column `.feed-layout` grid + `social.css` (reuses your existing `.linkedin-card` styling for visual consistency) |
| **Phase 4** — Security & Storage Scaling | `security.js` (rate limiting), `helmet` in `server.js`, `sanitize.js` (input sanitization on posts/comments/messages), `rbac.js` (role guard, ready to use — see note below), indexes added on `Post`/`Connection`/`Message`/`Notification` schemas |
| **Phase 5** — Direct Messaging & Notifications | `Message.js`, `Notification.js`, `messageRoutes.js`, `notificationRoutes.js`, `messages.html`/`.js`, `notifications.html`/`.js`, nav bell in `social-sdk.js` |

## 6. Two small optional edits (not required to run, but complete the roadmap)

These are the *only* hand-edits to pre-existing files beyond `server.js`/
`package.json` above, and both are single-line additions:

**a) Add the "Recruiter" role** (roadmap Phase 4 mentions Worker/Contractor/
Admin/Recruiter). In `bluekamm/models/User.js`, change:
```js
enum: ['Worker', 'Contractor', 'Admin'],
```
to:
```js
enum: ['Worker', 'Contractor', 'Admin', 'Recruiter'],
```

**b) Add MongoDB indexes for query performance at scale** (roadmap Phase 6).
In `bluekamm/models/Profile.js`, add `index: true` to the `city` field and
the `skills` field:
```js
city: { type: String, trim: true, index: true },
...
skills: { type: [String], default: [], index: true },
```
(`Post`, `Connection`, `Message`, and `Notification` already ship with the
right indexes built in — see each model file.)

## 7. How messaging enforces the "connections only" rule

To match the roadmap's intent ("contractors discuss job details and hire
workers directly"), `POST /api/messages/send/:userId` checks that the two
users have an **accepted** connection first (403 if not). This mirrors how
LinkedIn gates messaging behind connections. If you'd rather allow anyone to
message anyone, delete the `areConnected(...)` check block near the top of
`messageRoutes.js` — it's isolated to a few lines.

## 8. Notes on architecture choices

- **No socket.io / WebSockets were added.** Your stack is plain REST end to
  end, so messaging and notifications use the same request/response pattern
  as everything else, with light client-side polling (every 5s for an open
  chat thread, every 30s for the notification badge). This keeps the
  dependency footprint and deployment config (Render, etc.) completely
  unchanged. If you want true real-time later, Socket.IO can be layered on
  top of `messageRoutes.js`/`notificationService.js` without changing the
  data model.
- **Offline JSON fallback is fully implemented** for every new feature
  (posts, connections, messages, notifications), matching your existing
  dual-mode pattern — the site keeps working even if MongoDB is down.
- **Every new write path (posts, comments, messages) is sanitized** via
  `utils/sanitize.js` (strips HTML/scripts) before being stored, addressing
  the roadmap's XSS/input-validation requirement.
