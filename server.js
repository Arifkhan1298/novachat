// ========================================================
// CHATNOVA — COMPLETE REAL-TIME MESSAGING PLATFORM BACKEND
// Architecture: Node.js, Express, Socket.IO, MySQL (InnoDB)
// Flat Structure: All files reside directly in root directory
// ========================================================

require('dotenv').config();
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// Environment variables
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'chatnova_secure_jwt_secret_key_2026';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT, 10) || 3306;
const DB_NAME = process.env.DB_NAME || 'chatnova_db';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static frontend files directly from root directory
const uploadsDirectory = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDirectory)) {
    fs.mkdirSync(uploadsDirectory, { recursive: true });
}
app.use('/uploads', express.static(uploadsDirectory));
app.use('/chat/uploads', express.static(uploadsDirectory));
app.use(express.static(__dirname));

// Database connection pool
let pool = null;
let dbConnected = false;
let dbErrorDetail = null;

async function initDatabase() {
    try {
        // Attempt initial connection to MySQL server
        const connection = await mysql.createConnection({
            host: DB_HOST,
            port: DB_PORT,
            user: DB_USER,
            password: DB_PASSWORD
        });

        // Ensure database exists
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await connection.end();

        // Create connection pool to the target database
        pool = mysql.createPool({
            host: DB_HOST,
            port: DB_PORT,
            user: DB_USER,
            password: DB_PASSWORD,
            database: DB_NAME,
            waitForConnections: true,
            connectionLimit: 20,
            queueLimit: 0,
            charset: 'utf8mb4',
            enableKeepAlive: true,
            keepAliveInitialDelay: 10000
        });

        // Verify connection and set generous packet size for media
        const [testResult] = await pool.query('SELECT 1 + 1 AS result');
        await pool.query('SET GLOBAL max_allowed_packet = 67108864').catch(() => {});
        dbConnected = true;
        console.log(`[Database] Successfully connected to MySQL (${DB_NAME}) on ${DB_HOST}:${DB_PORT}`);

        // Run schema check and seed default initial data if needed
        await ensureSchemaAndSeed();
    } catch (err) {
        dbConnected = false;
        dbErrorDetail = err.message;
        console.error(`[Database Error] Could not connect to MySQL:`, err.message);
        console.error(`Please verify that MySQL service is running and credentials in .env are correct.`);
    }
}

async function ensureSchemaAndSeed() {
    if (!pool) return;
    try {
        // Check if users table exists
        const [tables] = await pool.query("SHOW TABLES LIKE 'users'");
        if (tables.length === 0) {
            console.log('[Database] Applying schema.sql...');
            const schemaPath = path.join(__dirname, 'schema.sql');
            if (fs.existsSync(schemaPath)) {
                const schemaSql = fs.readFileSync(schemaPath, 'utf8');
                const statements = schemaSql.split(/;\s*[\r\n]+/).map(s => s.trim()).filter(s => s.length > 0);
                for (const statement of statements) {
                    await pool.query(statement);
                }
                console.log('[Database] schema.sql executed successfully.');
            }
        }

        // Ensure avatar_path columns can store base64 if needed
        await pool.query('ALTER TABLE users MODIFY avatar_path LONGTEXT NULL').catch(() => {});
        await pool.query('ALTER TABLE conversations MODIFY avatar_path LONGTEXT NULL').catch(() => {});

        // Check if default admin & demo users exist
        const [existingUsers] = await pool.query("SELECT id FROM users LIMIT 1");
        if (existingUsers.length === 0) {
            console.log('[Database] Seeding initial demo and admin users...');
            const defaultPasswordHash = await bcrypt.hash('ChatNova@2026', 10);

            // Seed Admin
            const [adminRes] = await pool.query(
                `INSERT INTO users (username, display_name, email, phone_number, password_hash, avatar_path, bio, is_admin)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    'admin',
                    'ChatNova Administrator',
                    'admin@chatnova.io',
                    '+1-555-0100',
                    defaultPasswordHash,
                    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
                    'Platform Administrator & Safety Officer. Here to ensure smooth, secure communications across ChatNova.',
                    true
                ]
            );
            await pool.query(`INSERT INTO user_settings (user_id) VALUES (?)`, [adminRes.insertId]);

            // Seed Demo User 1: Sarah
            const [sarahRes] = await pool.query(
                `INSERT INTO users (username, display_name, email, phone_number, password_hash, avatar_path, bio, is_admin)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    'sarah_design',
                    'Sarah Jenkins',
                    'sarah@chatnova.io',
                    '+1-555-0101',
                    defaultPasswordHash,
                    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
                    'Creative Director & UI/UX Specialist ✨ Crafting beautiful digital experiences with passion.',
                    false
                ]
            );
            await pool.query(`INSERT INTO user_settings (user_id) VALUES (?)`, [sarahRes.insertId]);

            // Seed Demo User 2: Alex
            const [alexRes] = await pool.query(
                `INSERT INTO users (username, display_name, email, phone_number, password_hash, avatar_path, bio, is_admin)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    'alex_dev',
                    'Alex Rivera',
                    'alex@chatnova.io',
                    '+1-555-0102',
                    defaultPasswordHash,
                    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
                    'Senior Cloud Architect & Real-Time Systems Engineer 🚀 Always happy to collaborate on high-scale tech.',
                    false
                ]
            );
            await pool.query(`INSERT INTO user_settings (user_id) VALUES (?)`, [alexRes.insertId]);

            // Seed Demo User 3: Elena
            const [elenaRes] = await pool.query(
                `INSERT INTO users (username, display_name, email, phone_number, password_hash, avatar_path, bio, is_admin)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    'elena_v',
                    'Elena Vance',
                    'elena@chatnova.io',
                    '+1-555-0103',
                    defaultPasswordHash,
                    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150',
                    'AI Researcher & Photography Lover 📸 Exploring the intersection of human empathy and modern technology.',
                    false
                ]
            );
            await pool.query(`INSERT INTO user_settings (user_id) VALUES (?)`, [elenaRes.insertId]);

            // Create mutual contacts between Sarah and Alex
            await pool.query(`INSERT INTO contacts (user_id, contact_user_id) VALUES (?, ?), (?, ?)`, [
                sarahRes.insertId, alexRes.insertId,
                alexRes.insertId, sarahRes.insertId
            ]);

            // Create a sample Direct Conversation
            const [convRes] = await pool.query(
                `INSERT INTO conversations (conversation_type, title, created_by) VALUES ('direct', NULL, ?)`,
                [sarahRes.insertId]
            );
            const convId = convRes.insertId;
            await pool.query(
                `INSERT INTO conversation_members (conversation_id, user_id, member_role) VALUES (?, ?, 'member'), (?, ?, 'member')`,
                [convId, sarahRes.insertId, convId, alexRes.insertId]
            );

            // Add sample messages to Direct Conversation
            const [msg1] = await pool.query(
                `INSERT INTO messages (conversation_id, sender_id, message_type, body, created_at)
                 VALUES (?, ?, 'text', 'Hey Alex! Did you review the new orange & warm-cream theme for ChatNova?', NOW() - INTERVAL 10 MINUTE)`,
                [convId, sarahRes.insertId]
            );
            await pool.query(
                `INSERT INTO messages (conversation_id, sender_id, message_type, body, created_at)
                 VALUES (?, ?, 'text', 'Yes Sarah! The design looks stunning and the real-time latency is under 5ms 🔥', NOW() - INTERVAL 5 MINUTE)`,
                [convId, alexRes.insertId]
            );

            // Create a sample Group: "ChatNova Core Innovators"
            const [grpRes] = await pool.query(
                `INSERT INTO conversations (conversation_type, title, description, avatar_path, created_by)
                 VALUES ('group', 'ChatNova Core Innovators', 'Official collaborative space for design, engineering and product planning.', 'https://images.unsplash.com/photo-1522071823991-b9671e9d7fbe?w=150', ?)`,
                [sarahRes.insertId]
            );
            const grpId = grpRes.insertId;
            await pool.query(
                `INSERT INTO conversation_members (conversation_id, user_id, member_role)
                 VALUES (?, ?, 'owner'), (?, ?, 'admin'), (?, ?, 'member')`,
                [grpId, sarahRes.insertId, grpId, alexRes.insertId, grpId, elenaRes.insertId]
            );
            await pool.query(
                `INSERT INTO messages (conversation_id, sender_id, message_type, body, created_at)
                 VALUES (?, ?, 'text', 'Welcome team to the ChatNova Core group! Feel free to share ideas, files, and voice notes here.', NOW() - INTERVAL 20 MINUTE)`,
                [grpId, sarahRes.insertId]
            );

            console.log('[Database] Demo users and conversations seeded successfully.');
        }
    } catch (err) {
        console.error('[Database Seed Error]:', err.message);
    }
}

