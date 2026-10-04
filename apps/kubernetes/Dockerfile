# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH HUSKY=0 MCXD_DISABLE_PWA=true
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/ packages/
COPY apps/ apps/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @metacubexd/ui generate
RUN pnpm --filter @metacubexd/kubernetes deploy --prod --legacy /runtime

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 UI_DIST=/app/ui-dist
WORKDIR /app
COPY --from=builder /runtime ./
COPY --from=builder /repo/packages/ui/.output/public ./ui-dist
USER 1000:1000
EXPOSE 8080
CMD ["node", "server.mjs"]
