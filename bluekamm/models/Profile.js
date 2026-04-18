const mongoose = require('mongoose');

const ProfileSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    phone: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String, // Made optional
        trim: true,
        lowercase: true
    },
    workType: {
        type: String, // For workers
        trim: true
    },
    industry: {
        type: String, // For both
        trim: true
    },
    skills: {
        type: [String], // Array for multiple skills (workers)
        default: []
    },
    companyName: {
        type: String, // For contractors
        trim: true
    },
    city: {
        type: String,
        trim: true
    },
    state: {
        type: String,
        trim: true
    },
    pincode: {
        type: String,
        trim: true
    },
    role: {
        type: String,
        enum: ['Worker', 'Contractor'],
        default: 'Worker',
        required: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Profile', ProfileSchema);