// Auth Middleware
async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, SESSION_SECRET);
        if (!pool) {
            return res.status(503).json({ success: false, message: 'Database connection unavailable' });
        }

        const [rows] = await pool.query(
            `SELECT u.id, u.username, u.display_name, u.email, u.phone_number, u.avatar_path, u.bio, u.account_status, u.is_admin
             FROM users u
             JOIN sessions s ON s.user_id = u.id
             WHERE u.id = ? AND s.session_token = ? AND s.expires_at > NOW()`,
            [decoded.userId, token]
        );

        if (rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Session expired or invalidated. Please login again.' });
        }

        if (rows[0].account_status === 'suspended') {
            return res.status(403).json({ success: false, message: 'Your account is suspended. Please contact support.' });
        }

        req.user = rows[0];
        req.token = token;
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid or expired authentication token' });
    }
}

// Admin authorization check
function requireAdmin(req, res, next) {
    if (!req.user || !req.user.is_admin) {
        return res.status(403).json({ success: false, message: 'Administrator access required' });
    }
    next();
}

// ----------------------------------------------------
// REST APIS
// ----------------------------------------------------

// 1. Health & Database Status
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        service: 'ChatNova Real-Time Messaging API',
        version: '1.0.0',
        databaseConnected: dbConnected,
        databaseName: DB_NAME,
        error: dbErrorDetail,
        timestamp: new Date().toISOString()
    });
});

// 2. Auth: Register
app.post('/api/auth/register', async (req, res) => {
    if (!dbConnected || !pool) {
        return res.status(503).json({ success: false, message: 'Database unavailable: ' + (dbErrorDetail || 'Connection failed') });
    }

    const { username, display_name, email, phone_number, password, confirm_password, bio, avatar_path } = req.body;

    if (!username || !display_name || !email || !password) {
        return res.status(400).json({ success: false, message: 'Username, display name, email, and password are required' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();

    if (!/^[a-zA-Z0-9_]{3,30}$/.test(cleanUsername)) {
        return res.status(400).json({ success: false, message: 'Username must be 3-30 characters (letters, numbers, underscores only)' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ success: false, message: 'Please provide a valid email address' });
    }

    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
    }

    if (confirm_password && password !== confirm_password) {
        return res.status(400).json({ success: false, message: 'Passwords do not match' });
    }

    try {
        // Check uniqueness
        const [existing] = await pool.query(
            'SELECT id, username, email FROM users WHERE username = ? OR email = ?',
            [cleanUsername, cleanEmail]
        );

        if (existing.length > 0) {
            const matchUser = existing.find(u => u.username === cleanUsername);
            if (matchUser) {
                return res.status(409).json({ success: false, message: 'This username is already taken. Please choose another.' });
            }
            return res.status(409).json({ success: false, message: 'An account with this email address already exists.' });
        }

        const password_hash = await bcrypt.hash(password, 10);
        const defaultAvatar = avatar_path || `https://ui-avatars.com/api/?name=${encodeURIComponent(display_name)}&background=FF5A0A&color=fff&size=150`;
        const userBio = bio ? bio.trim() : 'Hello! I am using ChatNova to connect, chat, and share.';

        const [userResult] = await pool.query(
            `INSERT INTO users (username, display_name, email, phone_number, password_hash, avatar_path, bio)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [cleanUsername, display_name.trim(), cleanEmail, phone_number || null, password_hash, defaultAvatar, userBio]
        );

        const newUserId = userResult.insertId;

        // Create default settings
        await pool.query(`INSERT INTO user_settings (user_id) VALUES (?)`, [newUserId]);

        // Generate unique token and session
        const token = jwt.sign(
            { userId: newUserId, username: cleanUsername, nonce: crypto.randomBytes(16).toString('hex') },
            SESSION_SECRET,
            { expiresIn: '7d' }
        );
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await pool.query(
            `INSERT INTO sessions (user_id, session_token, ip_address, user_agent, expires_at)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at), ip_address = VALUES(ip_address), user_agent = VALUES(user_agent)`,
            [newUserId, token, req.ip, req.headers['user-agent'] || '', expiresAt]
        );

        // Record audit log
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, details)
             VALUES (?, 'USER_REGISTER', 'users', ?, ?, JSON_OBJECT('username', ?))`,
            [newUserId, newUserId, req.ip, cleanUsername]
        );

        res.status(201).json({
            success: true,
            message: 'Registration successful! Welcome to ChatNova.',
            token,
            user: {
                id: newUserId,
                username: cleanUsername,
                display_name: display_name.trim(),
                email: cleanEmail,
                phone_number: phone_number || null,
                avatar_path: defaultAvatar,
                bio: userBio,
                is_admin: false
            }
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ success: false, message: 'Internal server error during registration', detail: err.message });
    }
});

// 3. Auth: Login
app.post('/api/auth/login', async (req, res) => {
    if (!dbConnected || !pool) {
        return res.status(503).json({ success: false, message: 'Database unavailable: ' + (dbErrorDetail || 'Connection failed') });
    }

    const { identifier, password } = req.body;
    if (!identifier || !password) {
        return res.status(400).json({ success: false, message: 'Email/Username and password are required' });
    }

    const cleanIdentifier = identifier.trim().toLowerCase();

    try {
        const [users] = await pool.query(
            `SELECT id, username, display_name, email, phone_number, password_hash, avatar_path, bio, account_status, is_admin
             FROM users WHERE username = ? OR email = ?`,
            [cleanIdentifier, cleanIdentifier]
        );

        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials. Please verify your details.' });
        }

        const user = users[0];

        if (user.account_status === 'suspended') {
            return res.status(403).json({ success: false, message: 'Your account has been suspended by an administrator.' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials. Please verify your details.' });
        }

        // Generate unique session token
        const token = jwt.sign(
            { userId: user.id, username: user.username, nonce: crypto.randomBytes(16).toString('hex') },
            SESSION_SECRET,
            { expiresIn: '7d' }
        );
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await pool.query(
            `INSERT INTO sessions (user_id, session_token, ip_address, user_agent, expires_at)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at), ip_address = VALUES(ip_address), user_agent = VALUES(user_agent)`,
            [user.id, token, req.ip, req.headers['user-agent'] || '', expiresAt]
        );

        // Update last seen
        await pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [user.id]);

        // Get user settings
        const [settingsRows] = await pool.query('SELECT * FROM user_settings WHERE user_id = ?', [user.id]);
        const settings = settingsRows.length > 0 ? settingsRows[0] : {};

        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                username: user.username,
                display_name: user.display_name,
                email: user.email,
                phone_number: user.phone_number,
                avatar_path: user.avatar_path,
                bio: user.bio,
                is_admin: Boolean(user.is_admin)
            },
            settings
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Internal server error during login' });
    }
});

