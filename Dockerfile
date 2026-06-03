# syntax=docker/dockerfile:1

# --- deps: install dependencies (incl. dev, needed to build) -------------------
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts: no dependency needs a native postinstall here (sharp is
# unused — images.unoptimized=true), and it sidesteps pnpm 10's hard error on
# ignored build scripts (ERR_PNPM_IGNORED_BUILDS).
RUN pnpm install --frozen-lockfile --ignore-scripts

# --- builder: compile the Next.js standalone bundle ----------------------------
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Pre-built CEX bloom filter is expected at data/cex-bloom.json (see README).
# If absent, traces still run — they just won't identify exchange endpoints.
RUN pnpm build

# --- runner: minimal runtime image --------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Standalone server + its trace-included files (data/cex-bloom.json rides along
# via next.config.mjs `outputFileTracingIncludes`).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Belt-and-braces: ensure the bloom filter is present at the path lib/cex.ts reads.
COPY --from=builder --chown=nextjs:nodejs /app/data/cex-bloom.json ./data/cex-bloom.json

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
