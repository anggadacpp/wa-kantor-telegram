# 📱 WA Web Kantor — Telegram Bot

Sinkronisasi WA Web ke Telegram. Kirim pesan, media, dan notifikasi dari WA Web ke bot Telegram kamu.

---

## 🚀 Deploy di Render.com (Gratis)

### Prerequisites
1. Akun [Render.com](https://dashboard.render.com)
2. Akun [GitHub](https://github.com)
3. Bot Telegram dari [@BotFather](https://t.me/BotFather)

### Langkah 1 — Buat Repo GitHub
```bash
cd tamperman
git init
git add .
git commit -m "Initial commit"
gh repo create wa-kantor-telegram --public --push
```

### Langkah 2 — Buat Bot Telegram
1. Buka [@BotFather](https://t.me/BotFather)
2. Kirim `/newbot`
3. Ikuti instruksi, simpan **TOKEN** yang diberikan
4. Buka: `https://api.telegram.org/bot<TOKEN>/getUpdates`
5. Kirim `/start` ke bot, lalu refresh halaman
6. Copy **CHAT_ID** dari response JSON (bagian `"chat":{"id":xxxxx}`)

### Langkah 3 — Deploy ke Render
1. Buka [dashboard.render.com/blueprints](https://dashboard.render.com/blueprints)
2. Klik **"New +"** → **"Blueprint"**
3. Connect repo GitHub kamu
4. Render otomatis baca `render.yaml`
5. Tambahkan environment variable:
   - `TELEGRAM_TOKEN` → token bot kamu
   - `ADMIN_CHAT_ID` → chat ID kamu
6. Klik **"Create Blueprint"**
7. Tunggu build (~2-3 menit)

### Langkah 4 — Dapatkan URL Server
Setelah deploy berhasil, buka service di Render → **Settings** → copy **URL** (contoh: `https://wa-kantor-telegram.onrender.com`)

---

## 🔧 Setup Userscript (Tampermonkey)

1. Install [Tampermonkey](https://tampermonkey.net/) di browser
2. Buka `wa-kantor-telegram.user.js`
3. **Edit baris 17** — ganti URL:
   ```javascript
   const SERVER_URL = 'https://wa-kantor-telegram.onrender.com/webhook';
   ```
4. **Install script** — copy-paste ke Tampermonkey

---

## 📌 Command Bot Telegram

| Command | Fungsi |
|---------|--------|
| `/start` | Aktifkan bot |
| `/status` | Cek status server |
| `/stats` | Statistik |
| `/sync` | Sync manual semua chat |

---

## 📂 Struktur File

```
tamperman/
├── wa-telegram-server.js   # Server Node.js (Express + Telegram Bot)
├── wa-kantor-telegram.user.js  # Tampermonkey script
├── render.yaml             # Render.com deployment config
├── Dockerfile              # Container build
├── package.json
└── README.md
```

---

## ⚠️ Catatan Penting

- **Long polling** — bot otomatis poll Telegram, tidak butuh webhook setup
- **Free tier Render** — service sleep setelah 15 menit idle, wake up ~30 detik
- **ADMIN_CHAT_ID** — harus angka (bukan username), dapat dari getUpdates
- **Port** — Render injects `PORT` env variable, jangan hardcode

---

## 🐛 Troubleshooting

### Bot tidak balas?
```bash
# Cek logs di Render Dashboard → service -> Logs
# Pastikan ADMIN_CHAT_ID sudah benar
```

### getUpdates kosong?
- Pastikan sudah kirim `/start` ke bot
- Cek tidak ada bot lain yang consuming updates

### Media tidak terkirim?
- Pastikan server sudah online
- Cek log di widget WA Web