// 4. Auth: Logout
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM sessions WHERE session_token = ?', [req.token]);
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error logging out' });
    }
});

// 5. Auth: Me
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const [settingsRows] = await pool.query('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
        res.json({
            success: true,
            user: req.user,
            settings: settingsRows[0] || {}
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error retrieving profile' });
    }
});

// 6. Auth: Forgot Password Recovery
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    try {
        const [users] = await pool.query('SELECT id, email FROM users WHERE email = ?', [email.trim().toLowerCase()]);
        if (users.length === 0) {
            // Constant response time to prevent enumeration
            return res.json({ success: true, message: 'If an account exists with this email, recovery instructions have been dispatched.' });
        }

        const user = users[0];
        const resetToken = require('crypto').randomBytes(32).toString('hex');
        const tokenHash = await bcrypt.hash(resetToken, 10);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        await pool.query(
            `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
            [user.id, tokenHash, expiresAt]
        );

        // Log recovery token simulation (accessible for verification and testing)
        console.log(`[Password Reset Token for ${user.email}]: ${resetToken}`);

        res.json({
            success: true,
            message: 'Password recovery token generated and sent to email.',
            resetTokenPreview: resetToken // Provided so user can test the reset workflow easily!
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error initiating password reset' });
    }
});

// 7. Auth: Reset Password
app.post('/api/auth/reset-password', async (req, res) => {
    const { email, reset_token, new_password } = req.body;
    if (!email || !reset_token || !new_password) {
        return res.status(400).json({ success: false, message: 'Email, reset token, and new password are required' });
    }

    try {
        const [users] = await pool.query('SELECT id FROM users WHERE email = ?', [email.trim().toLowerCase()]);
        if (users.length === 0) return res.status(400).json({ success: false, message: 'Invalid token or email' });

        const userId = users[0].id;
        const [tokens] = await pool.query(
            'SELECT id, token_hash FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL AND expires_at > NOW() ORDER BY id DESC LIMIT 1',
            [userId]
        );

        if (tokens.length === 0) {
            return res.status(400).json({ success: false, message: 'No valid or unexpired reset token found' });
        }

        const valid = await bcrypt.compare(reset_token, tokens[0].token_hash);
        if (!valid) {
            return res.status(400).json({ success: false, message: 'Invalid recovery token' });
        }

        const newHash = await bcrypt.hash(new_password, 10);
        await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);
        await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?', [tokens[0].id]);
        await pool.query('DELETE FROM sessions WHERE user_id = ?', [userId]);

        res.json({ success: true, message: 'Password has been updated successfully. Please login with your new password.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error resetting password' });
    }
});

// 8. Users: Search and Discovery (Prominently returns BIO)
app.get('/api/users/search', authenticateToken, async (req, res) => {
    const query = (req.query.q || '').trim();
    if (!query) {
        return res.json({ success: true, users: [] });
    }

    try {
        const [rows] = await pool.query(
            `SELECT u.id, u.username, u.display_name, u.avatar_path, u.bio, u.last_seen_at,
                    (SELECT COUNT(*) FROM contacts WHERE user_id = ? AND contact_user_id = u.id) AS is_contact
             FROM users u
             WHERE (u.username LIKE ? OR u.display_name LIKE ?) AND u.id != ? AND u.account_status = 'active'
             LIMIT 25`,
            [req.user.id, `%${query}%`, `%${query}%`, req.user.id]
        );

        res.json({ success: true, users: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error searching users' });
    }
});

// 9. Users: Get single user profile (with Bio)
app.get('/api/users/:id', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, username, display_name, avatar_path, bio, last_seen_at, created_at
             FROM users WHERE id = ? AND account_status = 'active'`,
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({ success: true, user: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching user' });
    }
});

// 10. Users: Update Profile (Display name, bio, avatar, phone)
app.patch('/api/users/me', authenticateToken, async (req, res) => {
    const { display_name, bio, avatar_path, phone_number } = req.body;

    try {
        const updates = [];
        const params = [];

        if (display_name !== undefined) {
            updates.push('display_name = ?');
            params.push(display_name.trim());
        }
        if (bio !== undefined) {
            updates.push('bio = ?');
            params.push(bio.trim());
        }
        if (avatar_path !== undefined) {
            let avatarUrl = avatar_path.trim();
            // If avatar is base64 data, save to uploads directory
            if (avatarUrl.startsWith('data:image/')) {
                try {
                    const matches = avatarUrl.match(/^data:([A-Za-z-+\/0-9.]+);base64,(.+)$/);
                    if (matches && matches.length === 3) {
                        const mime = matches[1];
                        const base64Data = matches[2];
                        const buffer = Buffer.from(base64Data, 'base64');
                        let ext = '.jpg';
                        if (mime.includes('png')) ext = '.png';
                        else if (mime.includes('webp')) ext = '.webp';
                        else if (mime.includes('gif')) ext = '.gif';

                        const filename = `avatar_${req.user.id}_${Date.now()}${ext}`;
                        const uploadsDir = path.join(__dirname, 'uploads');
                        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
                        fs.writeFileSync(path.join(uploadsDir, filename), buffer);
                        avatarUrl = `/uploads/${filename}`;
                    }
                } catch (saveErr) {
                    console.warn('[Avatar Upload] Falling back to direct URL:', saveErr.message);
                }
            }
            updates.push('avatar_path = ?');
            params.push(avatarUrl);
        }
        if (phone_number !== undefined) {
            updates.push('phone_number = ?');
            params.push(phone_number.trim());
        }

        if (updates.length === 0) {
            return res.json({ success: true, message: 'No fields to update' });
        }

        params.push(req.user.id);
        await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

        // Fetch updated user
        const [updated] = await pool.query(
            'SELECT id, username, display_name, email, phone_number, avatar_path, bio, is_admin FROM users WHERE id = ?',
            [req.user.id]
        );

        res.json({ success: true, message: 'Profile updated successfully', user: updated[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error updating profile' });
    }
});

// 11. Contacts: List contacts
app.get('/api/contacts', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT c.id AS contact_id, u.id, u.username, u.display_name, u.avatar_path, u.bio, u.last_seen_at
             FROM contacts c
             JOIN users u ON u.id = c.contact_user_id
             WHERE c.user_id = ? AND u.account_status = 'active'
             ORDER BY u.display_name ASC`,
            [req.user.id]
        );
        res.json({ success: true, contacts: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching contacts' });
    }
});

// 12. Contacts: Add contact
app.post('/api/contacts', authenticateToken, async (req, res) => {
    const { contact_user_id } = req.body;
    if (!contact_user_id) return res.status(400).json({ success: false, message: 'contact_user_id required' });
    if (parseInt(contact_user_id, 10) === req.user.id) {
        return res.status(400).json({ success: false, message: 'Cannot add yourself as a contact' });
    }

    try {
        await pool.query(
            `INSERT IGNORE INTO contacts (user_id, contact_user_id) VALUES (?, ?)`,
            [req.user.id, contact_user_id]
        );
        res.json({ success: true, message: 'Contact added successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error adding contact' });
    }
});

// 13. Contacts: Remove contact
app.delete('/api/contacts/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM contacts WHERE user_id = ? AND contact_user_id = ?', [req.user.id, req.params.id]);
        res.json({ success: true, message: 'Contact removed' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error removing contact' });
    }
});

// 14. Contacts: Block / Unblock User
app.post('/api/contacts/block', authenticateToken, async (req, res) => {
    const { blocked_user_id } = req.body;
    if (!blocked_user_id) return res.status(400).json({ success: false, message: 'blocked_user_id required' });

    try {
        await pool.query(
            `INSERT IGNORE INTO blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)`,
            [req.user.id, blocked_user_id]
        );
        res.json({ success: true, message: 'User blocked' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error blocking user' });
    }
});

app.post('/api/contacts/unblock', authenticateToken, async (req, res) => {
    const { blocked_user_id } = req.body;
    try {
        await pool.query(
            `DELETE FROM blocks WHERE blocker_user_id = ? AND blocked_user_id = ?`,
            [req.user.id, blocked_user_id]
        );
        res.json({ success: true, message: 'User unblocked' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error unblocking user' });
    }
});

// 15. Conversations: List all conversations for authenticated user
app.get('/api/conversations', authenticateToken, async (req, res) => {
    try {
        const [conversations] = await pool.query(
            `SELECT c.id, c.conversation_type, c.title, c.description, c.avatar_path, c.created_at, c.updated_at,
                    cm.member_role, cm.last_read_message_id,
                    (
                        SELECT JSON_OBJECT(
                            'id', m.id,
                            'body', m.body,
                            'message_type', m.message_type,
                            'sender_id', m.sender_id,
                            'created_at', m.created_at
                        )
                        FROM messages m
                        WHERE m.conversation_id = c.id
                        ORDER BY m.id DESC LIMIT 1
                    ) AS last_message,
                    (
                        SELECT COUNT(*)
                        FROM messages m
                        WHERE m.conversation_id = c.id
                          AND (cm.last_read_message_id IS NULL OR m.id > cm.last_read_message_id)
                          AND m.sender_id != ?
                    ) AS unread_count
             FROM conversations c
             JOIN conversation_members cm ON cm.conversation_id = c.id
             WHERE cm.user_id = ? AND cm.left_at IS NULL
             ORDER BY c.updated_at DESC`,
            [req.user.id, req.user.id]
        );

        // Enhance direct conversations with the counterpart user's details (including Bio!)
        for (const conv of conversations) {
            if (conv.conversation_type === 'direct') {
                const [counterparts] = await pool.query(
                    `SELECT u.id, u.username, u.display_name, u.avatar_path, u.bio, u.last_seen_at
                     FROM conversation_members cm
                     JOIN users u ON u.id = cm.user_id
                     WHERE cm.conversation_id = ? AND cm.user_id != ? LIMIT 1`,
                    [conv.id, req.user.id]
                );
                if (counterparts.length > 0) {
                    conv.other_user = counterparts[0];
                    conv.title = conv.other_user.display_name;
                    conv.avatar_path = conv.other_user.avatar_path;
                    conv.bio = conv.other_user.bio; // Contact text bio attached for clean display!
                }
            } else {
                // Group members count
                const [mCount] = await pool.query(
                    'SELECT COUNT(*) as total FROM conversation_members WHERE conversation_id = ? AND left_at IS NULL',
                    [conv.id]
                );
                conv.member_count = mCount[0].total;
            }
        }

        res.json({ success: true, conversations });
    } catch (err) {
        console.error('Conversations error:', err);
        res.status(500).json({ success: false, message: 'Error retrieving conversations' });
    }
});

// 16. Conversations: Start or retrieve 1-on-1 direct conversation
app.post('/api/conversations/direct', authenticateToken, async (req, res) => {
    const { recipient_id } = req.body;
    if (!recipient_id) return res.status(400).json({ success: false, message: 'recipient_id is required' });

    const targetUserId = parseInt(recipient_id, 10);
    if (targetUserId === req.user.id) {
        return res.status(400).json({ success: false, message: 'Cannot start conversation with yourself' });
    }

    try {
        // Check if direct conversation already exists between both users
        const [existing] = await pool.query(
            `SELECT c.id
             FROM conversations c
             JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
             JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
             WHERE c.conversation_type = 'direct' LIMIT 1`,
            [req.user.id, targetUserId]
        );

        if (existing.length > 0) {
            return res.json({ success: true, conversation_id: existing[0].id, is_new: false });
        }

        // Create new direct conversation in transaction
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const [convRes] = await conn.query(
                `INSERT INTO conversations (conversation_type, created_by) VALUES ('direct', ?)`,
                [req.user.id]
            );
            const convId = convRes.insertId;

            await conn.query(
                `INSERT INTO conversation_members (conversation_id, user_id, member_role)
                 VALUES (?, ?, 'member'), (?, ?, 'member')`,
                [convId, req.user.id, convId, targetUserId]
            );

            await conn.commit();
            conn.release();

            res.status(201).json({ success: true, conversation_id: convId, is_new: true });
        } catch (txnErr) {
            await conn.rollback();
            conn.release();
            throw txnErr;
        }
    } catch (err) {
        console.error('Direct conversation error:', err);
        res.status(500).json({ success: false, message: 'Error creating conversation' });
    }
});

// 17. Conversations: Create Group
app.post('/api/conversations/group', authenticateToken, async (req, res) => {
    const { title, description, member_ids, avatar_path } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'Group title is required' });

    try {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const defaultGroupAvatar = avatar_path || `https://ui-avatars.com/api/?name=${encodeURIComponent(title)}&background=FF7A1A&color=fff&size=150`;

            const [convRes] = await conn.query(
                `INSERT INTO conversations (conversation_type, title, description, avatar_path, created_by)
                 VALUES ('group', ?, ?, ?, ?)`,
                [title.trim(), description || '', defaultGroupAvatar, req.user.id]
            );
            const convId = convRes.insertId;

            // Add creator as owner
            await conn.query(
                `INSERT INTO conversation_members (conversation_id, user_id, member_role) VALUES (?, ?, 'owner')`,
                [convId, req.user.id]
            );

            // Add other members
            if (Array.isArray(member_ids)) {
                for (const memberId of member_ids) {
                    if (parseInt(memberId, 10) !== req.user.id) {
                        await conn.query(
                            `INSERT IGNORE INTO conversation_members (conversation_id, user_id, member_role) VALUES (?, ?, 'member')`,
                            [convId, parseInt(memberId, 10)]
                        );
                    }
                }
            }

            // Group system greeting message
            await conn.query(
                `INSERT INTO messages (conversation_id, sender_id, message_type, body)
                 VALUES (?, ?, 'system', ?)`,
                [convId, req.user.id, `${req.user.display_name} created the group "${title.trim()}"`]
            );

            await conn.commit();
            conn.release();

            res.status(201).json({ success: true, conversation_id: convId });
        } catch (txnErr) {
            await conn.rollback();
            conn.release();
            throw txnErr;
        }
    } catch (err) {
        console.error('Group create error:', err);
        res.status(500).json({ success: false, message: 'Error creating group' });
    }
});

