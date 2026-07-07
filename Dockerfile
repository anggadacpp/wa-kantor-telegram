# Dockerfile — WA Web Kantor Telegram Bot
# ==========================================

FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev && npm cache clean --force

# Copy source code
COPY . .

# Railway injects PORT env var
ENV PORT=3000
EXPOSE ${PORT}

# Start server
CMD ["node", "wa-telegram-server.js"]
