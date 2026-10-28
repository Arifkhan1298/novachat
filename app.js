// ========================================================
// CHATNOVA — COMPLETE FRONTEND REAL-TIME CLIENT LOGIC
// Real-time Socket.IO, WebRTC Calling, Audio Recording, MySQL Data Sync
// Flat Structure: app.js in root directory
// ========================================================

// Dynamic API Base URL: If loaded from port 3000 (direct Node server), use same-origin ('')
// If loaded from Apache (port 80 / localhost/chat) or file://, target Node backend at port 3000
const API_BASE = (window.location.port === '3000')
    ? ''
    : `${window.location.protocol === 'file:' ? 'http:' : window.location.protocol}//${window.location.hostname || 'localhost'}:3000`;

// Resolve relative media & avatar URLs properly across Node server & Apache environments
function resolveMediaUrl(url) {
    if (!url) return '';
    if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) {
        return url;
    }
    const cleanPath = url.startsWith('/') ? url : `/${url}`;
    if (API_BASE) {
        return `${API_BASE}${cleanPath}`;
    }
    return cleanPath;
}

// Lightbox / Full media viewer
function openFullImage(src) {
    if (!src) return;
    const resolved = resolveMediaUrl(src);
    window.open(resolved, '_blank');
}

let currentUser = null;
let currentConversation = null;
let conversations = [];
let activeFilter = 'all';
let socket = null;
let replyToMessage = null;
let pendingAttachment = null;
let typingTimeout = null;

// Voice recording state
let mediaRecorder = null;
let audioChunks = [];
let recordingTimerInterval = null;
let recordingSeconds = 0;

// WebRTC calling state
let peerConnection = null;
let localStream = null;
let activeCallRecipientId = null;
let callTimerInterval = null;
let callSeconds = 0;
let incomingCallData = null;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// ========================================================
// 1. INITIALIZATION & AUTHENTICATION
// ========================================================

document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
    setupEmojiPicker();
});

async function initApp() {
    const token = localStorage.getItem('chatnova_token');
    if (!token) {
        showAuthModal(true);
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.success && data.user) {
            currentUser = data.user;
            applyUserSettings(data.settings);
            updateHeaderUserInfo();
            connectSocket(token);
            await loadConversations();
            showAuthModal(false);
        } else {
            localStorage.removeItem('chatnova_token');
            showAuthModal(true);
        }
    } catch (err) {
        console.error('Initialization error:', err);
        showToast('Connection error. Retrying...', 'error');
    }
}

function updateHeaderUserInfo() {
    if (!currentUser) return;
    const nameEl = document.getElementById('headerUserName');
    const avatarEl = document.getElementById('headerUserAvatar');
    const adminBtn = document.getElementById('adminNavBtn');

    if (nameEl) nameEl.textContent = currentUser.display_name;
    if (avatarEl) {
        avatarEl.src = resolveMediaUrl(currentUser.avatar_path) || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.display_name)}&background=FF5A0A&color=fff`;
    }
    if (adminBtn) {
        adminBtn.style.display = currentUser.is_admin ? 'flex' : 'none';
    }
}

function applyUserSettings(settings) {
    if (!settings) return;
    if (settings.theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
}

function showAuthModal(show) {
    const modal = document.getElementById('authModal');
    if (modal) modal.style.display = show ? 'flex' : 'none';
}

// ========================================================
// 2. SOCKET.IO REAL-TIME COMMUNICATION
// ========================================================

function connectSocket(token) {
    if (socket) socket.disconnect();
    if (typeof io === 'undefined') {
        console.warn('[Socket] Socket.IO library not loaded yet');
        return;
    }

    const socketUrl = API_BASE || undefined;
    socket = io(socketUrl, {
        auth: { token },
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000
    });

    socket.on('connect', () => {
        console.log('[Socket] Connected to real-time server as', currentUser?.username);
        updateOnlineStatusUI(true);
    });

    socket.on('disconnect', () => {
        console.log('[Socket] Disconnected from server');
        updateOnlineStatusUI(false);
    });

    // Incoming new real-time message
    socket.on('message:new', (message) => {
        handleIncomingMessage(message);
    });

    // Message edited
    socket.on('message:updated', (updated) => {
        handleMessageUpdated(updated);
    });

    // Message deleted
    socket.on('message:deleted', (deleted) => {
        handleMessageDeleted(deleted);
    });

    // Message reaction
    socket.on('message:reaction', (reaction) => {
        handleMessageReaction(reaction);
    });

    // Message read receipts
    socket.on('message:read', (receipt) => {
        handleMessageReadReceipt(receipt);
    });

    // Typing indicators
    socket.on('typing:start', ({ conversation_id, username }) => {
        if (currentConversation && currentConversation.id === conversation_id) {
            showTypingIndicator(username);
        }
    });

    socket.on('typing:stop', ({ conversation_id }) => {
        if (currentConversation && currentConversation.id === conversation_id) {
            hideTypingIndicator();
        }
    });

    // Presence updates
    socket.on('presence:update', ({ userId, status, last_seen_at }) => {
        handlePresenceUpdate(userId, status, last_seen_at);
    });

    // WebRTC Calling Signaling
    socket.on('call:incoming', (data) => {
        handleIncomingCall(data);
    });

    socket.on('call:answered', async ({ answer }) => {
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            document.getElementById('callStatusHeader').textContent = 'Call Connected';
            startCallTimer();
        }
    });

    socket.on('call:ice-candidate', async ({ candidate }) => {
        if (peerConnection && candidate) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                console.error('Error adding ICE candidate:', err);
            }
        }
    });

    socket.on('call:rejected', () => {
        showToast('Call was declined.', 'info');
        cleanupCall();
    });

    socket.on('call:ended', () => {
        showToast('Call ended by participant.', 'info');
        cleanupCall();
    });
}

function updateOnlineStatusUI(isOnline) {
    const statusText = document.getElementById('myStatusText');
    const pill = document.getElementById('myStatusPill');
    if (statusText) statusText.textContent = isOnline ? 'Online' : 'Reconnecting...';
    if (pill) {
        pill.style.color = isOnline ? 'var(--online-green)' : 'var(--muted-text)';
    }
}

// ========================================================
// 3. CONVERSATIONS MANAGEMENT & RENDERING
// ========================================================

async function loadConversations() {
    try {
        const token = localStorage.getItem('chatnova_token');
        const res = await fetch(`${API_BASE}/api/conversations`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.success) {
            conversations = data.conversations || [];
            renderConversationsList();
        }
    } catch (err) {
        console.error('Error loading conversations:', err);
    }
}

function renderConversationsList() {
    const listContainer = document.getElementById('conversationsList');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    const filtered = conversations.filter(conv => {
        if (activeFilter === 'all') return true;
        return conv.conversation_type === activeFilter;
    });

    if (filtered.length === 0) {
        listContainer.innerHTML = `
            <div style="text-align: center; padding: 30px 16px; color: var(--secondary-text); font-size: 13px;">
                <p>No ${activeFilter} conversations found.</p>
                <p style="margin-top: 6px; font-size: 11px; color: var(--muted-text);">Click <strong>New</strong> above to start chatting!</p>
            </div>
        `;
        return;
    }

    filtered.forEach(conv => {
        const item = document.createElement('div');
        item.className = `conv-item ${currentConversation && currentConversation.id === conv.id ? 'active' : ''}`;
        item.dataset.id = conv.id;

        const avatar = resolveMediaUrl(conv.avatar_path) || `https://ui-avatars.com/api/?name=${encodeURIComponent(conv.title || 'Chat')}&background=FF5A0A&color=fff`;
        const timeStr = formatTimestamp(conv.last_message?.created_at || conv.updated_at);
        const previewText = conv.last_message ? escapeHtml(conv.last_message.body || 'Attachment') : 'No messages yet';
        
        // PROMINENT USER BIO DISPLAY ("text bio sahi tareeqa sa dika")
        const bioSnippet = conv.bio ? `<div class="conv-bio-snippet" title="Status Bio">“${escapeHtml(conv.bio)}”</div>` : '';

        item.innerHTML = `
            <div class="conv-avatar-wrap">
                <img src="${avatar}" class="conv-avatar" alt="Avatar">
                ${conv.conversation_type === 'direct' ? '<span class="conv-online-indicator"></span>' : ''}
            </div>
            <div class="conv-meta">
                <div class="conv-name-row">
                    <span class="conv-name">${escapeHtml(conv.title || 'Conversation')}</span>
                    <span class="conv-time">${timeStr}</span>
                </div>
                ${bioSnippet}
                <div class="conv-preview-row">
                    <span class="conv-preview">${previewText}</span>
                    ${conv.unread_count > 0 ? `<span class="unread-badge">${conv.unread_count}</span>` : ''}
                </div>
            </div>
        `;

        item.addEventListener('click', () => selectConversation(conv.id));
        listContainer.appendChild(item);
    });
}

