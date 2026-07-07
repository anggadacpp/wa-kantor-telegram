// wa-telegram-server.js
// ============================================
// WA Web Kantor - Telegram Bot Server
// ============================================
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

// ============ KONFIGURASI ============
const CONFIG = {
    TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || '8810076737:AAF3B5gPsriXuDc6l7nS0v7ydwQSfz6KpY8',
    ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID || null,
    PORT: parseInt(process.env.PORT) || 3000
};

// ============ STATE ============
let pendingCommands = []; // Command dari Telegram ke WA Web
let chatHistory = []; // Recent messages untuk history

// ============ TELEGRAM BOT ============
const bot = new TelegramBot(CONFIG.TELEGRAM_TOKEN, { polling: true });
console.log('🤖 Bot Telegram Connected!');

// ============ HELPER ============
function getChatId(msg) {
    return msg.chat.id.toString();
}

function setAdmin(chatId) {
    if (!CONFIG.ADMIN_CHAT_ID) {
        CONFIG.ADMIN_CHAT_ID = chatId;
        console.log(`✅ Admin Chat ID set: ${chatId}`);
        return true;
    }
    return chatId === CONFIG.ADMIN_CHAT_ID;
}

function isAdmin(chatId) {
    return !CONFIG.ADMIN_CHAT_ID || chatId === CONFIG.ADMIN_CHAT_ID;
}

async function sendText(chatId, text, opts = {}) {
    try {
        return await bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...opts });
    } catch (e) {
        console.error('Send error:', e.message);
    }
}

// ============ TELEGRAM COMMANDS ============

bot.onText(/\/start/, async (msg) => {
    const chatId = getChatId(msg);
    setAdmin(chatId);
    await sendText(chatId,
        '🤖 <b>WA Web Kantor Bot</b>\n\n' +
        '📋 Commands:\n' +
        '/inbox - Daftar chat WA\n' +
        '/status - Status server\n' +
        '/relink - Scan QR baru\n\n' +
        '💡 Chat baru dari WA Web akan otomatis masuk ke sini.'
    );
});

bot.onText(/\/help/, async (msg) => {
    const chatId = getChatId(msg);
    await sendText(chatId,
        '📖 <b>Panduan</b>\n\n' +
        '<b>/inbox</b> - Tampilkan daftar chat WA\n' +
        '<b>/last</b> - Pesan terbaru dari setiap chat\n' +
        '<b>/search [nama]</b> - Cari chat berdasarkan nama\n' +
        '<b>/relink</b> - Scan QR baru\n\n' +
        '📌 <b>Cara Kirim Pesan:</b>\n' +
        'Buka WA Web → klik tombol 💬\n' +
        'Pilih kontak → ketik pesan\n' +
        'Pesan akan terkirim via WA Web!'
    );
});

bot.onText(/\/status/, async (msg) => {
    const chatId = getChatId(msg);
    await sendText(chatId,
        '📡 <b>Status</b>\n\n' +
        `Telegram: ✅ Connected\n` +
        `Admin: ${CONFIG.ADMIN_CHAT_ID || 'Belum ada'}\n` +
        `Chat monitor: ${chatHistory.length} pesan\n` +
        `Commands pending: ${pendingCommands.length}\n` +
        `⏰ ${new Date().toLocaleString('id-ID')}`
    );
});

