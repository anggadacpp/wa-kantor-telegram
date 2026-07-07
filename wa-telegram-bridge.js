// wa-telegram-bridge.js
// ============================================
// WA Web via Telegram - Full WhatsApp Control
// ============================================

const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const qrImage = require('qr-image');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

// ============ FIX: Hapus file server lama ============
// Bersihkan file lama untuk hindari conflict
const oldServerFile = path.join(__dirname, 'wa-telegram-server.js');
const oldRenderFile = path.join(__dirname, 'render.yaml');
const oldDockerFile = path.join(__dirname, 'Dockerfile');
const oldPackage = path.join(__dirname, 'package.json');

try {
    if (fs.existsSync(oldServerFile)) {
        fs.unlinkSync(oldServerFile);
        console.log('🗑️ Dihapus: wa-telegram-server.js (lama)');
    }
    // Keep render.yaml & Dockerfile tapi hapus dari start
} catch (e) {}

// ============ KONFIGURASI ============
const CONFIG = {
    TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || '8810076737:AAF3B5gPsriXuDc6l7nS0v7ydwQSfz6KpY8',
    ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID || null, // Di-set setelah user chat
    PORT: parseInt(process.env.PORT) || 3000,
    AUTH_DIR: './auth_info'
};

// ============ EXPRESS (health check) ============
const app = express();
app.use(express.json());
app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        whatsapp: sock ? 'connected' : 'disconnected',
        telegram: 'connected',
        timestamp: new Date().toISOString()
    });
});
app.get('/', (req, res) => res.send('🤖 WA Telegram Bridge - Online'));

// ============ TELEGRAM BOT ============
const bot = new TelegramBot(CONFIG.TELEGRAM_TOKEN, { polling: true });

// ============ STATE ============
let sock = null;
let chatStore = new Map(); // Simpan recent messages
let pendingQR = null;
let isConnecting = false;

// Helpers
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function getChatId(msg) {
    return msg.chat.id.toString();
}

function isAdmin(chatId) {
    return CONFIG.ADMIN_CHAT_ID && chatId === CONFIG.ADMIN_CHAT_ID;
}

function setAdmin(chatId) {
    if (!CONFIG.ADMIN_CHAT_ID) {
        CONFIG.ADMIN_CHAT_ID = chatId;
        console.log(`✅ Admin Chat ID set: ${chatId}`);
    }
}

// ============ UTILITAS ============
function formatJam(date) {
    return new Date(date).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date) {
    return new Date(date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function truncate(text, max = 100) {
    if (!text) return '';
    return text.length > max ? text.substring(0, max) + '...' : text;
}

async function sendText(chatId, text, opts = {}) {
    try {
        return await bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...opts });
    } catch (e) {
        console.error('Send text error:', e.message);
    }
}

async function sendPhoto(chatId, buffer, caption = '') {
    try {
        return await bot.sendPhoto(chatId, buffer, { caption, parse_mode: 'HTML' });
    } catch (e) {
        console.error('Send photo error:', e.message);
        return await sendText(chatId, `❌ Gagal kirim foto: ${e.message}`);
    }
}

async function sendDocument(chatId, buffer, filename, caption = '') {
    try {
        return await bot.sendDocument(chatId, buffer, { caption, parse_mode: 'HTML' });
    } catch (e) {
        console.error('Send doc error:', e.message);
        return await sendText(chatId, `❌ Gagal kirim: ${e.message}`);
    }
}

// ============ KIRIM QR CODE KE TELEGRAM ============
async function sendQRCode(qrCode) {
    if (!CONFIG.ADMIN_CHAT_ID) {
        console.log('⚠️ QR Code ready, waiting for admin to start bot...');
        pendingQR = qrCode;
        return;
    }

    try {
        const qrBuffer = qrImage.imageSync(qrCode, { type: 'png', size: 10 });
        await bot.sendPhoto(CONFIG.ADMIN_CHAT_ID, qrBuffer, {
            caption: '📱 <b>Scan QR Code ini untuk login WA Web</b>\n\n⏰ QR Code expired dalam ~60 detik\n\nLangsung buka WhatsApp di HP:\n1. Settings → Linked Devices\n2. Link a Device\n3. Scan QR Code ini'
        });
        console.log('✅ QR Code sent to Telegram');
    } catch (e) {
        console.error('Failed to send QR:', e.message);
    }
}