async function selectConversation(convId) {
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;

    currentConversation = conv;
    renderConversationsList(); // Update active highlights

    // Join room on Socket.IO
    if (socket) socket.emit('conversation:join', convId);

    // Update UI headers
    document.getElementById('emptyChatPlaceholder').style.display = 'none';
    document.getElementById('chatHeader').style.display = 'flex';
    document.getElementById('chatComposerBar').style.display = 'flex';

    const avatar = resolveMediaUrl(conv.avatar_path) || `https://ui-avatars.com/api/?name=${encodeURIComponent(conv.title || 'Chat')}&background=FF5A0A&color=fff`;
    document.getElementById('activeChatAvatar').src = avatar;
    document.getElementById('activeChatTitle').textContent = conv.title || 'Conversation';
    
    // PROMINENT USER BIO DISPLAY IN ACTIVE CHAT HEADER ("text bio sahi tareeqa sa dika")
    const bioBadge = document.getElementById('activeChatBioBadge');
    const bioText = document.getElementById('activeChatBioText');
    if (conv.bio && conv.bio.trim()) {
        bioText.textContent = conv.bio;
        bioBadge.style.display = 'inline-flex';
    } else if (conv.description && conv.description.trim()) {
        bioText.textContent = conv.description;
        bioBadge.style.display = 'inline-flex';
    } else {
        bioBadge.style.display = 'none';
    }

    // Update Spotlight in Right Panel
    updateSpotlightPanel(conv);

    // Mobile viewport handling
    document.body.classList.add('mobile-chat-active');

    // Fetch and render messages
    await loadMessages(convId);

    // Mark as read
    markConversationAsRead(convId);
}

function updateSpotlightPanel(conv) {
    const avatar = resolveMediaUrl(conv.avatar_path) || `https://ui-avatars.com/api/?name=${encodeURIComponent(conv.title || 'Chat')}&background=FF5A0A&color=fff`;
    document.getElementById('spotlightAvatar').src = avatar;
    document.getElementById('spotlightName').textContent = conv.title || 'ChatNova Member';
    
    const usernameTag = conv.other_user ? `@${conv.other_user.username}` : (conv.conversation_type === 'group' ? 'Group Community' : '');
    document.getElementById('spotlightUsername').textContent = usernameTag;

    // PROMINENT BIO DISPLAY IN RIGHT PANEL ("text bio sahi tareeqa sa dika")
    const bioBox = document.getElementById('spotlightBio');
    if (conv.bio) {
        bioBox.textContent = conv.bio;
    } else if (conv.description) {
        bioBox.textContent = conv.description;
    } else {
        bioBox.textContent = 'Active member of the ChatNova real-time messaging network.';
    }
}

// ========================================================
// 4. MESSAGES LOADING & REAL-TIME HANDLING
// ========================================================