// 18. Conversations: Get Details & Members
app.get('/api/conversations/:id', authenticateToken, async (req, res) => {
    const convId = parseInt(req.params.id, 10);
    try {
        // Validate access
        const [memCheck] = await pool.query(
            'SELECT member_role FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL',
            [convId, req.user.id]
        );
        if (memCheck.length === 0) {
            return res.status(403).json({ success: false, message: 'You are not a participant in this conversation' });
        }

        const [convRows] = await pool.query('SELECT * FROM conversations WHERE id = ?', [convId]);
        if (convRows.length === 0) return res.status(404).json({ success: false, message: 'Conversation not found' });

        const conv = convRows[0];

        // Fetch members with bios!
        const [members] = await pool.query(
            `SELECT u.id, u.username, u.display_name, u.avatar_path, u.bio, u.last_seen_at, cm.member_role, cm.joined_at
             FROM conversation_members cm
             JOIN users u ON u.id = cm.user_id
             WHERE cm.conversation_id = ? AND cm.left_at IS NULL
             ORDER BY cm.member_role = 'owner' DESC, cm.member_role = 'admin' DESC, u.display_name ASC`,
            [convId]
        );

        conv.members = members;
        res.json({ success: true, conversation: conv });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching conversation details' });
    }
});

// 19. Messages: Get History with Attachments & Reactions
app.get('/api/conversations/:id/messages', authenticateToken, async (req, res) => {
    const convId = parseInt(req.params.id, 10);
    const limit = parseInt(req.query.limit, 10) || 50;
    const beforeId = req.query.before ? parseInt(req.query.before, 10) : null;

    try {
        // Verify membership
        const [member] = await pool.query(
            'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL',
            [convId, req.user.id]
        );
        if (member.length === 0) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        let query = `
            SELECT m.id, m.conversation_id, m.sender_id, m.message_type, m.body, m.reply_to_message_id,
                   m.is_edited, m.created_at, m.edited_at,
                   u.username AS sender_username, u.display_name AS sender_display_name, u.avatar_path AS sender_avatar,
                   r.body AS reply_body, ru.display_name AS reply_sender_name
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            LEFT JOIN messages r ON r.id = m.reply_to_message_id
            LEFT JOIN users ru ON ru.id = r.sender_id
            WHERE m.conversation_id = ? AND m.deleted_at IS NULL
        `;
        const params = [convId];

        if (beforeId) {
            query += ` AND m.id < ?`;
            params.push(beforeId);
        }

        query += ` ORDER BY m.id DESC LIMIT ?`;
        params.push(limit);

        const [messages] = await pool.query(query, params);
        messages.reverse(); // Chronological order

        // Fetch attachments for these messages
        if (messages.length > 0) {
            const messageIds = messages.map(m => m.id);
            const [attachments] = await pool.query(
                `SELECT id, message_id, original_filename, mime_type, file_size, media_duration, file_data
                 FROM message_attachments WHERE message_id IN (?)`,
                [messageIds]
            );

            // Fetch reactions
            const [reactions] = await pool.query(
                `SELECT mr.message_id, mr.reaction, mr.user_id, u.display_name
                 FROM message_reactions mr
                 JOIN users u ON u.id = mr.user_id
                 WHERE mr.message_id IN (?)`,
                [messageIds]
            );

            // Fetch receipts
            const [receipts] = await pool.query(
                `SELECT message_id, user_id, delivered_at, read_at
                 FROM message_receipts WHERE message_id IN (?)`,
                [messageIds]
            );

            messages.forEach(msg => {
                msg.attachments = attachments.filter(a => a.message_id === msg.id);
                msg.reactions = reactions.filter(r => r.message_id === msg.id);
                msg.receipts = receipts.filter(rc => rc.message_id === msg.id);
            });
        }

        res.json({ success: true, messages });
    } catch (err) {
        console.error('Message history error:', err);
        res.status(500).json({ success: false, message: 'Error retrieving messages' });
    }
});

