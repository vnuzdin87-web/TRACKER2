FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY prisma/schema.prisma ./prisma/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
    && mkdir /data && chown node:node /data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_URL=file:/data/budget.db
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/server/migrate.js && if [ ! -f /data/.initialized ]; then node dist/server/seed.js && touch /data/.initialized || exit 1; fi && exec node dist/server/index.js"]
