const Notification = require('../models/Notification');

/** Never throws; a failed notification must not break the business action. */
async function notify({ userId, type, fromUserId = null, fromName = '', entityId = null, message, link = '' }) {
    try {
        if (!userId || (fromUserId && String(userId) === String(fromUserId))) return null;
        // The existing notification routes store/query ids as strings (taken from the JWT), so match that.
        const str = (v) => (v === null || v === undefined) ? null : String(v);
        return await Notification.create({ userId: str(userId), type, fromUserId: str(fromUserId), fromName, entityId: str(entityId), message, link });
    } catch (e) {
        console.error('notify failed:', e.message);
        return null;
    }
}
module.exports = { notify };
