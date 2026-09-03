# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@11.11.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/backtest/package.json packages/backtest/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/etoro-client/package.json packages/etoro-client/
COPY packages/indicators/package.json packages/indicators/
COPY packages/journal/package.json packages/journal/
COPY packages/market-structure/package.json packages/market-structure/
COPY packages/observability/package.json packages/observability/
COPY packages/risk-engine/package.json packages/risk-engine/
COPY packages/strategies/package.json packages/strategies/
COPY packages/test-fixtures/package.json packages/test-fixtures/
RUN pnpm install --frozen-lockfile

FROM deps AS source
COPY . .

FROM source AS api
ENV NODE_ENV=production
RUN mkdir -p /app/data/journal-screenshots && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["pnpm", "--filter", "@market-sentinel/api", "start"]

FROM source AS worker
ENV NODE_ENV=production
RUN chown -R node:node /app
USER node
CMD ["pnpm", "--filter", "@market-sentinel/worker", "start"]

FROM source AS migrate
ENV NODE_ENV=production
RUN chown -R node:node /app
USER node
CMD ["pnpm", "--filter", "@market-sentinel/db", "migrate"]

FROM source AS web-build
ARG API_INTERNAL_URL=http://api:3001
ENV API_INTERNAL_URL=$API_INTERNAL_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @market-sentinel/web build

FROM base AS web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=web-build /app/apps/web/.next/standalone ./
COPY --from=web-build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build /app/apps/web/public ./apps/web/public
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