// 20. Messages: Send Message
app.post('/api/conversations/:id/messages', authenticateToken, async (req, res) => {
    const convId = parseInt(req.params.id, 10);
    const { body, message_type = 'text', reply_to_message_id, attachment } = req.body;

    if (!body && !attachment) {
        return res.status(400).json({ success: false, message: 'Message content or attachment is required' });
    }

    try {
        // Membership check
        const [member] = await pool.query(
            'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL',
            [convId, req.user.id]
        );
        if (member.length === 0) {
            return res.status(403).json({ success: false, message: 'You are not authorized to post in this conversation' });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            let effectiveMsgType = message_type;
            if (attachment && attachment.mime_type) {
                if (attachment.mime_type.startsWith('video/')) effectiveMsgType = 'video';
                else if (attachment.mime_type.startsWith('image/')) effectiveMsgType = 'image';
                else if (attachment.mime_type.startsWith('audio/')) effectiveMsgType = 'audio';
            }

            const [msgResult] = await conn.query(
                `INSERT INTO messages (conversation_id, sender_id, message_type, body, reply_to_message_id)
                 VALUES (?, ?, ?, ?, ?)`,
                [convId, req.user.id, effectiveMsgType, body || '', reply_to_message_id || null]
            );
            const msgId = msgResult.insertId;

            let savedAttachment = null;

            if (attachment && attachment.file_data) {
                let fileUrl = attachment.file_data;

                // Adjust message_type if it is a video
                if (attachment.mime_type && attachment.mime_type.startsWith('video/')) {
                    effectiveMsgType = 'video';
                } else if (attachment.mime_type && attachment.mime_type.startsWith('image/')) {
                    effectiveMsgType = 'image';
                }

                // If attachment is base64, save to uploads folder to keep database fast & lightweight
                if (typeof attachment.file_data === 'string' && attachment.file_data.startsWith('data:')) {
                    try {
                        const matches = attachment.file_data.match(/^data:([A-Za-z-+\/0-9.]+);base64,(.+)$/);
                        if (matches && matches.length === 3) {
                            const mime = matches[1];
                            const base64Data = matches[2];
                            const buffer = Buffer.from(base64Data, 'base64');

                            let ext = '.bin';
                            if (mime.includes('image/jpeg')) ext = '.jpg';
                            else if (mime.includes('image/png')) ext = '.png';
                            else if (mime.includes('image/gif')) ext = '.gif';
                            else if (mime.includes('image/webp')) ext = '.webp';
                            else if (mime.includes('video/mp4')) ext = '.mp4';
                            else if (mime.includes('video/webm')) ext = '.webm';
                            else if (mime.includes('video/quicktime')) ext = '.mov';
                            else if (mime.includes('audio/webm')) ext = '.weba';
                            else if (mime.includes('audio/ogg')) ext = '.ogg';
                            else if (mime.includes('audio/mpeg') || mime.includes('audio/mp3')) ext = '.mp3';
                            else if (mime.includes('pdf')) ext = '.pdf';
                            else {
                                const origExt = path.extname(attachment.original_filename || '');
                                if (origExt) ext = origExt;
                            }

                            const filename = `media_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
                            const uploadsDir = path.join(__dirname, 'uploads');
                            if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
                            fs.writeFileSync(path.join(uploadsDir, filename), buffer);

                            fileUrl = `/uploads/${filename}`;
                        }
                    } catch (fsErr) {
                        console.warn('[Attachment Storage] Falling back to direct data:', fsErr.message);
                    }
                }

                const storageKey = `att_${Date.now()}_${Math.random().toString(36).substring(7)}`;
                const [attResult] = await conn.query(
                    `INSERT INTO message_attachments (message_id, storage_key, original_filename, mime_type, file_size, media_duration, file_data)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        msgId,
                        storageKey,
                        attachment.original_filename || 'file',
                        attachment.mime_type || 'application/octet-stream',
                        attachment.file_size || 0,
                        attachment.media_duration || null,
                        fileUrl
                    ]
                );
                savedAttachment = {
                    id: attResult.insertId,
                    message_id: msgId,
                    original_filename: attachment.original_filename,
                    mime_type: attachment.mime_type,
                    file_size: attachment.file_size,
                    media_duration: attachment.media_duration,
                    file_data: fileUrl
                };
            }

            // Update conversation updated_at
            await conn.query('UPDATE conversations SET updated_at = NOW() WHERE id = ?', [convId]);

            // Update sender's last read
            await conn.query(
                'UPDATE conversation_members SET last_read_message_id = ? WHERE conversation_id = ? AND user_id = ?',
                [msgId, convId, req.user.id]
            );

            await conn.commit();
            conn.release();

            // Construct full message payload
            const fullMessage = {
                id: msgId,
                conversation_id: convId,
                sender_id: req.user.id,
                sender_username: req.user.username,
                sender_display_name: req.user.display_name,
                sender_avatar: req.user.avatar_path,
                message_type,
                body: body || '',
                reply_to_message_id: reply_to_message_id || null,
                is_edited: false,
                created_at: new Date().toISOString(),
                attachments: savedAttachment ? [savedAttachment] : [],
                reactions: [],
                receipts: []
            };

            // Emit to conversation room via Socket.IO
            io.to(`conversation:${convId}`).emit('message:new', fullMessage);

            res.status(201).json({ success: true, message: fullMessage });
        } catch (txnErr) {
            await conn.rollback();
            conn.release();
            throw txnErr;
        }
    } catch (err) {
        console.error('Send message error:', err);
        res.status(500).json({ success: false, message: 'Error sending message' });
    }
});

// 21. Messages: Edit Message
app.patch('/api/messages/:id', authenticateToken, async (req, res) => {
    const msgId = parseInt(req.params.id, 10);
    const { body } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ success: false, message: 'Message body cannot be empty' });

    try {
        const [rows] = await pool.query('SELECT sender_id, conversation_id FROM messages WHERE id = ?', [msgId]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Message not found' });
        if (rows[0].sender_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Cannot edit another user\'s message' });
        }

        await pool.query(
            'UPDATE messages SET body = ?, is_edited = TRUE, edited_at = NOW() WHERE id = ?',
            [body.trim(), msgId]
        );

        io.to(`conversation:${rows[0].conversation_id}`).emit('message:updated', {
            id: msgId,
            conversation_id: rows[0].conversation_id,
            body: body.trim(),
            is_edited: true,
            edited_at: new Date().toISOString()
        });

        res.json({ success: true, message: 'Message updated' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error editing message' });
    }
});

