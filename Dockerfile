FROM oven/bun:alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 8080
CMD ["bun", "run", "dev"]

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN bun build src/index.ts --outdir dist --target bun --minify && \
    mkdir -p dist/workers && \
    bun build src/workers/payment-worker.ts --outdir dist/workers --target bun --minify

RUN bun build src/index.ts --compile --outfile app-binary --target bun --minify

RUN mkdir -p workers-bin && \
    bun build src/workers/payment-worker.ts --compile --outfile workers-bin/payment-worker --target bun --minify

FROM ubuntu:22.04 AS production

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -s /bin/sh appuser

WORKDIR /app

COPY --from=builder --chown=appuser:appgroup /app/app-binary ./app-binary
COPY --from=builder --chown=appuser:appgroup /app/workers-bin ./workers-bin
COPY --from=builder --chown=appuser:appgroup /app/dist/workers ./dist/workers

RUN chmod +x ./app-binary && \
    chmod +x ./workers-bin/payment-worker

USER appuser

EXPOSE 8080

CMD ["./app-binary"]