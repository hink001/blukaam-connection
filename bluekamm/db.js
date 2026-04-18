const mongoose = require('mongoose');
require('dotenv').config();

console.log("Database connection module loaded.");

const connectDB = async () => {
    try {
        const connString = process.env.MONGO_URI;
        if (!connString) {
            console.error("No MONGO_URI found in .env file");
            return false;
        }

        // Add 5 second timeout so it doesn't hang in offline mode
        const conn = await mongoose.connect(connString, {
            serverSelectionTimeoutMS: 5000, 
        });
        console.log(`MongoDB Connected: ${conn.connection.host}`);
        return true;
    } catch (error) {
        console.log("No internet or MongoDB connection failed. Running in OFFLINE mode.");
        return false;
    }
};

module.exports = connectDB;