async function loadMessages(convId) {
    const container = document.getElementById('messagesContainer');
    try {
        const token = localStorage.getItem('chatnova_token');
        const res = await fetch(`${API_BASE}/api/conversations/${convId}/messages`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.success) {
            container.innerHTML = '';
            const messages = data.messages || [];

            if (messages.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; margin: auto; color: var(--secondary-text); font-size: 13px;">
                        <p>No messages yet. Send a greeting to start the conversation!</p>
                    </div>
                `;
                return;
            }

            // Group messages with date separators
            let lastDate = null;
            messages.forEach(msg => {
                const msgDate = new Date(msg.created_at).toLocaleDateString();
                if (msgDate !== lastDate) {
                    const sep = document.createElement('div');
                    sep.className = 'date-separator';
                    sep.innerHTML = `<span class="date-pill">${msgDate}</span>`;
                    container.appendChild(sep);
                    lastDate = msgDate;
                }
                appendMessageBubble(msg, false);
            });

            scrollToBottom();
        }
    } catch (err) {
        console.error('Error loading messages:', err);
    }
}

function appendMessageBubble(msg, shouldScroll = true) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    const isOutgoing = msg.sender_id === currentUser.id;
    const row = document.createElement('div');
    row.className = `message-row ${isOutgoing ? 'outgoing' : 'incoming'}`;
    row.id = `msg-${msg.id}`;

    // Format time
    const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Reply quote preview
    let replyHtml = '';
    if (msg.reply_body) {
        replyHtml = `
            <div class="msg-reply-quote">
                <strong>${escapeHtml(msg.reply_sender_name || 'Replied to message')}:</strong>
                <div>${escapeHtml(msg.reply_body)}</div>
            </div>
        `;
    }

    // Attachments (Images, Videos, Documents, Audio)
    let attachmentHtml = '';
    if (msg.attachments && msg.attachments.length > 0) {
        msg.attachments.forEach(att => {
            const mime = att.mime_type || '';
            const mediaUrl = resolveMediaUrl(att.file_data);
            if (mime.startsWith('image/')) {
                attachmentHtml += `<img src="${mediaUrl}" class="msg-attachment-img" onclick="openFullImage('${mediaUrl}')" alt="Attachment">`;
            } else if (mime.startsWith('video/') || msg.message_type === 'video') {
                attachmentHtml += `
                    <div class="msg-video-wrap">
                        <video src="${mediaUrl}" controls preload="metadata" class="msg-attachment-video"></video>
                        <div class="msg-video-caption">
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;">${escapeHtml(att.original_filename || 'Video')}</span>
                            <span>${formatBytes(att.file_size)}</span>
                        </div>
                    </div>
                `;
            } else if (msg.message_type === 'voice' || mime.startsWith('audio/')) {
                attachmentHtml += `
                    <div class="msg-voice-player">
                        <button class="voice-play-btn" onclick="playAudio('${mediaUrl}', this)">▶</button>
                        <div class="voice-waveform">
                            <span class="waveform-bar"></span>
                            <span class="waveform-bar"></span>
                            <span class="waveform-bar"></span>
                            <span class="waveform-bar"></span>
                            <span class="waveform-bar"></span>
                        </div>
                        <span class="voice-duration">Audio Note</span>
                    </div>
                `;
            } else {
                attachmentHtml += `
                    <div class="msg-doc-card">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(att.original_filename)}</div>
                            <div style="font-size: 10px; opacity: 0.8;">${formatBytes(att.file_size)}</div>
                        </div>
                        <a href="${mediaUrl}" download="${escapeHtml(att.original_filename)}" style="color: inherit; text-decoration: none; padding: 4px;">⬇</a>
                    </div>
                `;
            }
        });
    }

    // Read Receipt Ticks for outgoing messages
    let receiptTick = '';
    if (isOutgoing) {
        receiptTick = `<span class="receipt-icon" title="Delivered">✓✓</span>`;
    }

    // Reactions
    let reactionsHtml = '';
    if (msg.reactions && msg.reactions.length > 0) {
        reactionsHtml = `<div class="msg-reactions-bar">`;
        msg.reactions.forEach(r => {
            reactionsHtml += `<span class="reaction-chip" title="${escapeHtml(r.display_name)}">${r.reaction}</span>`;
        });
        reactionsHtml += `</div>`;
    }

    row.innerHTML = `
        ${!isOutgoing ? `<img src="${msg.sender_avatar || 'https://ui-avatars.com/api/?name=User&background=FF5A0A&color=fff'}" class="msg-avatar" alt="Avatar">` : ''}
        <div class="msg-bubble-wrap">
            ${!isOutgoing && currentConversation?.conversation_type === 'group' ? `<span class="msg-sender-name">${escapeHtml(msg.sender_display_name)}</span>` : ''}
            <div class="msg-bubble">
                ${replyHtml}
                ${attachmentHtml}
                ${msg.body ? `<div>${escapeHtml(msg.body)}</div>` : ''}
                <div class="msg-meta-row">
                    <span>${timeStr}</span>
                    ${msg.is_edited ? '<span>(edited)</span>' : ''}
                    ${receiptTick}
                </div>
            </div>
            ${reactionsHtml}
        </div>

        <!-- Action menu on hover -->
        <div class="msg-actions-hover">
            <button class="msg-action-btn" title="React" onclick="quickReact(${msg.id}, '❤️')">❤️</button>
            <button class="msg-action-btn" title="React" onclick="quickReact(${msg.id}, '👍')">👍</button>
            <button class="msg-action-btn" title="Reply" onclick="setReplyMessage(${msg.id}, '${escapeHtml(msg.body || 'Attachment')}', '${escapeHtml(msg.sender_display_name)}')">↩</button>
            <button class="msg-action-btn" title="Copy Text" onclick="copyMessageText('${escapeHtml(msg.body || '')}')">📋</button>
            ${isOutgoing ? `<button class="msg-action-btn" title="Delete" onclick="deleteMessagePrompt(${msg.id})">🗑</button>` : ''}
        </div>
    `;

    container.appendChild(row);
    if (shouldScroll) scrollToBottom();
}

function handleIncomingMessage(message) {
    // If belongs to currently active conversation
    if (currentConversation && currentConversation.id === message.conversation_id) {
        appendMessageBubble(message, true);
        markConversationAsRead(message.conversation_id);
    } else {
        // Update unread count and preview in conversations list
        const conv = conversations.find(c => c.id === message.conversation_id);
        if (conv) {
            conv.unread_count = (conv.unread_count || 0) + 1;
            conv.last_message = {
                id: message.id,
                body: message.body,
                created_at: message.created_at,
                sender_id: message.sender_id
            };
            // Move conversation to top
            conversations = [conv, ...conversations.filter(c => c.id !== conv.id)];
            renderConversationsList();
        } else {
            loadConversations();
        }

        showToast(`New message from ${message.sender_display_name}: "${message.body || 'Attachment'}"`, 'info');
    }
}

function handleMessageUpdated(updated) {
    const el = document.getElementById(`msg-${updated.id}`);
    if (el) {
        const bodyEl = el.querySelector('.msg-bubble > div:not(.msg-reply-quote):not(.msg-meta-row)');
        if (bodyEl) bodyEl.textContent = updated.body;
    }
}

function handleMessageDeleted(deleted) {
    const el = document.getElementById(`msg-${deleted.id}`);
    if (el) el.remove();
}

function handleMessageReaction(reaction) {
    // Refresh conversation messages or update reaction chip
    if (currentConversation && currentConversation.id === reaction.conversation_id) {
        loadMessages(currentConversation.id);
    }
}

function handleMessageReadReceipt(receipt) {
    // Update ticks to green
    const ticks = document.querySelectorAll('.outgoing .receipt-icon');
    ticks.forEach(t => {
        t.style.color = 'var(--online-green)';
        t.title = 'Read';
    });
}

async function markConversationAsRead(convId) {
    try {
        const token = localStorage.getItem('chatnova_token');
        await fetch(`${API_BASE}/api/conversations/${convId}/read`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const conv = conversations.find(c => c.id === convId);
        if (conv) conv.unread_count = 0;
        renderConversationsList();
    } catch (err) {
        console.error('Error marking read:', err);
    }
}

// ========================================================
// 5. MESSAGE COMPOSER & ATTACHMENTS
// ========================================================

async function sendMessage() {
    if (!currentConversation) return;

    const input = document.getElementById('messageInput');
    const text = input.value.trim();

    if (!text && !pendingAttachment) return;

    let msgType = 'text';
    if (pendingAttachment) {
        const mime = pendingAttachment.mime_type || '';
        if (mime.startsWith('image/')) {
            msgType = 'image';
        } else if (mime.startsWith('video/')) {
            msgType = 'video';
        } else if (mime.startsWith('audio/')) {
            msgType = 'audio';
        } else {
            msgType = 'document';
        }
    }

    const payload = {
        body: text,
        message_type: msgType,
        reply_to_message_id: replyToMessage?.id || null,
        attachment: pendingAttachment
    };

    // Clear composer inputs
    input.value = '';
    clearReplyMessage();
    clearAttachmentTray();

    try {
        const token = localStorage.getItem('chatnova_token');
        const res = await fetch(`${API_BASE}/api/conversations/${currentConversation.id}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!data.success) {
            showToast(data.message || 'Error sending message', 'error');
        }
    } catch (err) {
        console.error('Send error:', err);
        showToast('Failed to send message', 'error');
    }
}

function setReplyMessage(id, body, sender) {
    replyToMessage = { id, body, sender };
    showToast(`Replying to ${sender}: "${body.substring(0, 30)}..."`, 'info');
    document.getElementById('messageInput').focus();
}

function clearReplyMessage() {
    replyToMessage = null;
}

function copyMessageText(text) {
    navigator.clipboard.writeText(text);
    showToast('Message copied to clipboard', 'success');
}

