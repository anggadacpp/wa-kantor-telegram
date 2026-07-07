// ==UserScript==
// @name         WA Web Kantor - Sync & Send
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  WA Web Kantor - Sync + Kirim Pesan via Telegram
// @match        https://web.whatsapp.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ============ KONFIGURASI ============
    const SERVER_URL = 'https://wa-kantor-telegram-production.up.railway.app';
    const CHECK_INTERVAL = 3000;

    // ============ STATE ============
    let lastChats = new Map();
    let lastMediaHashes = new Set();
    let isConnected = false;
    let lastCommandId = 0;
    let uiPanel = null;

    // ============ CSS ============
    GM_addStyle(`
        /* Floating Send Button */
        .wa-send-fab {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 999998;
            width: 56px;
            height: 56px;
            background: linear-gradient(135deg, #25D366, #128C7E);
            border: none;
            border-radius: 50%;
            cursor: pointer;
            box-shadow: 0 4px 20px rgba(37, 211, 102, 0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .wa-send-fab:hover {
            transform: scale(1.1);
            box-shadow: 0 6px 25px rgba(37, 211, 102, 0.5);
        }

        /* Send Panel */
        .wa-send-panel {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 999999;
            background: #1a1a2e;
            border-radius: 16px;
            padding: 24px;
            width: 360px;
            max-width: 90vw;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            display: none;
            font-family: Arial, sans-serif;
        }
        .wa-send-panel.show { display: block; }
        .wa-send-panel h3 {
            margin: 0 0 16px 0;
            color: #fff;
            font-size: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .wa-send-panel .close-btn {
            background: none;
            border: none;
            color: #888;
            font-size: 20px;
            cursor: pointer;
            padding: 0;
        }
        .wa-send-panel .close-btn:hover { color: #fff; }

        /* Contact List */
        .wa-contact-list {
            max-height: 200px;
            overflow-y: auto;
            margin-bottom: 12px;
            border-radius: 8px;
            background: #252542;
        }
        .wa-contact-item {
            padding: 10px 14px;
            color: #e0e0e0;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 10px;
            border-bottom: 1px solid #333;
            transition: background 0.2s;
        }
        .wa-contact-item:last-child { border-bottom: none; }
        .wa-contact-item:hover { background: #2a2a4a; }
        .wa-contact-item.selected { background: #128C7E; }
        .wa-contact-item .avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: #25D366;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            font-weight: bold;
            flex-shrink: 0;
        }
        .wa-contact-item .name { flex: 1; font-weight: 500; }
        .wa-contact-item .unread {
            background: #ff4444;
            color: white;
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 10px;
        }

        /* Message Input */
        .wa-msg-input {
            width: 100%;
            padding: 12px 14px;
            background: #252542;
            border: 1px solid #444;
            border-radius: 8px;
            color: #fff;
            font-size: 14px;
            resize: none;
            height: 80px;
            box-sizing: border-box;
            margin-bottom: 12px;
        }
        .wa-msg-input:focus { outline: none; border-color: #25D366; }

        /* Buttons */
        .wa-btn-row { display: flex; gap: 8px; }
        .wa-btn {
            flex: 1;
            padding: 10px;
            border: none;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.2s;
        }
        .wa-btn:hover { opacity: 0.85; }
        .wa-btn-green { background: #25D366; color: white; }
        .wa-btn-gray { background: #444; color: #ccc; }

        /* Status indicator */
        .wa-status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
            margin-right: 6px;
        }
        .wa-status-dot.online { background: #00ff00; }
        .wa-status-dot.offline { background: #ff4444; }

        /* Chat Header Send Button */
        .wa-chat-send-btn {
            background: #25D366;
            color: white;
            border: none;
            border-radius: 20px;
            padding: 8px 16px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            margin-left: 8px;
        }
        .wa-chat-send-btn:hover { background: #128C7E; }
    `);

    // ============ UI ============
    function createUI() {
        // FAB Button
        const fab = document.createElement('button');
        fab.className = 'wa-send-fab';
        fab.innerHTML = '💬';
        fab.title = 'Kirim Pesan via Telegram';
        fab.onclick = togglePanel;
        document.body.appendChild(fab);

        // Panel
        const panel = document.createElement('div');
        panel.className = 'wa-send-panel';
        panel.id = 'waSendPanel';
        panel.innerHTML = `
            <h3>
                <span>💬 Kirim Pesan WA</span>
                <button class="close-btn" onclick="document.getElementById('waSendPanel').classList.remove('show')">&times;</button>
            </h3>
            <div class="wa-contact-list" id="waContactList">
                <div style="padding:20px;text-align:center;color:#666;">Loading...</div>
            </div>
            <textarea class="wa-msg-input" id="waMsgInput" placeholder="Ketik pesan..."></textarea>
            <div class="wa-btn-row">
                <button class="wa-btn wa-btn-green" id="waSendBtn">📤 Kirim</button>
                <button class="wa-btn wa-btn-gray" onclick="document.getElementById('waSendPanel').classList.remove('show')">Batal</button>
            </div>
        `;
        document.body.appendChild(panel);
        uiPanel = panel;

        // Event listeners
        document.getElementById('waSendBtn').onclick = sendSelectedMessage;
        document.getElementById('waMsgInput').onkeydown = (e) => {
            if (e.key === 'Enter' && e.ctrlKey) sendSelectedMessage();
        };

        // Load contacts
        loadContacts();
        checkServer();
        startMonitor();
    }

    function togglePanel() {
        const panel = document.getElementById('waSendPanel');
        if (panel.classList.contains('show')) {
            panel.classList.remove('show');
        } else {
            panel.classList.add('show');
            loadContacts();
        }
    }

    // ============ CONTACTS ============
    function loadContacts() {
        const list = document.getElementById('waContactList');
        if (!list) return;

        const chats = getAllChats();
        if (!chats.length) {
            list.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">📭 Tidak ada chat<br><small>Buka beberapa chat dulu</small></div>';
            return;
        }

        list.innerHTML = chats.map(c => `
            <div class="wa-contact-item" data-name="${c.name}" onclick="selectContact(this)">
                <div class="avatar">${(c.name || '?')[0].toUpperCase()}</div>
                <div class="name">${c.name}</div>
                ${c.unread > 0 ? `<span class="unread">${c.unread}</span>` : ''}
            </div>
        `).join('');

        list.querySelectorAll('.wa-contact-item').forEach(el => {
            el.onclick = () => selectContact(el);
        });
    }

    window.selectContact = function(el) {
        document.querySelectorAll('.wa-contact-item').forEach(c => c.classList.remove('selected'));
        el.classList.add('selected');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    // ============ SEND MESSAGE ============
    function sendSelectedMessage() {
        const selected = document.querySelector('.wa-contact-item.selected');
        const msg = document.getElementById('waMsgInput').value.trim();

        if (!selected) {
            alert('Pilih kontak dulu!');
            return;
        }
        if (!msg) {
            alert('Ketik pesan dulu!');
            return;
        }

        const contactName = selected.dataset.name;
        const input = document.querySelector('div[title="' + contactName + '"] ~ div[contenteditable="true"], footer div[contenteditable="true"]');

        // Cari input pesan di WA Web
        const chatInput = document.querySelector('div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"]');

        if (chatInput) {
            // Klik kontak di sidebar dulu
            const contactEl = Array.from(document.querySelectorAll('span[title]')).find(el => el.getAttribute('title') === contactName);
            if (contactEl) {
                contactEl.click();
                setTimeout(() => {
                    typeAndSend(msg);
                }, 500);
            } else {
                typeAndSend(msg);
            }
        } else {
            // Fallback: kirim via server (indirect)
            sendToServer({
                type: 'send_message',
                contact: contactName,
                message: msg,
                via: 'wa_web_ui'
            });
            document.getElementById('waSendPanel').classList.remove('show');
            document.getElementById('waMsgInput').value = '';
            // Buka chat
            openChat(contactName);
        }
    }

    function typeAndSend(msg) {
        const input = document.querySelector('div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"]');
        if (!input) return;

        // Set focus dan ketik pesan
        input.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, msg);

        // Trigger input event
        input.dispatchEvent(new InputEvent('input', { bubbles: true }));

        // Klik kirim
        setTimeout(() => {
            const sendBtn = document.querySelector('button[data-testid="send"], button[data-tab="11"]');
            if (sendBtn) {
                sendBtn.click();
                document.getElementById('waSendPanel').classList.remove('show');
                document.getElementById('waMsgInput').value = '';
            }
        }, 200);
    }

    function openChat(name) {
        const chatItems = document.querySelectorAll('div[data-testid="chat-list"] > div');
        for (const item of chatItems) {
            const titleEl = item.querySelector('span[title]');
            if (titleEl && titleEl.getAttribute('title') === name) {
                item.click();
                return true;
            }
        }
        return false;
    }

    // ============ SERVER ============
    function checkServer() {
        GM_xmlhttpRequest({
            method: 'GET',
            url: SERVER_URL + '/status',
            timeout: 5000,
            onload: (r) => {
                if (r.status === 200) {
                    isConnected = true;
                    const fab = document.querySelector('.wa-send-fab');
                    if (fab) fab.style.opacity = '1';
                } else {
                    isConnected = false;
                }
            },
            onerror: () => {
                isConnected = false;
            }
        });
    }

    function sendToServer(data) {
        GM_xmlhttpRequest({
            method: 'POST',
            url: SERVER_URL + '/webhook',
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ ...data, timestamp: new Date().toISOString() }),
            onload: () => {},
            onerror: () => {}
        });
    }

    // ============ POLL COMMANDS ============
    function pollCommands() {
        GM_xmlhttpRequest({
            method: 'GET',
            url: SERVER_URL + '/commands',
            timeout: 5000,
            onload: (r) => {
                try {
                    const { commands } = JSON.parse(r.responseText);
                    if (commands && commands.length > 0) {
                        commands.forEach(executeCommand);
                    }
                } catch (e) {}
            },
            onerror: () => {}
        });
    }

    function executeCommand(cmd) {
        console.log('Executing command:', cmd);
        let success = true;
        let error = null;

        switch (cmd.action) {
            case 'open_chat':
                if (!openChat(cmd.contact)) {
                    success = false;
                    error = 'Chat tidak ditemukan';
                }
                break;

            case 'send_message':
                // Ketik pesan di chat yang sedang terbuka
                typeAndSend(cmd.message);
                break;

            case 'reload':
                window.location.reload();
                break;

            default:
                error = 'Unknown command: ' + cmd.action;
                success = false;
        }

        // Confirm ke server
        GM_xmlhttpRequest({
            method: 'POST',
            url: SERVER_URL + '/commands/done',
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ commandId: cmd.id, success, error })
        });
    }

    // ============ MONITOR ============
    function startMonitor() {
        console.log('🚀 WA Telegram Sync started');
        takeSnapshot();

        setInterval(() => {
            checkNewMessages();
            pollCommands();
        }, CHECK_INTERVAL);
    }

    function takeSnapshot() {
        const chats = getAllChats();
        lastChats.clear();
        chats.forEach(c => lastChats.set(c.name, c));
    }

    function getAllChats() {
        const chats = [];
        document.querySelectorAll('div[data-testid="chat-list"] > div').forEach(el => {
            const nameEl = el.querySelector('span[title]');
            const previewEl = el.querySelector('div[class*="copyable-text"] span');
            const unreadEl = el.querySelector('span[data-testid="ui-unread-count"]');
            if (nameEl) {
                chats.push({
                    name: nameEl.getAttribute('title'),
                    preview: previewEl ? previewEl.textContent : '',
                    unread: unreadEl ? parseInt(unreadEl.textContent) : 0
                });
            }
        });
        return chats;
    }

    function checkNewMessages() {
        const chats = getAllChats();
        const newMsgs = [];

        chats.forEach(chat => {
            const last = lastChats.get(chat.name);
            if (!last) {
                newMsgs.push({ type: 'new_chat', chat: chat.name, preview: chat.preview });
            }
            else if (chat.unread > 0 && chat.preview !== last.preview) {
                newMsgs.push({
                    type: 'new_message',
                    chat: chat.name,
                    preview: chat.preview,
                    unread: chat.unread
                });
            }
        });

        lastChats.clear();
        chats.forEach(c => lastChats.set(c.name, c));

        if (newMsgs.length > 0) {
            sendToServer({ type: 'chat_update', messages: newMsgs });
        }
    }

    // ============ INIT ============
    if (document.readyState === 'complete') {
        setTimeout(createUI, 3000);
    } else {
        window.addEventListener('load', () => setTimeout(createUI, 3000));
    }
})();
