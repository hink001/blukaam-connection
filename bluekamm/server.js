const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('./db');
const Profile = require('./models/Profile');
const GeneralData = require('./models/GeneralData');
const User = require('./models/User');
const ActivityLog = require('./models/ActivityLog');

// Route modules
const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const activityRoutes = require('./routes/activityRoutes');
const { isCloudinaryConfigured } = require('./services/cloudinary');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Create totally offline/local databases 
const DB_FILE = path.join(__dirname, 'local_database.json');
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], profiles: [], activityLogs: [], generalData: [] }));
} else {
    try {
        const db = JSON.parse(fs.readFileSync(DB_FILE));
        if (!db.users) db.users = [];
        if (!db.profiles) db.profiles = [];
        if (!db.activityLogs) db.activityLogs = [];
        if (!db.generalData) db.generalData = [];
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], profiles: [], activityLogs: [], generalData: [] }));
    }
}
console.log("Local JSON Database initialized at:", DB_FILE);

let isMongoConnected = false;

// Sync offline data to MongoDB
const syncDataToMongo = async () => {
    try {
        const db = JSON.parse(fs.readFileSync(DB_FILE));
        let synced = 0;
        
        if (db.users && db.users.length > 0) {
            for (const u of db.users) {
                const exists = await User.findOne({ email: u.email });
                if (!exists) {
                    await User.create(u);
                    synced++;
                }
            }
            db.users = [];
        }

        if (db.profiles && db.profiles.length > 0) {
            for (const p of db.profiles) {
                const exists = await Profile.findOne({ $or: [{ phone: p.phone }, { email: p.email }, { userId: p.userId }] });
                if (!exists) {
                    await Profile.create(p);
                    synced++;
                }
            }
            db.profiles = [];
        }
        
        if (db.generalData && db.generalData.length > 0) {
            await GeneralData.insertMany(db.generalData.map(item => ({ data: item.data })));
            synced += db.generalData.length;
            db.generalData = [];
        }

        if (synced > 0) {
            fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
            console.log(`Synced ${synced} offline records to MongoDB!`);
        }
    } catch (e) {
        console.error("Sync failed:", e.message);
    }
};

mongoose.connection.on('connected', () => {
    isMongoConnected = true;
    syncDataToMongo();
});

mongoose.connection.on('disconnected', () => {
    console.log("MongoDB Disconnected. Falling back to offline mode.");
    isMongoConnected = false;
});

// Connect to MongoDB
connectDB();

// Serve static frontend files
const frontendPath = path.join(__dirname, '..');
app.use(express.static(frontendPath));

// API Status & health check
app.get('/api/status', (req, res) => {
    res.json({
        message: isMongoConnected ? 'Backend running on MongoDB Atlas!' : 'Backend running on Offline Local JSON Store!',
        status: 'OK',
        database: isMongoConnected ? 'MongoDB' : 'Offline JSON',
        cloudinaryConfigured: isCloudinaryConfigured,
        photoStorage: isCloudinaryConfigured ? 'Cloudinary (Cloud CDN)' : 'Cloud Data-URI (Zero local storage)'
    });
});

// --- LinkedIn-Style Profile & Auth API Routes --- //
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/activities', activityRoutes);

// --- Legacy OTP Routes (Retained for compatibility) --- //
const Otp = require('./models/Otp');
const jwt = require('jsonwebtoken');
const offlineOtps = {};
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-blukaam-key';

app.post('/api/auth/send-otp', async (req, res) => {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ error: 'Phone or email is required' });

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`\n============================`);
    console.log(`💬 MOCK OTP INTERCEPTED:`);
    console.log(`To: ${identifier}`);
    console.log(`Your BluKaam OTP is: ${otpCode}`);
    console.log(`============================\n`);

    const expiresAt = new Date(Date.now() + 5 * 60000);

    try {
        if (isMongoConnected) {
            await Otp.deleteMany({ identifier });
            await new Otp({ identifier, otp: otpCode, expiresAt }).save();
        } else {
            offlineOtps[identifier] = { otp: otpCode, expiresAt };
        }
        res.json({ message: "OTP sent successfully" });
    } catch (e) {
        console.error("OTP generation error:", e);
        res.status(500).json({ error: 'Server error generating OTP' });
    }
});

app.post('/api/auth/verify-otp', async (req, res) => {
    const { identifier, otp } = req.body;
    
    try {
        let isValid = false;
        if (isMongoConnected) {
            const record = await Otp.findOne({ identifier, otp });
            if (record && record.expiresAt > new Date()) {
                isValid = true;
                await Otp.deleteOne({ _id: record._id }); 
            }
        } else {
            const record = offlineOtps[identifier];
            if (record && record.otp === otp && record.expiresAt > new Date()) {
                isValid = true;
                delete offlineOtps[identifier];
            }
        }

        if (isValid) {
            const token = jwt.sign({ identifier }, JWT_SECRET, { expiresIn: '7d' });
            let profileData = null;
            if (isMongoConnected) {
                profileData = await Profile.findOne({ $or: [{ phone: identifier }, { email: identifier }] });
            } else {
                const db = JSON.parse(fs.readFileSync(DB_FILE));
                profileData = db.profiles.find(p => p.phone === identifier || p.email === identifier);
            }
            res.json({ token, isNewUser: !profileData, profile: profileData });
        } else {
            res.status(400).json({ error: "Invalid or expired OTP" });
        }
    } catch(e) {
        console.error("OTP verification error:", e);
        res.status(500).json({ error: 'Server error verifying OTP' });
    }
});

// Legacy profiles and general routes
app.post('/api/profiles', async (req, res) => {
    try {
        const googleScriptUrl = "https://script.google.com/macros/s/AKfycbyVOgUtAwri4_lCjD3l4iz8k3uwLQrRw-xOapEjTRka31Cus39w8lbO9MH8mKbAWD5m/exec";
        try {
            fetch(googleScriptUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            }).then(() => console.log("Sent successfully to Google Sheets!"))
              .catch(e => console.error("Google Sheets API error:", e));
        } catch (err) {}

        if (isMongoConnected) {
            const newProfile = new Profile(req.body);
            const savedProfile = await newProfile.save();
            return res.status(201).json(savedProfile);
        } else {
            const db = JSON.parse(fs.readFileSync(DB_FILE));
            const newProfile = { ...req.body, offline_id: Date.now() };
            db.profiles.push(newProfile);
            fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
            return res.status(201).json(newProfile);
        }
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/general', async (req, res) => {
    try {
        if (isMongoConnected) {
            const newData = new GeneralData({ data: req.body });
            const savedData = await newData.save();
            return res.status(201).json(savedData);
        } else {
            const db = JSON.parse(fs.readFileSync(DB_FILE));
            const newData = { data: req.body, offline_id: Date.now() };
            db.generalData.push(newData);
            fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
            return res.status(201).json(newData);
        }
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
