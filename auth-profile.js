/**
 * BluKaam Connection - Authentication, Profile & Activity Client SDK
 * Handles token storage, API communications, route protection, and dynamic UI updates.
 */

const isLocal = window.location.hostname === 'localhost' || 
                window.location.hostname === '127.0.0.1' ||
                window.location.hostname.startsWith('192.168.') ||
                window.location.hostname.startsWith('10.') ||
                window.location.hostname.endsWith('.local');
const isRender = window.location.hostname.includes('onrender.com');

// Smart API endpoint detection:
// 1. If served directly by the Node server (port 3000 or production proxy) -> use /api
// 2. If on Local/LAN dev server (Live Server port 5500, Vite port 5173, etc.) -> use http://<hostname>:3000/api
// 3. If on Render -> use /api
// 4. If on GitHub Pages (hink001.github.io) or file:/// -> use Render live backend
let API_BASE;
if (window.location.port === '3000') {
    API_BASE = '/api';
} else if (isLocal) {
    API_BASE = `http://${window.location.hostname || 'localhost'}:3000/api`;
} else if (isRender) {
    API_BASE = '/api';
} else {
    API_BASE = 'https://blukaam-connection.onrender.com/api';
}

// Firebase Cloud Configuration
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDTjZeRQ6xKNkMAiJq0q_4ZKkyy1TSSqu8",
    authDomain: "blukaam-connection-afa4a.firebaseapp.com",
    projectId: "blukaam-connection-afa4a",
    storageBucket: "blukaam-connection-afa4a.firebasestorage.app",
    messagingSenderId: "141626768308",
    appId: "1:141626768308:web:966324a32ae5f4729450e1",
    measurementId: "G-NMJT9J7F1H"
};

let firebaseApp = null;
function getFirebaseApp() {
    if (!firebaseApp && typeof window !== 'undefined' && window.firebase) {
        try {
            if (!window.firebase.apps.length) {
                firebaseApp = window.firebase.initializeApp(FIREBASE_CONFIG);
            } else {
                firebaseApp = window.firebase.app();
            }
            if (window.BluKaamAuth) window.BluKaamAuth.firebase = firebaseApp;
        } catch (e) {
            console.warn('Failed to initialize Firebase app:', e);
        }
    }
    return firebaseApp;
}

// Supabase Cloud Configuration
const SUPABASE_URL = 'https://tgzhjepxjpbxpypwaypz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vzjADvqW9Wu4g3nlXSC2DQ_8G-g03I5';

let supabaseClient = null;
function getSupabaseClient() {
    if (!supabaseClient && typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
        try {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                }
            });
            if (window.BluKaamAuth) window.BluKaamAuth.supabase = supabaseClient;
        } catch (e) {
            console.warn('Failed to initialize Supabase client:', e);
        }
    }
    return supabaseClient;
}