bot.onText(/\/inbox/, async (msg) => {
    const chatId = getChatId(msg);

    if (!chatHistory.length) {
        return await sendText(chatId, '📭 Belum ada data chat.\n\nBuka WA Web dulu dan scroll beberapa chat untuk mengisi data.');
    }

    // Group by sender
    const grouped = {};
    chatHistory.forEach(m => {
        const key = m.chat;
        if (!grouped[key]) grouped[key] = { count: 0, last: null, lastTime: 0 };
        grouped[key].count++;
        if (m.time > grouped[key].lastTime) {
            grouped[key].last = m.preview;
            grouped[key].lastTime = m.time;
        }
    });

    const sorted = Object.entries(grouped)
        .sort((a, b) => b[1].lastTime - a[1].lastTime)
        .slice(0, 20);

    let text = '📋 <b>Inbox WA</b>\n\n';
    sorted.forEach(([chat, data], i) => {
        const preview = data.last ? data.last.substring(0, 50) : '(kosong)';
        const time = new Date(data.lastTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        text += `${i + 1}. <b>${chat}</b>\n   💬 ${preview}...\n   ⏰ ${time}\n\n`;
    });

    text += `\n💡 Buka WA Web untuk kirim/baca pesan lengkap.`;
    await sendText(chatId, text);
});

bot.onText(/\/last/, async (msg) => {
    const chatId = getChatId(msg);

    if (!chatHistory.length) {
        return await sendText(chatId, '📭 Belum ada chat. Buka WA Web dulu.');
    }

    const latest = [...chatHistory]
        .sort((a, b) => b.time - a.time)
        .slice(0, 10);

    let text = '🕐 <b>Pesan Terbaru</b>\n\n';
    latest.forEach(m => {
        const time = new Date(m.time).toLocaleString('id-ID', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        });
        text += `👤 <b>${m.chat}</b>\n💬 ${m.preview || '(media)'}\n⏰ ${time}\n\n`;
    });

    await sendText(chatId, text);
});

bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = getChatId(msg);
    const query = (match[1] || '').toLowerCase();

    const results = chatHistory.filter(m =>
        m.chat.toLowerCase().includes(query) ||
        (m.preview && m.preview.toLowerCase().includes(query))
    );

    if (!results.length) {
        return await sendText(chatId, `❌ Tidak ketemu: "${match[1]}"`);
    }

    let text = `🔍 <b>Hasil pencarian: "${match[1]}"</b>\n\n`;
    results.slice(0, 10).forEach(m => {
        const time = new Date(m.time).toLocaleString('id-ID', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        });
        text += `👤 <b>${m.chat}</b>\n💬 ${m.preview || '(media)'}\n⏰ ${time}\n\n`;
    });

    await sendText(chatId, text);
});

bot.onText(/\/relink/, async (msg) => {
    const chatId = getChatId(msg);
    await sendText(chatId,
        '📱 <b>QR Code Scan</b>\n\n' +
        'Versi ini tidak mendukung QR scan.\n\n' +
        '✅ Jika ingin kontrol penuh WA via Telegram:\n' +
        '1. Hapus script ini\n' +
        '2. Deploy versi Baileys (butuh 1x scan QR)\n\n' +
        '📌 Versi saat ini sudah:\n' +
        '• Auto notifikasi chat baru\n' +
        '• Auto sync foto/video\n' +
        '• Monitor inbox via /inbox'
    );
});

// Handle semua pesan teks dari admin
bot.on('message', async (msg) => {
    const chatId = getChatId(msg);
    if (msg.chat.type !== 'private') return;
    if (msg.text && msg.text.startsWith('/')) return;

    const isFirst = setAdmin(chatId);

    if (isFirst) {
        await sendText(chatId,
            '✅ <b>Admin Terdaftar!</b>\n\n' +
            'Sekarang kamu bisa:\n' +
            '• Dapat notifikasi chat baru\n' +
            '• Kirim /inbox untuk lihat daftar chat\n' +
            '• Kirim /last untuk pesan terbaru\n\n' +
            '💡 Buka WA Web untuk mulai monitoring!'
        );
    }
});

// ============ WEBHOOK (dari Tampermonkey) ============
app.post('/webhook', (req, res) => {
    const data = req.body;

    if (data.type === 'ping') {
        return res.json({ ok: true });
    }

    if (data.type === 'chat_update') {
        // Simpan chat baru ke history
        const chatData = {
            chat: data.chat || 'Unknown',
            preview: data.preview || '',
            time: data.time ? new Date(data.time).getTime() : Date.now(),
            type: data.messageType || 'text'
        };
        chatHistory.push(chatData);
        if (chatHistory.length > 500) chatHistory = chatHistory.slice(-300);

        // Kirim notifikasi ke Telegram
        if (CONFIG.ADMIN_CHAT_ID) {
            const time = new Date(chatData.time).toLocaleTimeString('id-ID', {
                hour: '2-digit', minute: '2-digit'
            });
            const typeIcon = chatData.type === 'image' ? '📷' :
                            chatData.type === 'video' ? '🎥' :
                            chatData.type === 'audio' ? '🎵' :
                            chatData.type === 'document' ? '📄' : '💬';

            let message = `${typeIcon} <b>${chatData.chat}</b>\n`;
            message += `${typeIcon} ${chatData.preview || '(media)'}\n`;
            message += `⏰ ${time}`;

            bot.sendMessage(CONFIG.ADMIN_CHAT_ID, message, { parse_mode: 'HTML' })
                .catch(() => {});
        }
        return res.json({ ok: true });
    }

    if (data.type === 'test') {
        if (CONFIG.ADMIN_CHAT_ID) {
            bot.sendMessage(CONFIG.ADMIN_CHAT_ID,
                '🧪 <b>Test Connection</b>\n\n✅ WA Web Kantor terhubung!\n⏰ ' + new Date().toLocaleString('id-ID'),
                { parse_mode: 'HTML' }
            ).catch(() => {});
        }
        return res.json({ success: true });
    }

    res.json({ ok: true });
});

