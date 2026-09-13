FROM node:25.8-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY tsconfig.base.json eslint.config.js ./
COPY apps/api/tsup.config.ts apps/api/tsup.config.ts
COPY apps/api apps/api
COPY packages/contracts packages/contracts
RUN npm run build:api

FROM node:25.8-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8788
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist/api dist/api
COPY db db
COPY scripts/migrate.mjs scripts/migrate.mjs
USER node
EXPOSE 8788
HEALTHCHECK --interval=20s --timeout=3s --start-period=10s --retries=3 CMD wget -q -O - http://127.0.0.1:8788/healthz || exit 1
CMD ["node", "dist/api/server.js"]
