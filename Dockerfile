FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3010
ENV ELECTION_DB_PATH=/app/data/election-dashboard.db
ENV ELECTION_RESULTS_DIR=/app/data/election-results

EXPOSE 3010

CMD ["node", "server.js"]
