/**
 * Role-Based Access Control middleware.
 * Use AFTER authMiddleware, since it reads req.user.role (set by the JWT payload).
 *
 * Example:
 *   router.delete('/some-admin-only-route', authMiddleware, requireRole('Admin'), handler);
 */
const requireRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return res.status(401).json({ error: 'Access denied. No authenticated role found.' });
        }
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: `Access denied. Requires one of: ${allowedRoles.join(', ')}.` });
        }
        next();
    };
};

module.exports = { requireRole };
