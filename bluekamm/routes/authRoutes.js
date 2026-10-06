const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const User = require('../models/User');
const Profile = require('../models/Profile');
const Otp = require('../models/Otp');
const authMiddleware = require('../middleware/auth');
const { logActivity } = require('../services/activityService');
const { sendOtpEmail, isEmailConfigured } = require('../services/emailService');
const { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } = require('../services/supabaseClient');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-blukaam-key';
const DB_FILE = path.join(__dirname, '..', 'local_database.json');
const offlineOtps = {};

// Helper to access offline JSON database
const getOfflineDb = () => {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], profiles: [], activityLogs: [] }));
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.users) data.users = [];
    if (!data.profiles) data.profiles = [];
    if (!data.activityLogs) data.activityLogs = [];
    return data;
};

const saveOfflineDb = (data) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
};

// --------------------------------------------------------
// GET /api/auth/config
// Public auth configuration (Google Client ID, Supabase URL/Key, email service status)
// --------------------------------------------------------
router.get('/config', (req, res) => {
    res.json({
        googleClientId: process.env.GOOGLE_CLIENT_ID || '',
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
        isEmailConfigured: isEmailConfigured()
    });
});

// --------------------------------------------------------
// POST /api/auth/supabase-sync
// Synchronizes a Supabase authenticated session with BluKaam MongoDB Profile & User store
// --------------------------------------------------------
router.post('/supabase-sync', async (req, res) => {
    try {
        let { supabaseUser, profileData = {}, token: supabaseToken } = req.body;

        // If client passes an access token, verify with Supabase
        if (supabase && supabaseToken) {
            try {
                const { data: verified, error: verifyErr } = await supabase.auth.getUser(supabaseToken);
                if (!verifyErr && verified && verified.user) {
                    supabaseUser = verified.user;
                }
            } catch (vErr) {
                console.warn('Supabase token verification check note:', vErr.message);
            }
        }

        if (!supabaseUser || !supabaseUser.email) {
            return res.status(400).json({ error: 'Valid authentication session with email is required.' });
        }

        const normalizedEmail = supabaseUser.email.trim().toLowerCase();
        const role = profileData.role || supabaseUser.user_metadata?.role || 'Worker';
        const fullName = profileData.fullName || 
                         supabaseUser.user_metadata?.fullName || 
                         supabaseUser.user_metadata?.full_name || 
                         supabaseUser.user_metadata?.name || 
                         normalizedEmail.split('@')[0];
        const phone = profileData.phone || supabaseUser.phone || supabaseUser.user_metadata?.phone || '';
        const city = profileData.city || supabaseUser.user_metadata?.city || '';
        const workType = profileData.workType || supabaseUser.user_metadata?.workType || supabaseUser.user_metadata?.trade || '';
        const avatarUrl = supabaseUser.user_metadata?.avatar_url || 
                          supabaseUser.user_metadata?.picture || 
                          `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(fullName)}&backgroundColor=0D2F6E&textColor=ffffff`;

        if (mongoose.connection.readyState === 1) {
            let user = await User.findOne({ email: normalizedEmail });
            let isNewUser = false;

            if (!user) {
                isNewUser = true;
                user = new User({
                    email: normalizedEmail,
                    password: 'sb_' + Math.random().toString(36).slice(-8) + Date.now(),
                    role: role === 'Contractor' ? 'Contractor' : 'Worker',
                    isEmailVerified: true,
                    lastLogin: new Date()
                });
                await user.save();
            } else {
                user.lastLogin = new Date();
                user.isEmailVerified = true;
                if (role && !user.role) user.role = role;
                await user.save();
            }

            let profile = await Profile.findOne({ $or: [{ userId: user._id }, { email: normalizedEmail }] });
            if (!profile) {
                profile = new Profile({
                    userId: user._id,
                    fullName,
                    name: fullName,
                    role: user.role,
                    email: normalizedEmail,
                    phone: phone || '',
                    city: city || '',
                    workType: workType || '',
                    skills: workType ? [workType] : [],
                    headline: workType ? `${workType} in ${city || 'India'}` : 'Skilled Professional at BluKaam',
                    avatarUrl,
                    isVerified: true
                });
                await profile.save();
            } else {
                let updated = false;
                if (!profile.userId) { profile.userId = user._id; updated = true; }
                if (phone && !profile.phone) { profile.phone = phone; updated = true; }
                if (city && !profile.city) { profile.city = city; updated = true; }
                if (workType && !profile.workType) {
                    profile.workType = workType;
                    if (!profile.skills || profile.skills.length === 0) profile.skills = [workType];
                    updated = true;
                }
                if (updated) await profile.save();
            }

            // Issue BluKaam JWT token for all existing API routes
            const token = jwt.sign(
                { userId: user._id, email: user.email, role: user.role },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            logActivity({
                userId: user._id,
                action: isNewUser ? 'AUTH_REGISTER' : 'AUTH_LOGIN',
                description: `${fullName} logged in`,
                ipAddress: req.ip
            });

            return res.json({
                message: isNewUser ? 'Welcome to BluKaam!' : 'Welcome back!',
                token,
                user: { id: user._id, email: user.email, role: user.role, isEmailVerified: true },
                profile
            });
        } else {
            // Offline fallback
            const db = getOfflineDb();
            let user = db.users.find(u => u.email === normalizedEmail);
            let isNewUser = false;

            if (!user) {
                isNewUser = true;
                const userId = 'usr_' + Date.now();
                user = {
                    _id: userId,
                    id: userId,
                    email: normalizedEmail,
                    role: role === 'Contractor' ? 'Contractor' : 'Worker',
                    isActive: true,
                    isEmailVerified: true,
                    createdAt: new Date().toISOString()
                };
                db.users.push(user);
            }
            user.lastLogin = new Date().toISOString();

            let profile = db.profiles.find(p => p.userId === user._id || p.userId === user.id || p.email === normalizedEmail);
            if (!profile) {
                profile = {
                    _id: 'prf_' + Date.now(),
                    userId: user._id,
                    fullName,
                    name: fullName,
                    role: user.role,
                    email: normalizedEmail,
                    phone,
                    city,
                    trade: workType,
                    avatarUrl,
                    isVerified: true,
                    createdAt: new Date().toISOString()
                };
                db.profiles.push(profile);
            }
            saveOfflineDb(db);

            const token = jwt.sign(
                { userId: user._id, email: user.email, role: user.role },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            return res.json({
                message: isNewUser ? 'Account created & synced with BluKaam!' : 'Welcome back!',
                token,
                user: { id: user._id, email: user.email, role: user.role, isEmailVerified: true },
                profile
            });
        }
    } catch (err) {
        console.error('Auth sync error:', err);
        return res.status(500).json({ error: 'Failed to sync authentication session: ' + err.message });
    }
});

// --------------------------------------------------------
// POST /api/auth/google
// Direct Sign in with Google (100% Free via Google Identity Services)
// --------------------------------------------------------
router.post('/google', async (req, res) => {
    try {
        const { credential, role = 'Worker' } = req.body;
        if (!credential) {
            return res.status(400).json({ error: 'Google credential token is required.' });
        }

        let email, email_verified, name, picture;
        let verified = false;

        // 1. Try Firebase Auth verification (Identity Toolkit REST API)
        const firebaseApiKey = process.env.FIREBASE_API_KEY || 'AIzaSyDTjZeRQ6xKNkMAiJq0q_4ZKkyy1TSSqu8';
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            const fbRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken: credential }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (fbRes.ok) {
                const fbData = await fbRes.json();
                if (fbData?.users && fbData.users.length > 0) {
                    const u = fbData.users[0];
                    email = u.email;
                    email_verified = u.emailVerified === true || u.emailVerified === 'true';
                    name = u.displayName || (email ? email.split('@')[0] : '');
                    picture = u.photoUrl || '';
                    verified = true;
                }
            }
        } catch (fbErr) {
            console.warn('Firebase token verification lookup note:', fbErr.message);
        }

        // 2. Fallback: Verify via standard Google OAuth tokeninfo endpoint
        if (!verified) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);
                const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, {
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (verifyRes.ok) {
                    const payload = await verifyRes.json();
                    email = payload.email;
                    email_verified = payload.email_verified === 'true' || payload.email_verified === true;
                    name = payload.name;
                    picture = payload.picture;
                    verified = true;
                }
            } catch (fetchErr) {
                console.warn('Google tokeninfo verification failed:', fetchErr.message);
            }
        }

        if (!verified || !email) {
            return res.status(401).json({ error: 'Invalid Google authentication token. Please sign in again.' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (mongoose.connection.readyState === 1) {
            let user = await User.findOne({ email: normalizedEmail });
            let isNewUser = false;

            if (!user) {
                isNewUser = true;
                const randomPassword = 'g_' + Math.random().toString(36).slice(-10) + Date.now();
                user = new User({
                    email: normalizedEmail,
                    password: randomPassword,
                    role: role === 'Contractor' ? 'Contractor' : 'Worker',
                    isEmailVerified: email_verified === 'true' || email_verified === true,
                    lastLogin: new Date()
                });
                await user.save();
            } else {
                user.lastLogin = new Date();
                if (email_verified) user.isEmailVerified = true;
                await user.save();
            }

            // Link existing profile by userId or email to avoid duplicate or orphaned profiles
            let profile = await Profile.findOne({
                $or: [
                    { userId: user._id },
                    { email: normalizedEmail },
                    { 'contactInfo.email': normalizedEmail }
                ]
            });

            const displayName = name || normalizedEmail.split('@')[0];

            if (!profile) {
                profile = new Profile({
                    userId: user._id,
                    fullName: displayName,
                    name: displayName,
                    role: user.role,
                    email: normalizedEmail,
                    contactInfo: { email: normalizedEmail },
                    avatarUrl: picture || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(displayName)}&backgroundColor=0D2F6E&textColor=ffffff`,
                    isVerified: true
                });
                await profile.save();
            } else {
                let updated = false;
                if (!profile.userId) {
                    profile.userId = user._id;
                    updated = true;
                }
                if (picture && (!profile.avatarUrl || profile.avatarUrl.includes('dicebear'))) {
                    profile.avatarUrl = picture;
                    updated = true;
                }
                if (updated) {
                    await profile.save();
                }
            }

            try {
                await logActivity({
                    userId: user._id,
                    action: isNewUser ? 'AUTH_REGISTER' : 'AUTH_LOGIN',
                    description: isNewUser ? 'Registered via Google Sign-In' : 'Logged in via Google Sign-In',
                    req
                });
            } catch (actErr) {
                console.warn('Activity log error (non-fatal):', actErr.message);
            }

            const token = jwt.sign(
                { userId: user._id, email: user.email, role: user.role },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            return res.json({
                message: isNewUser ? 'Welcome to BluKaam!' : 'Logged in successfully!',
                token,
                user: { id: user._id, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified },
                profile
            });
        } else {
            // Offline fallback
            const db = getOfflineDb();
            let user = db.users.find(u => u.email === normalizedEmail);
            let isNewUser = false;

            if (!user) {
                isNewUser = true;
                const userId = 'usr_' + Date.now();
                user = {
                    _id: userId,
                    id: userId,
                    email: normalizedEmail,
                    role: role === 'Contractor' ? 'Contractor' : 'Worker',
                    isActive: true,
                    isEmailVerified: true,
                    createdAt: new Date().toISOString()
                };
                db.users.push(user);
            }
            user.lastLogin = new Date().toISOString();

            let profile = db.profiles.find(p => p.userId === user._id || p.userId === user.id || p.email === normalizedEmail);
            if (!profile) {
                const displayName = name || normalizedEmail.split('@')[0];
                profile = {
                    _id: 'prf_' + Date.now(),
                    userId: user._id,
                    fullName: displayName,
                    name: displayName,
                    role: user.role,
                    email: normalizedEmail,
                    avatarUrl: picture || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(displayName)}&backgroundColor=0D2F6E&textColor=ffffff`,
                    isVerified: true,
                    createdAt: new Date().toISOString()
                };
                db.profiles.push(profile);
            }
            saveOfflineDb(db);

            const token = jwt.sign(
                { userId: user._id, email: user.email, role: user.role },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            return res.json({
                message: isNewUser ? 'Welcome to BluKaam!' : 'Logged in successfully!',
                token,
                user: { id: user._id, email: user.email, role: user.role, isEmailVerified: true },
                profile
            });
        }
    } catch (err) {
        console.error('Google Sign-In error:', err);
        return res.status(500).json({ error: 'Server error during Google authentication: ' + err.message });
    }
});

// --------------------------------------------------------
// POST /api/auth/phone
// Verify Firebase Phone Auth ID Token & log in or register
// --------------------------------------------------------
router.post('/phone', async (req, res) => {
    try {
        const { idToken, role = 'Worker', fullName } = req.body;
        if (!idToken) {
            return res.status(400).json({ error: 'Firebase Phone ID token is required.' });
        }

        // Verify Firebase Phone Token via Google's official Identity Toolkit endpoint
        const firebaseApiKey = process.env.FIREBASE_API_KEY || 'AIzaSyDTjZeRQ6xKNkMAiJq0q_4ZKkyy1TSSqu8';
        let verifyRes;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
        } catch (fetchErr) {
            console.error('Firebase Phone token verification failed:', fetchErr.message);
            return res.status(504).json({ error: 'Phone verification connection timed out. Please try again.' });
        }

        if (!verifyRes.ok) {
            return res.status(401).json({ error: 'Invalid or expired phone verification token. Please try again.' });
        }

        const fbData = await verifyRes.json();
        const fbUser = fbData?.users?.[0];
        if (!fbUser || !fbUser.phoneNumber) {
            return res.status(400).json({ error: 'No verified phone number found in authentication token.' });
        }

        const rawPhone = fbUser.phoneNumber; // e.g. +919876543210
        const cleanPhone10 = rawPhone.replace(/\D/g, '').slice(-10); // 10-digit number
        const placeholderEmail = `phone_${cleanPhone10}@blukaam.in`;

        if (mongoose.connection.readyState === 1) {
            // Find existing user by phone or placeholder email
            let user = await User.findOne({
                $or: [
                    { phone: cleanPhone10 },
                    { email: placeholderEmail }
                ]
            });
            let isNewUser = false;

            if (!user) {
                isNewUser = true;
                const randomPassword = 'p_' + Math.random().toString(36).slice(-10) + Date.now();
                user = new User({
                    email: placeholderEmail,
                    password: randomPassword,
                    phone: cleanPhone10,
                    role: role === 'Contractor' ? 'Contractor' : 'Worker',
                    isEmailVerified: true,
                    lastLogin: new Date()
                });
                await user.save();
            } else {
                user.lastLogin = new Date();
                if (!user.phone) user.phone = cleanPhone10;
                await user.save();
            }

            // Find or create profile
            let profile = await Profile.findOne({
                $or: [
                    { userId: user._id },
                    { phone: cleanPhone10 },
                    { 'contactInfo.phone': cleanPhone10 }
                ]
            });

            const displayName = fullName || (profile && profile.fullName) || `Worker ${cleanPhone10.slice(-4)}`;

            if (!profile) {
                profile = new Profile({
                    userId: user._id,
                    fullName: displayName,
                    name: displayName,
                    role: user.role,
                    phone: cleanPhone10,
                    contactInfo: { phone: cleanPhone10, email: placeholderEmail },
                    avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(displayName)}&backgroundColor=0D2F6E&textColor=ffffff`,
                    isVerified: true
                });
                await profile.save();
            } else {
                let updated = false;
                if (!profile.userId) { profile.userId = user._id; updated = true; }
                if (!profile.phone) { profile.phone = cleanPhone10; updated = true; }
                if (updated) await profile.save();
            }

            const token = jwt.sign(
                { userId: user._id, email: user.email, phone: cleanPhone10, role: user.role },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            return res.json({
                message: isNewUser ? 'Welcome to BluKaam!' : 'Logged in successfully!',
                token,
                user: { id: user._id, email: user.email, phone: cleanPhone10, role: user.role, isEmailVerified: true },
                profile
            });
        } else {
            // Offline fallback
            const db = getOfflineDb();
            let user = db.users.find(u => u.phone === cleanPhone10 || u.email === placeholderEmail);
            let isNewUser = false;

            if (!user) {
                isNewUser = true;
                const userId = 'usr_' + Date.now();
                user = {
                    _id: userId,
                    id: userId,
                    email: placeholderEmail,
                    phone: cleanPhone10,
                    role: role === 'Contractor' ? 'Contractor' : 'Worker',
                    isActive: true,
                    isEmailVerified: true,
                    createdAt: new Date().toISOString()
                };
                db.users.push(user);
            }
            user.lastLogin = new Date().toISOString();

            let profile = db.profiles.find(p => p.userId === user._id || p.phone === cleanPhone10);
            if (!profile) {
                const displayName = fullName || `Worker ${cleanPhone10.slice(-4)}`;
                profile = {
                    _id: 'prf_' + Date.now(),
                    userId: user._id,
                    fullName: displayName,
                    name: displayName,
                    role: user.role,
                    phone: cleanPhone10,
                    avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(displayName)}&backgroundColor=0D2F6E&textColor=ffffff`,
                    isVerified: true,
                    createdAt: new Date().toISOString()
                };
                db.profiles.push(profile);
            }
            saveOfflineDb(db);

            const token = jwt.sign(
                { userId: user._id, email: user.email, phone: cleanPhone10, role: user.role },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            return res.json({
                message: isNewUser ? 'Welcome to BluKaam!' : 'Logged in successfully!',
                token,
                user: { id: user._id, email: user.email, phone: cleanPhone10, role: user.role, isEmailVerified: true },
                profile
            });
        }
    } catch (err) {
        console.error('Phone Sign-In error:', err);
        return res.status(500).json({ error: 'Server error during phone authentication: ' + err.message });
    }
});

// --------------------------------------------------------
// POST /api/auth/send-email-otp
// Generates a 6-digit OTP, saves it, and dispatches via email
// --------------------------------------------------------
router.post('/send-email-otp', async (req, res) => {
    try {
        const { email, fullName } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Valid email address is required.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        }

        // Check if user already exists
        if (mongoose.connection.readyState === 1) {
            const existing = await User.findOne({ email: normalizedEmail });
            if (existing) {
                return res.status(409).json({ error: 'An account with this email already exists. Please Sign In.' });
            }
        } else {
            const db = getOfflineDb();
            const existing = db.users.find(u => u.email === normalizedEmail);
            if (existing) {
                return res.status(409).json({ error: 'An account with this email already exists. Please Sign In.' });
            }
        }

        // Generate 6-digit OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60000); // 5 minutes

        // Store OTP in database
        if (mongoose.connection.readyState === 1) {
            await Otp.deleteMany({ identifier: normalizedEmail });
            await new Otp({ identifier: normalizedEmail, otp: otpCode, expiresAt }).save();
        } else {
            offlineOtps[normalizedEmail] = { otp: otpCode, expiresAt };
        }

        // Dispatch email
        const emailResult = await sendOtpEmail(normalizedEmail, otpCode, fullName || 'Professional');

        return res.json({
            message: 'Verification code sent to your email!',
            email: normalizedEmail,
            simulated: emailResult.simulated,
            devOtp: emailResult.devOtp,
            warning: emailResult.warning
        });
    } catch (err) {
        console.error('Send OTP error:', err);
        return res.status(500).json({ error: 'Failed to send verification code: ' + err.message });
    }
});

// --------------------------------------------------------
// POST /api/auth/send-login-otp
// Sends 6-digit OTP to existing users for passwordless login
// --------------------------------------------------------
router.post('/send-login-otp', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Valid email address is required.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        }

        // Check if user exists
        let userExists = false;
        let displayName = 'Professional';

        if (mongoose.connection.readyState === 1) {
            const user = await User.findOne({ email: normalizedEmail });
            if (user) {
                userExists = true;
                const profile = await Profile.findOne({ $or: [{ userId: user._id }, { email: normalizedEmail }] });
                if (profile && profile.fullName) displayName = profile.fullName;
            }
        } else {
            const db = getOfflineDb();
            const user = db.users.find(u => u.email === normalizedEmail);
            if (user) {
                userExists = true;
                const profile = db.profiles.find(p => p.userId === user._id || p.userId === user.id || p.email === normalizedEmail);
                if (profile && profile.fullName) displayName = profile.fullName;
            }
        }

        if (!userExists) {
            return res.status(404).json({ error: 'No account found with this email. Please click "Create Account" to register.' });
        }

        // Generate 6-digit OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60000); // 5 minutes

        // Store OTP in database
        if (mongoose.connection.readyState === 1) {
            await Otp.deleteMany({ identifier: normalizedEmail });
            await new Otp({ identifier: normalizedEmail, otp: otpCode, expiresAt }).save();
        } else {
            offlineOtps[normalizedEmail] = { otp: otpCode, expiresAt };
        }

        // Dispatch email
        const emailResult = await sendOtpEmail(normalizedEmail, otpCode, displayName);

        return res.json({
            message: 'Login verification code sent to your email!',
            email: normalizedEmail,
            simulated: emailResult.simulated,
            devOtp: emailResult.devOtp,
            warning: emailResult.warning
        });
    } catch (err) {
        console.error('Send Login OTP error:', err);
        return res.status(500).json({ error: 'Failed to send login code: ' + err.message });
    }
});

