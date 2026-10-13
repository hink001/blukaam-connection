const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-blukaam-key';

/**
 * Authenticates the bearer token, then re-loads the user from the database so the
 * role is the *stored* role, never a stale or browser-supplied one.
 * The marketplace needs atomic updates, so it requires a live MongoDB connection.
 */
const authDb = async (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'Marketplace is temporarily unavailable. Please try again shortly.' });
    }
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    let decoded;
    try {
        decoded = jwt.verify(header.split(' ')[1], JWT_SECRET);
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired session token. Please log in again.' });
    }
    if (!decoded.userId || !mongoose.Types.ObjectId.isValid(decoded.userId)) {
        return res.status(401).json({ error: 'Invalid session. Please log in again.' });
    }
    try {
        const user = await User.findById(decoded.userId).select('email role isActive').lean();
        if (!user || user.isActive === false) {
            return res.status(401).json({ error: 'Account not found or disabled.' });
        }
        req.user = { userId: String(user._id), email: user.email, role: user.role };
        next();
    } catch (e) {
        return res.status(500).json({ error: 'Could not verify your account.' });
    }
};

const requireRole = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: `This action is only available to ${roles.join(' / ')} accounts.` });
    }
    next();
};

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { authDb, requireRole, isId, escapeRegex };