async function deleteMessagePrompt(id) {
    const forAll = confirm('Delete for everyone? Click Cancel to delete for yourself only.');
    try {
        const token = localStorage.getItem('chatnova_token');
        const res = await fetch(`${API_BASE}/api/messages/${id}?for_all=${forAll}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            const el = document.getElementById(`msg-${id}`);
            if (el) el.remove();
            showToast('Message deleted', 'success');
        }
    } catch (err) {
        showToast('Error deleting message', 'error');
    }
}

async function quickReact(id, emoji) {
    try {
        const token = localStorage.getItem('chatnova_token');
        await fetch(`${API_BASE}/api/messages/${id}/reactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ reaction: emoji })
        });
    } catch (err) {
        console.error('Reaction error:', err);
    }
}

// Image compression helper for smooth instant message sending
function compressImageIfNeeded(file, maxDimension = 1920, quality = 0.85) {
    return new Promise((resolve) => {
        if (!file.type || !file.type.startsWith('image/') || file.type === 'image/gif') {
            return resolve(file);
        }
        const img = new Image();
        const reader = new FileReader();
        reader.onload = (e) => {
            img.onload = () => {
                let { width, height } = img;
                if (width <= maxDimension && height <= maxDimension && file.size < 1.5 * 1024 * 1024) {
                    return resolve(file);
                }
                if (width > height && width > maxDimension) {
                    height = Math.round((height * maxDimension) / width);
                    width = maxDimension;
                } else if (height > maxDimension) {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    if (blob && blob.size < file.size) {
                        const compressed = new File([blob], file.name, { type: 'image/jpeg' });
                        resolve(compressed);
                    } else {
                        resolve(file);
                    }
                }, 'image/jpeg', quality);
            };
            img.onerror = () => resolve(file);
            img.src = e.target.result;
        };
        reader.onerror = () => resolve(file);
        reader.readAsDataURL(file);
    });
}

// File Attachment selection (Images, Videos, Documents)
async function handleFileAttachment(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
        showToast('File size must be under 50MB', 'error');
        return;
    }

    let mimeType = file.type;
    if (!mimeType) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) mimeType = 'video/mp4';
        else if (['jpg', 'jpeg'].includes(ext)) mimeType = 'image/jpeg';
        else if (['png'].includes(ext)) mimeType = 'image/png';
        else if (['gif'].includes(ext)) mimeType = 'image/gif';
        else if (['webp'].includes(ext)) mimeType = 'image/webp';
        else mimeType = 'application/octet-stream';
    }

    let processedFile = file;
    // Optimize large chat images before sending
    if (mimeType.startsWith('image/') && mimeType !== 'image/gif' && file.size > 1.2 * 1024 * 1024) {
        try {
            processedFile = await compressImageIfNeeded(file);
        } catch (compErr) {
            console.warn('Image optimization skipped:', compErr);
        }
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        pendingAttachment = {
            original_filename: processedFile.name || file.name,
            mime_type: mimeType,
            file_size: processedFile.size,
            file_data: event.target.result // Base64 data URL
        };

        const tray = document.getElementById('attachmentTray');
        const nameEl = document.getElementById('trayFileName');
        const sizeEl = document.getElementById('trayFileSize');
        const imgEl = document.getElementById('trayPreviewImg');
        const videoEl = document.getElementById('trayPreviewVideo');

        nameEl.textContent = file.name;
        sizeEl.textContent = `(${formatBytes(processedFile.size)})`;

        if (mimeType.startsWith('image/')) {
            imgEl.src = event.target.result;
            imgEl.style.display = 'block';
            if (videoEl) {
                videoEl.style.display = 'none';
                videoEl.src = '';
            }
        } else if (mimeType.startsWith('video/')) {
            if (videoEl) {
                videoEl.src = event.target.result;
                videoEl.style.display = 'block';
            }
            imgEl.style.display = 'none';
        } else {
            imgEl.style.display = 'none';
            if (videoEl) {
                videoEl.style.display = 'none';
                videoEl.src = '';
            }
        }

        tray.style.display = 'flex';
    };
    reader.readAsDataURL(processedFile);
}

function clearAttachmentTray() {
    pendingAttachment = null;
    const tray = document.getElementById('attachmentTray');
    if (tray) tray.style.display = 'none';
    const imgEl = document.getElementById('trayPreviewImg');
    if (imgEl) {
        imgEl.style.display = 'none';
        imgEl.src = '';
    }
    const videoEl = document.getElementById('trayPreviewVideo');
    if (videoEl) {
        videoEl.style.display = 'none';
        videoEl.src = '';
    }
    const input = document.getElementById('fileAttachmentInput');
    if (input) input.value = '';
}

// ========================================================
// 6. VOICE MESSAGES RECORDING (MediaRecorder API)
// ========================================================

async function startVoiceRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.start();
        recordingSeconds = 0;
        document.getElementById('voiceRecordingOverlay').style.display = 'flex';
        document.getElementById('voiceRecTimer').textContent = '0:00';

        recordingTimerInterval = setInterval(() => {
            recordingSeconds++;
            const mins = Math.floor(recordingSeconds / 60);
            const secs = recordingSeconds % 60;
            document.getElementById('voiceRecTimer').textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        }, 1000);
    } catch (err) {
        console.error('Microphone error:', err);
        showToast('Microphone access denied or unavailable', 'error');
    }
}

function cancelVoiceRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    clearInterval(recordingTimerInterval);
    document.getElementById('voiceRecordingOverlay').style.display = 'none';
    audioChunks = [];
}

async function sendVoiceRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    mediaRecorder.onstop = async () => {
        clearInterval(recordingTimerInterval);
        document.getElementById('voiceRecordingOverlay').style.display = 'none';

        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = async () => {
            const base64Audio = reader.target.result;

            const payload = {
                body: 'Voice Message',
                message_type: 'voice',
                attachment: {
                    original_filename: `voice_${Date.now()}.webm`,
                    mime_type: 'audio/webm',
                    file_size: audioBlob.size,
                    media_duration: recordingSeconds,
                    file_data: base64Audio
                }
            };

            const token = localStorage.getItem('chatnova_token');
            await fetch(`${API_BASE}/api/conversations/${currentConversation.id}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });
        };
        reader.readAsDataURL(audioBlob);
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
    };

    mediaRecorder.stop();
}

let activeAudioElement = null;
function playAudio(base64Data, buttonEl) {
    if (activeAudioElement) {
        activeAudioElement.pause();
        activeAudioElement = null;
        buttonEl.textContent = '▶';
        return;
    }

    activeAudioElement = new Audio(base64Data);
    buttonEl.textContent = '⏸';
    activeAudioElement.play();

    activeAudioElement.onended = () => {
        buttonEl.textContent = '▶';
        activeAudioElement = null;
    };
}

// ========================================================
// 7. WEBRTC AUDIO & VIDEO CALLS
// ========================================================

async function startCall(callType) {
    if (!currentConversation || currentConversation.conversation_type !== 'direct') {
        showToast('Calls are currently supported for direct 1-on-1 conversations.', 'info');
        return;
    }

    const recipient = currentConversation.other_user;
    if (!recipient) return;

    activeCallRecipientId = recipient.id;

    // Show Call Modal
    document.getElementById('callModal').style.display = 'flex';
    document.getElementById('callParticipantName').textContent = recipient.display_name;
    document.getElementById('callAvatarImg').src = resolveMediaUrl(recipient.avatar_path) || `https://ui-avatars.com/api/?name=${encodeURIComponent(recipient.display_name)}&background=FF5A0A&color=fff`;
    document.getElementById('callStatusHeader').textContent = `Calling ${recipient.display_name}...`;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: callType === 'video'
        });

        document.getElementById('localVideo').srcObject = localStream;
        document.getElementById('callAudioAvatarPlaceholder').style.display = callType === 'video' ? 'none' : 'flex';

        peerConnection = new RTCPeerConnection(rtcConfig);

        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        peerConnection.ontrack = (event) => {
            document.getElementById('remoteVideo').srcObject = event.streams[0];
            document.getElementById('callAudioAvatarPlaceholder').style.display = 'none';
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate && socket) {
                socket.emit('call:ice-candidate', {
                    recipient_id: activeCallRecipientId,
                    candidate: event.candidate
                });
            }
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        socket.emit('call:offer', {
            recipient_id: activeCallRecipientId,
            call_type: callType,
            offer,
            caller_name: currentUser.display_name,
            caller_avatar: resolveMediaUrl(currentUser.avatar_path)
        });
    } catch (err) {
        console.error('Call initiation error:', err);
        showToast('Camera/Microphone access denied or unavailable', 'error');
        cleanupCall();
    }
}