// 22. Messages: Delete Message
app.delete('/api/messages/:id', authenticateToken, async (req, res) => {
    const msgId = parseInt(req.params.id, 10);
    const forAll = req.query.for_all === 'true';

    try {
        const [rows] = await pool.query('SELECT sender_id, conversation_id FROM messages WHERE id = ?', [msgId]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Message not found' });

        if (forAll) {
            if (rows[0].sender_id !== req.user.id && !req.user.is_admin) {
                return res.status(403).json({ success: false, message: 'Only sender or admin can delete for all' });
            }
            await pool.query('UPDATE messages SET deleted_at = NOW(), deleted_for_all = TRUE WHERE id = ?', [msgId]);

            io.to(`conversation:${rows[0].conversation_id}`).emit('message:deleted', {
                id: msgId,
                conversation_id: rows[0].conversation_id,
                for_all: true
            });
        } else {
            // Soft delete for current sender
            await pool.query('UPDATE messages SET deleted_at = NOW() WHERE id = ? AND sender_id = ?', [msgId, req.user.id]);
            res.json({ success: true, message: 'Message deleted for you' });
            return;
        }

        res.json({ success: true, message: 'Message deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error deleting message' });
    }
});

// 23. Messages: React to Message
app.post('/api/messages/:id/reactions', authenticateToken, async (req, res) => {
    const msgId = parseInt(req.params.id, 10);
    const { reaction } = req.body;
    if (!reaction) return res.status(400).json({ success: false, message: 'Reaction emoji required' });

    try {
        const [msg] = await pool.query('SELECT conversation_id FROM messages WHERE id = ?', [msgId]);
        if (msg.length === 0) return res.status(404).json({ success: false, message: 'Message not found' });

        await pool.query(
            `INSERT INTO message_reactions (message_id, user_id, reaction)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE reaction = VALUES(reaction)`,
            [msgId, req.user.id, reaction]
        );

        io.to(`conversation:${msg[0].conversation_id}`).emit('message:reaction', {
            message_id: msgId,
            conversation_id: msg[0].conversation_id,
            user_id: req.user.id,
            user_display_name: req.user.display_name,
            reaction
        });

        res.json({ success: true, message: 'Reaction recorded' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error recording reaction' });
    }
});

// 24. Conversations: Mark as Read
app.post('/api/conversations/:id/read', authenticateToken, async (req, res) => {
    const convId = parseInt(req.params.id, 10);
    try {
        const [lastMsg] = await pool.query(
            'SELECT id FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1',
            [convId]
        );

        if (lastMsg.length > 0) {
            const lastId = lastMsg[0].id;
            await pool.query(
                'UPDATE conversation_members SET last_read_message_id = ? WHERE conversation_id = ? AND user_id = ?',
                [lastId, convId, req.user.id]
            );

            // Record read receipt
            await pool.query(
                `INSERT INTO message_receipts (message_id, user_id, read_at)
                 VALUES (?, ?, NOW())
                 ON DUPLICATE KEY UPDATE read_at = NOW()`,
                [lastId, req.user.id]
            );

            io.to(`conversation:${convId}`).emit('message:read', {
                conversation_id: convId,
                user_id: req.user.id,
                last_read_message_id: lastId
            });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error marking conversation as read' });
    }
});

// 25. Settings: Get & Update User Settings
app.get('/api/settings', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
        res.json({ success: true, settings: rows[0] || {} });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching settings' });
    }
});

app.patch('/api/settings', authenticateToken, async (req, res) => {
    const { theme, online_visibility, profile_visibility, read_receipts_enabled, sound_enabled } = req.body;
    try {
        await pool.query(
            `UPDATE user_settings
             SET theme = COALESCE(?, theme),
                 online_visibility = COALESCE(?, online_visibility),
                 profile_visibility = COALESCE(?, profile_visibility),
                 read_receipts_enabled = COALESCE(?, read_receipts_enabled),
                 sound_enabled = COALESCE(?, sound_enabled)
             WHERE user_id = ?`,
            [theme, online_visibility, profile_visibility, read_receipts_enabled, sound_enabled, req.user.id]
        );

        const [updated] = await pool.query('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
        res.json({ success: true, settings: updated[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error saving settings' });
    }
});

// 26. Calls: History & Logging
app.get('/api/calls/history', authenticateToken, async (req, res) => {
    try {
        const [calls] = await pool.query(
            `SELECT c.*,
                    u_init.display_name AS initiator_name, u_init.avatar_path AS initiator_avatar,
                    u_rec.display_name AS recipient_name, u_rec.avatar_path AS recipient_avatar
             FROM calls c
             JOIN users u_init ON u_init.id = c.initiator_id
             LEFT JOIN users u_rec ON u_rec.id = c.recipient_id
             WHERE c.initiator_id = ? OR c.recipient_id = ?
             ORDER BY c.started_at DESC LIMIT 50`,
            [req.user.id, req.user.id]
        );
        res.json({ success: true, calls });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching call history' });
    }
});

app.post('/api/calls/log', authenticateToken, async (req, res) => {
    const { recipient_id, call_type = 'audio', call_status = 'ended', duration_seconds = 0 } = req.body;
    try {
        const [result] = await pool.query(
            `INSERT INTO calls (initiator_id, recipient_id, call_type, call_status, duration_seconds, ended_at)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [req.user.id, recipient_id || null, call_type, call_status, duration_seconds]
        );
        res.json({ success: true, call_id: result.insertId });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error logging call' });
    }
});

// 27. Notifications: List & Read
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const [notifications] = await pool.query(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50',
            [req.user.id]
        );
        res.json({ success: true, notifications });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching notifications' });
    }
});

app.post('/api/notifications/read-all', authenticateToken, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE user_id = ?', [req.user.id]);
        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error updating notifications' });
    }
});

// 28. Reports: Submit Report
app.post('/api/reports', authenticateToken, async (req, res) => {
    const { reported_user_id, reported_message_id, reason, description } = req.body;
    if (!reason) return res.status(400).json({ success: false, message: 'Reason is required' });

    try {
        await pool.query(
            `INSERT INTO reports (reporter_id, reported_user_id, reported_message_id, reason, description)
             VALUES (?, ?, ?, ?, ?)`,
            [req.user.id, reported_user_id || null, reported_message_id || null, reason, description || '']
        );
        res.json({ success: true, message: 'Report submitted. Our moderation team will review it.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error submitting report' });
    }
});

// 29. Admin: Statistics & Management
app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [[{ total_users }]] = await pool.query('SELECT COUNT(*) AS total_users FROM users');
        const [[{ active_users }]] = await pool.query('SELECT COUNT(*) AS active_users FROM users WHERE last_seen_at >= NOW() - INTERVAL 24 HOUR');
        const [[{ total_conversations }]] = await pool.query('SELECT COUNT(*) AS total_conversations FROM conversations');
        const [[{ total_messages }]] = await pool.query('SELECT COUNT(*) AS total_messages FROM messages');
        const [[{ pending_reports }]] = await pool.query("SELECT COUNT(*) AS pending_reports FROM reports WHERE report_status = 'pending'");

        res.json({
            success: true,
            stats: {
                total_users,
                active_users,
                total_conversations,
                total_messages,
                pending_reports
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching stats' });
    }
});

app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [users] = await pool.query(
            'SELECT id, username, display_name, email, bio, account_status, is_admin, created_at, last_seen_at FROM users ORDER BY id ASC'
        );
        res.json({ success: true, users });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching users for admin' });
    }
});

app.patch('/api/admin/users/:id/status', authenticateToken, requireAdmin, async (req, res) => {
    const { status } = req.body;
    if (!['active', 'suspended'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    try {
        await pool.query('UPDATE users SET account_status = ? WHERE id = ?', [status, req.params.id]);
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
             VALUES (?, 'USER_STATUS_CHANGE', 'users', ?, JSON_OBJECT('new_status', ?))`,
            [req.user.id, req.params.id, status]
        );
        res.json({ success: true, message: `User status changed to ${status}` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error updating user status' });
    }
});

app.get('/api/admin/reports', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [reports] = await pool.query(
            `SELECT r.*,
                    u_rep.display_name AS reporter_name,
                    u_tgt.display_name AS target_user_name,
                    m.body AS reported_message_body
             FROM reports r
             JOIN users u_rep ON u_rep.id = r.reporter_id
             LEFT JOIN users u_tgt ON u_tgt.id = r.reported_user_id
             LEFT JOIN messages m ON m.id = r.reported_message_id
             ORDER BY r.created_at DESC`
        );
        res.json({ success: true, reports });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching reports' });
    }
});

app.get('/api/admin/audit-logs', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [logs] = await pool.query(
            `SELECT a.*, u.display_name AS user_name
             FROM audit_logs a
             LEFT JOIN users u ON u.id = a.user_id
             ORDER BY a.created_at DESC LIMIT 100`
        );
        res.json({ success: true, logs });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching audit logs' });
    }
});

// ----------------------------------------------------
// SOCKET.IO REAL-TIME COMMUNICATION
// ----------------------------------------------------

const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    maxHttpBufferSize: 5e7 // 50MB for voice/attachments
});

// Map of userId -> Set of socketIds (supports multi-tab presence without premature offline)
const userSockets = new Map();

// Socket authentication middleware
io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
        return next(new Error('Authentication token required'));
    }

    try {
        const decoded = jwt.verify(token, SESSION_SECRET);
        socket.userId = decoded.userId;
        socket.username = decoded.username;
        next();
    } catch (err) {
        return next(new Error('Invalid token'));
    }
});