// ============ PARSE PESAN WHATSAPP ============
async function parseMessage(msg) {
    if (!msg) return null;

    const type = Object.keys(msg)[0];
    const m = msg[type];
    if (!m) return null;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const senderName = msg.pushName || (isGroup ? 'Unknown' : from.split('@')[0]);

    let text = '';
    let mediaType = null;
    let mediaBuffer = null;
    let mediaMimetype = null;

    if (type === 'conversation') {
        text = m.text || '';
    } else if (type === 'extendedTextMessage') {
        text = m.text || '';
    } else if (type === 'imageMessage') {
        mediaType = 'image';
        mediaMimetype = m.mimetype || 'image/jpeg';
        text = m.caption || '📷 Foto';
        try {
            const media = await sock.downloadMediaMessage(msg);
            if (media) mediaBuffer = Buffer.from(media);
        } catch (e) {
            text += ' [media download failed]';
        }
    } else if (type === 'videoMessage') {
        mediaType = 'video';
        mediaMimetype = m.mimetype || 'video/mp4';
        text = m.caption || '🎥 Video';
        try {
            const media = await sock.downloadMediaMessage(msg);
            if (media) mediaBuffer = Buffer.from(media);
        } catch (e) {
            text += ' [media download failed]';
        }
    } else if (type === 'audioMessage') {
        mediaType = 'audio';
        mediaMimetype = m.mimetype || 'audio/ogg';
        text = '🎵 Voice/Audio';
        try {
            const media = await sock.downloadMediaMessage(msg);
            if (media) mediaBuffer = Buffer.from(media);
        } catch (e) {}
    } else if (type === 'documentMessage') {
        mediaType = 'document';
        mediaMimetype = m.mimetype || 'application/pdf';
        text = `📄 ${m.fileName || 'Document'}`;
        try {
            const media = await sock.downloadMediaMessage(msg);
            if (media) mediaBuffer = Buffer.from(media);
        } catch (e) {}
    }

    return {
        key: msg.key,
        from,
        isGroup,
        senderName,
        text,
        type,
        mediaType,
        mediaBuffer,
        mediaMimetype,
        timestamp: msg.messageTimestamp
    };
}

