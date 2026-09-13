# Marketplace-compatible public SPA image.
# The complete web + API + Postgres topology remains in docker-compose.yaml.
FROM node:25.8-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY apps/web/vite.config.ts apps/web/vite.config.ts
COPY scripts/prepare-spa-dist.mjs scripts/prepare-spa-dist.mjs
COPY apps/web apps/web
COPY packages/contracts packages/contracts
RUN npm run build:web

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist/web /usr/share/nginx/html
COPY deploy/nginx.conf.template /etc/nginx/conf.d/default.conf
RUN mkdir -p /var/cache/nginx /var/run \
  && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/run /etc/nginx/conf.d
USER nginx

# Public container port; local Compose maps host port 3082 to this port.
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=3s --start-period=10s --retries=3 CMD wget -q -O - http://127.0.0.1:8080/healthz || exit 1
