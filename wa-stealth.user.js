// ==UserScript==
// @name         WA Web Kantor - Sync
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  WA Web Kantor - Silent Sync
// @match        https://web.whatsapp.com/*
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ============ KONFIGURASI ============
    const SERVER_URL = 'https://wa-kantor-telegram-production.up.railway.app';
    const CHECK_INTERVAL = 5000;

    // ============ STATE ============
    let lastChats = new Map();
    let lastMediaHashes = new Set();
    let isConnected = false;

    // ============ SERVER ============
    function checkServer() {
        GM_xmlhttpRequest({
            method: 'GET',
            url: SERVER_URL + '/status',
            timeout: 5000,
            onload: (r) => {
                isConnected = r.status === 200;
            },
            onerror: () => {
                isConnected = false;
            }
        });
    }

    function sendToServer(data) {
        if (!isConnected) return;

        GM_xmlhttpRequest({
            method: 'POST',
            url: SERVER_URL + '/webhook',
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ ...data, timestamp: new Date().toISOString() }),
            onload: () => {},
            onerror: () => {}
        });
    }

    // ============ MONITOR ============
    function startMonitor() {
        checkServer();
        takeSnapshot();

        setInterval(() => {
            checkServer();
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
        let success = true;
        let error = null;

        switch (cmd.action) {
            case 'reload':
                window.location.reload();
                break;
            default:
                // Unknown command — ignore
                break;
        }

        GM_xmlhttpRequest({
            method: 'POST',
            url: SERVER_URL + '/commands/done',
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ commandId: cmd.id, success, error })
        });
    }

    // ============ INIT ============
    if (document.readyState === 'complete') {
        setTimeout(startMonitor, 3000);
    } else {
        window.addEventListener('load', () => setTimeout(startMonitor, 3000));
    }
})();
