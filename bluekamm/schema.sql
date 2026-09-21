-- ====================================================================
-- BluKaam Connection - Production SQL Database Schema
-- Compatible with: PostgreSQL (Supabase / Neon), MySQL / MariaDB, SQLite
-- ====================================================================

-- -----------------------------------------------------
-- Table: users
-- Stores authentication, credentials, and account status
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'Worker', -- 'Worker', 'Contractor', 'Admin'
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for instant user lookup by email during login
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- -----------------------------------------------------
-- Table: profiles
-- LinkedIn-style profile details linked 1-to-1 with users
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    headline VARCHAR(255) DEFAULT 'Skilled Professional at BluKaam',
    bio TEXT,
    
    -- Location
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100) DEFAULT 'India',
    pincode VARCHAR(20),
    
    -- Skills & Work
    skills TEXT, -- JSON Array string e.g. ["Wiring", "MCB Installation", "Solar Panel"]
    role VARCHAR(50) NOT NULL DEFAULT 'Worker',
    industry VARCHAR(100),
    work_type VARCHAR(100),
    company_name VARCHAR(255),
    experience_years INT DEFAULT 0,
    availability VARCHAR(50) DEFAULT 'Available', -- 'Available', 'Busy', 'On Job', 'Not Looking'

    -- Contact Info
    phone VARCHAR(30),
    email VARCHAR(255),
    website VARCHAR(255),
    linkedin VARCHAR(255),
    github VARCHAR(255),

    -- Media (Cloudinary CDN URLs)
    avatar_url VARCHAR(500) DEFAULT '',
    banner_url VARCHAR(500) DEFAULT '',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_profile_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
);

-- Profiles indexes for search and filtering
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_city ON profiles(city);
CREATE INDEX IF NOT EXISTS idx_profiles_industry ON profiles(industry);

-- -----------------------------------------------------
-- Table: activity_logs
-- Logs key user events for activity monitoring and feed
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_logs (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    action VARCHAR(80) NOT NULL, -- 'AUTH_REGISTER', 'AUTH_LOGIN', 'PROFILE_UPDATE', 'AVATAR_UPDATE', etc.
    description TEXT NOT NULL,
    metadata TEXT, -- JSON string containing changed field details
    ip_address VARCHAR(60),
    user_agent VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_activity_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
);

-- Activity log indexes for high-speed feed generation
CREATE INDEX IF NOT EXISTS idx_activity_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_logs(action);

-- -----------------------------------------------------
-- Sample View: Member Public Profile with Activity Count
-- -----------------------------------------------------
CREATE OR REPLACE VIEW v_member_summary AS
SELECT 
    p.id AS profile_id,
    p.user_id,
    p.full_name,
    p.headline,
    p.avatar_url,
    p.city,
    p.state,
    p.role,
    p.availability,
    u.email,
    u.created_at AS member_since,
    COUNT(a.id) AS total_activities
FROM profiles p
JOIN users u ON p.user_id = u.id
LEFT JOIN activity_logs a ON a.user_id = u.id
GROUP BY p.id, p.user_id, p.full_name, p.headline, p.avatar_url, p.city, p.state, p.role, p.availability, u.email, u.created_at;
