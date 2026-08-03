FROM node:22-alpine AS dependencies
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm fixtures:generate && pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
RUN addgroup --system nodejs && adduser --system --ingroup nodejs studio
COPY --chown=studio:nodejs --from=build /app ./
USER studio
EXPOSE 3000
CMD ["pnpm", "start"]