// --------------------------------------------------------
// POST /api/auth/verify-login-otp
// Verifies OTP for existing user and issues session token
// --------------------------------------------------------
router.post('/verify-login-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) {
            return res.status(400).json({ error: 'Email and 6-digit verification code are required.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const trimmedOtp = otp.toString().trim();

        // 1. Verify OTP
        let isValidOtp = false;
        if (mongoose.connection.readyState === 1) {
            const otpRecord = await Otp.findOne({ identifier: normalizedEmail, otp: trimmedOtp });
            if (otpRecord && otpRecord.expiresAt > new Date()) {
                isValidOtp = true;
                await Otp.deleteOne({ _id: otpRecord._id });
            }
        } else {
            const record = offlineOtps[normalizedEmail];
            if (record && record.otp === trimmedOtp && record.expiresAt > new Date()) {
                isValidOtp = true;
                delete offlineOtps[normalizedEmail];
            }
        }

        if (!isValidOtp) {
            return res.status(400).json({ error: 'Invalid or expired verification code. Please check your email or request a new code.' });
        }

        // 2. Load User and Profile
        if (mongoose.connection.readyState === 1) {
            const user = await User.findOne({ email: normalizedEmail });
            if (!user) {
                return res.status(404).json({ error: 'User account not found.' });
            }

            user.lastLogin = new Date();
            user.isEmailVerified = true;
            await user.save();

            let profile = await Profile.findOne({ $or: [{ userId: user._id }, { email: normalizedEmail }] });

            const token = jwt.sign(
                { userId: user._id, email: user.email, role: user.role },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            logActivity({
                userId: user._id,
                action: 'AUTH_LOGIN',
                description: `${profile?.fullName || normalizedEmail} logged in via Email OTP`,
                req
            });

            return res.json({
                message: 'Logged in successfully!',
                token,
                user: { id: user._id, email: user.email, role: user.role, isEmailVerified: true },
                profile
            });
        } else {
            const db = getOfflineDb();
            const user = db.users.find(u => u.email === normalizedEmail);
            if (!user) {
                return res.status(404).json({ error: 'User account not found.' });
            }

            user.lastLogin = new Date().toISOString();
            user.isEmailVerified = true;
            const profile = db.profiles.find(p => p.userId === user._id || p.userId === user.id || p.email === normalizedEmail);
            saveOfflineDb(db);

            const token = jwt.sign(
                { userId: user._id, email: user.email, role: user.role },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            return res.json({
                message: 'Logged in successfully!',
                token,
                user: { id: user._id, email: user.email, role: user.role, isEmailVerified: true },
                profile
            });
        }
    } catch (err) {
        console.error('Verify Login OTP error:', err);
        return res.status(500).json({ error: 'Server error during login verification: ' + err.message });
    }
});

// --------------------------------------------------------
// POST /api/auth/verify-email-register
// Verifies OTP and creates user + profile in one atomic step
// --------------------------------------------------------
router.post('/verify-email-register', async (req, res) => {
    try {
        const {
            email,
            otp,
            password,
            fullName,
            role = 'Worker',
            phone = '',
            industry = '',
            workType = '',
            city = '',
            state = ''
        } = req.body;

        if (!email || !otp || !password || !fullName) {
            return res.status(400).json({ error: 'Full name, email, password, and OTP code are required.' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const trimmedOtp = otp.toString().trim();

        // 1. Verify OTP
        let isValidOtp = false;
        if (mongoose.connection.readyState === 1) {
            const otpRecord = await Otp.findOne({ identifier: normalizedEmail, otp: trimmedOtp });
            if (otpRecord && otpRecord.expiresAt > new Date()) {
                isValidOtp = true;
                await Otp.deleteOne({ _id: otpRecord._id });
            }
        } else {
            const record = offlineOtps[normalizedEmail];
            if (record && record.otp === trimmedOtp && record.expiresAt > new Date()) {
                isValidOtp = true;
                delete offlineOtps[normalizedEmail];
            }
        }

        if (!isValidOtp) {
            return res.status(400).json({ error: 'Invalid or expired verification code. Please check your email or request a new code.' });
        }

        // 2. Create User and Profile (Marking verified)
        if (mongoose.connection.readyState === 1) {
            const existingUser = await User.findOne({ email: normalizedEmail });
            if (existingUser) {
                return res.status(409).json({ error: 'An account with this email already exists.' });
            }

            const newUser = new User({
                email: normalizedEmail,
                password,
                role: role === 'Contractor' ? 'Contractor' : 'Worker',
                isEmailVerified: true
            });
            const savedUser = await newUser.save();

            const newProfile = new Profile({
                userId: savedUser._id,
                fullName: fullName.trim(),
                name: fullName.trim(),
                headline: `${role === 'Contractor' ? 'Contractor & Builder' : 'Skilled Worker'} in ${city || 'India'}`,
                role: savedUser.role,
                industry: industry.trim(),
                workType: workType.trim(),
                location: { city: city.trim(), state: state.trim(), country: 'India' },
                city: city.trim(),
                state: state.trim(),
                contactInfo: { email: normalizedEmail, phone: phone.trim() },
                phone: phone.trim(),
                email: normalizedEmail,
                isVerified: true,
                avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(fullName.trim())}&backgroundColor=0D2F6E&textColor=ffffff`
            });
            const savedProfile = await newProfile.save();

            await logActivity({
                userId: savedUser._id,
                action: 'AUTH_REGISTER',
                description: `Created verified account as ${savedUser.role} via Email OTP`,
                req
            });

            const token = jwt.sign(
                { userId: savedUser._id, email: savedUser.email, role: savedUser.role },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            return res.status(201).json({
                message: 'Email verified! Account and profile created successfully.',
                token,
                user: { id: savedUser._id, email: savedUser.email, role: savedUser.role, isEmailVerified: true },
                profile: savedProfile
            });

        } else {
            // Offline Local Mode
            const db = getOfflineDb();
            const existing = db.users.find(u => u.email === normalizedEmail);
            if (existing) {
                return res.status(409).json({ error: 'An account with this email already exists.' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const userId = 'usr_' + Date.now();
            const profileId = 'prf_' + Date.now();

            const offlineUser = {
                _id: userId,
                id: userId,
                email: normalizedEmail,
                password: hashedPassword,
                role: role === 'Contractor' ? 'Contractor' : 'Worker',
                isActive: true,
                isEmailVerified: true,
                createdAt: new Date().toISOString()
            };

            const offlineProfile = {
                _id: profileId,
                id: profileId,
                userId: userId,
                fullName: fullName.trim(),
                name: fullName.trim(),
                headline: `${role === 'Contractor' ? 'Contractor & Builder' : 'Skilled Worker'} in ${city || 'India'}`,
                bio: '',
                role: offlineUser.role,
                industry: industry.trim(),
                workType: workType.trim(),
                skills: [],
                location: { city: city.trim(), state: state.trim(), country: 'India', pincode: '' },
                city: city.trim(),
                state: state.trim(),
                pincode: '',
                contactInfo: { email: normalizedEmail, phone: phone.trim() },
                phone: phone.trim(),
                email: normalizedEmail,
                isVerified: true,
                avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(fullName.trim())}&backgroundColor=0D2F6E&textColor=ffffff`,
                bannerUrl: '',
                availability: 'Available',
                createdAt: new Date().toISOString()
            };

            db.users.push(offlineUser);
            db.profiles.push(offlineProfile);
            saveOfflineDb(db);

            await logActivity({
                userId,
                action: 'AUTH_REGISTER',
                description: `Created verified account as ${offlineUser.role} via Email OTP (Offline Mode)`,
                req
            });

            const token = jwt.sign(
                { userId, email: normalizedEmail, role: offlineUser.role },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            return res.status(201).json({
                message: 'Email verified! Account and profile created successfully.',
                token,
                user: { id: userId, email: normalizedEmail, role: offlineUser.role, isEmailVerified: true },
                profile: offlineProfile
            });
        }
    } catch (err) {
        console.error('Verify & Register error:', err);
        return res.status(500).json({ error: 'Server error during verification. ' + err.message });
    }
});

// --------------------------------------------------------
// POST /api/auth/register
// Register new user with email, password, and full name
// --------------------------------------------------------
router.post('/register', async (req, res) => {
    try {
        const { email, password, fullName, role = 'Worker', phone = '', industry = '', workType = '', city = '', state = '' } = req.body;

        if (!email || !password || !fullName) {
            return res.status(400).json({ error: 'Full name, email, and password are required.' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (mongoose.connection.readyState === 1) {
            // MongoDB Mode
            const existingUser = await User.findOne({ email: normalizedEmail });
            if (existingUser) {
                return res.status(409).json({ error: 'An account with this email already exists.' });
            }

            const newUser = new User({
                email: normalizedEmail,
                password, // pre-save hook will hash this
                role: role === 'Contractor' ? 'Contractor' : 'Worker'
            });
            const savedUser = await newUser.save();

            const newProfile = new Profile({
                userId: savedUser._id,
                fullName: fullName.trim(),
                name: fullName.trim(),
                headline: `${role === 'Contractor' ? 'Contractor & Builder' : 'Skilled Worker'} in ${city || 'India'}`,
                role: savedUser.role,
                industry: industry.trim(),
                workType: workType.trim(),
                location: { city: city.trim(), state: state.trim(), country: 'India' },
                city: city.trim(),
                state: state.trim(),
                contactInfo: { email: normalizedEmail, phone: phone.trim() },
                phone: phone.trim(),
                email: normalizedEmail,
                avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(fullName.trim())}&backgroundColor=0D2F6E&textColor=ffffff`
            });
            const savedProfile = await newProfile.save();

            // Log activity
            await logActivity({
                userId: savedUser._id,
                action: 'AUTH_REGISTER',
                description: `Created account as ${savedUser.role}`,
                req
            });

            // Issue JWT
            const token = jwt.sign(
                { userId: savedUser._id, email: savedUser.email, role: savedUser.role },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            return res.status(201).json({
                message: 'Account successfully created!',
                token,
                user: { id: savedUser._id, email: savedUser.email, role: savedUser.role },
                profile: savedProfile
            });

        } else {
            // Offline Local Mode
            const db = getOfflineDb();
            const existing = db.users.find(u => u.email === normalizedEmail);
            if (existing) {
                return res.status(409).json({ error: 'An account with this email already exists.' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const userId = 'usr_' + Date.now();
            const profileId = 'prf_' + Date.now();

            const offlineUser = {
                _id: userId,
                id: userId,
                email: normalizedEmail,
                password: hashedPassword,
                role: role === 'Contractor' ? 'Contractor' : 'Worker',
                isActive: true,
                createdAt: new Date().toISOString()
            };

            const offlineProfile = {
                _id: profileId,
                id: profileId,
                userId: userId,
                fullName: fullName.trim(),
                name: fullName.trim(),
                headline: `${role === 'Contractor' ? 'Contractor & Builder' : 'Skilled Worker'} in ${city || 'India'}`,
                bio: '',
                role: offlineUser.role,
                industry: industry.trim(),
                workType: workType.trim(),
                skills: [],
                location: { city: city.trim(), state: state.trim(), country: 'India', pincode: '' },
                city: city.trim(),
                state: state.trim(),
                pincode: '',
                contactInfo: { email: normalizedEmail, phone: phone.trim() },
                phone: phone.trim(),
                email: normalizedEmail,
                avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(fullName.trim())}&backgroundColor=0D2F6E&textColor=ffffff`,
                bannerUrl: '',
                availability: 'Available',
                createdAt: new Date().toISOString()
            };

            db.users.push(offlineUser);
            db.profiles.push(offlineProfile);
            saveOfflineDb(db);

            await logActivity({
                userId,
                action: 'AUTH_REGISTER',
                description: `Created account as ${offlineUser.role} (Offline Mode)`,
                req
            });

            const token = jwt.sign(
                { userId, email: normalizedEmail, role: offlineUser.role },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            return res.status(201).json({
                message: 'Account successfully created!',
                token,
                user: { id: userId, email: normalizedEmail, role: offlineUser.role },
                profile: offlineProfile
            });
        }
    } catch (err) {
        console.error('Registration error:', err);
        return res.status(500).json({ error: 'Server error during registration. ' + err.message });
    }
});

// --------------------------------------------------------
// POST /api/auth/login
// Authenticate user by email & password
// --------------------------------------------------------
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (mongoose.connection.readyState === 1) {
            // MongoDB Mode
            const user = await User.findOne({ email: normalizedEmail });
            if (!user) {
                return res.status(401).json({ error: 'Invalid email or password.' });
            }

            const isMatch = await user.comparePassword(password);
            if (!isMatch) {
                return res.status(401).json({ error: 'Invalid email or password.' });
            }

            // Update lastLogin
            user.lastLogin = new Date();
            await user.save();

            // Fetch profile
            let profile = await Profile.findOne({ userId: user._id });
            if (!profile) {
                // If profile missing, create fallback
                profile = await Profile.create({
                    userId: user._id,
                    fullName: user.email.split('@')[0],
                    role: user.role,
                    email: user.email,
                    contactInfo: { email: user.email }
                });
            }

            // Log activity
            await logActivity({
                userId: user._id,
                action: 'AUTH_LOGIN',
                description: 'User logged in successfully',
                req
            });

            const token = jwt.sign(
                { userId: user._id, email: user.email, role: user.role },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            return res.json({
                message: 'Logged in successfully!',
                token,
                user: { id: user._id, email: user.email, role: user.role },
                profile
            });

        } else {
            // Offline Local Mode
            const db = getOfflineDb();
            const user = db.users.find(u => u.email === normalizedEmail);
            if (!user) {
                return res.status(401).json({ error: 'Invalid email or password.' });
            }

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).json({ error: 'Invalid email or password.' });
            }

            user.lastLogin = new Date().toISOString();
            saveOfflineDb(db);

            let profile = db.profiles.find(p => p.userId === user._id || p.userId === user.id);
            if (!profile) {
                profile = {
                    _id: 'prf_' + Date.now(),
                    userId: user._id,
                    fullName: user.email.split('@')[0],
                    role: user.role,
                    email: user.email
                };
                db.profiles.push(profile);
                saveOfflineDb(db);
            }

            await logActivity({
                userId: user._id,
                action: 'AUTH_LOGIN',
                description: 'User logged in successfully (Offline Mode)',
                req
            });

            const token = jwt.sign(
                { userId: user._id, email: user.email, role: user.role },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            return res.json({
                message: 'Logged in successfully!',
                token,
                user: { id: user._id, email: user.email, role: user.role },
                profile
            });
        }
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ error: 'Server error during login. ' + err.message });
    }
});

// --------------------------------------------------------
// GET /api/auth/me
// Returns current authenticated user and profile
// --------------------------------------------------------
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;

        if (mongoose.connection.readyState === 1) {
            const user = await User.findById(userId).select('-password');
            if (!user) {
                return res.status(404).json({ error: 'User account not found.' });
            }
            const profile = await Profile.findOne({ userId });
            return res.json({ user, profile });
        } else {
            const db = getOfflineDb();
            const user = db.users.find(u => u._id === userId || u.id === userId);
            if (!user) {
                return res.status(404).json({ error: 'User account not found.' });
            }
            const { password, ...safeUser } = user;
            const profile = db.profiles.find(p => p.userId === userId);
            return res.json({ user: safeUser, profile });
        }
    } catch (err) {
        console.error('Auth/me error:', err);
        return res.status(500).json({ error: 'Failed to retrieve session info.' });
    }
});

// --------------------------------------------------------
// POST /api/auth/logout
// Logs the logout event
// --------------------------------------------------------
router.post('/logout', authMiddleware, async (req, res) => {
    try {
        await logActivity({
            userId: req.user.userId,
            action: 'AUTH_LOGOUT',
            description: 'User logged out',
            req
        });
        return res.json({ message: 'Logged out successfully.' });
    } catch (err) {
        return res.json({ message: 'Logged out.' });
    }
});

// --------------------------------------------------------
// POST /api/auth/forgot-password
// Sends a 6-digit reset OTP to the user's email (no Supabase needed)
// --------------------------------------------------------
const resetOtps = {}; // In-memory store for password reset OTPs

router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email address is required.' });

        const normalizedEmail = email.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        }

        // Check user exists
        let userExists = false;
        let displayName = 'Professional';
        if (mongoose.connection.readyState === 1) {
            const user = await User.findOne({ email: normalizedEmail });
            if (user) {
                userExists = true;
                const profile = await Profile.findOne({ $or: [{ userId: user._id }, { email: normalizedEmail }] });
                if (profile && profile.fullName) displayName = profile.fullName;
            }
        } else {
            const db = getOfflineDb();
            const user = db.users.find(u => u.email === normalizedEmail);
            if (user) { userExists = true; }
        }

        if (!userExists) {
            return res.status(404).json({ error: 'No account found with this email address.' });
        }

        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60000); // 10 minutes for reset

        // Store in DB and in-memory
        if (mongoose.connection.readyState === 1) {
            await Otp.deleteMany({ identifier: `reset_${normalizedEmail}` });
            await new Otp({ identifier: `reset_${normalizedEmail}`, otp: otpCode, expiresAt }).save();
        } else {
            resetOtps[normalizedEmail] = { otp: otpCode, expiresAt };
        }

        // Send reset email
        const emailResult = await sendOtpEmail(normalizedEmail, otpCode, displayName);

        return res.json({
            message: 'Password reset code sent to your email!',
            email: normalizedEmail,
            simulated: emailResult.simulated,
            devOtp: emailResult.devOtp
        });
    } catch (err) {
        console.error('Forgot password error:', err);
        return res.status(500).json({ error: 'Failed to send reset code: ' + err.message });
    }
});

