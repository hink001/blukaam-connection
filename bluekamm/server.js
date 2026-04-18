const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('./db');
const Profile = require('./models/Profile');
const GeneralData = require('./models/GeneralData');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Create totally offline/local databases 
const DB_FILE = path.join(__dirname, 'local_database.json');
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ profiles: [], generalData: [] }));
}
console.log("Local JSON Database initialized at:", DB_FILE);

let isMongoConnected = false;

// Sync offline data to MongoDB
const syncDataToMongo = async () => {
    try {
        const db = JSON.parse(fs.readFileSync(DB_FILE));
        let synced = 0;
        
        if (db.profiles.length > 0) {
            await Profile.insertMany(db.profiles);
            synced += db.profiles.length;
            db.profiles = []; // Clear offline pool
        }
        
        if (db.generalData.length > 0) {
            await GeneralData.insertMany(db.generalData.map(item => ({ data: item.data })));
            synced += db.generalData.length;
            db.generalData = []; // Clear offline pool
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

// Try connecting
connectDB();

const frontendPath = path.join(__dirname, '..');
app.use(express.static(frontendPath));

app.get('/api/status', (req, res) => {
    res.json({ message: isMongoConnected ? 'Backend running on MongoDB!' : 'Backend running on Offline Local JSON!', status: 'OK' });
});

// --- Authentication & OTP Routes --- //
const Otp = require('./models/Otp');
const jwt = require('jsonwebtoken');

const offlineOtps = {}; // Fallback for no-internet local mode
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-blukaam-key';

// Route 1: Send OTP
app.post('/api/auth/send-otp', async (req, res) => {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ error: 'Phone or email is required' });

    // Generate random 6 digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Simulate sending OTP via SMS/Email by printing to console
    console.log(`\n============================`);
    console.log(`💬 MOCK OTP INTERCEPTED:`);
    console.log(`To: ${identifier}`);
    console.log(`Your BluKaam OTP is: ${otpCode}`);
    console.log(`============================\n`);

    const expiresAt = new Date(Date.now() + 5 * 60000); // Expires in 5 minutes

    try {
        if (isMongoConnected) {
            await Otp.deleteMany({ identifier }); // Clear any old OTPs
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

// Route 2: Verify OTP
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
            // Issue Security Token
            const token = jwt.sign({ identifier }, JWT_SECRET, { expiresIn: '7d' });
            
            // Check if profile exists already
            let profileExists = false;
            let profileData = null;
            if (isMongoConnected) {
                profileData = await Profile.findOne({ $or: [{ phone: identifier }, { email: identifier }] });
                profileExists = !!profileData;
            } else {
                const db = JSON.parse(fs.readFileSync(DB_FILE));
                profileData = db.profiles.find(p => p.phone === identifier || p.email === identifier);
                profileExists = !!profileData;
            }

            res.json({ token, isNewUser: !profileExists, profile: profileData });
        } else {
            res.status(400).json({ error: "Invalid or expired OTP" });
        }
    } catch(e) {
        console.error("OTP verification error:", e);
        res.status(500).json({ error: 'Server error verifying OTP' });
    }
});


app.post('/api/profiles', async (req, res) => {
    try {
        // Automatically forward data to the Google Sheet Apps Script URL
        const googleScriptUrl = "https://script.google.com/macros/s/AKfycbyVOgUtAwri4_lCjD3l4iz8k3uwLQrRw-xOapEjTRka31Cus39w8lbO9MH8mKbAWD5m/exec";
        try {
            fetch(googleScriptUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            }).then(() => console.log("Sent successfully to Google Sheets!"))
              .catch(e => console.error("Google Sheets API error:", e));
        } catch (err) {
            console.error("Could not send to Google Sheets:", err);
        }

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