function handleIncomingCall(data) {
    incomingCallData = data;
    document.getElementById('incomingCallerName').textContent = data.caller_name;
    document.getElementById('incomingCallerAvatar').src = resolveMediaUrl(data.caller_avatar) || `https://ui-avatars.com/api/?name=${encodeURIComponent(data.caller_name)}&background=FF5A0A&color=fff`;
    document.getElementById('incomingCallType').textContent = `${data.call_type === 'video' ? 'Video' : 'Audio'} Call incoming...`;
    document.getElementById('incomingCallModal').style.display = 'flex';
}

async function acceptIncomingCall() {
    if (!incomingCallData) return;
    const { caller_id, call_type, offer } = incomingCallData;
    activeCallRecipientId = caller_id;

    document.getElementById('incomingCallModal').style.display = 'none';
    document.getElementById('callModal').style.display = 'flex';
    document.getElementById('callStatusHeader').textContent = 'Connecting...';

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: call_type === 'video'
        });

        document.getElementById('localVideo').srcObject = localStream;
        document.getElementById('callAudioAvatarPlaceholder').style.display = call_type === 'video' ? 'none' : 'flex';

        peerConnection = new RTCPeerConnection(rtcConfig);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        peerConnection.ontrack = (event) => {
            document.getElementById('remoteVideo').srcObject = event.streams[0];
            document.getElementById('callAudioAvatarPlaceholder').style.display = 'none';
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate && socket) {
                socket.emit('call:ice-candidate', {
                    recipient_id: activeCallRecipientId,
                    candidate: event.candidate
                });
            }
        };

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit('call:answer', {
            recipient_id: activeCallRecipientId,
            answer
        });

        startCallTimer();
        document.getElementById('callStatusHeader').textContent = 'Call Connected';
    } catch (err) {
        console.error('Error accepting call:', err);
        showToast('Error connecting call media', 'error');
        cleanupCall();
    }
}

function declineIncomingCall() {
    if (incomingCallData && socket) {
        socket.emit('call:reject', { recipient_id: incomingCallData.caller_id });
    }
    document.getElementById('incomingCallModal').style.display = 'none';
    incomingCallData = null;
}

function endCall() {
    if (activeCallRecipientId && socket) {
        socket.emit('call:end', { recipient_id: activeCallRecipientId });
    }
    cleanupCall();
}

function cleanupCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    clearInterval(callTimerInterval);
    document.getElementById('callModal').style.display = 'none';
    document.getElementById('incomingCallModal').style.display = 'none';
    document.getElementById('callTimerDisplay').textContent = '00:00';
    activeCallRecipientId = null;
    incomingCallData = null;
}

function startCallTimer() {
    callSeconds = 0;
    clearInterval(callTimerInterval);
    callTimerInterval = setInterval(() => {
        callSeconds++;
        const mins = Math.floor(callSeconds / 60);
        const secs = callSeconds % 60;
        document.getElementById('callTimerDisplay').textContent = `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }, 1000);
}

// ========================================================
// 8. TYPING INDICATORS & PRESENCE
// ========================================================

function handleTypingEvent() {
    if (!currentConversation || !socket) return;

    socket.emit('typing:start', { conversation_id: currentConversation.id });

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing:stop', { conversation_id: currentConversation.id });
    }, 2500);
}

function showTypingIndicator(username) {
    const bar = document.getElementById('typingIndicatorBar');
    const text = document.getElementById('typingUserText');
    if (bar && text) {
        text.textContent = `${username} is typing`;
        bar.style.display = 'flex';
        scrollToBottom();
    }
}

function hideTypingIndicator() {
    const bar = document.getElementById('typingIndicatorBar');
    if (bar) bar.style.display = 'none';
}

function handlePresenceUpdate(userId, status, lastSeen) {
    const conv = conversations.find(c => c.other_user && c.other_user.id === userId);
    if (conv) {
        const item = document.querySelector(`.conv-item[data-id="${conv.id}"] .conv-online-indicator`);
        if (item) {
            item.style.background = status === 'online' ? 'var(--online-green)' : 'var(--muted-text)';
        }
    }
    if (currentConversation && currentConversation.other_user?.id === userId) {
        const statusText = document.getElementById('activeChatStatus');
        if (statusText) {
            statusText.textContent = status === 'online' ? 'Online' : 'Offline';
            statusText.style.color = status === 'online' ? 'var(--online-green)' : 'var(--muted-text)';
        }
    }
}

// ========================================================
// 9. USER DISCOVERY & SEARCH ("text bio sahi tareeqa sa dika")
// ========================================================

let searchDebounceTimeout = null;
function handleUserSearchInput(e) {
    const query = e.target.value.trim();
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
        executeUserSearch(query);
    }, 300);
}

async function executeUserSearch(query) {
    const container = document.getElementById('searchResultsContainer');
    if (!query) {
        container.innerHTML = '<p style="text-align: center; color: var(--muted-text); font-size: 13px; padding: 20px;">Type a name to search registered members</p>';
        return;
    }

    try {
        const token = localStorage.getItem('chatnova_token');
        const res = await fetch(`${API_BASE}/api/users/search?q=${encodeURIComponent(query)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.success) {
            const users = data.users || [];
            if (users.length === 0) {
                container.innerHTML = '<p style="text-align: center; color: var(--secondary-text); font-size: 13px; padding: 20px;">No registered members found matching your search.</p>';
                return;
            }

            container.innerHTML = '';
            users.forEach(user => {
                const card = document.createElement('div');
                card.className = 'search-user-card';
                const avatar = resolveMediaUrl(user.avatar_path) || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.display_name)}&background=FF5A0A&color=fff`;

                // PROMINENT USER BIO DISPLAY IN DISCOVERY CARD ("text bio sahi tareeqa sa dika")
                const userBio = user.bio ? escapeHtml(user.bio) : 'No status bio available.';

                card.innerHTML = `
                    <img src="${avatar}" class="search-user-avatar" alt="Avatar">
                    <div class="search-user-meta">
                        <div class="search-user-name">${escapeHtml(user.display_name)}</div>
                        <div class="search-user-handle">@${escapeHtml(user.username)}</div>
                        <div class="search-user-bio">“${userBio}”</div>
                    </div>
                    <button class="btn-pill-action" onclick="startDirectChat(${user.id})">Message</button>
                `;
                container.appendChild(card);
            });
        }
    } catch (err) {
        console.error('Search error:', err);
    }
}

async function startDirectChat(targetUserId) {
    try {
        const token = localStorage.getItem('chatnova_token');
        const res = await fetch(`${API_BASE}/api/conversations/direct`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ recipient_id: targetUserId })
        });
        const data = await res.json();

        if (data.success) {
            document.getElementById('userSearchModal').style.display = 'none';
            await loadConversations();
            selectConversation(data.conversation_id);
        } else {
            showToast(data.message || 'Error opening conversation', 'error');
        }
    } catch (err) {
        console.error('Error starting chat:', err);
    }
}

// ========================================================
// 10. PROFILE, GROUPS, SETTINGS & ADMIN
// ========================================================

function openProfileModal() {
    if (!currentUser) return;
    document.getElementById('profileDisplayNameInput').value = currentUser.display_name;
    document.getElementById('profileAvatarUrlInput').value = currentUser.avatar_path || '';
    
    // PROMINENT EDITABLE BIO FIELD ("text bio sahi tareeqa sa dika")
    document.getElementById('profileBioInput').value = currentUser.bio || '';
    document.getElementById('profilePhoneInput').value = currentUser.phone_number || '';
    document.getElementById('editProfileAvatarPreview').src = resolveMediaUrl(currentUser.avatar_path) || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.display_name)}&background=FF5A0A&color=fff`;

    document.getElementById('profileModal').style.display = 'flex';
}

// Handle Gallery / Camera image selection for Profile DP
async function handleProfileAvatarSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!file.type || !file.type.startsWith('image/')) {
        showToast('Please select an image file (PNG, JPG, WebP)', 'error');
        return;
    }

    try {
        showToast('Processing photo...', 'info');
        const compressedData = await compressAvatar(file);

        // Update preview in modal immediately
        const previewEl = document.getElementById('editProfileAvatarPreview');
        if (previewEl) {
            previewEl.src = compressedData;
        }

        // Put base64 into the avatar input field for form submission
        const urlInput = document.getElementById('profileAvatarUrlInput');
        if (urlInput) {
            urlInput.value = compressedData;
        }

        showToast('Photo selected! Click "Save Changes" to update your DP.', 'success');
    } catch (err) {
        console.error('Error processing gallery avatar:', err);
        showToast('Failed to process image', 'error');
    }
}

// Center-cropped square avatar compressor (400x400 JPEG)
function compressAvatar(file, targetSize = 400, quality = 0.88) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const minDim = Math.min(img.width, img.height);
                const sx = (img.width - minDim) / 2;
                const sy = (img.height - minDim) / 2;

                const canvas = document.createElement('canvas');
                canvas.width = targetSize;
                canvas.height = targetSize;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';

                ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetSize, targetSize);
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(dataUrl);
            };
            img.onerror = () => reject(new Error('Image decode failed'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
    });
}

