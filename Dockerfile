FROM oven/bun:alpine AS base
WORKDIR /app
COPY package.json bun.lockb .

FROM base AS build
RUN bun install
COPY . .
RUN bun run build

FROM base AS development
RUN bun install
COPY . .
EXPOSE 8080
USER bun
CMD ["bun", "run", "dev"]

FROM base AS production
RUN bun install --production --frozen-lockfile
COPY --from=build /app .

ENV NODE_ENV=production
ENV BUN_ENV=production

RUN rm -rf src/tests/ \
    && rm -rf docs/ \
    && rm -rf .git/ \
    && rm -rf *.md \
    && rm -rf .env.example

USER bun
EXPOSE 8080

CMD ["bun", "run", "start"]