// ============ INIT WHATSAPP (BAILEYS) ============
async function initWhatsApp() {
    if (isConnecting) return;
    isConnecting = true;

    const { state, saveCreds } = await useMultiFileAuthState(CONFIG.AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browserDescription: ['WA Telegram Bridge', 'Desktop', '2.0']
    });

    // QR Code event
    sock.ev.on('qr', async (qr) => {
        console.log('📱 QR Code received');
        await sendQRCode(qr);
    });

    // Connection update
    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        console.log('Connection update:', connection, reason);

        if (connection === 'open') {
            console.log('✅ WhatsApp connected!');
            if (CONFIG.ADMIN_CHAT_ID) {
                sendText(CONFIG.ADMIN_CHAT_ID, '✅ <b>WhatsApp Connected!</b>\n\nSekarang kamu bisa:\n• /inbox - Lihat daftar chat\n• /chat <nama> - Baca pesan\n• /photo - Download foto terbaru\n\n💬 Kirim pesan apapun ke bot untuk kirim ke WA!');
            }
        }

        if (connection === 'close') {
            if (reason === DisconnectReason.loggedOut) {
                console.log('❌ Logged out, delete auth folder to re-login');
                if (CONFIG.ADMIN_CHAT_ID) {
                    sendText(CONFIG.ADMIN_CHAT_ID, '❌ <b>WhatsApp Logged Out</b>\n\nHapus folder auth_info dan restart untuk login ulang.\n\n/relink - Login ulang');
                }
            } else if (reason !== DisconnectReason.intentional) {
                console.log('⚡ Reconnecting in 5s...');
                setTimeout(() => initWhatsApp(), 5000);
            }
        }
    });

    // Creds update
    sock.ev.on('creds.update', saveCreds);

    // Incoming messages
    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msgData of messages) {
            // Skip self messages
            if (msgData.key.fromMe) continue;

            const parsed = await parseMessage(msgData.message);
            if (!parsed) continue;

            // Simpan ke chat store
            if (!chatStore.has(parsed.from)) {
                chatStore.set(parsed.from, []);
            }
            const chat = chatStore.get(parsed.from);
            chat.push({ ...parsed, receivedAt: Date.now() });
            if (chat.length > 100) chat.splice(0, chat.length - 100);

            // Forward ke Telegram
            if (CONFIG.ADMIN_CHAT_ID) {
                const time = formatJam(parsed.timestamp * 1000);
                const sender = parsed.isGroup ? `👤 ${parsed.senderName}` : '';

                if (parsed.mediaBuffer) {
                    if (parsed.mediaType === 'image') {
                        await sendPhoto(CONFIG.ADMIN_CHAT_ID, parsed.mediaBuffer,
                            `${sender}\n💬 ${parsed.text}\n⏰ ${time}`);
                    } else if (parsed.mediaType === 'video') {
                        await sendVideo(parsed.mediaBuffer, `${sender}\n💬 ${parsed.text}\n⏰ ${time}`);
                    } else {
                        await sendDocument(CONFIG.ADMIN_CHAT_ID, parsed.mediaBuffer,
                            `${parsed.mediaMimetype}/${path.basename(parsed.mediaMimetype)}`,
                            `${sender}\n💬 ${parsed.text}\n⏰ ${time}`);
                    }
                } else {
                    await sendText(CONFIG.ADMIN_CHAT_ID,
                        `${sender}\n💬 ${parsed.text}\n⏰ ${time}`);
                }
            }
        }
    });

    isConnecting = false;
}

async function sendVideo(chatId, buffer, caption = '') {
    try {
        await bot.sendVideo(chatId, buffer, { caption, parse_mode: 'HTML' });
    } catch (e) {
        console.error('Send video error:', e.message);
        await sendText(chatId, `❌ Gagal kirim video: ${e.message}`);
    }
}

// ============ TELEGRAM COMMANDS ============

// /start
bot.onText(/\/start/, async (msg) => {
    const chatId = getChatId(msg);
    setAdmin(chatId);

    await sendText(chatId,
        '🤖 <b>WA Telegram Bridge</b>\n\n' +
        'Kontrol WhatsApp dari sini!\n\n' +
        '📋 Commands:\n' +
        '/inbox - Daftar chat WA\n' +
        '/chat <nama> - Baca pesan\n' +
        '/send <nama> <pesan> - Kirim pesan\n' +
        '/photo <nama> - Download foto terbaru\n' +
        '/unread - Pesan belum dibaca\n' +
        '/status - Status koneksi\n' +
        '/relink - Scan QR ulang\n\n' +
        '💬 Kirim pesan langsung ke kontak!'
    );
});

// /help
bot.onText(/\/help/, async (msg) => {
    const chatId = getChatId(msg);
    await sendText(chatId,
        '📖 <b>Panduan</b>\n\n' +
        '<b>/inbox</b> - Tampilkan semua chat WA\n' +
        '<b>/chat Nama</b> - Lihat pesan dari kontak tertentu\n' +
        '<b>/send Nama Pesan</b> - Kirim pesan ke kontak\n' +
        '<b>/photo Nama</b> - Download foto terakhir dari kontak\n' +
        '<b>/unread</b> - Chat yang belum dibaca\n' +
        '<b>/relink</b> - Scan QR code baru\n\n' +
        '<b>Tips:</b>\n' +
        '• Ketik namachat parsial, misal: /chat budi\n' +
        '• Kirim foto/voice langsung ke bot untuk forward ke WA\n' +
        '• Auto forward aktif untuk pesan masuk'
    );
});

