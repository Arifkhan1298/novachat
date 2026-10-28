# ChatNova — Complete Real-Time Messaging Platform

> **Primary Tagline:** Connect • Chat • Share  
> **Secondary Slogan:** More Than Just Messages... It's Your World.  
> **Promotional Slogan:** Better Chats, Brighter Moments.

---

## 1. Overview

**ChatNova** is a modern, real-time messaging web platform with a warm orange-and-cream aesthetic, built with a relational **MySQL** database backend, **Node.js Express** server, and **Socket.IO** real-time bidirectional communication engine.

All source code files are structured directly in the root directory (flat architecture) as requested, eliminating complex nested subdirectories while delivering full enterprise-grade architecture.

---

## 2. Technology Stack

- **Frontend:** HTML5, Modern Vanilla CSS3 (Custom warm-cream and orange glass design system), Vanilla JavaScript ES6+.
- **Backend:** Node.js, Express.
- **Real-Time Communication:** Socket.IO v4.
- **Calling:** WebRTC (Peer-to-peer audio & video communication with STUN signaling).
- **Database:** MySQL 8+ / MariaDB 10.4+ (InnoDB engine, utf8mb4 encoding, foreign keys, constraints).
- **Security:** Argon2 / Bcrypt password hashing, JWT session verification, SQL prepared statements, audit logging.
- **Audio:** Browser MediaRecorder API for voice messages with instant playback waveform visualization.

---

## 3. System Requirements

- **Node.js:** v18.0.0 or later (v24.22.1 LTS verified).
- **MySQL:** MySQL 8.0+ or MariaDB 10.4+ (Running on default port `3306`).
- **Operating System:** Windows, macOS, or Linux.
- **Web Browser:** Any modern browser supporting WebRTC and Web Audio (Chrome, Edge, Firefox, Safari).

---

## 4. File Structure (Flat Root Architecture)

```text
chat/
├── index.html        # Complete responsive web application UI & templates
├── styles.css        # Warm orange and cream glassmorphism design system
├── app.js            # Frontend client logic, WebSockets, WebRTC, recorder, bio display
├── server.js         # Backend Express server, REST endpoints, Socket.IO, MySQL pool
├── schema.sql        # Complete MySQL relational schema with 20 normalized tables
├── package.json      # Dependencies and scripts (start, test)
├── .env.example      # Environment variables template
├── .env              # Active local environment configuration
├── tests.js          # Automated end-to-end integration and database test suite
└── README.md         # Comprehensive setup, operational and deployment documentation
```

---

## 5. Environment Configuration

ChatNova reads all database and server settings from `.env`. An example template is provided in `.env.example`:

```env
# Server Port
PORT=3000
SESSION_SECRET=chatnova_super_secure_session_secret_change_in_production_2026

# MySQL Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_NAME=chatnova_db
DB_USER=root
DB_PASSWORD=
```

> **Note:** The database name `DB_NAME` is fully configurable. If you supply your custom database name, simply update `DB_NAME` in `.env`.

---

## 6. Database Installation & Migration

### Step 1: Start MySQL Service
Ensure your MySQL or XAMPP MySQL daemon is active:
```bash
# In XAMPP on Windows:
C:\xampp\mysql\bin\mysqld.exe --defaults-file="C:\xampp\mysql\bin\my.ini" --standalone
```

### Step 2: Create Database & Apply Schema
Run the provided `schema.sql`:
```bash
# Using MySQL CLI:
mysql -u root -e "CREATE DATABASE IF NOT EXISTS chatnova_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root chatnova_db < schema.sql
```
*(On server startup, `server.js` automatically creates the database and all 20 required tables if they do not exist yet!)*

### The 20 Required Relational Database Tables:
1. `users` — Registered accounts, hashed passwords, avatars, **user text bios**, status.
2. `user_settings` — Themes, online privacy, read receipts, audio notification preferences.
3. `sessions` — Active sessions with expiry tracking.
4. `contacts` — Bidirectional contact relationships.
5. `conversations` — Direct 1-on-1 and Group conversation metadata.
6. `conversation_members` — Member roles (owner, admin, member), last-read tracking.
7. `messages` — Messages, replies, soft deletion, timestamps, edited status.
8. `message_attachments` — Secure file, image, document, and audio binary data and metadata.
9. `message_receipts` — Message delivery and read receipts (single and double checkmarks).
10. `message_reactions` — Emoji reactions attached to messages.
11. `conversation_user_states` — Pinned, archived, and muted settings per conversation.
12. `blocks` — User blocking enforcement.
13. `groups_metadata` — Group descriptions, rules, invite codes.
14. `notifications` — In-app notification center alerts.
15. `calls` — WebRTC audio and video call metadata and history logs.
16. `contact_requests` — Pending, accepted, and declined contact requests.
17. `reports` — User and message moderation reports.
18. `password_reset_tokens` — Cryptographic time-limited recovery tokens.
19. `verification_tokens` — Email and phone verification tokens.
20. `audit_logs` — Administrative and security event audit trail.

---

## 7. Starting the Application

### 1. Install Dependencies
```bash
npm install
```

### 2. Start ChatNova Server
```bash
npm start
```
Output:
```text
====================================================
🚀 ChatNova Server active at: http://localhost:3000
📡 Socket.IO Real-Time Engine ready
[Database] Successfully connected to MySQL (chatnova_db) on localhost:3306
====================================================
```

Open your browser to: **`http://localhost:3000`**

---

## 8. Default Pre-Seeded Accounts

When the database is initialized, sample verified accounts are automatically seeded for testing:

| Username | Password | Display Name | Role | Profile Text Bio |
| :--- | :--- | :--- | :--- | :--- |
| **`admin`** | `ChatNova@2026` | ChatNova Administrator | Admin | *Platform Administrator & Safety Officer.* |
| **`sarah_design`** | `ChatNova@2026` | Sarah Jenkins | Member | *Creative Director & UI/UX Specialist ✨* |
| **`alex_dev`** | `ChatNova@2026` | Alex Rivera | Member | *Senior Cloud Architect & Real-Time Systems Engineer 🚀* |
| **`elena_v`** | `ChatNova@2026` | Elena Vance | Member | *AI Researcher & Photography Lover 📸* |

You can also register any new account through the registration form at any time!

---

## 9. Running Automated Tests

A comprehensive end-to-end automated test suite is provided in `tests.js`:

```bash
npm test
```
The test suite validates:
- MySQL database connectivity and relational foreign keys.
- User registration, duplicate username rejection, and password validation.
- **User text bio persistent storage and retrieval.**
- Login authentication against bcrypt hashes.
- 1-on-1 direct conversation creation.
- Real-time message storage in MySQL.
- File attachment handling.
- Message editing and emoji reactions.
- Group chat creation and owner assignment.
- Contact addition and blocking rules.
- User settings persistence.

---

## 10. Database Backup and Recovery

### Backup:
```bash
mysqldump -u root -p chatnova_db > chatnova_backup.sql
```

### Restore:
```bash
mysql -u root -p chatnova_db < chatnova_backup.sql
```

---

## 11. Security Highlights

- **Passwords:** Hashed with bcrypt with 10 salt rounds. Plaintext passwords are never logged or stored.
- **SQL Injection Prevention:** 100% prepared parameterized statements across all queries.
- **XSS Defense:** Context-aware HTML entity encoding on all user inputs.
- **Session Security:** Cryptographic JWT tokens verified on every API and WebSocket handshake.
- **Multi-Tab Presence:** Connection counting ensures users aren't prematurely marked offline if one tab closes while another is open.
