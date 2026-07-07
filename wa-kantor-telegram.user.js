// ==UserScript==
// @name         WA Web Kantor - Telegram Sync
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Sinkronisasi WA Web ke Telegram
// @match        https://web.whatsapp.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ============ KONFIGURASI ============
    // GANTI DENGAN URL SERVER KAMU
    const SERVER_URL = 'https://YOUR_APP_NAME.railway.app/webhook';
    const MEDIA_URL = 'https://YOUR_APP_NAME.railway.app/webhook/media';

    const CHECK_INTERVAL = 5000;
    const AUTO_MEDIA_SYNC = true; // Kirim media otomatis ke Telegram

    // ============ STATE ============
    let lastChats = new Map();
    let lastMediaHashes = new Set();
    let isConnected = false;

    // ============ CSS ============
    GM_addStyle(`
        .wa-tg-widget { position: fixed; bottom: 20px; left: 20px; z-index: 999999; font-family: Arial, sans-serif; }
        .wa-tg-btn { background: linear-gradient(135deg, #0088cc, #00aaff); color: white; border: none; padding: 12px 20px; border-radius: 25px; cursor: pointer; font-size: 14px; font-weight: 600; box-shadow: 0 4px 15px rgba(0,136,204,0.4); display: flex; align-items: center; gap: 8px; }
        .wa-tg-btn:hover { transform: translateY(-2px); }
        .wa-tg-dot { width: 10px; height: 10px; border-radius: 50%; background: #ff4444; }
        .wa-tg-dot.online { background: #00ff00; }
        .wa-tg-panel { position: absolute; bottom: 60px; left: 0; background: white; border-radius: 16px; padding: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); width: 300px; display: none; }
        .wa-tg-panel.show { display: block; }
        .wa-tg-panel h4 { margin: 0 0 16px 0; color: #111; }
        .wa-tg-status { display: flex; justify-content: space-between; padding: 8px 12px; background: #f5f5f5; border-radius: 8px; margin-bottom: 12px; font-size: 13px; }
        .wa-tg-input { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 8px; font-size: 13px; margin-bottom: 10px; box-sizing: border-box; }
        .wa-tg-row { display: flex; gap: 8px; margin-bottom: 10px; }
        .wa-tg-btn-sm { flex: 1; padding: 10px; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; color: white; }
        .wa-tg-btn-blue { background: #0088cc; }
        .wa-tg-btn-green { background: #25D366; }
        .wa-tg-btn-red { background: #ff4444; }
        .wa-tg-log { background: #1a1a2e; color: #00ff00; border-radius: 8px; padding: 10px; font-family: monospace; font-size: 11px; max-height: 120px; overflow-y: auto; margin-top: 10px; }
        .wa-tg-media-toggle { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #f5f5f5; border-radius: 8px; margin-bottom: 12px; font-size: 12px; }
        .wa-tg-toggle { position: relative; width: 36px; height: 20px; }
        .wa-tg-toggle input { opacity: 0; width: 0; height: 0; }
        .wa-tg-slider { position: absolute; cursor: pointer; inset: 0; background: #ccc; border-radius: 20px; transition: 0.3s; }
        .wa-tg-slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.3s; }
        input:checked + .wa-tg-slider { background: #25D366; }
        input:checked + .wa-tg-slider:before { transform: translateX(16px); }
        @media (prefers-color-scheme: dark) {
            .wa-tg-panel { background: #1a1a2e; color: #e0e0e0; }
            .wa-tg-status { background: #2a2a4a; }
            .wa-tg-input { background: #2a2a4a; border-color: #444; color: #e0e0e0; }
            .wa-tg-media-toggle { background: #2a2a4a; }
            .wa-tg-log { background: #0d0d1a; }
        }
    `);

    // ============ UI ============
    function createUI() {
        const widget = document.createElement('div');
        widget.className = 'wa-tg-widget';
        widget.innerHTML = `
            <button class="wa-tg-btn" id="waTgBtn">
                <span class="wa-tg-dot" id="waTgDot"></span>
                <span>📱 Telegram</span>
            </button>
            <div class="wa-tg-panel" id="waTgPanel">
                <h4>📱 WA → Telegram Sync</h4>
                <div class="wa-tg-status">
                    <span>Server:</span>
                    <span id="waTgStatus">Connecting...</span>
                </div>
                <div class="wa-tg-media-toggle">
                    <span>📎 Auto Media Sync</span>
                    <label class="wa-tg-toggle">
                        <input type="checkbox" id="waTgMediaToggle" ${AUTO_MEDIA_SYNC ? 'checked' : ''}>
                        <span class="wa-tg-slider"></span>
                    </label>
                </div>
                <input type="text" class="wa-tg-input" id="waTgUrl" placeholder="Server URL" value="${SERVER_URL}">
                <div class="wa-tg-row">
                    <button class="wa-tg-btn-sm wa-tg-btn-blue" id="waTgTest">🧪 Test</button>
                    <button class="wa-tg-btn-sm wa-tg-btn-green" id="waTgSync">🔄 Sync</button>
                    <button class="wa-tg-btn-sm wa-tg-btn-red" id="waTgClear">🗑️</button>
                </div>
                <div class="wa-tg-log" id="waTgLog">Log...\n</div>
            </div>
        `;
        document.body.appendChild(widget);

        document.getElementById('waTgBtn').onclick = () => {
            document.getElementById('waTgPanel').classList.toggle('show');
        };

        document.getElementById('waTgTest').onclick = sendTest;
        document.getElementById('waTgSync').onclick = doSync;
        document.getElementById('waTgClear').onclick = () => document.getElementById('waTgLog').innerHTML = '';
        document.getElementById('waTgMediaToggle').onchange = (e) => {
            window.AUTO_MEDIA_SYNC = e.target.checked;
            log((window.AUTO_MEDIA_SYNC ? '✅' : '⛔') + ' Auto media sync ' + (window.AUTO_MEDIA_SYNC ? 'ON' : 'OFF'));
        };
        window.AUTO_MEDIA_SYNC = AUTO_MEDIA_SYNC;

        checkServer();
        startMonitor();
        addDownloadButtons();
    }

    function log(msg) {
        const logDiv = document.getElementById('waTgLog');
        const time = new Date().toLocaleTimeString('id-ID');
        logDiv.innerHTML = `[${time}] ${msg}<br>` + logDiv.innerHTML;
    }

    // ============ SERVER ============
    function checkServer() {
        const url = document.getElementById('waTgUrl').value;
        GM_xmlhttpRequest({
            method: 'GET',
            url: url.replace('/webhook', '/status'),
            timeout: 5000,
            onload: (r) => {
                if (r.status === 200) {
                    isConnected = true;
                    document.getElementById('waTgStatus').textContent = 'Online ✅';
                    document.getElementById('waTgStatus').style.color = '#00aa00';
                    document.getElementById('waTgDot').classList.add('online');
                    log('✅ Server online');
                }
            },
            onerror: () => {
                isConnected = false;
                document.getElementById('waTgStatus').textContent = 'Offline ❌';
                document.getElementById('waTgStatus').style.color = '#ff4444';
                document.getElementById('waTgDot').classList.remove('online');
                log('❌ Server offline');
            },
            ontimeout: () => {
                document.getElementById('waTgStatus').textContent = 'Timeout';
                log('❌ Connection timeout');
            }
        });
    }

    function sendToServer(data) {
        const url = document.getElementById('waTgUrl').value;
        if (!url || url.includes('YOUR_APP')) {
            log('⚠️ Set server URL dulu');
            return;
        }

        GM_xmlhttpRequest({
            method: 'POST',
            url: url,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ ...data, timestamp: new Date().toISOString() }),
            onload: () => log('✅ Terkirim'),
            onerror: () => log('❌ Gagal kirim')
        });
    }

    function sendTest() {
        log('🧪 Testing...');
        sendToServer({ type: 'test', message: 'Test dari WA Web Kantor' });
    }

    function doSync() {
        log('🔄 Syncing...');
        const chats = getAllChats();
        sendToServer({ type: 'sync', chats: chats, count: chats.length });
        log('📊 ' + chats.length + ' chat');
    }

    // ============ MONITOR ============
    function startMonitor() {
        log('🚀 Monitoring started (media: ' + (AUTO_MEDIA_SYNC ? 'ON' : 'OFF') + ')');
        takeSnapshot();

        setInterval(() => {
            checkNewMessages();
            checkNewMedia();
            addDownloadButtons();
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
        // Simple hash untuk track media yang sudah dikirim
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

        // Gambar: cari img di dalam message container
        document.querySelectorAll('div[style*="background-image"]').forEach(el => {
            const style = el.getAttribute('style') || '';
            if (style.includes('blob:') || style.includes('whatsapp') || style.includes('base64')) {
                const bgi = style.match(/url\(["']?([^"')]+)["']?\)/);
                if (bgi && bgi[1]) {
                    media.push({ type: 'image', url: bgi[1], chat: chatName });
                }
            }
        });

        // Gambar: img dengan src yang valid
        document.querySelectorAll('div[class*="message"] img[src]').forEach(img => {
            const src = img.src;
            if (src && (src.includes('whatsapp') || src.includes('mm-image') || src.includes('blob:'))) {
                media.push({ type: 'image', url: src, chat: chatName });
            }
        });

        // Video: elemen video dengan src
        document.querySelectorAll('video[src]').forEach(vid => {
            const src = vid.src;
            if (src && (src.includes('whatsapp') || src.includes('blob:'))) {
                media.push({ type: 'video', url: src, chat: chatName });
            }
        });

        // Thumbnail video (click to play)
        document.querySelectorAll('div[aria-label="Video"]').forEach(el => {
            const vid = el.querySelector('video');
            if (vid && vid.src) {
                media.push({ type: 'video', url: vid.src, chat: chatName });
            }
        });

        // Dokumen
        document.querySelectorAll('div[class*="document"] a[href]').forEach(a => {
            const href = a.href;
            if (href && href.length > 20) {
                media.push({ type: 'document', url: href, chat: chatName });
            }
        });

        // Audio / voice
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

        // Cleanup hash set agar tidak terlalu besar
        if (lastMediaHashes.size > 200) {
            const arr = Array.from(lastMediaHashes);
            lastMediaHashes = new Set(arr.slice(-100));
        }

        const serverUrl = document.getElementById('waTgUrl').value.replace('/webhook', '/webhook/media');
        if (!serverUrl || serverUrl.includes('YOUR_APP')) {
            log('⚠️ Set server URL dulu');
            return;
        }

        log('📤 Mengirim media: ' + mediaItem.type + '...');

        GM_xmlhttpRequest({
            method: 'POST',
            url: serverUrl,
            headers: {
                'Accept': 'application/json'
            },
            data: JSON.stringify({
                mediaType: mediaItem.type,
                mediaUrl: mediaItem.url,
                chatName: mediaItem.chat,
                caption: '',
                timestamp: new Date().toISOString()
            }),
            onload: (r) => {
                try {
                    const res = JSON.parse(r.responseText);
                    log('✅ Media terkirim: ' + mediaItem.type);
                } catch (e) {
                    if (r.status >= 200 && r.status < 300) {
                        log('✅ Media terkirim: ' + mediaItem.type);
                    } else {
                        log('❌ Gagal kirim media');
                    }
                }
            },
            onerror: () => log('❌ Gagal kirim media: network error')
        });
    }

    function checkNewMedia() {
        if (!window.AUTO_MEDIA_SYNC) return;

        const media = getMediaFromOpenChat();
        media.forEach(m => sendMediaToServer(m));
    }

    // ============ DOWNLOAD ============
    function addDownloadButtons() {
        document.querySelectorAll('img[src*="mm-image"]').forEach(img => {
            if (img.dataset.dl) return;
            img.dataset.dl = '1';

            const container = img.closest('div[class*="_1wVLA"], div[class*="_3ts54"]');
            if (!container) return;

            const btn = document.createElement('button');
            btn.innerHTML = '⬇️';
            btn.style.cssText = 'position:absolute;top:5px;right:5px;background:rgba(0,0,0,0.6);color:white;border:none;border-radius:50%;width:26px;height:26px;cursor:pointer;opacity:0;z-index:10;';
            btn.onclick = (e) => { e.stopPropagation(); dlImg(img.src); };

            const tgBtn = document.createElement('button');
            tgBtn.innerHTML = '📤';
            tgBtn.style.cssText = 'position:absolute;top:5px;right:36px;background:rgba(0,136,204,0.8);color:white;border:none;border-radius:50%;width:26px;height:26px;cursor:pointer;opacity:0;z-index:10;';
            tgBtn.onclick = (e) => {
                e.stopPropagation();
                sendMediaToServer({ type: 'image', url: img.src, chat: getOpenChatName() });
            };

            container.style.position = 'relative';
            container.onmouseenter = () => { btn.style.opacity = '1'; tgBtn.style.opacity = '1'; };
            container.onmouseleave = () => { btn.style.opacity = '0'; tgBtn.style.opacity = '0'; };
            container.appendChild(btn);
            container.appendChild(tgBtn);
        });
    }

    function dlImg(url) {
        const name = 'WA_' + Date.now() + '.jpg';
        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            responseType: 'blob',
            onload: (r) => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(r.response);
                a.download = name;
                a.click();
                log('⬇️ ' + name);
            }
        });
    }

    // ============ INIT ============
    if (document.readyState === 'complete') {
        setTimeout(createUI, 3000);
    } else {
        window.addEventListener('load', () => setTimeout(createUI, 3000));
    }
})();