async function handleProfileSubmit(e) {
    e.preventDefault();
    const display_name = document.getElementById('profileDisplayNameInput').value.trim();
    const avatar_path = document.getElementById('profileAvatarUrlInput').value.trim();
    const bio = document.getElementById('profileBioInput').value.trim();
    const phone_number = document.getElementById('profilePhoneInput').value.trim();

    try {
        const token = localStorage.getItem('chatnova_token');
        const res = await fetch(`${API_BASE}/api/users/me`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ display_name, avatar_path, bio, phone_number })
        });
        const data = await res.json();

        if (data.success && data.user) {
            currentUser = data.user;
            updateHeaderUserInfo();
            document.getElementById('profileModal').style.display = 'none';
            showToast('Profile updated successfully!', 'success');
            await loadConversations();
        } else {
            showToast(data.message || 'Failed to update profile', 'error');
        }
    } catch (err) {
        showToast('Error saving profile', 'error');
    }
}

async function openCreateGroupModal() {
    const list = document.getElementById('groupMembersChecklist');
    list.innerHTML = '';

    try {
        const token = localStorage.getItem('chatnova_token');
        const res = await fetch(`${API_BASE}/api/contacts`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        const contacts = data.contacts || [];
        if (contacts.length === 0) {
            list.innerHTML = '<p style="font-size: 12px; color: var(--secondary-text);">No contacts available yet. You can still create the group and invite members later!</p>';
        } else {
            contacts.forEach(c => {
                const item = document.createElement('label');
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                item.style.gap = '8px';
                item.style.margin = '4px 0';
                item.style.fontSize = '13px';
                item.innerHTML = `<input type="checkbox" value="${c.id}"> ${escapeHtml(c.display_name)} (@${escapeHtml(c.username)})`;
                list.appendChild(item);
            });
        }
    } catch (err) {
        console.error('Error fetching contacts for group:', err);
    }

    document.getElementById('createGroupModal').style.display = 'flex';
}

async function handleCreateGroupSubmit(e) {
    e.preventDefault();
    const title = document.getElementById('groupTitleInput').value.trim();
    const description = document.getElementById('groupDescInput').value.trim();

    const checked = Array.from(document.querySelectorAll('#groupMembersChecklist input:checked')).map(cb => cb.value);

    try {
        const token = localStorage.getItem('chatnova_token');
        const res = await fetch(`${API_BASE}/api/conversations/group`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ title, description, member_ids: checked })
        });
        const data = await res.json();

        if (data.success) {
            document.getElementById('createGroupModal').style.display = 'none';
            document.getElementById('createGroupForm').reset();
            showToast(`Group "${title}" created successfully!`, 'success');
            await loadConversations();
            selectConversation(data.conversation_id);
        } else {
            showToast(data.message || 'Error creating group', 'error');
        }
    } catch (err) {
        showToast('Error creating group', 'error');
    }
}

async function openAdminModal() {
    if (!currentUser || !currentUser.is_admin) return;

    try {
        const token = localStorage.getItem('chatnova_token');
        const statsRes = await fetch(`${API_BASE}/api/admin/stats`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const statsData = await statsRes.json();

        if (statsData.success) {
            document.getElementById('adminTotalUsers').textContent = statsData.stats.total_users;
            document.getElementById('adminActiveUsers').textContent = statsData.stats.active_users;
            document.getElementById('adminTotalMessages').textContent = statsData.stats.total_messages;
        }

        const usersRes = await fetch(`${API_BASE}/api/admin/users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const usersData = await usersRes.json();

        const list = document.getElementById('adminUsersList');
        list.innerHTML = '';
        if (usersData.success && usersData.users) {
            usersData.users.forEach(u => {
                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.justifyContent = 'space-between';
                row.style.alignItems = 'center';
                row.style.padding = '8px 12px';
                row.style.borderBottom = '1px solid var(--border-color)';
                row.style.fontSize = '13px';

                row.innerHTML = `
                    <div>
                        <strong>${escapeHtml(u.display_name)}</strong> (@${escapeHtml(u.username)})
                        <span style="font-size: 11px; color: ${u.account_status === 'active' ? 'var(--online-green)' : 'var(--error-red)'}; margin-left: 6px;">[${u.account_status}]</span>
                    </div>
                    <div>
                        ${u.id !== currentUser.id ? `
                            <button class="btn-pill-action" onclick="toggleUserStatus(${u.id}, '${u.account_status === 'active' ? 'suspended' : 'active'}')">
                                ${u.account_status === 'active' ? 'Suspend' : 'Restore'}
                            </button>
                        ` : '<span style="font-size: 11px; color: var(--muted-text);">You (Admin)</span>'}
                    </div>
                `;
                list.appendChild(row);
            });
        }

        document.getElementById('adminModal').style.display = 'flex';
    } catch (err) {
        showToast('Error loading admin metrics', 'error');
    }
}

async function toggleUserStatus(id, newStatus) {
    try {
        const token = localStorage.getItem('chatnova_token');
        const res = await fetch(`${API_BASE}/api/admin/users/${id}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ status: newStatus })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`User status updated to ${newStatus}`, 'success');
            openAdminModal();
        }
    } catch (err) {
        showToast('Error updating status', 'error');
    }
}

