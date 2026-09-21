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
        const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
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
        return res.status(500).json({ error: 'Failed to send verification code. ' + err.message });
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

module.exports = router;
