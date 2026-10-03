const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const Profile = require('../models/Profile');
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');
const { uploadImageBuffer } = require('../services/cloudinary');
const { logActivity } = require('../services/activityService');

const DB_FILE = path.join(__dirname, '..', 'local_database.json');

// Offline helper
const getOfflineDb = () => {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], profiles: [], activityLogs: [] }));
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.profiles) data.profiles = [];
    return data;
};

const saveOfflineDb = (data) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
};

// --------------------------------------------------------
// GET /api/profile/me
// Get current authenticated user's profile
// --------------------------------------------------------
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;

        if (mongoose.connection.readyState === 1) {
            let profile = await Profile.findOne({ userId });
            if (!profile) {
                profile = await Profile.create({
                    userId,
                    fullName: req.user.email.split('@')[0],
                    role: req.user.role || 'Worker',
                    email: req.user.email,
                    contactInfo: { email: req.user.email }
                });
            }
            return res.json(profile);
        } else {
            const db = getOfflineDb();
            let profile = db.profiles.find(p => p.userId === userId);
            if (!profile) {
                profile = {
                    _id: 'prf_' + Date.now(),
                    userId,
                    fullName: req.user.email.split('@')[0],
                    role: req.user.role || 'Worker',
                    email: req.user.email,
                    contactInfo: { email: req.user.email }
                };
                db.profiles.push(profile);
                saveOfflineDb(db);
            }
            return res.json(profile);
        }
    } catch (err) {
        console.error('Fetch profile/me error:', err);
        return res.status(500).json({ error: 'Failed to retrieve profile.' });
    }
});

// --------------------------------------------------------
// PUT /api/profile/me
// Update profile fields (Full Name, Headline, Bio, Location, Skills, Contact Info)
// --------------------------------------------------------
router.put('/me', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.user;
        const updates = req.body;

        const allowedUpdates = [
            'fullName',
            'headline',
            'bio',
            'location',
            'skills',
            'contactInfo',
            'workType',
            'industry',
            'companyName',
            'experienceYears',
            'availability',
            'bannerUrl'
        ];

        const changedKeys = [];
        const sanitizedUpdates = {};

        for (const key of allowedUpdates) {
            if (updates[key] !== undefined) {
                sanitizedUpdates[key] = updates[key];
                changedKeys.push(key);
            }
        }

        // Sync helper fields
        if (sanitizedUpdates.fullName) sanitizedUpdates.name = sanitizedUpdates.fullName;
        if (sanitizedUpdates.location) {
            if (sanitizedUpdates.location.city) sanitizedUpdates.city = sanitizedUpdates.location.city;
            if (sanitizedUpdates.location.state) sanitizedUpdates.state = sanitizedUpdates.location.state;
            if (sanitizedUpdates.location.pincode) sanitizedUpdates.pincode = sanitizedUpdates.location.pincode;
        }
        if (sanitizedUpdates.contactInfo) {
            if (sanitizedUpdates.contactInfo.phone) sanitizedUpdates.phone = sanitizedUpdates.contactInfo.phone;
            if (sanitizedUpdates.contactInfo.email) sanitizedUpdates.email = sanitizedUpdates.contactInfo.email;
        }

        if (mongoose.connection.readyState === 1) {
            const updatedProfile = await Profile.findOneAndUpdate(
                { userId },
                { $set: sanitizedUpdates },
                { new: true, runValidators: true, upsert: true }
            );

            // Log activity
            await logActivity({
                userId,
                action: 'PROFILE_UPDATE',
                description: `Updated profile details (${changedKeys.join(', ')})`,
                metadata: { updatedFields: changedKeys },
                req
            });

            return res.json({
                message: 'Profile updated successfully!',
                profile: updatedProfile
            });
        } else {
            const db = getOfflineDb();
            let profileIndex = db.profiles.findIndex(p => p.userId === userId);
            
            if (profileIndex === -1) {
                const newProfile = {
                    _id: 'prf_' + Date.now(),
                    userId,
                    ...sanitizedUpdates,
                    updatedAt: new Date().toISOString()
                };
                db.profiles.push(newProfile);
                saveOfflineDb(db);
                profileIndex = db.profiles.length - 1;
            } else {
                db.profiles[profileIndex] = {
                    ...db.profiles[profileIndex],
                    ...sanitizedUpdates,
                    updatedAt: new Date().toISOString()
                };
                saveOfflineDb(db);
            }

            await logActivity({
                userId,
                action: 'PROFILE_UPDATE',
                description: `Updated profile details (${changedKeys.join(', ')}) (Offline Mode)`,
                metadata: { updatedFields: changedKeys },
                req
            });

            return res.json({
                message: 'Profile updated successfully!',
                profile: db.profiles[profileIndex]
            });
        }
    } catch (err) {
        console.error('Update profile/me error:', err);
        return res.status(500).json({ error: 'Failed to update profile. ' + err.message });
    }
});

