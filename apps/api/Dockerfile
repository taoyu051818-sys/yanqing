FROM node:24-alpine AS builder
WORKDIR /app
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter api... --filter @yanqing/shared...
COPY apps/api apps/api
COPY packages/shared packages/shared
RUN pnpm --dir apps/api prisma:generate && pnpm --dir apps/api build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
EXPOSE 3200
CMD ["sh", "-c", "pnpm --dir apps/api db:deploy && node apps/api/dist/main.js"]
