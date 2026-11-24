FROM node:22-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/

FROM base AS build
RUN npm ci
COPY apps/web apps/web
COPY apps/api apps/api
RUN npm run build

FROM base AS production-deps
RUN npm ci --omit=dev

FROM production-deps AS api
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

FROM production-deps AS web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/apps/web/.next apps/web/.next
COPY --from=build --chown=node:node /app/apps/web/public apps/web/public
USER node
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node", "../../node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