// --------------------------------------------------------
// POST /api/auth/reset-password
// Verifies reset OTP and updates password
// --------------------------------------------------------
router.post('/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        if (!email || !otp || !newPassword) {
            return res.status(400).json({ error: 'Email, verification code, and new password are all required.' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const trimmedOtp = otp.toString().trim();

        // Verify OTP
        let isValidOtp = false;
        if (mongoose.connection.readyState === 1) {
            const record = await Otp.findOne({ identifier: `reset_${normalizedEmail}`, otp: trimmedOtp });
            if (record && record.expiresAt > new Date()) {
                isValidOtp = true;
                await Otp.deleteOne({ _id: record._id });
            }
        } else {
            const record = resetOtps[normalizedEmail];
            if (record && record.otp === trimmedOtp && record.expiresAt > new Date()) {
                isValidOtp = true;
                delete resetOtps[normalizedEmail];
            }
        }

        if (!isValidOtp) {
            return res.status(400).json({ error: 'Invalid or expired reset code. Please request a new one.' });
        }

        // Update password
        if (mongoose.connection.readyState === 1) {
            const user = await User.findOne({ email: normalizedEmail });
            if (!user) return res.status(404).json({ error: 'User account not found.' });
            user.password = newPassword; // pre-save hook will hash this
            await user.save();
        } else {
            const db = getOfflineDb();
            const user = db.users.find(u => u.email === normalizedEmail);
            if (!user) return res.status(404).json({ error: 'User account not found.' });
            user.password = await require('bcryptjs').hash(newPassword, 10);
            saveOfflineDb(db);
        }

        return res.json({ message: 'Password updated successfully! You can now sign in with your new password.' });
    } catch (err) {
        console.error('Reset password error:', err);
        return res.status(500).json({ error: 'Failed to reset password: ' + err.message });
    }
});

module.exports = router;