// /status
bot.onText(/\/status/, async (msg) => {
    const chatId = getChatId(msg);
    const waStatus = sock ? (sock.ws && sock.ws.readyState === 1 ? '✅ Connected' : '⏳ Connecting...') : '❌ Disconnected';

    await sendText(chatId,
        '📡 <b>Status</b>\n\n' +
        `WhatsApp: ${waStatus}\n` +
        `Telegram: ✅ Connected\n` +
        `Admin: ${CONFIG.ADMIN_CHAT_ID || 'Belum diset'}\n` +
        `Chats tersimpan: ${chatStore.size}`
    );
});

// /relink - Kirim QR code baru
bot.onText(/\/relink/, async (msg) => {
    const chatId = getChatId(msg);
    if (!isAdmin(chatId)) return;

    await sendText(chatId, '🔄 Mengirim QR Code baru...');

    // Force disconnect dan reconnect
    if (sock) {
        try { sock.end(); } catch (e) {}
        sock = null;
    }

    // Hapus auth dan reconnect
    try {
        fs.rmSync(CONFIG.AUTH_DIR, { recursive: true, force: true });
    } catch (e) {}
    await delay(1000);
    initWhatsApp();
});

// /inbox - List semua chat
bot.onText(/\/inbox/, async (msg) => {
    const chatId = getChatId(msg);
    if (!sock) return sendText(chatId, '❌ WhatsApp belum terhubung');

    try {
        const chats = await sock.store.chats.fetch();
        const chatList = Object.values(chats).slice(0, 30);

        if (!chatList.length) {
            return sendText(chatId, '📭 Tidak ada chat');
        }

        let text = '📋 <b>Inbox WA</b>\n\n';

        chatList.forEach((chat, i) => {
            const name = chat.name || chat.jid.split('@')[0];
            const unread = chat.unreadCount || 0;
            const marker = unread > 0 ? ' 🔴' : '';
            text += `${i + 1}. ${name}${marker}\n`;
        });

        text += `\n💡 Ketik <code>/chat Nama</code> untuk baca pesan`;

        await sendText(chatId, text);
    } catch (e) {
        console.error('Inbox error:', e);
        sendText(chatId, '❌ Gagal mengambil inbox');
    }
});

// /unread - Chat belum dibaca
bot.onText(/\/unread/, async (msg) => {
    const chatId = getChatId(msg);
    if (!sock) return sendText(chatId, '❌ WhatsApp belum terhubung');

    try {
        const chats = await sock.store.chats.fetch();
        const unread = Object.values(chats)
            .filter(c => c.unreadCount > 0)
            .slice(0, 20);

        if (!unread.length) {
            return sendText(chatId, '✅ Semua chat sudah dibaca');
        }

        let text = '🔴 <b>Unread Messages</b>\n\n';

        for (const chat of unread) {
            const name = chat.name || chat.jid.split('@')[0];
            text += `👤 <b>${name}</b> (${chat.unreadCount} pesan)\n`;
            text += `📎 /chat ${name}\n\n`;
        }

        await sendText(chatId, text);
    } catch (e) {
        sendText(chatId, '❌ Gagal mengambil unread');
    }
});

