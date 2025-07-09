FROM oven/bun:1.1.34-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 8080
CMD ["bun", "run", "dev"]

FROM base AS production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun build src/index.ts --outdir dist --target bun
EXPOSE 8080
CMD ["bun", "run", "start"]
