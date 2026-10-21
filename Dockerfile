FROM node:22-bookworm-slim

# ffmpeg and yt-dlp (needs python3) are required for music; build tools are for the optional native opus encoder
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3 \
  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod 0755 /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
# the lock file pins the exact versions; the native opus package is optional (opusscript is the fallback)
RUN npm ci --omit=dev
COPY . .

RUN npm install -g pm2 && mkdir -p /app/data && chown -R node:node /app

# not root
USER node
VOLUME ["/app/data"]

CMD ["pm2-runtime", "start", "ecosystem.config.js"]