io.on('connection', async (socket) => {
    const userId = socket.userId;

    // Track multi-tab presence
    if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket.id);

    // Join personal user notification room
    socket.join(`user:${userId}`);

    // Update last_seen_at in MySQL
    if (pool) {
        pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [userId]).catch(() => {});
    }

    // Broadcast online status to all connected users
    io.emit('presence:update', { userId, status: 'online' });

    // Join authorized conversation rooms
    socket.on('conversation:join', async (convId) => {
        try {
            if (pool) {
                const [check] = await pool.query(
                    'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL',
                    [convId, userId]
                );
                if (check.length > 0) {
                    socket.join(`conversation:${convId}`);
                }
            }
        } catch (err) {
            console.error('Room join error:', err);
        }
    });

    socket.on('conversation:leave', (convId) => {
        socket.leave(`conversation:${convId}`);
    });

    // Real-Time Typing Indicators
    socket.on('typing:start', ({ conversation_id }) => {
        socket.to(`conversation:${conversation_id}`).emit('typing:start', {
            conversation_id,
            user_id: userId,
            username: socket.username
        });
    });

    socket.on('typing:stop', ({ conversation_id }) => {
        socket.to(`conversation:${conversation_id}`).emit('typing:stop', {
            conversation_id,
            user_id: userId
        });
    });

    // Real-Time WebRTC Call Signaling (Audio & Video)
    socket.on('call:offer', ({ recipient_id, call_type, offer, caller_name, caller_avatar }) => {
        io.to(`user:${recipient_id}`).emit('call:incoming', {
            caller_id: userId,
            caller_name,
            caller_avatar,
            call_type,
            offer
        });
    });

    socket.on('call:answer', ({ recipient_id, answer }) => {
        io.to(`user:${recipient_id}`).emit('call:answered', {
            answer,
            responder_id: userId
        });
    });

    socket.on('call:ice-candidate', ({ recipient_id, candidate }) => {
        io.to(`user:${recipient_id}`).emit('call:ice-candidate', {
            candidate,
            sender_id: userId
        });
    });

    socket.on('call:reject', ({ recipient_id, reason }) => {
        io.to(`user:${recipient_id}`).emit('call:rejected', {
            reason: reason || 'declined',
            responder_id: userId
        });
    });

    socket.on('call:end', ({ recipient_id }) => {
        io.to(`user:${recipient_id}`).emit('call:ended', {
            ended_by: userId
        });
    });

    // Disconnect handling
    socket.on('disconnect', () => {
        const userSet = userSockets.get(userId);
        if (userSet) {
            userSet.delete(socket.id);
            if (userSet.size === 0) {
                userSockets.delete(userId);
                // User has no remaining open tabs/devices: set offline and update last_seen_at
                if (pool) {
                    pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [userId]).catch(() => {});
                }
                io.emit('presence:update', { userId, status: 'offline', last_seen_at: new Date().toISOString() });
            }
        }
    });
});

// Fallback: serve index.html for root path or SPA navigation
app.get('*', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send('ChatNova server is running. Frontend index.html is being prepared...');
    }
});

// Start Server & Database Initialization
server.listen(PORT, async () => {
    console.log(`====================================================`);
    console.log(`🚀 ChatNova Server active at: http://localhost:${PORT}`);
    console.log(`📡 Socket.IO Real-Time Engine ready`);
    console.log(`====================================================`);
    await initDatabase();
});

// Export server and pool for test suites
module.exports = { app, server, getPool: () => pool };
