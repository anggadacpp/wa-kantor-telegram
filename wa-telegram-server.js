// wa-telegram-server.js
// ============================================
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

// ============ KONFIGURASI ============
// Load dari environment variable, fallback ke placeholder
const CONFIG = {
    // PASTE TOKEN TELEGRAM KAMU (atau set TELEGRAM_TOKEN di environment)
    TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || '8810076737:AAF3B5gPsriXuDc6l7nS0v7ydwQSfz6KpY8',

    // PASTE CHAT ID KAMU (dari getUpdates)
    ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID || 'GANTI_DENGAN_CHAT_ID_KAMU',

    PORT: parseInt(process.env.PORT) || 3000,

    // Folder temporary untuk media
    MEDIA_DIR: process.env.MEDIA_DIR || './media'
};

// Buat folder media jika belum ada
if (!fs.existsSync(CONFIG.MEDIA_DIR)) {
    fs.mkdirSync(CONFIG.MEDIA_DIR, { recursive: true });
}

// ============ FILE UPLOAD ============
const upload = multer({
    dest: CONFIG.MEDIA_DIR,
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB max
});

// ============ TELEGRAM BOT ============
const bot = new TelegramBot(CONFIG.TELEGRAM_TOKEN, { polling: true });

console.log('🤖 Bot Telegram Connected!');

// Command /start
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
        '🤖 *WA Web Kantor Bot Aktif!*\n\n' +
        '/sync - Sync manual\n' +
        '/status - Status\n' +
        '/stats - Statistik\n\n' +
        'Pesan dari WA Web akan muncul otomatis.',
        { parse_mode: 'Markdown' }
    );
});

// Command /status
bot.onText(/\/status/, (msg) => {
    bot.sendMessage(msg.chat.id, '✅ *Status OK*\n\nWA Web Kantor Online\nMonitoring Aktif', { parse_mode: 'Markdown' });
});

// Command /stats
bot.onText(/\/stats/, (msg) => {
    bot.sendMessage(msg.chat.id,
        '📊 *Statistik*\n\n' +
        '🖥️ Server: Online ✅\n' +
        '🤖 Bot: Aktif ✅\n' +
        '⏰ ' + new Date().toLocaleString('id-ID'),
        { parse_mode: 'Markdown' }
    );
});

// Command /sync
bot.onText(/\/sync/, (msg) => {
    bot.sendMessage(msg.chat.id, '🔄 Sync request dikirim...');
});

// ============ WEBHOOK ============
app.post('/webhook', (req, res) => {
    const data = req.body;

    let message = '';

    if (data.type === 'test') {
        message = '🧪 *Test Connection*\n\n✅ WA Web Kantor terhubung!\n⏰ ' + new Date().toLocaleString('id-ID');
    }
    else if (data.type === 'new_messages') {
        message = '📩 *' + data.messages.length + ' Pesan Baru!*\n\n';
        data.messages.forEach(msg => {
            message += '👤 *' + msg.chat + '*\n💬 ' + msg.preview + '\n⏰ ' + (msg.time || new Date().toLocaleString('id-ID')) + '\n\n';
        });
    }
    else if (data.type === 'new_chat') {
        message = '🆕 *Chat Baru!*\n\n👤 *' + data.chat + '*\n💬 ' + data.preview + '\n⏰ ' + (data.time || new Date().toLocaleString('id-ID'));
    }
    else if (data.type === 'sync') {
        message = '🔄 *Sync Complete*\n\n📊 Total Chat: ' + (data.chats?.length || 0) + '\n⏰ ' + new Date().toLocaleString('id-ID');
    }
    else if (data.type === 'custom_message') {
        message = '💬 *Custom*\n\n' + data.message + '\n⏰ ' + new Date().toLocaleString('id-ID');
    }
    else {
        message = '📱 *Update*\n\n' + JSON.stringify(data, null, 2).substring(0, 500);
    }

    bot.sendMessage(CONFIG.ADMIN_CHAT_ID, message, { parse_mode: 'Markdown' })
        .then(() => res.json({ success: true }))
        .catch(err => res.status(500).json({ error: err.message }));
});