// --------------------------------------------------------
// POST /api/profile/me/avatar
// Upload profile photo directly to Cloudinary (No local disk storage)
// --------------------------------------------------------
router.post('/me/avatar', authMiddleware, upload.single('avatar'), async (req, res) => {
    try {
        const { userId } = req.user;

        if (!req.file) {
            return res.status(400).json({ error: 'No image file uploaded.' });
        }

        // Upload buffer directly to Cloudinary
        const avatarUrl = await uploadImageBuffer(req.file.buffer, 'blukaam/profiles');

        if (mongoose.connection.readyState === 1) {
            const updatedProfile = await Profile.findOneAndUpdate(
                { userId },
                { $set: { avatarUrl } },
                { new: true, upsert: true }
            );

            // Log activity
            await logActivity({
                userId,
                action: 'AVATAR_UPDATE',
                description: 'Updated profile picture to cloud storage',
                metadata: { avatarUrl },
                req
            });

            return res.json({
                message: 'Profile photo updated successfully!',
                avatarUrl,
                profile: updatedProfile
            });
        } else {
            const db = getOfflineDb();
            const profile = db.profiles.find(p => p.userId === userId);
            if (profile) {
                profile.avatarUrl = avatarUrl;
                profile.updatedAt = new Date().toISOString();
                saveOfflineDb(db);
            }

            await logActivity({
                userId,
                action: 'AVATAR_UPDATE',
                description: 'Updated profile picture to cloud storage (Offline Mode)',
                metadata: { avatarUrl },
                req
            });

            return res.json({
                message: 'Profile photo updated successfully!',
                avatarUrl,
                profile
            });
        }
    } catch (err) {
        console.error('Avatar upload error:', err);
        return res.status(500).json({ error: 'Failed to upload profile photo. ' + err.message });
    }
});

// --------------------------------------------------------
// GET /api/profile/public/:idOrSlug
// View public profile by userId or profileId
// --------------------------------------------------------
router.get('/public/:idOrSlug', async (req, res) => {
    try {
        const { idOrSlug } = req.params;

        if (mongoose.connection.readyState === 1) {
            let profile = null;

            if (mongoose.Types.ObjectId.isValid(idOrSlug)) {
                // Check by userId first, then profileId
                profile = await Profile.findOne({ userId: idOrSlug });
                if (!profile) {
                    profile = await Profile.findById(idOrSlug);
                }
            }

            if (!profile) {
                // Try finding by name regex
                profile = await Profile.findOne({
                    fullName: new RegExp('^' + idOrSlug.replace(/-/g, ' '), 'i')
                });
            }

            if (!profile) {
                return res.status(404).json({ error: 'Profile not found.' });
            }

            // Record view activity if target has userId
            if (profile.userId) {
                logActivity({
                    userId: profile.userId,
                    action: 'PROFILE_VIEW',
                    description: 'Public profile viewed',
                    req
                }).catch(() => {});
            }

            return res.json(profile);
        } else {
            const db = getOfflineDb();
            const profile = db.profiles.find(
                p => p.userId === idOrSlug || p._id === idOrSlug || p.id === idOrSlug
            );

            if (!profile) {
                return res.status(404).json({ error: 'Profile not found.' });
            }

            return res.json(profile);
        }
    } catch (err) {
        console.error('Public profile fetch error:', err);
        return res.status(500).json({ error: 'Failed to retrieve public profile.' });
    }
});

// --------------------------------------------------------
// GET /api/profile/list
// Search & filter profiles (by keyword, role, city, skill)
// --------------------------------------------------------
router.get('/list', async (req, res) => {
    try {
        const { search, role, city, skill } = req.query;

        if (mongoose.connection.readyState === 1) {
            const filter = {};
            if (role) filter.role = role;
            if (city) filter['location.city'] = new RegExp(city, 'i');
            if (skill) filter.skills = new RegExp(skill, 'i');
            if (search) {
                filter.$or = [
                    { fullName: new RegExp(search, 'i') },
                    { headline: new RegExp(search, 'i') },
                    { skills: new RegExp(search, 'i') }
                ];
            }

            const profiles = await Profile.find(filter).sort({ updatedAt: -1 }).limit(50);
            return res.json(profiles);
        } else {
            const db = getOfflineDb();
            let results = [...db.profiles];

            if (role) results = results.filter(p => p.role === role);
            if (city) results = results.filter(p => (p.location?.city || p.city || '').toLowerCase().includes(city.toLowerCase()));
            if (skill) results = results.filter(p => (p.skills || []).some(s => s.toLowerCase().includes(skill.toLowerCase())));
            if (search) {
                const s = search.toLowerCase();
                results = results.filter(p => 
                    (p.fullName || '').toLowerCase().includes(s) ||
                    (p.headline || '').toLowerCase().includes(s) ||
                    (p.skills || []).some(sk => sk.toLowerCase().includes(s))
                );
            }

            return res.json(results);
        }
    } catch (err) {
        console.error('List profiles error:', err);
        return res.status(500).json({ error: 'Failed to search profiles.' });
    }
});

module.exports = router;
