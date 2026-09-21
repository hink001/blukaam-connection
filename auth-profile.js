/**
 * BluKaam Connection - Authentication, Profile & Activity Client SDK
 * Handles token storage, API communications, route protection, and dynamic UI updates.
 */

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const isRender = window.location.hostname.includes('onrender.com');

// If running on localhost or Render, use local /api
// If running on GitHub Pages (e.g. hink001.github.io), automatically route API calls to Render backend
const API_BASE = (isLocal || isRender)
    ? '/api'
    : 'https://blukaam-connection.onrender.com/api';

const BluKaamAuth = {
    // -------------------------------------------------------------
    // Token & Storage Management
    // -------------------------------------------------------------
    TOKEN_KEY: 'blukaam_token',
    USER_KEY: 'blukaam_user',
    PROFILE_KEY: 'blukaam_profile',

    getToken() {
        return localStorage.getItem(this.TOKEN_KEY);
    },

    setSession(token, user, profile) {
        if (token) localStorage.setItem(this.TOKEN_KEY, token);
        if (user) localStorage.setItem(this.USER_KEY, JSON.stringify(user));
        if (profile) localStorage.setItem(this.PROFILE_KEY, JSON.stringify(profile));
    },

    getUser() {
        try {
            const u = localStorage.getItem(this.USER_KEY);
            return u ? JSON.parse(u) : null;
        } catch (e) {
            return null;
        }
    },

    getStoredProfile() {
        try {
            const p = localStorage.getItem(this.PROFILE_KEY);
            return p ? JSON.parse(p) : null;
        } catch (e) {
            return null;
        }
    },

    setStoredProfile(profile) {
        if (profile) localStorage.setItem(this.PROFILE_KEY, JSON.stringify(profile));
    },

    isAuthenticated() {
        return !!this.getToken();
    },

    async logout() {
        const token = this.getToken();
        if (token) {
            try {
                await fetch(`${API_BASE}/auth/logout`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } catch (e) {
                // Continue logout even if offline
            }
        }
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.USER_KEY);
        localStorage.removeItem(this.PROFILE_KEY);
        window.location.href = 'login.html';
    },

    // -------------------------------------------------------------
    // Protected Route Guard
    // -------------------------------------------------------------
    requireAuth(redirectUrl = 'login.html') {
        if (!this.isAuthenticated()) {
            sessionStorage.setItem('redirect_after_login', window.location.href);
            window.location.href = redirectUrl;
            return false;
        }
        return true;
    },

    // -------------------------------------------------------------
    // API Request Wrapper
    // -------------------------------------------------------------
    async request(endpoint, options = {}) {
        const headers = options.headers || {};
        const token = this.getToken();

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        if (!(options.body instanceof FormData) && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }

        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                ...options,
                headers
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                if (response.status === 401 && this.isAuthenticated()) {
                    // Token expired or invalid
                    console.warn('Session expired. Logging out.');
                    this.logout();
                }
                throw new Error(data.error || data.message || `Request failed with status ${response.status}`);
            }

            return data;
        } catch (err) {
            console.error(`API Error [${endpoint}]:`, err.message);
            throw err;
        }
    },

    // -------------------------------------------------------------
    // Auth Endpoints
    // -------------------------------------------------------------
    async register(data) {
        const res = await this.request('/auth/register', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        if (res.token) {
            this.setSession(res.token, res.user, res.profile);
        }
        return res;
    },

    async login(email, password) {
        const res = await this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        if (res.token) {
            this.setSession(res.token, res.user, res.profile);
        }
        return res;
    },

    async getCurrentUser() {
        const res = await this.request('/auth/me');
        if (res.user) localStorage.setItem(this.USER_KEY, JSON.stringify(res.user));
        if (res.profile) localStorage.setItem(this.PROFILE_KEY, JSON.stringify(res.profile));
        return res;
    },

    // -------------------------------------------------------------
    // Profile Endpoints
    // -------------------------------------------------------------
    async getMyProfile() {
        const profile = await this.request('/profile/me');
        this.setStoredProfile(profile);
        return profile;
    },

    async updateMyProfile(updates) {
        const res = await this.request('/profile/me', {
            method: 'PUT',
            body: JSON.stringify(updates)
        });
        if (res.profile) this.setStoredProfile(res.profile);
        return res;
    },

    async uploadAvatar(file) {
        const formData = new FormData();
        formData.append('avatar', file);

        const res = await this.request('/profile/me/avatar', {
            method: 'POST',
            body: formData
        });

        if (res.profile) this.setStoredProfile(res.profile);
        return res;
    },

    async getPublicProfile(idOrSlug) {
        return await this.request(`/profile/public/${encodeURIComponent(idOrSlug)}`);
    },

    async listProfiles(params = {}) {
        const query = new URLSearchParams(params).toString();
        return await this.request(`/profile/list${query ? '?' + query : ''}`);
    },

    // -------------------------------------------------------------
    // Activities Endpoints
    // -------------------------------------------------------------
    async getMyActivities(limit = 20) {
        return await this.request(`/activities/me?limit=${limit}`);
    },

    async getUserActivities(userId, limit = 15) {
        return await this.request(`/activities/user/${encodeURIComponent(userId)}?limit=${limit}`);
    },

    // -------------------------------------------------------------
    // Toast Notification Utility
    // -------------------------------------------------------------
    showToast(message, type = 'success') {
        let container = document.getElementById('bk-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'bk-toast-container';
            container.className = 'bk-toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `bk-toast bk-toast-${type}`;

        let icon = '✓';
        if (type === 'error') icon = '✕';
        if (type === 'info') icon = 'ℹ';

        toast.innerHTML = `
            <span class="bk-toast-icon">${icon}</span>
            <span class="bk-toast-msg">${message}</span>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('bk-toast-show');
        }, 10);

        setTimeout(() => {
            toast.classList.remove('bk-toast-show');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    },

    // -------------------------------------------------------------
    // Dynamic Navbar Synchronizer
    // -------------------------------------------------------------
    initNav() {
        const navLinks = document.querySelector('.nav-links');
        const mobileMenu = document.getElementById('mobileMenu');

        if (!navLinks) return;

        const isAuth = this.isAuthenticated();
        const profile = this.getStoredProfile() || {};
        const displayName = profile.fullName || profile.name || 'Dashboard';
        const avatarUrl = profile.avatarUrl || 'logo.png';

        if (isAuth) {
            // Replace login button with Dashboard & Log out
            const loginCta = navLinks.querySelector('.nav-cta');
            if (loginCta) {
                loginCta.remove();
            }

            // Remove existing injected auth links if any
            navLinks.querySelectorAll('.injected-auth-item').forEach(el => el.remove());

            const authSnippet = `
                <a href="dashboard.html" class="injected-auth-item nav-user-chip" title="My Dashboard">
                    <img src="${avatarUrl}" class="nav-avatar" alt="Avatar" onerror="this.src='logo.png'">
                    <span>${displayName.split(' ')[0]}</span>
                </a>
                <a href="profile.html" class="injected-auth-item">My Profile</a>
                <a href="javascript:void(0)" onclick="BluKaamAuth.logout()" class="injected-auth-item nav-cta" style="background:#dc2626;">Log Out</a>
            `;
            navLinks.insertAdjacentHTML('beforeend', authSnippet);

            if (mobileMenu) {
                mobileMenu.querySelectorAll('.injected-auth-item').forEach(el => el.remove());
                const mobileSnippet = `
                    <a href="dashboard.html" class="injected-auth-item" style="color:var(--blue-mid);font-weight:700;">👤 My Dashboard</a>
                    <a href="profile.html" class="injected-auth-item">📄 My Public Profile</a>
                    <a href="javascript:void(0)" onclick="BluKaamAuth.logout()" class="injected-auth-item" style="color:#dc2626;">Log Out</a>
                `;
                mobileMenu.insertAdjacentHTML('beforeend', mobileSnippet);
            }
        }
    }
};

// Auto-run nav check when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    BluKaamAuth.initNav();
});

// Export globally for inline scripts
window.BluKaamAuth = BluKaamAuth;