// ============ MEDIA WEBHOOK ============
// Menerima media dari WA Web dan forward ke Telegram
app.post('/webhook/media', upload.single('media'), async (req, res) => {
    const { chatName, caption, mediaType } = req.body;

    try {
        let message = '';
        const chatLabel = chatName ? `👤 *${chatName}*\n` : '';
        const timeLabel = '⏰ ' + new Date().toLocaleString('id-ID');

        if (req.file) {
            // File ada — kirim sebagai media
            const filePath = req.file.path;
            const fileSizeMB = (req.file.size / (1024 * 1024)).toFixed(2);

            const sendOptions = {
                caption: caption ? `${chatLabel}📎 *Media: ${mediaType || 'File'}*\n${caption}\n\n${timeLabel}` : `${chatLabel}📎 *Media: ${mediaType || 'File'}*\n\n${timeLabel}`,
                parse_mode: 'Markdown'
            };

            const mimeType = req.file.mimetype;

            if (mimeType.startsWith('image/')) {
                await bot.sendPhoto(CONFIG.ADMIN_CHAT_ID, filePath, sendOptions);
                message = `📷 Foto terkirim (${fileSizeMB} MB)`;
            } else if (mimeType.startsWith('video/')) {
                await bot.sendVideo(CONFIG.ADMIN_CHAT_ID, filePath, sendOptions);
                message = `🎥 Video terkirim (${fileSizeMB} MB)`;
            } else if (mimeType.startsWith('audio/')) {
                await bot.sendAudio(CONFIG.ADMIN_CHAT_ID, filePath, { caption: sendOptions.caption, parse_mode: 'Markdown' });
                message = `🎵 Audio terkirim (${fileSizeMB} MB)`;
            } else {
                // Dokumen / file lain
                await bot.sendDocument(CONFIG.ADMIN_CHAT_ID, filePath, { caption: sendOptions.caption, parse_mode: 'Markdown' });
                message = `📄 Dokumen terkirim: ${req.file.originalname} (${fileSizeMB} MB)`;
            }

            // Cleanup file temporary
            fs.unlink(filePath, () => {});
        } else if (req.body.mediaUrl) {
            // Tidak ada file upload, coba kirim dari URL
            const sendOptions = {
                caption: caption ? `${chatLabel}📎 *Media URL*\n${caption}\n\n${timeLabel}` : `${chatLabel}📎 *Media URL*\n\n${timeLabel}`,
                parse_mode: 'Markdown'
            };

            try {
                if (mediaType === 'image' || mediaType === 'photo') {
                    await bot.sendPhoto(CONFIG.ADMIN_CHAT_ID, req.body.mediaUrl, sendOptions);
                } else if (mediaType === 'video') {
                    await bot.sendVideo(CONFIG.ADMIN_CHAT_ID, req.body.mediaUrl, sendOptions);
                } else if (mediaType === 'audio') {
                    await bot.sendAudio(CONFIG.ADMIN_CHAT_ID, req.body.mediaUrl, { caption: sendOptions.caption, parse_mode: 'Markdown' });
                } else {
                    await bot.sendDocument(CONFIG.ADMIN_CHAT_ID, req.body.mediaUrl, { caption: sendOptions.caption, parse_mode: 'Markdown' });
                }
                message = `📎 Media URL terkirim (via link)`;
            } catch (urlErr) {
                message = `⚠️ Gagal kirim media dari URL: ${urlErr.message}`;
            }
        } else {
            return res.status(400).json({ error: 'No media file or mediaUrl provided' });
        }

        console.log(`✅ ${message} — ${chatName || 'Unknown'}`);
        res.json({ success: true, message });
    } catch (err) {
        console.error('❌ Error media webhook:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Endpoint untuk download media dari WA Web (proxy)
app.get('/proxy/media', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url parameter required' });

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', 'inline');
        response.body.pipe(res);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/status', (req, res) => {
    res.json({ status: 'online', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.send('🤖 WA Web Kantor Bot - Online');
});

// ============ START ============
app.listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log('========================================');
    console.log('   🚀 WA Web Kantor - Telegram Bot');
    console.log('========================================');
    console.log('   📡 Port: ' + CONFIG.PORT);
    console.log('   🤖 Bot: Connected ✅');
    console.log('   👤 Admin: ' + CONFIG.ADMIN_CHAT_ID);
    console.log('========================================');
});
