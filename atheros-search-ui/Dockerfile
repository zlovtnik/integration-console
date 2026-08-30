FROM oven/bun:1 AS builder
WORKDIR /app
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
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM nginx:alpine
RUN touch /run/nginx.pid \
  && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /run /var/run /var/log/nginx
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html
COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
USER nginx
