# ClassMind — production image.
#
# Three stages, so the thing that ships is not the thing that built it. The
# final image holds the traced standalone server and nothing else: no source,
# no lockfile, no TypeScript, no test runner, no build cache.
#
# With no environment at all the container runs in local mode: an embedded
# store under /app/.classmind and the demo classes built on first request — no
# AWS account involved.
#
#   docker build -t classmind:latest .
#   docker run --rm --init -p 3000:3000 classmind:latest
#
# The optional AWS target is chosen at run time, never at build time. No value
# is prefixed NEXT_PUBLIC_, so nothing is inlined, and AWS variables are only
# read on the first request that touches AWS (`lib/env.ts` memoises the check).
# Credentials are never in the image: `.dockerignore` keeps `.env.aws` and
# `.env.local` out of the build context, and the AWS SDK resolves credentials
# from the standard provider chain at run time.
#
#   docker run --rm --init -p 3000:3000 --env-file .env.aws classmind:latest

# Pinned to the current Node 22 LTS. Next 16 requires >= 20.9; Alpine keeps the
# runtime layer small and the standalone server needs no native toolchain.
ARG NODE_VERSION=22-alpine

# ---------------------------------------------------------------------------
# 1. deps — the dependency tree, cached on the lockfile alone
#
# Separated from the build so that editing a component does not re-run
# `npm ci`. Dev dependencies are installed too: `next build` type-checks and
# lints, which needs TypeScript and eslint-config-next.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# 2. builder — `next build`, producing .next/standalone
#
# The build must not require AWS configuration, and it does not: `getEnv()` is
# called on the first request rather than at module load, precisely so a build
# machine never needs credentials.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV CLASSMIND_STANDALONE=1
RUN npm run build

# ---------------------------------------------------------------------------
# 3. runner — what actually ships
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# The standalone server reads PORT for its port and HOSTNAME for its bind
# address. HOSTNAME is set in the CMD rather than here — see the note there.
ENV PORT=3000

# Own user rather than root. The server only ever reads its own files and
# writes to Next's cache directory, so it needs no privileges at all.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

# `output: "standalone"` emits the traced server plus only the node_modules
# files the traced code reaches. It deliberately does not copy `.next/static`,
# so that comes across separately. There is no `public/` directory in this
# project, so there is nothing else to bring.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Local mode — the default when CLASSMIND_TARGET is unset — keeps its embedded
# store and uploads under /app/.classmind, so the runtime user must own it.
# Mount a volume there to keep the data across container restarts.
RUN mkdir -p /app/.classmind && chown nextjs:nodejs /app/.classmind

USER nextjs

EXPOSE 3000

# Liveness only, and deliberately against `/` — the join page is statically
# prerendered, so it answers without touching DynamoDB or S3. A health check
# that depended on AWS would report the container unhealthy whenever the
# credentials expired, which is a configuration problem, not a dead process.
# `node --eval` rather than curl or wget, so the image gains no package for it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node --eval "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# The standalone build's own minimal server. `next start` is not available here
# — the Next CLI is not one of the traced files, and does not need to be.
#
# `HOSTNAME` is assigned here, not with `ENV`, because the standalone server
# reads that variable to choose its bind address and orchestrators set it to
# something else entirely: ECS injects the task's own hostname, so an `ENV`
# default is overwritten and the server binds to the private IP alone. The
# container is then reachable from outside but not on loopback, which is exactly
# backwards — the app answers real traffic while its own health check is
# refused. Assigning it in the command applies it after the orchestrator's
# environment, so the bind address is a property of the image.
#
# `exec` so node replaces the shell as PID 1 and still receives the SIGTERM that
# ECS sends to drain a task.
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node server.js"]
