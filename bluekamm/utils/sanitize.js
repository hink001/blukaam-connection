/**
 * Lightweight text sanitizer used on every piece of user-generated content
 * (posts, comments, messages, profile fields) before it is stored or echoed
 * back to other users. Strips HTML tags/scripts and trims dangerous protocol
 * handlers so stored content can never execute in another user's browser.
 *
 * Uses the `sanitize-html` package under the hood (see package.json changes).
 */
const sanitizeHtml = require('sanitize-html');

/**
 * Strips all HTML/JS — used for plain-text fields like post content,
 * comments, chat messages, headlines, bios.
 * @param {String} input
 * @returns {String}
 */
function cleanText(input) {
    if (input === null || input === undefined) return input;
    const str = String(input);
    return sanitizeHtml(str, {
        allowedTags: [],
        allowedAttributes: {},
        disallowedTagsMode: 'discard'
    }).trim();
}

/**
 * Recursively cleans every string value in a plain object (shallow arrays included).
 * Non-string values (numbers, booleans, dates, nested objects/arrays) are preserved.
 * @param {Object} obj
 * @returns {Object}
 */
function cleanObjectStrings(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
        return obj.map(item => (typeof item === 'string' ? cleanText(item) : cleanObjectStrings(item)));
    }
    const out = {};
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (typeof val === 'string') {
            out[key] = cleanText(val);
        } else if (typeof val === 'object' && val !== null) {
            out[key] = cleanObjectStrings(val);
        } else {
            out[key] = val;
        }
    }
    return out;
}

module.exports = { cleanText, cleanObjectStrings };