const BluKaamAuth = {
    FIREBASE_CONFIG,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    firebase: null,
    supabase: null,

    getFirebase() {
        return getFirebaseApp();
    },

    async firebaseGoogleSignIn() {
        if (typeof window === 'undefined' || !window.firebase || !window.firebase.auth) {
            throw new Error('Firebase Auth SDK is not available. Please refresh the page.');
        }
        this.getFirebase();
        const provider = new window.firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        return await window.firebase.auth().signInWithPopup(provider);
    },

    getSupabase() {
        return getSupabaseClient();
    },

    // -------------------------------------------------------------
    // Token & Storage Management
    // -------------------------------------------------------------
    TOKEN_KEY: 'blukaam_token',
    USER_KEY: 'blukaam_user',
    PROFILE_KEY: 'blukaam_profile',
    SB_ACCESS_KEY: 'blukaam_sb_access_token',

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
        const sb = this.getSupabase();
        if (sb) {
            try { await sb.auth.signOut(); } catch (e) {}
        }
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
        localStorage.removeItem(this.SB_ACCESS_KEY);
        window.location.href = 'login.html';
    },

    // -------------------------------------------------------------
    // Protected Route Guard
    // -------------------------------------------------------------
    requireAuth(redirectUrl = 'login.html') {
        // If returning from Supabase OAuth (access_token in hash or auth code in query)
        if (typeof window !== 'undefined' && (
            (window.location.hash && window.location.hash.includes('access_token=')) ||
            (window.location.search && window.location.search.includes('code='))
        )) {
            return true;
        }
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

        const controller = new AbortController();
        const timeoutMs = options.timeout || 45000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                ...options,
                signal: options.signal || controller.signal,
                headers
            });
            clearTimeout(timeoutId);

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
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                console.warn(`API Error [${endpoint}]: Request timed out`);
                throw new Error('Connection timed out. The server may be warming up, please try again.');
            }
            console.error(`API Error [${endpoint}]:`, err.message);
            throw err;
        }
    },

    // -------------------------------------------------------------
    // Supabase Session Synchronization
    // -------------------------------------------------------------
    async syncSupabaseSession(supabaseUser, profileData = {}, accessToken = null) {
        if (accessToken) {
            localStorage.setItem(this.SB_ACCESS_KEY, accessToken);
        }
        const res = await this.request('/auth/supabase-sync', {
            method: 'POST',
            body: JSON.stringify({
                supabaseUser,
                profileData,
                token: accessToken
            })
        });
        if (res.token) {
            this.setSession(res.token, res.user, res.profile);
        }
        return res;
    },

    // -------------------------------------------------------------
    // Auth Endpoints (Supabase + Hybrid Fallback)
    // -------------------------------------------------------------
    // Auth Endpoints (Email OTP Verification + Supabase Sync)
    // -------------------------------------------------------------
    async sendEmailOtp(email, fullName) {
        // Enforce backend Gmail SMTP service to guarantee 6-digit code delivery to inbox
        return await this.request('/auth/send-email-otp', {
            method: 'POST',
            body: JSON.stringify({ email, fullName })
        });
    },

    async verifyEmailAndRegister(data) {
        // 1. Verify OTP and create profile atomically in MongoDB
        const res = await this.request('/auth/verify-email-register', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        if (res.token) {
            this.setSession(res.token, res.user, res.profile);
        }

        // 2. Synchronize with Supabase Cloud Auth in the background
        const sb = this.getSupabase();
        if (sb && data.password) {
            try {
                const { data: sbData } = await sb.auth.signUp({
                    email: data.email,
                    password: data.password,
                    options: {
                        data: {
                            fullName: data.fullName,
                            role: data.role,
                            phone: data.phone,
                            city: data.city,
                            workType: data.workType
                        }
                    }
                });
                if (sbData?.session?.access_token) {
                    localStorage.setItem(this.SB_ACCESS_KEY, sbData.session.access_token);
                }
            } catch (sbErr) {
                console.log('Supabase post-verification sync notice:', sbErr.message);
            }
        }
        return res;
    },

    async sendLoginOtp(email) {
        return await this.request('/auth/send-login-otp', {
            method: 'POST',
            body: JSON.stringify({ email })
        });
    },

    async verifyLoginOtp(email, otp) {
        const res = await this.request('/auth/verify-login-otp', {
            method: 'POST',
            body: JSON.stringify({ email, otp })
        });
        if (res.token) {
            this.setSession(res.token, res.user, res.profile);
        }
        return res;
    },

    async register(data) {
        const res = await this.request('/auth/register', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        if (res.token) {
            this.setSession(res.token, res.user, res.profile);
        }

        // Silently sync with Supabase in the background
        const sb = this.getSupabase();
        if (sb && data.password) {
            sb.auth.signUp({
                email: data.email,
                password: data.password,
                options: {
                    data: {
                        fullName: data.fullName,
                        role: data.role,
                        phone: data.phone,
                        city: data.city,
                        workType: data.workType
                    }
                }
            }).then(({ data: sbData }) => {
                if (sbData?.session?.access_token) {
                    localStorage.setItem(this.SB_ACCESS_KEY, sbData.session.access_token);
                }
            }).catch(() => {});
        }
        return res;
    },

    async login(email, password) {
        // Authenticate directly with BluKaam backend
        const res = await this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        if (res.token) {
            this.setSession(res.token, res.user, res.profile);
        }

        // Silently sync Supabase session in background
        const sb = this.getSupabase();
        if (sb) {
            sb.auth.signInWithPassword({ email, password }).then(({ data }) => {
                if (data?.session?.access_token) {
                    localStorage.setItem(this.SB_ACCESS_KEY, data.session.access_token);
                }
            }).catch(() => {});
        }

        return res;
    },

    // Backend OTP-based password reset (no Supabase needed)
    async forgotPassword(email) {
        return await this.request('/auth/forgot-password', {
            method: 'POST',
            body: JSON.stringify({ email })
        });
    },

    async resetPassword(email, otp, newPassword) {
        return await this.request('/auth/reset-password', {
            method: 'POST',
            body: JSON.stringify({ email, otp, newPassword })
        });
    },

    // Kept for backward compat — now delegates to backend OTP flow
    async supabaseResetPassword(email) {
        return await this.forgotPassword(email);
    },

    async getAuthConfig() {
        return this.request('/auth/config', { timeout: 8000 });
    },

    async googleLogin(credential, role = 'Worker') {
        const res = await this.request('/auth/google', {
            method: 'POST',
            body: JSON.stringify({ credential, role })
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
    },

    // -------------------------------------------------------------
    // Supabase Auth State Change Listener
    // -------------------------------------------------------------
    initSupabaseAuthListener() {
        const sb = this.getSupabase();
        if (sb && sb.auth && typeof sb.auth.onAuthStateChange === 'function') {
            try {
                sb.auth.onAuthStateChange(async (event, session) => {
                    if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && session?.user) {
                        const currentUser = this.getUser();
                        if (!this.isAuthenticated() || (currentUser && currentUser.email !== session.user.email)) {
                            try {
                                await this.syncSupabaseSession(session.user, {}, session.access_token);
                            } catch (err) {
                                console.warn('Supabase auth state sync note:', err.message);
                            }
                        }
                    }
                });
            } catch (e) {
                console.warn('Could not register Supabase onAuthStateChange listener:', e);
            }
        }
    }
};

// Auto-run nav check and Supabase listener when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    BluKaamAuth.initNav();
    BluKaamAuth.initSupabaseAuthListener();
});

// Export globally for inline scripts
window.BluKaamAuth = BluKaamAuth;
