# --- ビルドステージ ---
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- 実行ステージ ---
FROM node:22-slim

# Litestream (SQLite を GCS に常時レプリケート)
ADD https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.deb /tmp/litestream.deb
RUN dpkg -i /tmp/litestream.deb && rm /tmp/litestream.deb

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY litestream.yml /etc/litestream.yml
COPY run.sh ./run.sh
RUN chmod +x run.sh

ENV DB_PATH=/data/racoon-bot.db
ENV NODE_ENV=production

CMD ["./run.sh"]