// ============ MEDIA WEBHOOK ============
const multer = require('multer');
const upload = multer({ dest: '/tmp/media' });
const fs = require('fs');
const path = require('path');

app.post('/webhook/media', upload.single('media'), async (req, res) => {
    const { chatName, caption, mediaType } = req.body;

    if (!CONFIG.ADMIN_CHAT_ID) {
        return res.json({ ok: true, message: 'Admin not set yet' });
    }

    try {
        const timeLabel = '⏰ ' + new Date().toLocaleString('id-ID');

        if (req.file) {
            const mimeType = req.file.mimetype;
            const fileSizeMB = (req.file.size / (1024 * 1024)).toFixed(2);
            const sendOptions = {
                caption: caption ? `👤 <b>${chatName || 'WA'}</b>\n📎 ${mediaType || 'Media'}\n${caption}\n\n${timeLabel}` : `👤 <b>${chatName || 'WA'}</b>\n📎 ${mediaType || 'Media'}\n\n${timeLabel}`,
                parse_mode: 'HTML'
            };

            if (mimeType.startsWith('image/')) {
                await bot.sendPhoto(CONFIG.ADMIN_CHAT_ID, req.file.path, sendOptions);
            } else if (mimeType.startsWith('video/')) {
                await bot.sendVideo(CONFIG.ADMIN_CHAT_ID, req.file.path, sendOptions);
            } else if (mimeType.startsWith('audio/')) {
                await bot.sendAudio(CONFIG.ADMIN_CHAT_ID, req.file.path, {
                    caption: sendOptions.caption,
                    parse_mode: 'HTML'
                });
            } else {
                await bot.sendDocument(CONFIG.ADMIN_CHAT_ID, req.file.path, {
                    caption: sendOptions.caption,
                    parse_mode: 'HTML'
                });
            }

            fs.unlink(req.file.path, () => {});
            return res.json({ success: true });
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('Media webhook error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============ COMMAND ENDPOINT (WA Browser poll dari sini) ============
// WA Web script akan poll endpoint ini untuk dapat perintah
app.get('/commands', (req, res) => {
    const cmds = pendingCommands.splice(0, pendingCommands.length);
    res.json({ commands: cmds });
});

// WA Web script kirim konfirmasi setelah execute command
app.post('/commands/done', (req, res) => {
    const { commandId, success, error } = req.body;
    if (CONFIG.ADMIN_CHAT_ID && success === false) {
        bot.sendMessage(CONFIG.ADMIN_CHAT_ID, `⚠️ Command gagal: ${error || 'Unknown error'}`)
            .catch(() => {});
    }
    res.json({ ok: true });
});

// ============ STATUS ============
app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        admin: CONFIG.ADMIN_CHAT_ID ? 'set' : 'pending',
        chats: chatHistory.length,
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.send('🤖 WA Web Kantor Bot - Online\n\n/admin - ' + (CONFIG.ADMIN_CHAT_ID ? CONFIG.ADMIN_CHAT_ID : 'waiting...'));
});

// ============ START ============
app.listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log('========================================');
    console.log('   🚀 WA Web Kantor - Telegram Bot');
    console.log('========================================');
    console.log('   📡 Port: ' + CONFIG.PORT);
    console.log('   🤖 Bot: Connected ✅');
    console.log('   👤 Admin: ' + (CONFIG.ADMIN_CHAT_ID || 'waiting for first message...'));
    console.log('========================================');
});