// ========================================================
// 11. EVENT LISTENERS SETUP
// ========================================================

function setupEventListeners() {
    // Navigation items
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const nav = btn.dataset.nav;
            document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (nav === 'admin') {
                openAdminModal();
            } else if (nav === 'settings') {
                document.getElementById('settingsModal').style.display = 'flex';
            } else if (nav === 'contacts') {
                document.getElementById('userSearchModal').style.display = 'flex';
            } else if (nav === 'groups') {
                activeFilter = 'group';
                document.querySelectorAll('.filter-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === 'group'));
                renderConversationsList();
            } else {
                activeFilter = 'all';
                document.querySelectorAll('.filter-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
                renderConversationsList();
            }
        });
    });

    // Chat filters
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeFilter = tab.dataset.filter;
            renderConversationsList();
        });
    });

    // New Chat & New Group buttons
    document.getElementById('newChatBtn').addEventListener('click', () => {
        document.getElementById('userSearchModal').style.display = 'flex';
        document.getElementById('userSearchQueryInput').focus();
    });

    document.getElementById('newGroupBtn').addEventListener('click', openCreateGroupModal);

    // Composer Input & Send
    const msgInput = document.getElementById('messageInput');
    msgInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    msgInput.addEventListener('input', handleTypingEvent);
    document.getElementById('sendMessageBtn').addEventListener('click', sendMessage);

    // Attachment file input
    document.getElementById('attachFileBtn').addEventListener('click', () => {
        document.getElementById('fileAttachmentInput').click();
    });
    document.getElementById('fileAttachmentInput').addEventListener('change', handleFileAttachment);
    document.getElementById('trayRemoveBtn').addEventListener('click', clearAttachmentTray);

    // Voice record buttons
    document.getElementById('voiceRecordBtn').addEventListener('click', startVoiceRecording);
    document.getElementById('cancelVoiceRecBtn').addEventListener('click', cancelVoiceRecording);
    document.getElementById('sendVoiceRecBtn').addEventListener('click', sendVoiceRecording);

    // Calls buttons
    document.getElementById('voiceCallBtn').addEventListener('click', () => startCall('audio'));
    document.getElementById('videoCallBtn').addEventListener('click', () => startCall('video'));
    document.getElementById('endCallBtn').addEventListener('click', endCall);
    document.getElementById('acceptCallBtn').addEventListener('click', acceptIncomingCall);
    document.getElementById('declineCallBtn').addEventListener('click', declineIncomingCall);

    // Toggle info panel
    document.getElementById('toggleInfoPanelBtn').addEventListener('click', () => {
        const panel = document.getElementById('promoInfoPanel');
        panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    });

    // Mobile back button handlers
    const exitMobileChat = () => {
        document.body.classList.remove('mobile-chat-active');
    };
    const mobileBackBtn = document.getElementById('mobileBackBtn');
    if (mobileBackBtn) mobileBackBtn.addEventListener('click', exitMobileChat);
    const chatHeaderBackBtn = document.getElementById('chatHeaderBackBtn');
    if (chatHeaderBackBtn) chatHeaderBackBtn.addEventListener('click', exitMobileChat);

    // User Search Modal
    document.getElementById('userSearchQueryInput').addEventListener('input', handleUserSearchInput);
    document.getElementById('closeUserSearchBtn').addEventListener('click', () => {
        document.getElementById('userSearchModal').style.display = 'none';
    });

    // Profile Modal & Gallery Avatar Upload
    document.getElementById('userMenuBtn').addEventListener('click', openProfileModal);
    document.getElementById('closeProfileBtn').addEventListener('click', () => {
        document.getElementById('profileModal').style.display = 'none';
    });
    document.getElementById('profileForm').addEventListener('submit', handleProfileSubmit);

    // Gallery Avatar Upload triggers
    const avatarClickable = document.getElementById('profileAvatarClickable');
    const avatarFileInput = document.getElementById('profileAvatarFileInput');
    const triggerAvatarBtn = document.getElementById('triggerAvatarUploadBtn');

    if (avatarClickable && avatarFileInput) {
        avatarClickable.addEventListener('click', () => avatarFileInput.click());
    }
    if (triggerAvatarBtn && avatarFileInput) {
        triggerAvatarBtn.addEventListener('click', () => avatarFileInput.click());
    }
    if (avatarFileInput) {
        avatarFileInput.addEventListener('change', handleProfileAvatarSelected);
    }

    // Settings Modal
    document.getElementById('closeSettingsBtn').addEventListener('click', () => {
        document.getElementById('settingsModal').style.display = 'none';
    });
    document.getElementById('settingsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const theme = document.getElementById('settingTheme').value;
        const online_visibility = document.getElementById('settingOnlineVisibility').value;
        const read_receipts_enabled = document.getElementById('settingReadReceipts').value === 'true';
        const sound_enabled = document.getElementById('settingSound').value === 'true';

        try {
            const token = localStorage.getItem('chatnova_token');
            await fetch(`${API_BASE}/api/settings`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ theme, online_visibility, read_receipts_enabled, sound_enabled })
            });

            applyUserSettings({ theme });
            document.getElementById('settingsModal').style.display = 'none';
            showToast('Settings saved successfully', 'success');
        } catch (err) {
            showToast('Error saving settings', 'error');
        }
    });

    // Group Modal Close
    document.getElementById('closeCreateGroupBtn').addEventListener('click', () => {
        document.getElementById('createGroupModal').style.display = 'none';
    });
    document.getElementById('createGroupForm').addEventListener('submit', handleCreateGroupSubmit);

    // Admin Modal Close
    document.getElementById('closeAdminBtn').addEventListener('click', () => {
        document.getElementById('adminModal').style.display = 'none';
    });

    // Auth Switchers
    document.getElementById('toRegisterLink').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('loginFormSection').style.display = 'none';
        document.getElementById('registerFormSection').style.display = 'block';
    });
    document.getElementById('toLoginLink').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('registerFormSection').style.display = 'none';
        document.getElementById('loginFormSection').style.display = 'block';
    });
    document.getElementById('toForgotPwdLink').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('loginFormSection').style.display = 'none';
        document.getElementById('forgotFormSection').style.display = 'block';
    });
    document.getElementById('backToLoginFromForgot').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('forgotFormSection').style.display = 'none';
        document.getElementById('loginFormSection').style.display = 'block';
    });

    // Auth Forms Submit
    document.getElementById('loginForm').addEventListener('submit', handleLoginSubmit);
    document.getElementById('registerForm').addEventListener('submit', handleRegisterSubmit);
    document.getElementById('forgotForm').addEventListener('submit', handleForgotSubmit);

    // Logout Button Listeners (Header, Sidebar, Profile Modal, Settings Modal)
    const headerLogoutBtn = document.getElementById('headerLogoutBtn');
    if (headerLogoutBtn) headerLogoutBtn.addEventListener('click', handleLogout);
    const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');
    if (sidebarLogoutBtn) sidebarLogoutBtn.addEventListener('click', handleLogout);
    const profileLogoutBtn = document.getElementById('profileLogoutBtn');
    if (profileLogoutBtn) profileLogoutBtn.addEventListener('click', handleLogout);
    const settingsLogoutBtn = document.getElementById('settingsLogoutBtn');
    if (settingsLogoutBtn) settingsLogoutBtn.addEventListener('click', handleLogout);
}

