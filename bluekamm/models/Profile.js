const mongoose = require('mongoose');

const ProfileSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    fullName: {
        type: String,
        required: [true, 'Full name is required'],
        trim: true
    },
    // Retain name for backward compatibility
    name: {
        type: String,
        trim: true
    },
    headline: {
        type: String,
        default: 'Skilled Professional at BluKaam',
        trim: true
    },
    bio: {
        type: String,
        default: '',
        trim: true
    },
    // Location
    location: {
        city: { type: String, trim: true, default: '' },
        state: { type: String, trim: true, default: '' },
        country: { type: String, trim: true, default: 'India' },
        pincode: { type: String, trim: true, default: '' }
    },
    // Backwards-compatible location fields
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },

    // Professional & Skills
    role: {
        type: String,
        enum: ['Worker', 'Contractor'],
        default: 'Worker'
    },
    workType: {
        type: String,
        trim: true,
        default: ''
    },
    industry: {
        type: String,
        trim: true,
        default: ''
    },
    companyName: {
        type: String,
        trim: true,
        default: ''
    },
    experienceYears: {
        type: Number,
        default: 0
    },
    skills: {
        type: [String],
        default: []
    },
    availability: {
        type: String,
        enum: ['Available', 'Busy', 'On Job', 'Not Looking'],
        default: 'Available'
    },

    // Contact Information
    contactInfo: {
        phone: { type: String, trim: true, default: '' },
        email: { type: String, trim: true, default: '' },
        website: { type: String, trim: true, default: '' },
        linkedin: { type: String, trim: true, default: '' },
        github: { type: String, trim: true, default: '' }
    },
    // Backwards-compatible contact fields
    phone: { type: String, trim: true },
    email: { type: String, trim: true },

    // Images (Stored via Cloudinary or URL)
    avatarUrl: {
        type: String,
        default: ''
    },
    bannerUrl: {
        type: String,
        default: ''
    },
    isVerified: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Sync fullName and name before save
ProfileSchema.pre('save', function(next) {
    if (this.fullName && !this.name) this.name = this.fullName;
    if (this.name && !this.fullName) this.fullName = this.name;
    if (this.location) {
        if (this.location.city && !this.city) this.city = this.location.city;
        if (this.location.state && !this.state) this.state = this.location.state;
        if (this.location.pincode && !this.pincode) this.pincode = this.location.pincode;
    }
    if (this.contactInfo) {
        if (this.contactInfo.phone && !this.phone) this.phone = this.contactInfo.phone;
        if (this.contactInfo.email && !this.email) this.email = this.contactInfo.email;
    }
    next();
});

module.exports = mongoose.model('Profile', ProfileSchema);
