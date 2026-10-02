FROM oven/bun:1 AS builder
WORKDIR /workspace/atheros-search-ui
ARG VITE_API_BASE=
ARG VITE_APP_TITLE="atheros search"
ARG VITE_KEYCLOAK_URL=
ARG VITE_KEYCLOAK_REALM=
ARG VITE_KEYCLOAK_CLIENT_ID=
ENV VITE_API_BASE=$VITE_API_BASE \
    VITE_APP_TITLE=$VITE_APP_TITLE \
    VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL \
    VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM \
    VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID
COPY atheros-search-ui/package.json atheros-search-ui/bun.lock* ./
RUN bun install --frozen-lockfile
COPY atheros-search-ui .
COPY atheros-search/testdata/contracts /workspace/atheros-search/testdata/contracts
RUN bun run build

FROM nginx:alpine
RUN touch /run/nginx.pid \
  && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /run /var/run /var/log/nginx
COPY --from=builder --chown=nginx:nginx /workspace/atheros-search-ui/dist /usr/share/nginx/html
COPY --chown=nginx:nginx atheros-search-ui/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
USER nginx
