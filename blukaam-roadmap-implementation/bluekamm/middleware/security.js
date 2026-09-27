const rateLimit = require('express-rate-limit');

// Strict limiter for brute-force-sensitive auth endpoints (login, OTP send/verify, register)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 attempts per IP per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts from this device. Please wait a few minutes and try again.' }
});

// Tighter limiter specifically for OTP requests (avoid SMS/email bombing)
const otpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many verification code requests. Please wait before requesting another code.' }
});

// General-purpose limiter applied to the whole /api surface
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down and try again shortly.' }
});

// Looser limiter for write-heavy but legitimate social actions (posting, commenting, messaging)
const socialWriteLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'You are doing that too often. Please slow down for a few minutes.' }
});

module.exports = { authLimiter, otpLimiter, apiLimiter, socialWriteLimiter };
