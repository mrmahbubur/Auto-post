FROM node:22-bookworm-slim

# Install Noto Sans & DejaVu fonts for crisp @resvg/resvg-js 1200x630 PNG rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-noto-core \
    fonts-dejavu-core \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
RUN npm run build && npm run build:pages

RUN mkdir -p /app/data/images

EXPOSE 8080

CMD ["node", "server.ts"]
