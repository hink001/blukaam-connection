const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
// Ensure .env is loaded regardless of current working directory
const envPaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'bluekamm', '.env')
];
for (const p of envPaths) {
    if (fs.existsSync(p)) {
        require('dotenv').config({ path: p });
    }
}

const connectDB = require('./db');
const Profile = require('./models/Profile');
const GeneralData = require('./models/GeneralData');
const User = require('./models/User');
const ActivityLog = require('./models/ActivityLog');

// Route modules
const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const activityRoutes = require('./routes/activityRoutes');
const postRoutes = require('./routes/postRoutes');               // Phase 1: Social Feed & Posts
const connectionRoutes = require('./routes/connectionRoutes');   // Phase 2: Networking & Connections
const messageRoutes = require('./routes/messageRoutes');         // Phase 5: Direct Messaging
const notificationRoutes = require('./routes/notificationRoutes'); // Phase 5: Notifications
const { isCloudinaryConfigured } = require('./services/cloudinary');
const { apiLimiter, authLimiter, otpLimiter, socialWriteLimiter } = require('./middleware/security'); // Phase 4: Security hardening

const app = express();
const PORT = process.env.PORT || 3000;

// --------------------------------------------------------
// Phase 4: Security headers (clickjacking / MIME sniffing / basic XSS protection)
// crossOriginResourcePolicy relaxed so images/CDN assets keep loading exactly as before.
// --------------------------------------------------------
app.use(helmet({
    contentSecurityPolicy: false, // left disabled to avoid breaking existing inline scripts/CDN usage
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
}));

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Phase 4: General rate limiting across the whole API surface
app.use('/api', apiLimiter);

// Create totally offline/local databases 
const DB_FILE = path.join(__dirname, 'local_database.json');
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], profiles: [], activityLogs: [], generalData: [], posts: [], connections: [], messages: [], notifications: [] }));
} else {
    try {
        const db = JSON.parse(fs.readFileSync(DB_FILE));
        if (!db.users) db.users = [];
        if (!db.profiles) db.profiles = [];
        if (!db.activityLogs) db.activityLogs = [];
        if (!db.generalData) db.generalData = [];
        if (!db.posts) db.posts = [];
        if (!db.connections) db.connections = [];
        if (!db.messages) db.messages = [];
        if (!db.notifications) db.notifications = [];
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], profiles: [], activityLogs: [], generalData: [], posts: [], connections: [], messages: [], notifications: [] }));
    }
}
console.log("Local JSON Database initialized at:", DB_FILE);

let isMongoConnected = false;

// Sync offline data to MongoDB
const syncDataToMongo = async () => {
    try {
        const db = JSON.parse(fs.readFileSync(DB_FILE));
        let synced = 0;
        const idMap = {}; // Maps offline "usr_..." strings to MongoDB ObjectIds
        
        if (db.users && db.users.length > 0) {
            for (const u of db.users) {
                const exists = await User.findOne({ email: u.email });
                if (!exists) {
                    const userData = { ...u };
                    const oldId = userData._id || userData.id;
                    delete userData._id;
                    delete userData.id;
                    const created = await User.create(userData);
                    if (oldId) idMap[oldId] = created._id;
                    synced++;
                } else {
                    const oldId = u._id || u.id;
                    if (oldId) idMap[oldId] = exists._id;
                }
            }
            db.users = [];
        }

        if (db.profiles && db.profiles.length > 0) {
            for (const p of db.profiles) {
                const profileData = { ...p };
                delete profileData._id;
                delete profileData.id;

                if (profileData.userId && idMap[profileData.userId]) {
                    profileData.userId = idMap[profileData.userId];
                } else if (profileData.userId && typeof profileData.userId === 'string' && profileData.userId.startsWith('usr_')) {
                    const linkedUser = await User.findOne({ email: profileData.email });
                    if (linkedUser) {
                        profileData.userId = linkedUser._id;
                    } else {
                        delete profileData.userId;
                    }
                }

                const query = [];
                if (profileData.phone) query.push({ phone: profileData.phone });
                if (profileData.email) query.push({ email: profileData.email });
                if (profileData.userId) query.push({ userId: profileData.userId });

                let exists = null;
                if (query.length > 0) {
                    exists = await Profile.findOne({ $or: query });
                }

                if (!exists) {
                    await Profile.create(profileData);
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
app.use('/api/auth/send-otp', otpLimiter);
app.use('/api/auth/verify-otp', authLimiter);
app.use('/api/auth/send-email-otp', otpLimiter);
app.use('/api/auth/verify-email-register', authLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/activities', activityRoutes);

// --- Roadmap Phase 1 / 2 / 5 modules --- //
app.use('/api/posts', socialWriteLimiter, postRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/messages', socialWriteLimiter, messageRoutes);
app.use('/api/notifications', notificationRoutes);

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
