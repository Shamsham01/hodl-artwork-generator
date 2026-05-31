FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
  build-essential \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/engine ./packages/engine
COPY apps/api ./apps/api

WORKDIR /app/apps/api
RUN npm install --omit=dev

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "src/index.js"]
