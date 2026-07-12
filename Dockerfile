FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  unzip \
  tar \
  python3 \
  python3-venv \
  bash \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN chmod +x scripts/install-clis.sh && \
  scripts/install-clis.sh

ENTRYPOINT ["node", "src/index.js"]
CMD ["list"]
