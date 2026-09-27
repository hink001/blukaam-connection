const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

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

console.log("Database connection module loaded.");

const connectDB = async () => {
    try {
        const connString = process.env.MONGO_URI;
        if (!connString) {
            console.error("❌ No MONGO_URI found in .env file. Checked paths:", envPaths);
            return false;
        }

        // Add 5 second timeout so it doesn't hang in offline mode
        const conn = await mongoose.connect(connString, {
            serverSelectionTimeoutMS: 5000, 
        });
        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
        return true;
    } catch (error) {
        console.error(`❌ MongoDB connection failed: ${error.message}`);
        console.log("ℹ️ Running in OFFLINE mode (using local_database.json fallback).");
        return false;
    }
};

module.exports = connectDB;

