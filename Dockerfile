FROM node:20-bookworm-slim

# ffmpeg is required at the OS level as a fallback / for some play-dl operations
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

RUN npm install -g pm2

VOLUME ["/app/data"]

CMD ["pm2-runtime", "start", "ecosystem.config.js"]
