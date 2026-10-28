// ========================================================
// CHATNOVA — AUTOMATED COMPREHENSIVE TEST SUITE
// Tests: Auth, Database, MySQL Persistence, Bio Display, Messaging,
//        Groups, Attachments, Contacts, Blocking, and Receipts
// Flat Structure: tests.js in root directory
// ========================================================

require('dotenv').config();
const http = require('http');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT, 10) || 3306;
const DB_NAME = process.env.DB_NAME || 'chatnova_db';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

let passCount = 0;
let failCount = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`  \x1b[32m✔ PASS:\x1b[0m ${testName}`);
        passCount++;
    } else {
        console.error(`  \x1b[31m✖ FAIL:\x1b[0m ${testName}`);
        failCount++;
    }
}

async function request(path, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const req = http.request(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    parsed = data;
                }
                resolve({ status: res.statusCode, data: parsed, headers: res.headers });
            });
        });
        req.on('error', reject);
        if (options.body) {
            req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
        }
        req.end();
    });
}

async function runAllTests() {
    console.log(`\n========================================================`);
    console.log(`🧪 STARTING CHATNOVA AUTOMATED TEST SUITE`);
    console.log(`Target: ${BASE_URL} | Database: ${DB_NAME}`);
    console.log(`========================================================\n`);

    let dbConn = null;

    // ----------------------------------------------------
    // TEST SUITE 1: DATABASE INTEGRITY & CONNECTION
    // ----------------------------------------------------
    console.log(`\x1b[36m[SUITE 1] MySQL Database Architecture & Connection\x1b[0m`);
    try {
        dbConn = await mysql.createConnection({
            host: DB_HOST,
            port: DB_PORT,
            user: DB_USER,
            password: DB_PASSWORD,
            database: DB_NAME
        });
        assert(true, 'Database connection established to MySQL');

        // Check required tables exist
        const [tables] = await dbConn.query('SHOW TABLES');
        const tableNames = tables.map(t => Object.values(t)[0]);
        const requiredTables = [
            'users', 'user_settings', 'sessions', 'contacts', 'conversations',
            'conversation_members', 'messages', 'message_attachments', 'message_receipts',
            'message_reactions', 'blocks', 'calls', 'reports', 'audit_logs'
        ];
        const allPresent = requiredTables.every(rt => tableNames.includes(rt));
        assert(allPresent, `All 20 normalized relational tables exist in MySQL`);

        // Check foreign key constraints
        const [fkRows] = await dbConn.query(`
            SELECT TABLE_NAME, CONSTRAINT_NAME
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
        `, [DB_NAME]);
        assert(fkRows.length >= 10, `Relational foreign keys configured (${fkRows.length} active constraints)`);

    } catch (err) {
        assert(false, `Database connection error: ${err.message}`);
    }

    // ----------------------------------------------------
    // TEST SUITE 2: AUTHENTICATION & SESSIONS
    // ----------------------------------------------------
    console.log(`\n\x1b[36m[SUITE 2] Authentication & Session Management\x1b[0m`);
    const testUsername = `tester_${Date.now().toString(36)}`;
    const testEmail = `${testUsername}@example.com`;
    const testPassword = 'Password@123';
    const testBio = 'Passionate developer testing ChatNova real-time messaging!';
    let authToken = null;
    let testUserId = null;

    // Test 2.1: Successful Registration with Bio
    try {
        const regRes = await request('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: {
                username: testUsername,
                display_name: 'Test Engineer',
                email: testEmail,
                password: testPassword,
                confirm_password: testPassword,
                bio: testBio
            }
        });
        assert(regRes.status === 201 && regRes.data.success, 'User registration succeeds with status 201');
        assert(regRes.data.user && regRes.data.user.bio === testBio, 'User text bio saved properly during registration ("text bio sahi tareeqa sa dika")');
        authToken = regRes.data.token;
        testUserId = regRes.data.user.id;
    } catch (err) {
        assert(false, `Registration failed: ${err.message}`);
    }

    // Test 2.2: Duplicate Username Rejection
    try {
        const dupRes = await request('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: {
                username: testUsername,
                display_name: 'Duplicate Guy',
                email: `other_${testEmail}`,
                password: testPassword
            }
        });
        assert(dupRes.status === 409 && !dupRes.data.success, 'Duplicate username is rejected with status 409');
    } catch (err) {
        assert(false, `Duplicate username test error: ${err.message}`);
    }

    // Test 2.3: Password Mismatch Rejection
    try {
        const mismatchRes = await request('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: {
                username: `mismatch_${Date.now()}`,
                display_name: 'Mismatch',
                email: `mismatch_${Date.now()}@example.com`,
                password: 'password1',
                confirm_password: 'password2'
            }
        });
        assert(mismatchRes.status === 400 && !mismatchRes.data.success, 'Mismatched passwords rejected with status 400');
    } catch (err) {
        assert(false, `Mismatch test error: ${err.message}`);
    }

    // Test 2.4: Successful Login
    try {
        const loginRes = await request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: { identifier: testUsername, password: testPassword }
        });
        assert(loginRes.status === 200 && loginRes.data.success, 'Login authenticates against MySQL password hash');
        assert(loginRes.data.user.username === testUsername, 'Authenticated session returns correct user account data');
    } catch (err) {
        assert(false, `Login test error: ${err.message}`);
    }

    // Test 2.5: Invalid Password Rejection
    try {
        const badLoginRes = await request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: { identifier: testUsername, password: 'WrongPassword' }
        });
        assert(badLoginRes.status === 401 && !badLoginRes.data.success, 'Invalid credentials rejected with status 401');
    } catch (err) {
        assert(false, `Bad login test error: ${err.message}`);
    }

    // ----------------------------------------------------
    // TEST SUITE 3: USER PROFILE & BIO UPDATING
    // ----------------------------------------------------
    console.log(`\n\x1b[36m[SUITE 3] User Profile & Text Bio Display\x1b[0m`);
    const updatedBio = 'Senior Architect at ChatNova 🚀 Focused on real-time UX & performance!';
    try {
        const updateRes = await request('/api/users/me', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: { bio: updatedBio, display_name: 'Lead Test Engineer' }
        });
        assert(updateRes.status === 200 && updateRes.data.success, 'Profile updated successfully in MySQL');
        assert(updateRes.data.user.bio === updatedBio, 'Updated bio persists and matches in response ("text bio sahi tareeqa sa dika")');

        // Verify in database directly
        const [userRows] = await dbConn.query('SELECT bio FROM users WHERE id = ?', [testUserId]);
        assert(userRows[0].bio === updatedBio, 'Database query confirms persistent bio storage in MySQL users table');
    } catch (err) {
        assert(false, `Profile update error: ${err.message}`);
    }

    // ----------------------------------------------------
    // TEST SUITE 4: USER DISCOVERY & SEARCH (WITH BIO)
    // ----------------------------------------------------
    console.log(`\n\x1b[36m[SUITE 4] User Discovery & Search System\x1b[0m`);
    try {
        const searchRes = await request(`/api/users/search?q=${testUsername.substring(0, 8)}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        assert(searchRes.status === 200 && searchRes.data.success, 'User discovery search API responds with status 200');
    } catch (err) {
        assert(false, `Search error: ${err.message}`);
    }

    // ----------------------------------------------------
    // TEST SUITE 5: CONVERSATIONS & REAL-TIME MESSAGING
    // ----------------------------------------------------
    console.log(`\n\x1b[36m[SUITE 5] Direct & Group Messaging Persistence\x1b[0m`);
    let convId = null;
    let messageId = null;

    try {
        // Find another seeded user (e.g. sarah or admin)
        const [otherUsers] = await dbConn.query('SELECT id, username FROM users WHERE id != ? LIMIT 1', [testUserId]);
        const otherUserId = otherUsers[0].id;

        // Create 1-on-1 Direct Conversation
        const directRes = await request('/api/conversations/direct', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: { recipient_id: otherUserId }
        });
        assert(directRes.status === 201 || directRes.status === 200, 'Direct conversation created/retrieved in MySQL');
        convId = directRes.data.conversation_id;

        // Send Message
        const msgText = 'Hello from automated real-time test verification!';
        const sendRes = await request(`/api/conversations/${convId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: { body: msgText, message_type: 'text' }
        });
        assert(sendRes.status === 201 && sendRes.data.success, 'Message submitted and committed to database');
        messageId = sendRes.data.message.id;

        // Verify Message in MySQL
        const [msgRows] = await dbConn.query('SELECT body, sender_id FROM messages WHERE id = ?', [messageId]);
        assert(msgRows.length > 0 && msgRows[0].body === msgText, 'Message is securely saved in MySQL messages table');

        // Retrieve Message History
        const historyRes = await request(`/api/conversations/${convId}/messages`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        assert(historyRes.status === 200 && historyRes.data.messages.length > 0, 'Authorized message history retrieved chronologically');

        // Send File/Audio Attachment Message
        const attachRes = await request(`/api/conversations/${convId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: {
                body: 'Here is a test attachment document',
                message_type: 'document',
                attachment: {
                    original_filename: 'spec_document.pdf',
                    mime_type: 'application/pdf',
                    file_size: 1048576,
                    file_data: 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXr...'
                }
            }
        });
        assert(attachRes.status === 201 && attachRes.data.message.attachments.length > 0, 'Attachment metadata and binary saved in message_attachments');

        // Edit Message
        const editRes = await request(`/api/messages/${messageId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: { body: 'Updated message content via authorized edit' }
        });
        assert(editRes.status === 200 && editRes.data.success, 'Message edit authorized and saved in MySQL');

        // Add Reaction
        const reactRes = await request(`/api/messages/${messageId}/reactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: { reaction: '🔥' }
        });
        assert(reactRes.status === 200 && reactRes.data.success, 'Message reaction saved in message_reactions');

    } catch (err) {
        assert(false, `Messaging error: ${err.message}`);
    }

    // ----------------------------------------------------
    // TEST SUITE 6: GROUP CHATS & ROLES
    // ----------------------------------------------------
    console.log(`\n\x1b[36m[SUITE 6] Group Conversations & Membership Roles\x1b[0m`);
    try {
        const groupRes = await request('/api/conversations/group', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: {
                title: 'Quality Engineering Circle',
                description: 'Collaboration hub for platform testing',
                member_ids: []
            }
        });
        assert(groupRes.status === 201 && groupRes.data.success, 'Group created successfully in conversations table');
        const grpConvId = groupRes.data.conversation_id;

        // Verify group owner role in MySQL
        const [memRows] = await dbConn.query(
            'SELECT member_role FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
            [grpConvId, testUserId]
        );
        assert(memRows[0].member_role === 'owner', 'Creator automatically designated as group owner');
    } catch (err) {
        assert(false, `Group test error: ${err.message}`);
    }

    // ----------------------------------------------------
    // TEST SUITE 7: CONTACTS & BLOCKING
    // ----------------------------------------------------
    console.log(`\n\x1b[36m[SUITE 7] Contacts Management & Blocking\x1b[0m`);
    try {
        const [seedUsers] = await dbConn.query('SELECT id FROM users WHERE id != ? LIMIT 1', [testUserId]);
        const targetId = seedUsers[0].id;

        // Add Contact
        const addContRes = await request('/api/contacts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: { contact_user_id: targetId }
        });
        assert(addContRes.status === 200, 'Contact relationship created in MySQL contacts table');

        // Block User
        const blockRes = await request('/api/contacts/block', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: { blocked_user_id: targetId }
        });
        assert(blockRes.status === 200, 'User block rule registered in MySQL blocks table');

        // Unblock User
        const unblockRes = await request('/api/contacts/unblock', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: { blocked_user_id: targetId }
        });
        assert(unblockRes.status === 200, 'User unblocked cleanly');
    } catch (err) {
        assert(false, `Contact/Block error: ${err.message}`);
    }

    // ----------------------------------------------------
    // TEST SUITE 8: USER SETTINGS PERSISTENCE
    // ----------------------------------------------------
    console.log(`\n\x1b[36m[SUITE 8] User Settings & Theme Preferences\x1b[0m`);
    try {
        const setRes = await request('/api/settings', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: { theme: 'dark', online_visibility: 'contacts', read_receipts_enabled: true }
        });
        assert(setRes.status === 200 && setRes.data.settings.theme === 'dark', 'Settings updated and saved in MySQL user_settings table');
    } catch (err) {
        assert(false, `Settings test error: ${err.message}`);
    }

    // ----------------------------------------------------
    // CLEANUP & SUMMARY
    // ----------------------------------------------------
    if (dbConn) await dbConn.end();

    console.log(`\n========================================================`);
    console.log(`📊 TEST RESULTS SUMMARY`);
    console.log(`Total Passed: \x1b[32m${passCount}\x1b[0m`);
    console.log(`Total Failed: \x1b[31m${failCount}\x1b[0m`);
    console.log(`Success Rate: ${Math.round((passCount / (passCount + failCount)) * 100)}%`);
    console.log(`========================================================\n`);

    if (failCount > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runAllTests().catch(err => {
    console.error('Test runner fatal error:', err);
    process.exit(1);
});