// /chat <nama> - Baca pesan dari kontak
bot.onText(/\/chat (.+)/, async (msg, match) => {
    const chatId = getChatId(msg);
    const query = (match[1] || '').trim().toLowerCase();

    if (!query) return sendText(chatId, 'Usage: /chat <nama>');

    if (!sock) return sendText(chatId, '❌ WhatsApp belum terhubung');

    try {
        // Cari chat berdasarkan nama
        const chats = await sock.store.chats.fetch();
        const chatArr = Object.values(chats);
        const found = chatArr.find(c =>
            (c.name || '').toLowerCase().includes(query) ||
            c.jid.split('@')[0].toLowerCase().includes(query)
        );

        if (!found) {
            return sendText(chatId, `❌ Tidak ketemu: "${query}"\n\nGunakan /inbox untuk lihat daftar chat.`);
        }

        const jid = found.jid;
        const name = found.name || jid.split('@')[0];

        // Ambil pesan dari store
        const messages = await sock.store.messages.fetch(jid, { limit: 20 });
        const msgArr = Object.values(messages || {}).sort((a, b) =>
            (a.messageTimestamp || 0) - (b.messageTimestamp || 0)
        );

        if (!msgArr.length) {
            return sendText(chatId, `📭 Belum ada pesan dari ${name}`);
        }

        let text = `💬 <b>Chat: ${name}</b>\n`;
        text += `📊 ${msgArr.length} pesan terakhir\n\n`;

        // Parse dan tampilkan pesan
        for (const m of msgArr.slice(-15)) {
            const parsed = await parseMessage(m.message);
            if (!parsed) continue;

            const time = formatJam(parsed.timestamp * 1000);
            const sender = parsed.isGroup ? `(${parsed.senderName}) ` : '';
            const prefix = parsed.key.fromMe ? '📤 ' : '📥 ';

            if (parsed.mediaBuffer) {
                text += `${prefix}${sender}${parsed.mediaType === 'image' ? '📷' : parsed.mediaType === 'video' ? '🎥' : '📄'} [${parsed.text}]\n⏰ ${time}\n\n`;
            } else {
                text += `${prefix}${sender}${truncate(parsed.text, 80)}\n⏰ ${time}\n\n`;
            }
        }

        text += `\n📷 /photo ${name}`;
        text += `\n📤 /send ${name} <pesan>`;

        await sendText(chatId, text);

        // Jika ada media, kirim juga
        for (const m of msgArr.slice(-5).reverse()) {
            const parsed = await parseMessage(m.message);
            if (parsed && parsed.mediaBuffer) {
                if (parsed.mediaType === 'image') {
                    await sendPhoto(chatId, parsed.mediaBuffer, `📷 dari ${name}`);
                }
            }
        }
    } catch (e) {
        console.error('Chat error:', e);
        sendText(chatId, `❌ Error: ${e.message}`);
    }
});

// /photo <nama> - Download foto terakhir
bot.onText(/\/photo (.+)/, async (msg, match) => {
    const chatId = getChatId(msg);
    const query = (match[1] || '').trim().toLowerCase();

    if (!sock) return sendText(chatId, '❌ WhatsApp belum terhubung');

    try {
        const chats = await sock.store.chats.fetch();
        const chatArr = Object.values(chats);
        const found = chatArr.find(c =>
            (c.name || '').toLowerCase().includes(query) ||
            c.jid.split('@')[0].toLowerCase().includes(query)
        );

        if (!found) {
            return sendText(chatId, `❌ Tidak ketemu: "${query}"`);
        }

        const jid = found.jid;
        const name = found.name || jid.split('@')[0];

        const messages = await sock.store.messages.fetch(jid, { limit: 50 });
        const msgArr = Object.values(messages || {}).reverse();

        let foundPhoto = false;
        for (const m of msgArr) {
            const parsed = await parseMessage(m.message);
            if (parsed && parsed.mediaType === 'image' && parsed.mediaBuffer) {
                await sendPhoto(chatId, parsed.mediaBuffer, `📷 dari ${name} • ${formatJam(parsed.timestamp * 1000)}`);
                foundPhoto = true;
                break;
            }
        }

        if (!foundPhoto) {
            sendText(chatId, `📷 Tidak ada foto dari ${name}`);
        }
    } catch (e) {
        console.error('Photo error:', e);
        sendText(chatId, `❌ Error: ${e.message}`);
    }
});

