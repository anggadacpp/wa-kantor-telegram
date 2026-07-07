# Dockerfile — WA Web Kantor Telegram Bot
# ==========================================

# Gunakan Node.js 20 LTS (untuk long polling Telegram bot)
FROM node:20-alpine

# Buat folder untuk app
WORKDIR /app

# Install dependencies dulu (layer caching)
COPY package*.json ./
# Install dependencies (package-lock.json harus ada di repo)
RUN npm install --omit=dev && npm cache clean --force

# Copy source code
COPY . .

# Buat folder media dengan permission write
RUN mkdir -p media && chmod 755 media

# Expose port dari environment variable PORT (Render injects this)
ENV PORT=3000
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3000/status || exit 1

# Start
CMD ["node", "wa-telegram-server.js"]
