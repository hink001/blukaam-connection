const mongoose = require('mongoose');

const OtpSchema = new mongoose.Schema({
    identifier: { type: String, required: true }, // Phone number or Email
    otp: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: { expires: '5m' } } // Auto deletes document after 5 mins
});

module.exports = mongoose.model('Otp', OtpSchema);