// /send <nama> <pesan> - Kirim pesan WA
bot.onText(/\/send (.+?) (.+)/, async (msg, match) => {
    const chatId = getChatId(msg);
    const nama = (match[1] || '').trim();
    const text = (match[2] || '').trim();

    if (!sock) return sendText(chatId, '❌ WhatsApp belum terhubung');
    if (!text) return sendText(chatId, 'Usage: /send <nama> <pesan>');

    try {
        const chats = await sock.store.chats.fetch();
        const chatArr = Object.values(chats);
        const found = chatArr.find(c =>
            (c.name || '').toLowerCase().includes(nama.toLowerCase()) ||
            c.jid.split('@')[0].toLowerCase().includes(nama.toLowerCase())
        );

        if (!found) {
            return sendText(chatId, `❌ Tidak ketemu: "${nama}"`);
        }

        await sock.sendMessage(found.jid, { text });
        await sendText(chatId, `✅ Terkirim ke ${found.name || found.jid.split('@')[0]}\n\n💬 ${text}`);

        // Simpan ke chat store
        const now = Date.now();
        if (!chatStore.has(found.jid)) chatStore.set(found.jid, []);
        chatStore.get(found.jid).push({
            from: found.jid,
            text,
            senderName: 'You',
            key: { fromMe: true },
            timestamp: Math.floor(now / 1000),
            receivedAt: now
        });
    } catch (e) {
        console.error('Send error:', e);
        sendText(chatId, `❌ Gagal kirim: ${e.message}`);
    }
});

// Forward media yang dikirim user ke WA
bot.on('photo', async (msg) => {
    if (!CONFIG.ADMIN_CHAT_ID || getChatId(msg) !== CONFIG.ADMIN_CHAT_ID) return;
    if (!sock) return sendText(getChatId(msg), '❌ WA belum terhubung');

    if (msg.reply_to_message) {
        // Forward ke kontak yang terakhir di-chat
        const lastChat = Array.from(chatStore.keys())[0];
        if (lastChat) {
            const fileId = msg.photo[msg.photo.length - 1].file_id;
            const file = await bot.getFile(fileId);
            const url = `https://api.telegram.org/file/bot${CONFIG.TELEGRAM_TOKEN}/${file.file_path}`;

            try {
                const res = await fetch(url);
                const buf = await res.buffer();
                await sock.sendMessage(lastChat, { image: buf });
                sendText(getChatId(msg), '✅ Foto forwarded ke WA');
            } catch (e) {
                sendText(getChatId(msg), `❌ Error: ${e.message}`);
            }
        }
    } else {
        sendText(getChatId(msg), '📷 Kirim foto + reply ke chat target, atau gunakan /send');
    }
});

// Teks biasa — cari kontak dan kirim
bot.on('message', async (msg) => {
    const chatId = getChatId(msg);
    if (msg.chat.type === 'private' &&
        !msg.text?.startsWith('/') &&
        msg.text?.length > 3 &&
        CONFIG.ADMIN_CHAT_ID === chatId) {

        // User kirim teks panjang — cari kontak dan kirim
        const text = msg.text.trim();

        if (sock) {
            try {
                const chats = await sock.store.chats.fetch();
                const chatArr = Object.values(chats);
                const lastChat = chatStore.size > 0
                    ? Array.from(chatStore.keys())[0]
                    : null;

                if (lastChat) {
                    await sock.sendMessage(lastChat, { text });
                    const name = (await sock.store.chats.fetch())[lastChat]?.name || lastChat;
                    sendText(chatId, `✅ Terkirim ke ${name}\n\n💬 ${text}`);
                    return;
                }

                sendText(chatId, '💡 Gunakan /send <nama> <pesan> untuk kirim pesan');
            } catch (e) {
                sendText(chatId, `❌ Gagal: ${e.message}`);
            }
        }
    }
});

// ============ START ============
app.listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log('========================================');
    console.log('   🤖 WA Telegram Bridge');
    console.log('========================================');
    console.log(`   📡 Port: ${CONFIG.PORT}`);
    console.log(`   🤖 Bot: Connecting...`);
    console.log('========================================');
});

// Inisialisasi WhatsApp
initWhatsApp().catch(e => {
    console.error('Init WA error:', e);
    initWhatsApp();
});

console.log('✅ Script loaded. Starting...');
