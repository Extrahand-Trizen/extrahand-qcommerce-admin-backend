# ExtraHand Quick Commerce / Admin backend — production image
# Mirrors the api-gateway / user-service pattern: build TS, ship dist on a slim runtime.

FROM node:20-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends dumb-init curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# --- build stage: compile TypeScript -> dist/ ---
FROM base AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- deps stage: production-only node_modules (bcrypt needs a toolchain to build) ---
FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- production runtime ---
FROM base AS production
ENV NODE_ENV=production
ENV PORT=4010

RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nodeuser

COPY --from=deps  --chown=nodeuser:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodeuser:nodejs /app/dist ./dist
COPY --from=build --chown=nodeuser:nodejs /app/package.json ./

USER nodeuser
EXPOSE 4010

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:4010/api/v1/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
