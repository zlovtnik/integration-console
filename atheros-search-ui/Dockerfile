FROM oven/bun:1 AS builder
WORKDIR /app
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
