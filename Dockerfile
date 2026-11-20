# Seller's Setu: one image for the web app and the worker (roadmap §4, owner decision 1: Coolify).
#   web:    npm run start:prod   (applies migrations, then serves on $PORT, default 3000)
#   worker: npm run worker       (background jobs and schedules)
# Build: docker build -t setu .

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
WORKDIR /app
COPY . .
ARG NEXT_PUBLIC_WHATSAPP_NUMBER=""
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_WHATSAPP_NUMBER=$NEXT_PUBLIC_WHATSAPP_NUMBER
# Prisma's config wants DATABASE_URL even to generate; nothing connects during the build.
ARG DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates postgresql-client && rm -rf /var/lib/apt/lists/* \
  && groupadd --system setu && useradd --system --gid setu --home /app setu
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 STORAGE_DIR=/data/storage
# The worker runs TypeScript with tsx, and migrations need the Prisma CLI, so the full node_modules ships.
COPY --from=build --chown=setu:setu /app /app
RUN mkdir -p /data/storage /data/backups && chown -R setu:setu /data
USER setu
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start:prod"]
