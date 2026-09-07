FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node . .

RUN mkdir -p /app/data/db /source-archive && chown -R node:node /app/data /source-archive

ENV PORT=3010
ENV ELECTION_DB_PATH=/app/data/election-dashboard.db
ENV ELECTION_RESULTS_DIR=/app/data/election-results
ENV HOST=0.0.0.0

EXPOSE 3010

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3010/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