async function handleLogout() {
    if (!confirm('Are you sure you want to log out of ChatNova?')) {
        return;
    }

    try {
        const token = localStorage.getItem('chatnova_token');
        if (token) {
            await fetch(`${API_BASE}/api/auth/logout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            }).catch(() => {});
        }
    } catch (e) {
        console.warn('Logout API error:', e);
    } finally {
        // Disconnect real-time socket
        if (socket) {
            socket.disconnect();
            socket = null;
        }

        // Clear session token and in-memory states
        localStorage.removeItem('chatnova_token');
        currentUser = null;
        currentConversation = null;
        conversations = [];

        // Close all modals
        document.querySelectorAll('.modal-backdrop').forEach(m => m.style.display = 'none');

        // Reset UI components
        const convList = document.getElementById('conversationsList');
        if (convList) convList.innerHTML = '';
        
        const msgContainer = document.getElementById('messagesContainer');
        if (msgContainer) {
            msgContainer.innerHTML = `
                <div style="margin: auto; text-align: center; color: var(--secondary-text); max-width: 380px;" id="emptyChatPlaceholder">
                    <div style="width: 80px; height: 80px; margin: 0 auto 16px; border-radius: 50%; background: var(--soft-cream); display: flex; align-items: center; justify-content: center; color: var(--primary-orange);">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                    </div>
                    <h3 style="font-size: 18px; font-weight: 800; color: var(--main-text); margin-bottom: 6px;">ChatNova Conversations</h3>
                    <p style="font-size: 13px; line-height: 1.5;">Please sign in to view your chats and connect with friends.</p>
                </div>
            `;
        }
        
        document.getElementById('chatHeader').style.display = 'none';
        document.getElementById('chatComposerBar').style.display = 'none';
        document.getElementById('headerUserName').textContent = 'Guest';
        document.getElementById('headerUserAvatar').src = 'https://ui-avatars.com/api/?name=Guest&background=FF5A0A&color=fff';
        document.getElementById('adminNavBtn').style.display = 'none';
        document.body.classList.remove('mobile-chat-active');

        // Reset and show login form
        document.getElementById('loginIdentifier').value = '';
        document.getElementById('loginPassword').value = '';
        document.getElementById('registerFormSection').style.display = 'none';
        document.getElementById('forgotFormSection').style.display = 'none';
        document.getElementById('loginFormSection').style.display = 'block';

        showAuthModal(true);
        showToast('You have been logged out successfully.', 'info');
    }
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    const identifier = document.getElementById('loginIdentifier').value.trim();
    const password = document.getElementById('loginPassword').value;

    try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, password })
        });
        const data = await res.json();

        if (data.success && data.token) {
            localStorage.setItem('chatnova_token', data.token);
            currentUser = data.user;
            applyUserSettings(data.settings);
            updateHeaderUserInfo();
            connectSocket(data.token);
            await loadConversations();
            showAuthModal(false);
            showToast(`Welcome back, ${currentUser.display_name}!`, 'success');
        } else {
            showToast(data.message || 'Login failed', 'error');
        }
    } catch (err) {
        console.error('Login request failed:', err);
        showToast('Login server connection failed. Please make sure the Node server is running on port 3000.', 'error');
    }
}

async function handleRegisterSubmit(e) {
    e.preventDefault();
    const display_name = document.getElementById('regDisplayName').value.trim();
    const username = document.getElementById('regUsername').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const bio = document.getElementById('regBio').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm_password = document.getElementById('regConfirmPassword').value;

    try {
        const res = await fetch(`${API_BASE}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ display_name, username, email, bio, password, confirm_password })
        });
        const data = await res.json();

        if (data.success && data.token) {
            localStorage.setItem('chatnova_token', data.token);
            currentUser = data.user;
            updateHeaderUserInfo();
            connectSocket(data.token);
            await loadConversations();
            showAuthModal(false);
            showToast('Account registered successfully! Welcome to ChatNova.', 'success');
        } else {
            showToast(data.message || 'Registration failed', 'error');
        }
    } catch (err) {
        console.error('Registration request failed:', err);
        showToast('Registration server connection failed. Please make sure the Node server is running on port 3000.', 'error');
    }
}

async function handleForgotSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('forgotEmail').value.trim();
    try {
        const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.success) {
            alert(`Recovery Token Generated:\n\n${data.resetTokenPreview}\n\nUse this token or link to reset your password.`);
            document.getElementById('forgotFormSection').style.display = 'none';
            document.getElementById('loginFormSection').style.display = 'block';
        }
    } catch (err) {
        showToast('Error initiating reset', 'error');
    }
}

// ========================================================
// 12. EMOJI PICKER & UTILITIES
// ========================================================

function setupEmojiPicker() {
    const emojis = [
        '😊','😂','❤️','🔥','👍','🎉','🙌','✨','😍','🚀',
        '😎','🤩','🥳','🤔','👏','💯','🌟','💡','💬','👋',
        '🍕','☕','🌈','🎈','🏆','🎯','⚡','☀️','🌙','💻'
    ];

    const grid = document.getElementById('emojiGrid');
    if (!grid) return;
    grid.innerHTML = '';

    emojis.forEach(em => {
        const span = document.createElement('span');
        span.className = 'emoji-item';
        span.textContent = em;
        span.addEventListener('click', () => {
            const input = document.getElementById('messageInput');
            input.value += em;
            input.focus();
        });
        grid.appendChild(span);
    });

    const btn = document.getElementById('emojiPickerBtn');
    const pop = document.getElementById('emojiPickerPopup');
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        pop.style.display = pop.style.display === 'flex' ? 'none' : 'flex';
    });

    document.addEventListener('click', (e) => {
        if (!pop.contains(e.target) && e.target !== btn) {
            pop.style.display = 'none';
        }
    });
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    if (type === 'error') toast.style.borderLeftColor = 'var(--error-red)';
    if (type === 'success') toast.style.borderLeftColor = 'var(--success-green)';

    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function scrollToBottom() {
    const c = document.getElementById('messagesContainer');
    if (c) c.scrollTop = c.scrollHeight;
}

function escapeHtml(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatTimestamp(d) {
    if (!d) return '';
    const date = new Date(d);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
