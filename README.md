<div align="center">

<img src="../assets/images/logo.png" alt="Blukaam Connection logo" width="140" />

# Blukaam Connection

### 🛠️ The professional network built for blue-collar workers

*Find jobs. Show your skills. Connect with contractors. Grow your career.*

<br/>

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![SQL](https://img.shields.io/badge/SQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white)

![Status](https://img.shields.io/badge/status-in%20development-orange?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)

[**Features**](#-features) · [**Quick Start**](#-quick-start) · [**Structure**](#-project-structure) · [**API**](#-api-overview) · [**Progress**](#-project-progress) · [**Roadmap**](#-roadmap)

</div>

---

## 📖 About

**Blukaam Connection** is a platform that gives electricians, plumbers, masons, drivers, welders and other skilled workers a place to be **seen, hired and trained**. Contractors and employers can post jobs, browse a directory of skilled workers, and message them directly, all in one place.

> **Why Blukaam?** Skilled workers often find jobs only through word of mouth. Blukaam makes that process open, fast and trustworthy.

---

## ✨ Features

| | Feature | Description |
|---|---|---|
| 🔐 | **Secure login** | Google sign-in popup and email OTP verification |
| 👤 | **Worker profiles** | Skills, roles and a public or private profile |
| 💼 | **Jobs board** | Post, search, filter and apply for blue-collar jobs |
| 🧰 | **Workers directory** | Browse skilled workers by trade and location |
| 🤝 | **Network** | Connect with and follow workers and contractors |
| 📰 | **Community feed** | Share updates and posts |
| 💬 | **Messaging** | One-to-one chat with saved history |
| 🔔 | **Notifications** | In-app alerts for messages, connections and applications |
| 🎓 | **Training** | Upskilling and safety courses |

---

## 🖼️ Screenshots

> Add screenshots here once your pages are ready. Save images in `frontend/assets/images/screenshots/`.

| Landing page | Login | Dashboard |
|:---:|:---:|:---:|
| *coming soon* | *coming soon* | *coming soon* |

---

## 🧱 Tech Stack

| Layer | Technology |
|-------|------------|
| 🎨 **Frontend** | HTML5, CSS3, Vanilla JavaScript |
| ⚙️ **Backend** | Python 3.10+, FastAPI, Uvicorn |
| 🗄️ **Database** | SQL (MySQL or PostgreSQL) with SQLAlchemy *(confirm)* |
| 🔑 **Auth** | JWT, Google OAuth2, email OTP |
| ✉️ **Email** | SMTP (`smtplib` or `fastapi-mail`) *(confirm)* |
| 🤖 **Automation** | Windows batch and PowerShell scripts |

---

## 🔄 How Login Works

```mermaid
sequenceDiagram
    participant U as 👤 User
    participant F as 🖥️ Frontend
    participant B as ⚙️ FastAPI Backend
    participant G as 🔵 Google
    participant M as ✉️ Email

    U->>F: Open login page
    alt Google sign-in
        F->>G: Open popup
        G-->>F: Google token
        F->>B: POST /api/auth (token)
        B->>G: Verify token
    else Email OTP
        F->>B: Request OTP
        B->>M: Send 6-digit code
        U->>F: Enter code
        F->>B: Verify OTP
    end
    B-->>F: JWT token
    F->>B: Requests with JWT (protected routes)
```

---

## 🚀 Quick Start

### Prerequisites

- 🐍 Python **3.10+**
- 🗄️ A SQL database (MySQL or PostgreSQL)
- 🔵 A Google OAuth client ID
- ✉️ An email account or SMTP service (for OTP emails)

### 1️⃣ Clone the repository

```bash
git clone <your-repo-url>
cd blukaam-connection
```

### 2️⃣ Set up the backend

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env        # then fill in your values
```

<details>
<summary><b>📦 Typical <code>requirements.txt</code></b></summary>

```text
fastapi
uvicorn[standard]
sqlalchemy
pymysql              # or psycopg2-binary for PostgreSQL
python-dotenv
pydantic-settings
pyjwt
google-auth
requests
email-validator
```

</details>

Import your database schema, then start the server:

```bash
mysql -u <user> -p <database_name> < path/to/your-file.sql

uvicorn app.main:app --reload --port 8000
```

✅ Open **http://localhost:8000/docs** to see the interactive API docs.

### 3️⃣ Run the frontend

```bash
cd frontend
python -m http.server 5500
```

Then open **http://localhost:5500**. (Use a local server rather than double-clicking the file, because Google sign-in needs `http://localhost`.)

---

## 🔧 Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in the values. **Never commit `.env`.**

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Backend port | `8000` |
| `DB_URI` | Database connection string | `mysql+pymysql://user:pass@localhost/blukaam` |
| `JWT_KEY` | Secret used to sign tokens | `a-long-random-string` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID *(confirm)* | `xxxx.apps.googleusercontent.com` |
| `EMAIL_USER` / `EMAIL_PASS` | Account that sends OTP emails *(confirm)* | `noreply@example.com` |
| `FRONTEND_URL` | Allowed origin for CORS *(confirm)* | `http://localhost:5500` |

---

## 📂 Project Structure

<details open>
<summary><b>Click to collapse or expand</b></summary>

```text
blukaam-connection/
│
├── 🎨 frontend/                    # Client application
│   ├── assets/
│   │   ├── icons/                  # Favicons, app icons, webmanifest
│   │   └── images/                 # Logos
│   ├── css/
│   │   ├── style.css               # Layout and base styling
│   │   └── social.css              # Feed, chat and card styling
│   ├── js/
│   │   ├── script.js               # Shared UI events and navigation
│   │   ├── auth-profile.js         # Google popup auth and OTP verify
│   │   ├── feed.js                 # Feed rendering
│   │   ├── network.js              # Connections and following
│   │   ├── messages.js             # Chat interface
│   │   ├── notifications.js        # In-app alerts
│   │   └── social-sdk.js           # Reusable API helpers
│   ├── pages/
│   │   ├── dashboard.html   login.html      feed.html
│   │   ├── jobs.html        workers.html    network.html
│   │   ├── messages.html    notifications.html
│   │   └── profile.html     training.html
│   └── index.html                  # Landing page
│
├── ⚙️ backend/                     # Server application (FastAPI)
│   ├── app/
│   │   ├── config/                 # db.py, google_auth.py, settings.py
│   │   ├── controllers/            # Request/response logic
│   │   ├── models/                 # SQLAlchemy models
│   │   ├── schemas/                # Pydantic validation
│   │   ├── routes/                 # API routers
│   │   ├── middleware/             # auth_middleware.py (JWT check)
│   │   ├── services/               # email_service.py, otp_service.py
│   │   └── main.py                 # Entry point
│   ├── .env.example                # Template for environment keys
│   └── requirements.txt            # Python dependencies
│
├── 🤖 scripts/                     # Deployment and Git auto-sync
├── 🗃️ .archive/                    # Legacy and backup files (git-ignored)
├── .gitignore
└── README.md
```

</details>

### 🌐 Frontend Pages

| Page | Purpose |
|------|---------|
| `index.html` | Landing page |
| `pages/login.html` | Sign-in and OTP modal |
| `pages/dashboard.html` | User home |
| `pages/feed.html` | Community posts |
| `pages/jobs.html` | Job listings |
| `pages/workers.html` | Skilled worker directory |
| `pages/network.html` | Connections |
| `pages/messages.html` | Inbox and chats |
| `pages/notifications.html` | Notification list |
| `pages/profile.html` | Public/private profile |
| `pages/training.html` | Courses |

> 💡 **Path tip:** pages inside `pages/` must use `../css/style.css` and `../index.html#about`, while `index.html` uses `css/style.css`.

---

## 🔌 API Overview

| Base URL | Purpose |
|----------|---------|
| `/api/auth` | Google token login, OTP send and verify |
| `/api/users` | Profiles, skills and updates |
| `/api/jobs` | Job posts, applications and filtering |
| `/api/messages` | Chat messages and history |

📘 Full interactive documentation is generated automatically at **`/docs`** (Swagger UI) and **`/redoc`**.

---

## 📊 Project Progress

**Legend:** ✅ done &nbsp;·&nbsp; 🚧 in progress &nbsp;·&nbsp; ⬜ not started

> The page and JS files exist in the project, so they are marked ✅ as created. Edit this table as you build and test each part.

| Module | 📄 Page | 🧠 JS logic | ⚙️ Backend API | 🗄️ Database | Overall |
|--------|:------:|:----------:|:-------------:|:----------:|:-------:|
| 🔐 Authentication | ✅ | ✅ | ⬜ | ⬜ | `██░░` 50% |
| 👤 Profiles | ✅ | ⬜ | ⬜ | ⬜ | `█░░░` 25% |
| 💼 Jobs | ✅ | ⬜ | ⬜ | ⬜ | `█░░░` 25% |
| 🧰 Workers directory | ✅ | ⬜ | ⬜ | ⬜ | `█░░░` 25% |
| 🤝 Network | ✅ | ✅ | ⬜ | ⬜ | `██░░` 50% |
| 📰 Feed | ✅ | ✅ | ⬜ | ⬜ | `██░░` 50% |
| 💬 Messaging | ✅ | ✅ | ⬜ | ⬜ | `██░░` 50% |
| 🔔 Notifications | ✅ | ✅ | ⬜ | ⬜ | `██░░` 50% |
| 🎓 Training | ✅ | ⬜ | ⬜ | ⬜ | `█░░░` 25% |

### ✔️ Launch Checklist

**Setup**
- [x] Folder structure created
- [ ] Virtual environment and `requirements.txt` working
- [ ] Database created and SQL schema imported
- [ ] `.env` configured (and git-ignored)
- [ ] API docs open at `/docs`

**Core**
- [ ] Google sign-in works end to end
- [ ] OTP email sends and verifies
- [ ] JWT protects private routes
- [ ] Users can create and edit a profile
- [ ] Contractors can post jobs, workers can apply
- [ ] Messages are saved and loaded

**Quality and launch**
- [ ] All pages load with correct CSS/JS paths
- [ ] Mobile layout tested
- [ ] Input validation on every route
- [ ] CORS limited to the real frontend URL
- [ ] OTP rate limiting added
- [ ] Hosting chosen and live site tested

---

## 🗺️ Roadmap

- [ ] Add backend models, schemas, routes and controllers for **feed**, **connections**, **notifications**, **workers** and **training**
- [ ] Store the SQL schema in the repo (`backend/database/schema.sql`)
- [ ] Keep the API base URL in one place (`social-sdk.js`)
- [ ] Move `split.js` and `split.py` into `.archive/`
- [ ] Add automated tests
- [ ] Real-time chat (WebSockets)
- [ ] Hindi and Punjabi language support 🌏

---

## 🤖 Scripts

| File | Purpose |
|------|---------|
| `deploy.bat` | Runs the deployment |
| `auto-sync.ps1` | Git synchronization |
| `start-auto-sync.bat` / `stop-auto-sync.bat` | Start and stop auto-sync |

---

## 🤝 Contributing

Contributions are welcome!

1. Fork the repository
2. Create a branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push the branch: `git push origin feature/my-feature`
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **MIT License**. Change this if you choose a different license.

---

<div align="center">

**Built with ❤️ for the people who build everything around us.**

⭐ If you like this project, give it a star!

</div>
