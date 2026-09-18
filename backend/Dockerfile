FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY assets/core.js ./assets/core.js
COPY backend ./backend
COPY database/migrations ./database/migrations

RUN chown -R node:node /app
USER node

ENV PGI_BACKEND_HOST=0.0.0.0
ENV PGI_BACKEND_PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node","backend/server.mjs"]
